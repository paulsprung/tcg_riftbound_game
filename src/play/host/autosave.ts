import { ENGINE_VERSION, type GameRecord } from '../../game/index.ts';
import type { Seat } from './GameHost.ts';

/*
 * Autosave and resume (§4.9, §12.8): after every answer the host hands out
 * the game's record, which is written to `riftbound-sim:game:v1`; a reload
 * replays it in milliseconds and resumes at the same decision. Storage is
 * guarded as elsewhere in the app: when it is blocked or full the save
 * lives in memory for the session. A finished game is cleared.
 *
 * Only what replays the game is stored: the record (setup + answers) and
 * how each seat is played. Scripted seats (tutorials) are never saved.
 */

export const SAVE_KEY = 'riftbound-sim:game:v1';

export type SavedSeat = { k: 'human' } | { k: 'ai'; level: 'beginner' | 'normal' } | { k: 'bot' };

export interface SavedGame {
  v: 1;
  record: GameRecord;
  seats: [SavedSeat, SavedSeat];
  savedAt: string;
  /** For the Resume card: the decks' names, the turn and the score. */
  title: string;
  turn: number;
  points: [number, number];
}

export interface SaveStore {
  load(): SavedGame | null;
  save(g: SavedGame): void;
  clear(): void;
}

/** A seat as saved; null for a seat that can't be (a script). */
export function savedSeat(s: Seat): SavedSeat | null {
  return s.k === 'script' ? null : s.k === 'ai' ? { k: 'ai', level: s.level } : { k: s.k };
}

function valid(x: unknown): x is SavedGame {
  const g = x as SavedGame;
  return !!g && g.v === 1 && !!g.record && Array.isArray(g.record.answers) && Array.isArray(g.seats) && g.seats.length === 2
    && typeof g.record.setup?.seed === 'number';
}

/** Whether a save was made by this engine (an older one can't be replayed). */
export const resumable = (g: SavedGame) => g.record.engine === ENGINE_VERSION;

export function memoryStore(): SaveStore {
  let g: SavedGame | null = null;
  return { load: () => g, save: (x) => { g = x; }, clear: () => { g = null; } };
}

/** localStorage, falling back to memory when it is blocked or full. */
export function localStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = guardedStorage()): SaveStore {
  const mem = memoryStore();
  return {
    load() {
      try {
        const raw = storage?.getItem(SAVE_KEY);
        if (raw) {
          const g = JSON.parse(raw) as unknown;
          if (valid(g)) return g;
        }
      } catch { /* blocked or corrupt */ }
      return mem.load();
    },
    save(g) {
      mem.save(g);
      try { storage?.setItem(SAVE_KEY, JSON.stringify(g)); } catch { /* full or blocked: memory only */ }
    },
    clear() {
      mem.clear();
      try { storage?.removeItem(SAVE_KEY); } catch { /* blocked */ }
    },
  };
}

function guardedStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
