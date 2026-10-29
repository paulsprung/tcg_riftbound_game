import { describe, expect, it } from 'vitest';
import { createGame, STARTERS } from '../../src/game/index.ts';

// TR 407.4 / 407.2.a: a match's later games (and a playoff's first) name who chooses to play first.
describe('the designated player', () => {
  const decks = [STARTERS[1].deck, STARTERS[2].deck] as const;
  it('is the one the setup names, and chooses play first or second', () => {
    for (const p of [0, 1] as const) {
      const s = createGame({ seed: 11, decks: [...decks], firstPlayer: { designee: p } }).state;
      expect(s.pending).toMatchObject({ kind: 'playOrder', player: p });
    }
  });
  it('must be in the game', () => {
    expect(() => createGame({ seed: 1, decks: [...decks], firstPlayer: { designee: 3 as 0 } })).toThrow(/designated player/);
  });
});
