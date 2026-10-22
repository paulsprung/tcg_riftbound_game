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
import type { Domain, GameState, ObjId, PaymentPlan, PlayerId, PoolSpend, PowerReq, RunePool } from '../state/types.ts';
import { addToPool, byWidth, exhaust, payFromPool, recycleRune } from './actions.ts';

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

/** What the pool pays of the cost before any rune is touched. */
function fromPool(pool: RunePool, cost: ResourceCost): { spend: PoolSpend; energy: number; power: PowerReq[] } {
  const spend: PoolSpend = { energy: Math.min(pool.energy, cost.energy), power: {}, universal: 0, restricted: [] };
  const left = { ...pool.power };
  let universal = pool.universal;
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
  o: { limit?: number; reserveFor?: Domain[] } = {}): PaymentPlan[] {
  const pool = s.players[p].pool;
  const base = fromPool(pool, cost);
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
  const after: RunePool = structuredClone(left);
  after.energy = left.energy + exhausts.length - cost.energy;
  for (const [d, k] of Object.entries(base.spend.power) as [Domain, number][]) after.power[d] -= k;
  after.universal -= base.spend.universal;
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
  const ex = plan.steps.filter((st) => st.ability === 'exhaust').length;
  const rec = plan.steps.filter((st) => st.ability === 'recycle').map((st) => BASIC_RUNES[s.objects[st.obj].def]);
  const parts: string[] = [];
  if (ex > 0) parts.push(`exhaust ${ex} rune${ex === 1 ? '' : 's'}`);
  for (const d of rec) parts.push(`recycle a ${d} rune`);
  const pooled = plan.fromPool.energy + plan.fromPool.universal + Object.values(plan.fromPool.power).reduce((a, b) => a + b, 0);
  if (pooled > 0) parts.push(`${pooled} from the pool`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/**
 * Carries out a plan and pays the cost [357.1]: each step activates one
 * rune ability, which adds its resources at once [164.2], [430.2]; then the
 * cost leaves the pool. Returns the Energy and Power spent.
 */
export function executePlan(s: GameState, x: { present: boolean }, p: PlayerId, plan: PaymentPlan, cost: ResourceCost):
  { energy: number; power: number } {
  const summary = planSummary(s, plan);
  for (const st of plan.steps) {
    const d = BASIC_RUNES[s.objects[st.obj].def];
    if (st.ability === 'exhaust') {
      exhaust(s, x, p, [st.obj], '164.2.a', true);
      addToPool(s, x, p, 1, [], '164.2.a');
    } else {
      recycleRune(s, x, st.obj, '164.2.b');
      addToPool(s, x, p, 0, [d], '164.2.b.1');
    }
  }
  payFromPool(s, x, p, cost.energy, cost.power, '357.1');
  emit(s, x, { k: 'payment', p, summary, rule: '357' });
  return { energy: cost.energy, power: cost.power.length };
}
