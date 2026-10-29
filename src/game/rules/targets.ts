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
import type { ChainItem, GameObject, GameState, ItemId, Loc, ObjId, PlayerId, TargetRef, TokenId } from '../state/types.ts';
import { cardDef as cardDefOf } from '../cards/registry.ts';
import { energyCostOf, hasKeyword, isType, mightOf, tagsOf } from './chars.ts';
import { findCard } from '../cards/oracle.ts';
import { staticsFor } from '../layers/derive.ts';
import { TOKENS } from '../cards/tokens.ts';

export interface SelCtx {
  controller: PlayerId; source: ObjId | null;
  /** Where the battlefields some slots chose are ("friendly units there"). */
  slotLoc?: Record<string, Loc | null>;
  /** The object the trigger condition named ("another unit", "it"). */
  subject?: ObjId | null;
  /** The battlefield the trigger condition named ("at that battlefield"). */
  eventBf?: number | null;
  /** Where the source was as it left the board ("all units at my battlefield" in a Deathknell). */
  lkiHere?: Loc | null;
  /** What the item's slots chose ("each other enemy unit there"). */
  slotObjs?: Record<string, ObjId[]>;
  /** Where the trigger's unit moved from. */
  eventFrom?: Loc | null;
  /** The cost of the object a cost of the item killed ("costs no more … than the killed unit"). */
  paidCost?: { energy: number; power: number } | null;
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
      const h = hereOf(s, c.source) ?? c.lkiHere ?? null;
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

/** Ivern: "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag." */
export const hasChosenTag = (o: GameObject, tag: string) => o.named?.kind === 'tag' && o.named.value === tag
  && locOf(o) !== null && (cardDefOf(o.def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'chooseTag' && a.spec.gain !== false);

/** How many times an object can be [Empowered]: once [442.1.c.1], or as its own text says (Kayle). */
export const maxEmpowerOf = (s: GameState, id: ObjId) => Math.max(1, ...staticsFor(s, id, 'maxEmpower').map(({ spec }) => spec.n));

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
    case 'tag': return tagsOf(o).includes(p.tag) || staticsFor(s, id, 'tag').some(({ spec }) => spec.tag === p.tag)   // "I am a Mech"
      || hasChosenTag(o, p.tag);
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
    case 'damaged': return o.damage.length > 0;
    case 'inZone': return o.zone.z === p.z;
    case 'choosesFriendly': {
      const it = s.chain.find((i) => i.obj === id);
      return !!it && itemChoosesFriendly(s, it, c);
    }
    case 'linked': return o.links.some((l) => l.group === p.group);
    case 'rel': return p.rel === 'friendly' ? o.controller === c.controller : o.controller !== null && o.controller !== c.controller;
    case 'moves': return o.moves === p.n;
    case 'name': return (findCard(o.def)?.name ?? (Object.hasOwn(TOKENS, o.def) ? TOKENS[o.def as TokenId].name : o.def)) === p.name;
    case 'atEventBf': return c.eventBf !== undefined && c.eventBf !== null && o.zone.z === 'bf' && o.zone.bf === c.eventBf;
    case 'powerCost': return cmp(findCard(o.def)?.cost?.power.length ?? 0, p.op, p.n);
    case 'energyCostVsPoints': return cmp(energyCostOf(o), p.op, s.players[c.controller].points);
    case 'notSubject': return c.subject === undefined || c.subject === null || id !== c.subject;
    case 'not': return !predOk(s, p.of, id, c);
    case 'mightVsSource': {
      const src = c.source === null ? undefined : s.objects[c.source];
      return !!src && locOf(src) !== null && cmp(mightOf(s, id), p.op, mightOf(s, c.source!));
    }
    case 'notSlot': return !(c.slotObjs?.[p.slot] ?? []).includes(id);
    case 'anyTag': return p.tags.some((t) => predOk(s, { p: 'tag', tag: t }, id, c));
    case 'enemyMightBelowSource': {
      const bf = s.bfs.findIndex((b) => b.obj === id);
      const src = c.source === null ? undefined : s.objects[c.source];
      if (bf < 0 || !src) return false;
      const total = unitsHere(s, bf).filter((u) => s.objects[u].controller !== c.controller)
        .reduce((n, u) => n + Math.max(0, mightOf(s, u)), 0);
      return mightOf(s, c.source!) > total;
    }
    case 'unitsHere': {                                              // "a battlefield where you have units"
      const bf = s.bfs.findIndex((b) => b.obj === id);
      return bf >= 0 && unitsHere(s, bf).some((u) => (p.rel === 'friendly' ? s.objects[u].controller === c.controller
        : s.objects[u].controller !== null && s.objects[u].controller !== c.controller));
    }
    case 'mightVsSlot': {                                            // "with less Might than the chosen unit"
      const other = c.slotObjs?.[p.slot]?.[0];
      if (other === undefined) return c.slotObjs === undefined;      // judged once that slot is chosen
      return !!s.objects[other] && locOf(s.objects[other]) !== null && cmp(mightOf(s, id), p.op, mightOf(s, other));
    }
    case 'notAtSlot': {                                              // "at a different location"
      const other = c.slotObjs?.[p.slot]?.[0];
      const a = other === undefined || !s.objects[other] ? null : locOf(s.objects[other]), b = locOf(o);
      return !a || !b || !sameLoc(a, b);
    }
    case 'choosesOnly': {                                            // "a spell … that chooses it and no other friendly unit"
      const it = s.chain.find((i) => i.obj === id);
      return !!it && itemChoosesOnly(s, it, p.slot, c);
    }
    case 'empowered': return o.empowered > 0;
    case 'empoweredAtLeast': return o.empowered >= p.n;
    case 'attachedToSource': return c.source !== null && o.attachedTo === c.source;
    case 'atSource': {
      const h = hereOf(s, c.source), at = locOf(o);
      return !!h && !!at && sameLoc(h, at);
    }
    case 'energyAtMostSourceMight': {
      const src = c.source === null ? undefined : s.objects[c.source];
      return !!src && energyCostOf(o) <= Math.max(0, mightOf(s, c.source!));
    }
    case 'canEmpower': return o.empowered < maxEmpowerOf(s, id);
    case 'unitCount': {
      const bf = s.bfs.findIndex((b) => b.obj === id);
      return bf >= 0 && unitsHere(s, bf).length === p.n;
    }
    case 'minMoves': return o.moves >= p.n;
    case 'ownedByYou': return o.owner === c.controller;
    case 'domain': return (findCard(o.def)?.domains ?? []).includes(p.d);
    case 'inCombatWithDomain': return inCombat(s, id) && s.bfs[(o.zone as { bf: number }).bf].here.some((u) => u !== id
      && inCombat(s, u) && s.objects[u].controller !== o.controller && (findCard(s.objects[u].def)?.domains ?? []).includes(p.d));
    case 'chosenBySpellOfDomain': return s.chain.some((it) => it.kind === 'card' && it.obj !== undefined && it.controller !== c.controller
      && (findCard(s.objects[it.obj]?.def ?? '')?.domains ?? []).includes(p.d)
      && it.play.choices.executions.some((ex) => Object.values(ex.targets).flat().some((t) => t.k === 'obj' && t.id === id)));
    case 'damagedThisTurn': return (s.log.damaged ?? []).includes(id);
    case 'inShowdown': return s.showdown !== null && o.zone.z === 'bf' && o.zone.bf === s.showdown.bf;
    case 'atMoveEnds': {                                             // "a battlefield I moved to or from"
      const at = locOf(o);
      if (!at || at.z !== 'bf') return false;
      return (c.eventBf !== undefined && c.eventBf !== null && at.bf === c.eventBf) || (c.eventFrom?.z === 'bf' && c.eventFrom.bf === at.bf);
    }
    case 'mightiest': return permanents(s).every((u) => u === id || !isType(s.objects[u], 'unit') || mightOf(s, u) < mightOf(s, id));
    case 'champion': return (findCard(o.def)?.supertypes ?? []).includes('champion');
    case 'namedTag': {                                               // The List: "a unit with the named tag"
      const src = c.source === null ? undefined : s.objects[c.source];
      const tag = src?.named?.kind === 'tag' ? src.named.value : undefined;
      return tag !== undefined && predOk(s, { p: 'tag', tag }, id, c);
    }
    case 'costAtMostPaid': {
      const pc = c.paidCost;
      if (!pc) return false;
      return energyCostOf(o) <= pc.energy && (findCard(o.def)?.cost?.power.length ?? 0) <= pc.power;
    }
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
    if (sel.other && id === c.source) return false;
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
    case 'card': return s.players.flatMap((pl) => (sel.in === 'hand' ? pl.hand : sel.in === 'champion'
      ? (pl.champion === null ? [] : [pl.champion]) : sel.in === 'banish' ? pl.banish : pl.trash));
    case 'spell': return s.chain.flatMap((i) => (i.obj !== undefined ? [i.obj] : []));
    case 'legend': return s.players.flatMap((pl) => pl.legend);
    case 'facedown': return s.bfs.flatMap((b) => b.facedown);
    default: return permanents(s);
  }
}

/** Every object a selector picks now, in board order. */
export const selectAll = (s: GameState, sel: SelAst, c: SelCtx): ObjId[] =>
  pool(s, sel).filter((id) => matches(s, sel, id, c));

/** Where what the slots chose is ("friendly units there", "an enemy unit at the same battlefield"): a chosen
    battlefield, a chosen object's location now, a destination. */
export function slotLocsOf(s: GameState, ex: { targets: Record<string, TargetRef[]>; dests: Record<string, Loc> } | undefined):
  Record<string, Loc | null> {
  const out: Record<string, Loc | null> = {};
  for (const [slot, ts] of Object.entries(ex?.targets ?? {})) {
    const t = ts[0];
    if (t?.k !== 'obj') continue;
    const bf = s.bfs.findIndex((b) => b.obj === t.id);
    const o = s.objects[t.id];
    out[slot] = bf >= 0 ? { z: 'bf', bf } : o ? locOf(o) : null;
    if (t.loc) out[`was:${slot}`] = t.loc;                           // where it was as it was chosen ("that battlefield")
  }
  for (const [slot, l] of Object.entries(ex?.dests ?? {})) out[slot] = l;
  return out;
}

/** The legal choices for a target slot [355.8]. */
/** A chain item chose a friendly unit or gear (Not So Fast). */
function itemChoosesFriendly(s: GameState, it: ChainItem, c: SelCtx): boolean {
  return it.play.choices.executions.some((ex) => Object.values(ex.targets).flat().some((t) => t.k === 'obj'
    && s.objects[t.id]?.controller === c.controller && (isType(s.objects[t.id], 'unit') || isType(s.objects[t.id], 'gear'))));
}

/** A chain item chooses what the slot chose and no other friendly unit (Repulse). */
function itemChoosesOnly(s: GameState, it: ChainItem, slot: string, c: SelCtx): boolean {
  const chosen = it.play.choices.executions.flatMap((ex) => Object.values(ex.targets).flat())
    .flatMap((t) => (t.k === 'obj' && s.objects[t.id] ? [t.id] : []));
  const friendly = [...new Set(chosen.filter((u) => isType(s.objects[u], 'unit') && s.objects[u].controller === c.controller))];
  const want = c.slotObjs?.[slot]?.[0];
  if (want === undefined) return friendly.length === 1;              // not chosen yet: some single friendly unit
  return friendly.length === 1 && friendly[0] === want;
}

/** Whether a finalized ability item on the chain fits a "spell or ability" selector [355.9.a.2]. */
export function itemMatches(s: GameState, sel: SelAst, item: ItemId, c: SelCtx): boolean {
  const it = s.chain.find((i) => i.id === item);
  if (!sel.abilities || sel.k !== 'spell' || !it || it.obj !== undefined || it.status !== 'finalized' || it.isAdd) return false;
  if (sel.rel === 'friendly' && it.controller !== c.controller) return false;
  if (sel.rel === 'enemy' && it.controller === c.controller) return false;
  return (sel.where ?? []).every((p) => (p.p === 'choosesFriendly' ? itemChoosesFriendly(s, it, c)
    : p.p === 'choosesOnly' ? itemChoosesOnly(s, it, p.slot, c) : false));
}

/** The ability items a slot may choose ("Counter an enemy spell or ability that …"). */
export function slotItemCandidates(s: GameState, slot: SlotAst, c: SelCtx): ItemId[] {
  if (!slot.sel.some((sel) => sel.abilities)) return [];
  return s.chain.filter((i) => slot.sel.some((sel) => itemMatches(s, sel, i.id, c))).map((i) => i.id);
}

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
  if (t.k === 'item') return slot.sel.some((sel) => itemMatches(s, sel, t.id, c));
  if (t.k !== 'obj') return false;
  const o = s.objects[t.id];
  // A move between locations keeps the object [124] ("Move a friendly unit and ready it").
  const loc = (z: string) => z === 'base' || z === 'bf';
  if (!o || (o.zone.z !== t.zone && !(loc(o.zone.z) && loc(t.zone)))) return false;
  // "up to one … at each location": each target's restriction is its own location (Unleashed FAQ, Elder Dragon).
  if (slot.oneEachLoc && t.loc && JSON.stringify(locOf(o)) !== JSON.stringify(t.loc)) return false;
  return slot.sel.some((sel) => matches(s, sel, t.id, c));
}

/** The slot's least number of choices (1 unless "up to") [355.13]. */
export const slotMin = (slot: SlotAst) => slot.min ?? 1;
export const slotMax = (slot: SlotAst) => slot.max ?? 1;
