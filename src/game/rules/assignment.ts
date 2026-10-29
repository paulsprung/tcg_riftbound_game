/*
 * Combat damage assignment (§5.10.4, fix F6, Spec G §4.3–§4.5, [467.2.c]).
 *
 * The assigning player orders the opposing units; the amounts follow from
 * the order, so they never split amounts by hand:
 *
 *   1. a unit with both Tank and Backline gets one of the two for this
 *      assignment [467.2.c.8] (assignTier);
 *   2. while damage is left, the next unit is picked from the lowest
 *      unfinished tier, Tank before the rest before Backline [815], [826],
 *      [467.2.c.6–7], in any order inside a tier (assignNext); it gets
 *      exactly lethal, or everything left: lethal in full and no overkill
 *      [467.2.c.3–4];
 *   3. damage left once every unit that can be dealt damage has lethal goes
 *      wherever the player likes among the opposing units, one point at a
 *      time, the rest on the last pick when they say done (assignExcess).
 *      A unit that can't be dealt damage is exempt from the order and is
 *      offered only here [467.2.c.10]; with only such units, everything goes
 *      to them, to no effect (Spec G §4.5, Q4).
 *
 * Assigning is not dealing [467.2.c.1]: the frame hands its assignment back
 * to the damage step, which deals both sides' at once. Replacement effects
 * would fold into `applied` here [467.2.c.5]; there are none before M1.3, and
 * no unit is exempt, so applied = raw.
 */
import { K, parseKey, type Option } from '../core/decisions.ts';
import { answer, ask, defineSteps, next, ret, type FrameOf, type StepTable } from '../core/frames.ts';
import type { GameState, ObjId, PlayerId } from '../state/types.ts';
import { staticsFor } from '../layers/derive.ts';
import { unitsAt } from './board.ts';
import { damageOf, hasKeyword, lethalThreshold } from './chars.ts';

type AssignFrame = FrameOf<'assign'>;

/** The opposing units the assigner divides their total among: the other
    side's designated units at the battlefield [467.2.c]. */
export function assignees(s: GameState, f: Pick<AssignFrame, 'by'>): ObjId[] {
  const c = s.combat!;
  const theirs = f.by === c.attacker ? 'defender' : 'attacker';
  return unitsAt(s, { z: 'bf', bf: c.bf }).filter((id) => s.objects[id].designation === theirs);
}

/** A unit that can't be dealt damage [467.2.c.10]. No such effect exists before the card abilities (M1.3). */
export const isExempt = (_s: GameState, _id: ObjId) => false;

/** The least damage that is lethal for this unit, given what it has already
    [467.2.c.3], [142.4.b]: needed = max(1, threshold − damage). */
export function lethalAssign(s: GameState, id: ObjId): number {
  return Math.max(1, lethalThreshold(s, id) - damageOf(s.objects[id]));
}

/** 0 Tank, 1 neither, 2 Backline; a unit with both takes the tier its
    assigner picked [467.2.c.8]. */
export function tierOf(s: GameState, f: Pick<AssignFrame, 'tier'> & { by?: PlayerId }, id: ObjId): number {
  // Dune Surfer: "You ignore [Tank] while assigning combat damage here."
  const ignore = f.by !== undefined && !!s.combat && staticsFor(s, null, 'ignoreTank').some(({ st }) => st.ctl === f.by
    && s.objects[st.host]?.zone.z === 'bf' && (s.objects[st.host].zone as { bf: number }).bf === s.combat!.bf);
  const tank = !ignore && hasKeyword(s, id, 'tank'), back = hasKeyword(s, id, 'backline');
  if (tank && back) return f.tier[id] === 'backline' ? 2 : 0;
  return tank ? 0 : back ? 2 : 1;
}

/** What each unit in the order gets, and what is left over. */
export function amounts(s: GameState, f: Pick<AssignFrame, 'order' | 'total'>): { to: ObjId; raw: number }[] {
  let left = f.total;
  const out: { to: ObjId; raw: number }[] = [];
  for (const id of f.order) {
    const raw = Math.min(left, lethalAssign(s, id));
    out.push({ to: id, raw });
    left -= raw;
  }
  return out;
}

const assignedSoFar = (s: GameState, f: AssignFrame) => amounts(s, f).reduce((n, a) => n + a.raw, 0) + f.excess.length;

/** The units that may come next in the order: the lowest unfinished tier,
    any of them [467.2.c.7]. */
export function legalNextAssignees(s: GameState, f: AssignFrame): ObjId[] {
  const cands = assignees(s, f).filter((id) => !isExempt(s, id) && !f.order.includes(id));
  if (cands.length === 0) return [];
  const t = Math.min(...cands.map((id) => tierOf(s, f, id)));
  return cands.filter((id) => tierOf(s, f, id) === t);
}

const STEPS: StepTable<AssignFrame> = [
  // pc 0: a tier for each unit with both Tank and Backline [467.2.c.8].
  (s, f, x) => {
    const both = assignees(s, f).filter((id) => hasKeyword(s, id, 'tank') && hasKeyword(s, id, 'backline')
      && f.tier[id] === undefined);
    if (both.length === 0) return next(f);
    const id = both[0];
    const key = answer(f);
    if (key === undefined) {
      return ask(s, f, x, {
        player: f.by, kind: 'assignTier', prompt: { t: 'assignTier', unit: id }, ctx: { source: id, rule: '467.2.c.8' },
        options: [{ key: K.tank, refs: [{ obj: id }] }, { key: K.backline, refs: [{ obj: id }] }], privateOptions: false,
        batch: `assign:p${f.by}`,
      });
    }
    f.tier = { ...f.tier, [id]: key === K.tank ? 'tank' : 'backline' };
    return 'continue';
  },
  // pc 1: the order, one unit at a time [467.2.c.3–7].
  (s, f, x) => {
    const left = f.total - assignedSoFar(s, f);
    const cands = left > 0 ? legalNextAssignees(s, f) : [];
    if (cands.length === 0) return next(f);
    const key = answer(f);
    if (key === undefined) {
      const options: Option[] = cands.map((id) => ({
        key: K.a(id), refs: [{ obj: id }], meta: { amount: Math.min(left, lethalAssign(s, id)) },
      }));
      return ask(s, f, x, {
        player: f.by, kind: 'assignNext', prompt: { t: 'assignNext', left, total: f.total }, ctx: { rule: '467.2.c' },
        options, privateOptions: false, batch: `assign:p${f.by}`,
      });
    }
    f.order = [...f.order, parseKey(key)!.obj!];
    return 'continue';
  },
  // pc 2: the excess, once every unit that can be dealt damage has lethal [467.2.c.4].
  (s, f, x) => {
    const left = f.total - assignedSoFar(s, f);
    const all = assignees(s, f);
    if (left <= 0 || all.length === 0) return next(f);
    if (all.length === 1) {                                          // only one place it can go
      f.excess = [...f.excess, ...Array.from({ length: left }, () => all[0])];
      return next(f);
    }
    const key = answer(f);
    if (key === undefined) {
      const options: Option[] = all.map((id) => ({ key: K.x(id), refs: [{ obj: id }], meta: { amount: 1 } }));
      if (f.excess.length > 0) options.push({ key: K.done, meta: { amount: left } });
      return ask(s, f, x, {
        player: f.by, kind: 'assignExcess', prompt: { t: 'assignExcess', left }, ctx: { rule: '467.2.c.4' },
        options, privateOptions: false, batch: `assign:p${f.by}`,
      });
    }
    if (key === K.done) {
      const last = f.excess[f.excess.length - 1];
      f.excess = [...f.excess, ...Array.from({ length: left }, () => last)];
      return next(f);
    }
    f.excess = [...f.excess, parseKey(key)!.obj!];
    return 'continue';
  },
  // pc 3: hand the assignment to the damage step.
  (s, f) => {
    const out = amounts(s, f);
    for (const id of f.excess) {
      const row = out.find((a) => a.to === id);
      if (row) row.raw++;
      else out.push({ to: id, raw: 1 });
    }
    return ret(s, f, { hits: out.filter((a) => a.raw > 0).map((a) => ({ to: a.to, raw: a.raw })), excess: f.excess.length });
  },
];

defineSteps('assign', STEPS);
