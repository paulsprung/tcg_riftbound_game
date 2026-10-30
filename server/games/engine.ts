import {
  choose, concede as concedeGame, createGame, ENGINE_VERSION, observe, replay, viewFor, type GameEvent, type GameRecord, type GameSetup,
  type GameState, type ObservedEvent, type PlayerId, type PlayerView,
} from '../../src/game/index.ts';

/*
 * The games one engine thread holds (server/games/worker.ts runs this in a
 * worker; tests call it directly). The true state never leaves it: each
 * player gets their own view and the events they observed, as the table in
 * the browser renders them (play/host/GameHost.ts does the same for a game
 * on one device).
 */

export type Answer = GameRecord['answers'][number];

/** What one player is sent after a change. */
export interface SeatUpdate { view: PlayerView; events: ObservedEvent[] }

export interface Update {
  gameId: string;
  seats: SeatUpdate[];
  /** Whose decision is pending, and whether it is a pass-only priority (answered for them). */
  pending: { player: PlayerId; id: number; passOnly: boolean } | null;
  result: GameState['result'];
  turn: number;
  /** Who plays first this game, once settled. */
  first: PlayerId | null;
  points: number[];
  /** Answers given in this change, for the record the server keeps. */
  answers: Answer[];
  conceded?: GameRecord['concede'];
}

interface Game { state: GameState; answers: Answer[]; setup: GameSetup }

const passOnly = (s: GameState) => {
  const d = s.pending;
  if (!d || d.kind !== 'priority') return false;
  const real = d.options.filter((o) => !o.ui);
  return real.length === 1 && real[0].key === 'pass';
};

export class Engine {
  private games = new Map<string, Game>();

  get size() { return this.games.size; }

  private update(gameId: string, g: Game, events: GameEvent[], answers: Answer[]): Update {
    const s = g.state;
    const seat = (p: PlayerId): SeatUpdate => ({ view: viewFor(s, p), events: observe(events, p) });
    return {
      gameId, seats: s.players.map((p) => seat(p.id)),
      pending: s.pending && !s.result ? { player: s.pending.player, id: s.pending.id, passOnly: passOnly(s) } : null,
      result: s.result, turn: s.turn.n, first: s.turn.firstPlayer ?? null, points: s.players.map((p) => p.points), answers,
    };
  }

  create(gameId: string, setup: GameSetup): Update {
    const first = createGame(setup);
    const g: Game = { state: first.state, answers: [], setup };
    this.games.set(gameId, g);
    return this.update(gameId, g, first.events, []);
  }

  /** A game back from its record (after a restart): every event again, so each seat can rebuild its log. */
  resume(gameId: string, record: GameRecord): Update {
    const out = replay(record);
    const g: Game = { state: out.state, answers: record.answers.slice(), setup: record.setup };
    this.games.set(gameId, g);
    return this.update(gameId, g, out.events, []);
  }

  /** `by` answers their decisions with these keys, in order; all or nothing. */
  choose(gameId: string, by: PlayerId, keys: string[], auto = false): Update {
    const g = this.need(gameId);
    if (keys.length === 0 || keys.length > 40) throw new Error('no keys');
    let s = g.state;
    const events: GameEvent[] = [];
    const answers: Answer[] = [];
    for (const key of keys) {
      const d = s.pending;
      if (!d || d.player !== by || s.result) throw new Error('It is not your decision.');
      if (typeof key !== 'string' || !d.options.some((o) => o.key === key)) throw new Error(`'${String(key)}' is not an option`);
      const r = choose(s, { decision: d.id, key });
      s = r.state;
      events.push(...r.events);
      answers.push(auto ? { d: d.id, k: key, by, auto } : { d: d.id, k: key, by });
    }
    g.state = s;
    g.answers.push(...answers);
    return this.update(gameId, g, events, answers);
  }

  concede(gameId: string, by: PlayerId): Update {
    const g = this.need(gameId);
    if (g.state.result) return this.update(gameId, g, [], []);
    const r = concedeGame(g.state, by);
    g.state = r.state;
    const u = this.update(gameId, g, r.events, []);
    u.conceded = { p: by, afterAnswer: g.answers.length };
    return u;
  }

  /** A seat's view now, for a player who reconnects (their log comes from the record replay). */
  current(gameId: string): Update {
    const g = this.need(gameId);
    return this.update(gameId, g, [], []);
  }

  /** Everything `p` has observed so far, for a player who reloads the page. */
  history(gameId: string, p: PlayerId): ObservedEvent[] {
    return observe(replay(this.record(gameId)).events, p);
  }

  /** The game as a record: setup and every answer, what replays it. */
  record(gameId: string, conceded?: GameRecord['concede']): GameRecord {
    const g = this.need(gameId);
    const r: GameRecord = {
      engine: ENGINE_VERSION, defsHash: g.state.defsHash, setup: g.setup, answers: g.answers.slice(),
      meta: { started: '', difficulty: 'online', humanSeat: 'hotseat', aiKnowsList: false },
    };
    if (conceded) r.concede = conceded;
    return r;
  }

  drop(gameId: string) { this.games.delete(gameId); }

  private need(gameId: string): Game {
    const g = this.games.get(gameId);
    if (!g) throw new Error('No such game');
    return g;
  }
}
