/*
 * The oracle: one record per card name, as the rules read it (§9.1). It is
 * generated from public/data/cards.json by scripts/cards/build-oracle.ts
 * (`npm run build-oracle`) into oracle.gen.json, which is committed; a test
 * fails when cards.json changes without a rebuild.
 *
 * What the build decides, so nothing else in the engine has to:
 *
 *   names     the canonical name [132]: legends carry their champion tag
 *             ("Seraphine, Starry-Eyed Songstress"), promo spellings
 *             ("Jinx - Loose Cannon (Metal)") and starter suffixes are
 *             folded in, Signature cards lose the ", Kai'Sa" the data adds.
 *             The DefId is the slug of that name.
 *   text      Riot's errata if there is one, else the newest printing's
 *             wording, then the override rows of overrides.ts. Symbols are
 *             written in rules notation (below). `rules` is the same text
 *             with reminder text removed [135.2.d.3]; card definitions
 *             implement `rules`.
 *   costs     Energy and Power [131]; Power symbols of multi-domain cards
 *             are "one of the card's domains" [135.2.e.6.c].
 *   keywords  the printed keyword lines [803], with values, costs and the
 *             ability after `[>]`.
 *
 * Symbols in oracle text, as the Core Rules write them: [N] N Energy, [M]
 * Might, [E] exhaust, [A] Power of any domain, [C] Power of this card's
 * domain, and one Power of a domain: [R] Fury, [G] Calm, [B] Mind, [O] Body,
 * [P] Chaos, [Y] Order [134.2], [135.2.e]. `[>]` separates a keyword from
 * the ability it introduces; `[>>]` chains dependent keywords [727.1.b.3].
 *
 * Tokens are not here: they are not cards [185], and their rules come from
 * [187] (tokens.ts). Their art is: `tokenArt` lists printings to show.
 */
import { EngineError } from '../core/errors.ts';
import type { CardType, DefId, Domain, KeywordId, PowerReq, TokenId } from '../state/types.ts';
import data from './oracle.gen.json';

export type Supertype = 'champion' | 'signature' | 'basic';

/** A cost in resources [131], [356]: Energy, Power symbols, and whatever
    else a keyword's cost asks for, verbatim ("Kill a friendly unit"). */
export interface OracleCost {
  energy: number;
  power: PowerReq[];
  /** [E]: exhaust this [135.2.e.2]. */
  exhaust?: true;
  other?: string[];
}

/** One printed keyword [803]. */
export interface OracleKeyword {
  kw: KeywordId;
  /** Assault 2, Shield 3, Deflect 2, Hunt 2, Disarm 2, Level 6. X defaults
      to 1 where the rules say so [807.1.b.3], [809.1.b.3], [814.1.b.3],
      [823.1.c.2], [831.1.c.3]. */
  value?: number;
  /** Equip, Empower, Flow, Repeat: the printed cost; several entries are
      alternatives ("[1] or [O]") [204.1.b]. Accelerate's cost comes from the
      rules [805.1.b] (and RulesConfig.accelerateMultiDomain), not from here. */
  costs?: OracleCost[];
  /** Show Off's filter: "a card with Energy cost [7] or more" [832]. */
  arg?: string;
  /** Joined to the line's body by `[>]` or `[>>]`: a dependent keyword
      gating it [727], or the keyword introducing it (Deathknell, a timing
      keyword on an ability). Keywords without it stand alone. */
  joined?: true;
}

/** A rules line that starts with keywords. */
export interface KeywordLine {
  /** Index into the lines of `rules`. */
  line: number;
  keywords: OracleKeyword[];
  /** The text after the keywords: the ability after the last `[>]`, or
      the sentence after a keyword's cost that changes it ("This ability
      costs [1] less for each rune you control."). */
  body?: string;
}

/** Deck-building rules a card's own text sets [103.1], [825]. */
export type DeckRule = 'unique' | 'anyNumber' | { extraLegends: number };

export interface OracleCard {
  id: DefId;
  /** Canonical name [132]: copy limits [103.3.b], naming [759–763]. */
  name: string;
  /** Other spellings of the name in cards.json, for search and debugging. */
  printedNames?: string[];
  /** The printed type first; more than one for gear units [178]. */
  types: CardType[];
  supertypes: Supertype[];
  tags: string[];
  /** [] for no domain ("Colorless" in the data) [103.2.b.5]. */
  domains: Domain[];
  /** The tag that links legends, champion units and Signature cards
      [133.8.b]. */
  championTag?: string;
  /** Main-deck cards only [131]. */
  cost?: OracleCost;
  might?: number;
  /** Equipment [137]. */
  mightBonus?: number;
  /** Oracle text in rules notation, reminder text kept, for display. */
  text: string;
  /** `text` without reminder text [135.2.d.3]: what definitions implement. */
  rules: string;
  keywords: KeywordLine[];
  deck?: DeckRule[];
  /** Where the wording comes from: Riot's errata, a printing, or the rules
      (basic runes [164.2]). */
  source: 'errata' | 'printing' | 'rule';
  /** Override rows (overrides.ts) applied to this card. */
  fixes?: string[];
  /** Sets with a printing of this name, newest first (legality, TR 601.2.a). */
  sets: string[];
  /** Card ids, the one the text was read from first. */
  printings: string[];
}

export interface OracleFile {
  schema: 1;
  /** The cards.json it was built from; a test compares the hash. */
  source: { file: string; sha256: string; generatedAt: string; printings: number };
  /** Hash of `cards` (16 hex digits), for GameState.defsHash. */
  hash: string;
  /** Sorted by id. */
  cards: OracleCard[];
  /** Printings to show for each token: its single faces first, then
      double-faced token records whose front matches. */
  tokenArt: Record<TokenId, string[]>;
}

export const ORACLE: OracleFile = data as unknown as OracleFile;

const byId: Record<DefId, OracleCard> = {};
const byPrinting: Record<string, DefId> = {};
for (const c of ORACLE.cards) {
  byId[c.id] = c;
  for (const p of c.printings) byPrinting[p] = c.id;
}

/** Every tag a card prints, sorted: what "name a tag" may name. */
export const ALL_TAGS: readonly string[] = [...new Set(ORACLE.cards.flatMap((c) => c.tags ?? []))].sort();

/** The oracle record of a card, or undefined for an unknown id. */
export function findCard(def: DefId): OracleCard | undefined {
  return Object.hasOwn(byId, def) ? byId[def] : undefined;
}

/** The oracle record of a card; throws for an unknown id. */
export function oracleCard(def: DefId): OracleCard {
  const c = findCard(def);
  if (!c) throw new EngineError(`'${def}' is not a card in the oracle`);
  return c;
}

/** The card a printing (cards.json Card.id) is a printing of. */
export function defOfPrinting(cardId: string): DefId | undefined {
  return Object.hasOwn(byPrinting, cardId) ? byPrinting[cardId] : undefined;
}

export const isType = (c: OracleCard, t: CardType) => c.types.includes(t);

/** Units, gear and spells: what a Main Deck may hold [133.4]. */
export const isMainDeckCard = (c: OracleCard) => c.types.some((t) => t === 'unit' || t === 'gear' || t === 'spell');

/** A champion unit [133.7.a]: a Chosen Champion candidate [103.3.a.2]. */
export const isChampionUnit = (c: OracleCard) => isType(c, 'unit') && c.supertypes.includes('champion');

export const isSignature = (c: OracleCard) => c.supertypes.includes('signature');

/** Copies of one name a deck may hold: 3 [103.3.b], 1 for Unique
    [825.3.a], no limit when the card says so (Spiderling). */
export function deckLimit(c: OracleCard): number {
  if (c.deck?.includes('anyNumber')) return Infinity;
  return c.deck?.includes('unique') ? 1 : 3;
}

/** The printed keywords of a card, in printed order [803]. */
export const printedKeywords = (c: OracleCard): OracleKeyword[] => c.keywords.flatMap((l) => l.keywords);
