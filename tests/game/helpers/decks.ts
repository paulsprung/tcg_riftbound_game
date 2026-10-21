import { EVELYNN_PRECON, SERAPHINE_PRECON, type DeckList } from '../../../src/game/index.ts';

/*
 * The two decks engine tests play with: the Radiance Showdown precons
 * (§13.1), exactly as the engine holds them (src/game/decks/precons.ts).
 * tests/game/decks.test.ts checks them card for card against the published
 * lists and the oracle.
 */

export const SERAPHINE: DeckList = SERAPHINE_PRECON;
export const EVELYNN: DeckList = EVELYNN_PRECON;
