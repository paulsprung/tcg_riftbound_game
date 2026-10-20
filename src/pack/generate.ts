import type { Card } from '../data/types.ts';
import { codeKey } from '../data/normalize.ts';
import type { PackConfig, PoolKey } from './packConfig.ts';

/**
 * How the card's surface catches the light. From Riot's descriptions and
 * photos of real cards:
 *   none      plain card stock, just a soft gloss
 *   foil      a foil common/uncommon/rune: smooth prismatic sheen
 *   holo      rare/epic: the same sheen, stronger
 *   etched    alt art / overnumbered: rainbow holo plus etched lines that
 *             follow the art's own linework
 *   signature etched holo with a gold-stamped signature
 *   ultimate  everything at once
 */
export type Finish = 'none' | 'foil' | 'holo' | 'etched' | 'signature' | 'ultimate';

export interface Pull {
  card: Card;
  foil: boolean;
  finish: Finish;
  slot: string;
  /** How exciting the reveal should be: 0 plain ... 5 ultimate. */
  hype: number;
}

/** Small seedable PRNG (mulberry32), so a pack can be replayed from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isRune = (c: Card) => /rune/i.test(c.type);
export const isToken = (c: Card) => /token/i.test(c.type) || /token/i.test(c.supertype ?? '');

/** Which cards of a set can land in a given pool. */
export function poolFor(cards: Card[], key: PoolKey, config?: PackConfig): Card[] {
  const ultimate = new Set((config?.ultimate ?? []).map(codeKey));
  const isUltimate = (c: Card) => ultimate.has(codeKey(c.code));
  const plain = (c: Card) => !isRune(c) && !isToken(c) && !isUltimate(c);
  switch (key) {
    case 'rune': return cards.filter((c) => isRune(c) && c.variant === 'base');
    case 'altRune': return cards.filter((c) => isRune(c) && c.variant === 'alt-art');
    case 'token': return cards.filter((c) => isToken(c) && c.variant === 'base');
    case 'altArt': return cards.filter((c) => c.variant === 'alt-art' && plain(c));
    case 'overnumbered': return cards.filter((c) => c.variant === 'overnumbered' && plain(c));
    case 'signature': return cards.filter((c) => c.variant === 'signature');
    case 'ultimate': return cards.filter(isUltimate);
    default: return cards.filter((c) => c.rarity === key && c.variant === 'base' && plain(c));
  }
}

/* A set that is missing a pool (no runes in the data, no signatures yet in
   a preview set) still gives you a full pack: each pool falls back to the
   next one down. */
const FALLBACK: Record<PoolKey, PoolKey | null> = {
  ultimate: 'signature',
  signature: 'overnumbered',
  overnumbered: 'altArt',
  altArt: 'epic',
  epic: 'rare',
  rare: 'uncommon',
  uncommon: 'common',
  common: null,
  altRune: 'rune',
  rune: 'token',
  token: null,
};

export function finishFor(card: Card, foil: boolean, config?: PackConfig): Finish {
  if (config?.ultimate?.some((u) => codeKey(u) === codeKey(card.code))) return 'ultimate';
  if (card.variant === 'signature') return 'signature';
  if (card.variant === 'alt-art' || card.variant === 'overnumbered' || card.rarity === 'showcase') return 'etched';
  if (card.rarity === 'rare' || card.rarity === 'epic') return 'holo';   // always foil
  return foil ? 'foil' : 'none';
}

export function hypeFor(finish: Finish, card: Card): number {
  switch (finish) {
    case 'ultimate': return 5;
    case 'signature': return 4;
    case 'etched': return 3;
    default: return card.rarity === 'epic' ? 2 : card.rarity === 'rare' ? 1 : 0;
  }
}

export function openPack(setCards: Card[], config: PackConfig, random: () => number = Math.random): Pull[] {
  const pools = new Map<PoolKey, Card[]>();
  const pool = (k: PoolKey) => {
    if (!pools.has(k)) pools.set(k, poolFor(setCards, k, config));
    return pools.get(k)!;
  };

  const pulls: Pull[] = [];
  for (const slot of config.slots) {
    const total = slot.table.reduce((s, o) => s + o.weight, 0);
    for (let i = 0; i < slot.count; i++) {
      let r = random() * total;
      let outcome = slot.table[slot.table.length - 1];
      for (const o of slot.table) {
        if ((r -= o.weight) < 0) { outcome = o; break; }
      }

      let k: PoolKey | null = outcome.pool;
      while (k && pool(k).length === 0) k = FALLBACK[k];
      if (!k) continue;   // the set has nothing for this slot at all

      // No duplicates within one pack, like a real print sheet.
      const candidates = pool(k);
      const unused = candidates.filter((c) => !pulls.some((p) => p.card.id === c.id));
      const from = unused.length ? unused : candidates;
      const card = from[Math.floor(random() * from.length)];
      const foil = outcome.foil ?? slot.foil;
      const finish = finishFor(card, foil, config);
      pulls.push({ card, foil, finish, slot: slot.label, hype: hypeFor(finish, card) });
    }
  }
  return pulls;
}
