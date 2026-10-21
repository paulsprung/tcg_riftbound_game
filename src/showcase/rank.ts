import { defaultFinish, RARITY_ORDER } from '../data/cardInfo.ts';
import type { Card } from '../data/types.ts';
import { hypeFor } from '../pack/generate.ts';

/** How special a copy is, for "rarest first": its printing first (ultimate,
    signature, showcase art, epic, rare), then rarity, then foil. */
export function rank(card: Card, foil: boolean): number {
  const hype = hypeFor(defaultFinish(card, foil), card);
  return hype * 100 + RARITY_ORDER.indexOf(card.rarity) * 10 + (foil ? 1 : 0);
}
