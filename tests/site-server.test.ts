import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE, upsertUser } from '../server/auth.ts';
import type { Config } from '../server/config.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom } from '../server/economy.ts';
import { handler } from '../server/http.ts';
import type { CardDb } from '../src/data/types.ts';

/* Home's news and banner, set by an admin (server/site.ts), against a real Postgres; skipped without one. */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=site_test')}`;
const ORIGIN = 'https://rift.example';

describe.skipIf(!url)('home news and banner', () => {
  let db: Db, server: Server, base = '', admin = '', player = '';
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const cfg: Config = { port: 0, publicUrl: ORIGIN, databaseUrl: url ?? '', discordClientId: 'cid', discordClientSecret: 'secret', staticDir: 'dist', trustProxy: true, operator: null };

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS site_test CASCADE; CREATE SCHEMA site_test;');
    await migrate(db);
    server = createServer(handler({ cfg, db, catalog }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const a = await upsertUser(db, { id: '1', username: 'admin' });
    const p = await upsertUser(db, { id: '2', username: 'player' });
    await db.query('UPDATE users SET is_admin = true WHERE id = $1', [a.id]);
    admin = (await createSession(db, a.id)).token;
    player = (await createSession(db, p.id)).token;
  });
  afterAll(async () => { server?.close(); await db?.end(); });

  const call = (method: string, path: string, token: string, payload?: unknown) => fetch(base + path, {
    method, headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: ORIGIN, ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  it('only admins write; everyone reads what is published, newest on top', async () => {
    expect((await call('POST', '/api/admin/news', player, { tag: 'x', tone: 'gold', title: 't', body: 'b' })).status).toBe(403);
    const one = (await (await call('POST', '/api/admin/news', admin, { tag: 'Update', tone: 'purple', title: 'First', body: 'One' })).json()).news;
    const two = (await (await call('POST', '/api/admin/news', admin, { tag: 'Event', tone: 'gold', title: 'Second', body: 'Two' })).json()).news;
    await call('POST', '/api/admin/news', admin, { tag: 'Draft', tone: 'red', title: 'Hidden', body: 'Not yet', published: false });
    let home = await (await fetch(base + '/api/home')).json();
    expect(home.news.map((n: { title: string }) => n.title)).toEqual(['Second', 'First']);
    await call('POST', '/api/admin/news/order', admin, { ids: [one.id, two.id] });
    home = await (await fetch(base + '/api/home')).json();
    expect(home.news.map((n: { title: string }) => n.title)).toEqual(['First', 'Second']);
    await call('DELETE', `/api/admin/news/${one.id}`, admin);
    home = await (await fetch(base + '/api/home')).json();
    expect(home.news.map((n: { title: string }) => n.title)).toEqual(['Second']);
  });

  it('checks what it keeps', async () => {
    expect((await call('POST', '/api/admin/news', admin, { tag: 'x', tone: 'pink', title: 't', body: 'b' })).status).toBe(400);
    expect((await call('POST', '/api/admin/news', admin, { tag: 'x', tone: 'gold', title: 'x'.repeat(81), body: 'b' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/home', admin, { link: 'https://evil.example' })).status).toBe(400);
    const r = await (await call('PUT', '/api/admin/home', admin, { legend: 'Jinx, Loose Cannon', kicker: 'Update 1.4', headline: 'New season', button: 'Shop', link: '#shop' })).json();
    expect(r.home).toMatchObject({ kicker: 'Update 1.4', link: '#shop' });
    expect((await (await fetch(base + '/api/home')).json()).home.headline).toBe('New season');
  });
});
