/*
 * Choosing what an instruction acts on (Spec D §5.5–5.9, [355.5–355.13]):
 * selectors over the board, the candidates of a target slot, and whether a
 * chosen target is still legal as the item resolves [359.3.e.2].
 *
 * "Friendly" and "enemy" are relative to the item's controller [359.3.f.4];
 * "here" is where the item's source is now [359.3.f.2]. Every selector of
 * M1.2 picks permanents on the board; targets in other zones (a card in a
 * trash, a chain item, a player) arrive with the cards that need them.
 */
import type { LocSelAst, PredAst, SelAst, SlotAst } from '../dsl/ast.ts';
import { locOf } from '../state/zones.ts';
import type { GameState, Loc, ObjId, PlayerId, TargetRef } from '../state/types.ts';
import { energyCostOf, isType, mightOf } from './chars.ts';

export interface SelCtx { controller: PlayerId; source: ObjId | null }

/** Every permanent on the board: in the bases and at the battlefields. */
export function permanents(s: GameState): ObjId[] {
  return [...s.players.flatMap((pl) => pl.base), ...s.bfs.flatMap((b) => b.here)];
}

const sameLoc = (a: Loc, b: Loc) => a.z === b.z && (a.z === 'base' ? a.p === (b as typeof a).p : a.bf === (b as typeof a).bf);

/** Where "here" is for an item: its source's location now, or null when the
    source has left the board (null information [359.3.e.12]). */
export function hereOf(s: GameState, source: ObjId | null): Loc | null {
  if (source === null) return null;
  const o = s.objects[source];
  if (!o) return null;
  if (o.zone.z === 'bf' && s.bfs[o.zone.bf].obj === source) return { z: 'bf', bf: o.zone.bf };   // a battlefield's own "here"
  return locOf(o);
}

function locOk(s: GameState, at: LocSelAst | undefined, loc: Loc, c: SelCtx): boolean {
  switch (at ?? 'board') {
    case 'board': return true;
    case 'battlefield': return loc.z === 'bf';
    case 'base': return loc.z === 'base';
    case 'here': {
      const h = hereOf(s, c.source);
      return h !== null && sameLoc(h, loc);
    }
  }
}

const cmp = (a: number, op: string, b: number) =>
  op === '<' ? a < b : op === '<=' ? a <= b : op === '=' ? a === b : op === '>=' ? a >= b : a > b;

function predOk(s: GameState, p: PredAst, id: ObjId): boolean {
  const o = s.objects[id];
  switch (p.p) {
    case 'might': return cmp(mightOf(s, id), p.op, p.n);
    case 'energyCost': return cmp(energyCostOf(o), p.op, p.n);
    case 'exhausted': return o.exhausted;
    case 'ready': return !o.exhausted;
    case 'token': return o.token;
    case 'nonToken': return !o.token;
    case 'type': return p.any.some((t) => isType(o, t));
  }
}

/** Whether a board object matches a selector now. */
export function matches(s: GameState, sel: SelAst, id: ObjId, c: SelCtx): boolean {
  const o = s.objects[id];
  if (!o) return false;
  const loc = locOf(o);
  if (!loc || s.bfs.some((b) => b.obj === id)) return false;     // permanents only, never a battlefield itself
  if (sel.k === 'unit' && !isType(o, 'unit')) return false;
  if (sel.k === 'gear' && !isType(o, 'gear')) return false;
  if (sel.k === 'permanent' && !isType(o, 'unit') && !isType(o, 'gear')) return false;
  if (sel.k !== 'unit' && sel.k !== 'gear' && sel.k !== 'permanent') return false;
  if (sel.rel === 'friendly' && o.controller !== c.controller) return false;
  if (sel.rel === 'enemy' && (o.controller === c.controller || o.controller === null)) return false;
  if (!locOk(s, sel.at, loc, c)) return false;
  return (sel.where ?? []).every((p) => predOk(s, p, id));
}

/** Every board object a selector picks now, in board order. */
export const selectAll = (s: GameState, sel: SelAst, c: SelCtx): ObjId[] =>
  permanents(s).filter((id) => matches(s, sel, id, c));

/** The legal choices for a target slot [355.8]. */
export function slotCandidates(s: GameState, slot: SlotAst, c: SelCtx): ObjId[] {
  return permanents(s).filter((id) => slot.sel.some((sel) => matches(s, sel, id, c)));
}

/** A choice as the item records it: what, and where it was [359.3.e.2]. */
export function targetRef(s: GameState, id: ObjId): TargetRef {
  const o = s.objects[id];
  const loc = locOf(o);
  return loc ? { k: 'obj', id, zone: o.zone.z, loc } : { k: 'obj', id, zone: o.zone.z };
}

/** Whether a chosen target is still legal as the item resolves: the same
    object, in the same kind of zone, and it still fits the slot
    [359.3.e.2–4]. */
export function stillLegal(s: GameState, t: TargetRef, slot: SlotAst, c: SelCtx): boolean {
  if (t.k !== 'obj') return false;
  const o = s.objects[t.id];
  if (!o || o.zone.z !== t.zone) return false;
  return slot.sel.some((sel) => matches(s, sel, t.id, c));
}

/** The slot's least number of choices (1 unless "up to") [355.13]. */
export const slotMin = (slot: SlotAst) => slot.min ?? 1;
export const slotMax = (slot: SlotAst) => slot.max ?? 1;
