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

  it('a lobby as in the League client: invite, join, pick a deck, ready up, the host starts; back in the lobby after', async () => {
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
    const lobbyOf = (u: string) => net.last(u, 'lobby')?.lobby;

    await online.message(ann, 'ann', { t: 'lobby-invite', to: cid, mode: 'custom' });
    expect(net.last(ann, 'error')?.message).toMatch(/Only friends/);
    await online.message(ann, 'ann', { t: 'lobby-invite', to: ben, mode: 'custom' });
    const inv = net.last(ben, 'lobby-invite')!;
    expect(inv).toMatchObject({ mode: 'custom', from: { id: ann, name: 'ann' } });
    expect(lobbyOf(ann)?.invited).toEqual([{ id: ben, name: 'ben' }]);
    await online.message(ben, 'ben', { t: 'lobby-answer', lobby: inv.lobby, accept: true });
    expect(lobbyOf(ann)?.members.map((m) => [m.name, m.host, m.ready])).toEqual([['ann', true, false], ['ben', false, false]]);

    // ready needs a deck; ready locks the deck; the host starts only when all are ready
    await online.message(ben, 'ben', { t: 'lobby-ready', ready: true });
    expect(net.last(ben, 'error')?.message).toMatch(/Pick a deck/);
    await online.message(ann, 'ann', { t: 'lobby-deck', deck: await st(ann) });
    await online.message(ben, 'ben', { t: 'lobby-deck', deck: await st(ben) });
    await online.message(ann, 'ann', { t: 'lobby-start' });
    expect(net.last(ann, 'error')?.message).toMatch(/Not everyone is ready/);
    await online.message(ben, 'ben', { t: 'lobby-ready', ready: true });
    await online.message(ben, 'ben', { t: 'lobby-deck', deck: await st(ben) });
    expect(net.last(ben, 'error')?.message).toMatch(/Not ready first/);
    await online.message(ben, 'ben', { t: 'lobby-start' });
    expect(net.last(ben, 'error')?.message).toMatch(/Only the host/);
    await online.message(ann, 'ann', { t: 'lobby-start' });
    const start = net.last(ann, 'start')!;
    expect(start.mode).toBe('friendly');
    expect(online.presence(ann)).toBe('game');

    await online.message(ann, 'ann', { t: 'concede', gameId: start.gameId });
    await new Promise((r) => setTimeout(r, 50));
    expect(net.last(ben, 'end')).toMatchObject({ coins: 0, rating: null });
    expect((await db.query('SELECT count(*)::int AS n FROM ratings')).rows[0].n).toBe(0);
    // back in the lobby, nobody ready
    expect(lobbyOf(ben)).toMatchObject({ inGame: false });
    expect(lobbyOf(ben)!.members.every((m) => !m.ready)).toBe(true);

    // the host leaves: ben leads; ben leaves: the lobby is gone
    await online.message(ann, 'ann', { t: 'lobby-leave' });
    expect(lobbyOf(ann)).toBeNull();
    expect(lobbyOf(ben)?.members).toEqual([expect.objectContaining({ name: 'ben', host: true })]);
    await online.message(ben, 'ben', { t: 'lobby-leave' });
    expect(lobbyOf(ben)).toBeNull();
    online.stop();
  });
});
