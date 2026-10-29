import { useMemo } from 'react';
import { useCollection, type ShowcaseItem } from '../collection/store.ts';
import type { Card, CardDb } from '../data/types.ts';
import type { Slab as SlabData } from '../showcase/grading.ts';

export interface Piece { key: string; item: ShowcaseItem; card: Card; slab: SlabData | null; foil: boolean }

/** What is on show, in order: the first one is the player's featured card. */
export function useShowcase(db: CardDb): Piece[] {
  const own = useCollection();
  return useMemo(() => {
    const byId = new Map(db.cards.map((c) => [c.id, c]));
    const slabByCert = new Map(own.slabs.map((s) => [s.cert, s]));
    return own.showcase.flatMap((item): Piece[] => {
      if (item.kind === 'slab') {
        const slab = slabByCert.get(item.cert);
        const card = slab && byId.get(slab.cardId);
        return slab && card ? [{ key: `s${item.cert}`, item, card, slab, foil: slab.foil }] : [];
      }
      const card = byId.get(item.cardId);
      const o = own.cards[item.cardId];
      return card && o && (item.foil ? o.foil : o.normal) > 0 ? [{ key: `r${item.cardId}${item.foil}`, item, card, slab: null, foil: item.foil }] : [];
    });
  }, [db, own.showcase, own.slabs, own.cards]);
}
