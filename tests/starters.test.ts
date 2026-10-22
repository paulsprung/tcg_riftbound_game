import { describe, expect, it } from 'vitest';
import { STARTERS, validateDeck } from '../src/game/index.ts';

describe('starter decks', () => {
  it('has every official starter once', () => {
    expect(STARTERS.map((s) => s.id).sort()).toEqual(
      ['annie', 'evelynn', 'fiora', 'garen', 'jinx', 'lee-sin', 'lux', 'master-yi', 'rumble', 'seraphine', 'vex', 'vi', 'viktor'],
    );
  });

  it.each(STARTERS.map((s) => [s.id, s] as const))('%s is a legal 56 card deck (54 for the Proving Grounds)', (_, s) => {
    const cards = 1 + s.deck.main.reduce((a, e) => a + e.n, 0) + s.deck.runes.reduce((a, e) => a + e.n, 0) + s.deck.battlefields.length;
    expect(cards).toBe(s.set === 'ogs' ? 54 : 56);
    // 1 battlefield comes with the Proving Grounds decks; the deck builder adds the other two
    // (some starters hold cards that were banned for Standard later, e.g. Jinx's Reaver's Row)
    const issues = validateDeck(s.deck, 'casual').filter((i) =>
      i.severity === 'error' && i.code !== 'banned' && !(s.set === 'ogs' && i.code === 'battlefields'));
    expect(issues.map((i) => `${i.code}: ${i.message}`)).toEqual([]);
  });
});
