import { useSyncExternalStore } from 'react';
import { collection, type CollectionState } from '../collection/store.ts';
import { decks } from '../decks/store.ts';
import type { DeckList } from '../game/index.ts';
import { api } from './api.ts';
import { online } from './socket.ts';

/*
 * Who is signed in. The app also runs without its server (the preview
 * build, or the plain dev server): then /api/me does not answer with JSON,
 * the state is 'offline', and everything stays local as before. Signed in,
 * the account (coins, cards, decks) is fetched before the session counts
 * as loaded, so the app never starts on this browser's own collection.
 */

export interface Account { id: string; name: string; avatar: string | null; admin?: boolean }
export type Session =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'online'; user: Account | null };

let state: Session = { status: 'loading' };
const listeners = new Set<() => void>();
const set = (s: Session) => { state = s; listeners.forEach((l) => l()); };

const fetchAccount = () => api<{ account: CollectionState; decks: { id: string; body: DeckList; updatedAt: number }[]; admin: boolean }>('GET', '/api/account');

export async function loadSession(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/me', { credentials: 'same-origin', signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return set({ status: 'offline' });
    const body = await res.json() as { user: Account | null };
    if (!body.user) return set({ status: 'online', user: null });
    const acc = await fetchAccount();
    collection.useServer(acc.account);
    decks.useServer(acc.decks);
    // a game's coins, a sale, a gift: the account again
    online.onAccount(() => { void fetchAccount().then((a) => collection.useServer(a.account)).catch(() => undefined); });
    set({ status: 'online', user: { ...body.user, admin: acc.admin } });
    // online play: the socket stays open while signed in
    online.connect();
  } catch {
    set({ status: 'offline' });
  }
}

export async function logout(): Promise<void> {
  online.disconnect();
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  set({ status: 'online', user: null });
}

export function useSession(): Session {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
