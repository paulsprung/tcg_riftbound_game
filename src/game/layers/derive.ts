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
 *              plus static abilities that give them ("Your Mechs have
 *              [Shield]", an Equipment's "[Assault 2]"), valued keywords
 *              summed [479.3], [807.2], [814.2]
 *   layer 4    increases and decreases [479.4]: buff counters [703] (worth
 *              more under Stand United), "+N [M] this turn / this combat"
 *              with its amount fixed at creation [479.4.b], the Might Bonus
 *              of attached Equipment [137.3], static abilities ("I have +1
 *              [M] for each …", "Other friendly units have +1 [M] here"),
 *              Assault while attacking and Shield while defending [807.1.c],
 *              [814.1]; an increase by a negative amount is +0 [479.4.c]
 *
 * Static abilities [365] apply while their source is on the board (not face
 * down, not a printed ability of an attached card [718.2]); an attached
 * Equipment's effect text is an ability of the unit it is attached to
 * [718.3]. Without a `to` selector a static is about its source; with one,
 * about every object the selector picks now.
 *
 * Order and dependency [478], [480–482]: the conditions and amounts of the
 * statics are evaluated against the state; when one reads a characteristic
 * an earlier layer of another object derives (Might in a selector), that
 * object is derived first [478.1.a]. A cycle (two objects whose statics
 * each read the other's Might) is a strongly connected component
 * [478.1.c]: inside it the evaluation reads the members' results without
 * statics, once.
 */
import { findCard } from '../cards/oracle.ts';
import { abilitiesOf, IMPLEMENTED_KEYWORDS, keywordsOf } from '../cards/registry.ts';
import { TOKENS } from '../cards/tokens.ts';
import type { SelAst, StaticAbilityAst, StaticAst, ValueAst } from '../dsl/ast.ts';
import type { GameObject, GameState, KeywordId, ObjId, PlayerId, TokenId } from '../state/types.ts';
import { evalCond } from '../rules/conditions.ts';
import { matches, selectAll } from '../rules/targets.ts';

export { IMPLEMENTED_KEYWORDS };

export interface Derived {
  might: number | null;
  baseMight: number | null;
  /** Keyword values after layer 3; 1 for keywords without a value. */
  keywords: Partial<Record<KeywordId, number>>;
}

const token = (def: string) => (Object.hasOwn(TOKENS, def) ? TOKENS[def as TokenId] : undefined);

/** The printed keywords of a definition, with values [803] (not the ones
    that introduce an ability). */
export function printedKeywordValues(def: string): Partial<Record<KeywordId, number>> {
  const out: Partial<Record<KeywordId, number>> = {};
  for (const k of keywordsOf(def)) out[k.kw] = (out[k.kw] ?? 0) + (k.value ?? 1);
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

/** A static ability as it applies now: the ability and its host ("I"). */
export interface StaticInst { a: StaticAbilityAst; host: ObjId; ctl: PlayerId }

const MEMO = new WeakMap<GameState, { epoch: number; m: Map<ObjId, Derived>; busy: Set<ObjId>; statics: StaticInst[] | null }>();

function memo(s: GameState) {
  let e = MEMO.get(s);
  if (!e || e.epoch !== s.epoch) {
    e = { epoch: s.epoch, m: new Map(), busy: new Set(), statics: null };
    MEMO.set(s, e);
  }
  return e;
}

/** The objects whose static abilities may apply: the board but its Facedown Zones [384.2]. */
export function boardObjects(s: GameState): GameObject[] {
  const ids = [...s.players.flatMap((pl) => [...pl.legend, ...pl.base]), ...s.bfs.flatMap((b) => [b.obj, ...b.here])];
  return ids.map((id) => s.objects[id]).filter((o) => o !== undefined);
}

/** Every static ability active on the board now [365], [718.2–718.3]. */
export function activeStatics(s: GameState): StaticInst[] {
  const m = memo(s);
  if (m.statics) return m.statics;
  const out: StaticInst[] = [];
  for (const o of boardObjects(s)) {
    const ctl = o.controller ?? o.owner;
    if (o.attachedTo !== null) {                                     // effect text: the host's [718.3]
      const host = s.objects[o.attachedTo];
      if (!host) continue;
      for (const a of abilitiesOf(o.def)) {
        if (a.kind === 'static' && a.effectText) out.push({ a, host: host.id, ctl: host.controller ?? host.owner });
      }
      continue;
    }
    for (const a of abilitiesOf(o.def)) {
      if (a.kind === 'static' && !a.effectText && !a.grantedOnly) out.push({ a, host: o.id, ctl });
    }
  }
  m.statics = out;
  return out;
}

/** Whether a static applies to an object now: its condition holds and the
    object is its source (no `to`) or one its selector picks. */
export function staticApplies(s: GameState, st: StaticInst, spec: { to?: SelAst }, id: ObjId): boolean {
  if (spec.to ? !matches(s, spec.to, id, { controller: st.ctl, source: st.host }) : st.host !== id) return false;
  return !st.a.while || evalCond(s, st.a.while, { controller: st.ctl, source: st.host });
}

/** Statics about an object: "I have …" or "… have …" (a `to` selector). */
const TARGETED: readonly StaticAst['s'][] = ['might', 'keyword', 'entersReady', 'grantAbility', 'maxBuffs'];

/** The statics of a kind that apply to an object now (for the kinds that
    are about objects), or every active one of that kind whose condition
    holds (rule modifiers: `id` null). */
export function staticsFor<S extends StaticAst['s']>(s: GameState, id: ObjId | null, kind: S):
  { st: StaticInst; spec: Extract<StaticAst, { s: S }> }[] {
  const out: { st: StaticInst; spec: Extract<StaticAst, { s: S }> }[] = [];
  for (const st of activeStatics(s)) {
    const spec = st.a.spec;
    if (spec.s !== kind) continue;
    const sp = spec as Extract<StaticAst, { s: S }>;
    if (TARGETED.includes(kind) && id !== null) {
      if (!staticApplies(s, st, sp as { to?: SelAst }, id)) continue;
    } else if (st.a.while && !evalCond(s, st.a.while, { controller: st.ctl, source: st.host })) continue;
    out.push({ st, spec: sp });
  }
  return out;
}

function value(s: GameState, v: ValueAst, host: ObjId, ctl: PlayerId): number {
  if (typeof v === 'number') return v;
  if (v.v === 'count') return selectAll(s, v.of, { controller: ctl, source: host }).length;
  return 0;
}

/** What each buff counter gives a unit: 1 [703], more under "buffs give an
    additional +1 [M] to friendly units this turn" (Stand United). */
export function buffValueOf(s: GameState, o: GameObject): number {
  let n = 1;
  for (const e of s.effects) {
    const spec = e.spec as { s?: string; n?: number } | null;
    if (spec?.s === 'buffValue' && 'player' in e.affects && e.affects.player === o.controller) n += spec.n ?? 0;
  }
  return n;
}

/** The Might Bonus of the Equipment attached to a unit [137.3], [718.4]. */
function mightBonus(s: GameState, id: ObjId): number {
  let n = 0;
  for (const o of Object.values(s.objects)) if (o.attachedTo === id) n += findCard(o.def)?.mightBonus ?? 0;
  return n;
}

/** Layers 1–4 without statics that read characteristics: what an object of
    a dependency cycle reads of the others [478.1.c]. */
function core(s: GameState, o: GameObject, withStatics: boolean): Derived {
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
  const onBoard = o.zone.z === 'base' || o.zone.z === 'bf' || o.zone.z === 'legend';
  if (withStatics && onBoard) {
    const statics = staticsFor(s, o.id, 'keyword');
    for (const { spec } of statics) if (!spec.ifNot) keywords[spec.kw.kw] = (keywords[spec.kw.kw] ?? 0) + (spec.kw.value ?? 1);
    for (const { spec } of statics) if (spec.ifNot && !keywords[spec.kw.kw]) keywords[spec.kw.kw] = spec.kw.value ?? 1;   // "if they didn't already"
  }
  if (base === null) return { might: null, baseMight: null, keywords };
  delta += o.buffs * buffValueOf(s, o);                              // one per buff [703]
  if (onBoard) delta += mightBonus(s, o.id);                         // [137.3]
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
  if (m.busy.has(id)) return core(s, o, false);                      // a cycle: its members' results without statics
  m.busy.add(id);
  const d = core(s, o, true);
  const onBoard = o.zone.z === 'base' || o.zone.z === 'bf';
  if (d.might !== null && onBoard) {
    const ms = staticsFor(s, id, 'might');
    for (const { st, spec } of ms) {
      if (!spec.dec) d.might += Math.max(0, value(s, spec.n, st.host, st.ctl));   // an increase by a negative amount is +0 [479.4.c]
    }
    for (const { st, spec } of ms) {                                 // decreases, "to a minimum of N [M]"
      if (!spec.dec) continue;
      const n = Math.max(0, value(s, spec.n, st.host, st.ctl));
      d.might -= spec.floor === undefined ? n : Math.min(n, Math.max(0, d.might - spec.floor));
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
