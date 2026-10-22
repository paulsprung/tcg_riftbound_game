/*
 * Characteristics as M1.2 plays them: printed values, read off the oracle
 * (or a token's template [187]), plus the one kind of continuous effect the
 * chain's spells and abilities make so far: "+N / -N [M] this turn" on a
 * locked set of units (layer 4 [479.4], a stand-in for layers/derive.ts).
 *
 * The full layers (§6.7) arrive with M1.3, and so do the keywords whose
 * rules aren't in yet: hasKeyword() answers only for the ones the engine
 * implements (Tank and Backline for damage assignment, Deploy, Disarm, and
 * the timing keywords Action and Reaction). Everything else asks here, so
 * the layers replace one module.
 */
import { findCard, printedKeywords } from '../cards/oracle.ts';
import { TOKENS } from '../cards/tokens.ts';
import { locOf } from '../state/zones.ts';
import type { CardType, ContinuousEffect, GameObject, GameState, KeywordId, ObjId, Snapshot, TokenId } from '../state/types.ts';
import { buffValue } from './defaults.ts';

const token = (def: string) => (Object.hasOwn(TOKENS, def) ? TOKENS[def as TokenId] : undefined);

/** The card types of an object [133]. */
export function typesOf(o: Pick<GameObject, 'def'>): CardType[] {
  const t = token(o.def);
  if (t) return [t.type];
  return findCard(o.def)?.types ?? [];
}

export const isType = (o: Pick<GameObject, 'def'>, t: CardType) => typesOf(o).includes(t);

/** A unit on the board: at a base or a battlefield [141.1.a.1]. */
export function isUnitOnBoard(o: GameObject): boolean {
  return locOf(o) !== null && isType(o, 'unit');
}

/**
 * Effective Might [143.2.a]: printed Might plus one per buff [703]. Without
 * the layers there is nothing else to add. May be negative once effects
 * can lower it [143.2.c]; mightRef() clamps it for references and sums.
 */
export function mightOf(s: GameState, id: ObjId): number {
  const o = s.objects[id];
  const printed = token(o.def)?.might ?? findCard(o.def)?.might ?? 0;
  return printed + o.buffs * buffValue(s, id) + effectMight(s.effects, id);
}

/** The sum of the "+N [M]" effects on an object [479.4]: each holds its
    delta, fixed as it was created [479.4.b]. */
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
export const combatMight = (s: GameState, id: ObjId) => (s.objects[id].stunned ? 0 : mightRef(s, id));

/** The keywords whose rules the engine implements so far. */
const IMPLEMENTED: readonly KeywordId[] = ['tank', 'backline', 'deploy', 'disarm', 'action', 'reaction'];

/** Whether an object has a keyword: printed, for the implemented ones. */
export function hasKeyword(s: GameState, id: ObjId, kw: KeywordId): boolean {
  return defHasKeyword(s.objects[id].def, kw);
}

export function defHasKeyword(def: string, kw: KeywordId): boolean {
  if (!IMPLEMENTED.includes(kw)) return false;                     // the other keywords come with the layers (M1.3)
  const t = token(def);
  if (t) return t.keywords.includes(kw);
  const c = findCard(def);
  return c !== undefined && printedKeywords(c).some((k) => k.kw === kw);
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
  const d = damageOf(s.objects[id]);
  return d > 0 && d >= lethalThreshold(s, id);
}

/** Last-known information about an object [383.2.c.3.b], [359.3.e.13]. */
export function snapshotOf(s: GameState, id: ObjId): Snapshot {
  const o = s.objects[id];
  const c = findCard(o.def), t = token(o.def);
  const might = isType(o, 'unit') ? mightOf(s, id) : null;
  return {
    id, card: o.card, def: o.def, owner: o.owner, controller: o.controller, zone: structuredClone(o.zone),
    loc: locOf(o), damage: damageOf(o), buffs: o.buffs, exhausted: o.exhausted, stunned: o.stunned, attached: [],
    knownBy: o.knownBy, epoch: s.epoch,
    chars: {
      name: c?.name ?? t?.name ?? o.def, types: typesOf(o), supertypes: c?.supertypes ?? [], tags: c?.tags ?? t?.tags ?? [],
      domains: c?.domains ?? [], cost: c?.cost ? { energy: c.cost.energy, power: c.cost.power } : null, might,
      baseMight: might, mightBonus: null, keywords: {}, abilities: [], controller: o.controller,
    },
  };
}
