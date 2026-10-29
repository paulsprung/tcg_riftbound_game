import { describe, expect, it } from 'vitest';
import { pairRound, standings, swissRounds, topCutPairs, type MatchResult } from '../server/tournament/swiss.ts';
import { rng } from '../src/pack/generate.ts';

const P = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('swiss', () => {
  it('rounds grow with the field', () => {
    expect([2, 4, 7, 8, 16, 17, 33].map(swissRounds)).toEqual([1, 2, 3, 3, 4, 5, 6]);
  });

  it('scores 3/1/0, a bye as a win, and breaks ties by opponents\' match wins', () => {
    const r: MatchResult[] = [
      { round: 1, a: 'p1', b: 'p2', wins: [2, 0] },
      { round: 1, a: 'p3', b: 'p4', wins: [2, 1] },
      { round: 1, a: 'p5', b: null, wins: [2, 0] },
      { round: 2, a: 'p1', b: 'p3', wins: [1, 1] },
      { round: 2, a: 'p2', b: 'p4', wins: [2, 0] },
      { round: 2, a: 'p5', b: 'p2', wins: [0, 2] },
    ];
    const s = standings(P(5), r);
    const by = Object.fromEntries(s.map((x) => [x.player, x]));
    expect(by.p1.points).toBe(4);
    expect(by.p3.points).toBe(4);
    expect(by.p5).toMatchObject({ points: 3, byes: 1, wins: 1, losses: 1 });
    expect(by.p2.points).toBe(6);
    expect(s[0].player).toBe('p2');
    // p1 and p3 tie on points; p1's opponents (p2: 2-1, p3) beat p3's (p4: 0-2, p1)
    expect(s.findIndex((x) => x.player === 'p1')).toBeLessThan(s.findIndex((x) => x.player === 'p3'));
  });

  it('pairs without rematches, gives the bye to the lowest player without one, and runs a field to the end', () => {
    const players = P(9);
    const results: MatchResult[] = [];
    const rand = rng(7);
    for (let round = 1; round <= swissRounds(9); round++) {
      const pairs = pairRound(players, results, rand);
      const seen = pairs.flatMap((p) => (p.b ? [p.a, p.b] : [p.a]));
      expect(new Set(seen).size).toBe(9);                         // everyone once
      for (const p of pairs) {
        if (p.b) expect(results.some((r) => (r.a === p.a && r.b === p.b) || (r.a === p.b && r.b === p.a))).toBe(false);
        results.push({ round, a: p.a, b: p.b, wins: p.b ? (rand() < 0.5 ? [2, 0] : [1, 2]) : [2, 0] });
      }
    }
    const byes = results.filter((r) => r.b === null).map((r) => r.a);
    expect(new Set(byes).size).toBe(byes.length);                // nobody gets two byes
  });

  it('seeds the top cut so 1 and 2 can only meet in the final', () => {
    expect(topCutPairs(P(8))).toEqual([['p1', 'p8'], ['p4', 'p5'], ['p2', 'p7'], ['p3', 'p6']]);
    expect(topCutPairs(P(4))).toEqual([['p1', 'p4'], ['p2', 'p3']]);
  });
});
