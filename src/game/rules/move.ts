/*
 * The Standard Move (§5.12, Spec F §35.3, Spec B §2.7, [144], [421.3]):
 * the Discretionary Action whose cost is exhausting the units and whose
 * effect is moving them.
 *
 *   timing   own Main Phase, not Closed, no showdown or combat [144.1.a–c]
 *   units    one or more ready units the player controls (moveUnits, a
 *            batch); all must share the destination [144.3.a], origins may
 *            differ [144.3.b]
 *   routes   base → a battlefield [144.4.a]; battlefield → own base
 *            [144.4.b]; battlefield → battlefield only with Ganking
 *            [144.4.c] (Ganking is not implemented yet (M2), so no unit
 *            has it)
 *   cost     the exhausts are paid at once, as one exhaust action [144.3.c]
 *   effect   one Move action [448]; Contested at the destination [452]; a
 *            cleanup [455], which stages and begins showdowns and combats
 *
 * Nothing changes until the destination is chosen (gather, then commit),
 * so `back` simply leaves the frame.
 */
import { K, parseKey, type Option } from '../core/decisions.ts';
import { answer, ask, defineSteps, next, type FrameOf, type StepTable } from '../core/frames.ts';
import { locOf } from '../state/zones.ts';
import type { Frame, GameState, Loc, ObjId, PlayerId } from '../state/types.ts';
import { cantMove, exhaust, moveUnits } from './actions.ts';
import { hasKeyword } from './chars.ts';
import { staticsFor } from '../layers/derive.ts';
import { payStep } from '../play/pay.ts';
import { bfOpenTo, turnState, unitsOnBoard } from './board.ts';

type MoveFrame = FrameOf<'move'>;

export const moveFrame = (by: PlayerId): Frame => ({ f: 'move', by, units: [], dest: null, pc: 0, snap: null });

const sameLoc = (a: Loc, b: Loc) => a.z === b.z && (a.z === 'base' ? a.p === (b as typeof a).p : a.bf === (b as typeof a).bf);
const locKey = (l: Loc) => (l.z === 'base' ? 'base' : `bf${l.bf}`);

/** Where a unit may Standard Move to from where it is [144.4]. */
export function moveDestinations(s: GameState, id: ObjId): Loc[] {
  const o = s.objects[id];
  const at = locOf(o);
  if (!at || o.controller === null || cantMove(s, id)) return [];
  const ctl = o.controller;
  if (at.z === 'base') return s.bfs.flatMap((_, bf): Loc[] => (bfOpenTo(s, bf, ctl) ? [{ z: 'bf', bf }] : []));   // [144.4.a], [491]
  const out: Loc[] = noMoveToBase(s, at.bf, id) ? [] : [{ z: 'base', p: o.controller }];   // [144.4.b]; Vilemaw's Lair
  const ganking = hasKeyword(s, id, 'ganking');
  s.bfs.forEach((_, bf) => {                                         // [144.4.c], [810.1.b]; Baron Pit: "from anywhere"
    if (bf !== at.bf && (ganking || moveHereFromAnywhere(s, bf)) && bfOpenTo(s, bf, ctl)) out.push({ z: 'bf', bf });
  });
  return out;
}

/** Baron Pit: "Units can move here from anywhere." */
const moveHereFromAnywhere = (s: GameState, bf: number) => staticsFor(s, null, 'moveHereFromAnywhere')
  .some(({ st }) => s.bfs[bf].obj === st.host);

/** "Units can't move from here to base" (Vilemaw's Lair); "I can't move to base" (a unit's own). */
export const noMoveToBase = (s: GameState, bf: number, unit?: ObjId) => staticsFor(s, null, 'noMoveToBase').some(({ st, spec }) => {
  const h = s.objects[st.host];
  if (spec.self) return unit !== undefined && st.host === unit;
  return spec.anywhere === true || (h.zone.z === 'bf' && h.zone.bf === bf);
});

/** Mageseeker Investigator: an opponent moving several units here at once
    pays [A] for each unit beyond the first, per instance [204.4]. */
export function moveTax(s: GameState, by: PlayerId, units: ObjId[], dest: Loc): { energy: number; power: number } {
  const n = { energy: 0, power: 0 };
  if (dest.z !== 'bf') return n;
  for (const { st, spec } of staticsFor(s, null, 'moveTax')) {
    const h = s.objects[st.host];
    if (h.zone.z !== 'bf' || h.zone.bf !== dest.bf || st.ctl === by) continue;
    if (spec.cost) { n.energy += spec.cost.energy; n.power += spec.cost.power; }   // Gravity Field: once per move
    else if (units.length >= 2) n.power += units.length - 1;
  }
  return n;
}

/** The destinations every one of these units can reach. */
export function sharedDestinations(s: GameState, units: ObjId[]): Loc[] {
  if (units.length === 0) return [];
  return moveDestinations(s, units[0]).filter((l) => units.every((u) => moveDestinations(s, u).some((m) => sameLoc(l, m))));
}

/** Units p can Standard Move: ready (the exhaust cost [415.4]), theirs, with somewhere to go. */
export function movableUnits(s: GameState, p: PlayerId): ObjId[] {
  return unitsOnBoard(s).filter((id) => {
    const o = s.objects[id];
    return o.controller === p && !o.exhausted && moveDestinations(s, id).length > 0;
  });
}

/** Whether p may start a Standard Move now [144.1]. */
export function canStandardMove(s: GameState, p: PlayerId): boolean {
  return s.turn.player === p && s.turn.phase === 'main' && turnState(s) === 'NeutralOpen' && movableUnits(s, p).length > 0;
}

const STEPS: StepTable<MoveFrame> = [
  // pc 0: the units, one pick at a time; each must still share a destination with the others.
  (s, f, x) => {
    const cands = movableUnits(s, f.by).filter((u) => !f.units.includes(u)
      && sharedDestinations(s, [...f.units, u]).length > 0);
    const key = answer(f);
    if (key === K.back) return 'done';
    if (key === K.done) return next(f);
    if (key === undefined) {
      const options: Option[] = cands.map((u) => ({ key: K.u(u), refs: [{ obj: u }] }));
      if (f.units.length > 0) options.push({ key: K.done });
      return ask(s, f, x, {
        player: f.by, kind: 'moveUnits', prompt: { t: 'moveUnits', chosen: f.units.length }, ctx: { rule: '144.3' },
        options, privateOptions: false, back: true, batch: `move:p${f.by}:t${s.turn.n}`,
      });
    }
    f.units = [...f.units, parseKey(key)!.obj!];
    return 'continue';
  },
  // pc 1: one destination for all [144.3.a].
  (s, f, x) => {
    const dests = sharedDestinations(s, f.units);
    const key = answer(f);
    if (key === K.back) return 'done';
    if (key === undefined) {
      return ask(s, f, x, {
        player: f.by, kind: 'moveDest', prompt: { t: 'moveDest', units: f.units.length }, ctx: { rule: '144.4' },
        options: dests.map((l) => ({ key: l.z === 'base' ? K.locBase : K.locBf(l.bf), refs: [{ loc: l }] })),
        privateOptions: false, back: true, batch: `move:p${f.by}:t${s.turn.n}`,
      });
    }
    const k = parseKey(key)!;
    f.dest = k.loc === 'base' ? { z: 'base', p: f.by } : { z: 'bf', bf: (k.loc as { bf: number }).bf };
    if (!dests.some((l) => locKey(l) === locKey(f.dest!))) throw new Error(`bad destination ${key}`);
    return next(f);
  },
  // pc 2: applied costs [204.4], then pay (one exhaust action [144.3.c]),
  // then move [448], then a cleanup [455].
  (s, f, x) => {
    const tax = moveTax(s, f.by, f.units, f.dest!);
    if (tax.energy + tax.power > 0) {
      const r = payStep(s, f, x, { payer: f.by, cost: { energy: tax.energy, power: Array.from({ length: tax.power }, () => ({ k: 'any' as const })) },
        what: 'move', back: true, onBack: () => 'done', onDecline: () => 'done', rule: '204.4' });
      if (typeof r === 'string') return r;
    }
    exhaust(s, x, f.by, f.units, '144.2', true);
    moveUnits(s, x, f.units, f.dest!, { by: f.by, standard: true, rule: '144.3' });
    return 'done';
  },
];

defineSteps('move', STEPS);
