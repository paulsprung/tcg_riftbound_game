import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE, upsertUser } from '../server/auth.ts';
import type { Config } from '../server/config.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy } from '../server/economy.ts';
import { handler } from '../server/http.ts';
import type { CardDb } from '../src/data/types.ts';
import { DAILY_COINS, PACK_PRICE } from '../src/economy/rules.ts';

/*
 * The server-side economy against a real Postgres (TEST_DATABASE_URL); skipped
 * without one. It works in a schema of its own, wiped first, so it can run
 * beside tests/server.test.ts. Sessions are made directly, Discord is not
 * involved.
 */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=economy_test')}`;
const ORIGIN = 'https://rift.example';

describe.skipIf(!url)('server economy', () => {
  let db: Db, server: Server, base = '';
  let alice = '', bob = '', aliceId = '', bobId = '';
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const cfg: Config = {
    port: 0, publicUrl: ORIGIN, databaseUrl: url ?? '', discordClientId: 'cid', discordClientSecret: 'secret', staticDir: 'dist', trustProxy: true,
  };

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS economy_test CASCADE; CREATE SCHEMA economy_test;');
    await migrate(db);
    server = createServer(handler({ cfg, db, catalog }));
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const a = await upsertUser(db, { id: '111', username: 'alice' });
    const b = await upsertUser(db, { id: '222', username: 'bob' });
    aliceId = a.id; bobId = b.id;
    alice = (await createSession(db, a.id)).token;
    bob = (await createSession(db, b.id)).token;
  });
  afterAll(async () => { server?.close(); await db?.end(); });

  const call = (method: string, path: string, token: string, payload?: unknown, origin = ORIGIN) => fetch(base + path, {
    method, headers: { cookie: `${SESSION_COOKIE}=${token}`, origin, ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  it('needs a session, and changes come from the site only', async () => {
    expect((await fetch(base + '/api/account')).status).toBe(401);
    expect((await call('POST', '/api/account/daily', alice, undefined, 'https://evil.example')).status).toBe(403);
  });

  it('a new account is empty; the starter deck comes once, with its booster', async () => {
    const fresh = await (await call('GET', '/api/account', alice)).json();
    expect(fresh.account).toMatchObject({ coins: 0, starter: null, tutorialDone: false, cards: {}, packs: {} });
    expect(fresh.admin).toBe(false);
    const starter = [...catalog.starters.values()][0];
    const r = await (await call('POST', '/api/account/starter', alice, { id: starter.id })).json();
    expect(r.account.starter).toBe(starter.id);
    expect(Object.values(r.account.cards).reduce((n: number, o) => n + (o as { normal: number }).normal, 0)).toBe(starter.size);
    expect(r.account.packs[starter.booster]).toBe(1);
    expect((await call('POST', '/api/account/starter', alice, { id: starter.id })).status).toBe(400);
  });

  it('the daily coins once a day, the tutorial packs once', async () => {
    const d = await (await call('POST', '/api/account/daily', alice)).json();
    expect(d.account.coins).toBe(DAILY_COINS);
    expect((await call('POST', '/api/account/daily', alice)).status).toBe(400);
    const t1 = await (await call('POST', '/api/account/tutorial', alice)).json();
    const t2 = await (await call('POST', '/api/account/tutorial', alice)).json();
    expect([t1.granted, t2.granted]).toEqual([true, false]);
    expect(t2.account.packs.ogn).toBeGreaterThanOrEqual(1);
  });

  it('buying needs the coins; ten requests at once cannot spend them twice', async () => {
    expect((await call('POST', '/api/account/buy', alice, { setId: 'ogn', n: Math.floor(DAILY_COINS / PACK_PRICE) + 1 })).status).toBe(400);
    await economy.grant(db, aliceId, aliceId, PACK_PRICE * 3, {}, 'test');
    const all = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/account/buy', alice, { setId: 'rad', n: 1 })));
    // the daily coins and the grant, spent pack by pack
    const n = Math.floor((DAILY_COINS + PACK_PRICE * 3) / PACK_PRICE);
    expect(all.filter((r) => r.ok)).toHaveLength(n);
    const acc = (await (await call('GET', '/api/account', alice)).json()).account;
    expect(acc.coins).toBe(DAILY_COINS + PACK_PRICE * 3 - PACK_PRICE * n);
    expect(acc.packs.rad).toBe(1 + n);
    const spent = await db.query("SELECT sum(coins)::int AS s FROM ledger WHERE user_id = $1 AND reason = 'buy packs'", [aliceId]);
    expect(spent.rows[0].s).toBe(-PACK_PRICE * n);
  });

  it('opening a pack takes it from the inventory and puts its cards in the collection', async () => {
    const before = (await (await call('GET', '/api/account', alice)).json()).account;
    const r = await (await call('POST', '/api/account/open', alice, { setId: 'rad' })).json();
    expect(r.pulls.length).toBeGreaterThanOrEqual(12);
    expect(r.account.packs.rad).toBe(before.packs.rad - 1);
    expect(r.account.packsOpened.rad).toBe(1);
    const count = (acc: { cards: Record<string, { normal: number; foil: number }> }) =>
      Object.values(acc.cards).reduce((n, o) => n + o.normal + o.foil, 0);
    expect(count(r.account) - count(before)).toBe(r.pulls.length);
    expect((await call('POST', '/api/account/open', bob, { setId: 'rad' })).status).toBe(400);
  });

  it('grades only a raw copy you have, and the showcase only holds what you own', async () => {
    const acc = (await (await call('GET', '/api/account', alice)).json()).account;
    const [cardId] = Object.entries(acc.cards).find(([, o]) => (o as { normal: number }).normal > 0)!;
    const g = await (await call('POST', '/api/account/grade', alice, { cardId, foil: false })).json();
    expect(g.slab.cardId).toBe(cardId);
    expect(g.account.slabs[0].cert).toBe(g.slab.cert);
    expect((await call('POST', '/api/account/grade', bob, { cardId, foil: false })).status).toBe(400);
    // a name from the object prototype is no card anyone owns, and leaves the prototype alone
    for (const name of ['__proto__', 'constructor', 'toString']) {
      expect((await call('POST', '/api/account/grade', bob, { cardId: name, foil: false })).status).toBe(400);
    }
    expect(([] as unknown[])[0]).toBeUndefined();
    const ok = await call('PUT', '/api/account/showcase', alice, { items: [{ kind: 'slab', cert: g.slab.cert }] });
    expect((await ok.json()).account.showcase).toEqual([{ kind: 'slab', cert: g.slab.cert }]);
    expect((await call('PUT', '/api/account/showcase', bob, { items: [{ kind: 'slab', cert: g.slab.cert }] })).status).toBe(400);
  });

  it('keeps decks per player; another player cannot overwrite one', async () => {
    const id = '0b6f3c1e-8d2a-4f7b-9c3d-2e1f0a9b8c7d';
    const deck = { name: 'Mine', legend: 'annie-dark-child', chosenChampion: '', main: [{ def: 'annie-fiery', n: 2 }], runes: [], battlefields: [] };
    expect((await call('PUT', `/api/decks/${id}`, alice, { deck })).status).toBe(200);
    expect((await call('PUT', `/api/decks/${id}`, bob, { deck: { ...deck, name: 'Stolen' } })).status).toBe(404);
    expect((await call('PUT', `/api/decks/${id}`, alice, { deck: { ...deck, main: 'x' } })).status).toBe(400);
    const list = (await (await call('GET', '/api/account', alice)).json()).decks;
    expect(list.map((d: { body: { name: string } }) => d.body.name)).toEqual(['Mine']);
    await call('DELETE', `/api/decks/${id}`, alice);
    expect((await (await call('GET', '/api/account', alice)).json()).decks).toEqual([]);
  });

  it('admin grants are for admins and land in the ledger with who gave them', async () => {
    expect((await call('POST', '/api/admin/grant', bob, { userId: aliceId, coins: 5, reason: 'x' })).status).toBe(403);
    await db.query('UPDATE users SET is_admin = true WHERE id = $1', [bobId]);
    const r = await call('POST', '/api/admin/grant', bob, { userId: aliceId, coins: 500, packs: { ven: 2 }, reason: 'found a bug' });
    expect(r.status).toBe(200);
    const row = (await db.query('SELECT coins, packs, reason, actor FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [aliceId])).rows[0];
    expect(row).toMatchObject({ coins: 500, packs: { ven: 2 }, reason: 'admin: found a bug', actor: bobId });
    const users = await (await call('GET', '/api/admin/users?q=ali', bob)).json();
    expect(users.users.map((u: { name: string }) => u.name)).toEqual(['alice']);
    expect((await call('POST', '/api/admin/grant', bob, { userId: aliceId, coins: 5, reason: '' })).status).toBe(400);
  });
});
