/*
 * Game records (§4.9). A game is its setup (seed, decks, mode, rules) and
 * the answers given, so a record of those replays it exactly: saves,
 * resumes, the replay viewer and "Report a rules problem" files are all
 * records. Records store option keys, never list positions.
 */
import type { GameSetup } from './config.ts';
import { createGame } from './core/create.ts';
import { EngineError } from './core/errors.ts';
import type { GameEvent } from './core/events.ts';
import { choose, concede, type StepResult } from './core/run.ts';
import type { PlayerId } from './state/types.ts';
import { ENGINE_VERSION } from './version.ts';

export interface GameRecord {
  engine: string;                     // ENGINE_VERSION
  defsHash: string;                   // hash of the card definitions in effect
  setup: GameSetup;                   // seed + decks + mode + rules + first-player method
  answers: { d: number; k: string; by: PlayerId; auto?: boolean }[];   // every answer: human, AI or auto
  concede?: { p: PlayerId; afterAnswer: number };                      // after that many answers
  meta: { started: string; difficulty: string; humanSeat: PlayerId | 'hotseat'; aiKnowsList: boolean };
}

/** The record was made by another engine or card set, or doesn't fit the
    game it replays. Such a record is shown as a log, not replayed. */
export class RecordMismatchError extends EngineError {}

/**
 * Replays a record: its setup, then its answers in order (the first `until`
 * of them when given). Returns the state reached and every event on the
 * way. Throws if the record doesn't fit this engine or diverges: an answer
 * by the wrong player, to another decision, or with a key that is not an
 * option. `check` asserts the invariants after every step (tests, golden
 * replays).
 */
export function replay(r: GameRecord, o: { until?: number; check?: boolean } = {}): StepResult {
  if (r.engine !== ENGINE_VERSION) {
    throw new RecordMismatchError(`recorded with engine ${r.engine}, this is ${ENGINE_VERSION}`);
  }
  const step = { inPlace: true, check: o.check ?? false };
  const first = createGame(r.setup, { check: step.check });
  const s = first.state;
  if (s.defsHash !== r.defsHash) {
    throw new RecordMismatchError(`card definitions differ (${r.defsHash} vs ${s.defsHash})`);
  }
  const events: GameEvent[] = [...first.events];
  const until = Math.min(o.until ?? r.answers.length, r.answers.length);
  for (let i = 0; i <= until; i++) {
    if (r.concede && r.concede.afterAnswer === i) {
      events.push(...concede(s, r.concede.p, step).events);
      break;
    }
    if (i === until) break;
    const a = r.answers[i], d = s.pending;
    if (d?.player !== a.by) {
      const pending = d ? `P${d.player}'s` : 'none';
      throw new RecordMismatchError(`answer ${i} is P${a.by}'s, but the pending decision is ${pending}`);
    }
    if (d.id !== a.d || !d.options.some((op) => op.key === a.k)) {
      throw new RecordMismatchError(`answer ${i} ('${a.k}' to decision ${a.d}) doesn't fit decision ${d.id}`);
    }
    events.push(...choose(s, { decision: a.d, key: a.k }, step).events);
  }
  return { state: s, events };
}
