/*
 * The modules that define rules procedures: each registers its frame steps
 * (defineSteps), the setup (defineStart) or the master loop (defineLoop) in
 * core/frames.ts when it is imported. Importing this file loads them all.
 * createGame() imports it, and so must anything else that runs games
 * without going through createGame (the AI worker, tests of a procedure).
 *
 * One line per procedure module, as it lands:
 *
 *   import './rules/setup.ts';      // M0: setup to the first turn [110–118]
 *   import './core/loop.ts';        // M1: the master loop (§5.2)
 */
import './rules/setup.ts';
import './rules/tasks.ts';
import './rules/turn.ts';
import './rules/cleanup.ts';
import './rules/combat.ts';
import './rules/assignment.ts';
import './rules/move.ts';
import './abilities/triggers.ts';
import './play/pay.ts';
import './play/playCard.ts';
import './play/playAbility.ts';
import './dsl/interp.ts';
import './core/feasible.ts';
import './core/loop.ts';

