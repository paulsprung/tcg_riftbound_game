/*
 * A deck as the engine reads it (§13.4): card definitions by oracle id, with
 * counts. Deck building, validation (decks/validate.ts) and the official
 * precons (decks/precons.ts) all speak this shape. Tokens are never part of
 * a deck [185]; a precon's physical tokens are listed with the precon.
 */
import type { DefId, Domain } from '../state/types.ts';

/** Copies of one card. */
export interface DeckEntry { def: DefId; n: number }

export interface DeckList {
  name: string;
  source: 'precon' | 'generated' | 'custom';
  /** '' for none: a Limited deck may play without a Legend (TR 602.4.a.5). */
  legend: DefId;
  /** Precon "Champion Options": the player designates one [103.3.a]. */
  championOptions?: DefId[];
  /** One of the main deck's champion units [103.3.a]; '' for none in Limited. */
  chosenChampion: DefId;
  /** Limited: the deck's domain identity, any three (TR 602.4.a.3); otherwise the Legend's. */
  domains?: Domain[];
  /** 40 cards, the Chosen Champion's copy included (TR 402.1). */
  main: DeckEntry[];
  /** 12 runes [103.4]. */
  runes: DeckEntry[];
  /** 3 battlefields [487.4.a]. */
  battlefields: DefId[];
  /** Deck-building choices [103.1], keyed by the DefId of the card that
      asks for them: { 'neeko-blending-in': [three legends] }. */
  extra?: Record<string, DefId[]>;
  /** Card ids for the art of each definition; later from the collection. */
  printings?: Record<DefId, string[]>;
}

const total = (entries: DeckEntry[]) => entries.reduce((n, e) => n + e.n, 0);

/** Cards in the Main Deck, the Chosen Champion's copy included. */
export const mainCount = (d: DeckList) => total(d.main);

export const runeCount = (d: DeckList) => total(d.runes);

/** Copies of one card in the Main Deck. */
export const copiesOf = (d: DeckList, def: DefId) => total(d.main.filter((e) => e.def === def));

/** Every card a deck names, once each: legend, main deck, runes,
    battlefields and deck-building choices. */
export function deckDefs(d: DeckList): DefId[] {
  const all = [...(d.legend ? [d.legend] : []), ...d.main.map((e) => e.def), ...d.runes.map((e) => e.def), ...d.battlefields,
    ...Object.values(d.extra ?? {}).flat()];
  return [...new Set(all)];
}
