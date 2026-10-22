/*
 * The driver (§5.1). The game is a pure reducer (P1): choose(state, choice)
 * is the only way a game moves on, and it returns once the engine has run
 * to the next decision or the end of the game. run() steps the top frame
 * until then; with no frame left it hands over to the master loop (M1), and
 * in M0, which ends at the start of the first turn, it simply stops.
 */
import { DEFAULT_ENGINE, type EngineOptions } from '../config.ts';
import { cloneState } from '../state/clone.ts';
import { assertInvariants } from '../state/invariants.ts';
import { popFrame, pushFrame, setPending, takeEvents, takeTask } from '../state/mut.ts';
import type { GameState, PlayerId } from '../state/types.ts';
import { endGame } from './end.ts';
import { EngineError, EngineLoopError, IllegalOptionError, NotImplementedError, StaleDecisionError } from './errors.ts';
import type { GameEvent } from './events.ts';
import { masterLoop, stepFrame, taskFrame, top, type RunCtx } from './frames.ts';

export interface StepOptions {
  inPlace?: boolean;                           // mutate the given state (AI rollouts); default false = clone first
  present?: boolean;                           // build presentation events (default true; rollouts pass false)
  check?: boolean;                             // assertInvariants after the step (tests, fuzzing, dev builds)
  feasibility?: 'private' | 'direct' | 'cheap';  // §4.6; default 'private'
}
export interface StepResult { state: GameState; events: GameEvent[] }
export interface Choice { decision: number; key: string }               // must match s.pending.id

export function runCtx(o: StepOptions = {}, e: EngineOptions = DEFAULT_ENGINE): RunCtx {
  return {
    steps: 0, limit: e.stepLimit, present: o.present ?? true, check: o.check ?? false,
    feasibility: o.feasibility ?? 'private', budget: e.feasibilityBudget,
  };
}

/** Steps frames until a decision is pending, the game is over, or (M0)
    nothing is left to run. */
export function run(s: GameState, x: RunCtx): void {
  while (!s.result && !s.pending) {
    if (x.stopDepth !== undefined && s.frames.length < x.stopDepth) return;
    if (++x.steps > x.limit) throw new EngineLoopError(`run() took more than ${x.limit} steps`);
    const f = top(s);
    if (!f) {
      const loop = masterLoop();
      if (!loop) return;                                             // M0: the game rests at its first turn
      loop(s, x);
      continue;
    }
    if (f.await === 'tasks') {                                       // [354.4], [334.2.a]
      const t = takeTask(s);
      if (t) { pushFrame(s, taskFrame(s, t)); continue; }            // runs ABOVE f
      delete f.await;                                                // all tasks handled: resume f
    }
    const out = stepFrame(s, f, x);
    if (s.result) return;                                            // the game ended inside the step
    if (out === 'done') {
      if (top(s) !== f) throw new EngineError(`a '${f.f}' step returned 'done' with a frame above it`);
      popFrame(s);
    } else if (out === 'waiting' && !s.pending && !s.result) {
      throw new EngineError(`a '${f.f}' step returned 'waiting' without asking`);
    }
  }
}

/** Ends a step: hands over the events and checks the invariants if asked. */
export function finish(s: GameState, x: RunCtx): StepResult {
  const events = takeEvents(s);
  if (x.check) assertInvariants(s);
  return { state: s, events };
}

/**
 * Answers the pending decision and runs to the next one. Throws on a stale
 * decision id or a key that is not an option: the host turns that into a UI
 * error, the fuzzer into a test failure.
 */
export function choose(s0: GameState, c: Choice, o: StepOptions = {}): StepResult {
  const d = s0.pending;
  if (!d || d.id !== c.decision) throw new StaleDecisionError(c, d?.id ?? null);
  if (!d.options.some((op) => op.key === c.key)) throw new IllegalOptionError(c);
  const s = o.inPlace ? s0 : cloneState(s0);
  const f = top(s);
  if (!f) throw new EngineError(`decision ${d.id} is pending but no frame asked it`);
  f.answer = c.key;                                                  // the waiting frame reads it on its next step
  setPending(s, null);
  const x = runCtx(o);
  run(s, x);
  return finish(s, x);
}

/** A player concedes [650]; valid at any time, outside the decision system.
    In a Duel the other player wins [651.1]. */
export function concede(s0: GameState, p: PlayerId, o: StepOptions = {}): StepResult {
  if (s0.result) throw new EngineError('the game is already over');
  if (!s0.players.some((pl) => pl.id === p)) throw new EngineError(`P${p} is not in the game`);
  const rest = s0.players.filter((pl) => pl.id !== p).map((pl) => pl.id);
  if (rest.length !== 1) throw new NotImplementedError('conceding with more than two players', '[MP] removePlayer [652]');
  const s = o.inPlace ? s0 : cloneState(s0);
  const x = runCtx(o);
  endGame(s, x, { winner: rest[0], reason: 'concede', rule: '650', turn: s.turn.n });
  return finish(s, x);
}
