import type { Card } from '../data/types.ts';

/*
 * Cards printed in a foil of their own, not one of the set foils.
 *
 * T1 Signature Edition: on the real cards (Riot's renders, a photo of the
 * English #0001) the red ink carries a fine red glitter, the light ink a
 * smooth satin sheen, and the serial copy's signature and number are a
 * mirror-gold hot stamp; there is no rainbow and no etched linework.
 *
 * Radiance HEARTSTEEL overnumbered (RAD-178..183) and their signatures: from
 * pull videos and photos of the real cards, the foil is in spots, not over the
 * whole card. The doodles and the HEARTSTEEL energy ring are a strong prismatic
 * spot holo; the frame lines, badges and markers (gold in Riot's render) are
 * silver holo; the name bar is silver foil; the rest of the card is a quiet
 * line-textured board with no etched swirls. The signature is a holo stamp:
 * silver-white at rest, running through saturated rainbow bands when tilted.
 * The signature masks are the real signatures, taken pixel for pixel from
 * photos of the cards and aligned to the render.
 *
 * Each such card names its masks in public/media/masks.
 */

export interface PrintLook {
  /** data-print on the card: the CSS look (holo.css). */
  print: 't1s' | 'hs';
  /** T1: where the glitter sits (the art's saturated reds). */
  glitMask?: string;
  /** The signature stamp (and, on T1, the serial number). */
  sigMask?: string;
  /** HEARTSTEEL: spot holo (doodles, energy ring), silver frame, silver name bar. */
  spotMask?: string;
  frameMask?: string;
  nameMask?: string;
}

// absolute: a url() in a custom property resolves against the stylesheet that uses it, not the page
const base = () => new URL(`${import.meta.env.BASE_URL}media/masks/`, document.baseURI).href;

export function printLook(card: Pick<Card, 'id'>): PrintLook | null {
  const t1 = /^t1s-(\d{3})(-star)?-005$/.exec(card.id);
  if (t1) {
    return {
      print: 't1s',
      glitMask: `${base()}t1s-${t1[1]}-005-glit.webp`,
      ...(t1[2] ? { sigMask: `${base()}t1s-${t1[1]}-star-005-sig.webp` } : {}),
    };
  }
  const hs = /^rad-(17[89]|18[0-3])(-star)?-167$/.exec(card.id);
  if (hs) {
    const n = hs[1];
    return {
      print: 'hs',
      spotMask: `${base()}hs-${n}-spot.webp`,
      frameMask: `${base()}hs-${n}-frame.webp`,
      nameMask: `${base()}hs-${n}-name.webp`,
      ...(hs[2] ? { sigMask: `${base()}hs-${n}-star-sig.webp` } : {}),
    };
  }
  return null;
}

/** The inline custom properties a print look's CSS reads its masks from. */
export function printVars(p: PrintLook): Record<string, string> {
  const v: Record<string, string> = {};
  const put = (k: string, url?: string) => { if (url) v[k] = `url("${url}")`; };
  put('--glit-mask', p.glitMask);
  put('--sig-mask', p.sigMask);
  put('--spot-mask', p.spotMask);
  put('--frame-mask', p.frameMask);
  put('--name-mask', p.nameMask);
  return v;
}
