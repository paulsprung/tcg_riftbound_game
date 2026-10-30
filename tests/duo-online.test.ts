import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertUser } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy } from '../server/economy.ts';
import { Online, teamClash, type ServerMsg, type Transport } from '../server/games/online.ts';
import { EnginePool } from '../server/games/pool.ts';
import type { CardDb } from '../src/data/types.ts';
import { STARTERS } from '../src/game/index.ts';

/*
 * Casual 2v2 online: four alone in the queue, two from a lobby with two
 * alone, four friends in a lobby; the teams sit alternately, each seat sees
 * its own list only, and a concession ends it for the team. Needs
 * TEST_DATABASE_URL; a schema of its own.
 */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=duo_test')}`;

class Net implements Transport {
  inbox = new Map<string, ServerMsg[]>();
  on = new Set<string>();
  send(u: string, m: ServerMsg) { (this.inbox.get(u) ?? this.inbox.set(u, []).get(u)!).push(m); }
  online(u: string) { return this.on.has(u); }
  last<T extends ServerMsg['t']>(u: string, t: T) { return (this.inbox.get(u) ?? []).filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined; }
  clear() { this.inbox.clear(); }
}

const until = async (ok: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); }
};

describe.skipIf(!url)('casual 2v2 online', () => {
  let db: Db;
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const users: string[] = [];
  const decks: string[] = [];
  let net: Net, online: Online, pool: EnginePool;

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS duo_test CASCADE; CREATE SCHEMA duo_test;');
    await migrate(db);
    // four starters that can sit together: different legends, different battlefields
    const picked: (typeof STARTERS)[number][] = [];
    for (const s of STARTERS) {
      if (catalog.starters.has(s.id) && picked.every((p) => !teamClash(p.deck, s.deck))) picked.push(s);
      if (picked.length === 4) break;
    }
    expect(picked).toHaveLength(4);
    for (const [i, s] of picked.entries()) {
      const u = await upsertUser(db, { id: `95${i}`, username: `duo${i}` });
      await economy.grantStarter(db, catalog, u.id, s.id);
      users.push(u.id); decks.push(s.id);
    }
    net = new Net();
    pool = new EnginePool(0);
    online = new Online(db, pool, net, Date, { autoPass: 1 });
    for (const u of users) net.on.add(u);
  });
  afterAll(async () => { online?.stop(); await db?.end(); });

  /** The game everyone got, checked: four seats, alternate teams, own list only. */
  const started = async (mode = 'duo') => {
    await until(() => users.every((u) => !!net.last(u, 'start')));
    const starts = users.map((u) => net.last(u, 'start')!);
    expect(new Set(starts.map((s) => s.gameId)).size).toBe(1);
    expect(starts.map((s) => s.seat).sort()).toEqual([0, 1, 2, 3]);
    for (const s of starts) {
      expect(s.mode).toBe(mode);
      expect(s.names).toHaveLength(4);
      s.decks.forEach((d, i) => expect(d.main.length > 0).toBe(i === s.seat));
    }
    return starts;
  };
  const concedeAndEnd = async (u: string, mode = 'duo') => {
    const start = net.last(u, 'start')!;
    await online.message(u, 'x', { t: 'concede', gameId: start.gameId });
    await until(() => users.every((x) => net.last(x, 'end')?.gameId === start.gameId));
    const winner = net.last(u, 'end')!.winner!;
    expect(winner % 2).not.toBe(start.seat % 2);
    const row = (await db.query('SELECT mode, players FROM matches WHERE id = $1', [start.gameId])).rows[0];
    expect(row.mode).toBe(mode);
    expect(row.players).toHaveLength(4);
  };

  it('four alone in the queue make a game; a concession loses it for the team', async () => {
    net.clear();
    for (const [i, u] of users.entries()) await online.message(u, `duo${i}`, { t: 'queue', mode: 'duo', deck: decks[i] });
    await started();
    await concedeAndEnd(users[0]);
  });

  it('two alone with the same legend are not teamed', () => {
    const s = STARTERS[0].deck;
    expect(teamClash(s, s)).toMatch(/legends/);
    expect(teamClash(s, { ...s, legend: 'x' as typeof s.legend })).toMatch(/battlefields/);
  });

  it('two from a lobby search together and sit on one team', async () => {
    net.clear();
    const [a, b, c, d] = users;
    await online.message(a, 'duo0', { t: 'lobby-invite', to: b, mode: 'casual' });
    await online.message(b, 'duo1', { t: 'lobby-answer', lobby: net.last(b, 'lobby-invite')!.lobby, accept: true });
    let lobby = net.last(a, 'lobby')!.lobby!;
    expect(lobby.max).toBe(4);
    // b joined the other team: over to a's, then decks and ready
    expect(lobby.members.find((m) => m.id === b)!.team).toBe(1);
    await online.message(b, 'duo1', { t: 'lobby-team' });
    await online.message(a, 'duo0', { t: 'lobby-deck', deck: decks[0] });
    await online.message(b, 'duo1', { t: 'lobby-deck', deck: decks[1] });
    await online.message(b, 'duo1', { t: 'lobby-ready', ready: true });
    lobby = net.last(a, 'lobby')!.lobby!;
    expect(lobby.members.every((m) => m.team === 0)).toBe(true);
    await online.message(a, 'duo0', { t: 'lobby-start' });
    expect(net.last(a, 'queued')?.mode).toBe('duo');
    expect(net.last(b, 'queued')?.mode).toBe('duo');
    // one of the party cancels: both stop searching
    await online.message(b, 'duo1', { t: 'leave' });
    expect(net.last(a, 'left')).toBeDefined();
    await online.message(a, 'duo0', { t: 'lobby-start' });
    await online.message(c, 'duo2', { t: 'queue', mode: 'duo', deck: decks[2] });
    await online.message(d, 'duo3', { t: 'queue', mode: 'duo', deck: decks[3] });
    const starts = await started();
    const seatOf = (u: string) => starts[users.indexOf(u)].seat;
    expect(seatOf(a) % 2).toBe(seatOf(b) % 2);
    await concedeAndEnd(c);
    // the lobby is back after the game
    expect(net.last(a, 'lobby')!.lobby!.inGame).toBe(false);
  });

  it('four friends in a lobby start a 2v2 at once, a friendly one (no coins to farm)', async () => {
    net.clear();
    const [a, , c, d] = users;
    for (const u of [c, d]) {
      await online.message(a, 'duo0', { t: 'lobby-invite', to: u, mode: 'casual' });
      await online.message(u, 'x', { t: 'lobby-answer', lobby: net.last(u, 'lobby-invite')!.lobby, accept: true });
    }
    let lobby = net.last(a, 'lobby')!.lobby!;
    expect(lobby.members).toHaveLength(4);
    expect(lobby.members.filter((m) => m.team === 0)).toHaveLength(2);
    for (const [i, u] of users.entries()) await online.message(u, `duo${i}`, { t: 'lobby-deck', deck: decks[i] });
    await online.message(a, 'duo0', { t: 'lobby-start' });
    expect(net.last(a, 'error')?.message).toMatch(/ready/);
    for (const u of users.slice(1)) await online.message(u, 'x', { t: 'lobby-ready', ready: true });
    lobby = net.last(a, 'lobby')!.lobby!;
    await online.message(a, 'duo0', { t: 'lobby-start' });
    const starts = await started('friendly');
    const teamOf = (u: string) => lobby.members.find((m) => m.id === u)!.team;
    for (const u of users) for (const v of users) {
      if (teamOf(u) === teamOf(v)) expect(starts[users.indexOf(u)].seat % 2).toBe(starts[users.indexOf(v)].seat % 2);
    }
    await concedeAndEnd(d, 'friendly');
  }, 30_000);
});
