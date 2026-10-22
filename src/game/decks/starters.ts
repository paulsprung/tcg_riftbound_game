/*
 * Every official starter deck: the Proving Grounds starter box, the Origins,
 * Spiritforged and Unleashed Champion Decks, and the Radiance Showdown
 * Decks. The Radiance ones are written out in precons.ts; the others are
 * built from data/starters/*.json by `npm run build-starters` (card names
 * resolved to oracle ids, counts checked). Each is 56 cards: the legend,
 * 40 main deck cards, 12 runes and 3 battlefields, and comes with one
 * booster pack of its set.
 */
import generated from './starters.gen.json';
import type { DeckList } from './decklist.ts';
import { PRECONS } from './precons.ts';

export interface Starter {
  id: string;
  product: string;
  set: 'ogs' | 'ogn' | 'sfd' | 'unl' | 'rad';
  /** The booster pack that comes in the box. */
  booster: 'ogn' | 'sfd' | 'unl' | 'rad';
  tokens: string[];
  deck: DeckList;
}

export const PRODUCTS: Record<Starter['set'], string> = {
  ogs: 'Proving Grounds Starter Box',
  ogn: 'Origins Champion Decks',
  sfd: 'Spiritforged Champion Decks',
  unl: 'Unleashed Champion Decks',
  rad: 'Radiance Showdown Decks',
};

/** Product order, oldest first. */
export const PRODUCT_ORDER: Starter['set'][] = ['ogs', 'ogn', 'sfd', 'unl', 'rad'];

export const STARTERS: Starter[] = [
  ...(generated as unknown as Starter[]),
  ...PRECONS.map((p): Starter => ({ id: p.id, product: p.product, set: 'rad', booster: 'rad', tokens: p.tokens, deck: p.deck })),
].sort((a, b) => PRODUCT_ORDER.indexOf(a.set) - PRODUCT_ORDER.indexOf(b.set) || a.deck.name.localeCompare(b.deck.name));
