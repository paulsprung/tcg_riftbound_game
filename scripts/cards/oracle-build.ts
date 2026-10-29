/*
 * public/data/cards.json → the oracle (src/game/cards/oracle.ts, §9.1).
 * Pure: build-oracle.ts reads and writes the files, and the tests run the
 * same build to check that the committed oracle.gen.json is current.
 *
 * Steps, per card name:
 *
 *   1. Group printings by canonical name [132]. Promo spellings ("Jinx -
 *      Loose Cannon (Metal)"), Proving Grounds' ", Starter", the champion
 *      tag missing from legend names and the ", Kai'Sa" the data appends to
 *      Signature cards are all folded in. Tokens are left out [185].
 *   2. Rank the printings: main sets before promo sets, newer sets first,
 *      base before alternate art and overnumbered.
 *   3. Text: Riot's errata if any printing has it, else the top printing's
 *      wording, shown from whichever printing with that wording carries the
 *      most reminder text. Then normalize (symbols, separators, modes) and
 *      apply the override rows; a row that no longer applies is an error.
 *   4. Parse costs, keyword lines and deck rules from the text.
 */
import { createHash } from 'node:crypto';
import type { Card, CardDb, Variant } from '../../src/data/types.ts';
import type {
  DeckRule, KeywordLine, OracleCard, OracleCost, OracleFile, OracleKeyword, Supertype,
} from '../../src/game/cards/oracle.ts';
import { OVERRIDES, type OverrideRow } from '../../src/game/cards/overrides.ts';
import { BASIC_RUNE_TEXT, BASIC_RUNES } from '../../src/game/cards/runes.ts';
import { TOKEN_IDS, TOKENS } from '../../src/game/cards/tokens.ts';
import { hashString, stableJson } from '../../src/game/state/clone.ts';
import type { CardType, DefId, Domain, KeywordId, PowerReq, TokenId } from '../../src/game/state/types.ts';

export const CARDS_FILE = 'public/data/cards.json';

/** Main sets in release order. The promo sets (opp, pr, jdg, sgn, t1a, t1s)
    reprint their cards, often with damaged text. */
const MAIN_SETS = ['ogn', 'ogs', 'sfd', 'unl', 'ven', 'rad'];
const VARIANTS: Variant[] = ['base', 'alt-art', 'overnumbered', 'signature', 'promo'];

const TYPES: Record<string, CardType> = {
  Unit: 'unit', Gear: 'gear', Spell: 'spell', Rune: 'rune', Battlefield: 'battlefield', Legend: 'legend',
};
const DOMAINS: Record<string, Domain> = {
  Fury: 'fury', Calm: 'calm', Mind: 'mind', Body: 'body', Chaos: 'chaos', Order: 'order',
};
/** Rules shorthand for one Power of a domain [134.2]. */
const DOMAIN_SYMBOL: Record<Domain, string> = { fury: 'R', calm: 'G', mind: 'B', body: 'O', chaos: 'P', order: 'Y' };
const SYMBOL_DOMAIN = Object.fromEntries(Object.entries(DOMAIN_SYMBOL).map(([d, s]) => [s, d])) as
  Record<string, Domain>;

const KEYWORDS: Record<string, KeywordId> = {
  Accelerate: 'accelerate', Action: 'action', Assault: 'assault', Deathknell: 'deathknell', Deflect: 'deflect',
  Ganking: 'ganking', Hidden: 'hidden', Legion: 'legion', Reaction: 'reaction', Shield: 'shield', Tank: 'tank',
  Temporary: 'temporary', Vision: 'vision', Equip: 'equip', 'Quick-Draw': 'quickDraw', Repeat: 'repeat',
  Weaponmaster: 'weaponmaster', Ambush: 'ambush', Hunt: 'hunt', Level: 'level', Unique: 'unique',
  Backline: 'backline', Empower: 'empower', Empowered: 'empowered', Flow: 'flow', Deploy: 'deploy',
  Disarm: 'disarm', 'Show Off': 'showOff',
};
/** X is 1 when not printed [807.1.b.3], [809.1.b.3], [814.1.b.3], [823.1.c.2], [831.1.c.3]. */
const VALUE_DEFAULTS_TO_1 = new Set<KeywordId>(['assault', 'deflect', 'shield', 'hunt', 'disarm']);
/** Keywords followed by a cost [818], [820], [827], [829]. */
const COSTED = new Set<KeywordId>(['equip', 'repeat', 'empower', 'flow']);

const KW_NAMES = Object.keys(KEYWORDS).map((k) => k.replace('-', '\\-')).join('|');
const KW_TOKEN = new RegExp(`^\\[(${KW_NAMES})(?: (\\d+))?\\]`);

export class OracleBuildError extends Error {
  constructor(readonly problems: string[]) {
    super(`the oracle can't be built:\n  ${problems.join('\n  ')}`);
    this.name = 'OracleBuildError';
  }
}

// ---- names ----

/** DefId: the slug of a canonical name ('kaisa-daughter-of-the-void'). */
export function slug(name: string): DefId {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The data's spelling with promo decorations removed: "Annie - Fiery
    (Metal)" → "Annie, Fiery". */
function plainName(c: Card): string {
  return c.name.trim().replace(/\s+\([^()]*\)$/, '').replace(/\s+-\s+/, ', ');
}

/** The tags that link legends, champion units and Signature cards
    [133.8.b]: a legend tag that starts some champion unit's name. */
function championTagsOf(cards: Card[]): Set<string> {
  const prefixes = new Set(cards.filter((c) => c.type === 'Unit' && c.supertype === 'Champion')
    .map((c) => plainName(c).split(', ')[0]));
  const tags = new Set<string>();
  for (const c of cards) {
    if (c.type !== 'Legend') continue;
    tags.add(c.tags.find((t) => prefixes.has(t)) ?? c.tags[0]);
  }
  return tags;
}

/** The canonical name [132]. Legends get their champion tag, which the
    data leaves out ("Starry-Eyed Songstress"); Signature cards lose the
    ", Kai'Sa" (or ", Yi") the data appends. */
export function canonicalName(c: Card, championTags: Set<string>): string {
  let n = plainName(c);
  if (c.type === 'Legend') {
    n = n.replace(/, Starter$/, '');                   // Proving Grounds' starter legends
    const tag = c.tags.find((t) => championTags.has(t)) ?? c.tags[0];
    if (tag) {
      n = n.toLowerCase().startsWith(`${tag.toLowerCase()}, `) ? tag + n.slice(tag.length) : `${tag}, ${n}`;
    }
  }
  if (c.supertype === 'Signature') {
    const m = /^(.*), ([^,]+)$/.exec(n);
    if (m && c.tags.some((t) => t === m[2] || t.endsWith(` ${m[2]}`))) n = m[1];
  }
  return n;
}

// ---- text ----

/** Data symbol codes → rules notation (oracle.ts). */
export function symbols(text: string): string {
  return text
    .replace(/:rb_energy_(\d+):/g, '[$1]')
    .replace(/:rb_might:/g, '[M]')
    .replace(/:rb_exhaust:/g, '[E]')
    .replace(/:rb_rune_rainbow:/g, '[A]')
    .replace(/:rb_rune_(fury|calm|mind|body|chaos|order):/g, (_, d: Domain) => `[${DOMAIN_SYMBOL[d]}]`);
}

/**
 * Lays out one printed line. The data runs a modal list together ("Choose
 * two —Deal 2 to a unit.Play two …"); each mode goes on its own line,
 * marked "• " so it is never read as a keyword line (normalizeText marks a
 * list whose modes are already on lines of their own). A line run together
 * without a list opener is split too, and reported.
 */
function layoutLine(line: string, note: (msg: string) => void): string[] {
  const join = /(?<=[.)])(?=[A-Z[])/;
  const open = /(—|[a-z]:)(?=[A-Z[])/.exec(line);
  if (open) {
    const at = open.index + open[0].length;
    return [line.slice(0, at).trim(), ...line.slice(at).split(join).map((m) => `• ${m.trim()}`)];
  }
  const parts = line.split(join);
  if (parts.length > 1) note(`sentences run together: "${line.slice(0, 60)}…"`);
  return parts;
}

/**
 * Raw card text → oracle text: rules notation for symbols; `[>]` for the
 * em dash after a keyword that introduces an ability [727], Spec H §7; the
 * older activated-ability template "[E]: [Reaction] — X" rewritten to the
 * current "[Reaction][>] [E]: X"; modes laid out one per line.
 */
export function normalizeText(raw: string, note: (msg: string) => void = () => {}): string {
  const text = symbols(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/[’‘]/g, "'").replace(/ /g, ' ')
    .replace(/\[NO TEXT\]/g, '')
    .replace(/\[ADD\]/g, '[Add]')
    .replace(/–(?=\[M\]|\d)/g, '-');
  const leftover = /:rb_[a-z0-9_]+:/.exec(text);
  if (leftover) note(`unknown symbol ${leftover[0]}`);
  return text.split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .map((l) => l.replace(/^([^.\n]+?): \[(Reaction|Action|Legion)\] — (.+)$/, '[$2][>] $1: $3'))
    .map((l) => l.replace(/\[(Deathknell|Legion|Empowered|Level \d+)\]\s*—\s*/g, '[$1][>] '))
    .flatMap((l) => layoutLine(l, note))
    .filter((l) => l !== '')
    // a modal list already on lines of its own: its modes are the rest of the text
    .map((l, i, ls) => (i > 0 && !l.startsWith('• ') && ls.slice(0, i).some((p) => p.endsWith('—')) ? `• ${l}` : l))
    .join('\n');
}

/** Reminder text, the parenthesized explanations, removed [135.2.d.3]. */
export function stripReminders(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out;) {
    prev = out;
    out = out.replace(/\s*\([^()]*\)/g, '');
  }
  return out.split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/ ([.,])/g, '$1').trim())
    .filter((l) => l !== '' && l !== '•')
    .join('\n');
}

// ---- costs ----

/** What one Power symbol of a card asks for: its domain, any one of its
    domains [135.2.e.6.c], or any domain when it has none [135.2.e.6.b]. */
export function powerOf(domains: Domain[]): PowerReq {
  if (domains.length === 0) return { k: 'any' };
  return domains.length === 1 ? { k: 'domain', d: domains[0] } : { k: 'anyOf', ds: [...domains] };
}

/**
 * A printed cost: "[1][G]", "[Y], Kill a friendly unit", "[1], [E]".
 * Symbol groups become Energy and Power, [E] the exhaust cost, anything
 * else is kept verbatim. `c` is what [C] means on this card.
 */
export function parseCost(text: string, c: PowerReq): OracleCost {
  const cost: OracleCost = { energy: 0, power: [] };
  for (const part of text.split(/,\s*/).map((p) => p.trim()).filter(Boolean)) {
    if (!/^(\[(\d+|[RGBOPYACE])\])+$/.test(part)) {
      (cost.other ??= []).push(part);
      continue;
    }
    for (const [, sym] of part.matchAll(/\[(\d+|[RGBOPYACE])\]/g)) {
      if (/^\d+$/.test(sym)) cost.energy += Number(sym);
      else if (sym === 'E') cost.exhaust = true;
      else if (sym === 'A') cost.power.push({ k: 'any' });
      else if (sym === 'C') cost.power.push(c);
      else cost.power.push({ k: 'domain', d: SYMBOL_DOMAIN[sym] });
    }
  }
  return cost;
}

// ---- keyword lines ----

/**
 * Reads a rules line that starts with keywords [803]: "[Tank]", "[Shield
 * 2][Tank]", "[Equip] [1][G]", "[Repeat] — [1] / [A]", "[Show Off] a Mech.",
 * "[Deathknell][>] Draw 1.", "[Level 11][>>][Legion][>] When you conquer, …".
 * Returns null for any other line. Mode items ("• …") are never keyword
 * lines, even when a mode grants a keyword.
 */
export function parseKeywordLine(line: string, index: number, c: PowerReq,
  note: (msg: string) => void = () => {}): KeywordLine | null {
  if (!KW_TOKEN.test(line)) return null;
  const out: KeywordLine = { line: index, keywords: [] };
  let rest = line;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith('[>>]')) {               // chains the next keyword to the previous one [727.1.b.3]
      rest = rest.slice(4);
      continue;
    }
    if (rest.startsWith(',') && KW_TOKEN.test(rest.slice(1).trimStart())) {   // "[Assault 2], [Shield 2]"
      rest = rest.slice(1);
      continue;
    }
    const m = KW_TOKEN.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    const k: OracleKeyword = { kw: KEYWORDS[m[1]] };
    if (m[2] !== undefined) k.value = Number(m[2]);
    else if (VALUE_DEFAULTS_TO_1.has(k.kw)) k.value = 1;
    if (COSTED.has(k.kw) && /^\s*[^\s[—]/.test(rest) && out.keywords.length === 0) {
      return null;                              // the keyword as a noun: "[Empower] costs of your units …"
    }
    const costText = COSTED.has(k.kw) ? rest.replace(/^\s*—\s*/, '').trim() : '';
    if (costText !== '') {
      // The cost runs to the end of its sentence; what follows modifies it
      // ("This ability costs [1] less for each rune you control."). " / "
      // separates Repeat costs, each paid on its own [820]; " or " separates
      // alternatives [204.1.b].
      const [, cost, after] = /^(.*?)(?:\.\s+(?=[A-Z])(.*)|\.?)$/.exec(costText)!;
      for (const each of cost.split(/\s+\/\s+/)) {
        out.keywords.push({ ...k, costs: each.split(/\s+or\s+/).map((alt) => parseCost(alt, c)) });
      }
      if (after) out.body = after;
      rest = '';
      break;
    }
    if (k.kw === 'showOff') {
      k.arg = rest.trim().replace(/\.$/, '');
      out.keywords.push(k);
      rest = '';
      break;
    }
    out.keywords.push(k);
    if (rest.startsWith('[>]') || rest.startsWith('[>>]')) {
      k.joined = true;
      if (rest.startsWith('[>]')) rest = rest.slice(3);
      const next = rest.trimStart();
      if (!next.startsWith('[>>]') && !KW_TOKEN.test(next)) {
        out.body = next.trim();
        rest = '';
        break;
      }
    }
  }
  rest = rest.trim();
  if (rest !== '' && rest !== '.') {
    out.body = rest;
    note(`keyword line with text after it but no [>]: "${line.slice(0, 60)}"`);
  }
  return out;
}

/** Deck-building rules in a card's own text: Unique [825], "any number of
    cards named …" (Spiderling), Neeko's extra legends [103.1]. */
export function deckRules(name: string, rules: string, keywords: KeywordLine[]): DeckRule[] {
  const out: DeckRule[] = [];
  if (keywords.some((l) => l.keywords.some((k) => k.kw === 'unique'))) out.push('unique');
  const any = /Your deck can have any number of cards named ([^.]+)\./.exec(rules);
  if (any && any[1] === name) out.push('anyNumber');
  const legends = /choose (?:up to )?(\d+) different legends in addition to your starting legend/i.exec(rules);
  if (legends) out.push({ extraLegends: Number(legends[1]) });
  return out;
}

// ---- overrides ----

function applyRow(row: OverrideRow, card: OracleCard): boolean {
  switch (row.kind) {
    case 'text': {
      if (!card.text.includes(row.find)) return false;
      card.text = card.text.replace(row.find, row.replace);
      return true;
    }
    case 'types': {
      const missing = row.add.filter((t) => !card.types.includes(t));
      if (missing.length === 0) return false;
      card.types.push(...missing);
      return true;
    }
    case 'bracket': {
      const lineStart = new RegExp(`^${row.keyword}(?=[ (]|$)`, 'm');
      if (!lineStart.test(card.text)) return false;
      card.text = card.text.replace(lineStart, `[${row.keyword}]`);
      return true;
    }
  }
}

// ---- the build ----

function sortKey(c: Card): [number, number, number, string] {
  const main = MAIN_SETS.indexOf(c.setId);
  const variant = VARIANTS.indexOf(c.variant);
  return [main < 0 ? 1 : 0, -main, variant < 0 ? VARIANTS.length : variant, c.id];
}

function byRank(a: Card, b: Card): number {
  const ka = sortKey(a), kb = sortKey(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
  return ka[3] < kb[3] ? -1 : ka[3] > kb[3] ? 1 : 0;
}

const isToken = (c: Card) => c.supertype === 'Token' || c.type === 'Token';

/** Comparable wording: no reminder text, no whitespace. */
const wording = (raw: string) => stripReminders(normalizeText(raw)).replace(/\s+/g, '');

/** Of printings with the same wording, the one whose text explains the
    most: reminder text, then line breaks. Earlier ones win ties. */
function mostExplained(same: Card[], text: (p: Card) => string): Card {
  const score = (p: Card) => [(text(p).match(/\(/g) ?? []).length, (text(p).match(/\n/g) ?? []).length];
  return same.reduce((best, p) => {
    const [a, b] = score(p), [x, y] = score(best);
    return a > x || (a === x && b > y) ? p : best;
  });
}

/**
 * The printing to read the text from, and whether it is errata. Errata
 * wins; the data repeats it on each printing, with or without that
 * printing's reminder text. Otherwise the top printing's wording counts,
 * shown from a printing with that wording.
 */
function textSource(ranked: Card[], problem: (msg: string) => void): { from: Card; errata: boolean } {
  const withErrata = ranked.filter((p) => p.errata);
  if (withErrata.length > 0) {
    if (new Set(withErrata.map((p) => wording(p.errata!))).size > 1) problem('printings carry different errata');
    const want = wording(withErrata[0].errata!);
    return { from: mostExplained(withErrata.filter((p) => wording(p.errata!) === want), (p) => p.errata!), errata: true };
  }
  const want = wording(ranked[0].text);
  return { from: mostExplained(ranked.filter((p) => wording(p.text) === want), (p) => p.text), errata: false };
}

/** One name's record from its printings: steps 2 and 3 (and the costs),
    before the override rows and before what is read from the final text. */
function cardOf(group: Card[], championTags: Set<string>, problems: string[], warnings: string[]): OracleCard | null {
  const ranked = [...group].sort(byRank);
  const top = ranked[0];
  const name = canonicalName(top, championTags);
  const id = slug(name);
  const say = (msg: string) => warnings.push(`${name}: ${msg}`);

  for (const f of ['type', 'supertype', 'domains', 'energy', 'power', 'might'] as const) {
    const values = new Set(group.map((p) => JSON.stringify(p[f])));
    if (values.size > 1) problems.push(`${name}: printings disagree on ${f}: ${[...values].join(' / ')}`);
  }
  const type = TYPES[top.type];
  if (!type) {
    problems.push(`${name}: unknown type '${top.type}'`);
    return null;
  }
  const domains: Domain[] = [];
  for (const d of top.domains) {
    if (d === 'Colorless') continue;
    if (DOMAINS[d]) domains.push(DOMAINS[d]);
    else problems.push(`${name}: unknown domain '${d}'`);
  }
  const supertypes: Supertype[] = [];
  if (top.supertype === 'Signature') supertypes.push('signature');
  else if (top.supertype === 'Basic') supertypes.push('basic');
  else if (top.supertype === 'Champion') {
    if (type === 'unit') supertypes.push('champion');
    else say(`'Champion' supertype on a ${type} dropped: it applies to units only [133.7.a]`);
  } else if (top.supertype) say(`unknown supertype '${top.supertype}' ignored`);

  const runeDomain = BASIC_RUNES[id];
  const { from, errata } = textSource(ranked, (msg) => problems.push(`${name}: ${msg}`));
  const card: OracleCard = {
    id, name,
    types: [type],
    supertypes,
    tags: [...top.tags],
    domains,
    text: runeDomain ? BASIC_RUNE_TEXT : normalizeText(errata ? from.errata! : from.text, say),
    rules: '',
    keywords: [],
    source: runeDomain ? 'rule' : errata ? 'errata' : 'printing',
    sets: [...new Set(ranked.map((p) => p.setId))],
    printings: [from.id, ...ranked.filter((p) => p !== from).map((p) => p.id)],
  };
  const spellings = [...new Set(ranked.map((p) => p.name))].filter((n) => n !== name);
  if (spellings.length > 0) card.printedNames = spellings;
  if (runeDomain && (type !== 'rune' || domains.join() !== runeDomain)) {
    problems.push(`${name}: expected a basic ${runeDomain} rune`);
  }

  const tag = type === 'legend' ? top.tags.find((t) => championTags.has(t)) ?? top.tags[0]
    : supertypes.includes('champion') ? top.tags.find((t) => name.startsWith(`${t}, `))
      : supertypes.includes('signature') ? top.tags.find((t) => championTags.has(t))
        : undefined;
  if (tag) card.championTag = tag;
  else if (type === 'legend' || (supertypes.length > 0 && !supertypes.includes('basic'))) {
    problems.push(`${name}: no champion tag among ${JSON.stringify(top.tags)}`);
  }

  const c = powerOf(domains);
  if (type === 'unit' || type === 'gear' || type === 'spell') {
    if (top.energy === null) say('no Energy cost in the data; 0 used');
    card.cost = { energy: top.energy ?? 0, power: Array.from({ length: top.power ?? 0 }, () => c) };
  }
  if (type === 'unit') {
    if (top.might === null) problems.push(`${name}: a unit without Might`);
    card.might = top.might ?? 0;
  }
  if (type === 'gear' && top.tags.includes('Equipment')) card.mightBonus = top.might ?? 0;

  return card;
}

export interface OracleBuild {
  file: OracleFile;
  /** Things a person should look at; none of them stops the build. */
  warnings: string[];
}

/** Builds the oracle from the text of cards.json. Throws OracleBuildError
    when the data can't be read safely or an override row is redundant. */
export function buildOracle(cardsJson: string): OracleBuild {
  const db = JSON.parse(cardsJson) as CardDb;
  const problems: string[] = [];
  const warnings: string[] = [];
  const printings = db.cards.filter((c) => !isToken(c));
  const championTags = championTagsOf(printings);

  const groups = new Map<string, Card[]>();
  for (const c of printings) {
    const key = canonicalName(c, championTags).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const cards: OracleCard[] = [];
  for (const group of groups.values()) {
    const card = cardOf(group, championTags, problems, warnings);
    if (card) cards.push(card);
  }

  // Override rows, then what is read from the final text.
  const ids = new Map(cards.map((c) => [c.id, c]));
  for (const row of OVERRIDES) {
    const card = ids.get(row.def);
    if (!card) problems.push(`override row ${row.id}: no card '${row.def}'`);
    else if (!applyRow(row, card)) problems.push(`override row ${row.id} is redundant: the data no longer needs it`);
    else card.fixes = [...(card.fixes ?? []), row.id];
  }
  for (const card of cards) {
    const say = (msg: string) => warnings.push(`${card.name}: ${msg}`);
    card.rules = stripReminders(card.text);
    const c = powerOf(card.domains);
    card.keywords = card.rules.split('\n')
      .map((l, i) => parseKeywordLine(l, i, c, say))
      .filter((l): l is KeywordLine => l !== null);
    const deck = deckRules(card.name, card.rules, card.keywords);
    if (deck.length > 0) card.deck = deck;
  }

  const seen = new Map<DefId, string>();
  for (const c of cards) {
    if (seen.has(c.id)) problems.push(`'${c.name}' and '${seen.get(c.id)}' share the id '${c.id}'`);
    seen.set(c.id, c.name);
    if ((TOKEN_IDS as string[]).includes(c.id)) problems.push(`'${c.id}' is a card id and a token id`);
  }
  if (problems.length > 0) throw new OracleBuildError(problems);
  cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < cards.length; i++) cards[i] = inFieldOrder(cards[i]);

  const file: OracleFile = {
    schema: 1,
    source: {
      file: CARDS_FILE,
      sha256: createHash('sha256').update(cardsJson).digest('hex'),
      generatedAt: db.generatedAt,
      printings: db.cards.length,
    },
    hash: hashString(stableJson(cards)),
    cards,
    tokenArt: tokenArt(db),
  };
  return { file, warnings };
}

const FIELD_ORDER: (keyof OracleCard)[] = ['id', 'name', 'printedNames', 'types', 'supertypes', 'tags', 'domains',
  'championTag', 'cost', 'might', 'mightBonus', 'text', 'rules', 'keywords', 'deck', 'source', 'fixes', 'sets',
  'printings'];

/** The same record with its fields in the order of OracleCard, so the file
    reads the same way for every card. */
function inFieldOrder(c: OracleCard): OracleCard {
  const out: Record<string, unknown> = {};
  for (const k of FIELD_ORDER) if (c[k] !== undefined) out[k] = c[k];
  return out as unknown as OracleCard;
}

/** Art for each token: its single faces (CardDb.tokenFaces), then the
    double-faced token records whose front is that token. Rules never come
    from these records [187]. */
function tokenArt(db: CardDb): Record<TokenId, string[]> {
  const front = (c: Card) => c.name.split(' // ')[0].replace(/\s+\([^()]*\)$/, '').trim();
  const records = db.cards.filter(isToken).sort(byRank);
  const art = {} as Record<TokenId, string[]>;
  for (const t of TOKEN_IDS) {
    const name = TOKENS[t].name;
    art[t] = [
      ...(db.tokenFaces ?? []).filter((f) => f.name === name).map((f) => f.id),
      ...records.filter((r) => front(r) === name).map((r) => r.id),
    ];
  }
  return art;
}

/** The oracle file as written: one card per line, so a data refresh reads
    as a reviewable diff. */
export function formatOracle(f: OracleFile): string {
  const head = (k: keyof OracleFile) => `  ${JSON.stringify(k)}: ${JSON.stringify(f[k])}`;
  return [
    '{',
    `${head('schema')},`,
    `${head('source')},`,
    `${head('hash')},`,
    `${head('tokenArt')},`,
    '  "cards": [',
    f.cards.map((c) => `    ${JSON.stringify(c)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
