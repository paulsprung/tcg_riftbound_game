/*
 * The cost pipeline (§5.6, Spec D §6, [356]) and the "as you play" choices
 * of step 2 that feed it [355.1]:
 *
 *   Show Off       reveal a card from hand or pick a friendly card on the
 *                  board [832.1.c]; recorded with snapshots [832.1.d]; a
 *                  pick is not a target [355.7]
 *   optional costs decided in step 2 [355.1.a]: the card's own ("You may
 *                  kill a friendly unit as an additional cost to play me")
 *                  and granted ones (Seraphine's legend: "As an additional
 *                  cost to play a spell, you may exhaust me and three
 *                  friendly units …") [356.2.b]
 *   total cost     step 3 [356]: the base cost (printed, or what the
 *                  instructing effect says [356.1.a]), then additional
 *                  costs (Deflect [A] per time an opponent's item chooses a
 *                  Deflect object [809.1.c], the chosen optional costs),
 *                  then discounts, read now and locked [356.4.g] ("I cost
 *                  [1] less for each exhausted unit you control"; "reduce
 *                  the cost of that spell by [2]"), never below 0 [356.6]
 *   non-standard   step 4 [357.2]: the objects a cost exhausts or kills are
 *                  chosen as step 4 begins (Spec D OQ-5), the Energy and
 *                  Power paid, then the cost's actions performed, the
 *                  exhaust as ONE action on every object [415.4] (what
 *                  Seraphine, Inspiring's "at the same time" reads)
 */
import { abilitiesOf, cardDef } from '../cards/registry.ts';
import type { CostAbilityAst, NonStdCostAst, SelAst } from '../dsl/ast.ts';
import type { CardType, ChainItem, GameState, ObjId, PlayerId, PowerReq, TargetRef } from '../state/types.ts';
import { energyCostOf, isType, keywordOf, typesOf } from '../rules/chars.ts';
import type { ResourceCost } from '../rules/resources.ts';
import { selectAll } from '../rules/targets.ts';

/** A cost ability as it applies to one play: its key in
    PlayChoices.optionalCosts and PlayedRecord.paidOptional, the ability,
    and the object it is on (the card itself, or the one granting it). */
export interface CostOffer { key: string; a: CostAbilityAst; src: ObjId | null }

/** The cost abilities that apply to p playing a card of these types: the
    card's own [366.2.a] and those of objects p controls on the board that
    grant one to such cards [356.2]. `card` is the card's definition. */
export function costOffers(s: GameState, def: string, types: CardType[], p: PlayerId): CostOffer[] {
  const out: CostOffer[] = [];
  for (const a of abilitiesOf(def)) if (a.kind === 'cost' && !a.grant) out.push({ key: a.id, a, src: null });
  const board = [...s.players.flatMap((pl) => [...pl.legend, ...pl.base]), ...s.bfs.flatMap((b) => [b.obj, ...b.here])];
  for (const id of board) {
    const o = s.objects[id];
    if (!o || o.controller !== p) continue;
    for (const a of abilitiesOf(o.def)) {
      if (a.kind !== 'cost' || !a.grant || !a.grant.types.some((t) => types.includes(t))) continue;
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

/** Whether a non-standard cost can be paid in full now [203.3]. */
export function nonStdPossible(s: GameState, pay: NonStdCostAst | undefined, src: ObjId | null, p: PlayerId): boolean {
  if (!pay) return true;
  if (pay.exhaustSelf && (src === null || !s.objects[src] || s.objects[src].exhausted)) return false;
  if (pay.exhaust && costCandidates(s, pay.exhaust.sel, p, src, true).length < pay.exhaust.n) return false;
  if (pay.kill && costCandidates(s, pay.kill.sel, p, src, false).length < pay.kill.n) return false;
  return true;
}

/** The optional costs a player may decide to pay now [355.1.a]. */
export function optionalOffers(s: GameState, def: string, types: CardType[], p: PlayerId): CostOffer[] {
  return costOffers(s, def, types, p).filter((o) => o.a.optional && nonStdPossible(s, o.a.pay, o.src, p));
}

/** The Energy a discount takes off, read now [356.4.g]. */
function discountOf(s: GameState, o: CostOffer, p: PlayerId): number {
  const v = o.a.discount?.energy ?? 0;
  if (typeof v === 'number') return v;
  return v.v === 'count' ? selectAll(s, v.of, { controller: p, source: null }).length : 0;
}

/**
 * The total cost [356] of a card for p: the base cost, Deflect for the
 * targets chosen [809.1.c], then the discounts of the mandatory cost
 * abilities and the optional ones decided (`chosen`), Energy never below 0
 * [356.6]. `extraAny` adds [A]s (an estimate for a target not chosen yet).
 */
export function totalCost(s: GameState, o: { def: string; types: CardType[]; p: PlayerId; base: ResourceCost;
  chosen: readonly string[]; targets?: readonly TargetRef[]; extraAny?: number }): ResourceCost {
  let energy = o.base.energy;
  const power: PowerReq[] = o.base.power.slice();
  const deflect = (o.targets ?? []).reduce((n, t) => n + deflectFor(s, t, o.p), 0) + (o.extraAny ?? 0);
  for (let i = 0; i < deflect; i++) power.push({ k: 'any' });       // [809.1.c.1]
  for (const off of costOffers(s, o.def, o.types, o.p)) {
    if (off.a.optional && !o.chosen.includes(off.key)) continue;
    energy -= discountOf(s, off, o.p);                               // [356.4.d], [356.4.g]
  }
  return { energy: Math.max(0, energy), power };                     // [356.6]
}

/** The [A]s choosing this object adds: its Deflect, if an opponent of the
    item's controller controls it [809.1.c]. */
export function deflectFor(s: GameState, t: TargetRef, p: PlayerId): number {
  if (t.k !== 'obj') return 0;
  const o = s.objects[t.id];
  if (!o || o.controller === null || o.controller === p) return 0;
  return keywordOf(s, t.id, 'deflect');
}

/** The least a card could cost p now, every optional discount taken: what a
    priority decision offers it for (the cheap stage of §4.6). */
export function cheapestCost(s: GameState, id: ObjId, p: PlayerId, base: ResourceCost): ResourceCost {
  const o = s.objects[id];
  const types = typesOf(o);
  return totalCost(s, { def: o.def, types, p, base, chosen: optionalOffers(s, o.def, types, p).map((x) => x.key) });
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
  const fits = (id: ObjId) => kw.minEnergy === undefined || energyCostOf(s.objects[id]) >= kw.minEnergy;
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
export function cardShowOff(def: string): { minEnergy?: number } | null {
  const k = cardDef(def)?.keywords.find((x) => x.kw === 'showOff');
  return k ? k.showOff ?? {} : null;
}
