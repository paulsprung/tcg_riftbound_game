/*
 * Product imagery shipped with the app in public/media/: Riot's official
 * renders of each set's booster pack, the shop's product shots (booster
 * displays, decks, bundles) and the real card backs (main deck and rune
 * deck, from Riot's How to Play PDF). scripts/prepare-media.py encodes
 * them and writes media.json next to this file; scripts/media-sources.json
 * records where each image comes from.
 */

export interface PackArt {
  src: string;
  /** Where the crimped top seal ends, as a fraction of the image height. */
  tear: number;
  /** Width / height of the image. */
  aspect: number;
}

import manifest from './media.json';

const base = `${import.meta.env.BASE_URL}media/`;

const PACKS: Record<string, { file: string; tear: number; aspect: number }> = manifest.packs;

export function packArt(setId: string): PackArt | undefined {
  const p = PACKS[setId];
  return p ? { src: base + p.file, tear: p.tear, aspect: p.aspect } : undefined;
}

const PRODUCTS: Record<string, { file: string; aspect: number }> = manifest.products ?? {};

/** A product shot for the shop (a booster display, a deck, a bundle), from Riot's renders. */
export function productArt(id: string): { src: string; aspect: number } | undefined {
  const p = PRODUCTS[id];
  return p ? { src: base + p.file, aspect: p.aspect } : undefined;
}

/** The main-deck back, or null to draw the stand-in. */
export const CARD_BACK: string | null = manifest.cardBack ? base + manifest.cardBack : null;

/** Rune cards come from their own deck and have a white back. */
export const CARD_BACK_RUNE: string | null = manifest.cardBackRune ? base + manifest.cardBackRune : CARD_BACK;
