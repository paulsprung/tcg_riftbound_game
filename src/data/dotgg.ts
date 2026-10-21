import type { Card } from './types.ts';
import { plainText } from './normalize.ts';

/*
 * riftbound.gg's card API (api.dotgg.gg, "dotgg") as a third source. It is
 * used only to repair our data, never to add printings:
 *
 *  - fill what Riot's gallery leaves empty: supertype (Champion, Signature,
 *    Basic, Token), tags, type and domains; Radiance has none of them yet;
 *  - for Radiance, where the gallery's types, domains and tags are wrong on
 *    many cards (checked against the printed cards), take dotgg's;
 *  - complete stats and texts our sources lost (Equipment might, effect
 *    text cut off after the Equip line), and region tags that alt arts drop;
 *  - carry Riot's errata, the current official wording, next to the
 *    printed text;
 *  - show banned cards without the "BANNED" stamp Riot prints on their
 *    gallery images (dotgg's scans are clean).
 *
 * Matching is by name within the card's home set (dotgg writes "Name - Title"
 * where we write "Name, Title"; our legends carry only the title), then by
 * collector code. The full rule and its validation against every card is in
 * the research notes; tests/dotgg.test.ts pins the cases that matter.
 */

export interface DotggRow {
  id: string;
  name: string;
  name_normal?: string | null;
  effect?: string | null;
  errata?: string | null;
  color?: string[] | null;
  cost?: string | null;
  power?: string | null;
  type?: string[] | null;
  supertype?: string | null;
  might?: string | null;
  mightBonus?: string | null;
  tags?: string[] | null;
  set_name?: string | null;
  promo?: string | null;
  banned?: string | null;
  image?: string | null;
}

/** The API answers {names, data: rows of values}; zip them into objects. */
export function zipDotgg(raw: { names: string[]; data: unknown[][] }): DotggRow[] {
  return raw.data.map((r) => Object.fromEntries(raw.names.map((n, i) => [n, r[i]])) as unknown as DotggRow);
}

const PREFIX_SET: Record<string, string> = {
  OGN: 'ogn', SFD: 'sfd', UNL: 'unl', VEN: 'ven', RAD: 'rad', OGS: 'ogs', SGN: 'sgn', T1A: 't1', T1S: 't1',
};
/** Printed collector total -> the retail set a promo reprints. */
const DENOM_SET: Record<string, string> = { 298: 'ogn', 221: 'sfd', 219: 'unl', 166: 'ven', 167: 'rad', '024': 'ogs' };
const PROMO_SETS = new Set(['opp', 'pr', 'jdg']);
const pad3 = (n: string) => String(Number(n)).padStart(3, '0');

/** Only English printings (dotgg also lists Chinese ones). */
const isEnglish = (r: DotggRow) =>
  !/^ARC-/i.test(r.id) && r.set_name !== 'Arcane Box Set' && !/\b(chin(a|ese)|korea(n)?)\b/i.test(r.name);

/* ---------------------------------------------------------------- names -- */

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[‘’‚‛′`´]/g, "'")
  .replace(/[“”„″]/g, '"')
  .replace(/[‐-―−]/g, '-');

function stripParen(s: string): string {
  let prev;
  do { prev = s; s = s.replace(/\s*\([^()]*\)\s*$/, ''); } while (prev !== s);
  return s;
}

/** "Akali, Brash" and "Akali - Brash" -> ["akali", "brash"]. Only a spaced
    hyphen or a comma separates ("Starry-Eyed" stays whole); a trailing
    "Starter" (Proving Grounds legends) is dropped. */
export function nameParts(name: string): string[] {
  const parts = stripParen(fold(name)).toLowerCase().split(/\s+-\s+|\s*,\s+/)
    .map((p) => p.replace(/[^a-z0-9/]/g, '')).filter(Boolean);
  return parts.length > 1 && parts[parts.length - 1] === 'starter' ? parts.slice(0, -1) : parts;
}
const nameKey = (n: string) => nameParts(n).join('|');
const titleKey = (n: string) => { const p = nameParts(n); return p.length > 1 ? p.slice(1).join('|') : null; };
const frontFace = (n: string) => stripParen(fold(n)).toLowerCase().split('//')[0].replace(/[^a-z0-9]/g, '');

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}

/* ----------------------------------------------------------------- keys -- */

interface Row extends DotggRow {
  set: string; print: string; base: string; isPromo: boolean; isAlt: boolean;
  nk: string; tk: string | null; ff: string; legend: boolean; token: boolean;
}

function rowKeys(r: DotggRow): Row | null {
  const m = /^([A-Z0-9]+)-([A-Z]*)(\d+)([a-zA-Z]?)(?:\/\d+)?(-STAR)?(-.+)?$/.exec(r.id);
  const set = m && PREFIX_SET[m[1]];
  if (!m || !set) return null;
  const base = `${set.toUpperCase()}-${m[2].toUpperCase()}${pad3(m[3])}`;
  const print = base + m[4].toLowerCase() + (m[5] ? '*' : '');
  return {
    ...r, set, base, print, isPromo: m[6] != null || r.promo === '1', isAlt: print !== base,
    nk: nameKey(r.name), tk: titleKey(r.name), ff: frontFace(r.name),
    legend: (r.type ?? []).includes('Legend'), token: r.supertype === 'Token',
  };
}

function cardKeys(c: Card) {
  const m = /^([A-Z0-9]+)-([A-Z]*)(\d+)([a-z]*)(\*?)(?:\/(\d+))?$/i.exec(c.code.replace(/\s+/g, ''));
  if (!m) return null;
  const set = PROMO_SETS.has(c.setId) ? DENOM_SET[m[6] ?? ''] : c.setId;
  if (!set) return null;
  const base = `${set.toUpperCase()}-${m[2].toUpperCase()}${pad3(m[3])}`;
  return { set, base, print: base + m[4].toLowerCase() + m[5] };
}

/* --------------------------------------------------------------- values -- */

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const types = (r: DotggRow) => (r.type ?? []).filter(Boolean);
const cost = (r: Row) => { const v = num(r.cost); return v === 0 && r.token ? null : v; };
// Equipment print a might bonus; dotgg keeps it in mightBonus, we in might.
const might = (r: Row) => num(r.might) ?? (types(r).includes('Gear') ? num(r.mightBonus) : null);
// dotgg writes "0" for "no power cost"; no card prints a 0.
const power = (r: Row) => { const v = num(r.power); return v === 0 ? null : v; };

/** dotgg's HTML to our text: our symbol codes stay, markdown residue goes. */
function toText(html: string, gear: boolean): string {
  let t = html.replace(/\[NO TEXT\]/i, '');
  // the Equipment bonus ("+2 :rb_might:" opening a line); we keep it in might
  if (gear) t = t.replace(/(^|<br\s*\/?>|\n)\s*\+\d+\s*:rb_might:\s*/gi, '$1');
  t = t.replace(/<\/?(em|i|b|strong)\b[^>]*>/gi, '').replace(/<li\b[^>]*>/gi, '\n').replace(/<\/?(ul|ol|li)\b[^>]*>/gi, '');
  return plainText(t).replace(/\]_/g, ']').replace(/_\(/g, '(').replace(/\)_/g, ')').replace(/\n{2,}/g, '\n').trim();
}

/** Text compared without markup, quotes, spacing or case. */
function textKey(t: string, gear: boolean, loose = false): string {
  let s = toText(t, gear);
  s = fold(s).replace(/…/g, '...').toLowerCase()
    .replace(/:rb_([a-z0-9_]+):/g, (_, x: string) => `{${x.replace(/_/g, '-')}}`)
    .replace(/[_*]/g, '').replace(/\s+/g, '');
  if (loose) s = s.replace(/\([^()]*\)/g, '').replace(/[^a-z0-9{}>-]/g, '');
  return s;
}

/* ------------------------------------------------------------- matching -- */

function index(rows: Row[]) {
  const by = new Map<string, Row[]>();
  const add = (k: string, r: Row) => { const l = by.get(k); if (l) l.push(r); else by.set(k, [r]); };
  for (const r of rows) {
    add(`name|${r.set}|${r.nk}`, r);
    add(`print|${r.set}|${r.print}`, r);
    if (r.legend && r.tk) add(`title|${r.set}|${r.tk}`, r);
    if (r.token) add(`face|${r.set}|${r.ff}`, r);
  }
  return (k: string) => by.get(k) ?? [];
}

function compatible(c: Card, r: Row): boolean {
  const a = nameParts(c.name), b = nameParts(r.name);
  const sub = (x: string[], y: string[]) => x.every((p) => y.includes(p));
  return sub(a, b) || sub(b, a) || a[0] === b[0] || editDistance(a.join('|'), b.join('|')) <= 2;
}

const IDENTITY: ((r: Row) => unknown)[] = [
  (r) => types(r).join('/') || null,
  (r) => [...(r.color ?? [])].sort().join('/') || null,
  cost, might, power,
];
const conflicting = (rows: Row[]) =>
  IDENTITY.some((f) => new Set(rows.map(f).filter((v) => v != null)).size > 1);

/** The dotgg rows that are this card, best first; empty when none. */
function match(c: Card, look: (k: string) => Row[]): Row[] {
  const k = cardKeys(c);
  const home = k?.set ?? c.setId;
  const nk = nameKey(c.name);
  const tokenish = c.supertype === 'Token' || /^[A-Z]+-T\d/.test(c.code);
  let cands: Row[] = [];
  // tokens: dotgg numbers double-sided printings itself, so match our
  // single face to a front face, never by code
  if (tokenish) cands = look(`face|${home}|${nk.replace(/[^a-z0-9]/g, '')}`);
  if (!cands.length) cands = look(`name|${home}|${nk}`);
  if (!cands.length && (c.type === 'Legend' || c.type === '')) cands = look(`title|${home}|${nk}`);
  if (!cands.length && k) {
    const hits = look(`print|${home}|${k.print}`).filter((r) => compatible(c, r));
    if (hits.length) cands = [...new Set([...hits, ...look(`name|${home}|${hits[0].nk}`)])];
  }
  if (!cands.length) return [];
  if (k && conflicting(cands)) {
    // same name, different card: narrow by collector number, then printing
    const byBase = cands.filter((r) => r.base === k.base);
    cands = byBase.length ? byBase : cands;
    const byPrint = cands.filter((r) => r.print === k.print);
    cands = byPrint.length ? byPrint : cands;
  }
  const promo = PROMO_SETS.has(c.setId);
  const rankOf = (r: Row) => [
    +(r.print !== k?.print), +(r.base !== k?.base), +(r.isPromo !== promo), +r.isPromo, +r.isAlt,
  ];
  return [...cands].sort((a, b) => {
    const x = rankOf(a), y = rankOf(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.id.localeCompare(b.id);
  });
}

/* ------------------------------------------------------------- applying -- */

const firstOf = <T>(rows: Row[], f: (r: Row) => T | null | undefined): T | null => {
  for (const r of rows) { const v = f(r); if (v != null && v !== '') return v; }
  return null;
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const subset = (a: string[], b: string[]) => a.length < b.length && a.every((x) => b.includes(x));
const champion = (c: Card) => stripParen(c.name.split(/,\s| - /)[0]).trim();

export interface EnrichStats { matched: number; changed: Record<string, number> }

/** Repairs `cards` in place from dotgg rows (see the top of this file). */
export function enrichFromDotgg(cards: Card[], raw: DotggRow[]): EnrichStats {
  const rows = raw.filter(isEnglish).map(rowKeys).filter((r): r is Row => !!r);
  const look = index(rows);
  const stats: EnrichStats = { matched: 0, changed: {} };
  const changed = (field: string) => { stats.changed[field] = (stats.changed[field] ?? 0) + 1; };

  for (const c of cards) {
    const cands = match(c, look);
    if (!cands.length) continue;
    stats.matched++;
    const best = cands[0];
    const rad = c.setId === 'rad' || cardKeys(c)?.set === 'rad';
    const dType = firstOf(cands, (r) => types(r)[0]);
    const dSuper = firstOf(cands, (r) => r.supertype || null);
    // alt-art rows often drop the region tag: take the fullest list
    const dTags = cands.reduce<string[]>((best, r) => ((r.tags?.length ?? 0) > best.length ? [...r.tags!] : best), []);
    const dDomains = firstOf(cands, (r) => (r.color?.length ? [...r.color] : null)) ?? [];

    if (dType && (!c.type || (rad && c.type !== dType && !(c.type === 'Token' && best.token)))) {
      c.type = dType; changed('type');
    }
    if (c.supertype === null && dSuper) {
      // only where the rules allow it: Champion is a unit supertype (CR 133.7.a)
      const ok = dSuper === 'Champion' ? c.type === 'Unit' && dType === 'Unit'
        : dSuper === 'Basic' ? c.type === 'Rune'
          : dSuper === 'Token' ? /^[A-Z]+-T\d/.test(c.code)
            : dSuper === 'Signature';
      if (ok) { c.supertype = dSuper; changed('supertype'); }
    }
    if (dTags.length && (
      !c.tags.length || subset(c.tags, dTags) || (rad && !sameSet(c.tags, dTags)) ||
      (c.supertype === 'Champion' && !c.tags.includes(champion(c)) && dTags.includes(champion(c)))
    )) { c.tags = dTags; changed('tags'); }
    // Riot tags Radiance gear "Device", which the cards do not print
    if (rad && !dTags.length && c.type === 'Gear' && sameSet(c.tags, ['Device'])) { c.tags = []; changed('tags'); }
    if (dDomains.length && (!c.domains.length || (rad && !sameSet(c.domains, dDomains)))) {
      c.domains = dDomains; changed('domains');
    }

    // stats of what is played from hand (legends, battlefields, runes and
    // tokens have none to repair)
    if (['Unit', 'Spell', 'Gear'].includes(c.type) && c.supertype !== 'Token') {
      const dEnergy = firstOf(cands, cost), dMight = firstOf(cands, might), dPower = firstOf(cands, power);
      if (dEnergy != null && c.energy !== dEnergy) { c.energy = dEnergy; changed('energy'); }
      if (dMight != null && c.might !== dMight) { c.might = dMight; changed('might'); }
      if (dPower != null && c.power !== dPower) { c.power = dPower; changed('power'); }
    }

    const gear = c.type === 'Gear';
    const effect = best.effect ?? '';
    if (effect && !best.token) {
      const ours = textKey(c.text, gear), theirs = textKey(effect, gear);
      const oursL = textKey(c.text, gear, true), theirsL = textKey(effect, gear, true);
      const cutOff = theirs.length > ours.length && (!ours || theirs.startsWith(ours) || theirsL.startsWith(oursL));
      // a few stray letters after the end (Riot's RAD-127 ends in "disa")
      const stray = ours.startsWith(theirs) && ours.length - theirs.length <= 6;
      if (ours !== theirs && (cutOff || stray)) {
        c.text = toText(effect, gear); changed('text');
      }
    }
    if (best.banned === '1' && best.image && best.print === cardKeys(c)?.print && /rgpub\.io/.test(c.image)) {
      c.image = best.image; changed('banned-image');
    }
    if (best.errata) {
      const errata = toText(best.errata, gear);
      if (textKey(errata, gear) !== textKey(c.text, gear)) { c.errata = errata; changed('errata'); }
    }
  }

  // Champion is a unit supertype only; Riftcodex puts it on some legends.
  for (const c of cards) {
    if (c.supertype === 'Champion' && c.type !== 'Unit') { c.supertype = null; changed('champion-cleanup'); }
  }
  return stats;
}
