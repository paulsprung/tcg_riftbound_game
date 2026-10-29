import {
  choose, determinize, ENGINE_VERSION, viewFor, type DeckList, type GameRecord, type GameState, type ObservedEvent, type PlayerId, type PlayerView,
} from '../../game/index.ts';
import { online } from '../../net/socket.ts';
import type { ServerMsg } from '../../net/protocol.ts';
import { rng } from '../../pack/generate.ts';
import type { HostSnapshot, Preview, TableHost } from './GameHost.ts';

/*
 * A game the server runs (server/games/online.ts), for the same table as a
 * game on the device. The true state is on the server; this holds the
 * seat's view and the events it observed, as the server sends them, and
 * sends the answers back.
 *
 * A batch draft (§4.7) is previewed here, without asking the server: the
 * view is completed with a sample of the hidden cards (both lists are open,
 * TR 401.5) and the keys applied to it. Inside a batch nothing hidden is
 * revealed and no randomness is used, so the next decision is the same
 * whatever the sample holds.
 */

export interface OnlineClock { mine: number | null; theirs: number | null }

export class RemoteHost implements TableHost {
  readonly hotseat = false;
  readonly setup: { seed: number; decks: [DeckList, DeckList] };
  readonly seat: PlayerId;
  readonly gameId: string;
  private view: PlayerView | null = null;
  private events: ObservedEvent[] = [];
  private error: string | null = null;
  private sent: number | null = null;
  private clock: OnlineClock = { mine: null, theirs: null };
  private snap: HostSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private off: (() => void) | null = null;

  constructor(start: Extract<ServerMsg, { t: 'start' }>) {
    this.gameId = start.gameId;
    this.seat = start.seat;
    this.setup = { seed: 0, decks: start.decks };
  }

  /** The time left on the pending decision, mine or the opponent's. */
  get deadlines(): OnlineClock { return this.clock; }
  get ready() { return this.view !== null; }

  readonly subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  readonly getSnapshot = (): HostSnapshot => this.snap!;

  start() {
    if (this.off) return;
    this.off = online.listen((m) => {
      if (m.t === 'update' && m.gameId === this.gameId) {
        this.view = m.view;
        this.events = m.full ? m.events.slice() : [...this.events, ...m.events];
        this.clock = { mine: m.deadline, theirs: m.theirDeadline };
        this.sent = null;
        this.error = null;
        this.publish();
      } else if (m.t === 'error' && this.sent !== null) {
        this.sent = null;
        this.error = m.message;
        this.publish();
      }
    });
  }

  stop() { this.off?.(); this.off = null; }

  preview(keys: readonly string[]): Preview {
    const v = this.view;
    const d0 = v?.pending;
    if (!v || !d0 || d0.player !== this.seat) return { decision: null, complete: false };
    if (keys.length === 0) return { decision: d0, complete: false };
    const s: GameState = determinize(v, this.setup.decks, rng(d0.id * 7919 + 1));
    for (const [i, key] of keys.entries()) {
      const d = s.pending;
      if (!d || d.player !== this.seat || (i > 0 && (d0.batch === undefined || d.batch !== d0.batch))) {
        throw new Error(`the draft goes past the batch at '${key}'`);
      }
      choose(s, { decision: d.id, key }, { inPlace: true, present: false });
    }
    const d = s.pending;
    const same = d !== null && d.player === this.seat && d0.batch !== undefined && d.batch === d0.batch;
    return same ? { decision: viewFor(s, this.seat).pending, complete: false } : { decision: null, complete: true };
  }

  commit(keys: readonly string[]): boolean {
    const d = this.view?.pending;
    if (!d || d.player !== this.seat || this.sent === d.id) {
      this.error = this.sent === d?.id ? null : 'It is not your decision.';
      this.publish();
      return false;
    }
    if (!online.send({ t: 'choose', gameId: this.gameId, keys: [...keys] })) return false;
    this.sent = d.id;
    this.publish();
    return true;
  }

  concede() { online.send({ t: 'concede', gameId: this.gameId }); }
  takeOver() { /* one seat per device online */ }
  devState() { return null; }

  /** What a report can carry: the lists and this seat's answers are not known here; the server keeps the record. */
  record(): GameRecord {
    return {
      engine: ENGINE_VERSION, defsHash: this.view?.defsHash ?? '', setup: { seed: 0, decks: this.setup.decks }, answers: [],
      meta: { started: '', difficulty: `online ${this.gameId}`, humanSeat: this.seat, aiKnowsList: false },
    } as GameRecord;
  }

  private publish() {
    const v = this.view;
    if (!v) return;
    const d = v.pending;
    this.snap = {
      view: v, events: this.events, viewer: this.seat, handoff: null,
      // the opponent is deciding, or our answer is on its way
      thinking: (d === null && v.opponentDecision !== null && v.result === null) || this.sent !== null,
      error: this.error, aiStats: null, aiMode: null,
    };
    for (const l of this.listeners) l();
  }
}
