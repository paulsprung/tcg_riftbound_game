import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Finish } from '../pack/generate.ts';
import type { HoloLook } from './holoVersion.ts';
import type { TiltState } from './tilt.ts';
import { createHolo, type HoloRenderer } from './holoGl.ts';

export interface HoloCanvasHandle {
  update(s: TiltState): void;
}

interface Props {
  src: string;
  finish: Finish;
  rarity: string;
  style: 'subtle' | 'vivid';
  version: HoloLook;
  className?: string;
  /** Called once the first frame is on screen, or with false if WebGL is
      unavailable (the caller then shows the CSS foil instead). */
  onReady: (ok: boolean) => void;
}

const REST: TiltState = { tx: 0, ty: 0, px: 50, py: 50, pfc: 0, on: 0 };

/**
 * The card drawn by the WebGL foil shader (holoGl.ts): the art and its foil
 * in one canvas, so the shine can follow the art pixel by pixel. Used for
 * the big views only (inspector, the card being revealed); grids keep the
 * CSS foil, since every canvas holds a GPU context.
 *
 * The renderer gives its context up for good when destroyed, so every
 * mount draws into a canvas of its own, created here.
 */
export const HoloCanvas = forwardRef<HoloCanvasHandle, Props>(function HoloCanvas(
  { src, finish, rarity, style, version, className = '', onReady },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<HoloRenderer | null>(null);
  const last = useRef<TiltState>(REST);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;

  useImperativeHandle(ref, () => ({
    update(s: TiltState) {
      last.current = s;
      renderer.current?.update(s);
    },
  }), []);

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    let alive = true;
    const canvas = document.createElement('canvas');
    canvas.className = 'hc__gl-canvas';
    box.appendChild(canvas);
    let resizeObs: ResizeObserver | null = null;

    const fail = () => { if (alive) readyCb.current(false); };
    const onLost = (e: Event) => { e.preventDefault(); renderer.current = null; fail(); };
    canvas.addEventListener('webglcontextlost', onLost);

    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    img.decode().then(() => {
      if (!alive) return;
      try {
        renderer.current = createHolo(canvas, { image: img, finish, rarity, style, version });
      } catch {
        fail();
        return;
      }
      const fit = () => {
        // offset sizes are the untransformed box (a sideways battlefield is
        // rotated by CSS around it)
        const w = box.offsetWidth, h = box.offsetHeight;
        if (w && h) renderer.current?.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
        renderer.current?.update(last.current);
      };
      fit();
      resizeObs = new ResizeObserver(fit);
      resizeObs.observe(box);
      readyCb.current(true);
    }, fail);

    return () => {
      alive = false;
      resizeObs?.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      renderer.current?.destroy();
      renderer.current = null;
      canvas.remove();
    };
  }, [src, finish, rarity, style, version]);

  return <div ref={host} className={className} aria-hidden />;
});
