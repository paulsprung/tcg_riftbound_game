import { useSyncExternalStore } from 'react';

/**
 * The look of the slab labels: pearl (white), midnight (navy and gold) or
 * onyx (black). Kept in this browser; a pristine 10 adds gold to any of them.
 */
export type LabelStyle = 'pearl' | 'midnight' | 'onyx';

export const LABEL_STYLES: { id: LabelStyle; label: string }[] = [
  { id: 'pearl', label: 'Pearl' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'onyx', label: 'Onyx' },
];

const KEY = 'riftbound-sim:slab-label';
const DEFAULT: LabelStyle = 'pearl';
const valid = (v: unknown): v is LabelStyle => LABEL_STYLES.some((s) => s.id === v);

let current: LabelStyle = DEFAULT;
try {
  const v = localStorage.getItem(KEY);
  if (valid(v)) current = v;
} catch { /* storage blocked */ }

const listeners = new Set<() => void>();

export function setLabelStyle(v: LabelStyle) {
  current = v;
  try { localStorage.setItem(KEY, v); } catch { /* per-session only */ }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useLabelStyle(): LabelStyle {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
