/*
 * Read-only questions about the board and the turn that many procedures
 * ask: which units are where, who has units at a battlefield, the state of
 * the turn [307–310], who comes next in turn order. Nothing here writes.
 */
import type { GameState, Loc, ObjId, PlayerId, TurnStateName } from '../state/types.ts';
import { isType } from './chars.ts';
import { turnOrder } from './defaults.ts';

/** The units at a location, in arrival order [107.1.c]. */
export function unitsAt(s: GameState, loc: Loc): ObjId[] {
  const ids = loc.z === 'base' ? s.players[loc.p].base : s.bfs[loc.bf].here;
  return ids.filter((id) => isType(s.objects[id], 'unit'));
}

/** Every unit on the board: in the bases and at the battlefields. */
export function unitsOnBoard(s: GameState): ObjId[] {
  return [
    ...s.players.flatMap((pl) => unitsAt(s, { z: 'base', p: pl.id })),
    ...s.bfs.flatMap((_, bf) => unitsAt(s, { z: 'bf', bf })),
  ];
}

/** p's units at a battlefield. */
export const unitsOfAt = (s: GameState, p: PlayerId, bf: number) =>
  unitsAt(s, { z: 'bf', bf }).filter((id) => s.objects[id].controller === p);

/** The players who control units at a battlefield, in turn order. */
export function playersWithUnitsAt(s: GameState, bf: number): PlayerId[] {
  return turnOrderFromTurnPlayer(s).filter((p) => unitsOfAt(s, p, bf).length > 0);
}

/** Showdown iff a showdown or combat is in progress [308], [343.1]; Closed
    iff a chain exists [309.1], [331.1]. Always derived, never stored [310]. */
export function turnState(s: GameState): TurnStateName {
  const showdown = s.showdown !== null || s.combat !== null;
  const closed = s.chain.length > 0;
  return `${showdown ? 'Showdown' : 'Neutral'}${closed ? 'Closed' : 'Open'}` as TurnStateName;
}

export const isShowdownState = (s: GameState) => s.showdown !== null || s.combat !== null;

/** The next player in turn order after p [338.1.b.1], [347.2.b]. */
export function nextPlayer(s: GameState, p: PlayerId): PlayerId {
  const order = turnOrder(s);
  return order[(order.indexOf(p) + 1) % order.length];
}

/** Turn order starting with the Turn Player [303.2.a]. */
export function turnOrderFromTurnPlayer(s: GameState): PlayerId[] {
  const order = turnOrder(s);
  const i = order.indexOf(s.turn.player);
  return [...order.slice(i), ...order.slice(0, i)];
}

/** The other players. A Duel has one opponent [487]. */
export const opponentsOf = (s: GameState, p: PlayerId): PlayerId[] =>
  s.players.map((pl) => pl.id).filter((q) => q !== p);
