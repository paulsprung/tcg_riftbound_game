/*
 * Zones and locations, read-only helpers (Spec A §2–4, [105–130]).
 *
 * The board is the two kinds of location (bases and battlefields) plus the
 * Facedown Zones and the Legend Zones [107]. A move between two board zones
 * keeps the object; a move to or from any other zone makes a new object
 * with a new id [124]. How much of a zone each player sees decides what a
 * view shows (§7): public zones show everything, a hand is private to its
 * owner, the decks are secret even to their owner, a facedown card is
 * known to its controller.
 */
import type { GameObject, GameState, Loc, ObjId, PlayerId, Zone, ZoneKind } from './types.ts';

const BOARD: readonly ZoneKind[] = ['base', 'bf', 'facedown', 'legend'];

/** Part of the board [107]: moving within it keeps the object [124]. */
export const isBoard = (z: ZoneKind) => BOARD.includes(z);

export type Visibility = 'public' | 'private' | 'secret' | 'facedown';

/** Who may see the cards of a zone [109], [108.4.e], [108.7.c], [107.3.f]. */
export function visibility(z: ZoneKind): Visibility {
  switch (z) {
    case 'hand': return 'private';
    case 'deck': case 'runeDeck': return 'secret';
    case 'facedown': return 'facedown';
    default: return 'public';
  }
}

export const isPublic = (z: ZoneKind) => visibility(z) === 'public';

/** Zone constructors, so call sites read as the rules do: Z.hand(0). */
export const Z = {
  base: (p: PlayerId): Zone => ({ z: 'base', p }),
  bf: (bf: number): Zone => ({ z: 'bf', bf }),
  facedown: (bf: number): Zone => ({ z: 'facedown', bf }),
  legend: (p: PlayerId): Zone => ({ z: 'legend', p }),
  champion: (p: PlayerId): Zone => ({ z: 'champion', p }),
  hand: (p: PlayerId): Zone => ({ z: 'hand', p }),
  deck: (p: PlayerId): Zone => ({ z: 'deck', p }),
  runeDeck: (p: PlayerId): Zone => ({ z: 'runeDeck', p }),
  trash: (p: PlayerId): Zone => ({ z: 'trash', p }),
  banish: (p: PlayerId): Zone => ({ z: 'banish', p }),
};

export function sameZone(a: Zone, b: Zone): boolean {
  if (a.z !== b.z) return false;
  if ('p' in a && 'p' in b) return a.p === b.p;
  if ('bf' in a && 'bf' in b) return a.bf === b.bf;
  if ('item' in a && 'item' in b) return a.item === b.item;
  return true;
}

/** "hand(P1)", "bf0": for log lines and error messages. */
export function zoneLabel(z: Zone): string {
  if ('p' in z) return `${z.z}(P${z.p})`;
  if ('bf' in z) return `${z.z}${z.bf}`;
  if ('item' in z) return `chain(item${z.item})`;
  return z.z;
}

/** The location an object is at, or null off the locations. */
export function locOf(o: Pick<GameObject, 'zone'>): Loc | null {
  const z = o.zone;
  return z.z === 'base' || z.z === 'bf' ? z : null;
}

/**
 * The ids in a zone, in the zone's order (decks top first). The array is the
 * state's own: read it, never write it (state/mut.ts is the only writer). A
 * battlefield's own object is not among the permanents at it: see
 * BattlefieldState.obj.
 */
export function zoneIds(s: GameState, z: Zone): readonly ObjId[] {
  switch (z.z) {
    case 'base': case 'hand': case 'deck': case 'runeDeck': case 'trash': case 'banish': case 'legend':
      return s.players[z.p][z.z];
    case 'champion': {
      const c = s.players[z.p].champion;
      return c === null ? [] : [c];
    }
    case 'bf': return s.bfs[z.bf].here;
    case 'facedown': return s.bfs[z.bf].facedown;
    case 'chain': {
      const it = s.chain.find((i) => i.id === z.item);
      return it?.obj !== undefined ? [it.obj] : [];
    }
    case 'gone': return [];
  }
}
