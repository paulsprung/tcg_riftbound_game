import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card, CardDb } from '../src/data/types.ts';
import { createGame, choose } from '../src/game/index.ts';
import { autoBuild, botPick, draftDone, limitedIssues, MIN_DECK, newDraft, pick, POD, sealedPool } from '../src/limited/limited.ts';
import { rng } from '../src/pack/generate.ts';

const db: CardDb = JSON.parse(readFileSync('public/data/cards.json', 'utf8'));
const cards = new Map<string, Card>(db.cards.map((c) => [c.id, c]));

describe('Limited (TR 602)', () => {
  it('a Sealed pool is six boosters without runes or tokens; its auto-built deck is legal', () => {
    for (const setId of ['ogn', 'sfd', 'unl', 'ven', 'rad']) {
      const pool = sealedPool(db, setId, rng(7));
      expect(pool.length, setId).toBeGreaterThanOrEqual(6 * 12);
      expect(pool.some((id) => /rune|token/i.test(`${cards.get(id)?.type} ${cards.get(id)?.supertype}`)), setId).toBe(false);
      const deck = autoBuild(pool, 'sealed', cards);
      expect(limitedIssues(deck, pool, 'sealed'), setId).toEqual([]);
      expect(deck.main.reduce((t, e) => t + e.n, 0)).toBeGreaterThanOrEqual(MIN_DECK.sealed);
    }
  });

  it('a draft of eight passes left, right, left and leaves each seat 39 cards', () => {
    let d = newDraft(db, 'ogn', rng(3));
    expect(d.packs).toHaveLength(POD);
    const firstPack = d.packs[0].slice();
    d = pick(d, 0, firstPack[0]);
    expect(() => pick(d, 0, d.packs[0][0])).toThrow(/picked/);
    for (let s = 1; s < POD; s++) d = pick(d, s, botPick(cards, d.packs[s], d.picks[s]));
    // left: seat 1 now holds what seat 0 opened, one card short
    expect(d.packs[1]).toEqual(firstPack.slice(1));
    while (!draftDone(d)) for (let s = 0; s < POD; s++) d = pick(d, s, botPick(cards, d.packs[s], d.picks[s]));
    for (const p of d.picks) expect(p).toHaveLength(39);
    expect(new Set(d.picks.flat()).size).toBeLessThanOrEqual(d.picks.flat().length);
  });

  it('a Limited game runs without a Legend and draws the extra card; checks the pool', () => {
    const a = sealedPool(db, 'ogn', rng(11)), b = sealedPool(db, 'ogn', rng(12));
    const da = { ...autoBuild(a, 'sealed', cards), legend: '', chosenChampion: '' };
    const db2 = autoBuild(b, 'sealed', cards);
    expect(limitedIssues({ ...da, main: [...da.main, { def: 'fury-rune', n: 1 }] }, a, 'sealed').length).toBeGreaterThan(0);
    let s = createGame({ seed: 5, decks: [da, db2], limited: 'sealed', firstPlayer: 0 }).state;
    expect(s.players[0].limitedDraw).toBe(true);
    let seen = false;
    for (let i = 0; i < 6000 && !s.result; i++) {
      const d = s.pending!;
      const keys = d.options.filter((o) => !o.ui).map((o) => o.key);
      s = choose(s, { decision: d.id, key: keys.includes('pass') ? 'pass' : keys.includes('done') ? 'done' : keys.includes('end') ? 'end' : keys[0] }).state;
      if (!seen && s.history.beginningPhasesStarted[0] === 1) {
        // 4 in the opening hand, 1 more at the start of the first Beginning Phase
        seen = true;
        expect(s.players[0].hand.length + s.players[0].base.length).toBeGreaterThanOrEqual(5);
      }
    }
    expect(s.result).not.toBeNull();
    expect(() => createGame({ seed: 5, decks: [da, db2], firstPlayer: 0 })).toThrow(/Legend/);
  }, 60_000);
});
