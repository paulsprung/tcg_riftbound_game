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
import type { TriggeredAst } from '../dsl/ast.ts';
import { abilitiesOf, abilityById, hasTriggers } from '../cards/registry.ts';
import { TOKENS } from '../cards/tokens.ts';
import { K, parseKey } from '../core/decisions.ts';
import { answer, ask, defineSteps, type FrameOf, type StepTable } from '../core/frames.ts';
import { mint, setField } from '../state/mut.ts';
import { isBoard } from '../state/zones.ts';
import type {
  CardType, ChainItem, DefId, GameObject, GameState, Json, Loc, ObjId, PendingTrigger, PlayerId, Snapshot,
} from '../state/types.ts';
import { turnOrderFromTurnPlayer } from '../rules/board.ts';
import { addItem, countUsage, playContext, usageKey } from '../rules/chain.ts';
import { isType, snapshotOf } from '../rules/chars.ts';
import { hereOf } from '../rules/targets.ts';
import { enqueue } from '../rules/tasks.ts';

type X = { present: boolean };

/** What happened, as triggers read it. */
export type TriggerEvent =
  | { e: 'played'; p: PlayerId; obj: ObjId | null; def: DefId; isCard: boolean; types: CardType[]; energy: number;
      to?: Loc }                                                     // Played [420.4.a]
  | { e: 'exhausted'; p: PlayerId; objs: ObjId[] }                   // one Exhaust action [415]
  | { e: 'scored'; p: PlayerId; bf: number; how: 'conquer' | 'hold' }   // [471]
  | { e: 'died'; deaths: { snap: Snapshot; at: Loc | null }[] }      // one Kill action [429]
  | { e: 'designated'; objs: ObjId[]; d: 'attacker' | 'defender' };  // first time this combat [383.4.e–f]

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

/** The objects whose triggered abilities might trigger: anything with one,
    on the board or in a trash. */
function sources(s: GameState): GameObject[] {
  return Object.values(s.objects).filter((o) => hasTriggers(o.def) && (isBoard(o.zone.z) || o.zone.z === 'trash'));
}

/** The triggers an event meets [383.2]. */
export function collect(s: GameState, ev: TriggerEvent): PendingTrigger[] {
  const out: PendingTrigger[] = [];
  for (const o of sources(s)) {
    for (const a of abilitiesOf(o.def)) {
      if (a.kind !== 'triggered' || !activeHere(o, a)) continue;
      const w = a.when;
      const instances: { p: PlayerId | null; info: Record<string, Json> }[] = [];
      switch (w.on) {
        case 'played':
          if (ev.e === 'played' && ev.obj === o.id) instances.push({ p: ev.p, info: { p: ev.p, subject: o.id } });
          break;
        case 'cardPlayed': {
          if (ev.e !== 'played') break;
          const c = controllerFor(o, a, ev.p);
          if (w.by === 'you' && ev.p !== c) break;
          if (w.what?.types && !w.what.types.some((t) => ev.types.includes(t))) break;
          if (w.what?.minEnergy !== undefined && (!ev.isCard || ev.energy < w.what.minEnergy)) break;
          if (w.to === 'here' && !sameLoc(ev.to, hereOf(s, o.id))) break;
          instances.push({ p: ev.p, info: ev.obj === null ? { p: ev.p } : { p: ev.p, subject: ev.obj } });
          break;
        }
        case 'attack': case 'defend':
          if (ev.e === 'designated' && ev.d === (w.on === 'attack' ? 'attacker' : 'defender') && ev.objs.includes(o.id)) {
            instances.push({ p: o.controller, info: { subject: o.id } });
          }
          break;
        case 'conquer': case 'hold': {
          if (ev.e !== 'scored' || ev.how !== w.on || !sameLoc({ z: 'bf', bf: ev.bf }, hereOf(s, o.id))) break;
          const c = controllerFor(o, a, ev.p);
          if (c === null) break;
          if (w.who === 'you' ? ev.p !== c : ev.p === c) break;
          instances.push({ p: ev.p, info: { p: ev.p, bf: ev.bf } });
          break;
        }
        case 'becomesExhausted':
          if (ev.e === 'exhausted' && ev.objs.includes(o.id)) instances.push({ p: ev.p, info: { subject: o.id } });
          break;
        case 'exhaustBatch': {
          if (ev.e !== 'exhausted') break;
          const c = controllerFor(o, a, ev.p);
          const units = ev.objs.filter((id) => s.objects[id] && isType(s.objects[id], 'unit') && s.objects[id].controller === c);
          if (ev.p === c && units.length >= w.min) instances.push({ p: ev.p, info: { p: ev.p, n: units.length } });
          break;
        }
        case 'unitDies': {
          if (ev.e !== 'died') break;
          const here = hereOf(s, o.id);
          const by: PlayerId[] = [];
          for (const d of ev.deaths) {
            if (!sameLoc(d.at, here) || !d.snap.chars.types.includes('unit')) continue;
            if (w.nonToken && isTokenDef(d.snap.def)) continue;
            const p = d.snap.controller;
            if (p === null || by.includes(p)) continue;              // one crossing per player per group [383.1.b]
            by.push(p);
          }
          for (const p of by) {
            if (w.firstPerPlayer) {
              const key = usageKey(o.id, a.id, p);
              const seen = s.usage[key] ?? 0;
              countUsage(s, key);
              if (seen > 0) continue;
            }
            instances.push({ p, info: { p } });
          }
          break;
        }
      }
      for (const inst of instances) {
        const controller = controllerFor(o, a, inst.p);
        if (controller === null) continue;                           // uncontrolled battlefield (§8 'none')
        if (a.limit && (s.usage[usageKey(o.id, a.id, '*')] ?? 0) >= a.limit.n) continue;   // [383.3.e.1]
        out.push({ ability: a.id, source: o.id, controller, info: inst.info, group: 0 });
      }
    }
  }
  return out;
}

/** The order players place their triggers in [383.3.d.1], [466.2.d.1]. */
function placingOrder(s: GameState, order: 'turnOrder' | 'combat'): PlayerId[] {
  if (order === 'combat' && s.combat) return [s.combat.attacker, s.combat.defender];
  return turnOrderFromTurnPlayer(s);
}

/** Two triggers are interchangeable when they are the same ability with
    the same information: their order changes nothing [383.3.d]. */
const sameTrigger = (a: PendingTrigger, b: PendingTrigger) => {
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
  const src = s.objects[t.source];
  const id = mint(s, 'item');
  const it: ChainItem = {
    id, seq: id, kind: 'triggered', sub: 'normal', status: 'pending', controller: t.controller, owner: t.controller,
    source: t.source, ability: t.ability, isAdd: false, outcomes: {}, trigger: structuredClone(t.info),
    play: playContext(s, { mode: 'limited', origin: src ? src.zone : { z: 'gone' }, item: id, by: t.controller }),
    ...(src ? { sourceLki: snapshotOf(s, t.source) } : {}),
  };
  addItem(s, x, it, { played: false });
  return it;
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
        options: distinct.map((t) => ({ key: K.next(f.batch.indexOf(t)), refs: [{ obj: t.source }, { item: t.info.item as number }] })),
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
export function triggeredOf(it: ChainItem): TriggeredAst | undefined {
  const a = it.ability ? abilityById(it.ability) : undefined;
  return a?.kind === 'triggered' ? a : undefined;
}

/** Counts a finalized "once each turn" trigger [383.3.e], [386.2]. */
export function countFinalized(s: GameState, it: ChainItem) {
  const a = triggeredOf(it);
  if (a?.limit && it.source !== undefined) countUsage(s, usageKey(it.source, a.id, '*'));
}
