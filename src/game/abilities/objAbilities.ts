/*
 * The abilities an object has now (§9.1, [135], [718], [803]): what its
 * definition prints, what the keywords it has now bring (printed or granted:
 * Fading Memories' [Temporary], Forecaster's "Your Mechs have [Vision]"), the
 * effect text of the Equipment attached to it [718.3] ("I/me" is the unit),
 * and activated abilities other objects give it (Gardens of Becoming's
 * "Units here have '[E]: Gain 1 XP.'", Heimerdinger, Inventor's copies).
 *
 * A printed ability of an attached card is inactive [718.2]; a facedown card
 * has none [811.5.a]. Triggered and activated abilities keep the ids of the
 * definitions that print them, so a chain item names its ability the same
 * way wherever it came from.
 */
import { abilitiesOf, abilityById, keywordAbility, keywordsOf } from '../cards/registry.ts';
import type { ActivatedAst, TriggeredAst } from '../dsl/ast.ts';
import { activeStatics, derive, staticApplies } from '../layers/derive.ts';
import type { GameObject, GameState, KeywordId, ObjId } from '../state/types.ts';
import { matches } from '../rules/targets.ts';

/** Keywords whose rules are an ability of the object [803]. */
const ABILITY_KEYWORDS: readonly KeywordId[] = ['deploy', 'disarm', 'vision', 'temporary', 'hunt', 'quickDraw', 'weaponmaster',
  'equip'];

/** The keyword abilities a keyword the object has now brings, beyond its printed ones. */
function grantedKeywordAbilities(s: GameState, o: GameObject) {
  const printed = new Set(keywordsOf(o.def).map((k) => k.kw));
  const now = derive(s, o.id).keywords;
  const out = [];
  for (const kw of ABILITY_KEYWORDS) {
    if (printed.has(kw) || !(now[kw] ?? 0)) continue;
    const a = keywordAbility(o.def, kw);
    if (a) out.push(a);
  }
  return out;
}

/** The Equipment and other cards attached to a unit [717]. */
export const attachmentsOf = (s: GameState, id: ObjId): GameObject[] =>
  Object.values(s.objects).filter((o) => o.attachedTo === id);

const own = (def: string) => abilitiesOf(def).filter((a) => !a.effectText && !a.grantedOnly);

/** The triggered abilities of an object now, as their source. */
export function triggeredOn(s: GameState, o: GameObject): TriggeredAst[] {
  if (o.attachedTo !== null || o.zone.z === 'facedown') return [];
  const out = own(o.def).filter((a): a is TriggeredAst => a.kind === 'triggered');
  if (o.zone.z === 'base' || o.zone.z === 'bf') {
    out.push(...grantedKeywordAbilities(s, o).filter((a): a is TriggeredAst => a.kind === 'triggered'));
    for (const g of attachmentsOf(s, o.id)) {
      out.push(...abilitiesOf(g.def).filter((a): a is TriggeredAst => a.kind === 'triggered' && a.effectText === true));
      // Svellsongur: "copy that unit's text to this Equipment's effect text".
      if (abilitiesOf(g.def).some((a) => a.kind === 'static' && a.spec.s === 'copyHostText')) {
        out.push(...own(o.def).filter((a): a is TriggeredAst => a.kind === 'triggered'));
      }
    }
  }
  return out;
}

/** One activated ability an object can use, with the part of its key
    `act:<obj>#<sub>` that names it (printed: its index; a keyword's:
    `kw<keyword>`; given by another object: `g<i>`). */
export interface ActivatedOn { a: ActivatedAst; sub: string }

const subOf = (id: string) => {
  const tail = id.slice(id.indexOf('#') + 1);
  return tail.startsWith('kw:') ? `kw${tail.slice(3)}` : tail;
};

/** The activated abilities of an object now [376]. */
export function activatedOn(s: GameState, id: ObjId): ActivatedOn[] {
  const o = s.objects[id];
  if (!o || o.attachedTo !== null || o.zone.z === 'facedown') return [];
  const out: ActivatedOn[] = own(o.def).filter((a): a is ActivatedAst => a.kind === 'activated').map((a) => ({ a, sub: subOf(a.id) }));
  if (o.zone.z !== 'base' && o.zone.z !== 'bf' && o.zone.z !== 'legend') return out;
  for (const a of grantedKeywordAbilities(s, o)) if (a.kind === 'activated') out.push({ a, sub: subOf(a.id) });
  const given: ActivatedAst[] = [];
  for (const st of activeStatics(s)) {
    const spec = st.a.spec;
    if (spec.s === 'grantAbility' && staticApplies(s, st, spec, id)) {
      const a = abilityById(spec.ability);
      if (a?.kind === 'activated') given.push(a);
    }
    if (spec.s === 'copyAbilities' && st.host === id) {               // "I have all [E] abilities of …"
      for (const other of Object.values(s.objects)) {
        if (other.id === id || !spec.of.some((sel) => matches(s, sel, other.id, { controller: st.ctl, source: id }))) continue;
        if (other.attachedTo !== null) continue;
        for (const a of own(other.def)) if (a.kind === 'activated' && a.cost.exhaustSelf && !given.includes(a)) given.push(a);
      }
    }
  }
  for (const e of s.effects) {                                       // Dominus: "give it '[A][A]: Ready me.'" this turn
    const spec = e.spec as { s?: string; ability?: string } | null;
    if (spec?.s !== 'grantAbility' || !('objs' in e.affects) || !e.affects.objs.includes(id) || !spec.ability) continue;
    const a = abilityById(spec.ability);
    if (a?.kind === 'activated' && !given.includes(a)) given.push(a);
  }
  given.forEach((a, i) => out.push({ a, sub: `g${i}` }));
  return out;
}

/** The activated ability `act:<obj>#<sub>` names. */
export function activatedBySub(s: GameState, id: ObjId, sub: string): ActivatedAst | undefined {
  return activatedOn(s, id).find((x) => x.sub === sub)?.a;
}
