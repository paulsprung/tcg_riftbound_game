import { useSyncExternalStore } from 'react';
import { api, showNotice } from '../net/api.ts';
import type { Presence } from '../net/protocol.ts';
import { online } from '../net/socket.ts';
import { DEMO, DEMO_FRIENDS } from './demo.ts';

/*
 * The friends list. Signed in, it is the server's (server/friends.ts):
 * friends with their presence, kept fresh by the socket's 'friends' nudge,
 * requests both ways, your friend code, and friendly games (a challenge a
 * friend answers with their deck). Without a server (the preview) it runs
 * on sample friends, forgotten on reload.
 */

export interface Friend { id: string; name: string; avatar: string | null; presence: Presence }
export interface Pending { id: string; name: string; avatar: string | null }
interface State {
  open: boolean; live: boolean; code: string;
  friends: Friend[]; incoming: Pending[]; outgoing: Pending[];
  /** Challenges you sent, by friend id; one a friend sent you. */
  sent: string[]; asked: { id: string; name: string } | null;
  note: string;
}

const KEY = 'riftbound-sim:social';
/** Closed to begin with: the friends list opens over the page when asked for. */
const readOpen = (): boolean => {
  try { const v = localStorage.getItem(KEY); if (v === 'open' || v === 'closed') return v === 'open'; } catch { /* blocked */ }
  return false;
};

const sample: Friend[] = DEMO_FRIENDS.map((f) => ({
  id: f.id, name: f.name, avatar: null,
  presence: f.presence === 'offline' ? 'offline' : f.doing.startsWith('In Game') ? 'game' : 'online',
}));

let state: State = { open: DEMO ? readOpen() : false, live: false, code: '', friends: DEMO ? sample : [], incoming: [], outgoing: [], sent: [], asked: null, note: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
let noteTimer: ReturnType<typeof setTimeout> | undefined;

function say(note: string) {
  set({ note });
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => set({ note: '' }), 3200);
}
const fail = (e: unknown) => showNotice(e instanceof Error ? e.message : 'Something went wrong');

async function load() {
  const r = await api<{ code: string; friends: Friend[]; incoming: Pending[]; outgoing: Pending[] }>('GET', '/api/friends');
  set({ live: true, code: r.code, friends: r.friends, incoming: r.incoming, outgoing: r.outgoing });
}

export const social = {
  setOpen(open: boolean) {
    set({ open });
    try { localStorage.setItem(KEY, open ? 'open' : 'closed'); } catch { /* per-session only */ }
  },
  say,
  /** Signed in: the server's friends from now on, kept fresh over the socket. */
  connect() {
    void load().catch(() => undefined);
    online.listen((m) => {
      if (m.t === 'friends') void load().catch(() => undefined);
      else if (m.t === 'challenge') set({ asked: m.from });
      else if (m.t === 'challenge-gone') {
        const f = state.friends.find((x) => x.id === m.with);
        set({ sent: state.sent.filter((id) => id !== m.with), asked: state.asked?.id === m.with ? null : state.asked });
        if (m.why !== 'replaced' && f) say(`${f.name}: ${m.why}`);
      } else if (m.t === 'start') set({ sent: [], asked: null });
      else if (m.t === 'error' && state.sent.length) set({ sent: [] });
    });
  },
  async add(code: string) {
    try {
      const r = await api<{ name: string; accepted: boolean }>('POST', '/api/friends/add', { code });
      say(r.accepted ? `You and ${r.name} are friends` : `Request sent to ${r.name}`);
      await load();
      return true;
    } catch (e) { fail(e); return false; }
  },
  accept(id: string) { void api('POST', '/api/friends/accept', { id }).then(load).catch(fail); },
  remove(id: string) {
    if (!state.live) { set({ friends: state.friends.filter((x) => x.id !== id) }); return; }
    void api('POST', '/api/friends/remove', { id }).then(load).catch(fail);
  },
  /** A friendly game with your deck; they answer with theirs. */
  challenge(id: string, deck: string) {
    const f = state.friends.find((x) => x.id === id);
    if (!state.live) { if (f) say(`Invite sent to ${f.name} (sample)`); return; }
    if (!deck) { showNotice('You need a legal deck of your own cards'); return; }
    if (online.send({ t: 'challenge', to: id, deck })) { set({ sent: [...new Set([...state.sent, id])] }); if (f) say(`Challenge sent to ${f.name}`); }
  },
  cancel(id: string) { online.send({ t: 'challenge-cancel', to: id }); },
  answer(accept: boolean, deck = '') {
    const a = state.asked;
    if (!a) return;
    online.send({ t: 'challenge-answer', from: a.id, accept, deck });
    set({ asked: null });
  },
};

export function useSocial(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
