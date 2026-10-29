import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertUser } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy } from '../server/economy.ts';
import { Online, timeoutAnswer, type ServerMsg, type Transport } from '../server/games/online.ts';
import { EnginePool } from '../server/games/pool.ts';
import type { CardDb } from '../src/data/types.ts';
import type { PlayerView } from '../src/game/index.ts';

/*
 * Online play end to end, without sockets: two players queue, are matched,
 * play a whole game through the server's messages (each seeing only their
 * own view) and the match lands in the database with ratings and coins.
 * Needs TEST_DATABASE_URL; a schema of its own.
 */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=online_test')}`;

class Net implements Transport {
  inbox = new Map<string, ServerMsg[]>();
  on = new Set<string>();
  send(userId: string, msg: ServerMsg) { (this.inbox.get(userId) ?? this.inbox.set(userId, []).get(userId)!).push(msg); }
  online(userId: string) { return this.on.has(userId); }
  last<T extends ServerMsg['t']>(userId: string, t: T) {
    return (this.inbox.get(userId) ?? []).filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
  }
}

const until = async (ok: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); }
};

describe.skipIf(!url)('online play', () => {
  let db: Db;
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const users: string[] = [];

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS online_test CASCADE; CREATE SCHEMA online_test;');
    await migrate(db);
    // two players with a full-sized starter each (three battlefields)
    const starters = [...catalog.starters.values()].filter((s) => s.set !== 'ogs');
    for (const [i, name] of ['ann', 'ben', 'cid'].entries()) {
      const u = await upsertUser(db, { id: `90${i}`, username: name });
      await economy.grantStarter(db, catalog, u.id, starters[i].id);
      users.push(u.id);
    }
  });
  afterAll(async () => { await db?.end(); });

  it('matches two players, plays a whole game, and records the match with ratings and coins', async () => {
    const net = new Net();
    const pool = new EnginePool(1);           // a real engine thread
    const online = new Online(db, pool, net, Date, { autoPass: 1 });
    const [a, b] = users;
    const starter = async (u: string) => (await db.query('SELECT starter FROM accounts WHERE user_id = $1', [u])).rows[0].starter as string;
    net.on.add(a); net.on.add(b);
    await online.message(a, 'ann', { t: 'queue', mode: 'ranked', deck: await starter(a) });
    expect(net.last(a, 'queued')?.mode).toBe('ranked');
    await online.message(b, 'ben', { t: 'queue', mode: 'ranked', deck: await starter(b) });
    await until(() => !!net.last(a, 'start') && !!net.last(b, 'start'));
    const start = net.last(a, 'start')!;
    expect(net.last(b, 'start')!.gameId).toBe(start.gameId);
    expect(net.last(b, 'start')!.seat).toBe(1 - start.seat);

    // each player answers their own decisions from their own view only
    const seen = new Set<string>();
    const views = (u: string) => (net.inbox.get(u) ?? []).filter((m) => m.t === 'update') as Extract<ServerMsg, { t: 'update' }>[];
    let moves = 0;
    while (!net.last(a, 'end') && moves < 3000) {
      let acted = false;
      for (const u of [a, b]) {
        const v: PlayerView | undefined = views(u).at(-1)?.view;
        const d = v?.pending;
        if (!v || !d || d.player !== v.me || seen.has(`${u}:${d.id}`)) continue;
        // the other seat's hand never shows: only stubs
        const theirs = v.players[1 - v.me].hand;
        expect(theirs.every((id) => !('def' in (v.objects[id] ?? {})))).toBe(true);
        seen.add(`${u}:${d.id}`);
        // play the game out quickly: past turn 4, the first player concedes
        if (v.turn.n > 4 && u === a) { await online.message(u, 'x', { t: 'concede', gameId: start.gameId }); acted = true; break; }
        await online.message(u, 'x', { t: 'choose', gameId: start.gameId, keys: [timeoutAnswer(v) === 'pass' && d.options.some((o) => o.key.startsWith('play')) ? d.options.find((o) => !o.ui)!.key : timeoutAnswer(v)] });
        moves++; acted = true;
      }
      if (!acted) await new Promise((r) => setTimeout(r, 5));
    }
    await until(() => !!net.last(a, 'end') && !!net.last(b, 'end'));
    const endA = net.last(a, 'end')!, endB = net.last(b, 'end')!;
    expect(endA.winner).toBe(1 - start.seat);
    expect(endA.reason).toBe('concede');
    // ranked: the winner climbs, the loser drops; both get coins (the game went past turn 3)
    expect(endB.rating!.after.points).toBeGreaterThan(endB.rating!.before.points);
    expect(endA.rating!.after.points).toBeLessThan(endA.rating!.before.points);
    expect(endB.coins).toBe(20);
    expect(endA.coins).toBe(5);
    const m = (await db.query('SELECT mode, winner, reason, record FROM matches WHERE id = $1', [start.gameId])).rows[0];
    expect(m).toMatchObject({ mode: 'ranked', winner: 1 - start.seat, reason: 'concede' });
    expect(m.record.answers.length).toBeGreaterThan(10);
    expect((await db.query('SELECT count(*)::int AS n FROM live_games')).rows[0].n).toBe(0);
    const standing = await online.standing(b);
    expect(standing).toMatchObject({ games: 1, wins: 1, placement: true });
    online.stop(); await pool.close();
  }, 60_000);

  it('refuses a deck the player does not own and a turn that is not theirs; picks a game up again after a restart', async () => {
    const net = new Net();
    const pool = new EnginePool(0);
    const online = new Online(db, pool, net, Date, { autoPass: 1 });
    const [, b, c] = users;
    net.on.add(b); net.on.add(c);
    await online.message(c, 'cid', { t: 'queue', mode: 'casual', deck: 'seraphine' });
    expect(net.last(c, 'error')?.message).toMatch(/No such deck/);
    const sb = (await db.query('SELECT starter FROM accounts WHERE user_id = $1', [b])).rows[0].starter;
    const sc = (await db.query('SELECT starter FROM accounts WHERE user_id = $1', [c])).rows[0].starter;
    await online.message(b, 'ben', { t: 'queue', mode: 'casual', deck: sb });
    await online.message(c, 'cid', { t: 'queue', mode: 'casual', deck: sc });
    await until(() => !!net.last(c, 'start'));
    const gameId = net.last(c, 'start')!.gameId;
    await until(() => !!net.last(b, 'update') && !!net.last(c, 'update'));
    const waiting = [b, c].find((u) => { const v = net.last(u, 'update')!.view; return v.pending?.player !== v.me; })!;
    await online.message(waiting, 'x', { t: 'choose', gameId, keys: ['pass'] });
    expect(net.last(waiting, 'error')?.message).toMatch(/not your decision/);

    // the server goes down and comes back: the game is replayed from live_games
    await online.flush();
    online.stop();
    const net2 = new Net(); net2.on.add(b); net2.on.add(c);
    const again = new Online(db, new EnginePool(0), net2, Date, { autoPass: 1 });
    expect(await again.recover()).toBe(1);
    await again.connected(b);
    expect(net2.last(b, 'state')?.game).toBe(gameId);
    expect(net2.last(b, 'update')?.full).toBe(true);
    await again.message(b, 'ben', { t: 'concede', gameId });
    await until(() => !!net2.last(c, 'end'));
    expect(net2.last(c, 'end')!.coins).toBe(0);   // conceded on turn 1: no reward
    again.stop();
  }, 60_000);
});
