import { describe, expect, it } from 'vitest';
import { PACK_PRICE } from '../src/economy/rules.ts';
import { collection } from '../src/collection/store.ts';
import { rng } from '../src/pack/generate.ts';
import { centeringGrade, descriptor, gradeCard, overall } from '../src/showcase/grading.ts';
import { makeCard } from './fixtures.ts';

describe('grading', () => {
  it('grades centering by the worse axis', () => {
    expect(centeringGrade(51, 50)).toBe(10);
    expect(centeringGrade(55, 50)).toBe(9.5);
    expect(centeringGrade(50, 40)).toBe(8.5);
    expect(centeringGrade(70, 50)).toBe(7);
  });

  it('keeps the overall grade within half a grade of the weakest subgrade', () => {
    expect(overall({ centering: 10, corners: 10, edges: 10, surface: 10 })).toBe(10);
    expect(overall({ centering: 9.5, corners: 10, edges: 10, surface: 9.5 })).toBe(10);
    expect(overall({ centering: 10, corners: 10, edges: 10, surface: 9 })).toBe(9);
    expect(overall({ centering: 10, corners: 7, edges: 10, surface: 10 })).toBe(7);
  });

  it('names grades the usual way, and a perfect card pristine', () => {
    expect(descriptor({ grade: 10, pristine: false })).toBe('Gem Mint');
    expect(descriptor({ grade: 10, pristine: true })).toBe('Pristine');
    expect(descriptor({ grade: 8, pristine: false })).toBe('NM-MT');
  });

  it('mostly grades pack-fresh cards high, with gem mints and pristines rare', () => {
    const random = rng(42);
    const n = 20000;
    let gems = 0, pristine = 0, low = 0;
    for (let i = 0; i < n; i++) {
      const s = gradeCard('x', false, random);
      if (s.grade === 10) gems++;
      if (s.pristine) pristine++;
      if (s.grade <= 6) low++;
      expect(s.cert).toMatch(/^\d{8}$/);
    }
    expect(gems / n).toBeGreaterThan(0.15);
    expect(gems / n).toBeLessThan(0.35);
    expect(pristine / n).toBeGreaterThan(0.005);
    expect(pristine / n).toBeLessThan(0.05);
    expect(low / n).toBeLessThan(0.08);
  });

  it('never repeats a cert number', () => {
    const fixed = () => 0.5;
    const taken = new Set([gradeCard('x', false, fixed).cert]);
    let calls = 0;
    const s = gradeCard('x', false, () => (++calls > 8 ? 0.25 : 0.5), taken);
    expect(taken.has(s.cert)).toBe(false);
  });
});

describe('collection grading and showcase', () => {
  it('turns a raw copy into a slab and keeps the showcase in step', async () => {
    collection.reset();
    const card = makeCard({ id: 'c1', rarity: 'epic' });
    const pack = (foil: boolean) => async () => {
      collection.addCoins(PACK_PRICE);
      await collection.buyPack('tst');
      await collection.openPack('tst', () => [{ card, foil, finish: 'holo', slot: 'Rare+', hype: 2 }], [card]);
    };
    await pack(false)();
    expect(collection.display({ kind: 'raw', cardId: 'c1', foil: false })).toBe(true);

    const slab = (await collection.grade('c1', false))!;
    expect(slab).toBeTruthy();
    const state = collection.get();
    expect(state.cards.c1.normal).toBe(0);
    expect(state.slabs).toHaveLength(1);
    // the last raw copy went off to be graded, so it left the showcase
    expect(state.showcase).toHaveLength(0);
    expect(await collection.grade('c1', false)).toBeNull();

    collection.display({ kind: 'slab', cert: slab.cert });
    expect(collection.isDisplayed({ kind: 'slab', cert: slab.cert })).toBe(true);
    // opening another pack keeps slabs and the showcase
    await pack(true)();
    expect(collection.get().slabs).toHaveLength(1);
    expect(collection.get().showcase).toHaveLength(1);
    collection.reset();
  });
});
