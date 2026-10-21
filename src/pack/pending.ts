import type { Card } from '../data/types.ts';
import type { Pull } from './generate.ts';

/*
 * A pack being revealed, kept in this browser so leaving the page (or a
 * reload) mid-reveal can pick up where it stopped. The cards are already in
 * the collection; this only remembers what is left to look at.
 */

export interface PendingPack {
  setId: string;
  pulls: { id: string; foil: boolean; finish: Pull['finish']; slot: string; hype: number }[];
  /** The next card to reveal. */
  index: number;
  /** Copies of each pulled card owned before this pack, for NEW / ×N. */
  before: Record<string, number>;
}

const KEY = 'riftbound-sim:pending-pack:v1';

export function readPending(): PendingPack | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as PendingPack : null;
  } catch { return null; }
}

export function savePending(p: PendingPack | null) {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch { /* memory only */ }
}

export const toPending = (setId: string, pulls: Pull[], index: number, before: Record<string, number>): PendingPack => ({
  setId, index, before,
  pulls: pulls.map((p) => ({ id: p.card.id, foil: p.foil, finish: p.finish, slot: p.slot, hype: p.hype })),
});

/** The pulls back as cards; null if the card data no longer has them. */
export function fromPending(p: PendingPack, cards: Card[]): Pull[] | null {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: Pull[] = [];
  for (const q of p.pulls) {
    const card = byId.get(q.id);
    if (!card) return null;
    out.push({ card, foil: q.foil, finish: q.finish, slot: q.slot, hype: q.hype });
  }
  return out;
}
