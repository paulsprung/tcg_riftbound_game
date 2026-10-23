// Prints, per product, the starter cards without a definition, with their rules text as TS literals.
import { STARTERS, PRODUCT_ORDER } from '../../src/game/decks/starters.ts';
import { deckDefs } from '../../src/game/decks/decklist.ts';
import { findCard } from '../../src/game/cards/oracle.ts';
import { coverageOf } from '../../src/game/cards/registry.ts';
const first = new Map<string, string>();
for (const set of PRODUCT_ORDER) for (const st of STARTERS.filter((x) => x.set === set)) for (const d of deckDefs(st.deck)) if (!first.has(d)) first.set(d, set);
const want = process.argv[2];
for (const [id, set] of first) {
  if (want && set !== want) continue;
  const cov = coverageOf(id);
  if (cov === 'defined' || cov === 'vanilla' || (cov === 'keywords' && !process.argv.includes('--all'))) continue;
  const c = findCard(id)!;
  console.log(`// ${id} [${cov}] ${c.types.join('/')} ${c.domains.join('/')} e${c.cost?.energy ?? '-'} m${c.might ?? '-'} tags=${c.tags.join(',')}`);
  console.log(`  ${JSON.stringify(c.rules)}`);
}
