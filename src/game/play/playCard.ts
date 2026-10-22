/*
 * The process of playing a card (§5.6, Spec D, [349–359]): six steps, each
 * of its choices a decision of its own.
 *
 *   S0     snapshot BEFORE step 1, so a rollback puts the card back where
 *          it was with its old ObjId (fix F1, [358.5])
 *   1      the card moves to the chain as a new object [354], [124]; the
 *          state Closes [354.1]; the Play action is logged [420.5]; the
 *          cleanup this makes outstanding runs before step 2 [354.4],
 *          [319.1], [319.3] (fix F2: the frame waits for tasks)
 *   2      choices [355]: for a unit, its location, its controller's base
 *          or a battlefield they control [355.2.a]; gear goes to base
 *          [359.2.d]
 *   3      the total cost [356]: the printed cost (no cost modifiers
 *          before the card abilities, M1.3)
 *   4      payment [357]: a payment plan (rules/resources.ts), or decline,
 *          which undoes the play [445.2.a]; a cost of nothing is paid
 *          without a Pay action [445.1.b]
 *   5      legality [358]: the choices still hold, the cost is paid, the
 *          timing is right [358.4]; a failure undoes the play [358.5]
 *   6      finalize [359]: a unit or gear leaves the chain at once and
 *          enters the board [337.2], [359.2]: a unit exhausted at its
 *          location [359.2.c], gear ready at base [359.2.d]
 *
 * `back` (UI only) is offered at every decision of steps 1–4 and undoes
 * the play by the same rollback (§4.4). M1.1 plays units and gear without
 * Deploy from hand and the Champion Zone at default timing; spells, gear
 * with Deploy and card abilities come with M1.2–M1.3.
 */
import { K, parseKey, type Option } from '../core/decisions.ts';
import { emit, emitZone, knowers } from '../core/events.ts';
import { answer, ask, awaitTasks, defineSteps, next, type FrameOf, type RunCtx, type StepTable } from '../core/frames.ts';
import { findCard, printedKeywords } from '../cards/oracle.ts';
import { append, mint, moveObject, restoreSnapshot, setField, snapshotState } from '../state/mut.ts';
import { Z } from '../state/zones.ts';
import type {
  ChainItem, Domain, Frame, GameState, Loc, ObjId, PlayedRecord, PlayerId, TotalCost,
} from '../state/types.ts';
import { applyContested } from '../rules/actions.ts';
import { isShowdownState, nextPlayer } from '../rules/board.ts';
import { isType, typesOf } from '../rules/chars.ts';
import { executePlan, paymentPlans, planSummary, type ResourceCost } from '../rules/resources.ts';
import { requestCleanup } from '../rules/tasks.ts';

type PlayFrame = FrameOf<'play'>;

/** The frame that plays a card the player chose at a priority decision. */
export const playFrame = (obj: ObjId): Frame => ({ f: 'play', item: null, obj, pc: 0, snap: null, revealed: false,
  rngUsed: false });

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

/** Whether M1.1 can play this card at all: a unit, or gear without Deploy
    (whose location rules arrive with the keywords, M1.3). */
function supported(s: GameState, id: ObjId): boolean {
  const o = s.objects[id];
  if (isType(o, 'unit')) return true;
  if (!isType(o, 'gear')) return false;                              // spells: M1.2
  const c = findCard(o.def);
  return !(c && printedKeywords(c).some((k) => k.kw === 'deploy'));
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
 * The cards p may start to play now at default timing, from hand or the
 * Champion Zone [420.1.a]: only ones that can finish (§4.6). Every later
 * decision of the play has a legal answer, so the cheap check is complete
 * here: a payment plan and a location exist.
 */
export function playableCards(s: GameState, p: PlayerId): ObjId[] {
  const pl = s.players[p];
  const from = [...pl.hand, ...(pl.champion === null ? [] : [pl.champion])];
  return from.filter((id) => supported(s, id) && paymentPlans(s, p, costOf(s, id), { limit: 1 }).length > 0);
}

const itemOf = (s: GameState, f: PlayFrame): ChainItem => s.chain.find((i) => i.id === f.item)!;
const backOk = (f: PlayFrame) => !f.revealed && !f.rngUsed;

/** Undoes the whole play [358.5], [445.2.a]: back to S0, the card where it
    was. Not a counter. */
function rollback(s: GameState, f: PlayFrame, x: RunCtx, reason: 'back' | 'illegal' | 'declined') {
  const item = f.item;
  restoreSnapshot(s, f.snap!);
  if (reason === 'illegal' && item !== null) emit(s, x, { k: 'playFailed', item, reason: 'legality', rule: '358.5' });
  emit(s, x, { k: 'rollback', reason, rule: reason === 'declined' ? '445.2.a' : '358.5' });
  return 'done' as const;
}

/** Leaves the chain [319.5]; an emptied chain opens the state again [340.2],
    and during a showdown Focus passes on unless a trigger or an Add ability
    opened the chain [340.2.a], [346.1]. */
function leaveChain(s: GameState, x: RunCtx, id: number) {
  setField(s, s, 'chain', s.chain.filter((i) => i.id !== id));
  requestCleanup(s);
  if (s.chain.length > 0) return;
  const origin = s.turn.chainOrigin;
  setField(s, s.turn, 'chainOrigin', null);
  setField(s, s.turn, 'passes', 0);
  setField(s, s.turn, 'priority', null);
  if (s.showdown && s.turn.focus !== null && origin !== 'triggered' && origin !== 'add') {
    const p = nextPlayer(s, s.turn.focus);
    setField(s, s.turn, 'focus', p);
    emit(s, x, { k: 'focus', p, rule: '340.2.a' });
  }
}

const STEPS: StepTable<PlayFrame> = [
  // Step 1 [354], with S0 taken first (fix F1).
  (s, f, x) => {
    f.snap = snapshotState(s);
    const card = s.objects[f.obj];
    const p = card.owner;
    const origin = structuredClone(card.zone);
    const closed = s.chain.length === 0;
    const item = mint(s, 'item');
    const before = knowers(s, [f.obj]);
    const obj = moveObject(s, f.obj, { z: 'chain', item }, { controller: p });
    const facts: PlayedRecord = {
      item, turn: s.turn.n, by: p, turnPlayer: s.turn.player, mode: 'discretionary', from: origin.z, paidOptional: [],
      showOff: [], energySpent: 0, powerSpent: 0, costObjects: {},
    };
    const chainItem: ChainItem = {
      id: item, seq: item, kind: 'card', sub: 'normal', status: 'pending', controller: p, owner: card.owner, obj,
      isAdd: false, outcomes: {},
      play: {
        mode: 'discretionary', step: 1, origin, closedTheState: closed,
        atStart: { showdown: isShowdownState(s), turnPlayer: s.turn.player, phase: s.turn.phase },
        choices: { asPlayed: {}, optionalCosts: {}, executions: [{ modes: [], dests: {}, targets: {} }] },
        paid: [], facts, lookBack: {}, restrictions: [], snap2: null,
      },
    };
    append(s, s.chain, chainItem);
    if (closed) setField(s, s.turn, 'chainOrigin', 'card');
    setField(s, s.turn, 'passes', 0);                                 // a new item [339.1]
    setField(s, s.turn, 'priority', null);
    if (isShowdownState(s)) setField(s, s.turn, 'focusPasses', 0);   // a card played in the showdown [348]
    append(s, s.log.playActions, { p, item, card: card.card, isCard: true });   // [420.5]
    emitZone(s, x, { obj, prev: f.obj, from: origin, to: { z: 'chain', item }, why: 'play', rule: '354', before });
    emit(s, x, { k: 'chainPush', item, kind: 'card', rule: '354.2' });
    f.obj = obj;
    f.item = item;
    requestCleanup(s);                                                // [319.1], [319.3]
    return awaitTasks(f);                                             // [354.4]
  },

  // Step 1, limited plays only: S2 (Spec D §8.5). Discretionary plays go on.
  (_s, f) => next(f),

  // Step 2 [355]: the location of a unit [355.2].
  (s, f, x) => {
    const it = itemOf(s, f);
    const o = s.objects[f.obj];
    if (!isType(o, 'unit')) {
      setField(s, it.play, 'step', 2);
      setField(s, it.play.choices, 'location', { z: 'base', p: it.controller });   // [359.2.d]
      return next(f);
    }
    const key = answer(f);
    if (key === 'back') return rollback(s, f, x, 'back');
    const locs = unitLocations(s, it.controller);
    if (key === undefined) {
      const options: Option[] = locs.map((l) => ({ key: l.z === 'base' ? K.locBase : K.locBf(l.bf), refs: [{ loc: l }] }));
      return ask(s, f, x, {
        player: it.controller, kind: 'location', prompt: { t: 'location', card: o.def }, ctx: { item: it.id, source: f.obj,
          rule: '355.2' }, options, privateOptions: false, back: backOk(f),
      });
    }
    const k = parseKey(key)!;
    const loc: Loc = k.loc === 'base' ? { z: 'base', p: it.controller } : { z: 'bf', bf: (k.loc as { bf: number }).bf };
    setField(s, it.play, 'step', 2);
    setField(s, it.play.choices, 'location', loc);
    return next(f);
  },

  // Step 3 [356]: the total cost.
  (s, f) => {
    const it = itemOf(s, f);
    const c = costOf(s, f.obj);
    const total: TotalCost = { energy: c.energy, power: c.power, other: [], components: [] };
    setField(s, it.play, 'cost', total);
    setField(s, it.play, 'step', 3);
    return next(f);
  },

  // Step 4 [357]: payment, or decline [445.2.a].
  (s, f, x) => {
    const it = itemOf(s, f);
    const cost: ResourceCost = { energy: it.play.cost!.energy, power: it.play.cost!.power };
    if (cost.energy === 0 && cost.power.length === 0) {               // [445.1.b]
      setField(s, it.play, 'step', 4);
      return next(f);
    }
    const plans = paymentPlans(s, it.controller, cost, { reserveFor: domainsNeeded(s, it.controller) });
    const key = answer(f);
    if (key === 'back') return rollback(s, f, x, 'back');
    if (key === K.decline) return rollback(s, f, x, 'declined');
    if (key === undefined) {
      const options: Option[] = plans.map((plan) => ({
        key: plan.key, refs: plan.steps.map((st) => ({ obj: st.obj })), meta: { plan },
      }));
      options.push({ key: K.decline });
      return ask(s, f, x, {
        player: it.controller, kind: 'payment',
        prompt: { t: 'payment', card: s.objects[f.obj].def, energy: cost.energy,
          power: cost.power.map((r) => (r.k === 'domain' ? r.d : r.k === 'any' ? 'any' : r.ds.join('|'))),
          plans: plans.map((plan) => planSummary(s, plan)) },
        ctx: { item: it.id, source: f.obj, rule: '357' }, options, privateOptions: false, back: backOk(f),
      });
    }
    const plan = plans[parseKey(key)!.n!];
    setField(s, it.play, 'step', 4);
    const spent = executePlan(s, x, it.controller, plan, cost);
    append(s, it.play.paid, { what: 'cost', replaced: false, objs: [], energy: spent.energy, power: spent.power });
    setField(s, it.play.facts, 'energySpent', spent.energy);
    setField(s, it.play.facts, 'powerSpent', spent.power);
    setField(s, s.log.powerSpent, it.controller, s.log.powerSpent[it.controller] + spent.power);
    return next(f);
  },

  // Step 5 [358]: legality. The location must still be valid [358.1], the
  // timing right [358.4]: a card that opened the chain in a Neutral state
  // on its controller's own Main Phase has default timing [155], [310.1.a].
  (s, f, x) => {
    const it = itemOf(s, f);
    setField(s, it.play, 'step', 5);
    const loc = it.play.choices.location!;
    const where = loc.z === 'base' ? loc.p === it.controller : s.bfs[loc.bf].controller === it.controller;
    const a = it.play.atStart;
    const timing = it.play.closedTheState && !a.showdown && a.turnPlayer === it.controller && a.phase === 'main';
    if (!where || !timing) return rollback(s, f, x, 'illegal');
    return next(f);
  },

  // Step 6 [359]: finalize; a permanent enters the board at once [337.2].
  (s, f, x) => {
    const it = itemOf(s, f);
    setField(s, it.play, 'step', 6);
    setField(s, it, 'status', 'finalized');                          // [359.1]
    const p = it.controller;
    const card = s.objects[f.obj];
    const types = typesOf(card);
    append(s, s.log.finalized, { p, card: card.card, isCard: true, types });   // [420.4.b]
    emit(s, x, { k: 'finalize', item: it.id, rule: '359.1' });
    if (s.turn.phase === 'ending' && s.turn.step === 'expiration') {
      setField(s, s.turn.expiration, 'feprHappened', true);          // [317.2.e]
    }
    requestCleanup(s);                                                // [319.4]
    const loc = it.play.choices.location!;
    const unit = types.includes('unit');
    const facts: PlayedRecord = { ...it.play.facts, ...(loc.z === 'bf' ? { to: loc } : {}) };
    const before = knowers(s, [f.obj]);
    const to = loc.z === 'base' ? Z.base(loc.p) : Z.bf(loc.bf);
    // A unit enters exhausted [359.2.c], [143.4]; gear ready [359.2.d].
    const obj = moveObject(s, f.obj, to, { controller: p, exhausted: unit, carry: { played: facts } });
    emitZone(s, x, { obj, prev: f.obj, from: { z: 'chain', item: it.id }, to, why: 'enter', rule: '359.2', before });
    emit(s, x, { k: 'enter', obj, at: loc, exhausted: unit, rule: unit ? '359.2.c' : '359.2.d' });
    emit(s, x, { k: 'played', item: it.id, def: card.def, rule: '420.4.a' });
    append(s, s.log.played, {
      p, card: card.card, def: card.def, isCard: true, types, from: it.play.origin.z, ...(loc.z === 'bf' ? { to: loc } : {}),
      energySpent: facts.energySpent, powerSpent: facts.powerSpent, countered: false,
    });
    if (unit && loc.z === 'bf') applyContested(s, x, loc.bf, p);      // [190.3.a.1]
    leaveChain(s, x, it.id);
    return 'done';
  },
];

defineSteps('play', STEPS);
