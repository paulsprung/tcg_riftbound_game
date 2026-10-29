import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertUser } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom } from '../server/economy.ts';
import { Online, type ServerMsg, type Transport } from '../server/games/online.ts';
import { EnginePool } from '../server/games/pool.ts';
import { LimitedService } from '../server/limited.ts';
import { Director } from '../server/tournament/director.ts';
import type { CardDb } from '../src/data/types.ts';

/*
 * Limited play through the server: a casual Sealed pool to a game, a casual
 * draft against seven computer seats, a Sealed and a Draft tournament from
 * the pools to their first round. Needs TEST_DATABASE_URL; a schema of its own.
 */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=limited_test')}`;

class Net implements Transport {
  inbox = new Map<string, ServerMsg[]>();
  send(u: string, m: ServerMsg) { (this.inbox.get(u) ?? this.inbox.set(u, []).get(u)!).push(m); }
  online() { return true; }
  last<T extends ServerMsg['t']>(u: string, t: T) { return (this.inbox.get(u) ?? []).filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined; }
}

describe.skipIf(!url)('Limited play on the server', () => {
  let db: Db;
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const users: string[] = [];
  let limited: LimitedService;

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS limited_test CASCADE; CREATE SCHEMA limited_test;');
    await migrate(db);
    for (let i = 0; i < 4; i++) users.push((await upsertUser(db, { id: `60${i}`, username: `lim${i}` })).id);
    limited = new LimitedService(db, async () => catalog);
  });
  afterAll(async () => { await db?.end(); });

  it('a casual Sealed pool: a first deck, a deck checked against the pool, a game in the sealed queue', async () => {
    const [a, b] = users;
    await expect(limited.start(a, 'cube', 'ogn')).rejects.toThrow(/Sealed or Draft/);
    const pa = await limited.start(a, 'sealed', 'ogn');
    const pb = await limited.start(b, 'sealed', 'ogn');
    expect(pa.cards.length).toBeGreaterThanOrEqual(72);
    expect(pa.deck).not.toBeNull();
    // a card the pool doesn't hold is refused
    await expect(limited.saveDeck(a, pa.id, { ...pa.deck, main: [...pa.deck!.main, { def: 'jinx-loose-cannon', n: 9 }] })).rejects.toThrow();
    await limited.saveDeck(a, pa.id, pa.deck);
    const net = new Net();
    const online = new Online(db, new EnginePool(0), net, Date, { autoPass: 1 });
    online.limited = limited;
    await online.message(a, 'a', { t: 'queue', mode: 'sealed', deck: `limited:${pa.id}` });
    await online.message(b, 'b', { t: 'queue', mode: 'draft', deck: `limited:${pb.id}` });
    expect(net.last(b, 'error')?.message).toMatch(/sealed/);
    await online.message(b, 'b', { t: 'queue', mode: 'sealed', deck: `limited:${pb.id}` });
    const start = net.last(a, 'start')!;
    expect(start.mode).toBe('sealed');
    await online.message(a, 'a', { t: 'concede', gameId: start.gameId });
    await new Promise((r) => setTimeout(r, 50));
    expect(net.last(b, 'end')?.winner).not.toBeNull();
    online.stop();
  });

  it('a casual draft: one pick at a time, the computer seats with it, 39 cards', async () => {
    const u = users[2];
    let p = await limited.start(u, 'draft', 'sfd');
    expect(p.draft?.pack.length).toBeGreaterThan(10);
    await expect(limited.pick(u, p.id, 'not-a-card')).rejects.toThrow(/not in the pack/);
    while (p.draft) p = await limited.pick(u, p.id, p.draft.pack[0]);
    expect(p.cards).toHaveLength(39);
    expect(p.deck?.main.reduce((t, e) => t + e.n, 0)).toBeGreaterThanOrEqual(20);
    expect((await limited.current(u))?.id).toBe(p.id);
  });

  it('a Sealed and a Draft tournament: pools, a draft on the clock, the build, the first round', async () => {
    const net = new Net();
    const online = new Online(db, new EnginePool(0), net, Date, { autoPass: 1 });
    online.limited = limited;
    let clock = Date.now();
    const director = new Director(db, online, limited, () => clock);
    const admin = users[0];
    await expect(director.create(admin, { name: 'x', startsAt: clock + 60_000, settings: { format: 'sealed' } })).rejects.toThrow(/set/);

    // Sealed: pools at the start, the build until everyone is ready
    const s = await director.create(admin, { name: 'Sealed night', startsAt: clock + 60_000, settings: { format: 'sealed', setId: 'ogn' } });
    for (const u of users.slice(0, 2)) await director.join(u, u, s, '');
    await director.start(s);
    let pool = await director.poolOf(users[0], s);
    expect(pool.status).toBe('building');
    expect(pool.cards.length).toBeGreaterThanOrEqual(72);
    await director.saveDeck(users[0], s, pool.deck);
    for (const u of users.slice(0, 2)) await director.ready(u, s);
    expect((await director.detail(s, users[0])).status).toBe('running');
    expect(net.last(users[0], 'start')?.mode).toBe('tournament');

    // Draft: three players and five computer seats; the clock picks for a player out of time
    const d = await director.create(admin, { name: 'Draft night', startsAt: clock + 60_000, settings: { format: 'draft', setId: 'unl', pickSeconds: 15 } });
    for (const u of users.slice(1, 4)) await director.join(u, u, d, '');
    await director.start(d);
    pool = await director.poolOf(users[1], d);
    expect(pool.status).toBe('drafting');
    const first = pool.draft!.pack[0];
    pool = await director.pick(users[1], d, first);
    expect(pool.draft?.picks).toEqual([first]);
    await expect(director.pick(users[1], d, pool.draft!.pack[0] ?? 'x')).rejects.toThrow();
    // nobody else picks: each tick past the deadline picks for them
    for (let i = 0; i < 60 && (await director.poolOf(users[1], d)).status === 'drafting'; i++) {
      clock += 16_000;
      await director.tick();
    }
    pool = await director.poolOf(users[1], d);
    expect(pool.status).toBe('building');
    expect(pool.cards).toHaveLength(39);
    expect(pool.cards[0]).toBe(first);
    // the build time ends: the rounds start with everyone's deck
    clock += 21 * 60_000;
    await director.tick();
    expect((await director.detail(d, users[1])).status).toBe('running');
    director.stop(); online.stop();
  }, 60_000);
});
