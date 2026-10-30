/*
 * Scoring, the final point and winning (§5.11, Spec G §7, [469–474],
 * [193–196]).
 *
 *   score       Conquer [471.1] or Hold [471.2], once per battlefield per
 *               player per turn [472]: gain up to one point [473.1]. A
 *               Conquer at Victory Score − 1 or more gives the point only to
 *               a player who has now scored every battlefield this turn
 *               (the one being scored included, Spec G Q3); otherwise they
 *               draw 1 instead [473.1.b.1]. Hold points are never held back
 *               [473.1.a.1]. Conquer and hold abilities trigger here
 *               [473.2], [383.4.c–d].
 *   checkWin    cleanup step 1: at or above the Victory Score and more
 *               points than every opponent [323.1], [194.2]; a tie plays on
 *               [194.2.b].
 *   establishControl  the end of a showdown [348.2.a] or a combat [468.5]:
 *               control, Contested cleared [190.3.b], and a Conquer if the
 *               battlefield wasn't scored by that player this turn.
 */
import { allied, sideOf } from './teams.ts';
import { endGame } from '../core/end.ts';
import { emit } from '../core/events.ts';
import { bit, hasBit } from '../state/ids.ts';
import { append, setField } from '../state/mut.ts';
import type { GameState, PlayerId } from '../state/types.ts';
import { clearContested, drawCards, gainPoints, setController } from './actions.ts';
import { opponentsOf } from './board.ts';
import { victoryScore } from './defaults.ts';
import { fire } from '../abilities/triggers.ts';
import { staticsFor } from '../layers/derive.ts';
import { isType } from './chars.ts';

type X = { present: boolean };

/** A battlefield scored by p's side this turn: once per team per turn in 2v2 [472], [491]. */
const scoredBySide = (s: GameState, b: GameState['bfs'][number], p: PlayerId) => sideOf(s, p).some((q) => hasBit(b.scoredBy, q));

export function score(s: GameState, x: X, p: PlayerId, bf: number, how: 'conquer' | 'hold', wasUncontrolled = false) {
  const b = s.bfs[bf];
  if (scoredBySide(s, b, p)) return;                                  // [472]
  // 2v2: what the Turn Player's teammate held at the Scoring Step, the team can't score this turn [491]
  const allyHeld = (s.log.allyHeld ?? []).includes(bf) && allied(s, p, s.turn.player);
  if (allyHeld) return;
  // "Players can't score here until their third turn" (Forgotten Monument).
  if (staticsFor(s, null, 'noScoreBefore').some(({ st, spec }) => s.objects[st.host]?.zone.z === 'bf'
    && (s.objects[st.host].zone as { bf: number }).bf === bf && s.history.turnsTaken[p] < spec.turn)) return;
  setField(s, b, 'scoredBy', sideOf(s, p).reduce((m, q) => m | bit(q), b.scoredBy));
  const rule = how === 'conquer' ? '471.1' : '471.2';
  const finalPoint = how === 'conquer' && s.players[p].points >= victoryScore(s) - 1;
  // [473.1.b]: the final point by conquering needs every battlefield scored this turn; in 2v2 those the
  // teammate held at the Scoring Step are excepted, on the team's own turns [491]
  const point = !finalPoint || s.bfs.every((other, i) => scoredBySide(s, other, p)
    || (allied(s, p, s.turn.player) && (s.log.allyHeld ?? []).includes(i)));
  // The units that scored it ("if I didn't conquer this turn").
  const units = b.here.filter((id) => s.objects[id].controller === p && isType(s.objects[id], 'unit'));
  append(s, s.log.scored, { p, bf, how, point, units });
  emit(s, x, { k: 'score', p, bf, how, point, drewInstead: !point, rule });
  if (point) gainPoints(s, x, p, 1, how, finalPoint ? '473.1.b' : '473.1');
  else drawCards(s, x, p, 1, '473.1.b.1');
  // Conquer and hold effects trigger even when the point was replaced by a
  // draw [383.4.c.2.c], [383.4.d.2.c], [473.2].
  fire(s, x, { e: 'scored', p, bf, how, wasUncontrolled });
}

/** Cleanup step 1 [323.1]: ends the game if a player has won. */
export function checkWin(s: GameState, x: X): boolean {
  const vs = victoryScore(s);
  for (const pl of s.players) {
    const others = opponentsOf(s, pl.id).map((q) => s.players[q].points);
    if (pl.points >= vs && others.every((n) => pl.points > n)) {     // [194.2], [194.2.a]
      endGame(s, x, { winner: pl.id, reason: 'score', rule: '323.1', turn: s.turn.n });
      return true;
    }
  }
  return false;
}

/** p establishes control of a battlefield [190.4]: Contested ends
    [190.3.b], and it is a Conquer if p hasn't scored it this turn [471.1.b]. */
export function establishControl(s: GameState, x: X, bf: number, p: PlayerId, rule: string) {
  const was = s.bfs[bf].controller === null;                        // "a battlefield that was uncontrolled" (Yone)
  setController(s, x, bf, p, rule);
  clearContested(s, x, bf, '190.3.b');
  if (!hasBit(s.bfs[bf].scoredBy, p)) score(s, x, p, bf, 'conquer', was);
}
