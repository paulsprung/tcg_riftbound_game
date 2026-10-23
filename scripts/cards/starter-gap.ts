import { STARTERS } from '../../src/game/decks/starters.ts';
import { deckDefs } from '../../src/game/decks/decklist.ts';
import { findCard } from '../../src/game/cards/oracle.ts';
import { coverageOf } from '../../src/game/cards/registry.ts';
const seen = new Map<string, string[]>();
for (const s of STARTERS) for (const d of deckDefs(s.deck)) { (seen.get(d) ?? seen.set(d, []).get(d)!).push(s.id); }
console.log('decks', STARTERS.map((s) => `${s.id}(${s.set}) main=${s.deck.main.reduce((a,e)=>a+e.n,0)} bf=${s.deck.battlefields.length}`).join(' '));
console.log('distinct', seen.size);
const rows = [...seen.entries()].map(([id, decks]) => ({ id, decks, c: findCard(id), cov: coverageOf(id) }));
for (const r of rows.sort((a, b) => (a.c?.types[0] ?? '').localeCompare(b.c?.types[0] ?? '') || a.id.localeCompare(b.id))) {
  if (process.argv.includes('--todo') && ['defined','vanilla','keywords'].includes(r.cov)) continue;
  const c = r.c!;
  console.log(`\n## ${r.id} [${r.cov}] ${c.types.join('/')} ${c.domains.join('/')} cost=${c.cost ? c.cost.energy + (c.cost.power.length ? '+' + c.cost.power.join('') : '') : '-'} might=${c.might ?? '-'}${c.mightBonus !== undefined ? ' bonus=' + c.mightBonus : ''} tags=${c.tags.join(',')} sup=${c.supertypes.join(',')} decks=${r.decks.join(',')}`);
  console.log(c.rules);
}
