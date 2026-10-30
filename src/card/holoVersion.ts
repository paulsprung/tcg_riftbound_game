import { useSyncExternalStore } from 'react';
import type { Finish } from '../pack/generate.ts';

/**
 * Which holo foil to show. Three looks exist:
 *   a  the first WebGL shader with the original CSS grid foil: bold etched
 *      swirl lines on showcase cards
 *   b  the reviewed shader (rest state = the plain scan) with the new grid foil
 *   c  b with the second review's fixes: clean blacks, readable titles
 * and the default, mix, which gives showcase cards (alt art, overnumbered,
 * signature, ultimate) look a and every other card look c, the way Riot gives
 * showcase printings a different foil from ordinary rares.
 * The choice lives on <html data-holo>; each card carries its resolved look
 * in its own data-holo, which the CSS follows.
 */
export type HoloVersion = 'a' | 'b' | 'c' | 'mix';
export type HoloLook = 'a' | 'b' | 'c';

const SHOWCASE: Finish[] = ['textured', 'etched', 'signature', 'ultimate'];

/** The look a card gets under a holo version. */
export function lookFor(version: HoloVersion, finish: Finish): HoloLook {
  if (version !== 'mix') return version;
  return SHOWCASE.includes(finish) ? 'a' : 'c';
}

const DEFAULT: HoloVersion = 'mix';
const valid = (v: unknown): v is HoloVersion => v === 'a' || v === 'b' || v === 'c' || v === 'mix';

function read(): HoloVersion {
  const v = document.documentElement.dataset.holo;
  return valid(v) ? v : DEFAULT;
}

/** Mix is the look now; the A/B/C switch is gone, so stored choices are ignored. */
export function initHoloVersion() {
  document.documentElement.dataset.holo = DEFAULT;
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-holo'] });
  return () => mo.disconnect();
}

export function useHoloVersion(): HoloVersion {
  return useSyncExternalStore(subscribe, read, read);
}
