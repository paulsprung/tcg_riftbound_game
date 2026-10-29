import { useSyncExternalStore } from 'react';
import type { Card } from '../data/types.ts';
import { api, showNotice } from '../net/api.ts';
import type { Pull } from '../pack/generate.ts';
import { fromPending, type PendingPack } from '../pack/pending.ts';
import { DAILY_COINS, DAY, PACK_PRICE, SHOWCASE_SIZE, TUTORIAL_PACKS } from '../economy/rules.ts';
import { gradeCard, type Slab } from '../showcase/grading.ts';

/*
 * The collection. Signed in, the server keeps it (server/economy.ts) and
 * this is its copy; otherwise it lives in this browser's localStorage.
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is guarded and the app keeps working in memory for the session.
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
  /** The guided first match was finished (or skipped) and its reward taken. */
  tutorialDone: boolean;
}

export { DAILY_COINS, PACK_PRICE, SHOWCASE_SIZE, TUTORIAL_PACKS };

const KEY = 'riftbound-sim:collection:v1';
const empty = (): CollectionState => ({ cards: {}, packsOpened: {}, slabs: [], showcase: [], coins: 0, packs: {}, starter: null, dailyAt: 0,
  tutorialDone: false });

const sameItem = (a: ShowcaseItem, b: ShowcaseItem) =>
  a.kind === 'slab' ? b.kind === 'slab' && a.cert === b.cert
    : b.kind === 'raw' && a.cardId === b.cardId && a.foil === b.foil;

/** A saved collection as the current shape: fields added since it was saved
    get their defaults (tutorialDone: false, so players from before the
    tutorial are offered it and its reward). */
export function fromSaved(saved: unknown): CollectionState {
  const out = { ...empty(), ...(saved && typeof saved === 'object' ? saved as Partial<CollectionState> : {}) };
  if (typeof out.tutorialDone !== 'boolean') out.tutorialDone = false;
  return out;
}

function read(): CollectionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return fromSaved(JSON.parse(raw));
  } catch { /* fall through */ }
  return empty();
}

let state = read();
const listeners = new Set<() => void>();
/** Signed in: the server keeps the account and this is its copy. */
let remote = false;

function commit(next: CollectionState) {
  state = next;
  if (!remote) try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}

/** A change the server makes: its answer replaces the copy here; a refusal is shown and changes nothing. */
async function ask<T extends { account: CollectionState }>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T | null> {
  try {
    const out = await api<T>(method, path, body);
    commit(fromSaved(out.account));
    return out;
  } catch (err) {
    showNotice(err instanceof Error ? err.message : 'Something went wrong');
    return null;
  }
}

function addPulls(setId: string, pulls: Pull[]) {
  const cards = { ...state.cards };
  for (const p of pulls) {
    const o = { ...(cards[p.card.id] ?? { normal: 0, foil: 0 }) };
    if (p.foil) o.foil++; else o.normal++;
    cards[p.card.id] = o;
  }
  commit({ ...state, cards, packsOpened: { ...state.packsOpened, [setId]: (state.packsOpened[setId] ?? 0) + 1 } });
}

function nextShowcase(op: (list: ShowcaseItem[]) => ShowcaseItem[] | null): boolean {
  const list = op([...state.showcase]);
  if (!list) return false;
  const was = state.showcase;
  commit({ ...state, showcase: list });
  // shown at once; the server keeps it, or it goes back
  if (remote) void ask('PUT', '/api/account/showcase', { items: list }).then((r) => { if (!r) commit({ ...state, showcase: was }); });
  return true;
}

/**
 * The collection: in this browser when nobody is signed in (or there is no
 * server: the preview), else the server's account. The changes are the same
 * either way; those that need the server's word return a promise.
 */
export const collection = {
  get: () => state,
  isRemote: () => remote,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Signed in: from now on the server's account (and nothing of this browser's). */
  useServer(account: CollectionState) {
    remote = true;
    commit(fromSaved(account));
  },
  /** Open one of your packs: it leaves the inventory, its cards join the
      collection. `make` deals them here; signed in, the server deals. */
  async openPack(setId: string, make: () => Pull[], cards: Card[]): Promise<Pull[] | null> {
    if (remote) {
      const r = await ask<{ account: CollectionState; pulls: PendingPack['pulls'] }>('POST', '/api/account/open', { setId });
      return r && fromPending({ setId, pulls: r.pulls, index: 0, before: {} }, cards);
    }
    const have = state.packs[setId] ?? 0;
    if (have < 1) return null;
    commit({ ...state, packs: { ...state.packs, [setId]: have - 1 } });
    const pulls = make();
    addPulls(setId, pulls);
    return pulls;
  },
  /** Send one raw copy off to be graded; it comes back sealed in a slab. */
  async grade(cardId: string, foil: boolean): Promise<Slab | null> {
    if (remote) return (await ask<{ account: CollectionState; slab: Slab }>('POST', '/api/account/grade', { cardId, foil }))?.slab ?? null;
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
    return nextShowcase((list) => {
      if (list.length >= SHOWCASE_SIZE) return null;
      list.splice(at ?? list.length, 0, item);
      return list;
    });
  },
  undisplay(item: ShowcaseItem) {
    nextShowcase((list) => list.filter((i) => !sameItem(i, item)));
  },
  /** Move a displayed item one spot to the left (-1) or right (+1). */
  shift(item: ShowcaseItem, by: -1 | 1) {
    nextShowcase((list) => {
      const from = list.findIndex((i) => sameItem(i, item));
      const to = from + by;
      if (from < 0 || to < 0 || to >= list.length) return null;
      [list[from], list[to]] = [list[to], list[from]];
      return list;
    });
  },
  isDisplayed: (item: ShowcaseItem) => state.showcase.some((i) => sameItem(i, item)),
  /** Buy unopened packs with coins; false when there are not enough. */
  async buyPack(setId: string, n = 1): Promise<boolean> {
    if (remote) return !!(await ask('POST', '/api/account/buy', { setId, n }));
    const cost = PACK_PRICE * n;
    if (n < 1 || state.coins < cost) return false;
    commit({ ...state, coins: state.coins - cost, packs: { ...state.packs, [setId]: (state.packs[setId] ?? 0) + n } });
    return true;
  },
  /** Coins for testing, in this browser only: on the server only an admin hands out coins. */
  addCoins(n: number) { if (!remote) commit({ ...state, coins: state.coins + n }); },
  /** The daily coins, once every 24 hours. Returns the coins, or 0 if not yet. */
  async claimDaily(now = Date.now()): Promise<number> {
    if (remote) return (await ask('POST', '/api/account/daily')) ? DAILY_COINS : 0;
    if (now - state.dailyAt < DAY) return 0;
    commit({ ...state, coins: state.coins + DAILY_COINS, dailyAt: now });
    return DAILY_COINS;
  },
  /** When the daily coins can be taken next (ms), 0 if now. */
  dailyIn(now = Date.now()): number { return Math.max(0, state.dailyAt + DAY - now); },
  /** The starter set: its cards, packs and coins, once. Signed in, the
      server knows the starter's cards; only its id is sent. */
  async grantStarter(id: string, cards: Record<string, number>, packs: Record<string, number>, coins: number): Promise<boolean> {
    if (remote) return !!(await ask('POST', '/api/account/starter', { id }));
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
  /** The tutorial is over (played or skipped): its packs, once. Resolves
      false, granting nothing, when it was already done. */
  async completeTutorial(): Promise<boolean> {
    if (remote) return (await ask<{ account: CollectionState; granted: boolean }>('POST', '/api/account/tutorial'))?.granted ?? false;
    if (state.tutorialDone) return false;
    const packs = { ...state.packs };
    for (const setId of TUTORIAL_PACKS) packs[setId] = (packs[setId] ?? 0) + 1;
    commit({ ...state, packs, tutorialDone: true });
    return true;
  },
  /** Starts this browser's collection over; an account on the server is not reset from here. */
  reset() { if (!remote) commit(empty()); },
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
