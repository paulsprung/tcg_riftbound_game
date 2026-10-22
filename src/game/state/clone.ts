/*
 * Copying and fingerprinting states. A state is plain JSON, so a copy is a
 * structured clone, and two states are the same game exactly when their
 * stable JSON (keys sorted) is the same. The hash is what determinism
 * tests, golden replays and the development double-run check compare.
 */
import type { GameState } from './types.ts';

export function cloneState(s: GameState): GameState {
  return copyJson(s);
}

/**
 * A deep copy of plain JSON data (objects, arrays, primitives), the shape
 * every state, event and decision has. Same result as structuredClone for
 * such data (undefined fields are kept), several times faster: a state is
 * copied for every play's S0 snapshot and for every AI simulation.
 */
export function copyJson<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const n = v.length, a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = copyJson(v[i]);
    return a as T;
  }
  const o: Record<string, unknown> = {};
  for (const k in v) o[k] = copyJson((v as Record<string, unknown>)[k]);
  return o as T;
}

/**
 * JSON with object keys sorted, so equal states give equal strings whatever
 * order their fields were written in. Follows JSON.stringify for the rest
 * (undefined fields are left out, undefined array entries and non-finite
 * numbers become null) and refuses anything JSON can't carry, so a Map or a
 * function that slipped into the state is an error, not a silent {}.
 */
export function stableJson(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number': return Number.isFinite(v) ? JSON.stringify(v) : 'null';
    case 'string': case 'boolean': return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`not JSON: a ${proto?.constructor?.name ?? 'non-plain object'} in the state`);
      }
      const rec = v as Record<string, unknown>;
      const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(rec[k])}`).join(',')}}`;
    }
    default: throw new TypeError(`not JSON: a ${typeof v} in the state`);
  }
}

/** 64-bit string hash (two cyrb53-style lanes), as 16 hex digits. */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h2) + hex(h1);
}

export function hashState(s: GameState): string {
  return hashString(stableJson(s));
}
