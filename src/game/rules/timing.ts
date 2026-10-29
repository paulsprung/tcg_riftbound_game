/*
 * Timing: who may act, and with what (§5.5, Spec C §3, Spec D §8.4,
 * [155], [308–312], [358.4], [381], [806], [813]).
 *
 *   Neutral Open, own Main Phase   the Turn Player: any card or ability
 *   Neutral Closed (a chain)       the priority holder: [Reaction] only
 *   Showdown Open                  the Focus holder, on either player's
 *                                  turn: [Action] or [Reaction]
 *   Showdown Closed                the priority holder: [Reaction] only
 *
 * The same predicate decides what a priority decision offers (the window
 * the decision is asked in) and whether an item's timing still holds at
 * step 5 of its play [358.4], evaluated from what the state was before its
 * step 1 (PlayContext.atStart, closedTheState). Limited plays take the
 * instructing effect's permission (RulesConfig.limitedPlaysBypassTiming,
 * Spec C Q5); triggered abilities go on the chain in any state [383.3.c].
 */
import { abilityById, cardDef as cardDefOf, hasPrintedKeyword } from '../cards/registry.ts';
import type { ChainItem, DefId, GameState } from '../state/types.ts';
import { defHasKeyword, isType, typesOf } from './chars.ts';
import { staticsFor } from '../layers/derive.ts';

/** Timing a static gives p's cards ("Your gear with [Deploy] have [Action]", "your spells have [Reaction]"). */
export function givenTiming(s: GameState, id: number, p: number, t: Timing): Timing {
  const o = s.objects[id];
  if (!o) return t;
  for (const { st, spec } of staticsFor(s, null, 'giveTiming')) {
    if (st.ctl !== p || !spec.types.some((x) => typesOf(o).includes(x))) continue;
    if (spec.keyword && !hasPrintedKeyword(o.def, spec.keyword)) continue;
    if (spec.timing === 'action') t.action = true; else t.reaction = true;
  }
  return t;
}

export type Window = 'main' | 'chain' | 'showdown';

export interface Timing { action: boolean; reaction: boolean }

/** A card's timing keywords [806], [813]; Quick-Draw has [Reaction] [819.1.b]. */
export const cardTiming = (def: DefId): Timing =>
  ({ action: defHasKeyword(def, 'action'), reaction: defHasKeyword(def, 'reaction') || defHasKeyword(def, 'quickDraw') });

/** An activated ability's timing keywords [381], [806.1.c.2], [813.1.c.2]. */
export function abilityTiming(ability: string): Timing {
  const a = abilityById(ability);
  const t = a?.kind === 'activated' ? a.timing : undefined;
  return { action: t === 'action', reaction: t === 'reaction' };
}

/** Whether something with these keywords may start being played in a
    window (Spec D §8.4's table). */
export function windowAllows(w: Window, t: Timing): boolean {
  if (w === 'main') return true;                                     // default timing [155], [316.5.b]
  if (w === 'chain') return t.reaction;                              // [309.1.a], [813.1.c]
  return t.action || t.reaction;                                     // [308.1.a], [806.1.b–c]
}

/** Step 5's timing check [358.4], [406], with the item's keywords now. A
    card played from face down has [Reaction] [811.1.b]; an Ambush unit has
    it while being played to a battlefield where its controller has units
    [822.1.b] (`ignoreAmbush`: the timing without that). */
export function timingOk(s: GameState, it: ChainItem, o: { ignoreAmbush?: boolean } = {}): boolean {
  if (it.kind === 'triggered') return true;                          // [383.3.c]
  const t = it.kind === 'activated' ? abilityTiming(it.ability!) : givenTiming(s, it.obj!, it.controller, cardTiming(s.objects[it.obj!].def));
  if (it.kind === 'card' && it.play.origin.z === 'facedown') t.reaction = true;
  const loc = it.play.choices.location;
  if (!o.ignoreAmbush && it.kind === 'card' && loc?.z === 'bf' && hasPrintedKeyword(s.objects[it.obj!].def, 'ambush')
    && s.bfs[loc.bf].here.some((u) => u !== it.obj && isType(s.objects[u], 'unit') && (s.objects[u].controller === it.controller
      || (s.objects[u].controller !== null && (cardDefOf(s.objects[it.obj!].def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'ambushEnemy'))))) {
    t.reaction = true;
  }
  if (it.isAdd && t.reaction) return true;                           // [430.3]
  const p = it.play;
  if (p.mode === 'limited') return s.rules.limitedPlaysBypassTiming || t.reaction;   // Spec C Q5, Spec D OQ-1
  if (!p.closedTheState) return t.reaction;                          // joined a chain [358.4], [309.1.a]
  if (p.atStart.showdown) return t.action || t.reaction;             // opened a chain in a showdown [308.1.a]
  return (it.controller === p.atStart.turnPlayer && p.atStart.phase === 'main') || t.action || t.reaction;
}
