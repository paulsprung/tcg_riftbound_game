import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../src/data/types.ts';
import { openPack, poolFor, rng } from '../src/pack/generate.ts';
import { BOOSTER_SETS } from '../src/pack/packConfig.ts';

/* Checks on the shipped snapshot, public/data/cards.json. */
const db: CardDb = JSON.parse(readFileSync(new URL('../public/data/cards.json', import.meta.url), 'utf8'));

describe('the card snapshot', () => {
  it('holds English printings only', () => {
    expect(db.sets.map((s) => s.id)).not.toEqual(expect.arrayContaining(['cn', 'kr', 'fr']));
    expect(db.cards.filter((c) => /\((CN|KR|FR)\)|•\s*(CN|KR|FR)\b/i.test(c.code)).map((c) => c.code)).toEqual([]);
  });

  it('has unique ids and an image for every card', () => {
    expect(new Set(db.cards.map((c) => c.id)).size).toBe(db.cards.length);
    expect(db.cards.filter((c) => !c.image).map((c) => c.id)).toEqual([]);
  });

  it('marks champions as units only, and gives every Radiance card a type', () => {
    expect(db.cards.filter((c) => c.supertype === 'Champion' && c.type !== 'Unit').map((c) => c.id)).toEqual([]);
    expect(db.cards.filter((c) => c.setId === 'rad' && !c.type).map((c) => c.id)).toEqual([]);
  });

  it.each(BOOSTER_SETS.map((b) => [b.id, b.pack] as const))('deals full %s packs from real pools', (id, pack) => {
    const cards = db.cards.filter((c) => c.setId === id);
    for (const key of ['common', 'uncommon', 'rare', 'epic', 'rune', 'token', 'altRune'] as const) {
      expect(poolFor(cards, key, pack).length, `${id} ${key}`).toBeGreaterThan(0);
    }
    if (pack.tokens) expect(poolFor(cards, 'token', pack)).toHaveLength(pack.tokens.length);
    const random = rng(7);
    for (let i = 0; i < 200; i++) expect(openPack(cards, pack, random)).toHaveLength(14);
  });
});
