/**
 * Builds the self-contained preview that runs as a claude.ai Artifact:
 *
 *   npm run build:preview      (behind a proxy: NODE_USE_ENV_PROXY=1 ...)
 *
 * An Artifact page may not load anything from other hosts, so this build
 * ships the card art and symbols itself:
 *
 *   dist-preview/index.html        the page: CSS and JS inlined, no
 *                                  doctype/head/body (the Artifact host
 *                                  wraps it in its own skeleton)
 *   dist-preview/data/cards.json   the card list, with each card's image
 *                                  pointing at a bundle ("bundle:ogn-03")
 *                                  and every symbol as a data: URI
 *   dist-preview/images/*.json     card art as base64 WebP, ~48 cards per
 *                                  file, fetched only when shown; the five
 *                                  pack covers get a tiny file of their own
 *   dist-preview/publish.json      the files split into publish batches
 *
 * Downloaded art is cached in data/raw/preview-img/ (git-ignored).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { Card, CardDb } from '../src/data/types.ts';
import { heroCard } from '../src/pack/hero.ts';
import { BOOSTER_SETS } from '../src/pack/packConfig.ts';

const WIDTH = 480;
const QUALITY = 72;
const PER_BUNDLE = 48;
const CONCURRENCY = 12;
// Artifact publish limits: 64 MB and 255 files per publish.
const BATCH_BYTES = 58 * 1024 * 1024;
const BATCH_FILES = 240;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-preview');
const cache = resolve(root, 'data/raw/preview-img');

const safe = (id: string) => id.replace(/[^a-z0-9-]/gi, '_');

async function fetchBytes(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    // Network errors, rate limiting and server errors are retried; other
    // HTTP errors (404, 403) will not get better.
    let retry = true;
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      retry = res.status === 429 || res.status >= 500;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (!retry || attempt >= 3) throw new Error(`${url}: ${err}`);
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
}

async function cardArt(card: Card): Promise<Buffer | null> {
  if (!card.image) return null;
  // Keyed by size, quality and source too, so changing any of them refetches.
  const key = createHash('sha1').update(`${card.image}|${WIDTH}|${QUALITY}`).digest('hex').slice(0, 10);
  const file = resolve(cache, `${safe(card.id)}-${key}.webp`);
  if (existsSync(file)) return readFile(file);
  let bytes: Buffer;
  if (/rgpub\.io/.test(card.image)) {
    // Riot's image server resizes and re-encodes on request
    const sep = card.image.includes('?') ? '&' : '?';
    bytes = await fetchBytes(`${card.image}${sep}w=${WIDTH}&fm=webp&q=${QUALITY}`);
  } else {
    // other hosts serve one size: resize and encode it here (Pillow)
    const src = `${file}.src`;
    await writeFile(src, await fetchBytes(card.image));
    execFileSync('python3', ['-I', '-c', RESIZE, src, file, String(WIDTH), String(QUALITY)]);
    await rm(src);
    bytes = await readFile(file);
  }
  await writeFile(file, bytes);
  return bytes;
}

const RESIZE = `
import sys
from PIL import Image
src, dst, w, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGBA')
if im.width > w:
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.save(dst, 'WEBP', quality=q, method=6)
`;

async function dataUri(url: string): Promise<string> {
  const bytes = await fetchBytes(url);
  const type = url.split('?')[0].endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return `data:${type};base64,${bytes.toString('base64')}`;
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

async function main() {
  const db: CardDb = JSON.parse(await readFile(resolve(root, 'public/data/cards.json'), 'utf8'));
  await mkdir(cache, { recursive: true });
  await rm(out, { recursive: true, force: true });

  // 1. Card art -------------------------------------------------------------
  const art = new Map<string, string>();   // card id -> base64
  let done = 0;
  const missing: string[] = [];
  await pool(db.cards, CONCURRENCY, async (card) => {
    try {
      const bytes = await cardArt(card);
      if (bytes) art.set(card.id, bytes.toString('base64'));
      else missing.push(card.id);
    } catch (err) {
      missing.push(card.id);
      console.warn(`\n  no art for ${card.code}: ${err instanceof Error ? err.message : err}`);
    }
    if (++done % 50 === 0 || done === db.cards.length) process.stdout.write(`\rart: ${done}/${db.cards.length}`);
  });
  process.stdout.write('\n');

  // 2. Bundles: covers first, then each set in ~48-card files ----------------
  // The pack-cover champions get a small bundle of their own, so a drawn
  // wrapper (a set without a product shot) never waits on a set bundle.
  const covers = new Set(
    BOOSTER_SETS.map((b) => heroCard(db.cards.filter((c) => c.setId === b.id), b.style)?.id).filter(Boolean) as string[],
  );
  const bundles = new Map<string, Record<string, string>>();
  const put = (name: string, card: Card) => {
    const b64 = art.get(card.id);
    if (!b64) { card.image = ''; return; }
    const b = bundles.get(name) ?? {};
    b[card.id] = b64;
    bundles.set(name, b);
    card.image = `bundle:${name}`;
  };
  for (const c of db.cards) if (covers.has(c.id)) put('covers', c);
  for (const set of db.sets) {
    const cards = db.cards.filter((c) => c.setId === set.id && !covers.has(c.id));
    cards.forEach((c, i) => put(`${set.id}-${String(Math.floor(i / PER_BUNDLE)).padStart(2, '0')}`, c));
  }

  // 3. Symbols as data: URIs -----------------------------------------------
  for (const kind of ['rarities', 'domains'] as const) {
    for (const s of Object.values(db.symbols[kind])) s.icon = await dataUri(s.icon);
  }
  for (const [k, url] of Object.entries(db.symbols.glyphs ?? {})) db.symbols.glyphs![k] = await dataUri(url);

  // 4. The app ---------------------------------------------------------------
  await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    publicDir: false,
    logLevel: 'warn',
    define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
    // The page is one file: the foil textures referenced from holo.css are
    // inlined as data: URIs, since the assets folder is not published.
    build: { outDir: out, emptyOutDir: false, assetsInlineLimit: 4 * 1024 * 1024 },
  });

  const html = await readFile(resolve(out, 'index.html'), 'utf8');
  const jsPath = /<script[^>]+src="\.?\/?(assets\/[^"]+\.js)"/.exec(html)?.[1];
  const cssPath = /<link[^>]+href="\.?\/?(assets\/[^"]+\.css)"/.exec(html)?.[1];
  if (!jsPath || !cssPath) throw new Error('could not find the built JS/CSS in index.html');
  const js = (await readFile(resolve(out, jsPath), 'utf8')).replace(/<\/script/gi, '<\\/script');
  const css = (await readFile(resolve(out, cssPath), 'utf8')).replace(/<\/style/gi, '<\\/style');
  const fonts = /<link href="https:\/\/fonts\.googleapis\.com[^>]+>/.exec(html)?.[0] ?? '';

  const page = [
    '<title>Riftbound Simulator</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    fonts,
    `<style>${css}</style>`,
    '<div id="root"></div>',
    `<script type="module">${js}</script>`,
    '',
  ].join('\n');
  await writeFile(resolve(out, 'index.html'), page);
  await rm(resolve(out, 'assets'), { recursive: true, force: true });

  // 5. Data files and publish batches --------------------------------------
  await mkdir(resolve(out, 'data'), { recursive: true });
  await mkdir(resolve(out, 'images'), { recursive: true });
  const dataJson = JSON.stringify(db);
  await writeFile(resolve(out, 'data/cards.json'), dataJson);

  const files: { path: string; bytes: number }[] = [{ path: 'data/cards.json', bytes: Buffer.byteLength(dataJson) }];
  for (const [name, entries] of bundles) {
    const body = JSON.stringify(entries);
    await writeFile(resolve(out, `images/${name}.json`), body);
    files.push({ path: `images/${name}.json`, bytes: Buffer.byteLength(body) });
  }

  // Product shots and the card back are ordinary image files.
  const media = resolve(root, 'public/media');
  if (existsSync(media)) {
    await cp(media, resolve(out, 'media'), { recursive: true });
    for (const name of await readdir(media)) {
      if (!/\.(webp|png|jpe?g)$/i.test(name)) continue;
      files.push({ path: `media/${name}`, bytes: (await stat(resolve(media, name))).size });
    }
  }

  // The card list, covers and product shots go first, so the opening
  // screen works as soon as the first batch is up.
  const early = (p: string) => p.includes('covers') || p.startsWith('media/') || p === 'data/cards.json';
  files.sort((a, b) => Number(early(b.path)) - Number(early(a.path)));
  const batches: string[][] = [];
  let cur: string[] = [];
  let size = Buffer.byteLength(page);
  for (const f of files) {
    if (cur.length && (size + f.bytes > BATCH_BYTES || cur.length >= BATCH_FILES)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f.path);
    size += f.bytes;
  }
  if (cur.length) batches.push(cur);
  await writeFile(resolve(out, 'publish.json'), JSON.stringify({ page: 'index.html', batches }, null, 1));

  const total = files.reduce((s, f) => s + f.bytes, 0) + Buffer.byteLength(page);
  console.log(`page ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB, ${files.length} data files, ${(total / 1048576).toFixed(1)} MB total`);
  console.log(`${bundles.size} image bundles, largest ${(Math.max(...files.map((f) => f.bytes)) / 1048576).toFixed(1)} MB`);
  console.log(`${batches.length} publish batches: ${batches.map((b) => b.length).join(', ')} files`);
  if (missing.length) console.warn(`${missing.length} cards without art: ${missing.slice(0, 10).join(', ')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (String(err).includes('fetch failed')) console.error('Behind a proxy? Run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).');
  process.exit(1);
});
