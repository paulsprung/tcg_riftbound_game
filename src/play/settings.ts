import { useSyncExternalStore } from 'react';

/*
 * Play settings (§12.8), kept in this browser under
 * `riftbound-sim:play-settings:v1`: who the opponent is, how fast the
 * computer plays, whether rule numbers show in the log, and the DEV panel
 * (hidden by default). Guarded storage: blocked storage keeps them for the
 * session.
 */

export type OpponentChoice = 'beginner' | 'normal' | 'hotseat';
export type PaceChoice = 'slow' | 'normal' | 'fast';

export interface PlaySettings {
  opponent: OpponentChoice;
  pace: PaceChoice;
  rules: boolean;
  dev: boolean;
}

const KEY = 'riftbound-sim:play-settings:v1';
export const DEFAULT_SETTINGS: PlaySettings = { opponent: 'normal', pace: 'normal', rules: true, dev: false };

export const PACE_FACTOR: Record<PaceChoice, number> = { slow: 1.8, normal: 1, fast: 0.45 };

let current: PlaySettings = load();
const listeners = new Set<() => void>();

function load(): PlaySettings {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlaySettings>) };
  } catch { /* blocked or corrupt */ }
  return DEFAULT_SETTINGS;
}

export function getSettings(): PlaySettings { return current; }

export function setSettings(patch: Partial<PlaySettings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* session only */ }
  for (const l of listeners) l();
}

export function usePlaySettings(): PlaySettings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getSettings, getSettings);
}
