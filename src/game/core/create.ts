/*
 * Starting a game: an empty state from the setup's seed, mode and rules,
 * then the setup procedure (rules/setup.ts, registered with defineStart),
 * run to the first decision [110–118]. The AI never imports this module:
 * it only gets states by determinizing its view (§2.2, §11.3).
 */
import '../procedures.ts';
import { DUEL, rulesFor, type GameSetup } from '../config.ts';
import { blankState } from '../state/blank.ts';
import { NotImplementedError } from './errors.ts';
import { emit } from './events.ts';
import { startProcedure } from './frames.ts';
import { finish, run, runCtx, type StepOptions, type StepResult } from './run.ts';

/** Creates a game and runs its setup until the first decision. */
export function createGame(setup: GameSetup, o: StepOptions = {}): StepResult {
  const start = startProcedure();
  if (!start) {
    throw new NotImplementedError('the setup procedure', 'rules/setup.ts, listed in src/game/procedures.ts');
  }
  const s = blankState({ seed: setup.seed, mode: setup.mode ?? DUEL, rules: rulesFor(setup) });
  const x = runCtx(o);
  emit(s, x, { k: 'gameStart', rule: '110' });
  start(s, setup, x);
  run(s, x);
  return finish(s, x);
}
