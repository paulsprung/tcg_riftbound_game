/*
 * The rules' default numbers, as queries (P13, §3.12). The Golden Rule lets
 * card text change almost any of them [002]: a Victory Score, how many runes
 * a player channels, how many cards a Facedown Zone holds. So nothing in the
 * engine writes "8" or "channel 2"; it asks here, and in M1 each query folds
 * in the active rule-changing statics ({ m: 'rule' }, §9.2) before
 * answering. In M0 none exist, so every query answers the printed rule.
 *
 * Two queries of §3.12 read derived characteristics and arrive with the
 * layers in M1 (layers/derive.ts): entryState (units enter exhausted
 * [359.2.c], gear ready [359.2.d]) and lethalThreshold (a unit's Might
 * [142.4.c]).
 */
import type { GameState, ObjId, PlayerId, TotalCost } from '../state/types.ts';
import { buffValueOf, staticsFor } from '../layers/derive.ts';

/** The turn order: a repeating cycle from the First Player [115.1]. In a
    Duel the other player follows; [MP] seating goes clockwise [115.1.b]. */
export function turnOrder(s: GameState): PlayerId[] {
  const ids = s.players.map((p) => p.id);
  const i = ids.indexOf(s.turn.firstPlayer);
  return [...ids.slice(i), ...ids.slice(0, i)];
}

/** Points needed to win: the mode's, 8 in a Duel [487.3], [194.3]. */
export function victoryScore(s: GameState): number {
  let n = s.mode.victoryScore;
  for (const { spec } of staticsFor(s, null, 'victoryScore')) n += spec.n;   // Aspirant's Climb
  return n;
}

/** Cards in an opening hand [116]. */
export function openingHandSize(_s: GameState, _p: PlayerId): number {
  return 4;
}

/** Most cards a player may set aside in their mulligan [117.1]. */
export function mulliganMax(_s: GameState, _p: PlayerId): number {
  return 2;
}

/**
 * Runes a player channels in their Channel Phase: 2 [315.3.b], and one more
 * in the first Channel Phase of the player the mode names, the second player
 * in a Duel [487.7] (the last one in free-for-all [489]). A player's first
 * Channel Phase is the one before any is counted in history.channelPhasesTaken
 * (M1 counts a Channel Phase when it ends).
 */
export function channelCount(s: GameState, p: PlayerId): number {
  const order = turnOrder(s);
  const extraFor = s.mode.firstTurn.extraRuneFor === 'second' ? order[1] : order[order.length - 1];
  return 2 + (p === extraFor && s.history.channelPhasesTaken[p] === 0 ? 1 : 0);
}

/** Cards drawn in the Draw Phase [315.4.b]. */
export function drawCount(_s: GameState, _p: PlayerId): number {
  return 1;
}

/** Cards a battlefield's Facedown Zone holds for a player [107.3.b]; Bandle
    Tree ("You may hide an additional card here") and Bushwhack Trap ("While
    you or an ally control this battlefield, that player may hide an
    additional card here") raise it. */
export function facedownCapacity(s: GameState, bf: number, p: PlayerId): number {
  let n = 1;
  for (const { st, spec } of staticsFor(s, null, 'facedownCapacity')) {
    const h = s.objects[st.host];
    const at = h.zone.z === 'bf' ? h.zone.bf : -1;
    if (at !== bf) continue;
    if (spec.for === 'controller' && s.bfs[bf].controller !== p) continue;
    n += spec.n;
  }
  return n;
}

/** Buff counters a unit may have [702.3]. */
export function maxBuffs(_s: GameState, _unit: ObjId): number {
  return 1;
}

/** Might each buff counter gives [703] (Stand United adds one). */
export function buffValue(s: GameState, unit: ObjId): number {
  return buffValueOf(s, s.objects[unit]);
}

/** Times an object may be Empowered at once: it is binary [442.1.c.1]. */
export function maxEmpowered(_s: GameState, _obj: ObjId): number {
  return 1;
}

/** What hiding a card costs: [A], one Power of any domain [811.1.b]. Teemo's
    alternatives arrive with Hidden (M2). */
export function hideCost(_s: GameState, _p: PlayerId, _card: ObjId): TotalCost {
  return { energy: 0, power: [{ k: 'any' }], other: [], components: [] };
}
