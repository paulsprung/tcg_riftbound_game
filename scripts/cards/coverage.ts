/*
 * Card coverage (§9.7): which oracle cards the engine can execute.
 *
 *   npm run card-coverage               totals, per set and per type
 *   npm run card-coverage -- --list     also every card that has no definition yet
 *   npm run card-coverage -- --starters the cards of the 13 starter decks, per deck
 */
import { coverageOf, coverageReport } from '../../src/game/cards/registry.ts';
import { deckDefs } from '../../src/game/decks/decklist.ts';
import { STARTERS } from '../../src/game/decks/starters.ts';

const rows = coverageReport();
const list = process.argv.includes('--list');
const tally = (pick: (r: (typeof rows)[number]) => string[]) => {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) for (const k of pick(r)) (out[k] ??= {})[r.coverage] = (out[k][r.coverage] ?? 0) + 1;
  return out;
};
const line = (name: string, t: Record<string, number>) => {
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const done = (t.defined ?? 0) + (t.vanilla ?? 0) + (t.keywords ?? 0);
  console.log(`${name.padEnd(14)} ${String(done).padStart(4)}/${String(total).padEnd(4)} defined ${t.defined ?? 0}, `
    + `partial ${t.partial ?? 0}, vanilla ${t.vanilla ?? 0}, keywords ${t.keywords ?? 0}, undefined ${t.undefined ?? 0}`);
};
line('all', tally(() => ['all']).all);
console.log('-- by set');
for (const [k, t] of Object.entries(tally((r) => r.sets.slice(0, 1))).sort()) line(k, t);
console.log('-- by type');
for (const [k, t] of Object.entries(tally((r) => r.types.slice(0, 1))).sort()) line(k, t);
if (list) {
  console.log('-- not executable yet (partial or undefined)');
  for (const r of rows) if (r.coverage === 'undefined' || r.coverage === 'partial') console.log(`${r.coverage.padEnd(10)} ${r.id}`);
}

if (process.argv.includes('--starters')) {
  const ok = (c: string) => c === 'defined' || c === 'vanilla' || c === 'keywords';
  const all = new Set<string>();
  console.log('-- starter decks');
  for (const st of STARTERS) {
    const defs = deckDefs(st.deck);
    defs.forEach((d) => all.add(d));
    const bad = defs.filter((d) => !ok(coverageOf(d)));
    console.log(`${st.id.padEnd(12)} ${String(defs.length - bad.length).padStart(3)}/${defs.length}${bad.length ? `  missing: ${bad.join(', ')}` : ''}`);
  }
  const done = [...all].filter((d) => ok(coverageOf(d))).length;
  console.log(`${'all starters'.padEnd(12)} ${done}/${all.size} (${Math.round((done / all.size) * 100)}%)`);
}
