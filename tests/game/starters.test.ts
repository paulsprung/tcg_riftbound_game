import { describe, expect, it } from 'vitest';
import { coverageOf } from '../../src/game/cards/registry.ts';
import { findCard, printedKeywords } from '../../src/game/cards/oracle.ts';
import { createGame, deckDefs, STARTERS, validateDeck } from '../../src/game/index.ts';
import { keywordOf } from '../../src/game/rules/chars.ts';
import { base, put } from './helpers/scenario.ts';
import { table } from './helpers/cards.ts';

/*
 * The 13 official starter decks (decks/starters.ts): every card of every one
 * is executable, every deck is legal for the game it is made for, and every
 * pairing sets up.
 */

const ok = ['defined', 'vanilla', 'keywords'];

describe('the starter decks', () => {
  it('every card of every starter deck is fully defined (coverage 100%)', () => {
    const all = [...new Set(STARTERS.flatMap((st) => deckDefs(st.deck)))];
    expect(all.length).toBe(270);
    expect(all.filter((d) => !ok.includes(coverageOf(d)))).toEqual([]);
  });

  it('every starter is legal: 40 cards, 12 runes, its battlefields (Proving Grounds: one) [103], [487.5]', () => {
    for (const st of STARTERS) {
      const errors = validateDeck(st.deck, 'sanctioned', { format: 'standard' }).filter((i) => i.severity === 'error');
      expect(errors, st.id).toEqual([]);
      expect(st.deck.battlefields.length, st.id).toBe(st.set === 'ogs' ? 1 : 3);
    }
  });

  it('keyword-only cards have their printed keywords on the board', () => {
    const all = [...new Set(STARTERS.flatMap((st) => deckDefs(st.deck)))].filter((d) => coverageOf(d) === 'keywords');
    expect(all.length).toBeGreaterThan(10);
    const g = table(1);
    for (const def of all) {
      const c = findCard(def)!;
      if (!c.types.includes('unit') && !c.types.includes('gear')) continue;
      const id = put(g, def, 0, base(0));
      for (const k of printedKeywords(c)) expect(keywordOf(g.s, id, k.kw), `${def} ${k.kw}`).toBeGreaterThan(0);
    }
  });

  it('every pairing of starters sets up to its first turn', () => {
    for (const a of STARTERS) {
      for (const b of STARTERS) {
        const s = createGame({ seed: 7, decks: [a.deck, b.deck] }).state;
        expect(s.pending, `${a.id} vs ${b.id}`).not.toBeNull();
      }
    }
  });
});
