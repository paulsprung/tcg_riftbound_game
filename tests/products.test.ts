import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../src/data/types.ts';
import { dealSpecial, GIFT_PROMO, packPrice, SPECIAL_PACKS, specialCards } from '../src/economy/products.ts';
import { PACK_PRICE } from '../src/economy/rules.ts';
import { rng } from '../src/pack/generate.ts';

/* The shop's special packs: single cards from a collection, at their odds. */
const db = JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb;

describe('special packs', () => {
  it('every card a special pack can give is in the data, with a local image', () => {
    for (const p of SPECIAL_PACKS.filter((x) => x.id !== 'gift-of-the-rift')) {
      const cards = specialCards(p.id, db.cards);
      expect(cards.length, p.id).toBeGreaterThan(0);
      for (const c of cards) expect(c.image, c.id).toMatch(/^cards\//);
    }
    expect(db.cards.find((c) => c.id === GIFT_PROMO)?.image).toMatch(/^cards\//);
  });

  it('a T1 pack is one card: mostly the Player Bundle, a Signature Edition 1 in 5, serial-numbered 1 in 25', () => {
    const r = rng(7);
    const n = 20_000;
    const count = { t1a: 0, t1s: 0, star: 0 };
    for (let i = 0; i < n; i++) {
      const pulls = dealSpecial('t1', db.cards, r);
      expect(pulls).toHaveLength(1);
      const id = pulls[0].card.id;
      if (id.includes('-star-')) count.star++; else if (id.startsWith('t1s')) count.t1s++; else count.t1a++;
    }
    expect(count.t1a / n).toBeCloseTo(0.8, 1);
    expect((count.t1s + count.star) / n).toBeCloseTo(0.2, 1);
    expect(count.star / n).toBeCloseTo(0.04, 1);
  });

  it('Arcane gives one foil legend; Secret Garden a card and a token; Gift of the Rift a booster and sometimes the Akali', () => {
    const r = rng(3);
    const arcane = dealSpecial('arcane', db.cards, r);
    expect(arcane).toHaveLength(1);
    expect(arcane[0].foil).toBe(true);
    const garden = dealSpecial('secret-garden', db.cards, r);
    expect(garden.map((p) => p.card.setId)).toEqual(['sgn', 'sgn']);
    let promos = 0;
    for (let i = 0; i < 400; i++) {
      const gift = dealSpecial('gift-of-the-rift', db.cards, r);
      expect(gift.length).toBeGreaterThanOrEqual(13);
      if (gift.some((p) => p.card.id === GIFT_PROMO)) promos++;
    }
    expect(promos / 400).toBeGreaterThan(0.15);
    expect(promos / 400).toBeLessThan(0.35);
  });

  it('prices: boosters at the pack price, special packs at theirs', () => {
    expect(packPrice('ogn')).toBe(PACK_PRICE);
    expect(packPrice('t1')).toBe(1500);
  });
});
