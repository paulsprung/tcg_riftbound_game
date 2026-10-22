import { useSyncExternalStore } from 'react';

/*
 * Who is signed in. The app also runs without its server (the preview
 * build, or the plain dev server): then /api/me does not answer with JSON,
 * the state is 'offline', and everything stays local as before.
 */

export interface Account { id: string; name: string; avatar: string | null }
export type Session =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'online'; user: Account | null };

let state: Session = { status: 'loading' };
const listeners = new Set<() => void>();
const set = (s: Session) => { state = s; listeners.forEach((l) => l()); };

export async function loadSession(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/me', { credentials: 'same-origin', signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return set({ status: 'offline' });
    const body = await res.json() as { user: Account | null };
    set({ status: 'online', user: body.user ?? null });
  } catch {
    set({ status: 'offline' });
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  set({ status: 'online', user: null });
}

export function useSession(): Session {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
