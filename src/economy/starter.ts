import type { CardDb } from '../data/types.ts';

/*
 * Starter decks: a ready-to-play official deck (legend, 40 main deck cards,
 * 12 runes, 3 battlefields = 56 cards) and the booster pack that comes in
 * its box. The decks come out of the game data on demand, so the engine is
 * only loaded when the Home page needs them.
 */

export interface StarterChoice {
  id: string;
  title: string;
  product: string;
  /** Set of the product, for ordering. */
  set: string;
  booster: string;
  blurb: string;
  /** Card id of the legend's printing, for the picture. */
  legendCard: string | null;
  /** Card id -> copies. */
  cards: Record<string, number>;
  size: number;
}

/** Printing to give for a card definition: its plain printing in the data. */
function printingFor(printings: string[], byId: Map<string, { variant: string }>): string | null {
  const known = printings.filter((p) => byId.has(p));
  return known.find((p) => byId.get(p)!.variant === 'base') ?? known[0] ?? null;
}

export async function loadStarters(db: CardDb): Promise<StarterChoice[]> {
  const { STARTERS, findCard } = await import('../game/index.ts');
  const byId = new Map(db.cards.map((c) => [c.id, c]));
  return STARTERS.map((s) => {
    const cards: Record<string, number> = {};
    const add = (def: string, n: number) => {
      const oc = findCard(def);
      const pid = oc && printingFor(oc.printings, byId);
      if (pid) cards[pid] = (cards[pid] ?? 0) + n;
    };
    const d = s.deck;
    add(d.legend, 1);
    for (const e of d.main) add(e.def, e.n);
    for (const e of d.runes) add(e.def, e.n);
    for (const b of d.battlefields) add(b, 1);
    const legend = findCard(d.legend);
    const domains = legend?.domains.map((x) => x[0].toUpperCase() + x.slice(1)).join(' and ') ?? '';
    return {
      id: s.id, title: d.name, product: s.product, set: s.set, booster: s.booster,
      blurb: legend ? `${legend.name}${domains ? `. ${domains}.` : ''}` : '',
      legendCard: legend ? printingFor(legend.printings, byId) : null,
      cards, size: Object.values(cards).reduce((a, n) => a + n, 0),
    };
  });
}
