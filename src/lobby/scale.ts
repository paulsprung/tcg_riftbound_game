import { useSyncExternalStore } from 'react';

/*
 * The app is laid out for a window of at least REF_W x REF_H and is scaled to
 * fit the real one, like a game: the browser's zoom, a big monitor or a small
 * window change the scale, not what you see. The page is built on a "virtual"
 * window (the real one divided by the scale); `--vw` and `--vh` stand for one
 * percent of it, so styles say calc(30 * var(--vh)) where they once said 30vh.
 * On phones and in very short windows there is no scaling: the page flows and
 * scrolls as usual.
 */
const REF_W = 1500;
const REF_H = 880;

export interface Viewport { w: number; h: number; s: number; scaled: boolean }

const measure = (): Viewport => {
  const iw = window.innerWidth, ih = window.innerHeight;
  const scaled = iw > 900 && ih > 560;
  const s = scaled ? Math.min(2, Math.max(0.55, Math.min(iw / REF_W, ih / REF_H))) : 1;
  return { w: iw / s, h: ih / s, s, scaled };
};

let vp: Viewport = measure();
const listeners = new Set<() => void>();

function apply() {
  const next = measure();
  if (next.w === vp.w && next.h === vp.h && next.s === vp.s) return;
  vp = next;
  paint();
  listeners.forEach((l) => l());
}

function paint() {
  const root = document.documentElement.style;
  root.setProperty('--vw', `${vp.w / 100}px`);
  root.setProperty('--vh', `${vp.h / 100}px`);
  root.setProperty('--s', String(vp.s));
  root.setProperty('--app-w', `${vp.w}px`);
  root.setProperty('--app-h', `${vp.h}px`);
  if (vp.scaled) document.documentElement.dataset.scaled = ''; else delete document.documentElement.dataset.scaled;
}

export function initScale() {
  vp = measure();
  paint();
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
}

/** The virtual window now, for what has to be worked out in script. */
export const viewport = (): Viewport => vp;

export function useViewport(): Viewport {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => vp, () => vp);
}
