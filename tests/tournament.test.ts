import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { upsertUser } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy } from '../server/economy.ts';
import { Online, type ServerMsg, type Transport } from '../server/games/online.ts';
import { EnginePool } from '../server/games/pool.ts';
import { Director } from '../server/tournament/director.ts';
import type { CardDb } from '../src/data/types.ts';

/*
 * A whole tournament through the director: five players sign up and pay,
 * three Swiss rounds (one bye each round), a top 4, prizes by place. In
 * every game the player listed later concedes, so the first player wins
 * everything. Needs TEST_DATABASE_URL; a schema of its own.
 */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=tournament_test')}`;

class Net implements Transport {
  starts: Extract<ServerMsg, { t: 'start' }>[] = [];
  send(userId: string, msg: ServerMsg) { if (msg.t === 'start') this.starts.push({ ...msg, gameId: `${msg.gameId}|${userId}` }); }
  online(_u?: string) { return true; }
}

describe.skipIf(!url)('tournaments', () => {
  let db: Db;
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const users: { id: string; name: string; starter: string }[] = [];

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS tournament_test CASCADE; CREATE SCHEMA tournament_test;');
    await migrate(db);
    const starters = [...catalog.starters.values()].filter((s) => s.set !== 'ogs');
    for (let i = 0; i < 5; i++) {
      const u = await upsertUser(db, { id: `70${i}`, username: `player${i + 1}` });
      await economy.grantStarter(db, catalog, u.id, starters[i].id);
      await economy.grant(db, u.id, u.id, 100, {}, 'test');
      users.push({ id: u.id, name: `player${i + 1}`, starter: starters[i].id });
    }
  });
  afterAll(async () => { await db?.end(); });

  it('runs Swiss rounds and a top cut, then pays the prizes by place', async () => {
    const net = new Net();
    const online = new Online(db, new EnginePool(0), net, Date, { autoPass: 1 });
    const director = new Director(db, online);
    const admin = users[0].id;
    await expect(director.create(admin, { name: 'x', startsAt: Date.now() - 3_600_000, settings: {} })).rejects.toThrow(/future/);
    const id = await director.create(admin, {
      name: 'Friday Cup', startsAt: Date.now() + 3_600_000,
      settings: { bestOf: 1, entryFee: 50, topCut: 4, prizes: [{ coins: 500, packs: { rad: 2 } }, { coins: 200 }] },
    });
    for (const u of users) await director.join(u.id, u.name, id, u.starter);
    await expect(director.join(users[0].id, 'again', id, users[0].starter)).rejects.toThrow(/already/);
    // one leaves and comes back: the fee goes back and is paid again
    await director.leave(users[4].id, id);
    expect((await db.query('SELECT coins FROM accounts WHERE user_id = $1', [users[4].id])).rows[0].coins).toBe(100);
    await director.join(users[4].id, users[4].name, id, users[4].starter);
    await director.start(id);

    // every game: whoever comes later in the list concedes
    const order = users.map((u) => u.id);
    const handled = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const t = (await db.query('SELECT status FROM tournaments WHERE id = $1', [id])).rows[0].status;
      if (t === 'done') break;
      for (const s of net.starts) {
        const [gameId, userId] = s.gameId.split('|');
        if (handled.has(gameId) || !online.isLive(gameId)) continue;
        const other = s.seat === 0 ? 1 : 0;
        const opponent = (await db.query('SELECT players FROM live_games WHERE id = $1', [gameId])).rows[0]?.players[other];
        if (!opponent || order.indexOf(userId) < order.indexOf(opponent)) continue;
        handled.add(gameId);
        await online.message(userId, 'x', { t: 'concede', gameId });
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const t = (await db.query('SELECT status, round, stage FROM tournaments WHERE id = $1', [id])).rows[0];
    expect(t).toMatchObject({ status: 'done', stage: 'top', round: 5 });   // 3 Swiss rounds, semifinals, final
    const byes = (await db.query('SELECT count(*)::int AS n FROM tournament_matches WHERE tournament_id = $1 AND b IS NULL', [id])).rows[0].n;
    expect(byes).toBe(3);
    const ranks = (await db.query('SELECT user_id, final_rank FROM tournament_players WHERE tournament_id = $1 ORDER BY final_rank', [id])).rows;
    expect(ranks[0].user_id).toBe(users[0].id);
    expect(ranks.map((r) => r.final_rank)).toEqual([1, 2, 3, 4, 5]);
    const coins = async (u: string) => (await db.query('SELECT coins FROM accounts WHERE user_id = $1', [u])).rows[0].coins;
    expect(await coins(users[0].id)).toBe(100 - 50 + 500);
    expect(await coins(ranks[1].user_id)).toBe(100 - 50 + 200);
    expect((await db.query('SELECT n FROM owned_packs WHERE user_id = $1 AND set_id = $2', [users[0].id, 'rad'])).rows[0].n).toBe(2);
    // the standings as the page shows them: names only, the winner on top of the Swiss table
    const d = await director.detail(id, users[0].id);
    expect(d.standings[0]).toMatchObject({ name: 'player1', me: true, points: 9 });
    expect(JSON.stringify(d)).not.toContain(users[1].id);
    director.stop(); online.stop();
  }, 60_000);

  it('a player who never comes loses the match and is dropped (TR 703.8.d)', async () => {
    const net = new Net();
    // only users[0] and users[1] are connected
    net.online = (u?: string) => u === users[0].id || u === users[1].id;
    const online = new Online(db, new EnginePool(0), net, Date, { autoPass: 1 });
    const director = new Director(db, online);
    const id = await director.create(users[0].id, { name: 'No-show Cup', startsAt: Date.now() + 1000, settings: { bestOf: 3, noShowMinutes: 1 } });
    for (const u of users.slice(0, 4)) await director.join(u.id, u.name, id, u.starter);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await director.start(id);
    await vi.advanceTimersByTimeAsync(61_000);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 200));
    const gone = (await db.query('SELECT user_id FROM tournament_players WHERE tournament_id = $1 AND dropped', [id])).rows.map((r) => r.user_id);
    expect(gone.length).toBeGreaterThan(0);
    expect(gone).not.toContain(users[0].id);
    const lost = (await db.query('SELECT a, b, wins FROM tournament_matches WHERE tournament_id = $1 AND status = $2', [id, 'done'])).rows
      .filter((m) => gone.includes(m.a) || gone.includes(m.b));
    for (const m of lost) expect(gone.includes(m.a) ? m.wins : [m.wins[1], m.wins[0]]).toEqual([0, 2]);
    await director.cancel(id);
    director.stop(); online.stop();
  });

  it('a tournament with one player is cancelled at its start and the fee comes back', async () => {
    const online = new Online(db, new EnginePool(0), new Net(), Date, { autoPass: 1 });
    const director = new Director(db, online);
    const id = await director.create(users[0].id, { name: 'Empty', startsAt: Date.now() + 1000, settings: { entryFee: 30 } });
    const before = (await db.query('SELECT coins FROM accounts WHERE user_id = $1', [users[1].id])).rows[0].coins;
    await director.join(users[1].id, 'p', id, users[1].starter);
    await director.start(id);
    expect((await db.query('SELECT status FROM tournaments WHERE id = $1', [id])).rows[0].status).toBe('cancelled');
    expect((await db.query('SELECT coins FROM accounts WHERE user_id = $1', [users[1].id])).rows[0].coins).toBe(before);
    director.stop(); online.stop();
  });
});
