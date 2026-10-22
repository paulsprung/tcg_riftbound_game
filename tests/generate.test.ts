import { describe, expect, it } from 'vitest';
import { BOOSTER_SETS, boosterSet, type PackConfig } from '../src/pack/packConfig.ts';
import { finishFor, openPack, poolFor, rng } from '../src/pack/generate.ts';
import { makeCard, makeSet } from './fixtures.ts';

const origins = boosterSet('ogn')!.pack;
const radiance: PackConfig = { ...boosterSet('rad')!.pack, ultimate: ['TST-999/100'] };

describe('openPack', () => {
  const set = makeSet();

  it.each([['Origins', origins], ['Radiance', radiance]])('fills every slot of a %s pack', (_, config) => {
    const pack = openPack(set, config, rng(1));
    expect(pack).toHaveLength(14);
    const by = (slot: string) => pack.filter((p) => p.slot === slot);
    expect(by('Common').every((p) => p.card.rarity === 'common' && !p.foil && p.card.type === 'Unit')).toBe(true);
    expect(by('Uncommon').every((p) => p.card.rarity === 'uncommon')).toBe(true);
    expect(by('Rune')).toHaveLength(1);
    expect(by('Foil').every((p) => p.foil)).toBe(true);
  });

  it('gives Origins two rare-or-better slots and Radiance a rare plus a showcase slot', () => {
    const o = openPack(set, origins, rng(2));
    expect(o.filter((p) => p.slot === 'Rare+')).toHaveLength(2);
    const r = openPack(set, radiance, rng(2));
    expect(r.filter((p) => p.slot === 'Rare')).toHaveLength(1);
    expect(r.filter((p) => p.slot === 'Showcase')).toHaveLength(1);
  });

  it('reveals the exciting slots last', () => {
    const slots = openPack(set, radiance, rng(5)).map((p) => p.slot);
    expect(slots.slice(0, 7).every((s) => s === 'Common')).toBe(true);
    expect(slots.at(-1)).toBe('Showcase');
  });

  it('never puts runes or tokens in the common slots', () => {
    for (let s = 0; s < 50; s++) {
      const commons = openPack(set, origins, rng(s)).filter((p) => p.slot === 'Common');
      expect(commons.some((p) => p.card.type === 'Rune' || p.card.supertype === 'Token')).toBe(false);
    }
  });

  it('does not repeat a card within one pack', () => {
    for (let s = 0; s < 50; s++) {
      const ids = openPack(set, origins, rng(s)).map((p) => p.card.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is reproducible from a seed', () => {
    const a = openPack(set, origins, rng(42)).map((p) => p.card.id);
    const b = openPack(set, origins, rng(42)).map((p) => p.card.id);
    expect(a).toEqual(b);
  });

  it('roughly matches the estimated Origins epic rate over many packs', () => {
    const random = rng(7);
    let epics = 0;
    const packs = 4000;
    for (let i = 0; i < packs; i++) {
      epics += openPack(set, origins, random).filter((p) => p.slot === 'Rare+' && p.card.rarity === 'epic').length;
    }
    // 1/8 per slot, two slots: ~0.25 per pack
    expect(epics / packs).toBeGreaterThan(0.2);
    expect(epics / packs).toBeLessThan(0.3);
  });

  it('falls back to a lower pool when a set lacks one', () => {
    const tiny = [
      ...Array.from({ length: 10 }, (_, i) => makeCard({ id: `c${i}` })),
      ...Array.from({ length: 4 }, (_, i) => makeCard({ id: `u${i}`, rarity: 'uncommon' })),
    ];
    const pack = openPack(tiny, origins, rng(3));
    // no runes or tokens in this set, so that slot is skipped and nothing else is
    expect(pack).toHaveLength(13);
    expect(pack.filter((p) => p.slot === 'Rare+').every((p) => p.card.rarity === 'uncommon')).toBe(true);
  });
});

describe('pools and finishes', () => {
  const set = makeSet();

  it('keeps runes out of the alt-art pool and the ultimate out of overnumbered', () => {
    expect(poolFor(set, 'altArt').some((c) => c.type === 'Rune')).toBe(false);
    expect(poolFor(set, 'altRune')).toHaveLength(6);
    expect(poolFor(set, 'overnumbered', radiance).some((c) => c.id === 'ult')).toBe(false);
    expect(poolFor(set, 'ultimate', radiance).map((c) => c.id)).toEqual(['ult']);
  });

  it('picks a finish from rarity, variant and foil', () => {
    expect(finishFor(makeCard({ id: 'a' }), false)).toBe('none');
    expect(finishFor(makeCard({ id: 'a' }), true)).toBe('foil');
    expect(finishFor(makeCard({ id: 'a', rarity: 'rare' }), false)).toBe('holo');   // rares are always foil
    expect(finishFor(makeCard({ id: 'a', variant: 'alt-art' }), true)).toBe('textured');
    expect(finishFor(makeCard({ id: 'o', variant: 'overnumbered', rarity: 'showcase' }), true)).toBe('etched');
    expect(finishFor(makeCard({ id: 'a', variant: 'signature' }), true)).toBe('signature');
    expect(finishFor(set.find((c) => c.id === 'ult')!, true, radiance)).toBe('ultimate');
  });

  it('lists every booster set once', () => {
    const ids = BOOSTER_SETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('real slot layouts and edge cases', () => {
  const set = makeSet();

  it.each(['ogn', 'sfd', 'unl', 'ven'])('%s has two Rare+ slots (Riot: "2 Rare, Epic, Alt, ... cards")', (id) => {
    const p = openPack(set, boosterSet(id)!.pack, rng(1));
    expect(p).toHaveLength(14);
    expect(p.filter((x) => x.slot === 'Rare+')).toHaveLength(2);
  });

  it('configures the Unleashed Ultimate Rare', () => {
    expect(boosterSet('unl')!.pack.ultimate).toEqual(['UNL-238/219']);
  });

  it('keeps 14 cards when a set has runes but no tokens yet', () => {
    const noTokens = set.filter((c) => c.supertype !== 'Token');
    for (let s = 0; s < 300; s++) expect(openPack(noTokens, radiance, rng(s))).toHaveLength(14);
  });

  it('never deals a foil token, even when a foil-rune roll falls back to one', () => {
    const noRunes = set.filter((c) => c.type !== 'Rune');
    const anyToken: PackConfig = { ...origins, tokens: undefined };   // the fixture's tokens are not on Origins' list
    for (let s = 0; s < 300; s++) {
      expect(openPack(noRunes, anyToken, rng(s)).find((p) => p.slot === 'Rune')!.foil).toBe(false);
    }
  });

  it('never puts two Ultimates in one pack', () => {
    const unl = boosterSet('unl')!.pack;
    const always: PackConfig = {
      ...unl, ultimate: ['TST-999/100'],
      slots: unl.slots.map((s) => (s.label === 'Rare+' ? { ...s, table: [{ pool: 'ultimate' as const, weight: 1 }] } : s)),
    };
    for (let s = 0; s < 50; s++) expect(openPack(set, always, rng(s)).filter((p) => p.finish === 'ultimate')).toHaveLength(1);
  });

  it('only deals the listed booster tokens when a set lists them', () => {
    const cfg: PackConfig = { ...origins, tokens: ['TST-t0'] };
    expect(poolFor(set, 'token', cfg).map((c) => c.id)).toEqual(['t0']);
  });

  it('gives Unleashed about 12 Legends per box from the rare slots', () => {
    const withLegends = [...set, ...Array.from({ length: 12 }, (_, i) => makeCard({ id: `L${i}`, rarity: 'rare', type: 'Legend' }))];
    const random = rng(9);
    let legends = 0;
    for (let i = 0; i < 2400; i++) legends += openPack(withLegends, boosterSet('unl')!.pack, random).filter((p) => p.card.type === 'Legend' && p.slot === 'Rare+').length;
    expect(legends / 100).toBeGreaterThan(11);
    expect(legends / 100).toBeLessThan(13);
  });

  it('gives every set about 6-7 Epics per box', () => {
    for (const { id, pack } of BOOSTER_SETS) {
      const random = rng(11);
      let epics = 0;
      for (let i = 0; i < 2400; i++) epics += openPack(set, pack, random).filter((p) => p.card.rarity === 'epic' && p.card.variant === 'base').length;
      expect(epics / 100, id).toBeGreaterThan(5.8);
      expect(epics / 100, id).toBeLessThan(7.2);
    }
  });
});
