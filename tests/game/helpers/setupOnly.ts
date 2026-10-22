import { defineLoop } from '../../../src/game/core/frames.ts';
import '../../../src/game/procedures.ts';

/*
 * Imported first by the tests of setup alone (M0): it takes the master loop
 * away, so a game rests once setup is over [118], as it did before the turn
 * structure existed. Vitest gives every test file its own module registry,
 * so this touches only the file that imports it.
 */
defineLoop(null, { replace: true });
