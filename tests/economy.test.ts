import { beforeEach, describe, expect, it } from 'vitest';
import { collection, DAILY_COINS, PACK_PRICE } from '../src/collection/store.ts';

describe('coins and packs', () => {
  beforeEach(() => collection.reset());

  it('buys packs with coins and opens them from the inventory', () => {
    expect(collection.buyPack('rad')).toBe(false);          // no coins yet
    collection.addCoins(250);
    expect(collection.buyPack('rad', 2)).toBe(true);
    expect(collection.get().coins).toBe(250 - 2 * PACK_PRICE);
    expect(collection.get().packs.rad).toBe(2);
    expect(collection.buyPack('rad', 1)).toBe(false);       // 50 left
    expect(collection.takePack('rad')).toBe(true);
    expect(collection.takePack('rad')).toBe(true);
    expect(collection.takePack('rad')).toBe(false);
  });

  it('gives the daily coins once a day', () => {
    const t = 1_000_000_000_000;
    expect(collection.claimDaily(t)).toBe(DAILY_COINS);
    expect(collection.claimDaily(t + 3_600_000)).toBe(0);
    expect(collection.dailyIn(t + 3_600_000)).toBe(86_400_000 - 3_600_000);
    expect(collection.claimDaily(t + 86_400_000)).toBe(DAILY_COINS);
    expect(collection.get().coins).toBe(2 * DAILY_COINS);
  });

  it('hands out a starter set once: cards, packs and coins', () => {
    expect(collection.grantStarter('seraphine', { a: 3, b: 1 }, { rad: 3 }, 200)).toBe(true);
    expect(collection.grantStarter('evelynn', { c: 1 }, { rad: 3 }, 200)).toBe(false);
    const s = collection.get();
    expect(s.cards.a.normal).toBe(3);
    expect(s.packs.rad).toBe(3);
    expect(s.coins).toBe(200);
    expect(s.starter).toBe('seraphine');
  });
});
