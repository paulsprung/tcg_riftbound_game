import type { Card } from '../data/types.ts';

/*
 * Cards printed in a foil of their own, not one of the set foils: the T1
 * Signature Edition. On the real cards (Riot's renders, a photo of the
 * English #0001) the red ink carries a fine red glitter, the light ink a
 * smooth satin sheen, and the serial copy's signature and number are a
 * mirror-gold hot stamp; there is no rainbow and no etched linework.
 *
 * Each such card names its masks in public/media/masks: where the glitter
 * sits (the art's saturated reds) and, on a serial copy, the gold stamp
 * (the signature and the serial number, as they differ from the plain card).
 */

export interface PrintLook {
  /** data-print on the card: the CSS look (holo.css). */
  print: 't1s';
  glitMask: string;
  sigMask?: string;
}

// absolute: a url() in a custom property resolves against the stylesheet that uses it, not the page
const base = () => new URL(`${import.meta.env.BASE_URL}media/masks/`, document.baseURI).href;

export function printLook(card: Pick<Card, 'id'>): PrintLook | null {
  const m = /^t1s-(\d{3})(-star)?-005$/.exec(card.id);
  if (!m) return null;
  return {
    print: 't1s',
    glitMask: `${base()}t1s-${m[1]}-005-glit.webp`,
    ...(m[2] ? { sigMask: `${base()}t1s-${m[1]}-star-005-sig.webp` } : {}),
  };
}
