/*
 * The game's randomness. One seeded generator lives in the state (P11), so a
 * game is its seed, its decks and its answers, and replays come out the
 * same. The algorithm is mulberry32, the same as the pack generator's
 * (src/pack/generate.ts): a seed gives the same numbers in both. Views carry
 * 0 instead of the state, so nobody can predict a shuffle (§7.3).
 */
import { reorderZone, setRng } from './mut.ts';
import { zoneIds } from './zones.ts';
import type { GameState, ObjId, Zone } from './types.ts';

/** The generator state a seed starts from. */
export const seedState = (seed: number) => seed >>> 0;

/** One step of mulberry32: a float in [0, 1) and the next state. */
export function mulberry32(state: number): { value: number; next: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, next };
}

/** A float in [0, 1), advancing the game's generator. */
export function random(s: GameState): number {
  const r = mulberry32(s.rng);
  setRng(s, r.next);
  return r.value;
}

/** An integer in [0, n). */
export function randInt(s: GameState, n: number): number {
  return Math.floor(random(s) * n);
}

export function pickOne<T>(s: GameState, items: readonly T[]): T {
  return items[randInt(s, items.length)];
}

/** A shuffled copy (Fisher–Yates, last position first). */
export function shuffled<T>(s: GameState, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffles a deck [114], [432.2.b]: a random order, and every card a new
    object nobody knows (§7.2). Returns the new ids, top first. */
export function shuffleZone(s: GameState, z: Zone & { z: 'deck' | 'runeDeck' }): ObjId[] {
  return reorderZone(s, z, shuffled(s, zoneIds(s, z)));
}
