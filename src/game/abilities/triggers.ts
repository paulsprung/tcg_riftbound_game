/*
 * Triggered abilities (§6.6, Spec E §5, [382–389]): collecting the ones a
 * game event meets, and placing them on the chain.
 *
 *   collect   after an event (a card played, an Exhaust action, a death,
 *             a conquer or hold, a combat designation) every active
 *             triggered ability whose condition it meets becomes a
 *             PendingTrigger, with the referents of the condition
 *             (`info`: who did it, which unit) [359.3.f.3]. Permanents
 *             trigger on the board [384.2]; cards elsewhere only where
 *             their text says (Meticulous Restorationist in the trash)
 *             [385.2]. "Once each turn" abilities already performed don't
 *             trigger [383.3.e.1]; "for each player, the first time each
 *             turn" counts the events per player [383.1.b].
 *   place     at once, as the condition is met [383.3]: each becomes a
 *             Pending item, step 1 only [389.2], [402.1] (allowed during a
 *             resolution and a cleanup [320.1]; its other steps wait for the
 *             resolving item and the tasks [402.2], [158.3.a]), so the state
 *             is Closed before anything else looks at it (a cleanup
 *             doesn't begin a showdown under a trigger's nose [323.11]).
 *             Players' triggers go on in turn order from the Turn Player
 *             [383.3.d.1]; the combat designation batch puts the Attacker's
 *             first [466.2.d.1]. A player with two or more different
 *             triggers in one batch orders them [383.3.d]: a placeTriggers
 *             task asks (orderTriggers) and puts their pending items in
 *             that order before anything finalizes (the H row runs before
 *             the F row). The master loop's F row finalizes them later
 *             (play/playAbility.ts).
 *
 * Controller: the source's controller, its owner off the board [191.5.a],
 * or the player the trigger names ("they", "when you conquer here" on a
 * battlefield) [190.6.c].
 */
import type { TriggerAst, TriggeredAst } from '../dsl/ast.ts';
import { abilitiesOf, abilityIn, hasTriggers } from '../cards/registry.ts';
import { TOKENS } from '../cards/tokens.ts';
import { K, parseKey } from '../core/decisions.ts';
import { answer, ask, defineSteps, type FrameOf, type StepTable } from '../core/frames.ts';
import { mint, setField } from '../state/mut.ts';
import { evalCond } from '../rules/conditions.ts';
import { isBoard } from '../state/zones.ts';
import type {
  CardType, ChainItem, DefId, DelayedAbility, GameObject, GameState, Json, Loc, ObjId, PendingTrigger, PlayerId, Snapshot,
  ZoneKind,
} from '../state/types.ts';
import { triggeredOn } from './objAbilities.ts';
import { locOf } from '../state/zones.ts';
import { turnOrderFromTurnPlayer } from '../rules/board.ts';
import { addItem, countUsage, playContext, usageKey } from '../rules/chain.ts';
import { isType, snapshotOf } from '../rules/chars.ts';
import { hereOf } from '../rules/targets.ts';
import { enqueue } from '../rules/tasks.ts';
import { copyJson } from '../state/clone.ts';

type X = { present: boolean };

/** What happened, as triggers read it. */
export type TriggerEvent =
  | { e: 'played'; p: PlayerId; obj: ObjId | null; def: DefId; isCard: boolean; types: CardType[]; energy: number;
      to?: Loc; from?: ZoneKind }                                    // Played [420.4.a]
  | { e: 'exhausted'; p: PlayerId; objs: ObjId[] }                   // one Exhaust action [415]
  | { e: 'scored'; p: PlayerId; bf: number; how: 'conquer' | 'hold'; wasUncontrolled?: boolean }   // [471]
  | { e: 'died'; deaths: { snap: Snapshot; at: Loc | null; item?: number | null; alone?: boolean }[] }   // one Kill action [429]
  | { e: 'designated'; objs: ObjId[]; d: 'attacker' | 'defender' }   // first time this combat [383.4.e–f]
  | { e: 'phase'; at: 'beginning' | 'mainStart' | 'endOfTurn'; p: PlayerId }   // [315.2.a], [316.4], [317.1.a]
  | { e: 'moved'; objs: ObjId[]; to: Loc; by: PlayerId | null }      // one Move action [448]
  | { e: 'discarded'; p: PlayerId; objs: ObjId[] }                   // the cards, now in the trash [423]
  | { e: 'returned'; objs: { snap: Snapshot; at: Loc | null }[] }    // returned to a hand from the board
  | { e: 'buffed' | 'stunned'; objs: ObjId[]; by: PlayerId | null }  // [427], [424]
  | { e: 'mighty'; objs: ObjId[] }                                   // becomes Mighty [709]
  | { e: 'hid'; p: PlayerId; bf: number };                           // [422]

const sameLoc = (a: Loc | null | undefined, b: Loc | null | undefined) => !!a && !!b && a.z === b.z
  && (a.z === 'base' ? a.p === (b as typeof a).p : a.bf === (b as typeof a).bf);

/** Where a triggered ability of this object can trigger from now. */
function activeHere(o: GameObject, a: TriggeredAst): boolean {
  if (a.activeIn && a.activeIn !== 'board') return (a.activeIn as string[]).includes(o.zone.z);
  return isBoard(o.zone.z) && o.zone.z !== 'facedown';                // [384.2]; facedown abilities are inactive (Spec E Q9)
}

/** Who controls a triggered ability of o [191.5.a], [190.6]. */
function controllerFor(o: GameObject, a: TriggeredAst, eventPlayer: PlayerId | null): PlayerId | null {
  if (a.controller === 'eventPlayer') return eventPlayer;
  return isBoard(o.zone.z) ? o.controller : o.owner;
}

const isTokenDef = (def: DefId) => Object.hasOwn(TOKENS, def);

/** The objects whose triggered abilities might trigger, with those
    abilities: the board's (keywords and effect text included), and cards
    in a trash or hand whose text works there [385.2]. */
function sources(s: GameState): { o: GameObject; abilities: TriggeredAst[] }[] {
  const out: { o: GameObject; abilities: TriggeredAst[] }[] = [];
  for (const o of Object.values(s.objects)) {
    if (isBoard(o.zone.z)) {
      const abilities = triggeredOn(s, o);
      if (abilities.length > 0) out.push({ o, abilities });
    } else if ((o.zone.z === 'trash' || o.zone.z === 'hand') && hasTriggers(o.def)) {
      out.push({ o, abilities: abilitiesOf(o.def).filter((a): a is TriggeredAst => a.kind === 'triggered') });
    }
  }
  return out;
}

const ctlOf = (s: GameState, id: ObjId) => s.objects[id]?.controller ?? null;

/** The instances a trigger condition meets: who did it and the referents
    [359.3.f.3]. `o` is the source (null for a delayed ability) and `c` the
    ability's controller as it would be. */
function meets(s: GameState, w: TriggerAst, ev: TriggerEvent, o: GameObject | null, c: (p: PlayerId | null) => PlayerId | null,
  key: (p: PlayerId | '*') => string | null, dinfo: Record<string, Json> = {}): { p: PlayerId | null; info: Record<string, Json> }[] {
  const instances: { p: PlayerId | null; info: Record<string, Json> }[] = [];
  const here = o ? hereOf(s, o.id) : null;
  switch (w.on) {
    case 'played':
      if (o && ev.e === 'played' && ev.obj === o.id) {
        // What it showed off as it was played, for "its Power cost" [832.1.d].
        const shown = o.played?.showOff.flatMap((r) => r.picks)[0];
        instances.push({ p: ev.p, info: { p: ev.p, subject: o.id, shownPower: shown?.chars.cost?.power.length ?? 0 } });
      }
      break;
    case 'cardPlayed': {
      if (ev.e !== 'played') break;
      if (w.by === 'you' && ev.p !== c(ev.p)) break;
      if (w.by === 'opponent' && (c(ev.p) === null || ev.p === c(ev.p))) break;
      if (w.what?.types && !w.what.types.some((t) => ev.types.includes(t))) break;
      if (w.what?.card && !ev.isCard) break;                       // a token is not a card [052]
      if (w.what?.minEnergy !== undefined && (!ev.isCard || ev.energy < w.what.minEnergy)) break;
      if (w.what?.fromFacedown && ev.from !== 'facedown') break;
      if (w.to === 'here' && (!o || !sameLoc(ev.to, here))) break;
      if (w.firstPerPlayer) {                                        // [383.1.b]
        const k = key(ev.p);
        if (k !== null) {
          const seen = s.usage[k] ?? 0;
          countUsage(s, k);
          if (seen > 0) break;
        }
      }
      const info: Record<string, Json> = { p: ev.p, energy: ev.isCard ? ev.energy : 0 };
      if (ev.obj !== null) info.subject = ev.obj;
      instances.push({ p: ev.p, info });
      break;
    }
    case 'attack': case 'defend': {
      if (ev.e !== 'designated' || ev.d !== (w.on === 'attack' ? 'attacker' : 'defender')) break;
      if (w.who === 'self') {
        if (o && ev.objs.includes(o.id)) instances.push({ p: o.controller, info: { subject: o.id } });
      } else if (w.who === 'friendly') {
        for (const id of ev.objs) {
          const p = ctlOf(s, id);
          if (p !== null && p === c(p)) instances.push({ p, info: { subject: id } });
        }
      } else {                                                       // a battlefield's "when you attack / defend here"
        const by: PlayerId[] = [];
        for (const id of ev.objs) {
          const p = ctlOf(s, id);
          const at = s.objects[id] ? locOf(s.objects[id]) : null;
          if (p === null || by.includes(p) || (w.at === 'here' && !sameLoc(at, here))) continue;
          by.push(p);
          instances.push({ p, info: { p, bf: at && at.z === 'bf' ? at.bf : -1 } });
        }
      }
      break;
    }
    case 'conquer': case 'hold': case 'score': {
      if (!o || ev.e !== 'scored' || (w.on !== 'score' && ev.how !== w.on)) break;
      if (w.at === 'here' && !sameLoc({ z: 'bf', bf: ev.bf }, here)) break;
      const ctl = c(ev.p);
      if (ctl === null) break;
      if (w.who === 'you' ? ev.p !== ctl : ev.p === ctl) break;
      instances.push({ p: ev.p, info: { p: ev.p, bf: ev.bf, wasUncontrolled: ev.wasUncontrolled === true } });
      break;
    }
    case 'becomesExhausted':
      if (o && ev.e === 'exhausted' && ev.objs.includes(o.id)) instances.push({ p: ev.p, info: { subject: o.id } });
      break;
    case 'exhaustBatch': {
      if (ev.e !== 'exhausted') break;
      const ctl = c(ev.p);
      const units = ev.objs.filter((id) => s.objects[id] && isType(s.objects[id], 'unit') && s.objects[id].controller === ctl);
      if (ev.p === ctl && units.length >= w.min) instances.push({ p: ev.p, info: { p: ev.p, n: units.length } });
      break;
    }
    case 'unitDies': {
      if (ev.e !== 'died' || !o) break;
      const by: PlayerId[] = [];
      for (const d of ev.deaths) {
        if (w.at === 'here' && !sameLoc(d.at, here)) continue;
        if (!d.snap.chars.types.includes('unit')) continue;
        if (w.nonToken && isTokenDef(d.snap.def)) continue;
        const p = d.snap.controller;
        if (w.who === 'friendlyOther' && (d.snap.id === o.id || p === null || p !== c(p))) continue;
        if (p === null || by.includes(p)) continue;                  // one crossing per player per group [383.1.b]
        by.push(p);
      }
      for (const p of by) {
        const k = key(p);
        if (w.firstPerPlayer && k !== null) {
          const seen = s.usage[k] ?? 0;
          countUsage(s, k);
          if (seen > 0) continue;
        }
        instances.push({ p, info: { p } });
      }
      break;
    }
    case 'objDies':
      if (ev.e === 'died' && ev.deaths.some((d) => d.snap.id === dinfo[w.info] && (dinfo.item === undefined
        || d.item === dinfo.item))) instances.push({ p: null, info: {} });
      break;
    case 'phase':
      if (ev.e === 'phase' && ev.at === w.at && (w.whose === 'any' || c(ev.p) === ev.p)) instances.push({ p: ev.p, info: { p: ev.p } });
      break;
    case 'moved':
      if (ev.e !== 'moved') break;
      if (w.who === 'self') {
        if (o && ev.objs.includes(o.id) && (w.to !== 'bf' || ev.to.z === 'bf')) {
          instances.push({ p: o.controller, info: { subject: o.id, ...(ev.to.z === 'bf' ? { bf: ev.to.bf } : {}) } });
        }
      } else {
        for (const id of ev.objs) {
          const p = ctlOf(s, id);
          const me = c(ev.by);
          if (ev.by === null || me !== ev.by || p === null || p === me) continue;
          instances.push({ p: ev.by, info: { subject: id } });
        }
      }
      break;
    case 'discarded':
      if (o && ev.e === 'discarded' && ev.objs.includes(o.id)) instances.push({ p: ev.p, info: { subject: o.id } });
      break;
    case 'returnedToHand':
      if (ev.e !== 'returned') break;
      for (const r of ev.objs) {
        if (sameLoc(r.at, here) && r.snap.chars.types.includes('unit')) instances.push({ p: r.snap.owner, info: { p: r.snap.owner } });
      }
      break;
    case 'buffed': case 'stunned': {
      if (ev.e !== w.on || ev.by === null || c(ev.by) !== ev.by) break;
      for (const id of ev.objs) {
        const p = ctlOf(s, id);
        const friendly = p === ev.by;
        if (w.on === 'buffed' ? !friendly : friendly || p === null) continue;
        const at = s.objects[id] ? locOf(s.objects[id]) : null;
        if (w.on === 'stunned' && at?.z !== 'bf') continue;
        instances.push({ p: ev.by, info: { subject: id, ...(at?.z === 'bf' ? { bf: at.bf } : {}) } });
      }
      break;
    }
    case 'becomesMighty':
      if (ev.e !== 'mighty') break;
      for (const id of ev.objs) {
        const p = ctlOf(s, id);
        if (p !== null && p === c(p)) instances.push({ p, info: { subject: id } });
      }
      break;
    case 'hid':
      if (ev.e === 'hid' && o && sameLoc({ z: 'bf', bf: ev.bf }, here)) instances.push({ p: ev.p, info: { p: ev.p, bf: ev.bf } });
      break;
    case 'dies': break;                                              // self-leave: placed by the kill itself [383.2.c.3]
  }
  return instances;
}

/** The triggers an event meets [383.2]: the board's (and the trash's where
    a card says so [385.2]) and the delayed abilities' [391]. */
export function collect(s: GameState, ev: TriggerEvent): PendingTrigger[] {
  const out: PendingTrigger[] = [];
  for (const { o, abilities } of sources(s)) {
    for (const a of abilities) {
      if (!activeHere(o, a)) continue;
      const instances = meets(s, a.when, ev, o, (p) => controllerFor(o, a, p), (p) => usageKey(o.id, a.id, p));
      for (const inst of instances) {
        const controller = controllerFor(o, a, inst.p);
        if (controller === null) continue;                           // uncontrolled battlefield (§8 'none')
        if (a.limit && (s.usage[usageKey(o.id, a.id, '*')] ?? 0) >= a.limit.n) continue;   // [383.3.e.1]
        if (a.first) {                                               // "the first time … each turn": the event counts [383.1.b]
          const k = usageKey(o.id, a.id, 'first' as unknown as PlayerId);
          const seen = s.usage[k] ?? 0;
          countUsage(s, k);
          if (seen > 0) continue;
        }
        // An intervening "if": checked now, and never again [383.2.a.1].
        if (a.if && !evalCond(s, a.if, { controller, source: o.id, facts: o.played, info: inst.info })) continue;
        out.push({ ability: a.id, source: o.id, controller, info: inst.info, group: 0 });
      }
    }
  }
  for (const d of s.delayed) {
    const a = d.ability as unknown as TriggeredAst;
    if (a.kind !== 'triggered' || !delayedActive(s, d)) continue;
    let left = d.window && 'uses' in d.window && d.window.uses !== undefined ? d.window.uses : Infinity;
    for (const inst of meets(s, a.when, ev, null, () => d.controller, () => null, d.info)) {
      if (left <= 0) break;                                          // "the next three times" [391.4]
      left--;
      out.push({ ability: `eff:${d.id}#0`, source: null, controller: d.controller, info: { ...d.info, ...inst.info }, group: 0,
        delayed: d.id });
    }
  }
  return out;
}

/** A delayed ability that can still trigger: within its window, with uses
    left [391]. */
function delayedActive(s: GameState, d: DelayedAbility): boolean {
  const w = d.window;
  if ('during' in w) {
    if (w.during === 'thisTurn' && d.createdTurn !== s.turn.n) return false;
    return w.uses === undefined || w.uses > 0;
  }
  return false;                                                      // "at" windows fire from their phase task
}

/**
 * The self-leave triggers of an object about to leave the board as it
 * dies [383.2.c.3], [808.1.d]: "When I die" (Deathknell) goes on the chain
 * as a Pending item before the card moves, with the last-known information
 * of its source [808.1.d.2–3]. Its controller is the source's as it died
 * [191.5.b].
 */
export function placeSelfLeave(s: GameState, x: X, id: ObjId, snap: Snapshot, info: Record<string, Json> = {}) {
  const o = s.objects[id];
  if (!o) return;
  const found: PendingTrigger[] = [];
  for (const a of triggeredOn(s, o)) {
    if (a.when.on !== 'dies' || snap.controller === null) continue;
    found.push({ ability: a.id, source: id, controller: snap.controller, info: { subject: id, ...info }, group: 0, lki: snap });
  }
  if (found.length > 0) placeAll(s, x, found, 'turnOrder');
}

/** The order players place their triggers in [383.3.d.1], [466.2.d.1]. */
function placingOrder(s: GameState, order: 'turnOrder' | 'combat'): PlayerId[] {
  if (order === 'combat' && s.combat) return [s.combat.attacker, s.combat.defender];
  return turnOrderFromTurnPlayer(s);
}

/** Two triggers are interchangeable when they are the same ability with
    the same information: their order changes nothing [383.3.d]. */
const sameTrigger = (a: PendingTrigger, b: PendingTrigger) => {
  if (a.delayed !== b.delayed) return false;
  const info = (t: PendingTrigger) => JSON.stringify({ ...t.info, item: null });
  return a.ability === b.ability && a.source === b.source && info(a) === info(b);
};

/**
 * Places triggers on the chain at once, player by player in placing order
 * [383.3.d.1]; returns the batch's items. When a player has two or more
 * different ones, a placeTriggers task lets them choose the order.
 */
export function placeAll(s: GameState, x: X, batch: PendingTrigger[], order: 'turnOrder' | 'combat') {
  for (const p of placingOrder(s, order)) {
    const mine = batch.filter((t) => t.controller === p);
    const items = mine.map((t) => placeTrigger(s, x, t).id);
    const distinct = mine.filter((t, i) => mine.findIndex((o) => sameTrigger(o, t)) === i);
    if (distinct.length > 1) {
      enqueue(s, { t: 'placeTriggers', batch: mine.map((t, i) => ({ ...t, info: { ...t.info, item: items[i] } })), order });
    }
  }
}

/** Collects the triggers an event meets and places them [383.3]. */
export function fire(s: GameState, x: X, ev: TriggerEvent, order: 'turnOrder' | 'combat' = 'turnOrder') {
  const found = collect(s, ev);
  if (found.length > 0) placeAll(s, x, found, order);
}

/** A triggered ability goes on the chain as a Pending item: step 1 only
    [389.2], [402.1]. Triggers reset the priority passes but never the
    Focus passes (Spec C Q4). */
export function placeTrigger(s: GameState, x: X, t: PendingTrigger): ChainItem {
  const src = t.source === null ? undefined : s.objects[t.source];
  const id = mint(s, 'item');
  const lki = t.lki ?? (src ? snapshotOf(s, t.source!) : undefined);
  const it: ChainItem = {
    id, seq: id, kind: 'triggered', sub: t.delayed !== undefined ? 'delayed' : 'normal', status: 'pending',
    controller: t.controller, owner: t.controller, ability: t.ability, isAdd: false, outcomes: {},
    trigger: copyJson(t.info),
    play: playContext(s, { mode: 'limited', origin: src ? src.zone : { z: 'gone' }, item: id, by: t.controller }),
    ...(t.source !== null ? { source: t.source } : {}),
    ...(lki ? { sourceLki: lki } : {}),
  };
  if (t.delayed !== undefined) useDelayed(s, t.delayed);
  addItem(s, x, it, { played: false });
  return it;
}

/** One use of a delayed ability is spent as it triggers [391.4]. */
function useDelayed(s: GameState, id: number) {
  const d = s.delayed.find((e) => e.id === id);
  if (!d || !('during' in d.window) || d.window.uses === undefined) return;
  setField(s, d.window, 'uses', d.window.uses - 1);
}

// ---- the placeTriggers task: one player orders their triggers ----

type TriggersFrame = FrameOf<'triggers'>;

/**
 * The batch holds one player's simultaneous triggers, each already a
 * pending item (`info.item`). Each pick goes on the chain next, that is at
 * the earliest place the batch's still-unordered items hold [383.3.d];
 * interchangeable ones are left as they are.
 */
const STEPS: StepTable<TriggersFrame> = [
  (s, f, x) => {
    const left = f.batch.filter((t, i) => !f.placed.includes(i) && s.chain.some((c) => c.id === t.info.item));
    const distinct = left.filter((t, j) => left.findIndex((o) => sameTrigger(o, t)) === j);
    if (distinct.length < 2) return 'done';
    const p = left[0].controller;
    const key = answer(f);
    if (key === undefined) {
      return ask(s, f, x, {
        player: p, kind: 'orderTriggers',
        prompt: { t: 'orderTriggers', abilities: distinct.map((t) => t.ability), placed: f.placed.length },
        ctx: { rule: '383.3.d' },
        options: distinct.map((t) => ({ key: K.next(f.batch.indexOf(t)),
          refs: [...(t.source !== null && s.objects[t.source] ? [{ obj: t.source }] : []), { item: t.info.item as number }] })),
        privateOptions: false, batch: `triggers:p${p}:item${f.batch[0].info.item}`,
      });
    }
    const idx = parseKey(key)!.n!;
    const ids = left.map((t) => t.info.item as number);
    const pickId = f.batch[idx].info.item as number;
    const at = s.chain.findIndex((c) => ids.includes(c.id));
    const picked = s.chain.find((c) => c.id === pickId)!;
    const rest = s.chain.filter((c) => c.id !== pickId);
    setField(s, s, 'chain', [...rest.slice(0, at), picked, ...rest.slice(at)]);
    f.placed = [...f.placed, idx];
    return 'continue';
  },
];

defineSteps('triggers', STEPS);

/** The ability an item names, if it is a triggered one. */
export function triggeredOf(s: GameState, it: ChainItem): TriggeredAst | undefined {
  const a = it.ability ? abilityIn(s, it.ability) : undefined;
  return a?.kind === 'triggered' ? a : undefined;
}

/** Counts a finalized "once each turn" trigger [383.3.e], [386.2]. */
export function countFinalized(s: GameState, it: ChainItem) {
  const a = triggeredOf(s, it);
  if (a?.limit && it.source !== undefined) countUsage(s, usageKey(it.source, a.id, '*'));
}
