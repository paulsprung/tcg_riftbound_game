import {
  PRODUCTS, STARTERS, validateDeck, type DeckList, type DefId, type Issue, type Starter,
} from '../../game/index.ts';

/*
 * The decks a player can pick before the deck builder exists (§12.1,
 * §13.1): every official starter deck, the Proving Grounds starter box, the
 * Origins, Spiritforged and Unleashed Champion Decks and the two Radiance
 * Showdown Decks (Seraphine and Evelynn). The lists and the validator are
 * the engine's (decks/starters.ts, decks/validate.ts).
 */

export interface BuiltInDeck {
  id: string;
  /** The product's name. */
  product: string;
  set: Starter['set'];
  deck: DeckList;
}

export const BUILT_IN_DECKS: BuiltInDeck[] = STARTERS.map((s) => ({ id: s.id, product: s.product, set: s.set, deck: s.deck }));

/** A built-in deck by id; undefined for an unknown one. */
export const builtInDeck = (id: string | null | undefined): BuiltInDeck | undefined =>
  BUILT_IN_DECKS.find((b) => b.id === id);

/** The built-in decks by product, oldest product first. */
export const DECK_GROUPS: { set: Starter['set']; name: string; decks: BuiltInDeck[] }[] = (Object.keys(PRODUCTS) as Starter['set'][])
  .map((set) => ({ set, name: PRODUCTS[set], decks: BUILT_IN_DECKS.filter((b) => b.set === set) }))
  .filter((g) => g.decks.length > 0);

/** A deck's short name: "Annie", "Seraphine". */
export const shortName = (d: DeckList) => d.name.replace(/^[^:]*: /, '').replace(/ Showdown Deck$/, '');

/** The deck as it will be played: with the Chosen Champion the player
    picked among its Champion Options [103.3.a]. */
export const withChampion = (d: DeckList, chosen: DefId = d.chosenChampion): DeckList =>
  (chosen === d.chosenChampion ? d : { ...d, chosenChampion: chosen });

/**
 * What the validator says about a deck before a game against the computer:
 * exactly 40 cards, as built-in decks and games against the AI use (Spec A
 * Q4), in Standard. Launch dates are not checked: a game at home is not a
 * sanctioned event (TR 601.2.b). An unmodified starter keeps its banned
 * cards at low OPL (TR 601.2.d.2), and a Proving Grounds starter its one
 * battlefield [487.5]: warnings, not errors.
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
