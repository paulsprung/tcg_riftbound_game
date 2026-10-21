import type { DeckList, DefId, GameSetup, PlayerId } from '../../game/index.ts';
import { withPrintings, type CardIndex } from './cards.ts';

/*
 * From the choices on the setup screen (§12.1) to the engine's GameSetup.
 * The human sits at `human`; the other seat is the computer's.
 */

export type OrderChoice = 'random' | 'first' | 'second';

export interface GameChoice {
  human: PlayerId;
  mine: DeckList;
  theirs: DeckList;
  /** The human's Chosen Champion, one of their deck's Champion Options. */
  champion: DefId;
  /** 'random' is TR 407: a random player chooses after seeing both
      battlefields. 'first' / 'second' fix it, for casual games. */
  order: OrderChoice;
  seed: number;
}

export function gameSetup(c: GameChoice, ix: CardIndex): GameSetup {
  const other: PlayerId = c.human === 0 ? 1 : 0;
  const mine = withPrintings(c.mine, ix), theirs = withPrintings(c.theirs, ix);
  const decks: [DeckList, DeckList] = c.human === 0 ? [mine, theirs] : [theirs, mine];
  const chosenChampion: [DefId?, DefId?] = c.human === 0 ? [c.champion] : [undefined, c.champion];
  const setup: GameSetup = { seed: c.seed >>> 0, decks, chosenChampion };
  if (c.order === 'first') setup.firstPlayer = c.human;
  if (c.order === 'second') setup.firstPlayer = other;
  return setup;
}
