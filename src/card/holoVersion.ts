import { useSyncExternalStore } from 'react';
import type { Finish } from '../pack/generate.ts';

/**
 * Which holo foil to show, chosen with the Holo switch and kept in this
 * browser. Three looks exist:
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

export const HOLO_VERSIONS: { id: HoloVersion; label: string; title: string }[] = [
  { id: 'mix', label: 'Mix', title: 'Showcase cards (alt art, overnumbered, signature, ultimate) in A, all other cards in C' },
  { id: 'a', label: 'A', title: 'Version A: the first shader and the original grid foil' },
  { id: 'b', label: 'B', title: 'Version B: the reviewed shader, calmer at rest, with the new grid foil' },
  { id: 'c', label: 'C', title: 'Version C: B with the second review’s fixes' },
];

const SHOWCASE: Finish[] = ['etched', 'signature', 'ultimate'];

/** The look a card gets under a holo version. */
export function lookFor(version: HoloVersion, finish: Finish): HoloLook {
  if (version !== 'mix') return version;
  return SHOWCASE.includes(finish) ? 'a' : 'c';
}

// v2: the default changed to mix, so earlier stored choices start over
const KEY = 'riftbound-sim:holo:v2';
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

export function setHoloVersion(v: HoloVersion) {
  document.documentElement.dataset.holo = v;
  try { localStorage.setItem(KEY, v); } catch { /* per-session only */ }
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-holo'] });
  return () => mo.disconnect();
}

export function useHoloVersion(): HoloVersion {
  return useSyncExternalStore(subscribe, read, read);
}
