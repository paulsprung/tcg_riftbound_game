import { useSyncExternalStore } from 'react';
import type { Pull } from '../pack/generate.ts';

/*
 * The collection lives in this browser's localStorage. Storage can be
 * unavailable (private windows, blocked site data), so every access is
 * guarded and the app keeps working in memory for the session.
 */

export interface Owned { normal: number; foil: number }

export interface CollectionState {
  cards: Record<string, Owned>;
  packsOpened: Record<string, number>;
}

const KEY = 'riftbound-sim:collection:v1';
const empty = (): CollectionState => ({ cards: {}, packsOpened: {} });

function read(): CollectionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return empty();
}

let state = read();
const listeners = new Set<() => void>();

function commit(next: CollectionState) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}

export const collection = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  addPack(setId: string, pulls: Pull[]) {
    const cards = { ...state.cards };
    for (const p of pulls) {
      const o = { ...(cards[p.card.id] ?? { normal: 0, foil: 0 }) };
      if (p.foil) o.foil++; else o.normal++;
      cards[p.card.id] = o;
    }
    commit({
      cards,
      packsOpened: { ...state.packsOpened, [setId]: (state.packsOpened[setId] ?? 0) + 1 },
    });
  },
  reset() { commit(empty()); },
};

export function useCollection(): CollectionState {
  return useSyncExternalStore(collection.subscribe, collection.get, collection.get);
}
