/*
 * The card registry (§9.1): which cards have a definition the engine can
 * execute, and their abilities as the rules read them.
 *
 *   printed     the definition's own abilities, ids `${def}#${n}`
 *   keywords    keyword abilities the rules spell out [803], ids
 *               `${def}#kw:<keyword>`: Deploy's "When an opponent holds
 *               here, kill this" [830.1.b.4], Disarm X [831.1.d], Vision
 *               [817.1.b], Temporary [816.1.b], Hunt X [823.1.c], Equip
 *               [818.1.c], Quick-Draw [819.1.d], Weaponmaster [821.1.c], and
 *               the cost abilities Accelerate [805.1.b] and Repeat [820.1.d]
 *
 * A keyword ability can be built for any definition (abilityById), so a
 * keyword an object gains from an effect (Fading Memories' Temporary,
 * Forecaster's Vision) brings its ability along (abilities/objAbilities.ts).
 *
 * A card without a definition is played as M1.1 played it: a unit or gear
 * is a vanilla body; a spell has nothing to execute and can't be played.
 * Tokens take their keywords from their template [187]; Gold has its Add
 * ability here.
 *
 * defsHash() names the definitions in effect; a game record made under
 * other definitions is not replayed (§4.9).
 */
import type { AbilityAst, CardDef, CostAst, KeywordAst, PowerReqAst, TriggeredAst } from '../dsl/ast.ts';
import { hashString, stableJson } from '../state/clone.ts';
import type { DefId, GameState, Json, KeywordId, PowerReq, TokenId } from '../state/types.ts';
import { OTHER_DEFS, SERAPHINE_DEFS } from './defs/seraphine.ts';
import { SET_DEFS, STARTER_DEFS } from './defs/index.ts';
import { findCard, ORACLE, printedKeywords, type OracleCost } from './oracle.ts';
import { TOKENS } from './tokens.ts';

/** The tokens' own abilities [187]: Gold's "[Reaction][>] Kill this, [E]: [Add] [A]." [187.5]. */
const TOKEN_DEFS: CardDef[] = [
  { id: 'gold', text: '[Reaction][>] Kill this, [E]: [Add] [A].', keywords: [], abilities: [
    { id: 'gold#0', kind: 'activated', cost: { killSelf: true, exhaustSelf: true }, timing: 'reaction', isAdd: true,
      effect: { body: [{ op: 'add', power: 1 }] } },
  ] },
];

const DEFS: Record<DefId, CardDef> = {};
for (const d of [...SERAPHINE_DEFS, ...OTHER_DEFS, ...STARTER_DEFS, ...SET_DEFS, ...TOKEN_DEFS]) {
  if (Object.hasOwn(DEFS, d.id)) throw new Error(`card definition '${d.id}' is defined twice`);
  DEFS[d.id] = d;
}

/** The definition of a card, or undefined when it has none. */
export function cardDef(def: DefId): CardDef | undefined {
  return Object.hasOwn(DEFS, def) ? DEFS[def] : undefined;
}

/** Every card definition (tokens' not included). */
export const allDefs = (): CardDef[] => Object.values(DEFS).filter((d) => !Object.hasOwn(TOKENS, d.id));

const isToken = (def: DefId) => Object.hasOwn(TOKENS, def);

/** The printed keywords of a card (the oracle's lines, with values) [803],
    or a token's template keywords [187]. Keywords that introduce an
    ability (`[Action][>]`, `[Level 3][>]`, `[Deathknell][>]`) belong to that
    ability, not to the card. */
export function keywordsOf(def: DefId): KeywordAst[] {
  if (isToken(def)) return TOKENS[def as TokenId].keywords.map((kw) => ({ kw }));
  const c = findCard(def);
  return c ? printedKeywords(c).filter((k) => !k.joined).map((k) => (k.value === undefined ? { kw: k.kw } : { kw: k.kw, value: k.value })) : [];
}

export const hasPrintedKeyword = (def: DefId, kw: KeywordId) => keywordsOf(def).some((k) => k.kw === kw);

const power = (r: PowerReq): PowerReqAst => (r.k === 'any' ? 'A' : r.k === 'domain' ? r.d : 'C');

/** A printed keyword cost ("[Equip] [3][A]", "[Repeat] — Discard 1") as a cost of the effect language. */
function costOfKeyword(c: OracleCost | undefined): CostAst {
  if (!c) return {};
  const out: CostAst = {};
  if (c.energy > 0) out.energy = c.energy;
  if (c.power.length > 0) out.power = c.power.map(power);
  for (const o of c.other ?? []) {
    const m = /^Discard (\d+)$/.exec(o);
    if (m) out.discard = Number(m[1]);
    const r = /^Recycle (\d+) cards? from your trash$/i.exec(o);
    if (r) out.recycleTrash = { n: Number(r[1]) };
  }
  return out;
}

/** The printed cost of a card's keyword (Equip, Repeat), first alternative [204.1.b]. */
export function keywordCost(def: DefId, kw: KeywordId): CostAst | undefined {
  const c = findCard(def);
  const k = c ? printedKeywords(c).find((x) => x.kw === kw) : undefined;
  return k ? costOfKeyword(k.costs?.[0]) : undefined;
}

/** The keyword ability of a keyword, for any definition: the printed ones
    of the card, and the ones a granted keyword brings [803]. */
export function keywordAbility(def: DefId, kw: KeywordId): AbilityAst | undefined {
  const id = `${def}#kw:${kw}`;
  const self = 'self' as const;
  switch (kw) {
    case 'deploy':
      return { id, kind: 'triggered', when: { on: 'hold', who: 'opponent', at: 'here' }, effect: { body: [{ op: 'kill', what: self }] } };
    case 'disarm':
      return { id, kind: 'triggered', when: { on: 'attack', who: 'self' }, effect: {
        choose: [{ id: 'a', sel: [{ k: 'unit', rel: 'enemy', at: 'here' }], harm: true }],
        body: [{ op: 'might', n: { v: 'kw', kw: 'disarm' }, sign: -1, to: { slot: 'a' }, until: 'thisTurn' }],
      } };
    case 'vision':                                                   // [817.1.b]
      return { id, kind: 'triggered', when: { on: 'played', who: 'self' }, effect: { body: [{ op: 'predict', n: 1 }] } };
    case 'temporary':                                                // [816.1.b]
      return { id, kind: 'triggered', when: { on: 'phase', at: 'beginning', whose: 'your' },
        effect: { body: [{ op: 'kill', what: self }] } };
    case 'hunt':                                                     // [823.1.c]: a conquer and a hold effect
      return { id, kind: 'triggered', when: { on: 'score', who: 'you', at: 'here' },
        effect: { body: [{ op: 'gainXp', n: { v: 'kw', kw: 'hunt' } }] } };
    case 'quickDraw':                                                // [819.1.d]
      return { id, kind: 'triggered', when: { on: 'played', who: 'self' }, effect: {
        choose: [{ id: 'u', sel: [{ k: 'unit', rel: 'friendly' }] }],
        body: [{ op: 'attach', what: self, to: { slot: 'u' } }],
      } };
    case 'weaponmaster':                                             // [821.1.c]
      return { id, kind: 'triggered', when: { on: 'played', who: 'self' }, may: true, effect: {
        choose: [{ id: 'e', sel: [{ k: 'gear', rel: 'friendly', where: [{ p: 'tag', tag: 'Equipment' }] }] }],
        body: [{ op: 'equipToSelf', what: { slot: 'e' } }],
      } };
    case 'equip': {                                                  // [818.1.c]: "[Cost]: Attach this to a unit you control"
      const cost = keywordCost(def, 'equip') ?? {};
      const less = cardDef(def)?.keywords.find((k) => k.kw === 'equip')?.equipLessBy;
      return { id, kind: 'activated', cost: less ? { ...cost, energyLessBy: less } : cost, effect: {
        choose: [{ id: 'u', sel: [{ k: 'unit', rel: 'friendly' }] }],
        body: [{ op: 'attach', what: self, to: { slot: 'u' } }],
      } };
    }
    case 'accelerate':                                               // [805.1.b]: [1][C], then I enter ready
      return { id, kind: 'cost', optional: true, add: { energy: 1, power: ['C'] } };
    case 'repeat': {                                                 // [820.1.d]
      const c = keywordCost(def, 'repeat') ?? {};
      const { discard, ...res } = c;
      return { id, kind: 'cost', optional: true, repeat: true, ...(Object.keys(res).length > 0 ? { add: res } : {}),
        ...(discard ? { pay: { discard } } : {}) };
    }
    default: return undefined;
  }
}

function keywordAbilities(def: DefId): AbilityAst[] {
  const out: AbilityAst[] = [];
  for (const k of keywordsOf(def)) {
    const a = keywordAbility(def, k.kw);
    if (a && !out.some((b) => b.id === a.id)) out.push(a);
  }
  return out;
}

const ABILITIES: Record<DefId, AbilityAst[]> = {};

/** Every ability a card has: its keyword abilities, then its printed ones. */
export function abilitiesOf(def: DefId): AbilityAst[] {
  if (!Object.hasOwn(ABILITIES, def)) ABILITIES[def] = [...keywordAbilities(def), ...(cardDef(def)?.abilities ?? [])];
  return ABILITIES[def];
}

/** An ability by its id ('strigian-oracle#0', 'concert-poster#kw:deploy'),
    keyword abilities of granted keywords included. */
export function abilityById(id: string): AbilityAst | undefined {
  const def = id.slice(0, id.indexOf('#'));
  const own = abilitiesOf(def).find((a) => a.id === id);
  if (own) return own;
  const kw = /#kw:(\w+)$/.exec(id);
  return kw ? keywordAbility(def, kw[1] as KeywordId) : undefined;
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
  return hashString(stableJson({ definitions: Object.values(DEFS) as unknown as Json }));
}

/** How far the definitions cover the oracle (§9.7): every card is one of
    'defined' (a definition, nothing missing), 'partial' (a definition
    listing parts it doesn't implement), 'vanilla' (no rules text, so
    nothing to define; basic runes' Add abilities are rules [164.2]),
    'keywords' (only keyword lines whose rules the engine implements, e.g.
    "[Tank]") or 'undefined'. */
export type Coverage = 'defined' | 'partial' | 'vanilla' | 'keywords' | 'undefined';

/** The keywords whose rules the engine implements. */
export const IMPLEMENTED_KEYWORDS: readonly KeywordId[] = ['tank', 'backline', 'deploy', 'disarm', 'action', 'reaction',
  'deflect', 'shield', 'assault', 'deathknell', 'showOff', 'accelerate', 'ganking', 'hidden', 'vision', 'temporary',
  'equip', 'quickDraw', 'repeat', 'weaponmaster', 'ambush', 'hunt', 'legion', 'level', 'unique'];

export function coverageOf(def: DefId): Coverage {
  const d = cardDef(def);
  if (d) return d.missing && d.missing.length > 0 ? 'partial' : 'defined';
  const c = findCard(def);
  if (!c || c.rules.trim() === '' || c.types.includes('rune')) return 'vanilla';
  const lines = c.rules.split('\n');
  const kwOnly = lines.every((_, i) => {
    const l = c.keywords.find((k) => k.line === i);
    return l !== undefined && !l.body && l.keywords.every((k) => IMPLEMENTED_KEYWORDS.includes(k.kw) && !k.joined);
  });
  return kwOnly ? 'keywords' : 'undefined';
}

/** The coverage of every oracle card, by id. */
export function coverageReport(): { id: DefId; types: string[]; sets: string[]; coverage: Coverage }[] {
  return ORACLE.cards.map((c) => ({ id: c.id, types: c.types, sets: c.sets, coverage: coverageOf(c.id) }));
}

export type { TriggeredAst };
