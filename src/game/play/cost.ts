/*
 * The cost pipeline (§5.6, Spec D §6, [356]) and the "as you play" choices
 * of step 2 that feed it [355.1]:
 *
 *   Show Off       reveal a card from hand or pick a friendly card on the
 *                  board [832.1.c]; recorded with snapshots [832.1.d]; a
 *                  pick is not a target [355.7]
 *   optional costs decided in step 2 [355.1.a]: the card's own ("You may
 *                  kill a friendly unit as an additional cost to play me",
 *                  Accelerate's [1][C] [805], Repeat [820], "You may pay [G]
 *                  as an additional cost") and granted ones (Seraphine's
 *                  legend) [356.2.b]
 *   total cost     step 3 [356]: the base cost (printed, or what the
 *                  instructing effect says [356.1.a]; nothing from face
 *                  down [811.1.b]), then additional costs (Deflect [A] per
 *                  time an opponent's item chooses a Deflect object
 *                  [809.1.c], the chosen optional costs, increases such as
 *                  Vex, Cheerless's "enemy spells cost [1][A] more"), then
 *                  discounts, read now and locked [356.4.g] ("I cost [1] less
 *                  for each exhausted unit you control"; "to a minimum of
 *                  [1]"), never below 0 [356.6]
 *   non-standard   step 4 [357.2]: the objects a cost exhausts, kills,
 *                  discards or recycles are chosen as step 4 begins (Spec D
 *                  OQ-5), the Energy and Power paid, then the cost's actions
 *                  performed, the exhaust as ONE action on every object
 *                  [415.4] (what Seraphine, Inspiring's "at the same time" reads)
 */
import { abilitiesOf, cardDef } from '../cards/registry.ts';
import type { CostAbilityAst, CostAst, DiscountAst, NonStdCostAst, SelAst, ValueAst } from '../dsl/ast.ts';
import type { CardType, ChainItem, Domain, GameState, ObjId, PlayerId, PowerReq, TargetRef } from '../state/types.ts';
import { energyCostOf, hasKeyword, isType, keywordOf, mightOf, typesOf } from '../rules/chars.ts';
import { evalCond } from '../rules/conditions.ts';
import type { ResourceCost } from '../rules/resources.ts';
import { selectAll } from '../rules/targets.ts';
import { boardObjects } from '../layers/derive.ts';
import { findCard } from '../cards/oracle.ts';

/** A cost ability as it applies to one play: its key in
    PlayChoices.optionalCosts and PlayedRecord.paidOptional, the ability,
    and the object it is on (the card itself, or the one granting it). */
export interface CostOffer { key: string; a: CostAbilityAst; src: ObjId | null }

/** The cost abilities that apply to p playing a card of these types: the
    card's own [366.2.a] and those of objects on the board that grant one to
    such cards [356.2], each only while its condition holds. */
export function costOffers(s: GameState, def: string, types: CardType[], p: PlayerId): CostOffer[] {
  const out: CostOffer[] = [];
  for (const a of abilitiesOf(def)) {
    if (a.kind !== 'cost' || a.grant) continue;
    if (a.while && !evalCond(s, a.while, { controller: p, source: null })) continue;
    out.push({ key: a.id, a, src: null });
  }
  for (const o of boardObjects(s)) {
    if (o.attachedTo !== null) continue;
    for (const a of abilitiesOf(o.def)) {
      if (a.kind !== 'cost' || !a.grant || !a.grant.types.some((t) => types.includes(t))) continue;
      if (a.grant.tag && !(findCard(def)?.tags ?? []).includes(a.grant.tag)) continue;
      const whose = a.grant.whose ?? 'you';
      const ctl = o.controller;
      if (ctl === null || (whose === 'you' && ctl !== p) || (whose === 'enemy' && ctl === p)) continue;
      if (a.while && !evalCond(s, a.while, { controller: ctl, source: o.id })) continue;
      out.push({ key: `${a.id}@${o.id}`, a, src: o.id });
    }
  }
  return out;
}

/** The objects a non-standard cost may use: ready ones for an exhaust
    [415.4], any matching one for a kill. The card being played is on the
    chain, so it is never among them. */
export function costCandidates(s: GameState, sel: SelAst, p: PlayerId, src: ObjId | null, exhaust: boolean): ObjId[] {
  return selectAll(s, sel, { controller: p, source: null })
    .filter((id) => id !== src && (!exhaust || !s.objects[id].exhausted));
}

/** Cards in p's trash a "recycle … from your trash" cost may take. */
export const trashCandidates = (s: GameState, p: PlayerId, types?: CardType[]) =>
  s.players[p].trash.filter((id) => !types || types.some((t) => isType(s.objects[id], t)));

/** Whether a non-standard cost can be paid in full now [203.3]. `src`: the
    object whose ability it is ("me", "this"). */
export function nonStdPossible(s: GameState, pay: NonStdCostAst | undefined, src: ObjId | null, p: PlayerId): boolean {
  if (!pay) return true;
  const me = src === null ? undefined : s.objects[src];
  if (pay.exhaustSelf && (!me || me.exhausted)) return false;
  if (pay.killSelf && !me) return false;
  if (pay.spendBuffSelf && (!me || me.buffs === 0)) return false;
  if (pay.exhaust && costCandidates(s, pay.exhaust.sel, p, src, true).length < pay.exhaust.n) return false;
  if (pay.kill && costCandidates(s, pay.kill.sel, p, src, false).length < pay.kill.n) return false;
  if (pay.discard && s.players[p].hand.length < pay.discard) return false;
  if (pay.recycleTrash && trashCandidates(s, p, pay.recycleTrash.types).length < pay.recycleTrash.n) return false;
  if (pay.xp && s.players[p].xp < pay.xp) return false;
  return true;
}

/** The non-standard part of a cost [356.7], or undefined if it has none. */
export function nonStdOf(c: CostAst | NonStdCostAst | undefined): NonStdCostAst | undefined {
  if (!c) return undefined;
  const out: NonStdCostAst = {};
  for (const k of ['exhaustSelf', 'killSelf', 'spendBuffSelf', 'exhaust', 'kill', 'discard', 'recycleTrash', 'xp'] as const) {
    if (c[k] !== undefined) (out as Record<string, unknown>)[k] = c[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The optional costs a player may decide to pay now [355.1.a]. */
export function optionalOffers(s: GameState, def: string, types: CardType[], p: PlayerId): CostOffer[] {
  return costOffers(s, def, types, p).filter((o) => o.a.optional && nonStdPossible(s, o.a.pay, o.src, p));
}

/** The Energy a discount takes off, read now [356.4.g]. */
function discountOf(s: GameState, d: DiscountAst, src: ObjId | null, p: PlayerId): number {
  const val = (v: ValueAst): number => {
    if (typeof v === 'number') return v;
    if (v.v === 'count') return selectAll(s, v.of, { controller: p, source: src }).length;
    if (v.v === 'sum') return v.of.reduce((n: number, w) => n + val(w), 0);
    return 0;
  };
  return val(d.energy);
}

/** A resource cost of the effect language as Power requirements, 'C' being
    one of these domains [135.2.e.6.c]. */
export function powerOf(c: CostAst | undefined, domains: Domain[]): PowerReq[] {
  return (c?.power ?? []).map((r): PowerReq => (r === 'A' ? { k: 'any' }
    : r === 'C' ? (domains.length === 1 ? { k: 'domain', d: domains[0] } : domains.length === 0 ? { k: 'any' }
      : { k: 'anyOf', ds: domains.slice() }) : { k: 'domain', d: r }));
}

/**
 * The total cost [356] of a card for p: the base cost, Deflect for the
 * targets chosen [809.1.c], the additional costs and increases of the cost
 * abilities that apply (optional ones only if decided, `chosen`), then
 * their discounts, Energy never below 0 [356.6]. `extraAny` adds [A]s (an
 * estimate for a target not chosen yet).
 */
export function totalCost(s: GameState, o: { def: string; types: CardType[]; p: PlayerId; base: ResourceCost;
  chosen: readonly string[]; targets?: readonly TargetRef[]; extraAny?: number }): ResourceCost {
  let energy = o.base.energy;
  let power: PowerReq[] = o.base.power.slice();
  const domains = findCard(o.def)?.domains ?? [];
  const deflect = (o.targets ?? []).reduce((n, t) => n + deflectFor(s, t, o.p), 0) + (o.extraAny ?? 0);
  for (let i = 0; i < deflect; i++) power.push({ k: 'any' });       // [809.1.c.1]
  const offers = costOffers(s, o.def, o.types, o.p).filter((off) => !off.a.optional || o.chosen.includes(off.key));
  for (const off of offers) {                                        // additional costs, increases [356.2–356.3]
    for (const c of [off.a.add, off.a.increase]) {
      if (!c) continue;
      energy += c.energy ?? 0;
      power.push(...powerOf(c, domains));
    }
  }
  for (const off of offers) {                                        // [356.4.d], [356.4.g]
    const d = off.a.discount;
    if (!d) continue;
    const less = discountOf(s, d, off.src, o.p);
    energy = d.min !== undefined ? (energy > d.min ? Math.max(d.min, energy - less) : energy) : energy - less;
    for (let i = 0; i < (d.power ?? 0) && power.length > 0; i++) {
      const j = power.findIndex((r) => r.k === 'any');
      power = power.filter((_, k) => k !== (j >= 0 ? j : power.length - 1));
    }
  }
  return { energy: Math.max(0, energy), power };                     // [356.6]
}

/** The [A]s choosing this object adds: its Deflect, if an opponent of the
    item's controller controls it [809.1.c]. */
export function deflectFor(s: GameState, t: TargetRef, p: PlayerId): number {
  if (t.k !== 'obj') return 0;
  const o = s.objects[t.id];
  if (!o || o.controller === null || o.controller === p || (o.zone.z !== 'base' && o.zone.z !== 'bf')) return 0;
  return keywordOf(s, t.id, 'deflect');
}

/** The least a card could cost p now, every optional discount taken and no
    optional extra paid: what a priority decision offers it for (the cheap
    stage of §4.6). */
export function cheapestCost(s: GameState, id: ObjId, p: PlayerId, base: ResourceCost): ResourceCost {
  const o = s.objects[id];
  const types = typesOf(o);
  const free = optionalOffers(s, o.def, types, p).filter((x) => x.a.discount && !x.a.add && !x.a.repeat).map((x) => x.key);
  return totalCost(s, { def: o.def, types, p, base, chosen: free });
}

/** Whether the mandatory non-standard costs of playing a card can be paid
    (Cruel Patron's "kill a friendly unit") [203.3]. */
export function mandatoryCostsPossible(s: GameState, id: ObjId, p: PlayerId): boolean {
  const o = s.objects[id];
  return costOffers(s, o.def, typesOf(o), p).every((off) => off.a.optional || nonStdPossible(s, off.a.pay, off.src, p));
}

// ---- Show Off [832] ----

/** The objects a Show Off may reveal or pick [832.1.c]: cards in p's hand
    and friendly cards on the board (not tokens, which are not cards [052];
    not facedown ones [811.5.a]; never the card being played, which is on
    the chain), that fit the keyword's object. */
export function showOffCandidates(s: GameState, it: ChainItem): { obj: ObjId; fromHand: boolean }[] {
  const card = s.objects[it.obj!];
  const kw = cardShowOff(card.def);
  if (!kw) return [];
  const fits = (id: ObjId) => (kw.minEnergy === undefined || energyCostOf(s.objects[id]) >= kw.minEnergy)
    && (kw.withKeyword === undefined || (findCard(s.objects[id].def)?.keywords ?? []).some((l) => l.keywords.some((k) => k.kw === kw.withKeyword)));
  const p = it.controller;
  const out: { obj: ObjId; fromHand: boolean }[] = [];
  for (const id of s.players[p].hand) if (s.objects[id].def !== 'placeholder' && fits(id)) out.push({ obj: id, fromHand: true });
  const board = [...s.players[p].legend, ...s.players[p].base, ...s.bfs.flatMap((b) => b.here)];
  for (const id of board) {
    const o = s.objects[id];
    if (o.controller !== p || o.token || isType(o, 'battlefield') || !fits(id)) continue;
    out.push({ obj: id, fromHand: false });
  }
  return out;
}

/** A card's Show Off keyword, if its definition has one [832.1.b]. */
export function cardShowOff(def: string): { minEnergy?: number; withKeyword?: import('../state/types.ts').KeywordId } | null {
  const k = cardDef(def)?.keywords.find((x) => x.kw === 'showOff');
  return k ? k.showOff ?? {} : null;
}

export { hasKeyword, mightOf };
