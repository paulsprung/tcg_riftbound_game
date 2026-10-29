/*
 * Combat (§5.10, Spec G §2–§5, [461–468]). A combat opens in a cleanup
 * (step 10 with a new combat showdown, or step 10a when an ongoing
 * non-combat showdown becomes one [323.12–323.13], [466.1]); every step
 * after that is an Outstanding Task, so the master loop never waits
 * between them except for the assigners' choices and the chains their
 * triggers make.
 *
 *   Step 1  [466]  startOfCombat, designations, placeCombatTriggers; then
 *                  the showdown is played as any other (rules/showdown.ts)
 *   Step 2  [467]  damage: the attacker assigns their total among the
 *                  defending units, then the defender among the attacking
 *                  units (rules/assignment.ts); all of it is dealt at once;
 *                  FEPR is skipped and outstanding tasks are cancelled, so
 *                  the combat cleanup comes straight after [467.3]
 *   Step 3  [468]  combatCleanup (rules/cleanup.ts, 3c and 3d), result,
 *                  establishControl, end
 *
 * After each step the combat names the next one (CombatState.next); the
 * master loop enqueues it only once nothing else is outstanding, pending or
 * on the chain, which is [468.2], [468.4] and [468.6] (§5.10.3).
 */
import { emit } from '../core/events.ts';
import { call, takeRet } from '../core/frames.ts';
import { collect, fire, placeAll } from '../abilities/triggers.ts';
import { EngineError } from '../core/errors.ts';
import { append, setField } from '../state/mut.ts';
import type { CombatState, GameState, Json, ObjId, PlayerId } from '../state/types.ts';
import { deal, setController, clearContested, trashForeignFacedown } from './actions.ts';
import { opponentsOf, playersWithUnitsAt, unitsAt } from './board.ts';
import { combatMight } from './chars.ts';
import { establishControl } from './scoring.ts';
import { defineTask, enqueue, enqueueFront, requestCleanup } from './tasks.ts';

type X = { present: boolean };

/**
 * A combat opens at a battlefield [466.1]: the player who applied
 * Contested is the Attacker [466.2.c.1], the other the Defender
 * [466.2.c.2]. With a new showdown it is a combat showdown from the start;
 * otherwise the ongoing showdown becomes one [466.2]. Its first three tasks
 * become outstanding [466.2.a–d].
 */
export function openCombat(s: GameState, x: X, bf: number, newShowdown: boolean) {
  const b = s.bfs[bf];
  const attacker = b.contested!;
  const defender = opponentsOf(s, attacker)[0];
  setField(s, b.staged, 'showdown', false);
  setField(s, b.staged, 'combat', false);
  setField(s, s, 'showdown', { bf, kind: 'combat' });
  const combat: CombatState = {
    bf, step: 'showdown', openedNewShowdown: newShowdown, attacker, defender, everAttacker: [], everDefender: [],
    assigned: [], excess: s.players.map(() => 0), recalled: false, tie: false, next: null,
  };
  setField(s, s, 'combat', combat);
  emit(s, x, { k: 'combatStart', bf, attacker, rule: newShowdown ? '323.12' : '323.13' });
  if (newShowdown) fire(s, x, { e: 'showdown', bf });               // a combat showdown begins [466.2]
  enqueueFront(s, { t: 'combat', id: 'startOfCombat' }, { t: 'combat', id: 'designations' },
    { t: 'combat', id: 'placeCombatTriggers' });
}

/** The master loop's row C (§5.2): the combat's showdown is over and nothing
    else is left, so its next step becomes outstanding. */
export function nextCombatStep(s: GameState) {
  const c = s.combat!;
  if (c.next === null) throw new EngineError(`combat at bf${c.bf} has no next step (${c.step})`);
  enqueue(s, { t: 'combat', id: c.next });
  setField(s, c, 'next', null);
}

/** The designation a unit at the combat battlefield gets from its
    controller [466.2.c.3], [323.2.a]. */
export function designationFor(c: CombatState, controller: PlayerId | null): 'attacker' | 'defender' | null {
  return controller === c.attacker ? 'attacker' : controller === c.defender ? 'defender' : null;
}

/** Gives a unit its designation. Returns whether it is the first time it
    gains that one this combat: its attack or defend triggers then trigger
    [383.4.e.2.a], [383.4.f.2.a]. */
export function designate(s: GameState, id: ObjId, d: 'attacker' | 'defender' | null): boolean {
  const c = s.combat!;
  setField(s, s.objects[id], 'designation', d);
  if (d === 'attacker' && !c.everAttacker.includes(id)) { append(s, c.everAttacker, id); return true; }
  if (d === 'defender' && !c.everDefender.includes(id)) { append(s, c.everDefender, id); return true; }
  return false;
}

// ---- Step 1: the Combat Showdown [466] ----

/** [466.2.b]: start-of-combat effects, and start-of-showdown effects with a
    new showdown. No card defined so far has a start-of-combat ability. */
defineTask('combat.startOfCombat', [(s, _f, x) => {
  const c = s.combat!;
  if (c.openedNewShowdown) emit(s, x, { k: 'showdownStart', bf: c.bf, rule: '466.2.b' });
  return 'done';
}]);

/** [466.2.c]: with a new showdown the Attacker gains Focus [466.2.c.1.a];
    otherwise the Focus holder keeps it [466.2.c.1.b]. Every unit there gets
    its controller's designation [466.2.c.3]. */
defineTask('combat.designations', [(s, _f, x) => {
  const c = s.combat!;
  if (c.openedNewShowdown) {
    setField(s, s.turn, 'focus', c.attacker);
    setField(s, s.turn, 'focusPasses', 0);
    emit(s, x, { k: 'focus', p: c.attacker, rule: '466.2.c.1.a' });
  }
  const first: ObjId[][] = [];
  for (const d of ['attacker', 'defender'] as const) {
    const units = unitsAt(s, { z: 'bf', bf: c.bf }).filter((id) => designationFor(c, s.objects[id].controller) === d);
    first.push(units.filter((id) => designate(s, id, d)));
    if (units.length > 0) emit(s, x, { k: 'designate', objs: units, d, rule: '466.2.c.3' });
  }
  // [466.2.d]: the attack and defend triggers of the units designated for
  // the first time this combat go on the chain, the Attacker's first
  // [466.2.d.1] (a cleanup in between may have designated some already, and
  // triggered them then [323.2]).
  const batch = [...collect(s, { e: 'designated', objs: first[0], d: 'attacker' }),
    ...collect(s, { e: 'designated', objs: first[1], d: 'defender' })];
  if (batch.length > 0) placeAll(s, x, batch, 'combat');
  requestCleanup(s);                                                 // designations are a status [319.7]
  return 'done';
}]);

/** [466.2.d]: the combat triggers were placed as their units were
    designated (the designations task, or cleanup step 2 when a cleanup came
    first); nothing is left to do here. */
defineTask('combat.placeCombatTriggers', [() => 'done']);

// ---- Step 2: Combat Damage [467] ----

interface DamageLocals { a: { to: ObjId; raw: number }[]; d: { to: ObjId; raw: number }[] }

const designated = (s: GameState, d: 'attacker' | 'defender') =>
  unitsAt(s, { z: 'bf', bf: s.combat!.bf }).filter((id) => s.objects[id].designation === d);

/** Each side's total: the Might of its designated units there, a unit below
    0 or stunned counting 0 [467.2.a–b], [143.2.c], [424.1.b]. */
export const sideTotal = (s: GameState, d: 'attacker' | 'defender') =>
  designated(s, d).reduce((n, id) => n + combatMight(s, id), 0);

/** Skips to Step 3: nothing outstanding, the combat cleanup first [467.3], [468.1]. */
function toResolution(s: GameState) {
  setField(s, s.turn, 'tasks', []);
  setField(s, s.turn, 'cleanupRequested', false);
  enqueueFront(s, { t: 'cleanup', v: 'combat' });
  setField(s, s.combat!, 'step', 'resolution');
  setField(s, s.combat!, 'next', 'result');
}

defineTask('combat.damage', [
  // [467.1]: only when both attacking and defending units remain; otherwise
  // straight to the Resolution Step (Spec G Q1).
  (s, f) => {
    const c = s.combat!;
    if (designated(s, 'attacker').length === 0 || designated(s, 'defender').length === 0) {
      toResolution(s);
      return 'done';
    }
    f.locals = { a: [], d: [] };
    return call(s, f, { f: 'assign', by: c.attacker, order: [], tier: {}, pc: 0, total: sideTotal(s, 'attacker'),
      excess: [] });
  },
  // The defender assigns after the attacker [467.2.c].
  (s, f) => {
    const a = (takeRet(f) ?? { hits: [], excess: 0 }) as unknown as { hits: DamageLocals['a']; excess: number };
    f.locals = { a: a.hits, d: [], ax: a.excess } as unknown as Json;
    return call(s, f, { f: 'assign', by: s.combat!.defender, order: [], tier: {}, pc: 0,
      total: sideTotal(s, 'defender'), excess: [] });
  },
  // [467.2.d]: all the damage at once, the units of each side its sources
  // and their controller responsible [418.6.c], [142.3.a]. Every opposing
  // unit that added Might is a source (Spec G Q7).
  (s, f, x) => {
    const c = s.combat!;
    const l = f.locals as unknown as DamageLocals & { ax: number };
    const dr = (takeRet(f) ?? { hits: [], excess: 0 }) as unknown as { hits: DamageLocals['d']; excess: number };
    const d = dr.hits;
    // Excess damage each side assigned [467.2.c.4] (Vi, Yeti Brawler, Trapping Grounds).
    setField(s, c, 'excess', s.players.map((pl) => (pl.id === c.attacker ? l.ax : pl.id === c.defender ? dr.excess : 0)));
    const sources = (side: 'attacker' | 'defender') => designated(s, side).filter((id) => combatMight(s, id) > 0);
    const fromAttackers = sources('attacker'), fromDefenders = sources('defender');
    setField(s, c, 'assigned', [
      ...l.a.map((h) => ({ by: c.attacker, to: h.to, raw: h.raw, applied: h.raw, used: [] })),
      ...d.map((h) => ({ by: c.defender, to: h.to, raw: h.raw, applied: h.raw, used: [] })),
    ]);
    const hits = [...l.a.map((h) => ({ ...h, by: c.attacker, src: fromAttackers })),
      ...d.map((h) => ({ ...h, by: c.defender, src: fromDefenders }))];
    for (const by of [c.attacker, c.defender]) {
      const mine = hits.filter((h) => h.by === by);
      if (mine.length > 0) {
        deal(s, x, mine.map((h) => ({ to: h.to, n: h.raw })), { sources: mine[0].src, by, combat: true, rule: '467.2.d' });
      }
    }
    toResolution(s);                                                 // [467.3]
    return 'done';
  },
]);

// ---- Step 3: Resolution [468] ----

/**
 * [468.3]: won for the only designated player with units left there, lost
 * for the other; no result if attackers were recalled in the combat
 * cleanup, or both or neither have units there [468.3.d]. A no result with
 * both still there stages a showdown and a combat here [468.3.d.1].
 */
defineTask('combat.result', [(s, _f, x) => {
  const c = s.combat!;
  const present = playersWithUnitsAt(s, c.bf).filter((p) => p === c.attacker || p === c.defender);
  const result: ('won' | 'lost' | 'noResult')[] = s.players.map(() => 'noResult');
  if (!c.recalled && present.length === 1) {
    result[present[0]] = 'won';
    result[present[0] === c.attacker ? c.defender : c.attacker] = 'lost';
    append(s, s.log.combatsWon, { p: present[0], bf: c.bf, units: unitsAt(s, { z: 'bf', bf: c.bf }) });
    fire(s, x, { e: 'wonCombat', p: present[0], bf: c.bf, units: unitsAt(s, { z: 'bf', bf: c.bf }) });   // "When I win a combat"
  } else if (present.length === 2) {
    setField(s, s.bfs[c.bf].staged, 'showdown', true);
    setField(s, s.bfs[c.bf].staged, 'combat', true);
  }
  setField(s, c, 'result', result);
  emit(s, x, { k: 'combatResult', bf: c.bf, result, rule: '468.3' });
  setField(s, c, 'next', 'establishControl');
  return 'done';
}]);

/**
 * [468.5], only if nothing is staged here again: a lone player with units
 * here who doesn't control it establishes control, a Conquer if not yet
 * scored this turn [468.5.d], whether or not they attacked [468.5.e];
 * Contested ends [468.5.a]; with nobody here it becomes uncontrolled
 * [468.5.b]; facedown cards of others are removed [468.5.c] (none before
 * Hidden, M2). Order as listed (Spec G Q10).
 */
defineTask('combat.establishControl', [(s, _f, x) => {
  const c = s.combat!;
  const b = s.bfs[c.bf];
  if (!b.staged.showdown && !b.staged.combat) {
    const present = playersWithUnitsAt(s, c.bf);
    if (present.length === 1 && b.controller !== present[0]) establishControl(s, x, c.bf, present[0], '468.5');
    clearContested(s, x, c.bf, '468.5.a');
    if (present.length === 0) setController(s, x, c.bf, null, '468.5.b');
    trashForeignFacedown(s, x, c.bf, '468.5.c');
  }
  setField(s, c, 'next', 'end');
  return 'done';
}]);

/** [468.7]: designations are removed from every unit, "this combat" effects
    expire, the combat (and the state's Showdown) ends. */
defineTask('combat.end', [(s, _f, x) => {
  const c = s.combat!;
  const had = Object.values(s.objects).filter((o) => o.designation !== null).map((o) => o.id);
  for (const id of had) setField(s, s.objects[id], 'designation', null);
  if (had.length > 0) emit(s, x, { k: 'designate', objs: had, d: null, rule: '468.7.a' });
  if (s.effects.some((e) => e.until === 'thisCombat')) {            // "this combat" effects expire [468.7]
    setField(s, s, 'effects', s.effects.filter((e) => e.until !== 'thisCombat'));
  }
  setField(s, s, 'combat', null);
  setField(s, s, 'showdown', null);
  emit(s, x, { k: 'combatEnd', bf: c.bf, rule: '468.7' });
  fire(s, x, { e: 'combatEnded', bf: c.bf, units: [...new Set([...c.everAttacker, ...c.everDefender])] });   // "When a combat that I was in ends"
  requestCleanup(s);
  return 'done';
}]);
