import { describe, expect, it } from 'vitest';
import { ladderPoints, rate, START, tierOf } from '../server/rating.ts';

describe('glicko-2', () => {
  it('matches Glickman\'s worked example for the first game', () => {
    // the example's player (1500, 200, 0.06) beating a 1400/30 player moves up and gets surer
    const me = { r: 1500, rd: 200, vol: 0.06 };
    const after = rate(me, { r: 1400, rd: 30, vol: 0.06 }, 1);
    expect(after.r).toBeGreaterThan(1500);
    expect(after.rd).toBeLessThan(200);
    expect(after.vol).toBeCloseTo(0.06, 3);
  });

  it('a new player moves fast, a settled one slowly; wins and losses are symmetric at equal ratings', () => {
    const win = rate(START, START, 1), loss = rate(START, START, 0);
    expect(win.r - 1500).toBeGreaterThan(100);
    expect(win.r - 1500).toBeCloseTo(1500 - loss.r, 6);
    const settled = { r: 1500, rd: 60, vol: 0.06 };
    expect(rate(settled, settled, 1).r - 1500).toBeLessThan(30);
  });

  it('beating a much stronger player gains more than beating a weaker one', () => {
    const me = { r: 1500, rd: 80, vol: 0.06 };
    const up = rate(me, { r: 1800, rd: 80, vol: 0.06 }, 1).r - 1500;
    const down = rate(me, { r: 1200, rd: 80, vol: 0.06 }, 1).r - 1500;
    expect(up).toBeGreaterThan(down * 3);
  });

  it('ladder points start low and tiers climb in order', () => {
    expect(ladderPoints(START)).toBe(800);
    expect(tierOf(0).tier).toBe('Iron');
    expect(tierOf(800)).toEqual({ tier: 'Silver', division: 4 });
    expect(tierOf(990)).toEqual({ tier: 'Silver', division: 1 });
    expect(tierOf(2400)).toEqual({ tier: 'Master', division: null });
  });
});
