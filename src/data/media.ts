/*
 * Product imagery shipped with the app in public/media/: Riot's official
 * product shots of each set's booster pack and the real card back.
 * scripts/prepare-media.py downloads and crops them from the sources listed
 * in scripts/media.json and writes media.json next to this file.
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

/** The back every card shares, or null to draw the stand-in. */
export const CARD_BACK: string | null = manifest.cardBack ? base + manifest.cardBack : null;
