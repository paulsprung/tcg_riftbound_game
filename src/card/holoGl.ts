/*
 * WebGL foil renderer. createHolo draws the whole card — the art plus its
 * foil — into a canvas; update() draws one frame for a tilt state; throwing
 * means "no WebGL here" and the card falls back to the CSS foil.
 *
 * Three versions of the shader are kept side by side and picked with the
 * header's Holo switch (see holoVersion.ts):
 *   a  shaders/physical.js  the first shader: holographic film under printed
 *                           ink, foil visible even at rest, rainbow lit by
 *                           fixed room lights
 *   b  shaders/refined.js   reworked after review: rest state is the plain
 *                           scan, glare follows the pointer, marbled etching,
 *                           gold-stamped signatures
 *   c  shaders/polished.js  b plus fixes from a second review (name bars,
 *                           blacks, vivid colour shifts)
 * Each is plain JS with no dependencies.
 */
import type { Finish } from '../pack/generate.ts';
import type { HoloLook } from './holoVersion.ts';
import type { TiltState } from './tilt.ts';
import { createHolo as physical } from './shaders/physical.js';
import { createHolo as polished } from './shaders/polished.js';
import { createHolo as refined } from './shaders/refined.js';

export interface HoloOptions {
  image: HTMLImageElement;
  finish: Finish;
  rarity: string;
  style: 'subtle' | 'vivid';
  version: HoloLook;
}

export interface HoloRenderer {
  update(s: TiltState): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  /** Frees the GPU context for good; the canvas cannot be reused. */
  destroy(): void;
}

const SHADERS = { a: physical, b: refined, c: polished };

export function createHolo(canvas: HTMLCanvasElement, { version, ...opts }: HoloOptions): HoloRenderer {
  return SHADERS[version](canvas, opts);
}
