/*
 * The card registry (§9.1): which cards have a definition the engine can
 * execute, and their abilities as the rules read them.
 *
 *   printed     the definition's own abilities, ids `${def}#${n}`
 *   keywords    keyword abilities the rules spell out [803]: Deploy's
 *               "When an opponent holds here, kill this" [830.1.b.4],
 *               Disarm X's "When I attack, give an enemy unit here -X [M]
 *               this turn" [831.1.d]; ids `${def}#kw:<keyword>`
 *
 * A card without a definition is played as M1.1 played it: a unit or gear
 * is a vanilla body; a spell has nothing to execute and can't be played.
 * Tokens have no abilities here (Bird's Deflect is a keyword of its
 * template; Gold's Add arrives with M2).
 *
 * defsHash() names the definitions in effect; a game record made under
 * other definitions is not replayed (§4.9).
 */
import type { AbilityAst, CardDef, KeywordAst, TriggeredAst } from '../dsl/ast.ts';
import { hashString, stableJson } from '../state/clone.ts';
import type { DefId, GameState, Json, KeywordId } from '../state/types.ts';
import { OTHER_DEFS, SERAPHINE_DEFS } from './defs/seraphine.ts';
import { findCard, printedKeywords } from './oracle.ts';

const DEFS: Record<DefId, CardDef> = {};
for (const d of [...SERAPHINE_DEFS, ...OTHER_DEFS]) DEFS[d.id] = d;

/** The definition of a card, or undefined when it has none. */
export function cardDef(def: DefId): CardDef | undefined {
  return Object.hasOwn(DEFS, def) ? DEFS[def] : undefined;
}

export const allDefs = (): CardDef[] => Object.values(DEFS);

/** The printed keywords of a card (the oracle's lines, with values) [803]. */
export function keywordsOf(def: DefId): KeywordAst[] {
  const c = findCard(def);
  return c ? printedKeywords(c).map((k) => (k.value === undefined ? { kw: k.kw } : { kw: k.kw, value: k.value })) : [];
}

export const hasPrintedKeyword = (def: DefId, kw: KeywordId) => keywordsOf(def).some((k) => k.kw === kw);

function keywordAbilities(def: DefId): AbilityAst[] {
  const out: AbilityAst[] = [];
  for (const k of keywordsOf(def)) {
    if (k.kw === 'deploy') {
      const a: TriggeredAst = { id: `${def}#kw:deploy`, kind: 'triggered', when: { on: 'hold', who: 'opponent', at: 'here' },
        effect: { body: [{ op: 'kill', what: 'self' }] } };
      out.push(a);
    }
    if (k.kw === 'disarm') {
      const a: TriggeredAst = { id: `${def}#kw:disarm`, kind: 'triggered', when: { on: 'attack', who: 'self' },
        effect: {
          choose: [{ id: 'a', sel: [{ k: 'unit', rel: 'enemy', at: 'here' }], harm: true }],
          body: [{ op: 'might', n: k.value ?? 1, sign: -1, to: { slot: 'a' }, until: 'thisTurn' }],
        } };
      out.push(a);
    }
  }
  return out;
}

const ABILITIES: Record<DefId, AbilityAst[]> = {};

/** Every ability a card has: its keyword abilities, then its printed ones. */
export function abilitiesOf(def: DefId): AbilityAst[] {
  if (!Object.hasOwn(ABILITIES, def)) ABILITIES[def] = [...keywordAbilities(def), ...(cardDef(def)?.abilities ?? [])];
  return ABILITIES[def];
}

/** An ability by its id ('strigian-oracle#0', 'concert-poster#kw:deploy'). */
export function abilityById(id: string): AbilityAst | undefined {
  const def = id.slice(0, id.indexOf('#'));
  return abilitiesOf(def).find((a) => a.id === id);
}

/** An ability by its id, including delayed abilities of the state
    ('eff:<id>#0' [390–393]), which no card prints. */
export function abilityIn(s: GameState, id: string): AbilityAst | undefined {
  if (!id.startsWith('eff:')) return abilityById(id);
  const eid = Number(id.slice(4, id.indexOf('#')));
  const d = s.delayed.find((x) => x.id === eid);
  return d ? ({ ...(d.ability as object), id } as AbilityAst) : undefined;
}

/** Whether a card of this definition has any triggered ability. */
export const hasTriggers = (def: DefId) => abilitiesOf(def).some((a) => a.kind === 'triggered');

/** The hash of the definitions in effect (GameState.defsHash). */
export function defsHash(): string {
  return hashString(stableJson({ definitions: allDefs() as unknown as Json }));
}
