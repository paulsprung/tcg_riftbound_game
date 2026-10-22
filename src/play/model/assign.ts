import { parseKey, type Decision, type ObjId, type PlayerView } from '../../game/index.ts';
import { slotOf } from './board.ts';

/*
 * The combat damage assignment widget's model (§12.5): the drafted keys of
 * the `assign:p<n>` batch with the amount each put on a unit (the engine
 * computes them: option meta.amount), and Suggest, the prefilled
 * assignment: kill what is worth most first (a unit dies when its amount
 * reaches what it has left), the excess on the most valuable survivor.
 */

export interface AssignRow { key: string; obj: ObjId; amount: number }

/** The amount a drafted key put on its unit. */
export function rowOf(d: Decision, key: string): AssignRow | null {
  const k = parseKey(key);
  if (!k || k.obj === undefined) return null;
  const o = d.options.find((op) => op.key === key);
  return { key, obj: k.obj, amount: o?.meta?.amount ?? (k.head === 'x' ? 1 : 0) };
}

/** The suggested next key of an assignment decision. */
export function suggestKey(v: PlayerView, d: Decision): string {
  const real = d.options.filter((o) => !o.ui);
  if (d.kind === 'assignTier') return real.find((o) => o.key === 'tank')?.key ?? real[0].key;
  const value = (id: ObjId) => {
    const s = slotOf(v, id, () => false);
    return { might: s.might ?? 0, left: Math.max(1, (s.might ?? 0) - s.damage) };
  };
  if (d.kind === 'assignExcess') {
    if (real.some((o) => o.key === 'done')) return 'done';
    const xs = real.filter((o) => o.key.startsWith('x:'));
    return xs.reduce((a, b) => (value(parseKey(b.key)!.obj!).might > value(parseKey(a.key)!.obj!).might ? b : a)).key;
  }
  const as = real.filter((o) => o.key.startsWith('a:'));
  if (as.length === 0) return real[0].key;
  const score = (key: string, amount: number) => {
    const u = value(parseKey(key)!.obj!);
    return (amount >= u.left ? 100 : 0) + u.might;
  };
  return as.reduce((a, b) => (score(b.key, b.meta?.amount ?? 0) > score(a.key, a.meta?.amount ?? 0) ? b : a)).key;
}

export const isAssign = (d: Decision | null) =>
  !!d && (d.kind === 'assignNext' || d.kind === 'assignExcess' || d.kind === 'assignTier');
