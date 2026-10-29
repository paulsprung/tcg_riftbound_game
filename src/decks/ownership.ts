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

/** The art for each card: a printing the player owns, else the first. */
export function ownPrintings(d: DeckList, c: CollectionState): Record<DefId, string[]> {
  const defs = [d.legend, ...d.main.map((e) => e.def), ...d.battlefields, ...d.runes.map((e) => e.def)];
  const out: Record<DefId, string[]> = {};
  for (const def of new Set(defs)) {
    const prints = findCard(def)?.printings ?? [];
    const mine = prints.find((p) => (c.cards[p]?.normal ?? 0) + (c.cards[p]?.foil ?? 0) > 0);
    if (mine) out[def] = [mine];
  }
  return out;
}

/** Every legend in the oracle. */
export const LEGENDS = ORACLE.cards.filter((c) => c.types.includes('legend'));
