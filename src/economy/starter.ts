import type { CardDb } from '../data/types.ts';

/*
 * Starter sets: a ready-to-play deck (an official Radiance Showdown Deck,
 * 40 cards with its legend, runes and battlefields) and a few booster
 * packs, like the boxed starters. The deck's cards come out of the game
 * data on demand, so the engine is only loaded when someone picks one.
 */

export interface StarterInfo {
  id: 'seraphine' | 'evelynn';
  title: string;
  blurb: string;
  /** Card id of the legend's printing, for the picture. */
  legendCard: string;
  packs: Record<string, number>;
  coins: number;
}

export const STARTER_PACKS = { rad: 3 };
export const STARTER_COINS = 200;

export const STARTERS: Pick<StarterInfo, 'id' | 'title' | 'blurb'>[] = [
  { id: 'seraphine', title: 'Seraphine Starter', blurb: 'Fan the crowd, build up your hand and sing the board into shape. Mind and Order.' },
  { id: 'evelynn', title: 'Evelynn Starter', blurb: 'Hide, ambush and strike from the shadows. Body and Chaos.' },
];

/** Printing to give for a card definition: its plain printing in the data. */
function printingFor(printings: string[], byId: Map<string, { variant: string }>): string | null {
  const known = printings.filter((p) => byId.has(p));
  return known.find((p) => byId.get(p)!.variant === 'base') ?? known[0] ?? null;
}

/** Card ids and copies of a starter deck, and its legend's printing. */
export async function starterContents(id: StarterInfo['id'], db: CardDb): Promise<{ cards: Record<string, number>; legendCard: string | null }> {
  const { PRECONS, findCard } = await import('../game/index.ts');
  const precon = PRECONS.find((p) => p.id === id);
  if (!precon) throw new Error(`No starter ${id}`);
  const byId = new Map(db.cards.map((c) => [c.id, c]));
  const cards: Record<string, number> = {};
  const add = (def: string, n: number) => {
    const oc = findCard(def);
    const pid = oc && printingFor(oc.printings, byId);
    if (pid) cards[pid] = (cards[pid] ?? 0) + n;
  };
  const d = precon.deck;
  add(d.legend, 1);
  for (const e of d.main) add(e.def, e.n);
  for (const e of d.runes) add(e.def, e.n);
  for (const b of d.battlefields) add(b, 1);
  const lo = findCard(d.legend);
  return { cards, legendCard: lo ? printingFor(lo.printings, byId) : null };
}
