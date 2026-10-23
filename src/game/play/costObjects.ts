/*
 * Non-standard costs [356.7], [357.2] of plays and activations alike: the
 * objects a cost exhausts, kills, discards or recycles are chosen as
 * payment begins (Spec D OQ-5), one per decision; once the Energy and Power
 * are paid, the actions are performed: ONE Exhaust action on the source and
 * the chosen objects [415.4], one Kill action ("Kill this", "kill a friendly
 * unit"), the discard [423], the recycle from the trash [417], spending the
 * source's buff [702.2.b] and XP [730.2].
 */
import { K, parseKey } from '../core/decisions.ts';
import { answer, ask, type RunCtx, type StepOut } from '../core/frames.ts';
import type { NonStdCostAst } from '../dsl/ast.ts';
import { append, setField } from '../state/mut.ts';
import type { ChainItem, Frame, GameState, ObjId } from '../state/types.ts';
import { discard, exhaust, kill, recycleCards, spendBuffs, spendXp } from '../rules/actions.ts';
import { snapshotOf } from '../rules/chars.ts';
import { costCandidates, trashCandidates } from './cost.ts';

export interface CostObjectOpts {
  item: ChainItem; src: ObjId | null; key: string; pay: NonStdCostAst; what: string;
  back: boolean; onBack: () => StepOut; onImpossible: () => StepOut;
}

type Kind = 'exhaust' | 'kill' | 'discard' | 'recycle';

/** The candidates and the number to choose for one part of the cost. */
function part(s: GameState, it: ChainItem, src: ObjId | null, pay: NonStdCostAst, what: Kind): { n: number; cands: ObjId[] } | null {
  const p = it.controller;
  switch (what) {
    case 'exhaust': return pay.exhaust ? { n: pay.exhaust.n, cands: costCandidates(s, pay.exhaust.sel, p, src, true) } : null;
    case 'kill': return pay.kill ? { n: pay.kill.n, cands: costCandidates(s, pay.kill.sel, p, src, false) } : null;
    case 'discard': return pay.discard ? { n: pay.discard, cands: s.players[p].hand.slice() } : null;
    case 'recycle': return pay.recycleTrash ? { n: pay.recycleTrash.n, cands: trashCandidates(s, p, pay.recycleTrash.types) } : null;
  }
}

/** Asks for the next object of the cost, or 'complete' once all are chosen. */
export function chooseCostObjects(s: GameState, f: Frame, x: RunCtx, o: CostObjectOpts): 'complete' | StepOut {
  const it = o.item;
  for (const what of ['exhaust', 'kill', 'discard', 'recycle'] as const) {
    const need = part(s, it, o.src, o.pay, what);
    if (!need) continue;
    const slot = `cost:${o.key}:${what}`;
    const picked = (it.play.choices.asPlayed[slot] ?? []) as number[];
    if (picked.length >= need.n) continue;
    const cands = need.cands.filter((id) => !picked.includes(id));
    if (picked.length + cands.length < need.n) return o.onImpossible();   // [203.3]
    if (picked.length + cands.length === need.n && what !== 'discard') {   // no choice to make
      setField(s, it.play.choices.asPlayed, slot, [...picked, ...cands]);
      return 'continue';
    }
    const key = answer(f);
    if (key === K.back) return o.onBack();
    if (key === undefined) {
      return ask(s, f, x, {
        player: it.controller, kind: 'costObject', prompt: { t: 'costObject', card: o.what, what, n: need.n, chosen: picked.length },
        ctx: { item: it.id, ...(o.src !== null ? { source: o.src } : {}), rule: '357.2' },
        options: cands.map((id) => ({ key: K.pick(id), refs: [{ obj: id }] })), privateOptions: what === 'discard', back: o.back,
        batch: `cost:item${it.id}:${what}`,
      });
    }
    setField(s, it.play.choices.asPlayed, slot, [...picked, parseKey(key)!.obj!]);
    return 'continue';
  }
  return 'complete';
}

/** Performs the cost's actions; false when it can't be paid in full now [203.3]. */
export function performCostObjects(s: GameState, x: RunCtx, it: ChainItem, key: string, src: ObjId | null, pay: NonStdCostAst): boolean {
  const p = it.controller;
  const got = (what: Kind) => (it.play.choices.asPlayed[`cost:${key}:${what}`] ?? []) as number[];
  const ex = got('exhaust'), kl = got('kill'), dc = got('discard'), rc = got('recycle');
  const me = src === null ? undefined : s.objects[src];
  const toExhaust = [...(pay.exhaustSelf && src !== null ? [src] : []), ...ex];
  const toKill = [...(pay.killSelf && src !== null ? [src] : []), ...kl];
  if (toExhaust.some((id) => !s.objects[id] || s.objects[id].exhausted)) return false;
  if (toKill.some((id) => !s.objects[id] || !['base', 'bf'].includes(s.objects[id].zone.z))) return false;
  if (dc.some((id) => s.objects[id]?.zone.z !== 'hand') || rc.some((id) => s.objects[id]?.zone.z !== 'trash')) return false;
  if (pay.spendBuffSelf && (!me || me.buffs === 0)) return false;
  if (pay.xp && s.players[p].xp < pay.xp) return false;
  const snaps = [...new Set([...toExhaust, ...toKill])].map((id) => snapshotOf(s, id));
  if (toExhaust.length > 0) exhaust(s, x, p, toExhaust, '357.2', true);
  if (pay.spendBuffSelf && src !== null) spendBuffs(s, x, [src], '357.2');
  if (pay.xp) spendXp(s, x, p, pay.xp, '357.2');
  if (dc.length > 0) discard(s, x, p, dc, '357.2');
  if (rc.length > 0) recycleCards(s, x, p, rc, '357.2');
  if (toKill.length > 0) kill(s, x, toKill, { rule: '357.2', inCombat: () => false });
  append(s, it.play.paid, { what: key, replaced: false, objs: snaps, energy: 0, power: 0 });
  setField(s, it.play.facts.costObjects, key, snaps);
  return true;
}
