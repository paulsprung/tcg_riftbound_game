/*
 * Evaluation (§11.5): how good a position is for one player, from public
 * structure plus the sampled hidden cards. Wins and losses dominate;
 * otherwise a weighted sum of features, in "points" (a point on the score
 * track is worth W.point):
 *
 *   score race    g(mine) − g(theirs), g(x) = x + 0.6·max(0, x − 5)²: points
 *                 near the end matter more
 *   material      units on the board by Might and keywords, ×1.15 at a
 *                 battlefield
 *   control/hold  each battlefield held, and the chance to hold it at the
 *                 next Beginning Phase: σ((defense − reach) / 2), reach being
 *                 every opposing unit that could walk in
 *   cards         hand size (diminishing), deck size (Burn Out below 3)
 *   resources     runes on the board
 *   tempo         ready runes left in one's own Main Phase (slightly negative)
 *
 * The weights are hand-set for M1 (tuning by self-play is §11.5's later
 * step). Evaluation never reads anything a player couldn't see but the
 * sampled hidden cards of the state it is given.
 */
import { unitsAt } from '../rules/board.ts';
import { damageOf, hasKeyword, isType, keywordOf, mightOf } from '../rules/chars.ts';
import type { GameState, ObjId, PlayerId } from '../state/types.ts';

export const W = {
  win: 1000, point: 10, unit: 1, might: 1.5, atBf: 1.15, tank: 0.6, shield: 0.4, assault: 0.4, control: 2.5, hold: 6,
  card: 2.2, cardOver7: 0.4, rune: 1.3, tempo: 0.25, burnOut: 3, damage: 0.5,
};

const g = (x: number) => x + 0.6 * Math.max(0, x - 5) ** 2;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** What a unit on the board is worth to its controller. */
export function unitValue(s: GameState, id: ObjId): number {
  const m = Math.max(0, mightOf(s, id));
  let v = W.unit + W.might * m;
  if (hasKeyword(s, id, 'tank')) v += W.tank;
  v += W.shield * keywordOf(s, id, 'shield') + W.assault * keywordOf(s, id, 'assault');
  const o = s.objects[id];
  if (m > 0 && damageOf(o) > 0) v -= W.damage * Math.min(m, damageOf(o)) * 0.2;   // heals at end of turn
  return v;
}

/** The Might p could bring to a battlefield next turn: units in base (a
    Standard Move goes between base and a battlefield [144]). */
function reach(s: GameState, p: PlayerId): number {
  let n = 0;
  for (const id of unitsAt(s, { z: 'base', p })) n += Math.max(0, mightOf(s, id));
  return n;
}

function side(s: GameState, p: PlayerId): number {
  const pl = s.players[p];
  let v = W.point * g(pl.points);
  for (const id of unitsAt(s, { z: 'base', p })) v += unitValue(s, id);
  s.bfs.forEach((b, bf) => {
    let defense = 0;
    for (const id of unitsAt(s, { z: 'bf', bf })) {
      if (s.objects[id].controller !== p) continue;
      v += unitValue(s, id) * W.atBf;
      defense += Math.max(0, mightOf(s, id));
    }
    if (b.controller === p) {
      const opp = s.players.find((q) => q.id !== p)!.id;
      v += W.control + W.hold * sigmoid((defense - reach(s, opp)) / 2);
    }
  });
  const hand = pl.hand.length;
  v += W.card * Math.min(hand, 7) + W.cardOver7 * Math.max(0, hand - 7);
  const runes = pl.base.filter((id) => isType(s.objects[id], 'rune'));
  v += W.rune * Math.min(runes.length, 12);
  if (pl.deck.length < 3) v -= W.burnOut * (3 - pl.deck.length);
  if (s.turn.player === p && s.turn.phase === 'main') {
    v -= W.tempo * runes.filter((id) => !s.objects[id].exhausted).length;
  }
  return v;
}

/** The position's value for `me`: ±W.win for a result, else mine − theirs. */
export function evaluate(s: GameState, me: PlayerId): number {
  if (s.result) return s.result.winner === null ? 0 : s.result.winner === me ? W.win : -W.win;
  let v = 0;
  for (const pl of s.players) v += pl.id === me ? side(s, pl.id) : -side(s, pl.id);
  return v;
}
