/*
 * Identifiers and player masks.
 *
 * Every id is minted from the counters in GameState.next and never reused,
 * not even after a rollback (§4.4), so an id names one thing for the whole
 * game. Minting writes the state, so it is done by mint() in state/mut.ts;
 * this module only holds the pure helpers around ids.
 *
 * Which players know or see something is a bit mask: bit p is player p.
 */
import type { IdCounters, Mask, ObjId, PlayerId } from './types.ts';

/** Fresh counters for a new game: every kind of id starts at 1, so 0 is
    never a real id and a negative number is always a view alias (§7.3). */
export function firstIds(): IdCounters {
  return { obj: 1, card: 1, item: 1, eff: 1, decision: 1, ts: 1, group: 1, event: 1 };
}

/** Views replace objects the viewer doesn't know by negative aliases. */
export const isAlias = (id: ObjId) => id < 0;

export const bit = (p: PlayerId): Mask => 1 << p;
export const hasBit = (m: Mask, p: PlayerId) => (m & (1 << p)) !== 0;

/** Every player of an n-player game. */
export const allMask = (players: number): Mask => (1 << players) - 1;

export function maskOf(ps: readonly PlayerId[]): Mask {
  let m = 0;
  for (const p of ps) m |= 1 << p;
  return m;
}

/** The players in a mask, lowest first. */
export function playersIn(m: Mask, players: number): PlayerId[] {
  const out: PlayerId[] = [];
  for (let p = 0; p < players; p++) if (m & (1 << p)) out.push(p as PlayerId);
  return out;
}
