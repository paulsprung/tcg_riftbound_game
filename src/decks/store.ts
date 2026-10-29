import { useSyncExternalStore } from 'react';
import type { DeckList, DefId } from '../game/index.ts';
import { api, showNotice } from '../net/api.ts';

/*
 * The decks a player builds (Collection → Decks). Signed in, the server
 * keeps them (PUT/DELETE /api/decks/<id>): a change shows at once and is
 * sent behind it. Otherwise they live in this browser's localStorage, every
 * access guarded. Ids are UUIDs made here, so a deck has its address (the
 * builder's URL) from the moment it is made.
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
let remote = false;

function commit(next: SavedDeck[]) {
  state = next;
  if (!remote) try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}

const send = (p: Promise<unknown>) => { p.catch((err: unknown) => showNotice(`Deck not saved: ${err instanceof Error ? err.message : err}`)); };
const toServer = (d: SavedDeck) => { if (remote) send(api('PUT', `/api/decks/${d.id}`, { deck: d })); };

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

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
  /** Signed in: the server's decks from now on. */
  useServer(rows: { id: string; body: DeckList; updatedAt: number }[]) {
    remote = true;
    commit(rows.map((r) => ({ ...r.body, id: r.id, source: 'custom', updatedAt: r.updatedAt })));
  },
  /** Adds the deck or replaces the one with its id; newest first. */
  save(d: SavedDeck) {
    const next = { ...d, updatedAt: Date.now() };
    commit([next, ...state.filter((x) => x.id !== d.id)]);
    toServer(next);
  },
  remove(id: string) {
    commit(state.filter((d) => d.id !== id));
    if (remote) send(api('DELETE', `/api/decks/${id}`));
  },
  /** A copy under a new id, "(copy)" added to its name. */
  duplicate(id: string): SavedDeck | null {
    const d = state.find((x) => x.id === id);
    if (!d) return null;
    const copy = { ...d, id: newId(), name: `${d.name} (copy)`.slice(0, 40), updatedAt: Date.now() };
    commit([copy, ...state]);
    toServer(copy);
    return copy;
  },
};

export function useDecks(): SavedDeck[] {
  return useSyncExternalStore(decks.subscribe, decks.get, decks.get);
}
