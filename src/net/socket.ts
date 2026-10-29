import { useSyncExternalStore } from 'react';
import type { ClientMsg, Mode, ServerMsg } from './protocol.ts';

/*
 * The socket of online play: one per tab, opened once you are signed in,
 * opened again (with a growing pause) when it drops. What it last heard
 * about the queue and your game is kept here for the Play pages; the game
 * itself listens through RemoteHost.
 */

type Listener = (m: ServerMsg) => void;

export interface OnlineState {
  status: 'off' | 'connecting' | 'open';
  queue: { mode: Mode; since: number } | null;
  /** A game you are in (also one you left by reloading). */
  game: string | null;
  /** The game's start, for the table. */
  start: Extract<ServerMsg, { t: 'start' }> | null;
  /** The last game's end, until it is dismissed. */
  end: Extract<ServerMsg, { t: 'end' }> | null;
  error: string | null;
}

let ws: WebSocket | null = null;
let wanted = false;
let retry = 0;
let state: OnlineState = { status: 'off', queue: null, game: null, start: null, end: null, error: null };
const stateListeners = new Set<() => void>();
const listeners = new Set<Listener>();
/** Called at a game's end (the account's coins changed). */
const endHooks = new Set<() => void>();
/** Updates that came before anyone listened (the game's first view, right after 'start'). */
let early: ServerMsg[] = [];

const set = (patch: Partial<OnlineState>) => { state = { ...state, ...patch }; stateListeners.forEach((l) => l()); };

function open() {
  if (!wanted || ws) return;
  set({ status: 'connecting' });
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const s = new WebSocket(url);
  ws = s;
  s.onopen = () => { retry = 0; set({ status: 'open' }); };
  s.onmessage = (e) => {
    let m: ServerMsg;
    try { m = JSON.parse(String(e.data)) as ServerMsg; } catch { return; }
    if (m.t === 'state') set({ queue: m.queue, game: m.game, ...(m.game ? {} : { start: null }) });
    else if (m.t === 'queued') set({ queue: { mode: m.mode, since: m.since }, error: null });
    else if (m.t === 'left') set({ queue: null });
    else if (m.t === 'start') { early = []; set({ queue: null, game: m.gameId, start: m, end: null }); }
    else if (m.t === 'end') { set({ game: null, end: m }); endHooks.forEach((h) => h()); }
    else if (m.t === 'error') set({ error: m.message });
    if (listeners.size === 0 && m.t === 'update') early.push(m);
    listeners.forEach((l) => l(m));
  };
  s.onclose = () => {
    ws = null;
    set({ status: 'off' });
    if (!wanted) return;
    const wait = Math.min(15_000, 500 * 2 ** retry++);
    setTimeout(open, wait);
  };
}

export const online = {
  /** Signed in: keep a socket open. */
  connect() { wanted = true; open(); },
  disconnect() { wanted = false; ws?.close(); },
  send(m: ClientMsg) {
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; }
    set({ error: 'Not connected to the server. Trying again…' });
    return false;
  },
  /** Every message from now on; the updates that came before the first listener, at once. */
  listen(l: Listener) {
    listeners.add(l);
    const missed = early; early = [];
    missed.forEach(l);
    return () => { listeners.delete(l); };
  },
  onEnd(h: () => void) { endHooks.add(h); return () => { endHooks.delete(h); }; },
  dismissEnd() { set({ end: null, start: null }); },
  clearError() { set({ error: null }); },
  get: () => state,
  subscribe(l: () => void) { stateListeners.add(l); return () => { stateListeners.delete(l); }; },
};

export function useOnline(): OnlineState {
  return useSyncExternalStore(online.subscribe, online.get, online.get);
}
