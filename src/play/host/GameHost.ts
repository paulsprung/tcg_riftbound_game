import {
  choose, cloneState, concede as concedeGame, createGame, ENGINE_VERSION, observe, replay, viewFor, type Decision,
  type GameEvent, type GameRecord, type GameSetup, type GameState, type ObservedEvent, type PlayerId, type PlayerView,
} from '../../game/index.ts';
import { rng } from '../../pack/generate.ts';
import type { AiClient } from './aiClient.ts';
import { decideNow } from './aiClient.ts';
import type { AgentReply, AgentStats, AiLevel } from './ai.worker.ts';
import { botAnswer, botPace } from './bot.ts';

/*
 * The host holds the one true game state (§12, P1). The UI never sees it:
 * it renders one seat's view, reads the events that seat observed, and
 * sends option keys, which the host applies with choose() and records.
 *
 * Seats (§12.1): a human, the computer (Beginner or Normal, §11.7, in a
 * worker through an AiClient, or on the calling thread), the simple M1.1
 * bot, or a scripted agent (a tutorial's opponent). Two human seats are
 * hot-seat: after an answer that hands the next real decision to the other
 * seat, the host raises a handoff ("pass the device") and shows that seat's
 * view only once it is taken over (host/hotseat in §12.1).
 *
 * The computer answers after a pace that depends only on the kind of
 * decision (§4.8), whatever it thinks about, so how long it takes tells the
 * human nothing. Its answers are recorded like everyone's, so the record
 * replays the game; autosave hands the record out after every answer, and
 * fromRecord() resumes a game from it (§4.9).
 *
 * One stop of §4.8 is built in: a priority decision of a human whose only
 * real option is to pass is passed for them after a short pause (the
 * record marks it `auto`).
 */

/** How long a pass-only decision of a human waits before the host passes
    for them (§4.8 stops). */
export const AUTO_PASS_MS = 450;

/** When the computer answers. Tests pass a clock that runs at once. */
export interface Clock { after(ms: number, fn: () => void): () => void }

export const realClock: Clock = {
  after(ms, fn) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export type Seat =
  | { k: 'human'; name?: string }
  | { k: 'ai'; level: AiLevel }
  | { k: 'bot' }
  /** A scripted opponent (tutorials): answers from its own view; null
      falls back to the simple bot. */
  | { k: 'script'; answer: (v: PlayerView) => string | null; name?: string };

export interface HostOptions {
  setup: GameSetup;
  /** One human against the simple bot (M1.1–M1.3); `seats` wins when given. */
  human?: PlayerId;
  seats?: Seat[];
  clock?: Clock;
  /** The computer's worker client; without one it thinks on this thread. */
  ai?: AiClient;
  /** Check the engine's invariants after every step (dev builds, tests). */
  check?: boolean;
  /** When the game started, for the record; the UI passes the time. */
  started?: string;
  /** Called with the record after every answer (autosave, §4.9). */
  onSave?: (r: GameRecord, at: SaveInfo) => void;
  /** Multiplies the computer's pace (§4.8 "fast opponent"): 1, 0.5 … */
  pace?: number;
}

/** Where the game is when it is saved: for a Resume card. */
export interface SaveInfo { turn: number; points: number[]; over: boolean }

/** What the UI renders. A new object whenever anything changes. */
export interface HostSnapshot {
  /** The view of the seat on screen. */
  view: PlayerView;
  /** Everything that seat has observed, oldest first. */
  events: ObservedEvent[];
  /** The seat on screen (hot-seat switches it). */
  viewer: PlayerId;
  /** Hot-seat: the seat the device must be passed to before its view shows. */
  handoff: PlayerId | null;
  /** A computer seat has a decision and will answer it. */
  thinking: boolean;
  error: string | null;
  /** The computer's last reasoning (DEV panel, §11.9). */
  aiStats: AgentStats | null;
  /** How the computer runs: in a worker or on this thread. */
  aiMode: 'worker' | 'local' | null;
}

/** Where a drafted batch leads (§4.7): the human's next decision in the
    same batch, or null when the draft completes the batch. */
export interface Preview { decision: Decision | null; complete: boolean }

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** What the table (GameScreen) needs of a game: this host for a game on
    the device, RemoteHost for one the server runs. */
export interface TableHost {
  readonly setup: Pick<GameSetup, 'seed' | 'decks'>;
  readonly hotseat: boolean;
  subscribe(l: () => void): () => void;
  getSnapshot(): HostSnapshot;
  start(): void;
  stop(): void;
  preview(keys: readonly string[]): Preview;
  commit(keys: readonly string[]): boolean;
  concede(p?: PlayerId): void;
  takeOver(): void;
  record(): GameRecord;
  devState(): GameState | null;
}

/** A human's decision the host answers for them (§4.8): pass when passing
    is all they can do. */
export function autoAnswer(d: Decision): string | null {
  const real = d.options.filter((o) => !o.ui);
  return d.kind === 'priority' && real.length === 1 && real[0].key === 'pass' ? 'pass' : null;
}

/** Plans (a whole Standard Move) are followed only inside the move. */
const PLAN_KINDS = ['moveUnits', 'moveDest'];

export class GameHost implements TableHost {
  readonly setup: GameSetup;
  readonly seats: Seat[];
  /** The human seat (the first, in hot-seat). */
  readonly human: PlayerId;
  readonly opponent: PlayerId;
  private state: GameState;
  private answers: GameRecord['answers'] = [];
  private conceded: GameRecord['concede'] | undefined;
  private readonly seen: ObservedEvent[][];
  private readonly clock: Clock;
  private readonly check: boolean;
  private readonly started: string;
  private readonly ai: AiClient | null;
  private readonly onSave?: (r: GameRecord, at: SaveInfo) => void;
  private paceFactor: number;
  // The bot's choices and its pacing draw from separate generators, so how
  // long it takes never shifts what it picks.
  private readonly pick: () => number;
  private readonly pace: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly plans: string[][];
  private snap: HostSnapshot;
  private error: string | null = null;
  private running = false;
  private cancel: (() => void) | null = null;
  private generation = 0;
  private viewer: PlayerId;
  private handoff: PlayerId | null = null;
  private aiStats: AgentStats | null = null;

  /** Creates the game; setup runs to the first decision. Throws when the
      decks can't start a game (the engine's SetupError). */
  constructor(o: HostOptions, resume?: { state: GameState; events: GameEvent[]; record: GameRecord }) {
    this.setup = o.setup;
    const human = o.human ?? 0;
    this.seats = o.seats ?? (human === 0 ? [{ k: 'human' }, { k: 'bot' }] : [{ k: 'bot' }, { k: 'human' }]);
    const humans = this.seats.flatMap((s, p) => (s.k === 'human' ? [p as PlayerId] : []));
    this.human = humans[0] ?? 0;
    this.opponent = other(this.human);
    this.viewer = this.human;
    // one log and one computer plan per seat: two in a Duel, four in 2v2
    this.seen = o.setup.decks.map(() => []);
    this.plans = o.setup.decks.map(() => []);
    this.clock = o.clock ?? realClock;
    this.check = o.check ?? false;
    this.started = o.started ?? '';
    this.ai = o.ai ?? null;
    this.onSave = o.onSave;
    this.paceFactor = o.pace ?? 1;
    this.pick = rng(o.setup.seed ^ 0x5eed);
    this.pace = rng(o.setup.seed ^ 0x9ace);
    if (resume) {
      this.state = resume.state;
      this.answers = resume.record.answers.slice();
      this.conceded = resume.record.concede;
      for (const p of this.seatIds()) this.seen[p].push(...observe(resume.events, p));
      const d = this.state.pending;
      if (d && this.hotseat && autoAnswer(d) === null) this.viewer = d.player;
    } else {
      const first = createGame(o.setup, { check: this.check });
      this.state = first.state;
      for (const p of this.seatIds()) this.seen[p].push(...observe(first.events, p));
    }
    this.updateHandoff();
    this.snap = this.snapshot();
  }

  /** Resumes a game from its record (an autosave): replays it to the same
      decision. Throws RecordMismatchError when the record is from another
      engine or card set. */
  static fromRecord(r: GameRecord, o: Omit<HostOptions, 'setup'>): GameHost {
    const out = replay(r);
    return new GameHost({ ...o, setup: r.setup, started: o.started ?? r.meta.started }, { state: out.state, events: out.events,
      record: r });
  }

  get hotseat(): boolean { return this.seats.every((s) => s.k === 'human'); }

  private seatIds(): PlayerId[] { return this.setup.decks.map((_, p) => p as PlayerId); }

  // ---- for React's useSyncExternalStore (host/useHost.ts) ----

  readonly subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  readonly getSnapshot = () => this.snap;

  /** Lets the computer and the stops answer (and keeps letting them). The
      UI starts the host when it shows the game and stops it when it leaves. */
  start() {
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.generation++;
    this.cancel?.();
    this.cancel = null;
  }

  // ---- the humans' answers ----

  /** The seat whose decision the UI may answer now, or null. */
  private actor(): PlayerId | null {
    const d = this.state.pending;
    if (!d || this.handoff !== null) return null;
    return this.seats[d.player].k === 'human' && d.player === this.viewer ? d.player : null;
  }

  /**
   * Where a batch draft leads, without committing it. The keys are applied
   * to a copy only while each next decision is still the human's and in the
   * same batch, where the engine guarantees that nothing is revealed and no
   * randomness used (§4.7). The decision after a completed batch is never
   * shown: it may hold what the commit reveals (the mulligan's new cards).
   */
  preview(keys: readonly string[]): Preview {
    const d0 = this.state.pending;
    const me = this.actor();
    if (!d0 || me === null) return { decision: null, complete: false };
    if (keys.length === 0) return { decision: viewFor(this.state, me).pending, complete: false };
    const s = cloneState(this.state);
    for (const [i, key] of keys.entries()) {
      const d = s.pending;
      if (!d || d.player !== me || (i > 0 && (d0.batch === undefined || d.batch !== d0.batch))) {
        throw new Error(`the draft goes past the human's batch at '${key}'`);
      }
      choose(s, { decision: d.id, key }, { inPlace: true, present: false });
    }
    const d = s.pending;
    const same = d !== null && d.player === me && d0.batch !== undefined && d.batch === d0.batch;
    return same ? { decision: viewFor(s, me).pending, complete: false } : { decision: null, complete: true };
  }

  /** Answers the human's decisions with these keys, in order (one key, or
      a whole batch). Returns false, with the error in the snapshot, when
      the engine refuses one; nothing is applied then. */
  commit(keys: readonly string[]): boolean {
    const me = this.actor();
    if (me === null) {
      this.error = 'It is not your decision.';
      this.publish();
      return false;
    }
    try {
      this.apply(keys, me);
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.publish();
      return false;
    }
  }

  /** "Fast opponent" (§4.8): scales every pace of the computer alike. */
  setPace(f: number) { this.paceFactor = f; }

  /** Hot-seat: the seat the device was passed to takes over the screen. */
  takeOver() {
    if (this.handoff === null) return;
    this.viewer = this.handoff;
    this.handoff = null;
    this.publish();
    this.schedule();
  }

  /** A player concedes [650]; the seat on screen, by default. */
  concede(p: PlayerId = this.viewer) {
    if (this.state.result) return;
    this.generation++;
    this.cancel?.();
    const r = concedeGame(this.state, p, { check: this.check });
    this.state = r.state;
    this.conceded = { p, afterAnswer: this.answers.length };
    for (const q of this.seatIds()) this.seen[q].push(...observe(r.events, q));
    this.handoff = null;
    this.save();
    this.publish();
  }

  /** The game so far as a record (§4.9): setup and every answer. */
  record(): GameRecord {
    const levels = this.seats.filter((s) => s.k !== 'human')
      .map((s) => (s.k === 'ai' ? s.level : s.k === 'bot' ? 'simple-bot' : 'script')).join('/') || 'hotseat';
    const r: GameRecord = {
      engine: ENGINE_VERSION, defsHash: this.state.defsHash, setup: this.setup, answers: this.answers.slice(),
      meta: { started: this.started, difficulty: levels, humanSeat: this.hotseat ? 'hotseat' : this.human,
        aiKnowsList: this.seats.some((s) => s.k === 'ai') },
    };
    if (this.conceded) r.concede = this.conceded;
    return r;
  }

  /** The true state, for the DEV panel's "show both hands" in dev builds only. */
  devState(): GameState | null {
    return import.meta.env.DEV ? this.state : null;
  }

  // ---- inside ----

  /** Applies keys as `by`, all or nothing. */
  private apply(keys: readonly string[], by: PlayerId, auto = false) {
    let s = this.state;
    const answers: GameRecord['answers'] = [];
    const events: GameEvent[] = [];
    for (const key of keys) {
      const d = s.pending;
      if (!d || d.player !== by) throw new Error(`P${by} has no decision to answer with '${key}'`);
      const r = choose(s, { decision: d.id, key }, { check: this.check });
      s = r.state;
      answers.push(auto ? { d: d.id, k: key, by, auto } : { d: d.id, k: key, by });
      events.push(...r.events);
    }
    this.state = s;
    this.answers.push(...answers);
    for (const p of this.seatIds()) this.seen[p].push(...observe(events, p));
    this.error = null;
    this.generation++;
    this.updateHandoff();
    this.save();
    this.publish();
    this.schedule();
  }

  private save() {
    if (!this.onSave) return;
    const s = this.state;
    const at: SaveInfo = { turn: s.turn.n, points: s.players.map((p) => p.points), over: s.result !== null };
    try { this.onSave(this.record(), at); } catch { /* storage full or blocked: play on */ }
  }

  /** Hot-seat: the next real decision belongs to the other human. */
  private updateHandoff() {
    const d = this.state.pending;
    if (!this.hotseat || !d || this.state.result) { this.handoff = null; return; }
    if (d.player !== this.viewer && autoAnswer(d) === null) this.handoff = d.player;
  }

  /** Lets the computer (or a stop) answer the pending decision after its pace. */
  private schedule() {
    this.cancel?.();
    this.cancel = null;
    const d = this.state.pending;
    if (!this.running || !d || this.state.result) return;
    const id = d.id, gen = this.generation;
    const live = () => this.running && this.generation === gen && this.state.pending?.id === id;
    const seat = this.seats[d.player];
    if (seat.k === 'human') {
      const key = autoAnswer(d);
      if (key === null) return;
      const cancel = this.clock.after(AUTO_PASS_MS, () => { if (live()) this.apply([key], d.player, true); });
      if (live()) this.cancel = cancel;
      return;
    }
    const p = d.player;
    const view = viewFor(this.state, p);
    const plan = this.plans[p];
    const planned = plan.length > 0 && PLAN_KINDS.includes(d.kind) && d.options.some((o) => o.key === plan[0] && !o.ui)
      ? plan.shift()! : null;
    if (planned === null) this.plans[p] = [];
    const ms = Math.round((planned !== null ? 180 : botPace(d.kind, this.pace)) * this.paceFactor);
    const finish = (key: string) => {
      if (!live()) return;
      try {
        if (!d.options.some((o) => o.key === key && !o.ui)) {
          throw new Error(`'${key}' is not an option of decision ${d.id}`);
        }
        this.apply([key], p);
      } catch (e) {
        this.error = `The opponent couldn't answer: ${e instanceof Error ? e.message : String(e)}`;
        this.publish();
      }
    };
    const fallback = () => botAnswer(view, this.pick);
    const take = (r: AgentReply) => {
      this.aiStats = r.stats;
      if (r.plan) this.plans[p] = r.plan.slice();
      return r.key;
    };
    if (planned !== null) {
      const cancel = this.clock.after(ms, () => finish(planned));
      if (live()) this.cancel = cancel;
      return;
    }
    if (seat.k === 'bot' || seat.k === 'script') {
      const cancel = this.clock.after(ms, () => {
        if (!live()) return;
        const key = seat.k === 'script' ? seat.answer(view) ?? fallback() : fallback();
        finish(key);
      });
      if (live()) this.cancel = cancel;
      return;
    }
    const cfg = { level: seat.level, me: p, seed: this.setup.seed, decks: this.setup.decks };
    if (!this.ai) {
      // no worker: think when the pace is up, on this thread
      const cancel = this.clock.after(ms, () => {
        if (!live()) return;
        let key: string;
        try { key = take(decideNow(cfg, view)); } catch { key = fallback(); }
        finish(key);
      });
      if (live()) this.cancel = cancel;
      return;
    }
    // a worker: think and pace at once, answer when both are done (§4.8)
    let key: string | null = null, paced = false;
    const go = () => { if (key !== null && paced) finish(key); };
    this.ai.decide(cfg, view).then((r) => { key = take(r); go(); }, () => { key = fallback(); go(); });
    const cancel = this.clock.after(ms, () => { paced = true; go(); });
    if (live()) this.cancel = cancel;
  }

  private snapshot(): HostSnapshot {
    const d = this.state.pending;
    const v = this.viewer;
    return {
      view: viewFor(this.state, v), events: this.seen[v].slice(), viewer: v, handoff: this.handoff,
      thinking: d !== null && this.seats[d.player].k !== 'human' && !this.state.result, error: this.error,
      aiStats: this.aiStats, aiMode: this.seats.some((s) => s.k === 'ai') ? this.ai?.mode ?? 'local' : null,
    };
  }

  private publish() {
    this.snap = this.snapshot();
    for (const l of this.listeners) l();
  }
}
