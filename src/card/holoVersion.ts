import { useSyncExternalStore } from 'react';

/**
 * Which version of the holo foil to show, chosen with the header's Holo
 * switch and kept in this browser:
 *   a  the first WebGL shader with the original CSS grid foil
 *   b  the reviewed shader (rest state = the plain scan) with the new grid foil
 *   c  b with the second review's fixes
 * It lives on <html data-holo> so CSS can follow it too.
 */
export type HoloVersion = 'a' | 'b' | 'c';

export const HOLO_VERSIONS: { id: HoloVersion; label: string; title: string }[] = [
  { id: 'a', label: 'A', title: 'Version A: the first shader and the original grid foil' },
  { id: 'b', label: 'B', title: 'Version B: the reviewed shader, calmer at rest, with the new grid foil' },
  { id: 'c', label: 'C', title: 'Version C: B with the second review’s fixes' },
];

const KEY = 'riftbound-sim:holo';
const DEFAULT: HoloVersion = 'a';

function read(): HoloVersion {
  const v = document.documentElement.dataset.holo;
  return v === 'a' || v === 'b' || v === 'c' ? v : DEFAULT;
}

export function initHoloVersion() {
  let v: string | null = null;
  try { v = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  document.documentElement.dataset.holo = v === 'a' || v === 'b' || v === 'c' ? v : DEFAULT;
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
