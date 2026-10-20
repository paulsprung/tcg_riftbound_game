import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Finish } from '../pack/generate.ts';
import type { TiltState } from './tilt.ts';
import { createHolo, type HoloRenderer } from './holoGl.ts';

export interface HoloCanvasHandle {
  update(s: TiltState): void;
}

interface Props {
  src: string;
  finish: Finish;
  rarity: string;
  className?: string;
  /** Called once the first frame is on screen, or with false if WebGL is
      unavailable (the caller then shows the CSS foil instead). */
  onReady: (ok: boolean) => void;
}

const REST: TiltState = { tx: 0, ty: 0, px: 50, py: 50, pfc: 0, on: 0 };

/** 'subtle' or 'vivid', following the header's foil switch. */
function foilStyle(): 'subtle' | 'vivid' {
  return document.documentElement.dataset.foil === 'vivid' ? 'vivid' : 'subtle';
}

/**
 * The card drawn by the WebGL foil shader (holoGl.ts): the art and its foil
 * in one canvas, so the shine can follow the art pixel by pixel. Used for
 * the big views only (inspector, the card being revealed); grids keep the
 * CSS foil, since every canvas costs a GPU context.
 */
export const HoloCanvas = forwardRef<HoloCanvasHandle, Props>(function HoloCanvas(
  { src, finish, rarity, className = '', onReady },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
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
    const el = canvas.current;
    if (!el) return;
    let alive = true;
    let observer: MutationObserver | null = null;
    let resizeObs: ResizeObserver | null = null;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;

    const fail = () => { if (alive) readyCb.current(false); };
    const onLost = (e: Event) => { e.preventDefault(); renderer.current?.destroy(); renderer.current = null; fail(); };
    el.addEventListener('webglcontextlost', onLost);

    img.decode().then(() => {
      if (!alive) return;
      try {
        renderer.current = createHolo(el, { image: img, finish, rarity, style: foilStyle() });
      } catch {
        fail();
        return;
      }
      const fit = () => {
        const r = el.getBoundingClientRect();
        // the canvas may be rotated (sideways battlefield): size by its own box
        const w = el.offsetWidth || r.width;
        const h = el.offsetHeight || r.height;
        if (w && h) renderer.current?.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
        renderer.current?.update(last.current);
      };
      fit();
      resizeObs = new ResizeObserver(fit);
      resizeObs.observe(el);
      // Follow the Subtle/Vivid switch.
      observer = new MutationObserver(() => {
        if (!renderer.current || !alive) return;
        renderer.current.destroy();
        renderer.current = createHolo(el, { image: img, finish, rarity, style: foilStyle() });
        fit();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-foil'] });
      readyCb.current(true);
    }, fail);

    return () => {
      alive = false;
      observer?.disconnect();
      resizeObs?.disconnect();
      el.removeEventListener('webglcontextlost', onLost);
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [src, finish, rarity]);

  return <canvas ref={canvas} className={className} aria-hidden />;
});
