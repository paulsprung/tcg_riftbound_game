/*
 * Paying a cost (§4.5, Spec D §7, [357], [445]) as a step of a play, an
 * activation or a trigger's finalization:
 *
 *   plans       `pay:n`, the ranked payment plans of rules/resources.ts
 *   decline     [445.2]: undoes a play [445.2.a]; removes a trigger whose
 *               cost wasn't paid [405.2]
 *   manualPay   (UI only) rune by rune: each tap activates one rune Add
 *               ability, a chain item that resolves at once [430.3],
 *               [357.1.a] (the 'pay' frame, its addAbility batch); Done
 *               once the pool covers the cost
 *
 * A cost of nothing is paid without a Pay action and can't be declined
 * [445.1.b].
 */
import { K, parseKey, type Option } from '../core/decisions.ts';
import { answer, ask, defineSteps, ret, takeRet, type FrameOf, type RunCtx, type StepOut } from '../core/frames.ts';
import { pushFrame } from '../state/mut.ts';
import type { Frame, GameState, ItemId, ObjId, PlayerId } from '../state/types.ts';
import {
  activateAdd, activateGold, executePlan, goldsOf, paymentPlans, payCost, planSummary, poolCovers, runeAbilities,
  type ResourceCost,
} from '../rules/resources.ts';
import { domainsNeeded } from './playCard.ts';

const powerText = (cost: ResourceCost) =>
  cost.power.map((r) => (r.k === 'domain' ? r.d : r.k === 'any' ? 'any' : r.ds.join('|')));

export interface PayOpts {
  payer: PlayerId;
  cost: ResourceCost;
  /** What is being paid for, for the prompt. */
  what: string;
  item?: ItemId;
  /** A spell's cost: Energy restricted to spells may pay it. */
  spell?: boolean | 'gear';
  source?: ObjId;
  back: boolean;
  onBack: () => StepOut;
  onDecline: () => StepOut;
  rule: string;
}

/** Runs the payment; 'paid' once the cost is paid, with what was spent. */
export function payStep(s: GameState, f: Frame, x: RunCtx, o: PayOpts): StepOut | { energy: number; power: number } {
  const { payer, cost } = o;
  if (cost.energy === 0 && cost.power.length === 0) return { energy: 0, power: 0 };   // [445.1.b]
  const back = takeRet(f);
  if (back === 'declined') return o.onDecline();
  if (back === 'paid') return payCost(s, x, payer, cost, 'paid rune by rune', o.spell);
  const key = answer(f);
  if (key === K.back) return o.onBack();
  if (key === K.decline) return o.onDecline();
  if (key === K.manualPay) {
    pushFrame(s, { f: 'pay', who: payer, cost: { energy: cost.energy, power: cost.power, other: [], components: [] },
      purpose: o.spell ? 'play' : 'applied', pc: 0 });
    return 'continue';
  }
  const plans = paymentPlans(s, payer, cost, { reserveFor: domainsNeeded(s, payer), spell: o.spell });
  if (key === undefined) {
    const options: Option[] = plans.map((plan) => ({
      key: plan.key, refs: plan.steps.map((st) => ({ obj: st.obj })), meta: { plan },
    }));
    options.push({ key: K.decline });
    if (plans.length > 0) options.push({ key: K.manualPay, ui: true });
    return ask(s, f, x, {
      player: payer, kind: 'payment',
      prompt: { t: 'payment', card: o.what, energy: cost.energy, power: powerText(cost),
        plans: plans.map((plan) => planSummary(s, plan)) },
      ctx: { ...(o.item !== undefined ? { item: o.item } : {}), ...(o.source !== undefined ? { source: o.source } : {}), rule: o.rule },
      options,
      privateOptions: false, back: o.back,
    });
  }
  return executePlan(s, x, payer, plans[parseKey(key)!.n!], cost, o.spell);
}

type PayFrame = FrameOf<'pay'>;

/** Manual payment: tap runes until the pool covers the cost [430.3]. */
defineSteps('pay', [(s, f, x) => {
  const cost: ResourceCost = { energy: f.cost.energy, power: f.cost.power };
  const key = answer(f);
  if (key === K.done) return ret(s, f, 'paid');
  if (key === K.decline) return ret(s, f, 'declined');
  if (key !== undefined) {
    const k = parseKey(key)!;
    if (k.sub === 'gold') activateGold(s, x, f.who, k.obj!);
    else activateAdd(s, x, f.who, k.obj!, k.sub === 'exhaust' ? 'exhaust' : 'recycle');
    return 'continue';
  }
  const options: Option[] = runeAbilities(s, f.who).map((r) => ({ key: K.act(r.obj, r.ability), refs: [{ obj: r.obj }] }));
  for (const g of goldsOf(s, f.who)) options.push({ key: K.act(g, 'gold'), refs: [{ obj: g }] });
  if (poolCovers(s, f.who, cost, f.purpose === 'play')) options.push({ key: K.done });
  options.push({ key: K.decline });
  return ask(s, f as PayFrame, x, {
    player: f.who, kind: 'addAbility', prompt: { t: 'addAbility', energy: cost.energy, power: powerText(cost) },
    ctx: { rule: '430.3' }, options, privateOptions: false, batch: `addAbility:p${f.who}`, mustAsk: true,
  });
}]);
