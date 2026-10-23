/*
 * Choosing what an instruction acts on (Spec D §5.5–5.9, [355.5–355.13]):
 * selectors over the board, the cards of a trash or hand, the spells on the
 * chain, the candidates of a target slot, and whether a chosen target is
 * still legal as the item resolves [359.3.e.2].
 *
 * "Friendly" and "enemy" are relative to the item's controller [359.3.f.4];
 * "here" is where the item's source is now [359.3.f.2]. The special terms
 * of [740] are predicates: alone, one on one, in combat [740.2]; "open" and
 * "occupied" battlefields [170.11]; Mighty [708].
 */
import type { LocSelAst, PredAst, SelAst, SlotAst } from '../dsl/ast.ts';
import { locOf } from '../state/zones.ts';
import type { GameState, Loc, ObjId, PlayerId, TargetRef } from '../state/types.ts';
import { energyCostOf, hasKeyword, isType, mightOf, tagsOf } from './chars.ts';

export interface SelCtx {
  controller: PlayerId; source: ObjId | null;
  /** Where the battlefields some slots chose are ("friendly units there"). */
  slotLoc?: Record<string, Loc | null>;
  /** The object the trigger condition named ("another unit", "it"). */
  subject?: ObjId | null;
  /** The battlefield the trigger condition named ("at that battlefield"). */
  eventBf?: number | null;
}

/** Every permanent on the board: in the bases and at the battlefields. */
export function permanents(s: GameState): ObjId[] {
  return [...s.players.flatMap((pl) => pl.base), ...s.bfs.flatMap((b) => b.here)];
}

export const sameLoc = (a: Loc, b: Loc) => a.z === b.z && (a.z === 'base' ? a.p === (b as typeof a).p : a.bf === (b as typeof a).bf);

/** Where "here" is for an item: its source's location now, or null when the
    source has left the board (null information [359.3.e.12]). */
export function hereOf(s: GameState, source: ObjId | null): Loc | null {
  if (source === null) return null;
  const o = s.objects[source];
  if (!o) return null;
  if (o.zone.z === 'bf' && s.bfs[o.zone.bf].obj === source) return { z: 'bf', bf: o.zone.bf };   // a battlefield's own "here"
  if (o.zone.z === 'facedown') return { z: 'bf', bf: o.zone.bf };
  return locOf(o);
}

function locOk(s: GameState, at: LocSelAst | undefined, loc: Loc, c: SelCtx): boolean {
  if (typeof at === 'object') {
    const l = c.slotLoc?.[at.slot];
    return !!l && sameLoc(l, loc);
  }
  switch (at ?? 'board') {
    case 'board': return true;
    case 'battlefield': return loc.z === 'bf';
    case 'base': return loc.z === 'base';
    case 'here': {
      const h = hereOf(s, c.source);
      return h !== null && sameLoc(h, loc);
    }
    case 'elsewhere': {
      const h = hereOf(s, c.source);
      return h === null || !sameLoc(h, loc);
    }
    case 'eventBf': return c.eventBf !== undefined && c.eventBf !== null && loc.z === 'bf' && loc.bf === c.eventBf;
  }
}

export const cmp = (a: number, op: string, b: number) =>
  op === '<' ? a < b : op === '<=' ? a <= b : op === '=' ? a === b : op === '>=' ? a >= b : a > b;

/** The friendly units at a unit's location other than itself [740.2.a]. */
export function friendsAt(s: GameState, id: ObjId): ObjId[] {
  const o = s.objects[id];
  const loc = o ? locOf(o) : null;
  if (!loc) return [];
  const ids = loc.z === 'base' ? s.players[loc.p].base : s.bfs[loc.bf].here;
  return ids.filter((u) => u !== id && isType(s.objects[u], 'unit') && s.objects[u].controller === o.controller);
}

/** Alone: no other friendly units at its location [740.2.a]. */
export const isAlone = (s: GameState, id: ObjId) => friendsAt(s, id).length === 0;

/** One on one: alone, with exactly one enemy unit there, itself alone [740.2.b]. */
export function isOneOnOne(s: GameState, id: ObjId): boolean {
  const o = s.objects[id];
  const loc = o ? locOf(o) : null;
  if (!loc || !isAlone(s, id)) return false;
  const ids = loc.z === 'base' ? s.players[loc.p].base : s.bfs[loc.bf].here;
  const enemies = ids.filter((u) => isType(s.objects[u], 'unit') && s.objects[u].controller !== o.controller);
  return enemies.length === 1;
}

/** In combat: at the combat's battlefield with a designation [740.2.c]. */
export function inCombat(s: GameState, id: ObjId): boolean {
  const o = s.objects[id];
  return !!s.combat && !!o && o.zone.z === 'bf' && o.zone.bf === s.combat.bf && o.designation !== null;
}

const unitsHere = (s: GameState, bf: number) => s.bfs[bf].here.filter((u) => isType(s.objects[u], 'unit'));

export function predOk(s: GameState, p: PredAst, id: ObjId, c: SelCtx): boolean {
  const o = s.objects[id];
  switch (p.p) {
    case 'might': return cmp(mightOf(s, id), p.op, p.n);
    case 'energyCost': return cmp(energyCostOf(o), p.op, p.n);
    case 'exhausted': return o.exhausted;
    case 'ready': return !o.exhausted;
    case 'token': return o.token;
    case 'nonToken': return !o.token;
    case 'type': return p.any.some((t) => isType(o, t));
    case 'tag': return tagsOf(o).includes(p.tag);
    case 'buffed': return o.buffs > 0;
    case 'stunned': return o.stunned;
    case 'mighty': return locOf(o) !== null ? mightOf(s, id) >= 5 : false;   // [708], [710]
    case 'equipped': return Object.values(s.objects).some((g) => g.attachedTo === id && tagsOf(g).includes('Equipment'));
    case 'attached': return o.attachedTo !== null;
    case 'movedThisTurn': return o.moves > 0;
    case 'alone': return isAlone(s, id);
    case 'oneOnOne': return isOneOnOne(s, id);
    case 'inCombat': return inCombat(s, id);
    case 'designation': return o.designation === p.d;
    case 'attackingWithOther': return o.designation === 'attacker'
      && friendsAt(s, id).some((u) => s.objects[u].designation === 'attacker');
    case 'keyword': return hasKeyword(s, id, p.kw);
    case 'open': {                                                   // [170.11.c]
      const bf = s.bfs.findIndex((b) => b.obj === id);
      return bf >= 0 && s.bfs[bf].controller === null && unitsHere(s, bf).length === 0;
    }
    case 'occupied': {                                               // [170.11.a]
      const bf = s.bfs.findIndex((b) => b.obj === id);
      return bf >= 0 && unitsHere(s, bf).length > 0;
    }
    case 'notSubject': return c.subject === undefined || c.subject === null || id !== c.subject;
    case 'not': return !predOk(s, p.of, id, c);
  }
}

const relOk = (rel: SelAst['rel'], owner: PlayerId | null, p: PlayerId) =>
  rel === 'friendly' ? owner === p : rel === 'enemy' ? owner !== null && owner !== p : true;

/** Whether an object matches a selector now. */
export function matches(s: GameState, sel: SelAst, id: ObjId, c: SelCtx): boolean {
  const o = s.objects[id];
  if (!o) return false;
  if (sel.k === 'card') {                                            // a card in a trash or hand, by its owner
    if (o.zone.z !== (sel.in ?? 'trash') || !relOk(sel.rel, o.owner, c.controller)) return false;
    return (sel.where ?? []).every((p) => predOk(s, p, id, c));
  }
  if (sel.k === 'spell') {                                           // a spell on the chain, finalized [355.9.a.2]
    if (o.zone.z !== 'chain' || !isType(o, 'spell')) return false;
    const it = s.chain.find((i) => i.obj === id);
    if (!it || it.status !== 'finalized' || it.kind !== 'card') return false;
    return relOk(sel.rel, it.controller, c.controller) && (sel.where ?? []).every((p) => predOk(s, p, id, c));
  }
  if (sel.k === 'facedown') {
    if (o.zone.z !== 'facedown' || !relOk(sel.rel, o.controller, c.controller)) return false;
    return locOk(s, sel.at, { z: 'bf', bf: o.zone.bf }, c);
  }
  if (sel.k === 'legend') return o.zone.z === 'legend' && relOk(sel.rel, o.controller, c.controller)
    && (sel.where ?? []).every((p) => predOk(s, p, id, c));
  const isBf = s.bfs.some((b) => b.obj === id);
  if (sel.k === 'battlefield' || isBf) {                           // battlefields only where a selector asks for one
    if (sel.k !== 'battlefield' || !isBf) return false;
    if (sel.rel === 'friendly' && o.controller !== c.controller) return false;
    if (sel.rel === 'enemy' && (o.controller === c.controller || o.controller === null)) return false;
    return (sel.where ?? []).every((p) => predOk(s, p, id, c));
  }
  const loc = locOf(o);
  if (!loc) return false;
  if (sel.other && id === c.source) return false;                   // "other" [355.9.c]
  if (sel.k === 'unit' && !isType(o, 'unit')) return false;
  if (sel.k === 'gear' && !isType(o, 'gear')) return false;
  if (sel.k === 'permanent' && !isType(o, 'unit') && !isType(o, 'gear')) return false;
  if (sel.k === 'rune' && !isType(o, 'rune')) return false;
  if (sel.rel === 'friendly' && o.controller !== c.controller) return false;
  if (sel.rel === 'enemy' && (o.controller === c.controller || o.controller === null)) return false;
  if (!locOk(s, sel.at, loc, c)) return false;
  return (sel.where ?? []).every((p) => predOk(s, p, id, c));
}

/** Where a selector looks. */
function pool(s: GameState, sel: SelAst): ObjId[] {
  switch (sel.k) {
    case 'battlefield': return s.bfs.map((b) => b.obj);
    case 'card': return s.players.flatMap((pl) => (sel.in === 'hand' ? pl.hand : pl.trash));
    case 'spell': return s.chain.flatMap((i) => (i.obj !== undefined ? [i.obj] : []));
    case 'legend': return s.players.flatMap((pl) => pl.legend);
    case 'facedown': return s.bfs.flatMap((b) => b.facedown);
    default: return permanents(s);
  }
}

/** Every object a selector picks now, in board order. */
export const selectAll = (s: GameState, sel: SelAst, c: SelCtx): ObjId[] =>
  pool(s, sel).filter((id) => matches(s, sel, id, c));

/** The legal choices for a target slot [355.8]. */
export function slotCandidates(s: GameState, slot: SlotAst, c: SelCtx): ObjId[] {
  const ids = [...new Set(slot.sel.flatMap((sel) => pool(s, sel)))];
  return ids.filter((id) => slot.sel.some((sel) => matches(s, sel, id, c)));
}

/** A choice as the item records it: what, and where it was [359.3.e.2]. */
export function targetRef(s: GameState, id: ObjId): TargetRef {
  const o = s.objects[id];
  const bf = s.bfs.findIndex((b) => b.obj === id);
  if (bf >= 0) return { k: 'obj', id, zone: 'bf', loc: { z: 'bf', bf } };
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
