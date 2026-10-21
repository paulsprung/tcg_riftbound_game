import {
  choose, createGame, type Decision, type GameSetup, type GameState, type StepResult,
} from '../../../src/game/index.ts';
import { mulberry32 } from '../../../src/game/state/rng.ts';
import { EVELYNN, SERAPHINE } from './decks.ts';

/* Playing setups out: a game between the two precons, and a driver that
   answers every decision and keeps each position on the way. */

export const duel = (seed: number, o: Partial<GameSetup> = {}): GameSetup => ({ seed, decks: [SERAPHINE, EVELYNN], ...o });

/** Picks an answer; `n` counts the decisions answered so far. */
export type Picker = (d: Decision, n: number) => string;

/** A seeded random picker over the real (non-UI) options. */
export function randomPicker(seed: number): Picker {
  let r = seed >>> 0;
  return (d) => {
    const step = mulberry32(r);
    r = step.next;
    const real = d.options.filter((o) => !o.ui);
    return real[Math.floor(step.value * real.length)].key;
  };
}

/** Answers keys in order: 'first', then each player's mulligan picks. */
export function scripted(keys: (string | ((d: Decision) => string))[]): Picker {
  return (d, n) => {
    const k = keys[n];
    if (k === undefined) throw new Error(`no scripted answer for decision ${n} (${d.kind})`);
    return typeof k === 'string' ? k : k(d);
  };
}

/** One answered decision: the state that asked it, the answer and what came of it. */
export interface Step { before: GameState; key: string; decision: Decision; after: StepResult }

export interface PlayedOut { start: StepResult; steps: Step[]; end: GameState }

/** Creates the game and answers until nothing is pending (the end of setup). */
export function playOut(setup: GameSetup, pick: Picker, o: { roundTrip?: boolean } = {}): PlayedOut {
  const start = createGame(setup, { check: true });
  const steps: Step[] = [];
  let s = start.state;
  for (;;) {
    if (o.roundTrip) s = JSON.parse(JSON.stringify(s)) as GameState;
    const decision = s.pending;
    if (!decision) break;
    const key = pick(decision, steps.length);
    const after = choose(s, { decision: decision.id, key }, { check: true });
    steps.push({ before: s, key, decision, after });
    s = after.state;
  }
  return { start, steps, end: s };
}

/** Every position at rest: the created game and the state after each answer. */
export const positions = (g: PlayedOut): GameState[] => [g.start.state, ...g.steps.map((st) => st.after.state)];
