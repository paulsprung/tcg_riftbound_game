/*
 * WebGL foil renderer (placeholder until the shader lands). The contract:
 * createHolo draws the whole card — the art plus its foil — into the canvas;
 * update() draws one frame for a tilt state. Throwing means "no WebGL here",
 * and the card falls back to the CSS foil.
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
  destroy(): void;
}

export function createHolo(_canvas: HTMLCanvasElement, _opts: HoloOptions): HoloRenderer {
  throw new Error('WebGL foil not available');
}
