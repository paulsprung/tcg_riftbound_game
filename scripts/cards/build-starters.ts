/**
 * Turns the researched starter decklists (data/starters/*.json, by card
 * name) into src/game/decks/starters.gen.json (by oracle id), and checks
 * each one: every name is one oracle card, 1 + 40 + 12 + 3 cards, runes in
 * the legend's domains.
 *
 *   npm run build-starters
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORACLE } from '../../src/game/cards/oracle.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(root, 'data/starters');

interface Src {
  id: string; name: string; set: string; booster: string; legend: string;
  championOptions: string[] | null; chosenChampion: string;
  main: { name: string; n: number }[]; runes: { name: string; n: number }[]; battlefields: string[];
  tokens?: string[]; sources?: string[]; notes?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'");
const byName = new Map<string, string[]>();
for (const c of ORACLE.cards) byName.set(norm(c.name), [...(byName.get(norm(c.name)) ?? []), c.id]);

const problems: string[] = [];
function def(deck: string, name: string): string {
  const ids = byName.get(norm(name)) ?? [];
  if (ids.length !== 1) { problems.push(`${deck}: "${name}" matches ${ids.length} cards`); return name; }
  return ids[0];
}

const out: unknown[] = [];
for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json')).sort()) {
  const s = JSON.parse(await readFile(resolve(dir, f), 'utf8')) as Src;
  const d = s.id;
  const main = s.main.map((e) => ({ def: def(d, e.name), n: e.n }));
  const runes = s.runes.map((e) => ({ def: def(d, e.name), n: e.n }));
  const bf = s.battlefields.map((b) => def(d, b));
  const count = (l: { n: number }[]) => l.reduce((a, e) => a + e.n, 0);
  if (count(main) !== 40) problems.push(`${d}: ${count(main)} main deck cards, not 40`);
  if (count(runes) !== 12) problems.push(`${d}: ${count(runes)} runes, not 12`);
  // the Proving Grounds decks come with 1 battlefield (guided 2-4 player play)
  if (bf.length !== 3 && !(s.set === 'ogs' && bf.length === 1)) problems.push(`${d}: ${bf.length} battlefields, not 3`);
  out.push({
    id: s.id, product: s.name, set: s.set, booster: s.booster,
    tokens: s.tokens ?? [], sources: s.sources ?? [], notes: s.notes ?? '',
    deck: {
      name: s.name, source: 'precon', legend: def(d, s.legend),
      ...(s.championOptions ? { championOptions: s.championOptions.map((n) => def(d, n)) } : {}),
      chosenChampion: def(d, s.chosenChampion), main, runes, battlefields: bf,
    },
  });
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
await writeFile(resolve(root, 'src/game/decks/starters.gen.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.length} starter decks`);
