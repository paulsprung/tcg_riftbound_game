/*
 * Limited play (Tournament Rules 602), shared by the app and the server:
 * the pools, the draft, building and checking a deck.
 *
 *   Sealed  6 boosters each; a Main Deck of at least 25 (602.4.a)
 *   Draft   3 boosters each, a pod of 8: pick one, pass the rest, left,
 *           right, left; 39 cards each; a Main Deck of at least 20 (602.4.b)
 *
 * Both: any three domains (or a Champion Legend's two and one more), any
 * champion unit of those as Chosen Champion, Signature cards that fit the
 * domains, no copy limit and no Unique, a deck may run without a Legend
 * (and draws 1 more when it has neither Legend nor Chosen Champion, which
 * the engine does: GameSetup.limited), basic runes from any source within
 * the domains, battlefields from the pool or blanks (602.1.a.2, 602.3.d).
 *
 * A pool is a list of printings (cards.json Card ids); the runes and the
 * token each booster holds are set aside (602.4.b.2.a).
 */
import type { Card, CardDb } from '../data/types.ts';
import { defOfPrinting, findCard, isChampionUnit, isMainDeckCard, isType, type OracleCard } from '../game/cards/oracle.ts';
import type { DeckEntry, DeckList } from '../game/decks/decklist.ts';
import type { DefId, Domain } from '../game/state/types.ts';
import { isRune, isToken, openPack } from '../pack/generate.ts';
import { boosterSet } from '../pack/packConfig.ts';

export type LimitedFormat = 'sealed' | 'draft';
export const PACKS: Record<LimitedFormat, number> = { sealed: 6, draft: 3 };
export const MIN_DECK: Record<LimitedFormat, number> = { sealed: 25, draft: 20 };
export const POD = 8;
export const MAX_DOMAINS = 3;
export const RUNES = 12;
export const BATTLEFIELDS = 3;
export const BLANK_BATTLEFIELD = 'blank-battlefield';
const BASIC_RUNE: Record<Domain, DefId> = {
  fury: 'fury-rune', calm: 'calm-rune', mind: 'mind-rune', body: 'body-rune', chaos: 'chaos-rune', order: 'order-rune',
};

/** One booster without its runes and token: what Limited plays with. */
export function boosterFor(db: CardDb, setId: string, random: () => number): string[] {
  const set = boosterSet(setId);
  if (!set) throw new Error(`no boosters of '${setId}'`);
  const cards = db.cards.filter((c) => c.setId === setId);
  return openPack(cards, set.pack, random).filter((p) => !isRune(p.card) && !isToken(p.card)).map((p) => p.card.id);
}

/** A Sealed pool: six boosters, opened. */
export function sealedPool(db: CardDb, setId: string, random: () => number): string[] {
  return Array.from({ length: PACKS.sealed }, () => boosterFor(db, setId, random)).flat();
}

// ---- the draft ----

/** A draft pod as it stands: the pack in front of each seat, each seat's picks. */
export interface Draft {
  setId: string;
  /** 0, 1, 2: the booster being drafted. */
  round: number;
  /** Per seat: the pack it picks from now. */
  packs: string[][];
  /** Per seat: the boosters still sealed. */
  sealed: string[][][];
  picks: string[][];
  /** Seats that picked from the pack in front of them this turn. */
  picked: boolean[];
}

export function newDraft(db: CardDb, setId: string, random: () => number, seats = POD): Draft {
  const boosters = Array.from({ length: seats }, () => Array.from({ length: PACKS.draft }, () => boosterFor(db, setId, random)));
  return {
    setId, round: 0, packs: boosters.map((b) => b[0]), sealed: boosters.map((b) => b.slice(1)),
    picks: boosters.map(() => []), picked: boosters.map(() => false),
  };
}

export const draftDone = (d: Draft) => d.round >= PACKS.draft;

/** A seat takes a card from the pack in front of it; once every seat has, the packs pass
    (left in the first and third booster, right in the second, 602.4.b.2), and an empty
    round opens the next booster. Returns a new draft; the old one is untouched. */
export function pick(d: Draft, seat: number, card: string): Draft {
  if (draftDone(d)) throw new Error('The draft is over.');
  if (d.picked[seat]) throw new Error('You picked from this pack already.');
  const at = d.packs[seat].indexOf(card);
  if (at < 0) throw new Error('That card is not in the pack.');
  const next: Draft = {
    ...d, packs: d.packs.map((p, i) => (i === seat ? [...p.slice(0, at), ...p.slice(at + 1)] : p)),
    picks: d.picks.map((p, i) => (i === seat ? [...p, card] : p)), picked: d.picked.map((x, i) => x || i === seat),
  };
  if (!next.picked.every(Boolean)) return next;
  const n = next.packs.length;
  const step = next.round === 1 ? -1 : 1;
  // seat i passes to seat i + step: the pack in front of seat i now comes from seat i - step
  let packs = next.packs.map((_, i) => next.packs[(i - step + n) % n]);
  let { round, sealed } = next;
  if (packs.every((p) => p.length === 0)) {
    round += 1;
    if (round < PACKS.draft) { packs = sealed.map((s) => s[0]); sealed = sealed.map((s) => s.slice(1)); }
  }
  return { ...next, packs, sealed, round, picked: next.picked.map(() => false) };
}

const RARITY: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, showcase: 4, ultimate: 5, promo: 2 };
const cardOfPrinting = (cards: Map<string, Card>, id: string) => cards.get(id);
const oracleOf = (id: string): OracleCard | undefined => { const def = defOfPrinting(id); return def ? findCard(def) : undefined; };

/** A computer seat's pick: the strongest card, leaning to the domains it has picked most. */
export function botPick(cards: Map<string, Card>, pack: string[], picks: string[]): string {
  const lean = new Map<Domain, number>();
  for (const id of picks) for (const d of oracleOf(id)?.domains ?? []) lean.set(d, (lean.get(d) ?? 0) + 1);
  const top = [...lean.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d);
  const score = (id: string) => {
    const c = cardOfPrinting(cards, id), o = oracleOf(id);
    let s = RARITY[c?.rarity ?? 'common'] ?? 1;
    if (o && isChampionUnit(o)) s += 1.5;
    if (o && isType(o, 'legend')) s += 1;
    if (picks.length >= 6 && o && o.domains.length > 0) s += o.domains.every((d) => top.includes(d)) ? 1.5 : -1;
    return s;
  };
  return [...pack].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}

// ---- building and checking a deck ----

/** How many copies of each card a pool holds. */
export function poolDefs(pool: string[]): Map<DefId, number> {
  const out = new Map<DefId, number>();
  for (const id of pool) { const def = defOfPrinting(id); if (def) out.set(def, (out.get(def) ?? 0) + 1); }
  return out;
}

export interface LimitedIssue { message: string; rule: string }

/** What keeps a deck from being a legal Limited deck from this pool (TR 602). */
export function limitedIssues(d: DeckList, pool: string[], format: LimitedFormat): LimitedIssue[] {
  const out: LimitedIssue[] = [];
  const add = (rule: string, message: string) => out.push({ rule, message });
  const have = poolDefs(pool);
  const domains = d.domains ?? [];
  const legend = d.legend ? findCard(d.legend) : undefined;
  if (domains.length === 0 || domains.length > MAX_DOMAINS) add('602.4.a.3', `Pick one to ${MAX_DOMAINS} domains.`);
  // a Champion Legend's two domains count toward the three
  if (d.legend) {
    if (!legend || !isType(legend, 'legend')) add('103.2', 'The Legend is not a legend.');
    else if ((have.get(d.legend) ?? 0) < 1) add('602.1.a.1', `${legend.name} is not in your pool.`);
    else if (legend.domains.some((x) => !domains.includes(x))) add('602.4.a.3', `${legend.name} needs ${legend.domains.join(' and ')}.`);
  }
  const used = new Map<DefId, number>();
  for (const e of d.main) used.set(e.def, (used.get(e.def) ?? 0) + e.n);
  for (const [def, n] of used) {
    const c = findCard(def);
    if (!c || !isMainDeckCard(c)) { add('133.4', `${c?.name ?? def} can't go in the Main Deck.`); continue; }
    if (n > (have.get(def) ?? 0)) add('602.1.a.1', `${c.name}: ${n} in the deck, ${have.get(def) ?? 0} in your pool.`);
    if (c.domains.some((x) => !domains.includes(x))) add('602.4.a.3', `${c.name} is outside your domains.`);
  }
  const size = d.main.reduce((t, e) => t + e.n, 0);
  if (size < MIN_DECK[format]) add(format === 'sealed' ? '602.4.a.2' : '602.4.b.3', `${size} cards in the Main Deck, at least ${MIN_DECK[format]}.`);
  if (d.chosenChampion) {
    const c = findCard(d.chosenChampion);
    if (!c || !isChampionUnit(c)) add('602.4.a.3.a', 'The Chosen Champion is not a champion unit.');
    else if (!used.has(d.chosenChampion)) add('103.3.a', `${c.name} is not in the Main Deck.`);
  }
  const runes = d.runes.reduce((t, e) => t + e.n, 0);
  if (runes !== RUNES) add('103.4.a', `${runes} runes, ${RUNES} needed.`);
  for (const e of d.runes) {
    const r = findCard(e.def);
    if (!r || !isType(r, 'rune') || !Object.values(BASIC_RUNE).includes(e.def)) add('602.1.a.2', `${r?.name ?? e.def} is not a basic rune.`);
    else if (r.domains.some((x) => !domains.includes(x))) add('602.4.a.3', `${r.name} is outside your domains.`);
  }
  if (d.battlefields.length !== BATTLEFIELDS) add('602.3.e', `${d.battlefields.length} battlefields, ${BATTLEFIELDS} needed.`);
  const fields = new Map<DefId, number>();
  for (const b of d.battlefields) if (b !== BLANK_BATTLEFIELD) fields.set(b, (fields.get(b) ?? 0) + 1);
  for (const [def, n] of fields) {
    const c = findCard(def);
    if (!c || !isType(c, 'battlefield')) add('103.5', `${c?.name ?? def} is not a battlefield.`);
    else if (n > 1) add('103.5.c', `${c.name} twice: battlefields need different names (blanks may repeat).`);
    else if ((have.get(def) ?? 0) < 1) add('602.3.d', `${c.name} is not in your pool.`);
  }
  return out;
}

/** Twelve basic runes shared out over the domains, the first ones taking any rest. */
export function runesFor(domains: Domain[]): DeckEntry[] {
  if (domains.length === 0) return [];
  return domains.map((dom, i) => ({ def: BASIC_RUNE[dom], n: Math.floor(RUNES / domains.length) + (i < RUNES % domains.length ? 1 : 0) }));
}

/** A first deck from a pool: its two deepest domains (three when that is the only way to the
    minimum), its best cards in them, a Legend and Chosen Champion when it has them, the
    battlefields it opened and blanks for the rest. A start to change, always legal. */
export function autoBuild(pool: string[], format: LimitedFormat, cards: Map<string, Card>): DeckList {
  const have = poolDefs(pool);
  const main = [...have.entries()].flatMap(([def, n]) => {
    const c = findCard(def);
    return c && isMainDeckCard(c) ? [{ def, n, c, rank: Math.max(...pool.filter((id) => defOfPrinting(id) === def).map((id) => RARITY[cards.get(id)?.rarity ?? 'common'] ?? 1)) }] : [];
  });
  const depth = new Map<Domain, number>();
  for (const m of main) for (const d of m.c.domains) depth.set(d, (depth.get(d) ?? 0) + m.n);
  const order = [...depth.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  const fits = (doms: Domain[]) => main.filter((m) => m.c.domains.every((d) => doms.includes(d)));
  const count = (rows: { n: number }[]) => rows.reduce((t, r) => t + r.n, 0);
  let domains = order.slice(0, 2);
  if (count(fits(domains)) < MIN_DECK[format]) domains = order.slice(0, 3);
  // the best cards first, to the minimum and a few more
  const rows = fits(domains).sort((a, b) => b.rank - a.rank || (a.c.cost?.energy ?? 0) - (b.c.cost?.energy ?? 0));
  const target = MIN_DECK[format] + 3;
  const deck: DeckEntry[] = [];
  let size = 0;
  for (const r of rows) {
    if (size >= target) break;
    const n = Math.min(r.n, target - size);
    deck.push({ def: r.def, n });
    size += n;
  }
  const legends = [...have.keys()].map((d) => findCard(d)).filter((c): c is OracleCard => !!c && isType(c, 'legend') && c.domains.every((x) => domains.includes(x)));
  const champion = deck.map((e) => findCard(e.def)).find((c) => c && isChampionUnit(c));
  // battlefields of different names (103.5.c), blanks for the rest
  const fields = [...have.keys()].filter((def) => { const c = findCard(def); return c && isType(c, 'battlefield'); });
  const battlefields = [...fields.slice(0, BATTLEFIELDS)];
  while (battlefields.length < BATTLEFIELDS) battlefields.push(BLANK_BATTLEFIELD);
  // each card shows as the printing the pool holds
  const printings: Record<DefId, string[]> = {};
  for (const id of pool) { const def = defOfPrinting(id); if (def) (printings[def] ??= []).push(id); }
  return {
    name: `${format === 'sealed' ? 'Sealed' : 'Draft'} deck`, source: 'custom', legend: legends[0]?.id ?? '',
    chosenChampion: champion?.id ?? '', domains, main: deck, runes: runesFor(domains), battlefields, printings,
  };
}
