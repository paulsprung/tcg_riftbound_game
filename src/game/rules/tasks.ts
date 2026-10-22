/*
 * Outstanding Tasks (Spec C §6.1, [332–336]): what must be done before
 * anything else goes on. The queue is FIFO [333]; the master loop handles
 * it first (the H of HOT FEPR [334]) and the driver runs it above a frame
 * that waits for tasks (§5.1). Each task runs in a frame of its own: a
 * cleanup in a 'cleanup' frame (rules/cleanup.ts), every other task in a
 * 'task' frame whose steps are registered here by the module that owns it
 * (phase tasks in rules/turn.ts, combat steps in rules/combat.ts).
 *
 * This module imports no other rules module, so every rules module can
 * register its tasks at import time.
 */
import { defineSteps, type FrameOf, type StepTable } from '../core/frames.ts';
import { EngineError } from '../core/errors.ts';
import { append, setField } from '../state/mut.ts';
import type { GameState, Task } from '../state/types.ts';

export type TaskFrame = FrameOf<'task'>;

const PROCS: Record<string, StepTable<TaskFrame>> = {};

/** The registry key of a task: its phase-task id, 'combat.<id>', or its kind. */
export const taskKey = (t: Task): string => (t.t === 'phase' ? t.id : t.t === 'combat' ? `combat.${t.id}` : t.t);

/** Registers the steps of one kind of task. */
export function defineTask(key: string, steps: StepTable<TaskFrame>) {
  if (PROCS[key]) throw new EngineError(`the task '${key}' is defined twice`);
  PROCS[key] = steps;
}

defineSteps('task', (s, f, x) => {
  const key = taskKey(f.task);
  const steps = PROCS[key];
  if (!steps) throw new EngineError(`no steps for the task '${key}': is its module listed in src/game/procedures.ts?`);
  const fn = steps[f.pc];
  if (!fn) throw new EngineError(`the task '${key}' has no step ${f.pc}`);
  return fn(s, f, x);
});

/** Makes tasks outstanding, after the ones already waiting [333]. */
export function enqueue(s: GameState, ...tasks: Task[]) {
  append(s, s.turn.tasks, ...tasks);
}

/** Makes tasks outstanding ahead of every other: a cleanup's repetition
    runs immediately after it [322], the combat cleanup right after the
    damage [467.3]. */
export function enqueueFront(s: GameState, ...tasks: Task[]) {
  setField(s, s.turn, 'tasks', [...tasks, ...s.turn.tasks]);
}

/**
 * A Cleanup becomes outstanding [319]. While a cleanup runs or an item
 * resolves none can start, so the request is noted and honoured when that
 * ends [321.1], [322]. A normal cleanup already waiting covers it: cleanups
 * are idempotent (Spec C Q9).
 */
export function requestCleanup(s: GameState) {
  if (s.turn.inCleanup || s.turn.resolving !== null) {
    setField(s, s.turn, 'cleanupRequested', true);
    return;
  }
  if (s.turn.tasks.some((t) => t.t === 'cleanup' && t.v === 'normal')) return;
  enqueue(s, { t: 'cleanup', v: 'normal' });
}
