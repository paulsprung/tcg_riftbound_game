import { ORACLE, type DeckList } from '../../../src/game/index.ts';
import { deckLimit, isChampionUnit, isSignature, type OracleCard } from '../../../src/game/cards/oracle.ts';
import { isLegalDeck, validateDeck } from '../../../src/game/decks/validate.ts';
import { mulberry32 } from '../../../src/game/state/rng.ts';
import { coverageOf } from '../../../src/game/cards/registry.ts';

/*
 * Random legal decks from one set's cards (§14.7 fuzzing of whole sets): a
 * random legend of the set, a Chosen Champion of its tag, 40 main cards of
 * its identity (copy limits, at most 3 Signature cards of its tag), 12 basic
 * runes of its domains and 3 different battlefields of the set.
 */

const RUNE: Record<string, string> = { fury: 'fury-rune', calm: 'calm-rune', mind: 'mind-rune', body: 'body-rune', chaos: 'chaos-rune',
  order: 'order-rune' };

/** `executable`: only cards the engine executes (a set still being defined). */
export function randomDeck(set: string, seed: number, o: { executable?: boolean } = {}): DeckList | null {
  let r = Math.imul(seed, 2654435761) >>> 0;
  const rand = () => { const st = mulberry32(r); r = st.next; return st.value; };
  const pickOne = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const cards = ORACLE.cards.filter((c) => c.sets[0] === set && (!o.executable || coverageOf(c.id) !== 'undefined'));
  const legends = cards.filter((c) => c.types.includes('legend'));
  for (let attempt = 0; attempt < 20; attempt++) {
    const legend = pickOne(legends);
    const identity = legend.domains;
    const inIdentity = (c: OracleCard) => c.domains.every((d) => identity.includes(d));
    const pool = cards.filter((c) => (c.types.includes('unit') || c.types.includes('gear') || c.types.includes('spell'))
      && inIdentity(c) && (!isSignature(c) || c.championTag === legend.championTag));
    const champs = pool.filter((c) => isChampionUnit(c) && c.championTag === legend.championTag);
    const fields = cards.filter((c) => c.types.includes('battlefield'));
    if (champs.length === 0 || fields.length < 3) continue;
    const champion = pickOne(champs);
    const count = new Map<string, number>([[champion.id, 1]]);
    let signatures = isSignature(champion) ? 1 : 0;
    let total = 1;
    for (let tries = 0; total < 40 && tries < 2000; tries++) {
      const c = pickOne(pool);
      const n = count.get(c.id) ?? 0;
      if (n >= deckLimit(c)) continue;
      if (isSignature(c) && signatures >= 3) continue;
      count.set(c.id, n + 1);
      if (isSignature(c)) signatures++;
      total++;
    }
    if (total < 40) continue;
    const bfs: string[] = [];
    while (bfs.length < 3) { const f = pickOne(fields); if (!bfs.includes(f.id)) bfs.push(f.id); }
    const runes = identity.length === 1 ? [{ def: RUNE[identity[0]], n: 12 }]
      : [{ def: RUNE[identity[0]], n: 6 }, { def: RUNE[identity[1]], n: 6 }];
    const deck: DeckList = {
      name: `${set} random ${seed}`, source: 'generated', legend: legend.id, chosenChampion: champion.id,
      main: [...count.entries()].map(([def, n]) => ({ def, n })), runes, battlefields: bfs,
    };
    // Neeko, Blending In: up to 3 more legends, chosen while building the deck [103.1] (any of them, names all different).
    if (count.has('neeko-blending-in')) {
      const others = ORACLE.cards.filter((c) => c.types.includes('legend') && c.name !== legend.name);
      const picked: OracleCard[] = [];
      for (let t = 0; picked.length < 3 && t < 50; t++) {
        const c = pickOne(others);
        if (!picked.some((x) => x.name === c.name)) picked.push(c);
      }
      deck.extra = { 'neeko-blending-in': picked.map((c) => c.id) };
    }
    if (isLegalDeck(validateDeck(deck, 'casual', { format: null }))) return deck;
  }
  return null;
}
