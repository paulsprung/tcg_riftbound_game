/**
 * Writes src/game/cards/oracle.gen.json from public/data/cards.json (§9.1).
 * Run it after `npm run fetch-cards`; a test fails until you do.
 *
 *   npm run build-oracle
 *
 * The build itself is scripts/cards/oracle-build.ts. It stops with a list
 * of problems when the data can't be read safely or an override row in
 * src/game/cards/overrides.ts is no longer needed, and prints warnings for
 * text a person should look at.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOracle, CARDS_FILE, formatOracle, OracleBuildError } from './oracle-build.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outPath = resolve(root, 'src/game/cards/oracle.gen.json');

async function main() {
  const { file, warnings } = buildOracle(await readFile(resolve(root, CARDS_FILE), 'utf8'));
  await writeFile(outPath, formatOracle(file));
  const count = (pred: (c: (typeof file.cards)[number]) => boolean) => file.cards.filter(pred).length;
  console.log(`oracle: ${file.cards.length} cards from ${file.source.printings} printings, hash ${file.hash}`);
  console.log(`  ${count((c) => c.source === 'errata')} from errata, ${count((c) => !!c.fixes)} with override rows,`
    + ` ${count((c) => c.keywords.length > 0)} with keyword lines`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  console.log(`wrote ${outPath}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof OracleBuildError ? e.message : e);
  process.exit(1);
});
