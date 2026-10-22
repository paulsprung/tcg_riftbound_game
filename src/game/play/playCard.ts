/*
 * The process of playing a card or a token (§5.6, Spec D, [349–359]): six
 * steps, each of its choices a decision of its own.
 *
 *   S0     a discretionary play [420.2]: snapshot BEFORE step 1, so a
 *          rollback puts the card back where it was with its old ObjId
 *          (fix F1, [358.5])
 *   1      the card moves to the chain as a new object [354], [124]; the
 *          state Closes [354.1]; the Play action is logged [420.5]; the
 *          cleanup this makes outstanding runs before step 2 [354.4] (fix
 *          F2: the frame waits for tasks). A limited play [420.3] (an
 *          instruction says "play …") does step 1 inside that instruction
 *          (putOnChain), and the master loop's F row starts this frame at
 *          step 2 once the instructing item has resolved [354.3]
 *   S2     a limited play: snapshot as step 2 begins (Spec D §8.5)
 *   2      choices [355]: a unit's location (its controller's base or a
 *          battlefield they control [355.2.a]), Deploy gear's battlefield
 *          [830.1.b], a spell's modes [355.3] and targets [355.5]
 *   3      the total cost [356]: the printed cost, or what the instructing
 *          effect says ("for [Y]", tokens: nothing [185.3.a.1])
 *   4      payment [357] (play/pay.ts); declining undoes the play [445.2.a]
 *   5      legality [358]: choices still legal, timing [358.4]
 *   6      finalize [359]: a permanent leaves the chain at once and enters
 *          the board [337.2], [359.2] (a unit exhausted at its location, gear
 *          ready at base, Deploy gear at its battlefield), Played is logged
 *          and its Play Effects trigger [383.4.a.2]; a spell becomes a
 *          finalized item and waits for the players to pass [359.3]
 *
 * Rollback. A discretionary play goes back to S0 (`back` in steps 1–4,
 * `decline`, a failed step 5). A limited play has no `back`: it goes back
 * to S2 and its card returns to where it came from with the identity it
 * had there; a token whose play fails ceases to exist (Spec D §8.5, OQ-6).
 */
import { cardDef } from '../cards/registry.ts';
import { findCard } from '../cards/oracle.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { emit, emitZone, knowers } from '../core/events.ts';
import { answer, ask, awaitTasks, defineSteps, next, type FrameOf, type RunCtx, type StepTable } from '../core/frames.ts';
import type { CostAst } from '../dsl/ast.ts';
import {
  append, createObject, deleteObject, mint, moveObject, restoreSnapshot, setField, setSnap2, snapshotState,
} from '../state/mut.ts';
import { Z } from '../state/zones.ts';
import type {
  ChainItem, Domain, Frame, GameState, ItemId, Json, Loc, ObjId, PlayedRecord, PlayerId, PowerReq, TokenId,
} from '../state/types.ts';
import { fire } from '../abilities/triggers.ts';
import { applyContested } from '../rules/actions.ts';
import { addItem, finalizeItem, itemById, playContext, removeItem } from '../rules/chain.ts';
import { energyCostOf, hasKeyword, isType, typesOf } from '../rules/chars.ts';
import { paymentPlans, type ResourceCost } from '../rules/resources.ts';
import { stillLegal } from '../rules/targets.ts';
import { cardTiming, timingOk, windowAllows, type Window } from '../rules/timing.ts';
import { requestCleanup } from '../rules/tasks.ts';
import { choicesPossible, chooseNext, slotsOf } from './choices.ts';
import { payStep } from './pay.ts';

type PlayFrame = FrameOf<'play'>;

/** The frame that plays a card the player chose at a priority decision. */
export const playFrame = (obj: ObjId): Frame => ({ f: 'play', item: null, obj, pc: 0, snap: null, revealed: false,
  rngUsed: false });

/** The frame that finishes a limited play from step 2 (the F row). */
export const limitedPlayFrame = (it: ChainItem): Frame => ({ f: 'play', item: it.id, obj: it.obj!, pc: 1, snap: null,
  revealed: false, rngUsed: false });

/** What an instruction that plays something changes about the play
    [420.3.b] (PlayContext.instructedBy.overrides). */
export interface PlayOverrides {
  /** Where it is played, fixed by the instruction ("to your base", "here"). */
  at?: Loc;
  /** The cost instead of the printed one ("for [Y]"); tokens cost nothing. */
  cost?: { energy: number; power: PowerReq[] };
  /** The card's ObjId before step 1, so a failed play returns it as it was. */
  origId?: ObjId;
}

const overridesOf = (it: ChainItem): PlayOverrides => (it.play.instructedBy?.overrides ?? {}) as PlayOverrides;

/** A cost of the effect language as resources [131]. 'C' is one of the
    card's domains [135.2.e.6.c]. */
export function resourceCost(c: CostAst, domains: Domain[]): ResourceCost {
  const power: PowerReq[] = (c.power ?? []).map((r) => (r === 'A' ? { k: 'any' }
    : r === 'C' ? (domains.length === 1 ? { k: 'domain', d: domains[0] } : domains.length === 0 ? { k: 'any' }
      : { k: 'anyOf', ds: domains.slice() }) : { k: 'domain', d: r }));
  return { energy: c.energy ?? 0, power };
}

/** A card's printed cost [131]. */
export function costOf(s: GameState, id: ObjId): ResourceCost {
  const c = findCard(s.objects[id].def)?.cost;
  return { energy: c?.energy ?? 0, power: c?.power ?? [] };
}

/** Where a unit may be played: its controller's base, or a battlefield
    they control [355.2.a]. */
export function unitLocations(s: GameState, p: PlayerId): Loc[] {
  return [{ z: 'base', p }, ...s.bfs.flatMap((b, bf): Loc[] => (b.controller === p ? [{ z: 'bf', bf }] : []))];
}

/** Where a permanent may be played: units as above; Deploy gear to any
    battlefield and only there [830.1.b.1–2]; other gear to base [359.2.d]. */
export function playLocations(s: GameState, id: ObjId, p: PlayerId): Loc[] {
  const o = s.objects[id];
  if (isType(o, 'unit')) return unitLocations(s, p);
  if (isType(o, 'gear')) {
    return hasKeyword(s, id, 'deploy') ? s.bfs.map((_, bf): Loc => ({ z: 'bf', bf })) : [{ z: 'base', p }];
  }
  return [];
}

/** A spell needs a definition to be played: without one it has nothing to
    execute. Units and gear without one are vanilla bodies. */
export function playable(s: GameState, id: ObjId): boolean {
  const o = s.objects[id];
  if (isType(o, 'unit') || isType(o, 'gear')) return true;
  return isType(o, 'spell') && cardDef(o.def)?.spell !== undefined;
}

/** The domains the cards in p's hand need Power of, for payment ranking. */
export function domainsNeeded(s: GameState, p: PlayerId, except: ObjId | null = null): Domain[] {
  const out: Domain[] = [];
  for (const id of s.players[p].hand) {
    if (id === except) continue;
    for (const req of costOf(s, id).power) if (req.k === 'domain' && !out.includes(req.d)) out.push(req.d);
  }
  return out;
}

/**
 * The cards p may start to play now from hand or the Champion Zone
 * [420.1.a]: a definition to execute, timing for this window (§5.5), a way
 * to pay, and choices that can be made (the cheap stage of §4.6; the
 * priority decision's feasibility filter completes it, core/feasible.ts).
 */
export function playableCards(s: GameState, p: PlayerId, w: Window = 'main'): ObjId[] {
  const pl = s.players[p];
  const from = [...pl.hand, ...(pl.champion === null ? [] : [pl.champion])];
  return from.filter((id) => {
    const o = s.objects[id];
    if (!playable(s, id) || !windowAllows(w, cardTiming(o.def))) return false;
    if (paymentPlans(s, p, costOf(s, id), { limit: 1 }).length === 0) return false;
    if (isType(o, 'spell')) return choicesPossible(s, cardDef(o.def)!.spell, { controller: p, source: null });
    return playLocations(s, id, p).length > 0;
  });
}

const itemOf = (s: GameState, f: PlayFrame): ChainItem => itemById(s, f.item!)!;
const backOk = (s: GameState, f: PlayFrame) => !f.revealed && !f.rngUsed && itemOf(s, f).play.mode === 'discretionary';

/**
 * Step 1 of a play, for a card an instruction plays or a token it makes
 * [354], [420.3], [440.2.c]: a Pending item on the chain. Its other steps
 * wait until the instructing item has resolved and the tasks are done.
 */
export function putOnChain(s: GameState, x: { present: boolean }, o: {
  obj: ObjId | { token: TokenId; owner: PlayerId }; controller: PlayerId; by: { item: ItemId; instr: string };
  overrides: PlayOverrides;
}): ChainItem {
  const item = mint(s, 'item');
  let obj: ObjId, origin: ChainItem['play']['origin'], owner: PlayerId, card: number | null, kind: ChainItem['kind'];
  const overrides: PlayOverrides = { ...o.overrides };
  if (typeof o.obj === 'number') {
    const c = s.objects[o.obj];
    origin = structuredClone(c.zone);
    owner = c.owner;
    card = c.card;
    kind = 'card';
    overrides.origId = o.obj;
    const before = knowers(s, [o.obj]);
    obj = moveObject(s, o.obj, { z: 'chain', item }, { controller: o.controller });
    emitZone(s, x, { obj, prev: o.obj, from: origin, to: { z: 'chain', item }, why: 'play', rule: '354', before });
  } else {
    // "Play a token": created on the chain and played [440.2.c], [185.2.a];
    // owned by the controller of the effect that made it [183].
    origin = { z: 'chain', item };
    owner = o.obj.owner;
    card = null;
    kind = 'token';
    obj = createObject(s, { def: o.obj.token, printing: null, owner, zone: { z: 'chain', item }, token: true,
      controller: o.controller }).id;
    overrides.cost = { energy: 0, power: [] };
  }
  const it: ChainItem = {
    id: item, seq: item, kind, sub: 'normal', status: 'pending', controller: o.controller, owner, obj, isAdd: false,
    outcomes: {},
    play: playContext(s, { mode: 'limited', origin, item, by: o.controller,
      instructedBy: { item: o.by.item, instr: o.by.instr, overrides: overrides as unknown as Json } }),
  };
  addItem(s, x, it, { played: false });
  append(s, s.log.playActions, { p: o.controller, item, card, isCard: kind === 'card' });   // [420.5]
  return it;
}

/** Undoes a discretionary play [358.5], [445.2.a]: back to S0, the card
    where it was. Not a counter. */
function rollback(s: GameState, f: PlayFrame, x: RunCtx, reason: 'back' | 'illegal' | 'declined') {
  const item = f.item;
  const it = item === null ? null : itemOf(s, f);
  if (it && it.play.mode === 'limited') return rollbackLimited(s, f, x, reason);
  restoreSnapshot(s, f.snap!);
  if (reason === 'illegal' && item !== null) emit(s, x, { k: 'playFailed', item, reason: 'legality', rule: '358.5' });
  emit(s, x, { k: 'rollback', reason, rule: reason === 'declined' ? '445.2.a' : '358.5' });
  x.rollbacks = (x.rollbacks ?? 0) + 1;
  return 'done' as const;
}

/**
 * Undoes a limited play (Spec D §8.5): back to S2, so the instructing
 * item's own actions stand; the card goes back to where it came from as if
 * step 1 never happened (same identity, no triggers), a token ceases to
 * exist [186.1], and the item and what it caused are gone.
 */
function rollbackLimited(s: GameState, f: PlayFrame, x: RunCtx, reason: 'back' | 'illegal' | 'declined') {
  const it = itemOf(s, f);
  const id = it.id;
  if (it.play.snap2) restoreSnapshot(s, it.play.snap2);
  const again = itemById(s, id)!;
  const o = overridesOf(again);
  const card = s.objects[again.obj!];
  if (card.token) deleteObject(s, card.id);
  else {
    const origin = again.play.origin;
    const back = moveObject(s, card.id, origin, { reuseId: o.origId, ...(origin.z === 'deck' ? { pos: 'top' as const } : {}) });
    emitZone(s, x, { obj: back, prev: card.id, from: { z: 'chain', item: id }, to: origin, why: 'playFailed', rule: '358.5',
      before: knowers(s, [back]) });
  }
  removeItem(s, x, id);
  emit(s, x, { k: 'playFailed', item: id, reason: reason === 'declined' ? 'declined' : 'legality', rule: '358.5' });
  emit(s, x, { k: 'rollback', reason, rule: reason === 'declined' ? '445.2.a' : '358.5' });
  x.rollbacks = (x.rollbacks ?? 0) + 1;
  return 'done' as const;
}

const spellProg = (s: GameState, it: ChainItem) => cardDef(s.objects[it.obj!].def)?.spell;

const STEPS: StepTable<PlayFrame> = [
  // Step 1 [354], with S0 taken first (fix F1).
  (s, f, x) => {
    f.snap = snapshotState(s);
    const card = s.objects[f.obj];
    const p = card.owner;
    const origin = structuredClone(card.zone);
    const item = mint(s, 'item');
    const before = knowers(s, [f.obj]);
    const it: ChainItem = {
      id: item, seq: item, kind: 'card', sub: 'normal', status: 'pending', controller: p, owner: card.owner, obj: -1,
      isAdd: false, outcomes: {}, play: playContext(s, { mode: 'discretionary', origin, item, by: p }),
    };
    const obj = moveObject(s, f.obj, { z: 'chain', item }, { controller: p });
    addItem(s, x, { ...it, obj }, { played: true });
    append(s, s.log.playActions, { p, item, card: card.card, isCard: true });   // [420.5]
    emitZone(s, x, { obj, prev: f.obj, from: origin, to: { z: 'chain', item }, why: 'play', rule: '354', before });
    f.obj = obj;
    f.item = item;
    return awaitTasks(f);                                             // [354.4]
  },

  // S2 for a limited play (Spec D §8.5); a discretionary play goes on.
  (s, f) => {
    const it = itemOf(s, f);
    if (it.play.mode === 'limited' && !it.play.snap2) setSnap2(s, it.play, snapshotState(s));
    return next(f);
  },

  // Step 2 [355]: location, then modes and targets.
  (s, f, x) => {
    const it = itemOf(s, f);
    const o = s.objects[f.obj];
    const spell = isType(o, 'spell');
    if (!spell && !it.play.choices.location) {
      const fixed = overridesOf(it).at;
      if (fixed) {
        setField(s, it.play.choices, 'location', fixed);
        return 'continue';
      }
      const key = answer(f);
      if (key === K.back) return rollback(s, f, x, 'back');
      const locs = playLocations(s, f.obj, it.controller);
      if (locs.length === 0) return rollback(s, f, x, 'illegal');
      if (key === undefined) {
        const options: Option[] = locs.map((l) => ({ key: l.z === 'base' ? K.locBase : K.locBf(l.bf), refs: [{ loc: l }] }));
        return ask(s, f, x, {
          player: it.controller, kind: 'location', prompt: { t: 'location', card: o.def }, ctx: { item: it.id, source: f.obj,
            rule: hasKeyword(s, f.obj, 'deploy') ? '830.1.b' : '355.2' }, options, privateOptions: false, back: backOk(s, f),
        });
      }
      const k = parseKey(key)!;
      const loc: Loc = k.loc === 'base' ? { z: 'base', p: it.controller } : { z: 'bf', bf: (k.loc as { bf: number }).bf };
      setField(s, it.play.choices, 'location', loc);
      return 'continue';
    }
    if (spell) {
      const r = chooseNext(s, f, x, it, spellProg(s, it), {
        back: backOk(s, f), onBack: () => rollback(s, f, x, 'back'), onImpossible: () => rollback(s, f, x, 'illegal'),
        what: o.def,
      });
      if (r !== 'complete') return r;
    }
    setField(s, it.play, 'step', 2);
    return next(f);
  },

  // Step 3 [356]: the total cost.
  (s, f) => {
    const it = itemOf(s, f);
    const c = overridesOf(it).cost ?? costOf(s, f.obj);
    setField(s, it.play, 'cost', { energy: c.energy, power: c.power, other: [], components: [] });
    setField(s, it.play, 'step', 3);
    return next(f);
  },

  // Step 4 [357]: payment, or decline [445.2.a].
  (s, f, x) => {
    const it = itemOf(s, f);
    const cost: ResourceCost = { energy: it.play.cost!.energy, power: it.play.cost!.power };
    const r = payStep(s, f, x, {
      payer: it.controller, cost, what: s.objects[f.obj].def, item: it.id, source: f.obj, back: backOk(s, f),
      onBack: () => rollback(s, f, x, 'back'), onDecline: () => rollback(s, f, x, 'declined'), rule: '357',
    });
    if (typeof r === 'string') return r;
    setField(s, it.play, 'step', 4);
    if (r.energy + r.power > 0) {
      append(s, it.play.paid, { what: 'cost', replaced: false, objs: [], energy: r.energy, power: r.power });
      setField(s, it.play.facts, 'energySpent', r.energy);
      setField(s, it.play.facts, 'powerSpent', r.power);
      setField(s, s.log.powerSpent, it.controller, s.log.powerSpent[it.controller] + r.power);
    }
    return next(f);
  },

  // Step 5 [358]: the location and the targets must still be legal
  // [358.1], the timing right [358.4].
  (s, f, x) => {
    const it = itemOf(s, f);
    setField(s, it.play, 'step', 5);
    const loc = it.play.choices.location;
    if (loc && !overridesOf(it).at) {
      const ok = playLocations(s, f.obj, it.controller).some((l) => l.z === loc.z
        && (l.z === 'base' ? l.p === (loc as typeof l).p : l.bf === (loc as typeof l).bf));
      if (!ok) return rollback(s, f, x, 'illegal');
    }
    const prog = spellProg(s, it);
    if (prog) {
      const ex = it.play.choices.executions[0];
      const c = { controller: it.controller, source: null };
      for (const slot of slotsOf(prog, ex.modes)) {
        if ((ex.targets[slot.id] ?? []).some((t) => !stillLegal(s, t, slot, c))) return rollback(s, f, x, 'illegal');
      }
    }
    if (!timingOk(s, it)) return rollback(s, f, x, 'illegal');
    return next(f);
  },

  // Step 6 [359]: finalize.
  (s, f, x) => {
    const it = itemOf(s, f);
    finalizeItem(s, x, it);                                          // [359.1]
    const p = it.controller;
    const card = s.objects[f.obj];
    const types = typesOf(card);
    if (!card.token) append(s, s.log.finalized, { p, card: card.card, isCard: true, types });   // [420.4.b]
    if (types.includes('spell')) {
      requestCleanup(s);
      return 'done';                                                 // a spell waits on the chain [359.3]
    }
    // A permanent leaves the chain and enters the board at once [337.2], [359.2].
    const loc = it.play.choices.location!;
    const unit = types.includes('unit');
    const facts: PlayedRecord = { ...it.play.facts, ...(loc.z === 'bf' ? { to: loc } : {}) };
    const before = knowers(s, [f.obj]);
    const to = loc.z === 'base' ? Z.base(loc.p) : Z.bf(loc.bf);
    // A unit enters exhausted [359.2.c], [143.4]; gear ready [359.2.d].
    const obj = moveObject(s, f.obj, to, { controller: p, exhausted: unit, carry: { played: facts } });
    emitZone(s, x, { obj, prev: f.obj, from: { z: 'chain', item: it.id }, to, why: 'enter', rule: '359.2', before });
    emit(s, x, { k: 'enter', obj, at: loc, exhausted: unit, rule: unit ? '359.2.c' : '359.2.d' });
    emit(s, x, { k: 'played', item: it.id, def: card.def, p, rule: '420.4.a' });
    const energy = card.token ? 0 : energyCostOf(card);
    append(s, s.log.played, {
      p, card: card.token ? null : card.card, def: card.def, isCard: !card.token, types, from: it.play.origin.z,
      ...(loc.z === 'bf' ? { to: loc } : {}), energySpent: facts.energySpent, powerSpent: facts.powerSpent, countered: false,
    });
    if (unit && loc.z === 'bf') applyContested(s, x, loc.bf, p);      // [190.3.a.1]
    removeItem(s, x, it.id);
    // Played [420.4.a]: its own Play Effects go on the chain after it has
    // entered [383.4.a.2], with the other "when you play" triggers.
    fire(s, x, { e: 'played', p, obj, def: card.def, isCard: !card.token, types, energy, ...(loc.z === 'bf' ? { to: loc } : {}) });
    return 'done';
  },
];

defineSteps('play', STEPS);
