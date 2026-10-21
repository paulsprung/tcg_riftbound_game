import type { HoloOptions, HoloRenderer } from '../holoGl.ts';
export function createHolo(canvas: HTMLCanvasElement, opts: Omit<HoloOptions, 'version'>): HoloRenderer;
