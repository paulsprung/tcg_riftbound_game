/*
 * Paying for things: the Rune Pool and payment plans (§4.5, Spec B §6,
 * [160–168], [430], [445]).
 *
 * Every basic rune has two Reaction Add abilities [164.2]: "[E]: Add [1]"
 * (exhaust it for one Energy) and "Recycle this: Add [C]" (recycle it for
 * one Power of its domain). A ready rune can do both, exhausting first
 * (the beginner booklet says as much). With eight runes there are hundreds
 * of ways to pay a cost and nearly all are the same, so the engine offers
 * payment plans instead: equivalence classes of ways to pay, ranked.
 *
 *   1. take what the pool already holds first;
 *   2. cover each remaining Power symbol by recycling a rune of a domain it
 *      accepts ([C] on a multi-domain card: any of its domains
 *      [135.2.e.6.c]; [A]: any domain), from an exhausted rune or a ready
 *      one; cover the remaining Energy by exhausting ready runes, those
 *      about to be recycled first (it costs them nothing);
 *   3. rank: least attrition (recycled runes are real card loss), then
 *      most ready runes kept, then most ready runes of the domains the
 *      cards in hand need (`reserveFor`), so a Reaction stays castable;
 *   4. plans that leave the same board and pool are one plan; each becomes
 *      concrete steps, lowest ObjId first within a class.
 *
 * Each step is one activation of a rune's Add ability, which finalizes and
 * resolves at once, without the chain or priority [430.2], [430.2.a].
 */
import { BASIC_RUNES } from '../cards/runes.ts';
import { emit } from '../core/events.ts';
import { mint } from '../state/mut.ts';
import type {
  ChainItem, Domain, GameState, ObjId, PaymentPlan, PlayerId, PoolSpend, PowerReq, RunePool,
} from '../state/types.ts';
import { addItem, finalizeItem, itemById, playContext, removeItem } from './chain.ts';
import { addSpecial, addToPool, byWidth, exhaust, kill, payFromPool, recycleRune } from './actions.ts';
import { copyJson } from '../state/clone.ts';

const DOMAINS: Domain[] = ['fury', 'calm', 'mind', 'body', 'chaos', 'order'];

/** A cost in resources: Energy and Power symbols [131], [356]. */
export interface ResourceCost { energy: number; power: PowerReq[] }

interface Rune { id: ObjId; d: Domain; ready: boolean }

/** p's runes on the board [107.1.c]: the ones in their base they control. */
export function runesOf(s: GameState, p: PlayerId): Rune[] {
  return s.players[p].base
    .map((id) => s.objects[id])
    .filter((o) => o.controller === p && Object.hasOwn(BASIC_RUNES, o.def))
    .map((o) => ({ id: o.id, d: BASIC_RUNES[o.def], ready: !o.exhausted }));
}

const accepts = (req: PowerReq, d: Domain) =>
  req.k === 'any' || (req.k === 'domain' ? req.d === d : req.ds.includes(d));

/** Energy in the pool that may pay for this: restricted Energy only for
    what it is restricted to ("Spend this Energy only to play spells"). */
const restrictedEnergy = (pool: RunePool, spell: boolean | 'gear') =>
  pool.restricted.reduce((n, r) => n + (r.kind === 'energy' && (r.onlyFor !== 'spells' || spell === true) ? r.amount : 0), 0);

/** Whether a restriction lets this payment use it: spells only, gear only (Ornn) [430]. */
export const restrictionOk = (onlyFor: unknown, spell: boolean | 'gear') =>
  onlyFor === 'spells' ? spell === true : onlyFor === 'gear' ? spell === 'gear' : false;

/** What the pool pays of the cost before any rune is touched. */
function fromPool(pool: RunePool, cost: ResourceCost, spell: boolean | 'gear' = false): { spend: PoolSpend; energy: number; power: PowerReq[] } {
  const plain = Math.min(pool.energy, cost.energy);
  const extra = Math.min(restrictedEnergy(pool, spell), cost.energy - plain);
  const spend: PoolSpend = { energy: plain + extra, power: {}, universal: 0, restricted: extra > 0 ? [extra] : [] };
  const left = { ...pool.power };
  let universal = pool.universal + pool.restricted.reduce((n, r) => n + (r.kind === 'universal'
    && restrictionOk(r.onlyFor, spell) ? r.amount : 0), 0);
  const rest: PowerReq[] = [];
  for (const req of cost.power.slice().sort(byWidth)) {
    const d = DOMAINS.find((dd) => left[dd] > 0 && accepts(req, dd));
    if (d) { left[d]--; spend.power[d] = (spend.power[d] ?? 0) + 1; }
    else if (universal > 0) { universal--; spend.universal++; }
    else rest.push(req);
  }
  return { spend, energy: cost.energy - spend.energy, power: rest };
}

/** Every multiset of domains that covers the symbols, as counts per domain. */
function domainChoices(reqs: PowerReq[], have: Record<Domain, number>): Record<Domain, number>[] {
  const out: Record<Domain, number>[] = [];
  const seen = new Set<string>();
  const rec = (i: number, acc: Record<Domain, number>) => {
    if (i === reqs.length) {
      const k = DOMAINS.map((d) => acc[d]).join(',');
      if (!seen.has(k)) { seen.add(k); out.push({ ...acc }); }
      return;
    }
    for (const d of DOMAINS) {
      if (!accepts(reqs[i], d) || acc[d] >= have[d]) continue;
      acc[d]++;
      rec(i + 1, acc);
      acc[d]--;
    }
  };
  rec(0, Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>);
  return out;
}

/** Ways to split n among domains with at most cap[d] each. */
function splits(n: number, cap: Record<Domain, number>): Record<Domain, number>[] {
  const ds = DOMAINS.filter((d) => cap[d] > 0);
  const out: Record<Domain, number>[] = [];
  const rec = (i: number, left: number, acc: Record<Domain, number>) => {
    if (i === ds.length) { if (left === 0) out.push({ ...acc }); return; }
    for (let k = 0; k <= Math.min(left, cap[ds[i]]); k++) {
      acc[ds[i]] = k;
      rec(i + 1, left - k, acc);
    }
    acc[ds[i]] = 0;
  };
  rec(0, n, Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>);
  return out;
}

const zero = () => Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;

/**
 * The ways p can pay a cost, best first, at most `limit` of them; [] when p
 * can't pay it [203.3]. A cost of nothing has one plan with no steps.
 */
export function paymentPlans(s: GameState, p: PlayerId, cost: ResourceCost,
  o: { limit?: number; reserveFor?: Domain[]; spell?: boolean | 'gear' } = {}): PaymentPlan[] {
  const pool = s.players[p].pool;
  const base0 = fromPool(pool, cost, o.spell);
  const golds = goldsOf(s, p);
  // Gold covers Power symbols of any domain [187.5]: try covering 0..G of
  // them with Gold, the narrowest symbols last (runes cover those best).
  const variants: { base: typeof base0; gold: number }[] = [{ base: base0, gold: 0 }];
  const sorted = base0.power.slice().sort(byWidth);
  for (let k = 1; k <= Math.min(golds.length, sorted.length); k++) {
    variants.push({ base: { ...base0, power: sorted.slice(0, sorted.length - k) }, gold: k });
  }
  const all: PaymentPlan[] = [];
  for (const v of variants) {
    for (const plan of plansFor(s, p, cost, v.base, o)) {
      if (v.gold === 0) { all.push(plan); continue; }
      all.push({ ...plan, steps: [...golds.slice(0, v.gold).map((obj) => ({ obj, ability: 'gold#0' })), ...plan.steps],
        attrition: plan.attrition + v.gold * 0.5 });
    }
  }
  const out: PaymentPlan[] = [];
  for (const plan of all.sort((a, b) => a.attrition - b.attrition || b.leaves.readyRunes - a.leaves.readyRunes)) {
    out.push({ ...plan, key: `pay:${out.length}` });
    if (out.length >= (o.limit ?? 4)) break;
  }
  return out;
}

/** Ready Gold tokens p controls, whose Add pays [A] [187.5]. */
export function goldsOf(s: GameState, p: PlayerId): ObjId[] {
  return [...s.players[p].base, ...s.bfs.flatMap((b) => b.here)].filter((id) => {
    const o = s.objects[id];
    return o.def === 'gold' && o.controller === p && !o.exhausted;
  });
}

function plansFor(s: GameState, p: PlayerId, cost: ResourceCost, base: ReturnType<typeof fromPool>,
  o: { limit?: number; reserveFor?: Domain[] }): PaymentPlan[] {
  const runes = runesOf(s, p);
  const ready = zero(), tired = zero();
  for (const r of runes) (r.ready ? ready : tired)[r.d]++;
  const total = zero();
  for (const d of DOMAINS) total[d] = ready[d] + tired[d];
  const reserve = o.reserveFor ?? [];

  interface Cand { recycleTired: Record<Domain, number>; recycleReady: Record<Domain, number>; exhaust: Record<Domain, number>;
    attrition: number; readyLeft: number; reserveLeft: number; sig: string }
  const cands: Cand[] = [];
  for (const need of domainChoices(base.power, total)) {
    // Recycle exhausted runes or ready ones, per domain.
    let partial: { t: Record<Domain, number>; r: Record<Domain, number> }[] = [{ t: zero(), r: zero() }];
    for (const d of DOMAINS) {
      if (need[d] === 0) continue;
      const nextPartial: typeof partial = [];
      for (let t = Math.max(0, need[d] - ready[d]); t <= Math.min(need[d], tired[d]); t++) {
        for (const pp of partial) nextPartial.push({ t: { ...pp.t, [d]: t }, r: { ...pp.r, [d]: need[d] - t } });
      }
      partial = nextPartial;
    }
    for (const { t, r } of partial) {
      // Energy: the ready runes about to be recycled exhaust first, for free.
      const free = DOMAINS.reduce((n, d) => n + r[d], 0);
      const more = Math.max(0, base.energy - free);
      const cap = zero();
      for (const d of DOMAINS) cap[d] = ready[d] - r[d];
      for (const e of splits(more, cap)) {
        const readyLeft = DOMAINS.reduce((n, d) => n + ready[d] - r[d] - e[d], 0);
        const reserveLeft = reserve.reduce((n, d) => n + ready[d] - r[d] - e[d], 0);
        const attrition = DOMAINS.reduce((n, d) => n + t[d] + r[d], 0);
        // What is left on the board: per domain, how many ready and exhausted runes.
        const sig = DOMAINS.map((d) => `${ready[d] - r[d] - e[d]}/${tired[d] - t[d] + e[d]}`).join(',');
        cands.push({ recycleTired: t, recycleReady: r, exhaust: e, attrition, readyLeft, reserveLeft, sig });
      }
    }
  }
  const usable = cands;
  usable.sort((a, b) => a.attrition - b.attrition || b.readyLeft - a.readyLeft || b.reserveLeft - a.reserveLeft
    || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  const plans: PaymentPlan[] = [];
  const seen = new Set<string>();
  for (const c of usable) {
    if (seen.has(c.sig)) continue;
    seen.add(c.sig);
    plans.push(concrete(s, p, c, base, runes, plans.length, cost));
    if (plans.length >= (o.limit ?? 4)) break;
  }
  return plans;
}

function concrete(s: GameState, p: PlayerId, c: { recycleTired: Record<Domain, number>; recycleReady: Record<Domain, number>;
  exhaust: Record<Domain, number>; attrition: number }, base: ReturnType<typeof fromPool>, runes: Rune[], n: number,
  cost: ResourceCost): PaymentPlan {
  const byId = (a: Rune, b: Rune) => a.id - b.id;
  const free: ObjId[] = [], plain: ObjId[] = [], recycleIds: ObjId[] = [];
  for (const d of DOMAINS) {
    const readyD = runes.filter((r) => r.d === d && r.ready).sort(byId);
    const tiredD = runes.filter((r) => r.d === d && !r.ready).sort(byId);
    free.push(...readyD.slice(0, c.recycleReady[d]).map((r) => r.id));
    plain.push(...readyD.slice(c.recycleReady[d], c.recycleReady[d] + c.exhaust[d]).map((r) => r.id));
    recycleIds.push(...tiredD.slice(0, c.recycleTired[d]).map((r) => r.id));
  }
  recycleIds.push(...free);
  // Ready runes about to be recycled give their Energy first, as far as Energy is needed.
  const exhausts = [...free.slice(0, base.energy), ...plain].sort((a, b) => a - b);
  const steps: PaymentPlan['steps'] = [
    ...exhausts.map((obj) => ({ obj, ability: 'exhaust' as const })),
    ...recycleIds.sort((a, b) => a - b).map((obj) => ({ obj, ability: 'recycle' as const })),
  ];
  const left = s.players[p].pool;
  const power = { ...left.power };
  for (const d of DOMAINS) power[d] -= base.spend.power[d] ?? 0;
  const after: RunePool = { energy: left.energy + exhausts.length - cost.energy, power,
    universal: left.universal - base.spend.universal, restricted: copyJson(left.restricted) };
  const onBoard = runes.length - recycleIds.length;
  const byDomain = zero();
  for (const r of runes) if (!recycleIds.includes(r.id)) byDomain[r.d]++;
  const readyRunes = runes.filter((r) => r.ready && !exhausts.includes(r.id) && !recycleIds.includes(r.id)).length;
  return {
    key: `pay:${n}`, fromPool: base.spend, steps, attrition: c.attrition,
    leaves: { readyRunes, runesOnBoard: onBoard, byDomain, pool: after },
  };
}

/** A plan in words for the log: "exhaust 3 runes, recycle a Mind rune". */
export function planSummary(s: GameState, plan: PaymentPlan): string {
  const count = (ability: string) => {
    const by: Partial<Record<Domain, number>> = {};
    for (const st of plan.steps) if (st.ability === ability) { const d = BASIC_RUNES[s.objects[st.obj].def]; by[d] = (by[d] ?? 0) + 1; }
    return DOMAINS.filter((d) => by[d]).map((d) => `${by[d]} ${d}`);
  };
  const ex = count('exhaust'), rec = count('recycle');
  const parts: string[] = [];
  const runes = (xs: string[]) => `${xs.join(' and ')} rune${xs.length === 1 && xs[0].startsWith('1 ') ? '' : 's'}`;
  if (ex.length > 0) parts.push(`exhaust ${runes(ex)}`);
  if (rec.length > 0) parts.push(`recycle ${runes(rec)}`);
  const pooled = plan.fromPool.energy + plan.fromPool.universal + Object.values(plan.fromPool.power).reduce((a, b) => a + b, 0);
  if (pooled > 0) parts.push(`${pooled} from the pool`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/**
 * Activates one of a basic rune's Add abilities [164.2]: "[E]: Add [1]" or
 * "Recycle this: Add [C]". An Add ability is a chain item that finalizes
 * and resolves at once, never waits for priority and moves no counter
 * [430.2], [430.2.a], Spec C Q4: its cost is paid, the resources are added,
 * and it is gone.
 */
export function activateAdd(s: GameState, x: { present: boolean }, p: PlayerId, rune: ObjId, ability: 'exhaust' | 'recycle') {
  const d = BASIC_RUNES[s.objects[rune].def];
  const item = mint(s, 'item');
  const it: ChainItem = {
    id: item, seq: item, kind: 'activated', sub: 'normal', status: 'pending', controller: p, owner: p, source: rune,
    ability: `${s.objects[rune].def}#${ability}`, isAdd: true, outcomes: {},
    play: playContext(s, { mode: 'discretionary', origin: s.objects[rune].zone, item, by: p }),
  };
  addItem(s, x, it, { played: false });
  if (ability === 'exhaust') exhaust(s, x, p, [rune], '164.2.a', true);   // the cost [415.4]
  else recycleRune(s, x, rune, '164.2.b');
  finalizeItem(s, x, itemById(s, item)!);                            // [430.2]
  if (ability === 'exhaust') addToPool(s, x, p, 1, [], '164.2.a');
  else addToPool(s, x, p, 0, [d], '164.2.b.1');
  removeItem(s, x, item);
}

/** The rune abilities p could activate now to pay (manual payment, the
    addAbility decision [430.3]). */
export function runeAbilities(s: GameState, p: PlayerId): { obj: ObjId; ability: 'exhaust' | 'recycle' }[] {
  return runesOf(s, p).flatMap((r) => [
    ...(r.ready ? [{ obj: r.id, ability: 'exhaust' as const }] : []),
    { obj: r.id, ability: 'recycle' as const },
  ]);
}

/** Whether the pool alone covers a cost now. */
export function poolCovers(s: GameState, p: PlayerId, cost: ResourceCost, spell: boolean | 'gear' = false): boolean {
  const base = fromPool(s.players[p].pool, cost, spell);
  return base.energy === 0 && base.power.length === 0;
}

/**
 * Carries out a plan and pays the cost [357.1]: each step activates one
 * rune ability, which adds its resources at once [164.2], [430.2]; then the
 * cost leaves the pool. Returns the Energy and Power spent.
 */
export function executePlan(s: GameState, x: { present: boolean }, p: PlayerId, plan: PaymentPlan, cost: ResourceCost,
  spell: boolean | 'gear' = false): { energy: number; power: number } {
  const summary = planSummary(s, plan);
  for (const st of plan.steps) {
    if (st.ability === 'gold#0') activateGold(s, x, p, st.obj);
    else activateAdd(s, x, p, st.obj, st.ability === 'exhaust' ? 'exhaust' : 'recycle');
  }
  return payCost(s, x, p, cost, summary, spell);
}

/** Gold's "[Reaction][>] Kill this, [E]: [Add] [A]." [187.5], as one step of a payment. */
export function activateGold(s: GameState, x: { present: boolean }, p: PlayerId, gold: ObjId) {
  const item = mint(s, 'item');
  const it: ChainItem = {
    id: item, seq: item, kind: 'activated', sub: 'normal', status: 'pending', controller: p, owner: p, source: gold,
    ability: 'gold#0', isAdd: true, outcomes: {}, play: playContext(s, { mode: 'discretionary', origin: s.objects[gold].zone, item, by: p }),
  };
  addItem(s, x, it, { played: false });
  exhaust(s, x, p, [gold], '187.5', true);
  kill(s, x, [gold], { rule: '187.5', inCombat: () => false });
  finalizeItem(s, x, itemById(s, item)!);                            // [430.2]
  addSpecial(s, x, p, { universal: 1, source: 'gold' }, '430');
  removeItem(s, x, item);
}

/** Pays a cost out of the pool, which covers it [357.1], [445.1]. */
export function payCost(s: GameState, x: { present: boolean }, p: PlayerId, cost: ResourceCost, summary: string, spell: boolean | 'gear' = false) {
  payFromPool(s, x, p, cost.energy, cost.power, '357.1', spell);
  emit(s, x, { k: 'payment', p, summary, rule: '357' });
  return { energy: cost.energy, power: cost.power.length };
}
