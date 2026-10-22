import {
  choose, cloneState, createGame, ENGINE_VERSION, observe, viewFor, type Decision, type GameEvent, type GameRecord,
  type GameSetup, type GameState, type ObservedEvent, type PlayerId, type PlayerView,
} from '../../game/index.ts';
import { rng } from '../../pack/generate.ts';
import { botAnswer, botPace } from './bot.ts';

/*
 * The host holds the one true game state (§12, P1). The UI never sees it:
 * it renders the human's view, reads the events the human observed, and
 * sends option keys, which the host applies with choose() and records.
 * The computer opponent gets its own view, answers after a pace that
 * depends only on the kind of decision (§4.8), and its answers are
 * recorded the same way, so the record replays the game.
 *
 * M1.1–M1.2 seat one human against a simple bot (host/bot.ts). One stop of
 * §4.8 is built in: a priority decision of the human's whose only real
 * option is to pass is passed for them after a short pause (the record
 * marks it `auto`), so a showdown in which they can do nothing doesn't wait
 * for a click. The AI worker, the other stops, autosave and hot-seat
 * arrive with M1.4–M3.
 */

/** How long a pass-only decision of the human's waits before the host
    passes for them (§4.8 stops). */
export const AUTO_PASS_MS = 450;

/** When the bot answers. Tests pass a clock that runs at once. */
export interface Clock { after(ms: number, fn: () => void): () => void }

export const realClock: Clock = {
  after(ms, fn) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export interface HostOptions {
  setup: GameSetup;
  human: PlayerId;
  clock?: Clock;
  /** Check the engine's invariants after every step (dev builds, tests). */
  check?: boolean;
  /** When the game started, for the record; the UI passes the time. */
  started?: string;
}

/** What the UI renders. A new object whenever anything changes. */
export interface HostSnapshot {
  view: PlayerView;
  /** Everything the human has observed, oldest first. */
  events: ObservedEvent[];
  /** The opponent has a decision and will answer it. */
  thinking: boolean;
  error: string | null;
}

/** Where a drafted batch leads (§4.7): the human's next decision in the
    same batch, or null when the draft completes the batch. */
export interface Preview { decision: Decision | null; complete: boolean }

export class GameHost {
  readonly setup: GameSetup;
  readonly human: PlayerId;
  readonly opponent: PlayerId;
  private state: GameState;
  private readonly answers: GameRecord['answers'] = [];
  private readonly seen: ObservedEvent[] = [];
  private readonly clock: Clock;
  private readonly check: boolean;
  private readonly started: string;
  // The bot's choices and its pacing draw from separate generators, so how
  // long it takes never shifts what it picks.
  private readonly pick: () => number;
  private readonly pace: () => number;
  private readonly listeners = new Set<() => void>();
  private snap: HostSnapshot;
  private error: string | null = null;
  private running = false;
  private cancel: (() => void) | null = null;

  /** Creates the game; setup runs to the first decision. Throws when the
      decks can't start a game (the engine's SetupError). */
  constructor(o: HostOptions) {
    this.setup = o.setup;
    this.human = o.human;
    this.opponent = o.human === 0 ? 1 : 0;
    this.clock = o.clock ?? realClock;
    this.check = o.check ?? false;
    this.started = o.started ?? '';
    this.pick = rng(o.setup.seed ^ 0x5eed);
    this.pace = rng(o.setup.seed ^ 0x9ace);
    const first = createGame(o.setup, { check: this.check });
    this.state = first.state;
    this.seen.push(...observe(first.events, this.human));
    this.snap = this.snapshot();
  }

  // ---- for React's useSyncExternalStore (host/useHost.ts) ----

  readonly subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  readonly getSnapshot = () => this.snap;

  /** Lets the opponent answer (and keeps letting it). The UI starts the
      host when it shows the game and stops it when it leaves. */
  start() {
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.cancel?.();
    this.cancel = null;
  }

  // ---- the human's answers ----

  /**
   * Where a batch draft leads, without committing it. The keys are applied
   * to a copy only while each next decision is still the human's and in the
   * same batch, where the engine guarantees that nothing is revealed and no
   * randomness used (§4.7). The decision after a completed batch is never
   * shown: it may hold what the commit reveals (the mulligan's new cards).
   */
  preview(keys: readonly string[]): Preview {
    const d0 = this.state.pending;
    if (!d0 || d0.player !== this.human) return { decision: null, complete: false };
    if (keys.length === 0) return { decision: viewFor(this.state, this.human).pending, complete: false };
    const s = cloneState(this.state);
    for (const [i, key] of keys.entries()) {
      const d = s.pending;
      if (!d || d.player !== this.human || (i > 0 && (d0.batch === undefined || d.batch !== d0.batch))) {
        throw new Error(`the draft goes past the human's batch at '${key}'`);
      }
      choose(s, { decision: d.id, key }, { inPlace: true, present: false });
    }
    const d = s.pending;
    const same = d !== null && d.player === this.human && d0.batch !== undefined && d.batch === d0.batch;
    return same ? { decision: viewFor(s, this.human).pending, complete: false } : { decision: null, complete: true };
  }

  /** Answers the human's decisions with these keys, in order (one key, or
      a whole batch). Returns false, with the error in the snapshot, when
      the engine refuses one; nothing is applied then. */
  commit(keys: readonly string[]): boolean {
    try {
      this.apply(keys, this.human);
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.publish();
      return false;
    }
  }

  /** The game so far as a record (§4.9): setup and every answer. */
  record(): GameRecord {
    return {
      engine: ENGINE_VERSION, defsHash: this.state.defsHash, setup: this.setup, answers: this.answers.slice(),
      meta: { started: this.started, difficulty: 'simple-bot', humanSeat: this.human, aiKnowsList: false },
    };
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
    this.seen.push(...observe(events, this.human));
    this.error = null;
    this.publish();
    this.schedule();
  }

  /** Lets the opponent answer its pending decision after its pace. */
  private schedule() {
    this.cancel?.();
    this.cancel = null;
    const d = this.state.pending;
    if (!this.running || !d) return;
    const id = d.id;
    if (d.player === this.human) {
      const real = d.options.filter((o) => !o.ui);
      if (d.kind !== 'priority' || real.length !== 1 || real[0].key !== 'pass') return;
      const cancel = this.clock.after(AUTO_PASS_MS, () => {
        if (!this.running || this.state.pending?.id !== id) return;
        this.apply(['pass'], this.human, true);
      });
      if (this.state.pending?.id === id) this.cancel = cancel;
      return;
    }
    const cancel = this.clock.after(botPace(d.kind, this.pace), () => {
      if (!this.running || this.state.pending?.id !== id) return;
      try {
        this.apply([botAnswer(viewFor(this.state, this.opponent), this.pick)], this.opponent);
      } catch (e) {
        this.error = `The opponent couldn't answer: ${e instanceof Error ? e.message : String(e)}`;
        this.publish();
      }
    });
    if (this.state.pending?.id === id) this.cancel = cancel;   // not answered already by a clock that runs at once
  }

  private snapshot(): HostSnapshot {
    const d = this.state.pending;
    return {
      view: viewFor(this.state, this.human), events: this.seen.slice(),
      thinking: d !== null && d.player === this.opponent && !this.state.result, error: this.error,
    };
  }

  private publish() {
    this.snap = this.snapshot();
    for (const l of this.listeners) l();
  }
}
