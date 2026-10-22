/*
 * Playing an ability (§5.6, Spec D §12, Spec E §9, [399–407]): the six
 * steps of a card, with these differences.
 *
 *   1  activated: a Pending item with no card, which still closes the
 *      state [402.1] (S0 first, so `back` and a declined cost undo it);
 *      triggered: done when the trigger was placed [389.2], so the master
 *      loop's F row starts this frame at step 2
 *   2  a leading "you may": decided now; declining removes the trigger as
 *      not triggered [403.1], [383.3.a.2]. Targets [403.2]: an activated
 *      ability without legal choices can't be activated [403.3]; a
 *      triggered one is removed, which is not a counter [403.4]
 *   3  the cost: before the ":" [404.1.a]; for a trigger, a cost at the
 *      start of its effect ("you may pay [1] to …") [383.3.b], [404.1.b]
 *   4  pay [405.1]; a trigger's cost may be declined, which removes it
 *      [405.2] (for "you may pay [1] to …" the payment decision is the
 *      "may": one question, decline = no)
 *   5  targets still legal, timing [406], [381]
 *   6  finalized [407]; "once each turn" counts now [383.3.e], [386.2]
 */
import { abilityById, abilityIn } from '../cards/registry.ts';
import { K } from '../core/decisions.ts';
import { emit } from '../core/events.ts';
import { answer, ask, awaitTasks, defineSteps, next, type FrameOf, type RunCtx, type StepTable } from '../core/frames.ts';
import type { ActivatedAst, TriggeredAst } from '../dsl/ast.ts';
import { mint, restoreSnapshot, setField, snapshotState } from '../state/mut.ts';
import type { ChainItem, Frame, GameState, ObjId, PlayerId } from '../state/types.ts';
import { countFinalized } from '../abilities/triggers.ts';
import { exhaust } from '../rules/actions.ts';
import { addItem, finalizeItem, itemById, playContext, removeItem } from '../rules/chain.ts';
import { snapshotOf } from '../rules/chars.ts';
import { paymentPlans } from '../rules/resources.ts';
import { stillLegal } from '../rules/targets.ts';
import { abilityTiming, timingOk, windowAllows, type Window } from '../rules/timing.ts';
import { choicesPossible, chooseNext, slotsOf } from './choices.ts';
import { payStep } from './pay.ts';
import { deflectFor } from './cost.ts';
import { resourceCost } from './playCard.ts';
import { findCard } from '../cards/oracle.ts';

type AbilityFrame = FrameOf<'ability'>;

/** An activation chosen at a priority decision (`act:<obj>#<n>`). */
export const activateFrame = (src: ObjId, ability: string): Frame =>
  ({ f: 'ability', item: 0, pc: 0, snap: null, src, ability });

/** The F row: a pending triggered item continues at step 2. */
export const triggerFrame = (it: ChainItem): Frame =>
  ({ f: 'ability', item: it.id, pc: 2, snap: null, src: it.source ?? null, ability: it.ability ?? null });

const domainsOf = (s: GameState, id: ObjId) => findCard(s.objects[id]?.def ?? '')?.domains ?? [];

/** The activated abilities of an object, numbered as `act:<obj>#<n>` names
    them (the printed ones, in order). */
export function activatedOf(def: string): ActivatedAst[] {
  const out: ActivatedAst[] = [];
  for (let n = 0; ; n++) {
    const a = abilityById(`${def}#${n}`);
    if (!a) break;
    if (a.kind === 'activated') out.push(a);
  }
  return out;
}

/** Whether p may activate this ability of src now [377], [381], [403.3]:
    they control it, the timing allows it, its cost can be paid, and its
    choices can be made. */
export function canActivate(s: GameState, p: PlayerId, src: ObjId, a: ActivatedAst, w: Window): boolean {
  const o = s.objects[src];
  if (!o || o.controller !== p || !['base', 'bf'].includes(o.zone.z)) return false;
  if (!windowAllows(w, abilityTiming(a.id))) return false;
  if (a.cost.exhaustSelf && o.exhausted) return false;               // [415.4]
  if (paymentPlans(s, p, resourceCost(a.cost, domainsOf(s, src)), { limit: 1 }).length === 0) return false;
  return choicesPossible(s, a.effect, { controller: p, source: src });
}

/** The abilities p could activate now: `act:<obj>#<ability id>`. */
export function activatable(s: GameState, p: PlayerId, w: Window): { obj: ObjId; ability: string }[] {
  const out: { obj: ObjId; ability: string }[] = [];
  const mine = [...s.players[p].base, ...s.bfs.flatMap((b) => b.here)];
  for (const id of mine) {
    for (const a of activatedOf(s.objects[id].def)) if (canActivate(s, p, id, a, w)) out.push({ obj: id, ability: a.id });
  }
  return out;
}

const itemOf = (s: GameState, f: AbilityFrame): ChainItem => itemById(s, f.item)!;
const abilityOf = (s: GameState, f: AbilityFrame) => abilityIn(s, f.ability!) as TriggeredAst | ActivatedAst;
const isActivated = (s: GameState, f: AbilityFrame) => abilityOf(s, f).kind === 'activated';
const backOk = (s: GameState, f: AbilityFrame) => isActivated(s, f);

/** Undoes an activation [358.5], [445.2.a]: back to S0. */
function rollback(s: GameState, f: AbilityFrame, x: RunCtx, reason: 'back' | 'illegal' | 'declined') {
  restoreSnapshot(s, f.snap!);
  emit(s, x, { k: 'rollback', reason, rule: reason === 'declined' ? '445.2.a' : '406.2' });
  x.rollbacks = (x.rollbacks ?? 0) + 1;
  return 'done' as const;
}

/** A trigger leaves the chain without finalizing: declined "may" (not
    triggered [383.3.a.2]), no legal choices [403.4], an unpaid cost [405.2];
    none of these is a counter. */
function removeTrigger(s: GameState, f: AbilityFrame, x: RunCtx, why: string) {
  removeItem(s, x, f.item);
  emit(s, x, { k: 'playFailed', item: f.item, reason: why, rule: why === 'declined' ? '383.3.a.2' : why === 'unpaid' ? '405.2'
    : '403.4' });
  return 'done' as const;
}

const STEPS: StepTable<AbilityFrame> = [
  // Step 1 of an activation [402]: S0, then a Pending item (no card).
  (s, f, x) => {
    f.snap = snapshotState(s);
    const src = s.objects[f.src!];
    const p = src.controller!;
    const item = mint(s, 'item');
    const it: ChainItem = {
      id: item, seq: item, kind: 'activated', sub: 'normal', status: 'pending', controller: p, owner: p, source: f.src!,
      sourceLki: snapshotOf(s, f.src!), ability: f.ability!, isAdd: false, outcomes: {},
      play: playContext(s, { mode: 'discretionary', origin: src.zone, item, by: p }),
    };
    addItem(s, x, it, { played: true });
    f.item = item;
    return awaitTasks(f);
  },

  (_s, f) => next(f),

  // Step 2 [403]: a leading "you may", then the targets.
  (s, f, x) => {
    const it = itemOf(s, f);
    const a = abilityOf(s, f);
    if (a.kind === 'triggered' && a.may && !a.cost && it.play.choices.asPlayed.may !== true) {
      const key = answer(f);
      if (key === undefined) {
        return ask(s, f, x, {
          player: it.controller, kind: 'may', prompt: { t: 'may', ability: a.id }, ctx: { item: it.id,
            ...(it.source !== undefined ? { source: it.source } : {}), rule: '403.1' },
          options: [{ key: K.yes }, { key: K.no }], privateOptions: false,
        });
      }
      if (key === K.no) return removeTrigger(s, f, x, 'declined');
      setField(s, it.play.choices.asPlayed, 'may', true);
      return 'continue';
    }
    const r = chooseNext(s, f, x, it, a.effect, {
      back: backOk(s, f), onBack: () => rollback(s, f, x, 'back'), deflect: (t) => deflectFor(s, t, it.controller),
      onImpossible: () => (a.kind === 'triggered' ? removeTrigger(s, f, x, 'noTargets') : rollback(s, f, x, 'illegal')),
      what: a.id,
    });
    if (r !== 'complete') return r;
    setField(s, it.play, 'step', 2);
    return next(f);
  },

  // Step 3 [404]: the cost.
  (s, f) => {
    const it = itemOf(s, f);
    const a = abilityOf(s, f);
    const c = a.cost ? resourceCost(a.cost, domainsOf(s, it.source!)) : { energy: 0, power: [] };
    // Deflect: [A] per time it chooses an opponent's Deflect object [809.1.c], [356.2.a.2].
    const deflect = Object.values(it.play.choices.executions[0].targets).flat()
      .reduce((n, t) => n + deflectFor(s, t, it.controller), 0);
    const power = [...c.power, ...Array.from({ length: deflect }, () => ({ k: 'any' as const }))];
    setField(s, it.play, 'cost', { energy: c.energy, power, other: a.cost && 'exhaustSelf' in a.cost && a.cost.exhaustSelf
      ? ['exhaustSelf'] : [], components: [] });
    setField(s, it.play, 'step', 3);
    return next(f);
  },

  // Step 4 [405]: [E] exhausts the source [415.4]; Energy and Power from
  // the pool. A trigger's cost may be declined [405.2].
  (s, f, x) => {
    const it = itemOf(s, f);
    const trig = !isActivated(s, f);
    const r = payStep(s, f, x, {
      payer: it.controller, cost: { energy: it.play.cost!.energy, power: it.play.cost!.power }, what: f.ability!,
      item: it.id, ...(it.source !== undefined ? { source: it.source } : {}), back: backOk(s, f),
      onBack: () => rollback(s, f, x, 'back'),
      onDecline: () => (trig ? removeTrigger(s, f, x, 'unpaid') : rollback(s, f, x, 'declined')), rule: trig ? '405.2' : '405.1',
    });
    if (typeof r === 'string') return r;
    if (it.play.cost!.other.includes('exhaustSelf')) {
      const src = s.objects[it.source!];
      if (!src || src.exhausted) return rollback(s, f, x, 'illegal');
      exhaust(s, x, it.controller, [it.source!], '405.1', true);
    }
    setField(s, it.play, 'step', 4);
    return next(f);
  },

  // Step 5 [406]: targets still legal; an activation's timing [381].
  (s, f, x) => {
    const it = itemOf(s, f);
    setField(s, it.play, 'step', 5);
    const a = abilityOf(s, f);
    const ex = it.play.choices.executions[0];
    const c = { controller: it.controller, source: it.source ?? null };
    const bad = slotsOf(a.effect, ex.modes).some((sl) => (ex.targets[sl.id] ?? []).some((t) => !stillLegal(s, t, sl, c)));
    if (bad || !timingOk(s, it)) return a.kind === 'triggered' ? removeTrigger(s, f, x, 'illegal') : rollback(s, f, x, 'illegal');
    return next(f);
  },

  // Step 6 [407]: finalized; it waits on the chain like a spell.
  (s, f, x) => {
    const it = itemOf(s, f);
    finalizeItem(s, x, it);
    countFinalized(s, it);                                           // [383.3.e]
    return 'done';
  },
];

defineSteps('ability', STEPS);
