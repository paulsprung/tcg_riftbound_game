/*
 * WebGL foil renderer. createHolo draws the whole card — the art plus its
 * foil — into a canvas; update() draws one frame for a tilt state; throwing
 * means "no WebGL here" and the card falls back to the CSS foil.
 *
 * The shader itself lives in holoGl.impl.js (plain JS, no dependencies): a
 * physically motivated model of holographic film under printed ink. It won a
 * side-by-side comparison against two other shaders and the old CSS foil.
 */
import type { Finish } from '../pack/generate.ts';
import type { TiltState } from './tilt.ts';

export interface HoloOptions {
  image: HTMLImageElement;
  finish: Finish;
  rarity: string;
  style: 'subtle' | 'vivid';
}

export interface HoloRenderer {
  update(s: TiltState): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  /** Frees the GPU context for good; the canvas cannot be reused. */
  destroy(): void;
}

export { createHolo } from './holoGl.impl.js';
