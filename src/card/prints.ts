import type { Card } from '../data/types.ts';

/*
 * Cards printed in a foil of their own, not one of the set foils.
 *
 * t1s: the T1 Signature Edition. On the real cards (Riot's renders, a photo
 * of the English #0001) the red ink carries a fine red glitter, the light ink
 * a smooth satin sheen, and the serial copy's signature and number are a
 * mirror-gold hot stamp; there is no rainbow and no etched linework.
 * Each such card names its masks in public/media/masks: where the glitter
 * sits (the art's saturated reds) and, on a serial copy, the gold stamp
 * (the signature and the serial number, as they differ from the plain card).
 *
 * silver: the Ultimate rares (Unleashed's Baron Nashor UNL-238, Radiance's
 * Packed Amphitheater RAD-184). From videos of real cards, in and out of
 * sleeves and under UV light: the whole card is printed on mirror-silver
 * foil under thin ink: the scan shows bare foil as dark grey, so those
 * areas (the text box above all) flash bright silver where they mirror the
 * light and the art reads silver-grey; the rainbow is a fine prismatic
 * grain that sweeps across in a band;
 * the name bar and the domain pips keep their opaque colour, the cost
 * emblem and the artist line are gold hot stamp. No cracked ice, no
 * galaxy glitter. Baron's art also carries UV-reactive ink: under black
 * light the creature's linework glows cyan (the inspector's UV switch).
 * The regions are CSS shapes in the card frame's own layout (holo.css,
 * data-layout), so they need no per-card image.
 */

export type PrintKind = 't1s' | 'silver';

export interface PrintLook {
  /** data-print on the card: the CSS look (holo.css). */
  print: PrintKind;
  /** t1s: where the glitter sits. */
  glitMask?: string;
  /** t1s: the gold stamp of a serial copy. */
  sigMask?: string;
  /** silver: which frame the regions follow. */
  layout?: 'unit' | 'battlefield';
  /** silver: the card has UV-reactive ink. */
  uv?: boolean;
}

// absolute: a url() in a custom property resolves against the stylesheet that uses it, not the page
const base = () => new URL(`${import.meta.env.BASE_URL}media/masks/`, document.baseURI).href;

const SILVER: Record<string, PrintLook> = {
  'unl-238-219': { print: 'silver', layout: 'unit', uv: true },
  'rad-184-167': { print: 'silver', layout: 'battlefield' },
};

export function printLook(card: Pick<Card, 'id'>): PrintLook | null {
  const silver = SILVER[card.id];
  if (silver) return silver;
  const m = /^t1s-(\d{3})(-star)?-005$/.exec(card.id);
  if (!m) return null;
  return {
    print: 't1s',
    glitMask: `${base()}t1s-${m[1]}-005-glit.webp`,
    ...(m[2] ? { sigMask: `${base()}t1s-${m[1]}-star-005-sig.webp` } : {}),
  };
}
