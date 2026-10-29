import { useSyncExternalStore } from 'react';
import { DEMO, DEMO_FRIENDS, type Friend } from './demo.ts';

/*
 * The friends list and the party you invite them to. There is no server yet,
 * so in the preview this runs on sample friends: an invite is answered after
 * a moment, everything is forgotten on reload. The panel is built the way
 * the real one will be.
 */

export interface Member { id: string; state: 'invited' | 'joined' }
interface State { open: boolean; friends: Friend[]; party: Member[]; note: string }

const KEY = 'riftbound-sim:social';
const readOpen = (): boolean => {
  try { const v = localStorage.getItem(KEY); if (v === 'open' || v === 'closed') return v === 'open'; } catch { /* blocked */ }
  return window.innerWidth >= 1280;
};

let state: State = { open: DEMO ? readOpen() : false, friends: DEMO ? DEMO_FRIENDS : [], party: [], note: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
let noteTimer: ReturnType<typeof setTimeout> | undefined;

function say(note: string) {
  set({ note });
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => set({ note: '' }), 3200);
}

export const social = {
  setOpen(open: boolean) {
    set({ open });
    try { localStorage.setItem(KEY, open ? 'open' : 'closed'); } catch { /* per-session only */ }
  },
  say,
  invite(id: string) {
    const f = state.friends.find((x) => x.id === id);
    if (!f || state.party.some((m) => m.id === id)) return;
    set({ party: [...state.party, { id, state: 'invited' }] });
    say(`Invite sent to ${f.name}`);
    // sample: the friend accepts after a moment
    setTimeout(() => {
      if (!state.party.some((m) => m.id === id && m.state === 'invited')) return;
      set({ party: state.party.map((m) => (m.id === id ? { ...m, state: 'joined' } : m)) });
      say(`${f.name} joined your lobby`);
    }, 1800);
  },
  leave(id: string) { set({ party: state.party.filter((m) => m.id !== id) }); },
  remove(id: string) {
    const f = state.friends.find((x) => x.id === id);
    set({ friends: state.friends.filter((x) => x.id !== id), party: state.party.filter((m) => m.id !== id) });
    if (f) say(`${f.name} removed from your friends`);
  },
};

export function useSocial(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
