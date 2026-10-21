/*
 * Basic runes [164]. The six of them are printed without rules text (the
 * data has '' or "[NO TEXT]"); every basic rune always has the two
 * abilities of [164.2], so the oracle build writes them in. [C] is one
 * Power of the rune's own domain [164.2.b.1].
 */
import type { DefId, Domain } from '../state/types.ts';

export const BASIC_RUNES: Record<DefId, Domain> = {
  'fury-rune': 'fury', 'calm-rune': 'calm', 'mind-rune': 'mind',
  'body-rune': 'body', 'chaos-rune': 'chaos', 'order-rune': 'order',
};

/** [164.2.a] and [164.2.b], word for word. */
export const BASIC_RUNE_TEXT = '[Reaction][>] [E]: Add [1].\n[Reaction][>] Recycle this: Add [C].';
