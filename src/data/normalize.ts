import type { Card, CardDb, Rarity, SetInfo, CardSymbol, Variant } from './types.ts';

/*
 * Turns raw source records into our Card shape. Two sources are merged:
 *
 *  - Riot's official card gallery (content.publishing.riotgames.com), the
 *    primary source: every retail set, including preview cards of a set
 *    before it releases.
 *  - Riftcodex (api.riftcodex.com), a community API: adds the promo sets
 *    the gallery does not list, flavour text, supertypes (Champion, Token,
 *    Signature) and explicit alt-art / overnumbered / signature flags.
 *
 * Neither schema is ours, so every field is read through candidate paths.
 * If a source renames something, fix it here; nothing else in the app looks
 * at raw records.
 */

type Raw = Record<string, unknown>;

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? cur[Number(key)] : (cur as Raw)[key];
  }
  return cur;
}

function first(obj: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'label' in v) return str((v as Raw).label);
  return '';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? s.split(/[,/]/).map((x) => x.trim()).filter(Boolean) : [];
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

/** Rich text to plain text; keeps :rb_energy_1:-style symbol codes. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

export function parseRarity(v: unknown): Rarity {
  const s = (v && typeof v === 'object' && 'id' in v ? str((v as Raw).id) : str(v)).toLowerCase();
  // "uncommon" contains "common", so it has to be tested first.
  if (s.includes('uncommon')) return 'uncommon';
  if (s.includes('common')) return 'common';
  if (s.includes('epic')) return 'epic';
  if (s.includes('rare')) return 'rare';
  if (s.includes('showcase') || s.includes('overnumber')) return 'showcase';
  if (s.includes('promo')) return 'promo';
  return 'unknown';
}

/**
 * Chase printings are marked in the printed collector code:
 *   OGN-066a/298   alternate art          OGN-299/298   overnumbered
 *   UNL-229* /219  signature              RAD-SP1/005   special showcase
 */
export function variantFromCode(code: string, rarity: Rarity): Variant {
  const m = /^[A-Z0-9]+-([A-Z]*)(\d+)([a-z]*)(\*?)(?:\/(\d+))?$/i.exec(code.replace(/\s+/g, ''));
  if (rarity === 'promo') return 'promo';
  if (m) {
    const [, prefix, n, suffix, star, total] = m;
    if (star) return 'signature';
    if (/^sp$/i.test(prefix)) return 'alt-art';
    if (total && !prefix && Number(n) > Number(total)) return 'overnumbered';
    if (suffix) return 'alt-art';
  }
  if (rarity === 'showcase') return 'alt-art';
  return 'base';
}

/** Codes compare equal regardless of case or spacing. */
export const codeKey = (code: string) => code.replace(/\s+/g, '').toUpperCase();

/* --------------------------------------------------------- Riot gallery -- */

export function normalizeRiot(raw: Raw): Card | null {
  const id = str(raw.id);
  const baseName = str(raw.name);
  if (!id || !baseName) return null;
  const subtitle = str(raw.subtitle);
  const code = str(raw.publicCode);
  const rarity = parseRarity(get(raw, 'rarity.value'));
  const types = list(get(raw, 'cardType.type'));
  const setId = str(get(raw, 'set.value.id')).toLowerCase();
  const html = [str(get(raw, 'text.richText.body')), str(get(raw, 'effect.richText.body'))].filter(Boolean).join('\n');
  const token = /-T\d/i.test(code);

  return {
    id,
    name: subtitle ? `${baseName}, ${subtitle}` : baseName,
    setId,
    setName: str(get(raw, 'set.value.label')) || setId.toUpperCase(),
    code,
    number: num(raw.collectorNumber),
    rarity,
    variant: variantFromCode(code, rarity),
    // Tokens come through with no card type, but a T-numbered code.
    type: types[0] ?? (token ? 'Token' : ''),
    supertype: token ? 'Token' : null,
    domains: list(get(raw, 'domain.values')),
    energy: num(get(raw, 'energy.value.id')),
    might: num(get(raw, 'might.value.id')),
    power: num(get(raw, 'power.value.id')),
    tags: list(get(raw, 'tags.tags')),
    text: plainText(html),
    flavor: '',
    artist: list(get(raw, 'illustrator.values')).join(', '),
    image: str(get(raw, 'cardImage.url')),
    orientation: /landscape/i.test(str(raw.orientation)) ? 'landscape' : 'portrait',
  };
}

/* ------------------------------------------------------------ Riftcodex -- */

// "unl-229*-219" -> "UNL-229*/219", the way it is printed on the card.
function formatCode(id: string): string {
  const m = /^([a-z0-9]+)-([^-]+)-(\d+)$/i.exec(id);
  return m ? `${m[1].toUpperCase()}-${m[2]}/${m[3]}` : id.toUpperCase();
}

function riftcodexVariant(raw: Raw, rarity: Rarity, code: string): Variant {
  const flag = (...paths: string[]) => paths.some((p) => bool(get(raw, p)));
  if (flag('metadata.signature', 'signature')) return 'signature';
  if (flag('metadata.overnumbered', 'overnumbered')) return 'overnumbered';
  if (flag('metadata.alternate_art', 'alternate_art')) return 'alt-art';
  return variantFromCode(code, rarity);
}

export function normalizeRiftcodex(raw: Raw): Card | null {
  const riftboundId = str(raw.riftbound_id);
  const id = riftboundId || str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;

  const code = str(first(raw, 'public_code', 'code')) || formatCode(riftboundId || id);
  const rarity = parseRarity(first(raw, 'classification.rarity', 'rarity'));
  const setId = str(first(raw, 'set.set_id', 'set.id', 'set_id')).toLowerCase();

  return {
    id,
    name,
    setId,
    setName: str(first(raw, 'set.label', 'set.name')) || setId.toUpperCase(),
    code,
    number: num(raw.collector_number),
    rarity,
    variant: riftcodexVariant(raw, rarity, code),
    type: str(first(raw, 'classification.type', 'type')),
    supertype: str(first(raw, 'classification.supertype', 'supertype')) || null,
    domains: list(first(raw, 'classification.domain', 'domain')),
    energy: num(first(raw, 'attributes.energy', 'energy')),
    might: num(first(raw, 'attributes.might', 'might')),
    power: num(first(raw, 'attributes.power', 'power')),
    tags: list(raw.tags),
    text: str(first(raw, 'text.plain')) || plainText(str(first(raw, 'text.rich', 'text'))),
    flavor: str(first(raw, 'text.flavour', 'text.flavor')),
    artist: str(first(raw, 'media.artist', 'artist')),
    image: str(first(raw, 'media.image_url', 'image_url')),
    orientation: /landscape/i.test(str(raw.orientation)) ? 'landscape' : 'portrait',
  };
}

/* ---------------------------------------------------------------- merge -- */

/** Rarity and domain icons, as the gallery hands them out. */
export function collectSymbols(riotRaw: Raw[]): CardDb['symbols'] {
  const rarities: Record<string, CardSymbol> = {};
  const domains: Record<string, CardSymbol> = {};
  const add = (into: Record<string, CardSymbol>, v: unknown) => {
    const label = str(v);
    const icon = str(get(v, 'icon.url'));
    if (!label || !icon || into[label.toLowerCase()]) return;
    into[label.toLowerCase()] = { label, icon, color: str(get(v, 'icon.colors.primary')) || null };
  };
  for (const r of riotRaw) {
    add(rarities, get(r, 'rarity.value'));
    const ds = get(r, 'domain.values');
    if (Array.isArray(ds)) ds.forEach((d) => add(domains, d));
  }
  return { rarities, domains };
}

/** Set names as the products print them, where the sources disagree. */
const SET_NAMES: Record<string, string> = { ogs: 'Origins: Proving Grounds' };

export function buildDb(riotRaw: Raw[], riftcodexRaw: Raw[], now = new Date()): CardDb {
  const extra = new Map<string, Card>();
  for (const r of riftcodexRaw) {
    const c = normalizeRiftcodex(r);
    // Riftcodex has a few duplicate records for the same printing; the
    // first one wins.
    if (c && !extra.has(codeKey(c.code))) extra.set(codeKey(c.code), c);
  }

  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const r of riotRaw) {
    const c = normalizeRiot(r);
    if (!c || seen.has(codeKey(c.code))) continue;
    seen.add(codeKey(c.code));
    const rc = extra.get(codeKey(c.code));
    if (rc) {
      // Riot is authoritative for what is printed; Riftcodex knows the rest.
      c.supertype ??= rc.supertype;
      c.flavor ||= rc.flavor;
      c.type ||= rc.type;
      if (rc.variant !== 'base' && c.variant === 'base') c.variant = rc.variant;
    }
    cards.push(c);
  }
  for (const [key, c] of extra) if (!seen.has(key)) cards.push(c);

  for (const c of cards) c.setName = SET_NAMES[c.setId] ?? c.setName;
  cards.sort((a, b) =>
    a.setId.localeCompare(b.setId) ||
    (a.number ?? 1e9) - (b.number ?? 1e9) ||
    a.code.localeCompare(b.code));

  const sets = new Map<string, SetInfo>();
  for (const c of cards) {
    const s = sets.get(c.setId) ?? { id: c.setId, name: c.setName, cardCount: 0 };
    s.cardCount++;
    sets.set(c.setId, s);
  }

  return {
    generatedAt: now.toISOString(),
    source: 'Riot Games card gallery + Riftcodex',
    sets: [...sets.values()],
    cards,
    symbols: collectSymbols(riotRaw),
  };
}
