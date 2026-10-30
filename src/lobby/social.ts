import { useSyncExternalStore } from 'react';
import { api, showNotice } from '../net/api.ts';
import type { LobbyMode, LobbyView, Presence } from '../net/protocol.ts';
import { online } from '../net/socket.ts';
import { MODES_OPEN } from '../play/modes.ts';
import { DEMO, DEMO_FRIENDS } from './demo.ts';

/*
 * Friends and the lobby. Signed in, both are the server's: friends with
 * their presence (server/friends.ts), kept fresh by the socket's 'friends'
 * nudge, requests both ways, your friend code; and the lobby as in the
 * League client (server/games/online.ts): the host invites friends from the
 * custom game (or casual 2v2), they join, pick a deck and ready up, the host
 * starts. Without a server (the preview) it runs on sample friends.
 */

export interface Friend { id: string; name: string; avatar: string | null; presence: Presence }
export interface Pending { id: string; name: string; avatar: string | null }
interface State {
  open: boolean; live: boolean; code: string;
  friends: Friend[]; incoming: Pending[]; outgoing: Pending[];
  lobby: LobbyView | null;
  /** An invite to a friend's lobby, waiting for your answer. */
  invite: { lobby: string; mode: LobbyMode; from: { id: string; name: string } } | null;
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

let state: State = { open: DEMO ? readOpen() : false, live: false, code: '', friends: DEMO ? sample : [], incoming: [], outgoing: [], lobby: null, invite: null, note: '' };
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

/** The custom game set to 2v2 (DeckSetup): an invite from it opens a lobby for four. */
let customDuo = false;
export function setCustomDuo(on: boolean) { customDuo = on; }

/** The page you invite from decides the lobby: the custom game (1v1, or 2v2 for four), or casual (2v2). */
export function lobbyModeHere(): LobbyMode | null {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'play' || h.startsWith('play/custom')) return customDuo && MODES_OPEN ? 'casual' : 'custom';
  // with 2v2 closed, friends play 1v1 from casual too
  if (h.startsWith('play/casual')) return MODES_OPEN ? 'casual' : 'custom';
  return null;
}

export const social = {
  setOpen(open: boolean) {
    set({ open });
    try { localStorage.setItem(KEY, open ? 'open' : 'closed'); } catch { /* per-session only */ }
  },
  say,
  /** Signed in: the server's friends and lobby from now on, kept fresh over the socket. */
  connect() {
    void load().catch(() => undefined);
    online.listen((m) => {
      if (m.t === 'friends') void load().catch(() => undefined);
      // in the lobby we were invited to (accepted from another tab): the invite is done
      else if (m.t === 'lobby') set(m.lobby && state.invite?.lobby === m.lobby.id ? { lobby: m.lobby, invite: null } : { lobby: m.lobby });
      // in a game nobody asks you anywhere (the server refuses it too)
      else if (m.t === 'lobby-invite') { if (!online.get().game) set({ invite: { lobby: m.lobby, mode: m.mode, from: m.from } }); }
      else if (m.t === 'lobby-invite-gone' && state.invite?.lobby === m.lobby) set({ invite: null });
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
  /** Into your lobby, from the custom game or casual page. */
  invite(id: string) {
    const f = state.friends.find((x) => x.id === id);
    if (!state.live) { if (f) say(`Invite sent to ${f.name} (sample)`); return; }
    const mode = state.lobby?.mode ?? lobbyModeHere();
    if (!mode) { showNotice('Invite from the custom game or casual'); return; }
    if (online.send({ t: 'lobby-invite', to: id, mode }) && f) say(`Invite sent to ${f.name}`);
  },
  /** Join (or not) the lobby you were invited to; joining opens its page. */
  answer(accept: boolean) {
    const i = state.invite;
    if (!i) return;
    online.send({ t: 'lobby-answer', lobby: i.lobby, accept });
    set({ invite: null });
    if (accept) location.hash = i.mode === 'casual' ? 'play/casual' : 'play/custom';
  },
  leave() { online.send({ t: 'lobby-leave' }); },
  kick(id: string) { online.send({ t: 'lobby-kick', who: id }); },
  deck(ref: string) { online.send({ t: 'lobby-deck', deck: ref }); },
  ready(ready: boolean) { online.send({ t: 'lobby-ready', ready }); },
  start() { online.send({ t: 'lobby-start' }); },
  team() { online.send({ t: 'lobby-team' }); },
};

export function useSocial(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
