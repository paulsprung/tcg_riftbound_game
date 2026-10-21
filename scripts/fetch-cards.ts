/**
 * Downloads every Riftbound card and writes the snapshot the app loads,
 * public/data/cards.json. Sources (see src/data/normalize.ts and dotgg.ts):
 *
 *   Riot's official card gallery  - primary, includes preview sets
 *   Riftcodex community API       - promos, flavour text, variant flags
 *   riftbound.gg (dotgg) API      - repairs: supertypes, tags, errata, and
 *                                   Radiance's types and domains
 *   data/supplement-cards.json    - English printings none of them list
 *   data/image-overrides.json     - where a source shows the wrong art
 *   data/card-fixes.json          - field corrections, applied last
 *   data/hidden-cards.json        - duplicate records left out
 *
 * The untouched responses go to data/raw/ (git-ignored), so the normaliser
 * can be re-run without the network:
 *
 *   npm run fetch-cards            fetch both, then normalise
 *   npm run fetch-cards -- --raw   normalise data/raw/ only
 *
 * Card art stays on Riot's servers; we only store the image URLs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDotgg, type DotggRow } from '../src/data/dotgg.ts';
import { buildDb } from '../src/data/normalize.ts';
import type { Card } from '../src/data/types.ts';

const RIOT = 'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards';
const RIFTCODEX = process.env.RIFTCODEX_API ?? 'https://api.riftcodex.com';
const DOTGG = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (name: string) => resolve(root, 'data/raw', name);
const outPath = resolve(root, 'public/data/cards.json');

type Rec = Record<string, unknown>;

async function getJson(url: string): Promise<Rec> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return (await res.json()) as Rec;
    // Back off on rate limiting and transient server errors, give up on the rest.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${url} -> HTTP ${res.status} ${res.statusText}`);
  }
}

async function fetchRiot(): Promise<Rec[]> {
  const all: Rec[] = [];
  const limit = 200;
  let total = Infinity;
  // Pages can come back a card or two short, so page by the reported total
  // rather than stopping at the first short page.
  for (let from = 0; from < total; from += limit) {
    const page = await getJson(`${RIOT}?locale=en_US&from=${from}&limit=${limit}`);
    const items = page.data;
    if (!Array.isArray(items)) throw new Error(`Riot gallery: unexpected response at from=${from}`);
    all.push(...(items as Rec[]));
    const reported = (page.metadata as Rec | undefined)?.totalItems;
    total = typeof reported === 'number' ? reported : items.length ? total : 0;
    process.stdout.write(`\rRiot gallery: ${all.length}/${Number.isFinite(total) ? total : '?'} cards`);
  }
  process.stdout.write('\n');
  return all;
}

async function fetchRiftcodex(): Promise<Rec[]> {
  const all: Rec[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const data = await getJson(`${RIFTCODEX}/cards?page=${page}&size=100`);
    if (!Array.isArray(data.items)) throw new Error(`Riftcodex: unexpected response on page ${page}`);
    all.push(...(data.items as Rec[]));
    pages = typeof data.pages === 'number' ? data.pages : pages;
    process.stdout.write(`\rRiftcodex: ${all.length} cards (page ${page}/${pages})`);
  }
  process.stdout.write('\n');
  return all;
}

async function fetchDotgg(): Promise<Rec[]> {
  const data = await getJson(DOTGG);
  if (!Array.isArray(data.names) || !Array.isArray(data.data)) throw new Error('dotgg: unexpected response');
  const rows = zipDotgg(data as { names: string[]; data: unknown[][] });
  console.log(`riftbound.gg: ${rows.length} cards`);
  return rows as unknown as Rec[];
}

async function cached(name: string, offline: boolean, fetcher: () => Promise<Rec[]>): Promise<Rec[]> {
  if (offline) return JSON.parse(await readFile(raw(name), 'utf8'));
  const data = await fetcher();
  await mkdir(dirname(raw(name)), { recursive: true });
  await writeFile(raw(name), JSON.stringify(data));
  return data;
}

async function main() {
  const offline = process.argv.includes('--raw');
  const riot = await cached('riot-gallery.json', offline, fetchRiot);
  const riftcodex = await cached('riftcodex-cards.json', offline, fetchRiftcodex);
  const dotgg = await cached('dotgg-cards.json', offline, fetchDotgg) as unknown as DotggRow[];
  const local = async <T>(name: string): Promise<T> => JSON.parse(await readFile(resolve(root, 'data', name), 'utf8'));

  const db = buildDb(riot, riftcodex, {
    dotgg,
    cards: await local<Card[]>('supplement-cards.json'),
    images: await local<Record<string, string>>('image-overrides.json'),
    fixes: await local('card-fixes.json'),
    hidden: await local<Record<string, string>>('hidden-cards.json'),
    onReport: (r) => {
      console.log(`riftbound.gg repairs: ${r.matched} cards matched, changed ${JSON.stringify(r.changed)}`);
      // stats are only overwritten where checked by hand: show the rest
      for (const d of r.disagreements) console.warn(`  riftbound.gg disagrees, not applied: ${d}`);
    },
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(db));

  console.log(`wrote ${db.cards.length} cards in ${db.sets.length} sets -> ${outPath}`);
  for (const s of db.sets) console.log(`  ${s.id.padEnd(4)} ${s.name} (${s.cardCount})`);
  const unknown = db.cards.filter((c) => c.rarity === 'unknown').length;
  if (unknown) console.warn(`${unknown} cards have an unrecognised rarity; check parseRarity()`);
  const noImage = db.cards.filter((c) => !c.image).length;
  if (noImage) console.warn(`${noImage} cards have no image URL`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (String(err).includes('fetch failed')) {
    console.error('Behind a proxy? Run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).');
  }
  process.exit(1);
});
