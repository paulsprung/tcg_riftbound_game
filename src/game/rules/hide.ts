/*
 * Hiding a card (§5.13, Spec F §10, [422], [811]): the Discretionary Action
 * a card with [Hidden] gives its owner.
 *
 *   when    "While this card is in your hand or Champion Zone on your turn
 *           during an Open State" [811.1.b] (Neutral Open: Spec H Q-1,
 *           RulesConfig.hideInShowdownOpen), with priority
 *   where   a battlefield you control with room in its Facedown Zone
 *           [107.3.b–c] (one card, more with Bandle Tree or Bushwhack Trap)
 *   cost    [A] [811.1.b]
 *   effect  the card goes face down there, known to its hider only
 *           [107.3.f]; not a play: no chain, no Play action [811.1.c.1–2];
 *           "When you hide a card here" triggers (Bandle Scouts' Academy)
 *
 * From the next turn on, it can be played from there with [Reaction],
 * ignoring its base cost (play/playCard.ts). If its hider loses control of
 * the battlefield, it goes to the trash in the next cleanup [323.6.a].
 */
import { K, parseKey, type Option } from '../core/decisions.ts';
import { emit, emitZone, knowers } from '../core/events.ts';
import { answer, ask, defineSteps, next, type FrameOf, type StepTable } from '../core/frames.ts';
import { append, moveObject, setField } from '../state/mut.ts';
import { Z } from '../state/zones.ts';
import type { Frame, GameState, ObjId, PlayerId } from '../state/types.ts';
import { fire } from '../abilities/triggers.ts';
import { hasPrintedKeyword } from '../cards/registry.ts';
import { payStep } from '../play/pay.ts';
import { paymentPlans } from './resources.ts';
import { turnState } from './board.ts';
import { facedownCapacity } from './defaults.ts';
import { requestCleanup } from './tasks.ts';
import { staticsFor } from '../layers/derive.ts';
import { playerEffects, resourceCost } from '../play/playCard.ts';
import type { ResourceCost } from './resources.ts';

type HideFrame = FrameOf<'hide'>;

export const hideFrame = (by: PlayerId, obj: ObjId): Frame => ({ f: 'hide', by, obj, bf: null, pc: 0, snap: null });

/** The battlefields p may hide a card at now [811.1.b], [107.3.b–c]. */
export function hideSpots(s: GameState, p: PlayerId): number[] {
  return s.bfs.flatMap((b, bf) => {
    if (b.controller !== p) return [];
    const mine = b.facedown.filter((id) => s.objects[id].controller === p).length;
    return mine < facedownCapacity(s, bf, p) ? [bf] : [];
  });
}

/** The cards p may hide now: [Hidden] cards in their hand or Champion Zone,
    on their own turn in an Open State, with somewhere to put them and [A]
    to pay [811.1.b]. */
export function hideable(s: GameState, p: PlayerId): ObjId[] {
  if (s.turn.player !== p || s.turn.phase !== 'main') return [];
  const st = turnState(s);
  if (st !== 'NeutralOpen' && !(st === 'ShowdownOpen' && s.rules.hideInShowdownOpen)) return [];
  if (hideSpots(s, p).length === 0) return [];
  if (!hideCosts(s, p).some((c) => paymentPlans(s, p, c, { limit: 1 }).length > 0)) return [];
  const pl = s.players[p];
  return [...pl.hand, ...(pl.champion === null ? [] : [pl.champion])].filter((id) => hasPrintedKeyword(s.objects[id].def, 'hidden'));
}

/** What hiding may cost p: [A] [811.1.b], Teemo's "[1] instead of [A]", or nothing ("ignoring costs this turn"). */
export function hideCosts(s: GameState, p: PlayerId): ResourceCost[] {
  if (playerEffects(s, p, 'hideFree').length > 0) return [{ energy: 0, power: [] }];
  const out: ResourceCost[] = [{ energy: 0, power: [{ k: 'any' }] }];
  for (const { st, spec } of staticsFor(s, null, 'hideFor')) if (st.ctl === p) out.push(resourceCost(spec.cost, []));
  return out;
}

const STEPS: StepTable<HideFrame> = [
  // pc 0: where [422.1].
  (s, f, x) => {
    const spots = hideSpots(s, f.by);
    const key = answer(f);
    if (key === K.back) return 'done';
    if (spots.length === 0) return 'done';
    if (spots.length === 1 && key === undefined) {
      f.bf = spots[0];
      return next(f);
    }
    if (key === undefined) {
      const options: Option[] = spots.map((bf) => ({ key: K.locBf(bf), refs: [{ loc: { z: 'bf', bf } }] }));
      return ask(s, f, x, { player: f.by, kind: 'hideWhere', prompt: { t: 'hideWhere' }, ctx: { source: f.obj, rule: '422.1' },
        options, privateOptions: true, back: true });
    }
    f.bf = (parseKey(key)!.loc as { bf: number }).bf;
    return next(f);
  },
  // pc 1: pay [A] (or an alternative), then hide [811.1.b].
  (s, f, x) => {
    const costs = hideCosts(s, f.by).filter((c) => paymentPlans(s, f.by, c, { limit: 1 }).length > 0);
    if (f.alt === undefined) {
      if (costs.length > 1) {
        const key = answer(f);
        if (key === undefined) {
          return ask(s, f, x, { player: f.by, kind: 'altCost', prompt: { t: 'hideCost', n: costs.length }, ctx: { source: f.obj,
            rule: '811.1.b' }, options: costs.map((_, i) => ({ key: K.alt(i) })), privateOptions: false });
        }
        f.alt = parseKey(key)!.n!;
      } else f.alt = 0;
    }
    const cost = costs[f.alt] ?? costs[0] ?? { energy: 0, power: [{ k: 'any' as const }] };
    const r = payStep(s, f, x, { payer: f.by, cost, what: 'hide', back: true,
      onBack: () => 'done', onDecline: () => 'done', rule: '811.1.b' });
    if (typeof r === 'string') return r;
    const bf = f.bf!;
    const before = knowers(s, [f.obj]);
    const from = s.objects[f.obj].zone;
    const obj = moveObject(s, f.obj, Z.facedown(bf), { controller: f.by });
    setField(s, s.objects[obj], 'facedown', { hiddenOnTurn: s.turn.n, bf, by: f.by });
    emitZone(s, x, { obj, prev: f.obj, from, to: Z.facedown(bf), why: 'hide', rule: '422.1', before });
    emit(s, x, { k: 'hide', obj, bf, rule: '422', vis: knowers(s, [obj]) });
    append(s, s.log.hidden, { p: f.by, bf });
    requestCleanup(s);
    fire(s, x, { e: 'hid', p: f.by, bf });                           // "When you hide a card here"
    return 'done';
  },
];

defineSteps('hide', STEPS);
