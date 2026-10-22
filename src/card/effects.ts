import { useSyncExternalStore } from 'react';

/**
 * Card effects on or off: the foil, the tilt and the 3D inspector shader.
 * Off shows every card as a still, flat scan. Lives on <html data-fx> and
 * is kept in this browser; a system "reduce motion" setting starts it off.
 */
export type Effects = 'on' | 'off';

const KEY = 'riftbound-sim:effects';

const read = (): Effects => (document.documentElement.dataset.fx === 'off' ? 'off' : 'on');

export function initEffects() {
  let v: string | null = null;
  try { v = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.fx = v === 'off' || v === 'on' ? v : reduced ? 'off' : 'on';
}

export function setEffects(v: Effects) {
  document.documentElement.dataset.fx = v;
  try { localStorage.setItem(KEY, v); } catch { /* per-session only */ }
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fx'] });
  return () => mo.disconnect();
}

export function useEffects(): Effects {
  return useSyncExternalStore(subscribe, read, read);
}
