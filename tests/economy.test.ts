import { beforeEach, describe, expect, it } from 'vitest';
import { BOOSTER_SETS } from '../src/pack/packConfig.ts';
import { collection, DAILY_COINS, fromSaved, PACK_PRICE, TUTORIAL_PACKS } from '../src/collection/store.ts';
import { makeCard } from './fixtures.ts';

describe('coins and packs', () => {
  beforeEach(() => collection.reset());

  it('buys packs with coins and opens them from the inventory', async () => {
    expect(await collection.buyPack('rad')).toBe(false);          // no coins yet
    collection.addCoins(250);
    expect(await collection.buyPack('rad', 2)).toBe(true);
    expect(collection.get().coins).toBe(250 - 2 * PACK_PRICE);
    expect(collection.get().packs.rad).toBe(2);
    expect(await collection.buyPack('rad', 1)).toBe(false);       // 50 left
    const card = makeCard({ id: 'r1' });
    const deal = () => [{ card, foil: false, finish: 'none' as const, slot: 'Common', hype: 0 }];
    expect(await collection.openPack('rad', deal, [card])).toHaveLength(1);
    expect(await collection.openPack('rad', deal, [card])).toHaveLength(1);
    expect(await collection.openPack('rad', deal, [card])).toBeNull();
    expect(collection.get().cards.r1.normal).toBe(2);
    expect(collection.get().packsOpened.rad).toBe(2);
  });

  it('gives the daily coins once a day', async () => {
    const t = 1_000_000_000_000;
    expect(await collection.claimDaily(t)).toBe(DAILY_COINS);
    expect(await collection.claimDaily(t + 3_600_000)).toBe(0);
    expect(collection.dailyIn(t + 3_600_000)).toBe(86_400_000 - 3_600_000);
    expect(await collection.claimDaily(t + 86_400_000)).toBe(DAILY_COINS);
    expect(collection.get().coins).toBe(2 * DAILY_COINS);
  });

  it('hands out a starter set once: cards, packs and coins', async () => {
    expect(await collection.grantStarter('seraphine', { a: 3, b: 1 }, { rad: 3 }, 200)).toBe(true);
    expect(await collection.grantStarter('evelynn', { c: 1 }, { rad: 3 }, 200)).toBe(false);
    const s = collection.get();
    expect(s.cards.a.normal).toBe(3);
    expect(s.packs.rad).toBe(3);
    expect(s.coins).toBe(200);
    expect(s.starter).toBe('seraphine');
  });

  it('the tutorial reward: one pack of each shop set, granted once', async () => {
    expect(collection.get().tutorialDone).toBe(false);
    expect(await collection.completeTutorial()).toBe(true);
    expect(await collection.completeTutorial()).toBe(false);          // played again, skipped after: nothing more
    const s = collection.get();
    expect(s.tutorialDone).toBe(true);
    for (const id of TUTORIAL_PACKS) expect(s.packs[id]).toBe(1);
    expect(Object.values(s.packs).reduce((a, b) => a + b, 0)).toBe(5);
    expect(s.coins).toBe(0);
    // every reward pack is a set the shop sells (and opens)
    expect([...TUTORIAL_PACKS].sort()).toEqual(BOOSTER_SETS.map((b) => b.id).sort());
  });

  it('adds to the packs already there (the starter booster)', async () => {
    await collection.grantStarter('seraphine', {}, { rad: 1 }, 0);
    await collection.completeTutorial();
    expect(collection.get().packs.rad).toBe(2);
  });

  it('a save from before the tutorial existed loads with tutorialDone false', () => {
    const old = { cards: { a: { normal: 1, foil: 0 } }, packsOpened: {}, slabs: [], showcase: [], coins: 40, packs: { rad: 1 },
      starter: 'seraphine', dailyAt: 5 };
    const s = fromSaved(old);
    expect(s.tutorialDone).toBe(false);
    expect(s.coins).toBe(40);
    expect(s.starter).toBe('seraphine');
    expect(fromSaved({ ...old, tutorialDone: true }).tutorialDone).toBe(true);
    expect(fromSaved(null).tutorialDone).toBe(false);
  });
});
