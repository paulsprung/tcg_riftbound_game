/**
 * Tokens as single cards in public/data/cards.json (normalize.ts
 * singleTokens), without fetching the card sources again. `npm run
 * fetch-cards` does the same as part of a full refresh.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { singleTokens } from '../../src/data/normalize.ts';
import type { CardDb } from '../../src/data/types.ts';

const file = 'public/data/cards.json';
const db = JSON.parse(await readFile(file, 'utf8')) as CardDb;
const before = db.cards.length;
db.cards = singleTokens(db.cards, db.tokenFaces ?? []);
db.cards.sort((a, b) => a.setId.localeCompare(b.setId) || (a.number ?? 1e9) - (b.number ?? 1e9) || a.code.localeCompare(b.code));
for (const s of db.sets) s.cardCount = db.cards.filter((c) => c.setId === s.id).length;
await writeFile(file, JSON.stringify(db));
console.log(`${before} cards -> ${db.cards.length}`);
