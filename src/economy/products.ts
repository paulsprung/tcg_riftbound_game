import type { Card } from '../data/types.ts';
import { hypeFor, openPack, type Finish, type Pull } from '../pack/generate.ts';
import { BOOSTER_SETS, type SetStyle } from '../pack/packConfig.ts';
import { PACK_PRICE } from './rules.ts';

/*
 * The shop's products besides the boosters, shared by the app and the
 * server (server/economy.ts), which deals them once you are signed in.
 *
 * The collections (T1, Arcane, Secret Garden) are sold as packs of a single
 * card: one pull from the product's cards, never the whole product. Gift of
 * the Rift is a booster of a random set with a chance at its Akali promo.
 * The official decks (Proving Grounds, Champion and Showdown Decks) come
 * whole, with their booster, and as a deck ready to play.
 */

export const DECK_PRICE = 600;

export interface SpecialPack {
  id: string;
  name: string;
  /** The product shot in public/media/products (src/data/media.ts). */
  product: string;
  price: number;
  blurb: string;
  /** What can come out, in words, for the shop. */
  odds: string[];
  /** The wrapper's colours and the champion on it, as for a booster. */
  style: SetStyle;
}

/** One weighted outcome: a card (by id) with its finish. */
interface Draw { id: string; finish: Finish; foil: boolean; weight: number; slot: string }

const T1 = [1, 2, 3, 4, 5].map((n) => String(n).padStart(3, '0'));
/** The T1 pack: a Player Bundle card 4 in 5; else a Signature Edition card, 1 in 5 of those serial-numbered. */
const T1_DRAWS: Draw[] = [
  ...T1.map((n) => ({ id: `t1a-${n}-005`, finish: 'holo' as const, foil: true, weight: 16, slot: 'Player Bundle' })),
  ...T1.map((n) => ({ id: `t1s-${n}-005`, finish: 'etched' as const, foil: true, weight: 3.2, slot: 'Signature Edition' })),
  ...T1.map((n) => ({ id: `t1s-${n}-star-005`, finish: 'signature' as const, foil: true, weight: 0.8, slot: 'Serial-numbered' })),
];
/** The six Arcane Box Set legends (foil, Fortiche's art). */
const ARCANE = ['pr-036a-298', 'pr-068a-298', 'pr-111a-298', 'pr-159a-298', 'pr-202-298', 'pr-246b-298'];
const GARDEN = ['sgn-001-003', 'sgn-002-003', 'sgn-003-003'];
const GARDEN_TOKENS = ['sgn-t01', 'sgn-t02', 'sgn-t03', 'sgn-t04', 'sgn-t05', 'sgn-t06', 'sgn-t07', 'sgn-t08'];
export const GIFT_PROMO = 'pr-139a-166';
/** Gift of the Rift: the chance of its Akali promo on top of the booster. */
export const GIFT_PROMO_CHANCE = 0.25;

export const SPECIAL_PACKS: SpecialPack[] = [
  {
    id: 't1', name: 'T1 Worlds Champion Pack', product: 't1-signature', price: 1500,
    blurb: 'One champion of T1’s 2025 Worlds win: Ambessa, Xin Zhao, Galio, Miss Fortune or Seraphine.',
    odds: ['Player Bundle card: 4 in 5', 'Signature Edition card: 1 in 5', 'of those serial-numbered: 1 in 5'],
    style: { wrapper: ['#ff2a3d', '#9a0018', '#1a0508'], hero: 'Galio', tagline: 'T1', contents: '1 card' },
  },
  {
    id: 'arcane', name: 'Arcane Pack', product: 'arcane', price: 1000,
    blurb: 'One of the six foil legends of the Arcane Box Set, in Fortiche’s art.',
    odds: ['Jinx, Vi, Caitlyn, Heimerdinger, Viktor or Warwick: 1 in 6 each, always foil'],
    style: { wrapper: ['#f2c35a', '#a8741e', '#2a1a08'], hero: 'Jinx', tagline: 'Arcane', contents: '1 foil card' },
  },
  {
    id: 'secret-garden', name: 'Secret Garden Pack', product: 'secret-garden', price: 800,
    blurb: 'One of the garden’s alt-art cards, Lillia, Ivern or Ultrasoft Poro, and one of its tokens.',
    odds: ['Lillia, Ivern or Ultrasoft Poro: 1 in 3 each', 'plus one garden token'],
    style: { wrapper: ['#f6efa0', '#8fc46b', '#2f5a2a'], hero: 'Lillia', tagline: 'Secret Garden', contents: '1 card · 1 token' },
  },
  {
    id: 'gift-of-the-rift', name: 'Gift of the Rift Pack', product: 'gift-of-the-rift', price: 500,
    blurb: 'A booster of a random set, and a chance at the alt-art Akali of the Gift of the Rift bundle.',
    odds: ['A booster of Origins, Spiritforged, Unleashed, Vendetta or Radiance', `Akali, Rogue Assassin (alt art): 1 in ${Math.round(1 / GIFT_PROMO_CHANCE)}`],
    style: { wrapper: ['#5fd0c4', '#16626a', '#0a2025'], hero: 'Akali', tagline: 'Gift of the Rift', contents: 'Booster · promo chance' },
  },
];

export const specialPack = (id: string) => SPECIAL_PACKS.find((p) => p.id === id);

/** What a pack of any kind costs: a booster, or a special pack. */
export const packPrice = (id: string) => specialPack(id)?.price ?? PACK_PRICE;

/** The cards a special pack can hold (for its wrapper and the art to fetch). */
export function specialCards(id: string, all: Card[]): Card[] {
  const ids = id === 't1' ? T1_DRAWS.map((d) => d.id) : id === 'arcane' ? ARCANE
    : id === 'secret-garden' ? [...GARDEN, ...GARDEN_TOKENS] : null;
  if (!ids) return all;
  const set = new Set(ids);
  return all.filter((c) => set.has(c.id));
}

function draw(draws: Draw[], byId: Map<string, Card>, random: () => number): Pull {
  const known = draws.filter((d) => byId.has(d.id));
  let r = random() * known.reduce((t, d) => t + d.weight, 0);
  const d = known.find((x) => (r -= x.weight) < 0) ?? known[known.length - 1];
  const card = byId.get(d.id)!;
  return { card, foil: d.foil, finish: d.finish, slot: d.slot, hype: hypeFor(d.finish, card) };
}

const even = (ids: string[], finish: Finish, foil: boolean, slot: string): Draw[] => ids.map((id) => ({ id, finish, foil, weight: 1, slot }));

/** Deals a special pack from the card data. */
export function dealSpecial(id: string, all: Card[], random: () => number = Math.random): Pull[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  switch (id) {
    case 't1': return [draw(T1_DRAWS, byId, random)];
    case 'arcane': return [draw(even(ARCANE, 'holo', true, 'Arcane'), byId, random)];
    case 'secret-garden': return [draw(even(GARDEN_TOKENS, 'foil', true, 'Token'), byId, random), draw(even(GARDEN, 'etched', true, 'Secret Garden'), byId, random)];
    case 'gift-of-the-rift': {
      const set = BOOSTER_SETS[Math.floor(random() * BOOSTER_SETS.length)];
      const pulls = openPack(all.filter((c) => c.setId === set.id), set.pack, random);
      const promo = byId.get(GIFT_PROMO);
      if (promo && random() < GIFT_PROMO_CHANCE) pulls.push({ card: promo, foil: true, finish: 'etched', slot: 'Gift of the Rift', hype: hypeFor('etched', promo) });
      return pulls;
    }
    default: throw new Error(`No such pack: ${id}`);
  }
}

/** The shop's picture of each official deck. */
export const DECK_PRODUCT: Record<string, string> = {
  annie: 'proving-grounds', garen: 'proving-grounds', lux: 'proving-grounds', 'master-yi': 'proving-grounds',
  jinx: 'deck-jinx', 'lee-sin': 'deck-leesin', viktor: 'deck-viktor', fiora: 'deck-fiora', rumble: 'deck-rumble',
  vex: 'deck-vex', vi: 'deck-vi', evelynn: 'showdown-evelynn-seraphine', seraphine: 'showdown-evelynn-seraphine',
};
