import { useSyncExternalStore } from 'react';

/**
 * Subtle (English printing: warmer, gentler foil) or Vivid (Chinese printing:
 * stronger rainbow). Lives on <html data-foil> so CSS and the WebGL foil can
 * both follow it.
 */
export type FoilStyle = 'subtle' | 'vivid';

const read = (): FoilStyle => (document.documentElement.dataset.foil === 'vivid' ? 'vivid' : 'subtle');

/** Subtle is the look now; the switch is gone, so stored choices are ignored. */
export function initFoilStyle() {
  document.documentElement.dataset.foil = 'subtle';
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-foil'] });
  return () => mo.disconnect();
}

export function useFoilStyle(): FoilStyle {
  return useSyncExternalStore(subscribe, read, read);
}
