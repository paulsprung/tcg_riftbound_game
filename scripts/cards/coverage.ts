/*
 * Card coverage (§9.7): which oracle cards the engine can execute.
 *
 *   npm run card-coverage            totals, per set and per type
 *   npm run card-coverage -- --list  also every card that has no definition yet
 */
import { coverageReport } from '../../src/game/cards/registry.ts';

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
