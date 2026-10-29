/*
 * Deck validation (Spec A §1.7): the deck-construction rules [101–103],
 * Unique [825], and the Tournament Rules where they apply (TR 402.1,
 * TR 601). Setup accepts only decks without errors (§5.3).
 *
 * Modes:
 *
 *   casual      the Core Rules: a Main Deck of at least 40 [103.3]
 *   sanctioned  exactly 40 (TR 601.1.b), the size built-in decks use
 *   playable    sanctioned, and every card supported by the engine (§9.1).
 *               M0 has no card definitions yet, so this check runs only
 *               when the caller passes `supported` (M1: registry.support)
 *
 * Format legality [103.3.e] uses cards/legality.ts: Standard by default,
 * or 2v2, or none at all (`format: null`, the kitchen table). An exact,
 * unmodified precon may keep banned cards at low OPL (TR 601.2.d.2); the
 * validator applies that exception and says so in a warning.
 *
 * Issues come back in a fixed order with the rule they break, so the deck
 * builder can show them and a test can name them.
 */
import { banOf, FORMATS, isReleased, SET_RELEASES, type Format } from '../cards/legality.ts';
import {
  deckLimit, findCard, isChampionUnit, isMainDeckCard, isSignature, isType, type OracleCard,
} from '../cards/oracle.ts';
import type { DefId, Domain } from '../state/types.ts';
import { deckDefs, mainCount, runeCount, type DeckEntry, type DeckList } from './decklist.ts';
import { PRECONS } from './precons.ts';
import { STARTERS } from './starters.ts';

export type DeckMode = 'casual' | 'sanctioned' | 'playable';

export type IssueCode =
  | 'unknownCard' | 'count' | 'legend' | 'mainSize' | 'mainType' | 'identity' | 'chosenChampion'
  | 'championOptions' | 'copies' | 'signatures' | 'runes' | 'battlefields' | 'extraChoices'
  | 'banned' | 'notInFormat' | 'notReleased' | 'unsupported';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  /** The rule it breaks: '103.3.b', 'TR 601.2.d'. */
  rule: string;
  message: string;
  /** The cards involved. */
  defs: DefId[];
}

export interface ValidateOptions {
  /** Default 'standard'; null checks no format. */
  format?: Format | null;
  /** Today, as 'yyyy-mm-dd': report cards from sets not yet launched
      (TR 601.2.b). Without it, launch dates are not checked. */
  asOf?: string;
  /** Organized-play level; the precon exception applies at low OPL only.
      Default 'low', which covers casual play. */
  opl?: 'low' | 'high';
  /** For 'playable': whether the engine supports a card. */
  supported?: (def: DefId) => boolean;
  /** The official lists the precon exception compares with (tests). */
  precons?: DeckList[];
}

/** Cards a deck provides of each kind [103.4.a], [103.5.a], [487.4.a]. */
export const RUNES_PER_DECK = 12;
export const BATTLEFIELDS_PER_DECK = 3;

const SIGNATURE_LIMIT = 3;                         // [103.3.d.1]

export const isLegalDeck = (issues: Issue[]) => issues.every((i) => i.severity !== 'error');

/** Checks a deck; returns its problems, errors and warnings, in a fixed
    order. An empty list means the deck is legal in that mode. */
export function validateDeck(d: DeckList, mode: DeckMode, o: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], code: IssueCode, rule: string, message: string, defs: DefId[] = []) =>
    issues.push({ code, severity, rule, message, defs });
  const error = (code: IssueCode, rule: string, message: string, defs: DefId[] = []) =>
    add('error', code, rule, message, defs);

  // ---- every entry names a card, a positive number of times ----
  for (const e of [...d.main, ...d.runes]) {
    if (!Number.isInteger(e.n) || e.n < 1) error('count', '103', `${e.n} copies of ${e.def}`, [e.def]);
  }
  const unknown = deckDefs(d).filter((def) => !findCard(def));
  if (unknown.length > 0) error('unknownCard', '103', `not cards: ${unknown.join(', ')}`, unknown);
  const known = (entries: DeckEntry[]) =>
    entries.flatMap((e) => (findCard(e.def) ? [{ card: findCard(e.def)!, n: e.n }] : []));
  const main = known(d.main);
  const runes = known(d.runes);
  const fields = d.battlefields.flatMap((def) => findCard(def) ?? []);

  // ---- the legend sets the identity and the champion tag ----
  const legend = findCard(d.legend);
  const isLegend = legend !== undefined && isType(legend, 'legend');
  if (legend && !isLegend) error('legend', '103.2', `${legend.name} is not a legend`, [d.legend]);
  const identity: Domain[] | null = isLegend ? legend.domains : null;
  const tag = isLegend ? legend.championTag : undefined;
  const outside = (c: OracleCard) => identity !== null && c.domains.some((x) => !identity.includes(x));
  const named = (cards: OracleCard[]) => cards.map((c) => c.name).join(', ');

  // ---- the Main Deck ----
  const size = mainCount(d);
  if (mode === 'casual' ? size < 40 : size !== 40) {
    error('mainSize', mode === 'casual' ? '103.3' : 'TR 601.1.b',
      `the Main Deck has ${size} cards; it needs ${mode === 'casual' ? 'at least' : 'exactly'} 40`);
  }
  const wrongType = main.filter((m) => !isMainDeckCard(m.card)).map((m) => m.card);
  if (wrongType.length > 0) {
    error('mainType', '133.4', `only units, gear and spells go in the Main Deck: ${named(wrongType)}`,
      wrongType.map((c) => c.id));
  }
  const offIdentity = main.filter((m) => outside(m.card)).map((m) => m.card);
  if (offIdentity.length > 0) {
    error('identity', '103.3.c', `outside the ${identity!.join('/')} identity: ${named(offIdentity)}`,
      offIdentity.map((c) => c.id));
  }

  // ---- the Chosen Champion and the champion options ----
  const championProblem = (def: DefId): string | null => {
    const c = findCard(def);
    if (!c) return null;                                   // reported as unknown
    if (!d.main.some((e) => e.def === def)) return `${c.name} is not in the Main Deck (TR 402.1)`;
    if (!isChampionUnit(c)) return `${c.name} is not a champion unit`;
    if (tag !== undefined && c.championTag !== tag) return `${c.name} does not have the ${tag} champion tag`;
    return null;
  };
  // an empty or unknown Chosen Champion is no champion at all (a deck still being built)
  const chosen = findCard(d.chosenChampion) ? championProblem(d.chosenChampion)
    : 'the deck has no Chosen Champion: a champion unit of its legend (TR 402.1)';
  if (chosen) error('chosenChampion', '103.3.a.2', chosen, [d.chosenChampion]);
  if (d.championOptions) {
    if (!d.championOptions.includes(d.chosenChampion)) {
      error('championOptions', '103.3.a', 'the Chosen Champion must be one of the champion options',
        [d.chosenChampion]);
    }
    for (const def of d.championOptions) {
      const problem = def === d.chosenChampion ? null : championProblem(def);
      if (problem) error('championOptions', '103.3.a.2', problem, [def]);
    }
  }

  // ---- copies of each name [103.3.b], Unique [825.3.a] ----
  const copies = new Map<DefId, { card: OracleCard; n: number }>();
  for (const m of main) {
    const seen = copies.get(m.card.id);
    copies.set(m.card.id, { card: m.card, n: (seen?.n ?? 0) + m.n });
  }
  for (const { card, n } of copies.values()) {
    const limit = deckLimit(card);
    if (n > limit) {
      error('copies', limit === 1 ? '825.3.a' : '103.3.b', `${n} copies of ${card.name}; at most ${limit}`, [card.id]);
    }
  }

  // ---- Signature cards [103.3.d] ----
  const signatures = main.filter((m) => isSignature(m.card));
  const signatureCount = signatures.reduce((n, m) => n + m.n, 0);
  if (signatureCount > SIGNATURE_LIMIT) {
    error('signatures', '103.3.d.1', `${signatureCount} Signature cards; at most ${SIGNATURE_LIMIT} in total`,
      signatures.map((m) => m.card.id));
  }
  for (const { card } of signatures) {
    if (tag !== undefined && card.championTag !== tag) {
      error('signatures', '103.3.d.2', `${card.name} is a ${card.championTag} Signature card, not a ${tag} one`,
        [card.id]);
    }
  }

  // ---- the Rune Deck [103.4] ----
  const runeTotal = runeCount(d);
  if (runeTotal !== RUNES_PER_DECK) {
    error('runes', '103.4.a', `the Rune Deck has ${runeTotal} runes; it needs ${RUNES_PER_DECK}`);
  }
  const notRunes = runes.filter((r) => !isType(r.card, 'rune')).map((r) => r.card);
  if (notRunes.length > 0) error('runes', '103.4.a', `not runes: ${named(notRunes)}`, notRunes.map((c) => c.id));
  const runesOutside = runes.filter((r) => outside(r.card)).map((r) => r.card);
  if (runesOutside.length > 0) {
    error('identity', '103.4.a.1', `runes outside the ${identity!.join('/')} identity: ${named(runesOutside)}`,
      runesOutside.map((c) => c.id));
  }

  // ---- battlefields [103.5] ----
  // A Proving Grounds starter comes with one battlefield (the box is for
  // guided play); in a Duel each player's battlefield is that one [487.5].
  const provingGrounds = d.battlefields.length === 1
    && isUnmodifiedPrecon(d, STARTERS.filter((st) => st.set === 'ogs').map((st) => st.deck));
  if (provingGrounds) {
    add('warning', 'battlefields', '487.5', 'a Proving Grounds starter: one battlefield, played in every Duel');
  } else if (d.battlefields.length !== BATTLEFIELDS_PER_DECK) {
    error('battlefields', '103.5.a',
      `${d.battlefields.length} battlefields; a Duel deck provides ${BATTLEFIELDS_PER_DECK} [487.4.a]`);
  }
  const notFields = fields.filter((c) => !isType(c, 'battlefield'));
  if (notFields.length > 0) {
    error('battlefields', '103.5', `not battlefields: ${named(notFields)}`, notFields.map((c) => c.id));
  }
  const twice = fields.filter((c, i) => fields.findIndex((x) => x.name === c.name) !== i);
  if (twice.length > 0) {
    error('battlefields', '103.5.c', `battlefields named the same: ${named(twice)}`, twice.map((c) => c.id));
  }
  const fieldsOutside = fields.filter(outside);
  if (fieldsOutside.length > 0) {
    error('identity', '103.5.b', `battlefields outside the identity: ${named(fieldsOutside)}`,
      fieldsOutside.map((c) => c.id));
  }

  // ---- deck-building choices cards ask for [103.1] ----
  const asked = new Set<DefId>();
  for (const { card } of copies.values()) {
    for (const rule of card.deck ?? []) {
      if (typeof rule !== 'object') continue;
      asked.add(card.id);
      const picks = d.extra?.[card.id] ?? [];
      const picked = picks.flatMap((def) => findCard(def) ?? []);
      if (picks.length > rule.extraLegends) {
        error('extraChoices', '103.1', `${card.name}: ${picks.length} legends chosen; up to ${rule.extraLegends}`,
          [card.id]);
      }
      const notLegends = picked.filter((c) => !isType(c, 'legend'));
      if (notLegends.length > 0) {
        error('extraChoices', '103.1', `${card.name}: not legends: ${named(notLegends)}`, notLegends.map((c) => c.id));
      }
      const names = [...(isLegend ? [legend.name] : []), ...picked.map((c) => c.name)];
      if (new Set(names).size < names.length) {
        error('extraChoices', '103.1', `${card.name}: the legends must all have different names, the deck's own `
          + 'legend included', picked.map((c) => c.id));
      }
    }
  }
  for (const key of Object.keys(d.extra ?? {})) {
    if (!asked.has(key)) add('warning', 'extraChoices', '103.1', `choices for ${key}, which the deck doesn't ask for`);
  }

  // ---- format legality [103.3.e], TR 601.2 ----
  // Neeko's extra legends are left out: the rules don't say whether they
  // must be format-legal or unbanned.
  const format = o.format === undefined ? 'standard' : o.format;
  if (format !== null) {
    const f = FORMATS[format];
    const exempt = (o.opl ?? 'low') === 'low' && isUnmodifiedPrecon(d, o.precons ?? [...PRECONS.map((p) => p.deck),
      ...STARTERS.map((st) => st.deck)]);
    const used = [d.legend, ...d.main.map((e) => e.def), ...d.runes.map((e) => e.def), ...d.battlefields]
      .filter((def, i, all) => all.indexOf(def) === i);
    for (const def of used) {
      const card = findCard(def);
      if (!card) continue;
      const ban = banOf(format, def);
      if (ban && exempt) {
        add('warning', 'banned', 'TR 601.2.d.2',
          `${card.name} is banned in ${f.name}; allowed in this unmodified precon at low OPL`, [def]);
      } else if (ban) {
        error('banned', 'TR 601.2.d', `${card.name} is banned in ${f.name} (since ${ban.since})`, [def]);
      }
      const legalSets = card.sets.filter((s) => f.sets.includes(s));
      if (legalSets.length === 0) {
        error('notInFormat', 'TR 601.2.a', `${card.name} has no printing in a ${f.name} set`, [def]);
      } else if (o.asOf && !legalSets.some((s) => isReleased(s, o.asOf!))) {
        const day = legalSets.map((s) => SET_RELEASES[s]).sort()[0];
        add(mode === 'casual' ? 'warning' : 'error', 'notReleased', 'TR 601.2.b',
          `${card.name} is legal from ${day}, when its set launches`, [def]);
      }
    }
  }

  // ---- support (§9.1) ----
  if (mode === 'playable' && o.supported) {
    const unsupported = deckDefs(d).filter((def) => findCard(def) && !o.supported!(def));
    if (unsupported.length > 0) {
      error('unsupported', '§9.1', `not playable in the engine yet: ${unsupported.join(', ')}`, unsupported);
    }
  }
  return issues;
}

/** Whether a deck is exactly one of the official precon lists: same
    legend, Main Deck, Rune Deck and battlefields (TR 601.2.d.2). Which of
    the champion options is chosen doesn't change the deck. */
export function isUnmodifiedPrecon(d: DeckList, lists: DeckList[]): boolean {
  const counts = (entries: DeckEntry[]) => {
    const out: Record<DefId, number> = {};
    for (const e of entries) out[e.def] = (out[e.def] ?? 0) + e.n;
    return out;
  };
  const same = (a: Record<DefId, number>, b: Record<DefId, number>) =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
  return lists.some((p) => p.legend === d.legend
    && same(counts(p.main), counts(d.main))
    && same(counts(p.runes), counts(d.runes))
    && [...p.battlefields].sort().join() === [...d.battlefields].sort().join()
    && Object.keys(d.extra ?? {}).length === 0);
}
