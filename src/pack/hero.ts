import type { Card } from '../data/types.ts';
import type { SetStyle } from './packConfig.ts';

/** The champion art on a set's wrapper: their showiest portrait printing. */
export function heroCard(cards: Card[], style: SetStyle): Card | undefined {
  if (!style.hero) return undefined;
  const hero = style.hero.toLowerCase();
  // "Vi" must not match "Viktor": the name is the champion, then a comma.
  const theirs = cards.filter((c) => {
    const n = c.name.toLowerCase();
    return (n === hero || n.startsWith(`${hero},`) || n.startsWith(`${hero} `)) && c.orientation === 'portrait';
  });
  const rank = (c: Card) => ({ overnumbered: 0, 'alt-art': 1, signature: 2, base: 3, promo: 4 })[c.variant];
  return [...theirs].sort((a, b) => rank(a) - rank(b))[0];
}
