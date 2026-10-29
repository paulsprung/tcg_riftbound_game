import { useSyncExternalStore } from 'react';
import type { DeckList, DefId } from '../game/index.ts';

/*
 * The decks a player builds (Collection → Decks). Like the collection they
 * live in this browser's localStorage for now, every access guarded; the
 * server takes them over with the rest of the account (task: server-side
 * economy).
 */

export interface SavedDeck extends DeckList {
  id: string;
  source: 'custom';
  /** ms */
  updatedAt: number;
}

const KEY = 'riftbound-sim:decks:v1';

function read(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(list) ? list.filter((d): d is SavedDeck => !!d && typeof d === 'object' && typeof (d as SavedDeck).id === 'string') : [];
  } catch {
    return [];
  }
}

let state: SavedDeck[] = read();
const listeners = new Set<() => void>();

function commit(next: SavedDeck[]) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A fresh deck around a legend: nothing in it yet. */
export function emptyDeck(legend: DefId, name: string): SavedDeck {
  return { id: newId(), source: 'custom', name, legend, chosenChampion: '' as DefId, main: [], runes: [], battlefields: [], updatedAt: Date.now() };
}

export const decks = {
  get: () => state,
  byId: (id: string) => state.find((d) => d.id === id),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  /** Adds the deck or replaces the one with its id; newest first. */
  save(d: SavedDeck) {
    const next = { ...d, updatedAt: Date.now() };
    commit([next, ...state.filter((x) => x.id !== d.id)]);
  },
  remove(id: string) { commit(state.filter((d) => d.id !== id)); },
  /** A copy under a new id, "(copy)" added to its name. */
  duplicate(id: string): SavedDeck | null {
    const d = state.find((x) => x.id === id);
    if (!d) return null;
    const copy = { ...d, id: newId(), name: `${d.name} (copy)`, updatedAt: Date.now() };
    commit([copy, ...state]);
    return copy;
  },
};

export function useDecks(): SavedDeck[] {
  return useSyncExternalStore(decks.subscribe, decks.get, decks.get);
}
