import { createContext } from 'react';
import type { TiltState } from './tilt.ts';

/**
 * A card inside something that tilts as a whole (a graded slab) leaves the
 * tilting to it: the CSS variables reach the card by inheritance, and the
 * frames reach the card's WebGL foil through this feed.
 */
export type TiltListener = (s: TiltState) => void;
export const TiltFeed = createContext<Set<TiltListener> | null>(null);
