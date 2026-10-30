import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken, SESSION_COOKIE, STATE_COOKIE } from '../server/auth.ts';
import type { Config } from '../server/config.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { handler } from '../server/http.ts';

/*
 * Runs against a real Postgres when TEST_DATABASE_URL points at an empty
 * database (it is wiped first); skipped otherwise. Discord is faked.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('server', () => {
  let db: Db, server: Server, base = '';
  const cfg: Config = {
    port: 0, publicUrl: 'https://rift.example', databaseUrl: url ?? '', discordClientId: 'cid',
    discordClientSecret: 'secret', staticDir: 'dist', trustProxy: true, operator: null,
  };
  const fakeDiscord: typeof fetch = async (input, init) => {
    const u = String(input);
    if (u.endsWith('/oauth2/token')) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('code') !== 'good' || body.get('client_secret') !== 'secret') return new Response('no', { status: 400 });
      return Response.json({ access_token: 'at' });
    }
    if (u.endsWith('/users/@me')) return Response.json({ id: '1234567890', username: 'shy', global_name: 'Shy', avatar: 'abc' });
    return new Response('?', { status: 404 });
  };

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    server = createServer(handler({ cfg, db, fetch: fakeDiscord }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server?.close(); await db?.end(); });

  const get = (p: string, cookie = '') => fetch(base + p, { redirect: 'manual', headers: { cookie } });
  const cookieOf = (res: Response, name: string) =>
    res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';

  it('answers health and an anonymous /api/me', async () => {
    expect(await (await get('/api/health')).json()).toEqual({ ok: true });
    expect(await (await get('/api/me')).json()).toEqual({ user: null });
  });

  it('signs in with Discord, keeps only a hash of the session, and signs out', async () => {
    const start = await get('/auth/discord');
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('location')!);
    expect(to.host).toBe('discord.com');
    expect(to.searchParams.get('redirect_uri')).toBe('https://rift.example/auth/discord/callback');
    expect(to.searchParams.get('scope')).toBe('identify');
    const state = cookieOf(start, STATE_COOKIE);
    expect(state).toBe(to.searchParams.get('state'));

    const back = await get(`/auth/discord/callback?code=good&state=${state}`, `${STATE_COOKIE}=${state}`);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/');
    const session = cookieOf(back, SESSION_COOKIE);
    expect(session.length).toBeGreaterThan(30);
    expect(back.headers.getSetCookie().join()).toMatch(/HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);

    const me = await (await get('/api/me', `${SESSION_COOKIE}=${session}`)).json();
    expect(me.user.name).toBe('Shy');
    expect(me.user.avatar).toContain('/avatars/1234567890/abc.png');

    const rows = (await db.query('SELECT token_hash FROM sessions')).rows;
    expect(rows.map((r) => r.token_hash)).toEqual([hashToken(session)]);

    const out = await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${session}`, origin: 'https://rift.example' } });
    expect(out.status).toBe(200);
    expect(await (await get('/api/me', `${SESSION_COOKIE}=${session}`)).json()).toEqual({ user: null });
  });

  it('refuses a callback whose state does not match, or a logout from another site', async () => {
    const bad = await get('/auth/discord/callback?code=good&state=evil', `${STATE_COOKIE}=mine`);
    expect(bad.headers.get('location')).toBe('/#login-failed');
    const none = await get('/auth/discord/callback?code=good&state=x');
    expect(none.headers.get('location')).toBe('/#login-failed');
    const cross = await fetch(base + '/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
  });

  it('keeps the same account when the same Discord user signs in again', async () => {
    for (let i = 0; i < 2; i++) {
      const s = cookieOf(await get('/auth/discord'), STATE_COOKIE);
      await get(`/auth/discord/callback?code=good&state=${s}`, `${STATE_COOKIE}=${s}`);
    }
    expect(Number((await db.query("SELECT count(*) FROM users WHERE discord_id <> 'deleted'")).rows[0].count)).toBe(1);
  });

  it('runs each migration once', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});
