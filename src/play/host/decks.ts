import {
  PRECONS, validateDeck, type DeckList, type DefId, type Issue, type Precon,
} from '../../game/index.ts';

/*
 * The decks a player can pick before the deck builder exists (§12.1,
 * §13.1): the two Radiance Showdown Decks, Seraphine and Evelynn, made to
 * be played against each other. The lists and the validator are the
 * engine's (decks/precons.ts, decks/validate.ts).
 */

export interface BuiltInDeck {
  id: Precon['id'];
  /** The product's name. */
  product: string;
  deck: DeckList;
}

export const BUILT_IN_DECKS: BuiltInDeck[] = PRECONS.map((p) => ({ id: p.id, product: p.product, deck: p.deck }));

/** The deck as it will be played: with the Chosen Champion the player
    picked among its Champion Options [103.3.a]. */
export const withChampion = (d: DeckList, chosen: DefId = d.chosenChampion): DeckList =>
  (chosen === d.chosenChampion ? d : { ...d, chosenChampion: chosen });

/**
 * What the validator says about a deck before a game against the computer:
 * exactly 40 cards, as built-in decks and games against the AI use (Spec A
 * Q4), in Standard. Launch dates are not checked: a game at home is not a
 * sanctioned event (TR 601.2.b).
 */
export function deckIssues(d: DeckList, chosen: DefId = d.chosenChampion): Issue[] {
  return validateDeck(withChampion(d, chosen), 'sanctioned', { format: 'standard' });
}

/** What keeps a deck from starting a game, in words with the rule each
    breaks; [] when it can. Warnings don't stop a game. */
export function deckProblems(d: DeckList, chosen: DefId = d.chosenChampion): string[] {
  return deckIssues(d, chosen).filter((i) => i.severity === 'error').map((i) => `${i.message} (${ruleRef(i.rule)})`);
}

/** '103.3.b' → '[103.3.b]'; Tournament Rules and design references as they are. */
const ruleRef = (rule: string) => (/^\d/.test(rule) ? `[${rule}]` : rule);
