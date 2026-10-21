import { useSyncExternalStore } from 'react';

/**
 * Subtle (English printing: warmer, gentler foil) or Vivid (Chinese printing:
 * stronger rainbow). Lives on <html data-foil> so CSS and the WebGL foil can
 * both follow it, and is kept in this browser.
 */
export type FoilStyle = 'subtle' | 'vivid';

const KEY = 'riftbound-sim:foil';

const read = (): FoilStyle => (document.documentElement.dataset.foil === 'vivid' ? 'vivid' : 'subtle');

export function initFoilStyle() {
  let v: string | null = null;
  try { v = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  document.documentElement.dataset.foil = v === 'vivid' ? 'vivid' : 'subtle';
}

export function setFoilStyle(v: FoilStyle) {
  document.documentElement.dataset.foil = v;
  try { localStorage.setItem(KEY, v); } catch { /* per-session only */ }
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-foil'] });
  return () => mo.disconnect();
}

export function useFoilStyle(): FoilStyle {
  return useSyncExternalStore(subscribe, read, read);
}
