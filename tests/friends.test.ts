import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertUser } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy } from '../server/economy.ts';
import { friendCode, friends } from '../server/friends.ts';
import { Online, type ServerMsg, type Transport } from '../server/games/online.ts';
import { EnginePool } from '../server/games/pool.ts';
import type { CardDb } from '../src/data/types.ts';

/* Friends and friendly games against a real Postgres (TEST_DATABASE_URL); a schema of its own. */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=friends_test')}`;

class Net implements Transport {
  inbox = new Map<string, ServerMsg[]>();
  on = new Set<string>();
  send(u: string, m: ServerMsg) { (this.inbox.get(u) ?? this.inbox.set(u, []).get(u)!).push(m); }
  online(u: string) { return this.on.has(u); }
  last<T extends ServerMsg['t']>(u: string, t: T) { return (this.inbox.get(u) ?? []).filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined; }
}

describe.skipIf(!url)('friends', () => {
  let db: Db, ann = '', ben = '', cid = '';
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS friends_test CASCADE; CREATE SCHEMA friends_test;');
    await migrate(db);
    const starters = [...catalog.starters.values()].filter((s) => s.set !== 'ogs');
    [ann, ben, cid] = await Promise.all(['ann', 'ben', 'cid'].map(async (n, i) => (await upsertUser(db, { id: `80${i}`, username: n })).id));
    for (const [i, u] of [ann, ben, cid].entries()) await economy.grantStarter(db, catalog, u, starters[i].id);
  });
  afterAll(async () => { await db?.end(); });

  it('a code sends a request; the other accepts; entering each other\'s code makes friends at once', async () => {
    const benCode = await friendCode(db, ben);
    expect(benCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(await friendCode(db, ben)).toBe(benCode);
    await expect(friends.add(db, ann, 'XXXX')).rejects.toThrow(/8 letters/);
    await expect(friends.add(db, ann, await friendCode(db, ann))).rejects.toThrow(/own code/);
    expect(await friends.add(db, ann, `${benCode.slice(0, 4)}-${benCode.slice(4).toLowerCase()}`)).toMatchObject({ name: 'ben', accepted: false });
    await expect(friends.add(db, ann, benCode)).rejects.toThrow(/already sent/);
    const presence = () => 'offline' as const;
    expect((await friends.list(db, ben, presence)).incoming.map((x) => x.name)).toEqual(['ann']);
    await friends.accept(db, ben, ann);
    expect((await friends.list(db, ann, presence)).friends).toEqual([expect.objectContaining({ name: 'ben', presence: 'offline' })]);
    // cid asks ann, ann enters cid's code: that accepts
    await friends.add(db, cid, await friendCode(db, ann));
    expect((await friends.add(db, ann, await friendCode(db, cid))).accepted).toBe(true);
    expect(await friends.areFriends(db, ann, cid)).toBe(true);
    await friends.remove(db, ann, cid);
    expect(await friends.areFriends(db, ann, cid)).toBe(false);
  });

  it('friends see each other\'s presence and can play a friendly game, without rating or coins', async () => {
    const net = new Net();
    const online = new Online(db, new EnginePool(0), net, Date, { autoPass: 1 });
    online.areFriends = (a, b) => friends.areFriends(db, a, b);
    const told: string[] = [];
    online.onPresence((u) => told.push(u));
    net.on.add(ann); net.on.add(ben);
    await online.connected(ann);
    expect(told).toContain(ann);
    expect(online.presence(ben)).toBe('online');
    expect(online.presence(cid)).toBe('offline');
    const st = async (u: string) => (await db.query('SELECT starter FROM accounts WHERE user_id = $1', [u])).rows[0].starter as string;

    await online.message(ann, 'ann', { t: 'challenge', to: cid, deck: await st(ann) });
    expect(net.last(ann, 'error')?.message).toMatch(/Only friends/);
    await online.message(ann, 'ann', { t: 'challenge', to: ben, deck: await st(ann) });
    expect(net.last(ben, 'challenge')?.from).toEqual({ id: ann, name: 'ann' });
    await online.message(ben, 'ben', { t: 'challenge-answer', from: ann, accept: true, deck: await st(ben) });
    const start = net.last(ann, 'start')!;
    expect(start.mode).toBe('friendly');
    expect(online.presence(ann)).toBe('game');
    await online.message(ann, 'ann', { t: 'concede', gameId: start.gameId });
    await new Promise((r) => setTimeout(r, 50));
    expect(net.last(ben, 'end')).toMatchObject({ coins: 0, rating: null });
    expect((await db.query('SELECT count(*)::int AS n FROM ratings')).rows[0].n).toBe(0);

    // a declined challenge tells both
    await online.message(ann, 'ann', { t: 'challenge', to: ben, deck: await st(ann) });
    await online.message(ben, 'ben', { t: 'challenge-answer', from: ann, accept: false });
    expect(net.last(ann, 'challenge-gone')).toMatchObject({ with: ben, why: 'declined' });
    online.stop();
  });
});
