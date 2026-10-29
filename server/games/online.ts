import { randomInt, randomUUID } from 'node:crypto';
import { LOSS_COINS, MATCH_COINS_PER_DAY, MIN_REWARD_TURNS, WIN_COINS } from '../../src/economy/rules.ts';
import { missingCards, ownedDefs, ownPrintings } from '../../src/decks/ownership.ts';
import { STARTERS, validateDeck, type DeckList, type GameRecord, type PlayerId, type PlayerView } from '../../src/game/index.ts';
import type { Db } from '../db.ts';
import { readAccount } from '../economy.ts';
import { ladderPoints, PLACEMENT_GAMES, rate, START, tierOf, type Rating } from '../rating.ts';
import type { ClientMsg, Mode, RatingInfo, ServerMsg } from '../../src/net/protocol.ts';
import type { Answer, Update } from './engine.ts';
import type { EnginePool } from './pool.ts';

/*
 * Online play: the queues, matchmaking, the games in progress and their end.
 *
 * A game lives in an engine thread (pool.ts); this side only routes. Each
 * player gets their own view after every change, never the other's. A
 * decision has a time limit: when it runs out the server answers for the
 * player (pass, done, no, or the first option) and counts a strike; the
 * third strike concedes. A player whose last connection drops has a minute
 * to come back. A pass-only priority is passed for the player at once.
 *
 * The record so far (setup and every answer) is written to live_games every
 * few seconds, so a restart replays the games and carries on. At the end the
 * match goes to `matches` with its record, ratings move (Glicko-2, per
 * mode) and both players get coins, up to a daily limit.
 */

const MODES: Mode[] = ['ranked', 'casual'];

export const DECISION_MS = 90_000;
export const RECONNECT_MS = 60_000;
const STRIKES = 3;
const AUTO_PASS_MS = 300;
const FLUSH_MS = 3_000;
/** The rating window a queue opens with, and how much it widens each second of waiting. */
const WINDOW = 100, WIDEN = 10;

export type { ClientMsg, Mode, RatingInfo, ServerMsg };

export interface Transport { send(userId: string, msg: ServerMsg): void; online(userId: string): boolean }

interface Queued { userId: string; name: string; deck: DeckList; rating: number; since: number }

interface Live {
  id: string; mode: Mode; players: [string, string]; names: [string, string]; decks: [DeckList, DeckList];
  started: number; answers: Answer[]; setup: GameRecord['setup'];
  pending: Update['pending']; deadline: number | null; lastView: [PlayerView, PlayerView] | null;
  strikes: [number, number]; timer: ReturnType<typeof setTimeout> | null; away: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null];
  dirty: boolean; over: boolean; turn: number; busy: Promise<void>;
  /** The engine and card set the game runs on: a record replays only on the same. */
  head: { engine: string; defsHash: string };
}

export const infoOf = (x: Rating, games: number): RatingInfo => {
  const points = ladderPoints(x);
  const t = tierOf(points);
  return { points, tier: t.tier, division: t.division, games, placement: games < PLACEMENT_GAMES };
};

/** What the server answers when a player's time runs out: the safest option there is. */
export function timeoutAnswer(v: PlayerView): string {
  const real = (v.pending?.options ?? []).filter((o) => !o.ui).map((o) => o.key);
  return ['pass', 'done', 'no', 'keep'].find((k) => real.includes(k)) ?? real[0];
}

export class Online {
  private readonly queues = new Map<Mode, Queued[]>(MODES.map((m) => [m, []]));
  private readonly games = new Map<string, Live>();
  private readonly byUser = new Map<string, string>();
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly flusher: ReturnType<typeof setInterval>;

  private readonly t: { decision: number; reconnect: number; autoPass: number };

  constructor(private readonly db: Db, private readonly pool: EnginePool, private readonly net: Transport,
    private readonly clock: { now(): number } = Date, times: Partial<{ decision: number; reconnect: number; autoPass: number }> = {}) {
    this.t = { decision: DECISION_MS, reconnect: RECONNECT_MS, autoPass: AUTO_PASS_MS, ...times };
    this.ticker = setInterval(() => { void this.matchmake(); }, 1000);
    this.flusher = setInterval(() => { void this.flush(); }, FLUSH_MS);
    this.ticker.unref?.(); this.flusher.unref?.();
  }

  stop() { clearInterval(this.ticker); clearInterval(this.flusher); for (const g of this.games.values()) this.clearTimers(g); }

  get stats() { return { games: this.games.size, queued: [...this.queues.values()].reduce((n, q) => n + q.length, 0) }; }

  // ---- connections ----

  /** A player's socket opened (or another tab): tell them where they are; a game they left waits for them. */
  async connected(userId: string) {
    const gameId = this.byUser.get(userId);
    const queued = MODES.flatMap((m) => this.queues.get(m)!.filter((q) => q.userId === userId).map((q) => ({ mode: m, since: q.since })))[0] ?? null;
    this.net.send(userId, { t: 'state', queue: queued, game: gameId ?? null });
    if (!gameId) return;
    const g = this.games.get(gameId)!;
    const seat = g.players.indexOf(userId) as PlayerId;
    const t = g.away[seat];
    if (t) { clearTimeout(t); g.away[seat] = null; }
    await this.sendStart(g, seat, true);
  }

  /** Their last socket closed: out of the queue; in a game, a minute to come back. */
  disconnected(userId: string) {
    for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); }
    const gameId = this.byUser.get(userId);
    const g = gameId ? this.games.get(gameId) : undefined;
    if (!g || g.over) return;
    const seat = g.players.indexOf(userId) as PlayerId;
    g.away[seat] = setTimeout(() => { if (!this.net.online(userId)) void this.concede(g, seat); }, this.t.reconnect);
    g.away[seat].unref?.();
  }

  async message(userId: string, name: string, m: ClientMsg) {
    try {
      if (m.t === 'hello') return await this.connected(userId);
      if (m.t === 'queue') return await this.enqueue(userId, name, m.mode, m.deck);
      if (m.t === 'leave') {
        for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); }
        return this.net.send(userId, { t: 'left' });
      }
      const g = this.games.get(m.gameId);
      if (!g || !g.players.includes(userId)) throw new Error('No such game');
      const seat = g.players.indexOf(userId) as PlayerId;
      if (m.t === 'concede') return await this.concede(g, seat);
      if (m.t === 'choose') {
        if (!Array.isArray(m.keys)) throw new Error('No keys');
        return await this.answer(g, seat, m.keys.map(String), false);
      }
    } catch (err) {
      this.net.send(userId, { t: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    }
  }

  // ---- the queue ----

  /** A deck the player may bring: their starter, or a deck they built, legal and made of cards they own. */
  async deckFor(userId: string, ref: string): Promise<DeckList> {
    const account = await readAccount(this.db, userId);
    let deck: DeckList | undefined;
    if (ref.startsWith('my:')) {
      const id = ref.slice(3);
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('No such deck');
      const r = await this.db.query('SELECT body FROM decks WHERE id = $1 AND user_id = $2', [id, userId]);
      deck = r.rows[0]?.body as DeckList | undefined;
    } else if (ref === account.starter) {
      deck = STARTERS.find((s) => s.id === ref)?.deck;
    }
    if (!deck) throw new Error('No such deck');
    const errors = validateDeck(deck, 'sanctioned', { format: 'standard' }).filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(`This deck can't be played: ${errors[0].message}`);
    if (missingCards(deck, ownedDefs(account)).length) throw new Error('This deck has cards you don\'t own');
    return { ...deck, printings: ownPrintings(deck, account) };
  }

  private async rating(userId: string, mode: Mode): Promise<{ rating: Rating; games: number; wins: number }> {
    const r = await this.db.query('SELECT r, rd, vol, games, wins FROM ratings WHERE user_id = $1 AND mode = $2', [userId, mode]);
    const x = r.rows[0];
    return x ? { rating: { r: x.r, rd: x.rd, vol: x.vol }, games: x.games, wins: x.wins } : { rating: START, games: 0, wins: 0 };
  }

  private async enqueue(userId: string, name: string, mode: Mode, ref: string) {
    if (!MODES.includes(mode)) throw new Error('No such mode');
    if (this.byUser.has(userId)) throw new Error('You are in a game');
    const deck = await this.deckFor(userId, String(ref));
    for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); }
    const since = this.clock.now();
    this.queues.get(mode)!.push({ userId, name, deck, rating: (await this.rating(userId, mode)).rating.r, since });
    this.net.send(userId, { t: 'queued', mode, since });
    await this.matchmake();
  }

  /** Pairs the longest-waiting players whose ratings are close; the window widens while they wait. */
  async matchmake() {
    const now = this.clock.now();
    for (const mode of MODES) {
      const q = this.queues.get(mode)!;
      q.sort((a, b) => a.since - b.since);
      for (let i = 0; i < q.length; i++) {
        const a = q[i];
        const reach = (x: Queued) => WINDOW + WIDEN * ((now - x.since) / 1000);
        const j = q.findIndex((b, k) => k > i && Math.abs(a.rating - b.rating) <= Math.min(reach(a), reach(b)));
        if (j < 0) continue;
        const b = q[j];
        q.splice(j, 1); q.splice(i, 1); i--;
        await this.start(mode, a, b).catch((err) => console.error('match start failed:', err));
      }
    }
  }

  // ---- a game ----

  private async start(mode: Mode, a: Queued, b: Queued) {
    // who sits first is random; who plays first the engine settles (TR 407)
    const [p0, p1] = randomInt(2) === 0 ? [a, b] : [b, a];
    const id = randomUUID();
    const setup = { seed: randomInt(0, 2 ** 31), decks: [p0.deck, p1.deck] as [DeckList, DeckList] };
    const g: Live = {
      id, mode, players: [p0.userId, p1.userId], names: [p0.name, p1.name], decks: setup.decks, started: this.clock.now(),
      answers: [], setup, pending: null, deadline: null, lastView: null, strikes: [0, 0], timer: null, away: [null, null],
      dirty: true, over: false, turn: 0, busy: Promise.resolve(), head: { engine: '', defsHash: '' },
    };
    this.games.set(id, g);
    this.byUser.set(p0.userId, id); this.byUser.set(p1.userId, id);
    const u = await this.pool.engine.create(id, setup);
    const rec = await this.pool.engine.record(id);
    g.head = { engine: rec.engine, defsHash: rec.defsHash };
    await this.db.query('INSERT INTO live_games (id, mode, players, data) VALUES ($1, $2, $3, $4)', [id, mode, g.players, this.liveData(g)]);
    for (const seat of [0, 1] as const) this.net.send(g.players[seat], { t: 'start', gameId: id, seat, mode, names: g.names, decks: g.decks });
    await this.after(g, u, false);
  }

  /** The start of a game again, for a player who comes back: their view and what they saw so far. */
  private async sendStart(g: Live, seat: PlayerId, full: boolean) {
    this.net.send(g.players[seat], { t: 'start', gameId: g.id, seat, mode: g.mode, names: g.names, decks: g.decks });
    const [cur, events] = await Promise.all([this.pool.engine.current(g.id), this.pool.engine.history(g.id, seat)]);
    this.net.send(g.players[seat], { t: 'update', gameId: g.id, view: cur.seats[seat].view, events, full, ...this.deadlines(g, seat) });
  }

  private deadlines(g: Live, seat: PlayerId) {
    const mine = g.pending && g.pending.player === seat && !g.pending.passOnly ? g.deadline : null;
    const theirs = g.pending && g.pending.player !== seat && !g.pending.passOnly ? g.deadline : null;
    return { deadline: mine, theirDeadline: theirs };
  }

  /** One change at a time per game: answers that arrive together queue up. */
  private serial(g: Live, fn: () => Promise<void>) {
    g.busy = g.busy.then(fn, fn);
    return g.busy;
  }

  private answer(g: Live, seat: PlayerId, keys: string[], auto: boolean) {
    return this.serial(g, async () => {
      if (g.over) throw new Error('The game is over');
      if (!g.pending || g.pending.player !== seat) throw new Error('It is not your decision.');
      const u = await this.pool.engine.choose(g.id, seat, keys, auto);
      if (!auto) g.strikes[seat] = 0;
      await this.after(g, u, false);
    });
  }

  private concede(g: Live, seat: PlayerId) {
    return this.serial(g, async () => {
      if (g.over) return;
      const u = await this.pool.engine.concede(g.id, seat);
      await this.after(g, u, false);
    });
  }

  /** After every change: both views out, the clock for the next decision, the end. */
  private async after(g: Live, u: Update, full: boolean) {
    g.answers.push(...u.answers);
    g.dirty = g.dirty || u.answers.length > 0;
    g.pending = u.pending;
    g.turn = u.turn;
    g.lastView = [u.seats[0].view, u.seats[1].view];
    this.clearTimers(g, false);
    g.deadline = u.pending && !u.pending.passOnly ? this.clock.now() + this.t.decision : null;
    for (const seat of [0, 1] as const) {
      this.net.send(g.players[seat], { t: 'update', gameId: g.id, view: u.seats[seat].view, events: u.seats[seat].events, full, ...this.deadlines(g, seat) });
    }
    if (u.result) { await this.finish(g, u); return; }
    const p = u.pending;
    if (!p) return;
    if (p.passOnly) {
      g.timer = setTimeout(() => { void this.answer(g, p.player, ['pass'], true).catch(() => undefined); }, this.t.autoPass);
    } else {
      g.timer = setTimeout(() => { void this.timeout(g, p.player, p.id); }, this.t.decision);
    }
    g.timer.unref?.();
  }

  private async timeout(g: Live, seat: PlayerId, decision: number) {
    if (g.over || g.pending?.id !== decision || !g.lastView) return;
    g.strikes[seat]++;
    if (g.strikes[seat] >= STRIKES) { await this.concede(g, seat); return; }
    await this.answer(g, seat, [timeoutAnswer(g.lastView[seat])], true).catch(() => undefined);
  }

  private clearTimers(g: Live, away = true) {
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
    if (away) for (const s of [0, 1] as const) { const t = g.away[s]; if (t) clearTimeout(t); g.away[s] = null; }
  }

  private liveData(g: Live) {
    return JSON.stringify({ ...g.head, setup: g.setup, answers: g.answers, names: g.names, started: g.started, strikes: g.strikes });
  }

  /** The records so far into live_games, for the games that changed. */
  async flush() {
    for (const g of this.games.values()) {
      if (!g.dirty || g.over) continue;
      g.dirty = false;
      await this.db.query('UPDATE live_games SET data = $2, updated_at = now() WHERE id = $1', [g.id, this.liveData(g)]).catch(() => { g.dirty = true; });
    }
  }

  /** After a restart: every game in live_games replayed and going again; clocks start fresh. */
  async recover() {
    const r = await this.db.query('SELECT id, mode, players, data FROM live_games');
    for (const row of r.rows) {
      const d = row.data as { engine: string; defsHash: string; setup: GameRecord['setup']; answers: Answer[]; names: [string, string]; started: number; strikes?: [number, number] };
      const g: Live = {
        id: row.id, mode: row.mode, players: row.players, names: d.names, decks: d.setup.decks as [DeckList, DeckList], started: d.started,
        answers: d.answers.slice(), setup: d.setup, pending: null, deadline: null, lastView: null, strikes: d.strikes ?? [0, 0], timer: null,
        away: [null, null], dirty: false, over: false, turn: 0, busy: Promise.resolve(), head: { engine: d.engine, defsHash: d.defsHash },
      };
      try {
        // an update of the engine or the cards in between: the record no longer replays, and the game is dropped
        const u = await this.pool.engine.resume(g.id, {
          engine: d.engine, defsHash: d.defsHash, setup: d.setup, answers: d.answers,
          meta: { started: '', difficulty: 'online', humanSeat: 'hotseat', aiKnowsList: false },
        } as GameRecord);
        this.games.set(g.id, g);
        for (const p of g.players) this.byUser.set(p, g.id);
        // the restart is nobody's fault: whoever is not back within the minute concedes
        for (const seat of [0, 1] as const) if (!this.net.online(g.players[seat])) this.disconnected(g.players[seat]);
        await this.after(g, { ...u, answers: [] }, true);
      } catch (err) {
        console.error(`live game ${g.id} could not be resumed, dropped:`, err instanceof Error ? err.message : err);
        await this.db.query('DELETE FROM live_games WHERE id = $1', [g.id]);
      }
    }
    return this.games.size;
  }

  // ---- the end ----

  private async finish(g: Live, u: Update) {
    if (g.over) return;
    g.over = true;
    this.clearTimers(g);
    const res = u.result!;
    const record = await this.pool.engine.record(g.id, u.conceded);
    const rewarded = res.turn >= MIN_REWARD_TURNS;
    const c = await this.db.connect();
    const outcome: { coins: [number, number]; rating: [{ before: RatingInfo; after: RatingInfo } | null, { before: RatingInfo; after: RatingInfo } | null] } = { coins: [0, 0], rating: [null, null] };
    try {
      await c.query('BEGIN');
      // ratings: both players' rows locked in a fixed order, so two games ending at once can't deadlock
      const order = [0, 1].sort((x, y) => (g.players[x] < g.players[y] ? -1 : 1)) as PlayerId[];
      const before: Record<number, { rating: Rating; games: number; wins: number }> = {};
      for (const s of order) {
        await c.query('INSERT INTO ratings (user_id, mode) VALUES ($1, $2) ON CONFLICT DO NOTHING', [g.players[s], g.mode]);
        const x = (await c.query('SELECT r, rd, vol, games, wins FROM ratings WHERE user_id = $1 AND mode = $2 FOR UPDATE', [g.players[s], g.mode])).rows[0];
        before[s] = { rating: { r: x.r, rd: x.rd, vol: x.vol }, games: x.games, wins: x.wins };
      }
      for (const s of [0, 1] as const) {
        const score = res.winner === null ? 0.5 : res.winner === s ? 1 : 0;
        const me = before[s], opp = before[1 - s];
        const next = rate(me.rating, opp.rating, score as 0 | 0.5 | 1);
        await c.query('UPDATE ratings SET r = $3, rd = $4, vol = $5, games = games + 1, wins = wins + $6 WHERE user_id = $1 AND mode = $2',
          [g.players[s], g.mode, next.r, next.rd, next.vol, score === 1 ? 1 : 0]);
        if (g.mode === 'ranked') outcome.rating[s] = { before: infoOf(me.rating, me.games), after: infoOf(next, me.games + 1) };
        // coins, up to the daily limit
        if (rewarded) {
          await c.query('INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [g.players[s]]);
          await c.query('SELECT 1 FROM accounts WHERE user_id = $1 FOR UPDATE', [g.players[s]]);
          const today = (await c.query(`SELECT coalesce(sum(coins), 0)::int AS n FROM ledger WHERE user_id = $1 AND reason LIKE 'match %'
            AND created_at > now() - interval '1 day'`, [g.players[s]])).rows[0].n as number;
          const coins = Math.max(0, Math.min(score === 1 ? WIN_COINS : LOSS_COINS, MATCH_COINS_PER_DAY - today));
          if (coins > 0) {
            await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [g.players[s], coins]);
            await c.query('INSERT INTO ledger (user_id, coins, reason) VALUES ($1, $2, $3)', [g.players[s], coins, `match ${score === 1 ? 'win' : 'played'} ${g.id}`]);
          }
          outcome.coins[s] = coins;
        }
      }
      await c.query(`INSERT INTO matches (id, mode, players, winner, reason, turns, started_at, record, outcome)
        VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9)`,
      [g.id, g.mode, g.players, res.winner, res.reason, res.turn, g.started, JSON.stringify(record), JSON.stringify(outcome)]);
      await c.query('DELETE FROM live_games WHERE id = $1', [g.id]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      console.error(`match ${g.id} could not be saved:`, err);
    } finally {
      c.release();
    }
    for (const s of [0, 1] as const) {
      this.net.send(g.players[s], { t: 'end', gameId: g.id, winner: res.winner, reason: res.reason, coins: outcome.coins[s], rating: outcome.rating[s] });
      if (this.byUser.get(g.players[s]) === g.id) this.byUser.delete(g.players[s]);
    }
    this.games.delete(g.id);
    await this.pool.engine.drop(g.id);
  }

  /** A player's ranked standing, for the Play page. */
  async standing(userId: string, mode: Mode = 'ranked'): Promise<RatingInfo & { wins: number }> {
    const x = await this.rating(userId, mode);
    return { ...infoOf(x.rating, x.games), wins: x.wins };
  }
}
