/*
 * Teams (2v2, Magma Chamber [491]). In a mode without teams every player is
 * their own side, so all of this reads as the Duel does.
 *
 *   - "Friendly" covers what your teammate controls too; "enemy" what the
 *     other team controls [491].
 *   - Control is never shared: "you", "your" and "you control" stay yours.
 *   - Points are the team's: both players always have the same total.
 *   - A team wins or loses together: one player conceding or losing ends it
 *     for both.
 */
import type { GameState, PlayerId } from '../state/types.ts';

/** The team of a player: its index in the mode's teams, or the player itself without teams. */
export function teamOf(s: GameState, p: PlayerId): number {
  return s.mode.teams ? s.mode.teams.findIndex((t) => t.includes(p)) : p;
}

/** Same side: the same player, or teammates [491]. */
export function allied(s: GameState, a: PlayerId | null, b: PlayerId | null): boolean {
  if (a === null || b === null) return false;
  return a === b || (s.mode.teams !== null && teamOf(s, a) === teamOf(s, b));
}

/** An opponent: a player of another side (null, no controller, is nobody's). */
export function opposed(s: GameState, a: PlayerId | null, b: PlayerId | null): boolean {
  return a !== null && b !== null && !allied(s, a, b);
}

/** A player's teammates (none without teams). */
export function teammates(s: GameState, p: PlayerId): PlayerId[] {
  return s.mode.teams ? s.mode.teams[teamOf(s, p)].filter((x) => x !== p) : [];
}

/** A player and their teammates. */
export function sideOf(s: GameState, p: PlayerId): PlayerId[] {
  return [p, ...teammates(s, p)];
}

/** The players of the other sides, in seat order. */
export function opponentsOf(s: GameState, p: PlayerId): PlayerId[] {
  return s.players.map((x) => x.id).filter((x) => opposed(s, p, x));
}
