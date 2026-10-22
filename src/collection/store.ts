import { useSyncExternalStore } from 'react';
import type { Pull } from '../pack/generate.ts';
import { gradeCard, type Slab } from '../showcase/grading.ts';

/*
 * The collection lives in this browser's localStorage. Storage can be
 * unavailable (private windows, blocked site data), so every access is
 * guarded and the app keeps working in memory for the session.
 */

export interface Owned { normal: number; foil: number }

/** A spot in the showcase: a graded slab, or a raw card on a stand. */
export type ShowcaseItem =
  | { kind: 'slab'; cert: string }
  | { kind: 'raw'; cardId: string; foil: boolean };

export interface CollectionState {
  /** Raw (ungraded) copies. */
  cards: Record<string, Owned>;
  packsOpened: Record<string, number>;
  /** Graded copies, newest first. A graded copy is no longer raw. */
  slabs: Slab[];
  showcase: ShowcaseItem[];
  /** Coins to spend in the shop. */
  coins: number;
  /** Unopened booster packs, by set. */
  packs: Record<string, number>;
  /** The starter set chosen at the start, once. */
  starter: string | null;
  /** When the daily coins were last taken (ms), 0 for never. */
  dailyAt: number;
}

export const PACK_PRICE = 100;
export const DAILY_COINS = 50;
const DAY = 86_400_000;

export const SHOWCASE_SIZE = 12;

const KEY = 'riftbound-sim:collection:v1';
const empty = (): CollectionState => ({ cards: {}, packsOpened: {}, slabs: [], showcase: [], coins: 0, packs: {}, starter: null, dailyAt: 0 });

const sameItem = (a: ShowcaseItem, b: ShowcaseItem) =>
  a.kind === 'slab' ? b.kind === 'slab' && a.cert === b.cert
    : b.kind === 'raw' && a.cardId === b.cardId && a.foil === b.foil;

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
      ...state,
      cards,
      packsOpened: { ...state.packsOpened, [setId]: (state.packsOpened[setId] ?? 0) + 1 },
    });
  },
  /** Send one raw copy off to be graded; it comes back sealed in a slab. */
  grade(cardId: string, foil: boolean): Slab | null {
    const o = state.cards[cardId];
    if (!o || (foil ? o.foil : o.normal) < 1) return null;
    const slab = gradeCard(cardId, foil, Math.random, new Set(state.slabs.map((s) => s.cert)));
    const left = foil ? { ...o, foil: o.foil - 1 } : { ...o, normal: o.normal - 1 };
    // a raw card on display that was the last copy goes with it
    const showcase = (foil ? left.foil : left.normal) > 0 ? state.showcase
      : state.showcase.filter((i) => !sameItem(i, { kind: 'raw', cardId, foil }));
    commit({ ...state, cards: { ...state.cards, [cardId]: left }, slabs: [slab, ...state.slabs], showcase });
    return slab;
  },
  /** Put an item in the first free spot (or the given one); false when full. */
  display(item: ShowcaseItem, at?: number): boolean {
    if (state.showcase.some((i) => sameItem(i, item))) return true;
    if (state.showcase.length >= SHOWCASE_SIZE) return false;
    const showcase = [...state.showcase];
    showcase.splice(at ?? showcase.length, 0, item);
    commit({ ...state, showcase });
    return true;
  },
  undisplay(item: ShowcaseItem) {
    commit({ ...state, showcase: state.showcase.filter((i) => !sameItem(i, item)) });
  },
  /** Move a displayed item one spot to the left (-1) or right (+1). */
  shift(item: ShowcaseItem, by: -1 | 1) {
    const from = state.showcase.findIndex((i) => sameItem(i, item));
    const to = from + by;
    if (from < 0 || to < 0 || to >= state.showcase.length) return;
    const showcase = [...state.showcase];
    [showcase[from], showcase[to]] = [showcase[to], showcase[from]];
    commit({ ...state, showcase });
  },
  isDisplayed: (item: ShowcaseItem) => state.showcase.some((i) => sameItem(i, item)),
  /** Buy unopened packs with coins; false when there are not enough. */
  buyPack(setId: string, n = 1): boolean {
    const cost = PACK_PRICE * n;
    if (n < 1 || state.coins < cost) return false;
    commit({ ...state, coins: state.coins - cost, packs: { ...state.packs, [setId]: (state.packs[setId] ?? 0) + n } });
    return true;
  },
  /** Take one unopened pack out of the inventory to open it. */
  takePack(setId: string): boolean {
    const have = state.packs[setId] ?? 0;
    if (have < 1) return false;
    commit({ ...state, packs: { ...state.packs, [setId]: have - 1 } });
    return true;
  },
  /** Coins from a reward (the daily one, later matches and the tutorial). */
  addCoins(n: number) { commit({ ...state, coins: state.coins + n }); },
  /** The daily coins, once every 24 hours. Returns the coins, or 0 if not yet. */
  claimDaily(now = Date.now()): number {
    if (now - state.dailyAt < DAY) return 0;
    commit({ ...state, coins: state.coins + DAILY_COINS, dailyAt: now });
    return DAILY_COINS;
  },
  /** When the daily coins can be taken next (ms), 0 if now. */
  dailyIn(now = Date.now()): number { return Math.max(0, state.dailyAt + DAY - now); },
  /** The starter set: its cards, packs and coins, once. */
  grantStarter(id: string, cards: Record<string, number>, packs: Record<string, number>, coins: number): boolean {
    if (state.starter) return false;
    const next = { ...state.cards };
    for (const [cardId, n] of Object.entries(cards)) {
      const o = next[cardId] ?? { normal: 0, foil: 0 };
      next[cardId] = { ...o, normal: o.normal + n };
    }
    const inv = { ...state.packs };
    for (const [setId, n] of Object.entries(packs)) inv[setId] = (inv[setId] ?? 0) + n;
    commit({ ...state, cards: next, packs: inv, coins: state.coins + coins, starter: id });
    return true;
  },
  reset() { commit(empty()); },
};

/** Graded copies per card id. */
export function gradedCounts(state: CollectionState): Record<string, number> {
  const n: Record<string, number> = {};
  for (const s of state.slabs) n[s.cardId] = (n[s.cardId] ?? 0) + 1;
  return n;
}

export function useCollection(): CollectionState {
  return useSyncExternalStore(collection.subscribe, collection.get, collection.get);
}
