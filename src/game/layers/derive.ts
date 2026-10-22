/*
 * Characteristics after the layers (§6.7, Spec G §8, [475–482]): what an
 * object is now, derived from its copyable traits and every continuous
 * effect that applies to it. Never stored; memoized per state and epoch
 * (every real change bumps the epoch, so a memo can't outlive the state it
 * was derived from).
 *
 *   traits     printed (the oracle, or a token's template [187]) [479.1]
 *   layer 2    base Might: "its base Might becomes N this turn" (Herald of
 *              the Emperor, Piltovan Guidebot); the latest timestamp wins
 *              [479.2], [482]
 *   layer 3    keywords: printed, plus grants ("[Shield 2] this turn"),
 *              valued keywords summed [479.3], [807.2], [814.2]
 *   layer 4    increases and decreases [479.4]: buff counters [703], "+N
 *              [M] this turn" with its amount fixed at creation [479.4.b],
 *              static abilities of objects on the board ("I have +1 [M] for
 *              each other exhausted unit you control", "while …, I have +2
 *              [M]"), Assault while attacking and Shield while defending
 *              [807.1.c], [814.1]; an increase by a negative amount is +0
 *              [479.4.c]
 *
 * Order and dependency [478], [480–482]: the conditions and amounts of the
 * statics are evaluated against the state; when one reads a characteristic
 * an earlier layer of another object derives (Might in a selector), that
 * object is derived first [478.1.a]. A cycle (two objects whose statics
 * each read the other's Might) is a strongly connected component
 * [478.1.c]: inside it the evaluation reads the members' layer-3 results,
 * i.e. without the statics of the component, once, which is what stepping
 * them through the layers together gives for these statics. Without
 * statics that read characteristics (every position of the Seraphine
 * mirror) one pass in layer order is exact: the fast path.
 */
import { findCard, printedKeywords } from '../cards/oracle.ts';
import { abilitiesOf } from '../cards/registry.ts';
import { TOKENS } from '../cards/tokens.ts';
import type { StaticAbilityAst, ValueAst } from '../dsl/ast.ts';
import { isBoard } from '../state/zones.ts';
import type { GameObject, GameState, KeywordId, ObjId, TokenId } from '../state/types.ts';
import { evalCond } from '../rules/conditions.ts';
import { buffValue } from '../rules/defaults.ts';
import { selectAll } from '../rules/targets.ts';

export interface Derived {
  might: number | null;
  baseMight: number | null;
  /** Keyword values after layer 3; 1 for keywords without a value. */
  keywords: Partial<Record<KeywordId, number>>;
}

const token = (def: string) => (Object.hasOwn(TOKENS, def) ? TOKENS[def as TokenId] : undefined);

/** The keywords whose rules the engine implements: the others read as absent. */
export const IMPLEMENTED_KEYWORDS: readonly KeywordId[] = ['tank', 'backline', 'deploy', 'disarm', 'action', 'reaction',
  'deflect', 'shield', 'assault', 'deathknell', 'showOff'];

/** The printed keywords of a definition, with values [803]. */
export function printedKeywordValues(def: string): Partial<Record<KeywordId, number>> {
  const out: Partial<Record<KeywordId, number>> = {};
  const t = token(def);
  if (t) {
    for (const k of t.keywords) out[k] = (out[k] ?? 0) + 1;
    return out;
  }
  const c = findCard(def);
  for (const k of c ? printedKeywords(c) : []) out[k.kw] = (out[k.kw] ?? 0) + (k.value ?? 1);
  return out;
}

const isUnitDef = (def: string) => {
  const t = token(def);
  return t ? t.type === 'unit' : (findCard(def)?.types.includes('unit') ?? false);
};

function printedMight(o: GameObject): number | null {
  if (!isUnitDef(o.def)) return null;
  return token(o.def)?.might ?? findCard(o.def)?.might ?? 0;
}

const MEMO = new WeakMap<GameState, { epoch: number; m: Map<ObjId, Derived>; busy: Set<ObjId> }>();

function memo(s: GameState) {
  let e = MEMO.get(s);
  if (!e || e.epoch !== s.epoch) {
    e = { epoch: s.epoch, m: new Map(), busy: new Set() };
    MEMO.set(s, e);
  }
  return e;
}

/** The static abilities that apply to an object: its own, while it is on the board [384.2]. */
function staticsOn(s: GameState, o: GameObject): StaticAbilityAst[] {
  if (!isBoard(o.zone.z) || o.zone.z === 'facedown' || s.bfs.some((b) => b.obj === o.id)) return [];
  return abilitiesOf(o.def).filter((a): a is StaticAbilityAst => a.kind === 'static');
}

function value(s: GameState, v: ValueAst, o: GameObject): number {
  if (typeof v === 'number') return v;
  if (v.v === 'count') return selectAll(s, v.of, { controller: o.controller ?? o.owner, source: o.id }).length;
  return 0;
}

/** Layers 1–3 and the effects of layer 4, without static abilities: what
    an object of a dependency cycle reads of the others [478.1.c]. */
function core(s: GameState, o: GameObject): Derived {
  const keywords = { ...printedKeywordValues(o.def) };
  let base = printedMight(o);
  let baseTs = -1;
  let delta = 0;
  for (const e of s.effects) {
    if (!('objs' in e.affects) || !e.affects.objs.includes(o.id)) continue;
    const spec = e.spec as { s?: string; n?: number; kw?: KeywordId; value?: number } | null;
    if (!spec) continue;
    if (spec.s === 'baseMight' && base !== null && e.ts > baseTs) { base = spec.n ?? 0; baseTs = e.ts; }   // [479.2], [482]
    if (spec.s === 'keyword' && spec.kw) keywords[spec.kw] = (keywords[spec.kw] ?? 0) + (spec.value ?? 1);   // [479.3]
    if (spec.s === 'might') delta += spec.n ?? 0;                                                         // [479.4.b]
  }
  if (base === null) return { might: null, baseMight: null, keywords };
  delta += o.buffs * buffValue(s, o.id);                             // one per buff [703]
  if (o.designation === 'attacker') delta += keywords.assault ?? 0;  // [807.1.c]
  if (o.designation === 'defender') delta += keywords.shield ?? 0;   // [814.1]
  return { might: base + delta, baseMight: base, keywords };
}

/** What an object is now (§6.7). */
export function derive(s: GameState, id: ObjId): Derived {
  const m = memo(s);
  const hit = m.m.get(id);
  if (hit) return hit;
  const o = s.objects[id];
  if (!o) return { might: null, baseMight: null, keywords: {} };
  if (m.busy.has(id)) return core(s, o);                             // a cycle: its members' results without statics
  m.busy.add(id);
  const d = core(s, o);
  if (d.might !== null) {
    for (const a of staticsOn(s, o)) {
      const ctl = o.controller ?? o.owner;
      if (a.while && !evalCond(s, a.while, { controller: ctl, source: id })) continue;   // [478.2]
      d.might += Math.max(0, value(s, a.spec.n, o));                // an increase by a negative amount is +0 [479.4.c]
    }
  }
  m.busy.delete(id);
  m.m.set(id, d);
  return d;
}

/** Whether an object has a keyword now (the implemented ones). */
export function keywordValue(s: GameState, id: ObjId, kw: KeywordId): number {
  if (!IMPLEMENTED_KEYWORDS.includes(kw)) return 0;
  return derive(s, id).keywords[kw] ?? 0;
}
