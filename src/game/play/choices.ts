/*
 * The choices of step 2 that cards and abilities share [355.3], [355.5–
 * 355.13], [403.2]: modes, then each target slot in order, every pick its
 * own decision. A slot's picks form one batch (§4.7): "up to two units" is
 * pick, pick, or Done once the minimum is met [355.13].
 *
 * The step is re-entrant (gather, then commit): what to ask next follows
 * from the choices recorded so far on the item, so an answer always belongs
 * to the question that is open now.
 */
import type { ModeAst, ProgAst, SlotAst } from '../dsl/ast.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { answer, ask, type RunCtx, type StepOut } from '../core/frames.ts';
import { setField } from '../state/mut.ts';
import type { ChainItem, Frame, GameState, Loc, ObjId, PlayerId, TargetRef } from '../state/types.ts';
import { slotCandidates, slotItemCandidates, slotLocsOf, slotMax, slotMin, targetRef, type SelCtx } from '../rules/targets.ts';
import { evalCond, type CondCtx } from '../rules/conditions.ts';
import { isType, mightOf } from '../rules/chars.ts';
import { staticsFor } from '../layers/derive.ts';
import { locOf } from '../state/zones.ts';

/** The slots an item chooses: its program's own, then each chosen mode's,
    modes in printed order [355.3]. */
export function slotsOf(prog: ProgAst | undefined, modes: readonly number[]): SlotAst[] {
  if (!prog) return [];
  const chosen: ModeAst[] = (prog.modes?.of ?? []).filter((_, i) => modes.includes(i));
  return [...(prog.choose ?? []), ...chosen.flatMap((m) => m.choose ?? [])];
}

export interface ChoiceCtx { controller: PlayerId; source?: ObjId | null;
  /** Played from face down: targets at this battlefield [811.1.d.2–3]. */
  restrictBf?: number;
  /** For a slot's `if`: the item's facts and outcomes. */
  cond?: CondCtx }

/** The candidates of a slot as this item may choose them: at the
    battlefield a card was played from face down, unless the slot is free of
    that restriction [811.1.d]. */
export function candidatesFor(s: GameState, slot: SlotAst, it: ChoiceCtx, c: SelCtx): ObjId[] {
  // "I can't be chosen by enemy spells and abilities" (Ruin Runner).
  const all = slotCandidates(s, slot, c).filter((id) => s.objects[id].controller === it.controller
    || (staticsFor(s, id, 'noEnemyChoose').length === 0
      // Twilight Shroud: "It can't be chosen by enemy spells and abilities this turn."
      && !s.effects.some((e) => (e.spec as { s?: string } | null)?.s === 'noEnemyChoose' && 'objs' in e.affects && e.affects.objs.includes(id))));
  if (it.restrictBf === undefined || slot.freeFromHidden) return all;
  const bf = it.restrictBf;
  return all.filter((id) => {
    const o = s.objects[id];
    if (s.bfs[bf].obj === id) return true;
    if (o.zone.z === 'base' || o.zone.z === 'bf') return o.zone.z === 'bf' && o.zone.bf === bf;
    return true;                                                     // cards in a trash, spells: no location
  });
}

/** Whether a slot is chosen at all: a [Level] part's target only while it applies. */
const slotActive = (s: GameState, slot: SlotAst, it: ChoiceCtx) =>
  !slot.if || evalCond(s, slot.if, it.cond ?? { controller: it.controller, source: it.source ?? null });

/** A slot whose candidates depend on what another slot chose ("an enemy unit at the same battlefield"): it can't be
    judged before that one is chosen. */
const dependent = (sl: SlotAst) => sl.sel.some((x) => typeof x.at === 'object');

/** Whether a mode can be chosen: every slot it must fill has a candidate
    [355.16]; a mode Udyr chose this turn is gone. */
export function modeLegal(s: GameState, m: ModeAst, it: ChoiceCtx): boolean {
  const c = { controller: it.controller, source: it.source ?? null };
  return (m.choose ?? []).every((sl) => {
    if (sl.dest) return sl.dest.to !== 'open' || s.bfs.some((b) => b.controller === null    // an open battlefield [170.11.c]
      && !b.here.some((id) => isType(s.objects[id], 'unit')));
    return !slotActive(s, sl, it) || slotMin(sl) === 0 || dependent(sl) || (sl.if !== undefined && sl.if.c !== 'xp')
      || candidatesFor(s, sl, it, c).length + slotItemCandidates(s, sl, c).length >= slotMin(sl);
  });
}

/** Whether a program's choices can all be made now (the cheap stage of
    §4.6): enough legal modes, and a candidate for every slot that must be
    filled. */
export function choicesPossible(s: GameState, prog: ProgAst | undefined, it: ChoiceCtx): boolean {
  if (!prog) return true;
  const c = { controller: it.controller, source: it.source ?? null };
  // A slot under a condition that may still change ("If you paid the additional cost, choose … instead") is judged as it is chosen.
  if (!(prog.choose ?? []).every((sl) => sl.dest || !slotActive(s, sl, it) || slotMin(sl) === 0 || dependent(sl)
    || (sl.if !== undefined && sl.if.c !== 'xp') || candidatesFor(s, sl, it, c).length + slotItemCandidates(s, sl, c).length >= slotMin(sl))) return false;
  if (prog.modes) return prog.modes.of.filter((m) => modeLegal(s, m, it)).length >= prog.modes.pick;
  return true;
}

/** Where the units a destination slot's `of` slot chose may move [355.4.a],
    [449.2]: any other location (their controller's base, a battlefield), as
    the slot limits it. */
export function destCandidates(s: GameState, slot: SlotAst, units: ObjId[], p?: PlayerId): Loc[] {
  const d = slot.dest!;
  const u = units[0] === undefined ? undefined : s.objects[units[0]];
  if (!u) return [];
  const at = locOf(u);
  const out: Loc[] = [];
  const base: Loc = { z: 'base', p: u.controller ?? u.owner };
  if (d.to === 'withFriends') {                                      // "a location where there's a unit with the same controller"
    const ctl = u.controller;
    const has = (ids: ObjId[]) => ids.some((id) => id !== u.id && isType(s.objects[id], 'unit') && s.objects[id].controller === ctl);
    if (ctl !== null && has(s.players[ctl].base)) out.push(base);
    s.bfs.forEach((b, bf) => { if (has(b.here)) out.push({ z: 'bf', bf }); });
    return out.filter((l) => !at || !(l.z === at.z && (l.z === 'base' ? l.p === (at as typeof l).p : l.bf === (at as typeof l).bf)));
  }
  if (d.to === 'toOrFromBase') {                                     // "to or from its base"
    if (at?.z === 'base') s.bfs.forEach((_, bf) => out.push({ z: 'bf', bf }));
    else out.push(base);
    return out;
  }
  if ((d.to ?? 'any') === 'any' || d.to === 'base') out.push(base);
  if (d.to !== 'base') {
    s.bfs.forEach((b, bf) => {
      if (d.to === 'open' && (b.controller !== null || b.here.some((id) => isType(s.objects[id], 'unit')))) return;   // [170.11.c]
      if (d.to === 'controlled' && (b.controller === null || b.controller !== u.controller)) return;   // "a battlefield you control"
      // "an occupied enemy battlefield": controlled by an opponent, with units [170.11.a].
      // "a battlefield where you have units" (the choosing player).
      if (d.to === 'yourUnits' && !b.here.some((id) => isType(s.objects[id], 'unit') && s.objects[id].controller === (p ?? u.controller))) return;
      if (d.to === 'occupiedEnemy' && (b.controller === null || b.controller === u.controller
        || !b.here.some((id) => isType(s.objects[id], 'unit')))) return;
      out.push({ z: 'bf', bf });
    });
  }
  return out.filter((l) => !at || !(l.z === at.z && (l.z === 'base' ? l.p === (at as typeof l).p : l.bf === (at as typeof l).bf)));
}

const doneKey = (slot: string) => `slot:${slot}`;

/** What each slot of an execution chose, as objects ("with less Might than the chosen unit"). */
export const slotObjsOf = (ex: { targets: Record<string, TargetRef[]> } | undefined): Record<string, ObjId[]> =>
  Object.fromEntries(Object.entries(ex?.targets ?? {}).map(([k, ts]) => [k, ts.flatMap((t) => (t.k === 'obj' ? [t.id] : []))]));

/** Whether choosing `id` for a slot leaves the later slots that depend on it something to choose: a destination
    for the unit it moves, a candidate at the battlefield it names ("Choose a battlefield and an enemy unit there").
    A choice that makes the play impossible isn't offered (§4.6). */
function leavesChoices(s: GameState, slots: SlotAst[], slot: SlotAst, id: ObjId, it: ChoiceCtx, c: SelCtx): boolean {
  for (const sl of slots) {
    if (sl === slot || slotMin(sl) === 0 || !slotActive(s, sl, it)) continue;
    if (sl.dest?.of === slot.id && slotMin(slot) <= 1 && destCandidates(s, sl, [id], it.controller).length === 0) return false;
    if (!sl.dest && sl.sel.some((x) => typeof x.at === 'object' && x.at.slot === slot.id)) {
      const bf = s.bfs.findIndex((b) => b.obj === id);
      const o = s.objects[id];
      const loc = bf >= 0 ? { z: 'bf' as const, bf } : o ? locOf(o) : null;
      const cc: SelCtx = { ...c, slotLoc: { ...(c.slotLoc ?? {}), [slot.id]: loc } };
      if (candidatesFor(s, sl, it, cc).filter((x) => x !== id).length < slotMin(sl)) return false;
    }
  }
  return true;
}

export interface ChooseOpts {
  /** Offer 'back' (a discretionary play or activation, §4.4). */
  back: boolean;
  onBack: () => StepOut;
  /** No legal choice is left for something that must be chosen. */
  onImpossible: () => StepOut;
  /** For the prompt: the card or ability. */
  what: string;
  /** Whether the cost stays payable with this target chosen (a Deflect
      target adds [A] [809.1.c]); targets that make it unpayable are not
      offered (§4.6). */
  affordable?: (t: TargetRef) => boolean;
  /** The [A]s a target adds (OptionMeta.deflect). */
  deflect?: (t: TargetRef) => number;
  /** Which execution's choices (0, or a paid Repeat's [820.2]). */
  exec?: number;
  /** Played from face down [811.1.d]. */
  restrictBf?: number;
  /** What a slot's `if` reads. */
  cond?: CondCtx;
  /** Modes already chosen this turn ("Choose one you've not chosen this turn"). */
  modesUsed?: number[];
}

/**
 * Asks the next open choice of the item's program, or returns 'complete'
 * once modes and targets are all chosen.
 */
export function chooseNext(s: GameState, f: Frame, x: RunCtx, it: ChainItem, prog: ProgAst | undefined, o: ChooseOpts):
  StepOut | 'complete' {
  if (!prog) return 'complete';
  const e = o.exec ?? 0;
  const ex = it.play.choices.executions[e];
  const done = (slot: string) => (e === 0 ? doneKey(slot) : `${doneKey(slot)}#${e}`);
  const cctx: ChoiceCtx = { controller: it.controller, source: it.source ?? null,
    ...(o.restrictBf !== undefined ? { restrictBf: o.restrictBf } : {}), ...(o.cond ? { cond: o.cond } : {}) };
  const c: SelCtx = { controller: it.controller, source: it.source ?? null, slotLoc: slotLocsOf(s, ex), slotObjs: slotObjsOf(ex),
    lkiHere: it.sourceLki?.loc ?? null,                              // "here" of a Deathknell: where its source died
    subject: typeof it.trigger?.subject === 'number' ? it.trigger.subject : null,
    eventBf: typeof it.trigger?.bf === 'number' ? it.trigger.bf : null,
    eventFrom: it.trigger?.from && typeof it.trigger.from === 'object' ? it.trigger.from as unknown as Loc : null };
  const usedModes = (o.modesUsed ?? []);

  // Modes [355.3].
  if (prog.modes && ex.modes.length < prog.modes.pick) {
    const open = prog.modes.of.map((m, i) => ({ m, i }))
      .filter(({ m, i }) => !ex.modes.includes(i) && !usedModes.includes(i) && modeLegal(s, m, cctx));
    const key = answer(f);
    if (key === K.back) return o.onBack();
    if (open.length < prog.modes.pick - ex.modes.length) return o.onImpossible();
    if (key === undefined) {
      const options: Option[] = open.map(({ i }) => ({ key: K.mode(i) }));
      return ask(s, f, x, {
        player: it.controller, kind: 'mode',
        prompt: { t: 'mode', card: o.what, pick: prog.modes.pick, chosen: ex.modes.slice(),
          labels: prog.modes.of.map((m) => m.label) },
        ctx: { item: it.id, ...(it.obj !== undefined ? { source: it.obj } : {}), rule: '355.3' }, options,
        privateOptions: false, back: o.back, batch: `mode:item${it.id}`,
      });
    }
    const n = parseKey(key)!.n!;
    setField(s, ex, 'modes', [...ex.modes, n].sort((a, b) => a - b));
    return 'continue';
  }

  // Targets, slot by slot [355.5–355.13]; destinations after the units they
  // move [355.4]. The answer is taken only by the slot it belongs to (a
  // later execution's choices may follow in the same step).
  const key = f.answer;
  if (key === K.back) { answer(f); return o.onBack(); }
  for (const slot of slotsOf(prog, ex.modes)) {
    if (it.play.choices.asPlayed[done(slot.id)] === true) continue;
    if (key !== undefined) answer(f);
    if (!slotActive(s, slot, cctx)) {
      setField(s, it.play.choices.asPlayed, done(slot.id), true);
      return 'continue';
    }
    if (slot.dest) {
      const units = (ex.targets[slot.dest.of] ?? []).flatMap((t) => (t.k === 'obj' ? [t.id] : []));
      const dests = destCandidates(s, slot, units, it.controller);
      if (units.length === 0 || dests.length === 0) {
        if (units.length > 0 && slotMin(slot) > 0) return o.onImpossible();
        setField(s, it.play.choices.asPlayed, done(slot.id), true);
        return 'continue';
      }
      if (key === undefined) {
        return ask(s, f, x, {
          player: it.controller, kind: 'destination', prompt: { t: 'destination', card: o.what, slot: slot.id },
          ctx: { item: it.id, ...(it.obj !== undefined ? { source: it.obj } : {}), slot: slot.id, rule: '355.4' },
          options: dests.map((l) => ({ key: l.z === 'base' ? K.locBase : K.locBf(l.bf), refs: [{ loc: l }] })),
          privateOptions: false, back: o.back,
        });
      }
      const k = parseKey(key)!;
      const loc = k.loc === 'base' ? dests.find((l) => l.z === 'base')! : { z: 'bf' as const, bf: (k.loc as { bf: number }).bf };
      setField(s, ex.dests, slot.id, loc);
      setField(s, it.play.choices.asPlayed, done(slot.id), true);
      return 'continue';
    }
    const chosen = (ex.targets[slot.id] ?? []).map((t) => (t.k === 'obj' ? t.id : -1));
    const others = (slot.distinctFrom ?? []).flatMap((sl) => (ex.targets[sl] ?? []).map((t) => (t.k === 'obj' ? t.id : -1)));
    const total = chosen.reduce((n, id) => n + (s.objects[id] ? Math.max(0, mightOf(s, id)) : 0), 0);
    const all = slotsOf(prog, ex.modes);
    const cands = candidatesFor(s, slot, cctx, c).filter((id) => !chosen.includes(id) && !others.includes(id)
      && (!o.affordable || o.affordable(targetRef(s, id)))
      && (slot.sumMightMax === undefined || total + Math.max(0, mightOf(s, id)) <= slot.sumMightMax)
      && (!slot.oneEachLoc || !chosen.some((u) => s.objects[u] && JSON.stringify(locOf(s.objects[u])) === JSON.stringify(locOf(s.objects[id]))))
      && leavesChoices(s, all, slot, id, cctx, c));
    // "a spell or ability": finalized ability items too [355.9.a.2].
    const chosenItems = (ex.targets[slot.id] ?? []).flatMap((t) => (t.k === 'item' ? [t.id] : []));
    const items = slotItemCandidates(s, slot, c).filter((id) => !chosenItems.includes(id));
    const enough = chosen.length >= slotMin(slot);
    if (chosen.length >= slotMax(slot) || (enough && cands.length === 0 && items.length === 0)) {
      setField(s, it.play.choices.asPlayed, done(slot.id), true);
      return 'continue';
    }
    if (!enough && cands.length === 0 && items.length === 0) return o.onImpossible();
    if (key === undefined) {
      const options: Option[] = cands.map((id: ObjId) => {
        const d = o.deflect?.(targetRef(s, id)) ?? 0;
        return { key: K.t(id), refs: [{ obj: id }], ...(d > 0 ? { meta: { deflect: d } } : {}) };
      });
      for (const id of items) options.push({ key: K.tItem(id), refs: [{ item: id }] });
      if (enough) options.push({ key: K.done });
      return ask(s, f, x, {
        player: it.controller, kind: 'target',
        prompt: { t: 'target', card: o.what, slot: slot.id, chosen: chosen.length, min: slotMin(slot), max: slotMax(slot),
          harm: slot.harm ?? false },
        ctx: { item: it.id, ...(it.obj !== undefined ? { source: it.obj } : {}), slot: slot.id, rule: '355.5' }, options,
        privateOptions: false, back: o.back, batch: `target:item${it.id}:slot:${slot.id}`,
      });
    }
    if (key === K.done) {
      setField(s, it.play.choices.asPlayed, done(slot.id), true);
      return 'continue';
    }
    const pk = parseKey(key)!;
    if (pk.item !== undefined) {
      setField(s, ex.targets, slot.id, [...(ex.targets[slot.id] ?? []), { k: 'item', id: pk.item }]);
      return 'continue';
    }
    const id = pk.obj!;
    setField(s, ex.targets, slot.id, [...(ex.targets[slot.id] ?? []), targetRef(s, id)]);
    return 'continue';
  }
  return 'complete';
}
