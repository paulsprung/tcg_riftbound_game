import type { CollectionState } from '../collection/store.ts';
import { defOfPrinting, findCard, ORACLE, type DeckList, type DefId } from '../game/index.ts';

/*
 * What of a deck the player owns. The collection counts printings (Card
 * ids); a deck names cards by their oracle id (DefId), so a card's copies
 * are those of all its printings, foil or not. Graded copies are sealed in
 * their slabs and don't count. Basic runes [164.2] are free: everyone has
 * as many as a Rune Deck needs.
 */

export type Owned = Record<DefId, number>;

export function ownedDefs(c: CollectionState): Owned {
  const out: Owned = {};
  for (const [id, o] of Object.entries(c.cards)) {
    const def = defOfPrinting(id);
    if (def) out[def] = (out[def] ?? 0) + o.normal + o.foil;
  }
  return out;
}

export const isBasicRune = (def: DefId) => findCard(def)?.supertypes.includes('basic') ?? false;

/** Copies the player may put in a deck: their own, or any number of basic runes. */
export const available = (own: Owned, def: DefId) => (isBasicRune(def) ? Infinity : own[def] ?? 0);

/** The cards the deck needs that the player lacks, with how many. */
export function missingCards(d: DeckList, own: Owned): { def: DefId; n: number }[] {
  const need: Record<DefId, number> = {};
  const add = (def: DefId, n: number) => { if (def) need[def] = (need[def] ?? 0) + n; };
  add(d.legend, 1);
  for (const e of d.main) add(e.def, e.n);
  for (const e of d.runes) add(e.def, e.n);
  for (const b of d.battlefields) add(b, 1);
  return Object.entries(need).flatMap(([def, n]) => {
    const short = n - Math.min(n, available(own, def));
    return short > 0 ? [{ def, n: short }] : [];
  });
}

/** A card's printings the player owns, in the order given (the app's card index puts the main
    sets' plain prints first, promos and special editions after). */
export const ownedPrints = (order: readonly string[], c: CollectionState) =>
  order.filter((p) => (c.cards[p]?.normal ?? 0) + (c.cards[p]?.foil ?? 0) > 0);

/** The art for each card of a deck: the printing chosen for it while the player still owns it,
    else the first they own; none for a card they own no copy of. */
export function ownPrintings(d: DeckList, c: CollectionState, orderOf: (def: DefId) => readonly string[] = (def) => findCard(def)?.printings ?? []): Record<DefId, string[]> {
  const defs = [d.legend, ...d.main.map((e) => e.def), ...d.battlefields, ...d.runes.map((e) => e.def)];
  const out: Record<DefId, string[]> = {};
  for (const def of new Set(defs)) {
    const mine = ownedPrints(orderOf(def), c);
    const chosen = d.printings?.[def]?.[0];
    const pick = chosen && mine.includes(chosen) ? chosen : mine[0];
    if (pick) out[def] = [pick];
  }
  return out;
}

/** Every legend in the oracle. */
export const LEGENDS = ORACLE.cards.filter((c) => c.types.includes('legend'));

/** The most copies of each card any one of the decks holds (basic runes left out: they are free). */
export function deckNeeds(lists: readonly DeckList[]): Owned {
  const out: Owned = {};
  for (const d of lists) {
    const n: Owned = {};
    const add = (def: DefId, k: number) => { if (def && !isBasicRune(def)) n[def] = (n[def] ?? 0) + k; };
    add(d.legend, 1);
    for (const e of d.main ?? []) add(e.def, e.n);
    for (const e of d.runes ?? []) add(e.def, e.n);
    for (const b of d.battlefields ?? []) add(b, 1);
    for (const [def, k] of Object.entries(n)) out[def] = Math.max(out[def] ?? 0, k);
  }
  return out;
}

/** Would grading one raw copy of this printing leave a deck short? A slab can't be played. */
export function neededInDeck(c: CollectionState, cardId: string, lists: readonly DeckList[]): boolean {
  const def = defOfPrinting(cardId);
  if (!def) return false;
  const need = deckNeeds(lists)[def] ?? 0;
  return need > 0 && (ownedDefs(c)[def] ?? 0) - 1 < need;
}
