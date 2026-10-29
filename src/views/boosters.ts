import { useMemo } from 'react';
import type { Card, CardDb, SetInfo } from '../data/types.ts';
import { BOOSTER_SETS } from '../pack/packConfig.ts';

export type Booster = (typeof BOOSTER_SETS)[number] & { info: SetInfo; cards: Card[] };

/** The five sets sold as booster packs, newest first. */
export function useBoosters(db: CardDb): Booster[] {
  return useMemo(
    () => BOOSTER_SETS
      .map((b) => ({ ...b, info: db.sets.find((s) => s.id === b.id), cards: db.cards.filter((c) => c.setId === b.id) }))
      .filter((b): b is Booster => Boolean(b.info) && b.cards.length > 0),
    [db],
  );
}

export const openPack = (id: string) => { location.hash = `shop/${id}`; };
