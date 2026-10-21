import type { Card, CardDb } from '../../data/types.ts';
import {
  findCard, ORACLE, TOKENS, type DeckList, type DefId, type OracleCard, type TokenId,
} from '../../game/index.ts';

/*
 * From the engine's card ids to what the table shows: the oracle's name
 * and wording, and art from the app's card records. The engine names cards
 * by DefId, the slug of the canonical name [132] ('seraphine-inspiring');
 * the oracle lists each card's printings (cards.json Card ids), and tokens
 * their art (ORACLE.tokenArt). Rules text always comes from the oracle,
 * which carries Riot's errata and the override rows, never from a printing.
 */

/** Main sets, newest first: the art a table card shows comes from the
    newest main-set printing, before any promo. */
const MAIN_SETS = ['rad', 'ven', 'unl', 'sfd', 'ogs', 'ogn'];
const VARIANTS: Card['variant'][] = ['base', 'alt-art', 'overnumbered', 'signature', 'promo'];

export interface CardIndex {
  /** A printing by its Card id; single token faces (CardDb.tokenFaces)
      included. */
  byId: Record<string, Card>;
  /** Every printing of a card or token, the one to show first. */
  byDef: Record<DefId, Card[]>;
  /** The canonical name of a card or token. */
  names: Record<DefId, string>;
}

function rank(c: Card): number {
  const set = MAIN_SETS.indexOf(c.setId);
  return (set < 0 ? MAIN_SETS.length : set) * VARIANTS.length + Math.max(0, VARIANTS.indexOf(c.variant));
}

export function cardIndex(db: CardDb): CardIndex {
  const out: CardIndex = { byId: {}, byDef: {}, names: {} };
  for (const c of [...db.cards, ...(db.tokenFaces ?? [])]) out.byId[c.id] = c;
  const printings = (ids: string[]) => ids.flatMap((id) => out.byId[id] ?? []);
  for (const c of ORACLE.cards) {
    out.byDef[c.id] = printings(c.printings).sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
    out.names[c.id] = c.name;
  }
  // A token's art keeps the oracle's order: its own single faces first,
  // then the double-faced token records whose front matches.
  for (const [id, ids] of Object.entries(ORACLE.tokenArt) as [TokenId, string[]][]) {
    out.byDef[id] = printings(ids);
    out.names[id] = TOKENS[id].name;
  }
  return out;
}

/** The printing to show for an object: its own when the deck named one,
    else the card's first. */
export function cardFor(ix: CardIndex, def: DefId, printing: string | null = null): Card | null {
  return (printing !== null ? ix.byId[printing] : undefined) ?? ix.byDef[def]?.[0] ?? null;
}

/** A card's name for the log and the table; the id spelled out when the
    oracle doesn't have it. */
export function nameOf(ix: CardIndex, def: DefId): string {
  return ix.names[def] ?? def.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Runes are drawn with the rune-deck back when hidden [129.2] and sit in
    the rune row rather than with the base's permanents. */
export function isRune(def: DefId): boolean {
  return findCard(def)?.types.includes('rune') ?? false;
}

/** Riot's symbol code for each one-letter symbol of rules notation
    [134.2], [135.2.e]: what src/card/RulesText draws. */
const SYMBOL: Record<string, string> = {
  M: ':rb_might:', E: ':rb_exhaust:', A: ':rb_rune_rainbow:',
  R: ':rb_rune_fury:', G: ':rb_rune_calm:', B: ':rb_rune_mind:',
  O: ':rb_rune_body:', P: ':rb_rune_chaos:', Y: ':rb_rune_order:',
};

/**
 * A card's oracle text for display, with its symbols in the notation the
 * app's rules text draws: [2] Energy, [M] Might, [E] exhaust, [A] any Power,
 * [R]…[Y] a domain's Power, and [C] the card's own domain (any Power when it
 * has several) [135.2.e.6]. `[>>]` chains keywords [727.1.b.3]; it is drawn
 * like `[>]`. Keywords stay in brackets. Reminder text is kept.
 */
export function displayText(c: Pick<OracleCard, 'text' | 'domains'>): string {
  const own = c.domains.length === 1 ? `:rb_rune_${c.domains[0]}:` : SYMBOL.A;
  return c.text.replace(/\[(\d+|[A-Z]|>>)\]/g, (whole, s: string) => {
    if (/^\d+$/.test(s)) return `:rb_energy_${s}:`;
    if (s === '>>') return '[>]';
    if (s === 'C') return own;
    return SYMBOL[s] ?? whole;
  });
}

/** The text a card shows when zoomed, from the oracle; null for a card the
    oracle doesn't know. */
export function textOf(def: DefId): string | null {
  const c = findCard(def);
  if (c) return displayText(c);
  const token = Object.hasOwn(TOKENS, def) ? TOKENS[def as TokenId] : undefined;
  return token ? displayText({ text: token.text, domains: [] }) : null;
}

/**
 * The deck with a printing chosen for every card it names, so the objects
 * the engine creates carry their art (GameObject.printing). Printings the
 * deck already names are kept; later they come from the collection.
 */
export function withPrintings(d: DeckList, ix: CardIndex): DeckList {
  const printings: Record<DefId, string[]> = { ...d.printings };
  const defs = [d.legend, ...d.main.map((e) => e.def), ...d.runes.map((e) => e.def), ...d.battlefields];
  for (const def of defs) {
    const c = ix.byDef[def]?.[0];
    if (c && !printings[def]) printings[def] = [c.id];
  }
  return { ...d, printings };
}
