/*
 * Frames: how a rules procedure pauses for a decision and picks up again.
 *
 * A procedure that can stop to ask something is written as a frame (plain
 * data in state.frames: a tag, a program counter, locals) plus a step table
 * in code, registered here under the frame's tag. The driver (core/run.ts)
 * runs the top frame's current step until a decision is pending or the
 * game is over. A step function returns
 *
 *   'continue'  run the top frame again (this one at its new pc, or a child
 *               it pushed),
 *   'waiting'   it asked a decision (ask() returned it),
 *   'done'      pop this frame; the one below resumes at its own pc.
 *
 * Gather, then commit (§3.10): a step reads the state and asks; it changes
 * the state only once it has every answer it needs, so running a step again
 * after its answer arrives never repeats a change.
 *
 *   defineSteps('setup', [
 *     (s, f, x) => { ...; return next(f); },                    // pc 0
 *     (s, f, x) => {                                            // pc 1
 *       const key = answer(f);
 *       if (key === undefined) return ask(s, f, x, { ... });    // the driver stops here
 *       ...commit the answer through state/mut.ts...
 *       return next(f);
 *     },
 *     () => 'done',
 *   ]);
 *
 * Procedures register themselves when their module is imported; the list
 * of those modules is src/game/procedures.ts.
 */
import type { GameSetup } from '../config.ts';
import { countDecision, mint, pushFrame, setPending } from '../state/mut.ts';
import type { Frame, FrameTag, GameState, Json, Task } from '../state/types.ts';
import { autoKey, canonical, checkOptions, stubOf, type AskSpec, type Decision, type Option } from './decisions.ts';
import { endGame } from './end.ts';
import { EngineError } from './errors.ts';
import { emit } from './events.ts';

export type StepOut = 'continue' | 'waiting' | 'done';

/** What one run of the driver carries besides the state. */
export interface RunCtx {
  steps: number;                 // frame steps taken so far in this run
  limit: number;                 // EngineOptions.stepLimit
  present: boolean;              // build presentation events (StepOptions.present)
  check: boolean;                // assertInvariants after the step
  feasibility: 'private' | 'direct' | 'cheap';   // §4.6 (M1)
  budget: number;                // feasibility nodes per decision (M1)
}

export type FrameOf<K extends FrameTag> = Extract<Frame, { f: K }>;
export type StepFn<F extends Frame = Frame> = (s: GameState, f: F, x: RunCtx) => StepOut;
/** Steps indexed by the frame's pc, read top to bottom like the rules. */
export type StepTable<F extends Frame> = readonly StepFn<F>[];
/** A frame kind's code: one function for the whole frame, or a table. */
export type FrameProc<F extends Frame> = StepFn<F> | StepTable<F>;

/** Builds the game from its setup: creates the objects and pushes the
    setup frame (rules/setup.ts). */
export type StartFn = (s: GameState, setup: GameSetup, x: RunCtx) => void;
/** What runs when no frame is active: the HOT FEPR master loop (§5.2, M1). */
export type LoopFn = (s: GameState, x: RunCtx) => void;

const PROCS: { [K in FrameTag]?: FrameProc<FrameOf<K>> } = {};
let start: StartFn | null = null;
let loop: LoopFn | null = null;

function once(what: string, taken: boolean, o: { replace?: boolean }) {
  if (taken && !o.replace) throw new EngineError(`${what} is defined twice`);
}

/** Registers the code for one kind of frame. `replace` is for tests. */
export function defineSteps<K extends FrameTag>(tag: K, proc: FrameProc<FrameOf<K>>, o: { replace?: boolean } = {}) {
  once(`the '${tag}' frame`, PROCS[tag] !== undefined, o);
  (PROCS as Record<string, unknown>)[tag] = proc;
}

export function defineStart(fn: StartFn, o: { replace?: boolean } = {}) {
  once('the setup procedure', start !== null, o);
  start = fn;
}

/** Registers the master loop. Tests of the setup alone pass null with
    `replace`, so a game rests once its frames run out, as it did in M0. */
export function defineLoop(fn: LoopFn | null, o: { replace?: boolean } = {}) {
  once('the master loop', loop !== null, o);
  loop = fn;
}

export const startProcedure = () => start;
export const masterLoop = () => loop;

/** Runs the current step of a frame. */
export function stepFrame(s: GameState, f: Frame, x: RunCtx): StepOut {
  const proc = PROCS[f.f] as FrameProc<Frame> | undefined;
  if (!proc) throw new EngineError(`no steps for '${f.f}' frames: is its module listed in src/game/procedures.ts?`);
  if (typeof proc === 'function') return proc(s, f, x);
  const pc = 'pc' in f ? f.pc : 0;
  const fn = proc[pc];
  if (!fn) throw new EngineError(`'${f.f}' frame has no step ${pc}`);
  return fn(s, f, x);
}

// ---- helpers for step functions ----

export const top = (s: GameState): Frame | undefined => s.frames[s.frames.length - 1];

type Counted = Frame & { pc: number };

/** Go on with the next step. */
export function next(f: Counted): StepOut {
  f.pc++;
  return 'continue';
}

export function goto(f: Counted, pc: number): StepOut {
  f.pc = pc;
  return 'continue';
}

/** The answer to the decision this frame asked, read once; undefined when
    nothing was answered yet. */
export function answer(f: Frame): string | undefined {
  const key = f.answer;
  if (key !== undefined) delete f.answer;
  return key;
}

/**
 * Wait for every outstanding task to be handled before the next step
 * (§5.1, fix F2): the driver runs each task in a frame above this one, FIFO
 * [333], and resumes this frame at its next step when none is left. Used by
 * a play after its step 1 [354.4] and an ability after its step 1 [400].
 */
export function awaitTasks(f: Counted): StepOut {
  f.await = 'tasks';
  return next(f);
}

/** Runs a child frame; this frame resumes at its next step when the child
    is done, and finds what the child handed back with takeRet(). */
export function call(s: GameState, f: Counted, child: Frame): StepOut {
  f.pc++;
  pushFrame(s, child);
  return 'continue';
}

/** Finishes the top frame, handing a value to the frame below. */
export function ret(s: GameState, f: Frame, value: Json): StepOut {
  if (top(s) !== f) throw new EngineError('ret() must come from the top frame');
  const parent = s.frames[s.frames.length - 2];
  if (!parent) throw new EngineError('ret() with no frame to return to');
  parent.ret = value;
  return 'done';
}

export function takeRet(f: Frame): Json | undefined {
  const v = f.ret;
  if (v !== undefined) delete f.ret;
  return v;
}

/**
 * Asks a decision from frame f, which must be the top frame (§5.1). Puts
 * the options in canonical order and checks them; answers a public
 * single-option decision on the spot (the step runs again and finds the
 * answer); otherwise makes the decision pending, tells everyone that it
 * exists (a 'deciding' event with its public stub) and returns 'waiting'.
 * Return what it returns.
 */
export function ask(s: GameState, f: Frame, x: RunCtx, spec: AskSpec): StepOut {
  if (top(s) !== f) throw new EngineError('ask() must come from the top frame');
  if (s.pending) throw new EngineError(`ask(): decision ${s.pending.id} is still pending`);
  const extra: Option[] = spec.back && !spec.options.some((o) => o.key === 'back') ? [{ key: 'back', ui: true }] : [];
  const options = canonical([...spec.options, ...extra]);
  checkOptions(options, `${spec.kind} [${spec.ctx.rule}]`);
  // M1: the feasibility filter of §4.6 (core/feasible.ts) narrows the options here, before the auto-apply check.
  const auto = autoKey(spec, options);
  if (auto !== null) {
    f.answer = auto;
    return 'continue';
  }
  const d: Decision = {
    id: mint(s, 'decision'), player: spec.player, kind: spec.kind, prompt: spec.prompt, options, ctx: spec.ctx,
    privateOptions: spec.privateOptions,
  };
  if (spec.batch !== undefined) d.batch = spec.batch;
  if (spec.back) d.back = true;
  if (spec.mustAsk) d.mustAsk = true;
  setPending(s, structuredClone(d));
  emit(s, x, { k: 'deciding', stub: stubOf(d), rule: spec.ctx.rule });
  if (countDecision(s) > s.rules.turnDecisionCap) {
    endGame(s, x, { winner: null, reason: 'loop', rule: 'turnDecisionCap (§8)', turn: s.turn.n });
  }
  return 'waiting';
}

/** The frame that handles an outstanding task. */
export function taskFrame(s: GameState, t: Task): Frame {
  switch (t.t) {
    case 'cleanup': return { f: 'cleanup', v: t.v, pc: 0, epoch0: s.epoch };
    case 'placeTriggers': return { f: 'triggers', batch: structuredClone(t.batch), placed: [], pc: 0, order: t.order };
    default: return { f: 'task', task: structuredClone(t), pc: 0, locals: null };
  }
}
