/*
 * Characteristics as procedures read them: the card types, printed costs,
 * Might, keywords, damage and lethality, and last-known information. Might
 * and keywords come from the layers (layers/derive.ts, §6.7); everything
 * else asks here, so the layers are one module.
 */
import { findCard } from '../cards/oracle.ts';
import { TOKENS } from '../cards/tokens.ts';
import { IMPLEMENTED_KEYWORDS } from '../cards/registry.ts';
import { derive, keywordValue, printedKeywordValues, staticsFor } from '../layers/derive.ts';
import { locOf } from '../state/zones.ts';
import type { CardType, ContinuousEffect, GameObject, GameState, KeywordId, ObjId, Snapshot, TokenId } from '../state/types.ts';
import { copyJson } from '../state/clone.ts';

const token = (def: string) => (Object.hasOwn(TOKENS, def) ? TOKENS[def as TokenId] : undefined);

/** The card types of an object [133]; a unit gear (Orianna, Lady of Clockwork) is a gear and a unit [137.3.b]. */
export function typesOf(o: Pick<GameObject, 'def'> & { asUnit?: GameObject['asUnit'] }): CardType[] {
  const t = token(o.def);
  const types = t ? [t.type] : findCard(o.def)?.types ?? [];
  return o.asUnit && !types.includes('unit') ? [...types, 'unit'] : types;
}

export const isType = (o: Pick<GameObject, 'def'> & { asUnit?: GameObject['asUnit'] }, t: CardType) => typesOf(o).includes(t);

/** An object's tags [133.6]: printed, or its token template's. */
export function tagsOf(o: Pick<GameObject, 'def'>): string[] {
  const t = token(o.def);
  if (t) return t.tags;
  return findCard(o.def)?.tags ?? [];
}

/** A unit on the board: at a base or a battlefield [141.1.a.1]. */
export function isUnitOnBoard(o: GameObject): boolean {
  return locOf(o) !== null && isType(o, 'unit');
}

/**
 * Effective Might [143.2.a] after the layers (§6.7). May be negative once
 * effects lower it [143.2.c]; mightRef() clamps it for references and sums.
 * Objects without Might (gear, spells) read 0.
 */
export function mightOf(s: GameState, id: ObjId): number {
  return derive(s, id).might ?? 0;
}

/** The sum of the "+N [M] this turn" effects on an object [479.4]: each holds
    its delta, fixed as it was created [479.4.b]. */
export function effectMight(effects: readonly ContinuousEffect[], id: ObjId): number {
  let n = 0;
  for (const e of effects) {
    const spec = e.spec as { s?: string; n?: number } | null;
    if (spec?.s === 'might' && 'objs' in e.affects && e.affects.objs.includes(id)) n += spec.n ?? 0;
  }
  return n;
}

/** Might as spells, abilities and the combat sum read it: below 0 counts 0 [143.2.c]. */
export const mightRef = (s: GameState, id: ObjId) => Math.max(0, mightOf(s, id));

/** What a unit adds to its side's combat total: a stunned unit adds 0 [424.1.b], [467.2.a–b]. */
export const combatMight = (s: GameState, id: ObjId) => (s.objects[id].stunned
  || staticsFor(s, id, 'noCombatDamage').length > 0 ? 0 : mightRef(s, id));   // "I don't deal combat damage" (Galio)

/** Whether an object has a keyword now [803]: printed or granted (layer 3),
    for the keywords whose rules the engine implements. */
export function hasKeyword(s: GameState, id: ObjId, kw: KeywordId): boolean {
  return keywordValue(s, id, kw) > 0;
}

/** A keyword's value (Deflect 1, Shield 2): summed over its instances [807.2]. */
export const keywordOf = (s: GameState, id: ObjId, kw: KeywordId) => keywordValue(s, id, kw);

/** Whether a definition prints a keyword (timing keywords of cards in hand). */
export function defHasKeyword(def: string, kw: KeywordId): boolean {
  return IMPLEMENTED_KEYWORDS.includes(kw) && (printedKeywordValues(def)[kw] ?? 0) > 0;
}

/** A card's printed Energy cost [131]; tokens and cards without one: 0 [185.3.a.1]. */
export const energyCostOf = (o: Pick<GameObject, 'def'>) => findCard(o.def)?.cost?.energy ?? 0;

/** Damage marked on a unit [142.2]. */
export const damageOf = (o: GameObject) => o.damage.reduce((n, d) => n + d.amount, 0);

/** Damage that makes a unit die in the next cleanup: non-zero and at least its Might [142.4.b]. */
export function lethalThreshold(s: GameState, id: ObjId): number {
  return Math.max(1, mightOf(s, id));
}

export function isLethal(s: GameState, id: ObjId): boolean {
  const o = s.objects[id];
  const d = damageOf(o);
  // Elder Dragon: "Any amount of your damage is enough to kill enemy units."
  if (d > 0 && staticsFor(s, null, 'anyDamageKills').some(({ st }) => st.ctl !== o.controller
    && o.damage.some((m) => m.by === st.ctl))) return true;
  return d > 0 && d >= lethalThreshold(s, id);
}

/** Last-known information about an object [383.2.c.3.b], [359.3.e.13]. */
export function snapshotOf(s: GameState, id: ObjId): Snapshot {
  const o = s.objects[id];
  const c = findCard(o.def), t = token(o.def);
  const d = derive(s, id);
  const might = isType(o, 'unit') ? d.might ?? 0 : null;
  const keywords: Snapshot['chars']['keywords'] = {};
  for (const [k, v] of Object.entries(d.keywords)) keywords[k as KeywordId] = { value: v, instances: 1, active: true };
  return {
    id, card: o.card, def: o.def, owner: o.owner, controller: o.controller, zone: copyJson(o.zone),
    loc: locOf(o), damage: damageOf(o), buffs: o.buffs, exhausted: o.exhausted, stunned: o.stunned, attached: [],
    knownBy: o.knownBy, epoch: s.epoch, ...(o.empowered > 0 ? { empowered: o.empowered } : {}),
    chars: {
      name: c?.name ?? t?.name ?? o.def, types: typesOf(o), supertypes: c?.supertypes ?? [], tags: c?.tags ?? t?.tags ?? [],
      domains: c?.domains ?? [], cost: c?.cost ? { energy: c.cost.energy, power: c.cost.power } : null, might,
      baseMight: isType(o, 'unit') ? d.baseMight : null, mightBonus: null, keywords, abilities: [], controller: o.controller,
    },
  };
}
