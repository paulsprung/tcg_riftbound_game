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
import { abilitiesOf, abilityIn } from '../cards/registry.ts';
import { activatedOn } from '../abilities/objAbilities.ts';
import { evalCond } from '../rules/conditions.ts';
import { chooseCostObjects, performCostObjects } from './costObjects.ts';
import { nonStdOf, nonStdPossible } from './cost.ts';
import { addSpecial } from '../rules/actions.ts';
import { countUsage, usageKey } from '../rules/chain.ts';
import { isType, mightOf } from '../rules/chars.ts';
import { K } from '../core/decisions.ts';
import { emit } from '../core/events.ts';
import { answer, ask, awaitTasks, defineSteps, next, type FrameOf, type RunCtx, type StepTable } from '../core/frames.ts';
import type { ActivatedAst, NonStdCostAst, TriggeredAst } from '../dsl/ast.ts';
import { mint, restoreSnapshot, setField, snapshotState } from '../state/mut.ts';
import type { ChainItem, Frame, GameState, Json, ObjId, PlayerId } from '../state/types.ts';
import { countFinalized } from '../abilities/triggers.ts';
import { addItem, finalizeItem, itemById, playContext, removeItem } from '../rules/chain.ts';
import { snapshotOf } from '../rules/chars.ts';
import { goldBonus, paymentPlans } from '../rules/resources.ts';
import { selectAll, slotLocsOf, stillLegal } from '../rules/targets.ts';
import { abilityTiming, timingOk, windowAllows, type Window } from '../rules/timing.ts';
import { choicesPossible, chooseNext, slotObjsOf, slotsOf } from './choices.ts';
import { payStep } from './pay.ts';
import { deflectFor } from './cost.ts';
import { enemyThing, resourceCost } from './playCard.ts';
import { fire } from '../abilities/triggers.ts';
import { append } from '../state/mut.ts';
import { findCard } from '../cards/oracle.ts';

type AbilityFrame = FrameOf<'ability'>;

/** An activation chosen at a priority decision (`act:<obj>#<n>`). */
export const activateFrame = (src: ObjId, ability: string): Frame =>
  ({ f: 'ability', item: 0, pc: 0, snap: null, src, ability });

/** The F row: a pending triggered item continues at step 2. */
export const triggerFrame = (it: ChainItem): Frame =>
  ({ f: 'ability', item: it.id, pc: 2, snap: null, src: it.source ?? null, ability: it.ability ?? null });

const domainsOf = (s: GameState, id: ObjId) => findCard(s.objects[id]?.def ?? '')?.domains ?? [];

/** The printed activated abilities of a definition (the explanations' list). */
export function activatedOf(def: string): ActivatedAst[] {
  return abilitiesOf(def).filter((a): a is ActivatedAst => a.kind === 'activated' && !a.grantedOnly && !a.effectText);
}

/** Whether p may activate this ability of src now [377], [381], [403.3]:
    they control it, the timing allows it, its condition holds ("Use this
    ability only while I'm at a battlefield"), its cost can be paid, and its
    choices can be made. */
export function canActivate(s: GameState, p: PlayerId, src: ObjId, a: ActivatedAst, w: Window): boolean {
  const o = s.objects[src];
  // Black Market: "Each player may use this ability once on their turn (even if they don't control this battlefield)".
  const any = a.anyPlayer === true && s.turn.player === p;
  if (!o || (o.controller !== p && !any) || !['base', 'bf', 'legend'].includes(o.zone.z)) return false;
  if (!windowAllows(w, abilityTiming(a.id))) return false;
  if (a.while && !evalCond(s, a.while, { controller: p, source: src })) return false;
  if (!nonStdPossible(s, nonStdOf(a.cost), src, p)) return false;   // [415.4], [203.3]
  const c = resourceCost(a.cost, domainsOf(s, src));
  const less = a.cost.energyLessBy;
  const known = less === undefined ? 0 : lessByNow(s, less, p, src);
  if (known === null) c.energy = 0;                                  // reduced by the unit chosen: checked as it is paid
  else c.energy = Math.max(0, c.energy - known);                     // "[1] less for each …": known now
  if (paymentPlans(s, p, c, { limit: 1 }).length === 0) return false;
  if (a.limit && (s.usage[usageKey(src, a.id, a.anyPlayer ? p : '*')] ?? 0) >= a.limit.n) return false;   // "Use only once per turn"
  if (a.modesOncePerTurn && a.effect.modes) {
    const left = a.effect.modes.of.filter((_, i) => !(s.usage[usageKey(src, `${a.id}:mode${i}`, '*')] > 0)).length;
    if (left < a.effect.modes.pick) return false;
  }
  return choicesPossible(s, a.effect, { controller: p, source: src });
}

/** An ability's Energy reduction known before its targets ("[1] less for each rune you control", "[3] less if …"); null
    when it depends on a target (Hextech Gauntlets). */
function lessByNow(s: GameState, v: import('../dsl/ast.ts').ValueAst, p: PlayerId, src: ObjId | null): number | null {
  if (typeof v === 'number') return v;
  if (v.v === 'count') return selectAll(s, v.of, { controller: p, source: src }).length;
  if (v.v === 'if') {
    const r = evalCond(s, v.cond, { controller: p, source: src }) ? v.then : v.else;
    return lessByNow(s, r, p, src);
  }
  return null;
}

/** The abilities p could activate now: `act:<obj>#<sub>` (objAbilities.ts). */
export function activatable(s: GameState, p: PlayerId, w: Window): { obj: ObjId; ability: string; sub: string }[] {
  const out: { obj: ObjId; ability: string; sub: string }[] = [];
  const mine = [...s.players[p].legend, ...s.players[p].base, ...s.bfs.flatMap((b) => b.here),
    ...s.bfs.map((b) => b.obj).filter((id) => s.objects[id]?.controller !== p)];   // a battlefield anyone may use (Black Market)
  for (const id of mine) {
    for (const x of activatedOn(s, id)) if (canActivate(s, p, id, x.a, w)) out.push({ obj: id, ability: x.a.id, sub: x.sub });
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
    const ab = abilityOf(s, f);
    const p = ab.kind === 'activated' && ab.anyPlayer && s.turn.priority !== null ? s.turn.priority : src.controller!;
    const item = mint(s, 'item');
    const isAdd = abilityOf(s, f).kind === 'activated' && (abilityOf(s, f) as ActivatedAst).isAdd === true;
    const it: ChainItem = {
      id: item, seq: item, kind: 'activated', sub: 'normal', status: 'pending', controller: p, owner: p, source: f.src!,
      sourceLki: snapshotOf(s, f.src!), ability: f.ability!, isAdd, outcomes: {},
      play: playContext(s, { mode: 'discretionary', origin: src.zone, item, by: p }),
    };
    addItem(s, x, it, { played: !isAdd });
    f.item = item;
    return awaitTasks(f);
  },

  (_s, f) => next(f),

  // Step 2 [403]: a leading "you may", then the targets.
  (s, f, x) => {
    const it = itemOf(s, f);
    const a = abilityOf(s, f);
    const resources = !!a.cost && ((a.cost.energy ?? 0) > 0 || (a.cost.power ?? []).length > 0);
    if (a.kind === 'triggered' && a.may && !resources && it.play.choices.asPlayed.may !== true) {
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
    // A play effect of a permanent played from face down chooses at its battlefield [811.1.d.3].
    const src = it.source !== undefined ? s.objects[it.source] : undefined;
    const restrictBf = a.kind === 'triggered' && a.when.on === 'played' && src?.played?.fromFacedownAt !== undefined
      ? src.played.fromFacedownAt : undefined;
    const modesUsed = a.modesOncePerTurn && it.source !== undefined
      ? (a.effect.modes?.of ?? []).flatMap((_, i) => (s.usage[usageKey(it.source!, `${a.id}:mode${i}`, '*')] > 0 ? [i] : [])) : [];
    const r = chooseNext(s, f, x, it, a.effect, {
      back: backOk(s, f), onBack: () => rollback(s, f, x, 'back'), deflect: (t) => deflectFor(s, t, it.controller),
      onImpossible: () => (a.kind === 'triggered' ? removeTrigger(s, f, x, 'noTargets') : rollback(s, f, x, 'illegal')),
      what: a.id, modesUsed, ...(restrictBf !== undefined ? { restrictBf } : {}),
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
    if (a.cost?.energyLessBy && typeof a.cost.energyLessBy === 'object' && a.cost.energyLessBy.v === 'might') {
      // "This ability's Energy cost is reduced by the Might of the unit you choose" (Hextech Gauntlets).
      const of = a.cost.energyLessBy.of;
      const t = typeof of === 'object' && 'slot' in of ? it.play.choices.executions[0].targets[of.slot]?.[0] : undefined;
      if (t?.k === 'obj' && s.objects[t.id]) c.energy = Math.max(0, c.energy - Math.max(0, mightOf(s, t.id)));
    }
    if (a.cost?.energyLessBy && !(typeof a.cost.energyLessBy === 'object' && a.cost.energyLessBy.v === 'might')) {
      // "This ability costs [1] less for each friendly unit with [Temporary]" (Lillia, Bashful Bloom).
      c.energy = Math.max(0, c.energy - (lessByNow(s, a.cost.energyLessBy, it.controller, it.source ?? null) ?? 0));
    }
    // Deflect: [A] per time it chooses an opponent's Deflect object [809.1.c], [356.2.a.2].
    const deflect = Object.values(it.play.choices.executions[0].targets).flat()
      .reduce((n, t) => n + deflectFor(s, t, it.controller), 0);
    const power = [...c.power, ...Array.from({ length: deflect }, () => ({ k: 'any' as const }))];
    const ns = nonStdOf(a.cost);
    setField(s, it.play, 'cost', { energy: c.energy, power, other: ns ? [ns as unknown as Json] : [], components: [] });
    setField(s, it.play, 'step', 3);
    return next(f);
  },

  // Step 4 [405]: the objects of a non-standard cost, Energy and Power from
  // the pool, then the cost's actions ([E] exhausts the source [415.4],
  // "Kill this", "Recycle 1 from your trash" …). A trigger's cost may be
  // declined [405.2].
  (s, f, x) => {
    const it = itemOf(s, f);
    const trig = !isActivated(s, f);
    const ns = it.play.cost!.other[0] as unknown as NonStdCostAst | undefined;
    if (ns) {
      if (!nonStdPossible(s, ns, it.source ?? null, it.controller)) {
        return trig ? removeTrigger(s, f, x, 'unpaid') : rollback(s, f, x, 'illegal');
      }
      const r = chooseCostObjects(s, f, x, { item: it, src: it.source ?? null, key: f.ability!, pay: ns, what: f.ability!,
        back: backOk(s, f), onBack: () => rollback(s, f, x, 'back'),
        onImpossible: () => (trig ? removeTrigger(s, f, x, 'unpaid') : rollback(s, f, x, 'illegal')) });
      if (r !== 'complete') return r;
    }
    const r = payStep(s, f, x, {
      payer: it.controller, cost: { energy: it.play.cost!.energy, power: it.play.cost!.power }, what: f.ability!,
      item: it.id, ...(it.source !== undefined ? { source: it.source } : {}), back: backOk(s, f),
      onBack: () => rollback(s, f, x, 'back'),
      onDecline: () => (trig ? removeTrigger(s, f, x, 'unpaid') : rollback(s, f, x, 'declined')), rule: trig ? '405.2' : '405.1',
      spell: it.source !== undefined && s.objects[it.source] && isType(s.objects[it.source], 'gear') ? 'gear' : false,
    });
    if (typeof r === 'string') return r;
    if (ns && !performCostObjects(s, x, it, f.ability!, it.source ?? null, ns)) {
      return trig ? removeTrigger(s, f, x, 'unpaid') : rollback(s, f, x, 'illegal');
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
    const c = { controller: it.controller, source: it.source ?? null, slotLoc: slotLocsOf(s, ex), lkiHere: it.sourceLki?.loc ?? null,
      slotObjs: slotObjsOf(ex), subject: typeof it.trigger?.subject === 'number' ? it.trigger.subject : null,
      eventBf: typeof it.trigger?.bf === 'number' ? it.trigger.bf : null,
      eventFrom: it.trigger?.from && typeof it.trigger.from === 'object' ? it.trigger.from as unknown as import('../state/types.ts').Loc : null };
    const bad = slotsOf(a.effect, ex.modes).some((sl) => (ex.targets[sl.id] ?? []).some((t) => !stillLegal(s, t, sl, c)));
    if (bad || !timingOk(s, it)) return a.kind === 'triggered' ? removeTrigger(s, f, x, 'illegal') : rollback(s, f, x, 'illegal');
    return next(f);
  },

  // Step 6 [407]: finalized; it waits on the chain like a spell. An Add
  // ability resolves at once [430.2]; Udyr's modes are spent for the turn.
  (s, f, x) => {
    const it = itemOf(s, f);
    finalizeItem(s, x, it);
    countFinalized(s, it);                                           // [383.3.e]
    const a = abilityOf(s, f);
    const srcObj = it.source !== undefined ? s.objects[it.source] : undefined;
    if (a.kind === 'activated' && a.limit && it.source !== undefined) countUsage(s, usageKey(it.source, a.id, a.anyPlayer ? it.controller : '*'));   // "Use only once per turn"
    if (!it.isAdd && srcObj && (isType(srcObj, 'unit') || isType(srcObj, 'gear'))) {
      // What a unit's or gear's ability chose ("with spells or unit abilities", "When you choose a friendly unit").
      const chosen = [...new Set(it.play.choices.executions.flatMap((ex) => Object.values(ex.targets).flat())
        .flatMap((t) => (t.k === 'obj' && s.objects[t.id] ? [t.id] : [])))];
      if (isType(srcObj, 'unit')) for (const obj of chosen) append(s, s.log.targeted, { item: it.id, by: it.controller, obj, spell: false, enemy: enemyThing(s, obj, it.controller) });
      if (chosen.length > 0) fire(s, x, { e: 'chosen', p: it.controller, objs: chosen, spell: false });
      if (a.kind === 'activated' && isType(srcObj, 'gear')) fire(s, x, { e: 'gearAbility', p: it.controller, source: srcObj.id });
    }
    if (a.modesOncePerTurn && it.source !== undefined) {
      for (const m of it.play.choices.executions[0].modes) countUsage(s, usageKey(it.source, `${a.id}:mode${m}`, '*'));
    }
    if (a.kind === 'activated' && a.isAdd) {
      if (a.id === 'gold#0' && goldBonus(s, it.controller)) addSpecial(s, x, it.controller, { energy: 1, source: 'gold' }, '430.2');
      for (const ins of a.effect.body) {
        if (ins.op !== 'add') continue;
        addSpecial(s, x, it.controller, { energy: ins.energy, universal: ins.power, onlyFor: ins.onlyFor,
          source: s.objects[it.source!]?.def ?? '', ...(ins.domain ? { domain: ins.domain } : {}) }, '430.2');
      }
      removeItem(s, x, it.id);
    }
    return 'done';
  },
];

defineSteps('ability', STEPS);
