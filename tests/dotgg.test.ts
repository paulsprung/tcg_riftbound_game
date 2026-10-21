import { describe, expect, it } from 'vitest';
import { enrichFromDotgg, nameParts, zipDotgg, type DotggRow } from '../src/data/dotgg.ts';
import { makeCard } from './fixtures.ts';

const row = (over: Partial<DotggRow> & { id: string; name: string }): DotggRow => ({
  effect: '', errata: null, color: [], cost: null, power: null, type: [], supertype: '', might: null,
  mightBonus: null, tags: null, set_name: 'Radiance', promo: '0', ...over,
});

describe('dotgg names', () => {
  it('reads "Name - Title" and "Name, Title" alike, keeping unspaced hyphens', () => {
    expect(nameParts('Akali - Brash')).toEqual(nameParts('Akali, Brash'));
    expect(nameParts('Seraphine - Starry-Eyed Songstress')).toEqual(['seraphine', 'starryeyedsongstress']);
    expect(nameParts("K’Sante - Pride of Nazumah (Promo)")).toEqual(['ksante', 'prideofnazumah']);
    expect(nameParts('Annie - Dark Child - Starter')).toEqual(['annie', 'darkchild']);
  });

  it('zips the API rows', () => {
    expect(zipDotgg({ names: ['id', 'name'], data: [['RAD-001', 'X']] })).toEqual([{ id: 'RAD-001', name: 'X' }]);
  });
});

describe('enrichFromDotgg', () => {
  it('fills Radiance supertypes, tags, type and domains, and takes its types over the gallery', () => {
    const champ = makeCard({ id: 'rad-015-167', setId: 'rad', code: 'RAD-015/167', name: 'Akali, Brash', type: 'Unit' });
    const legend = makeCard({ id: 'rad-139-167', setId: 'rad', code: 'RAD-139/167', name: 'Boy Who Shattered Time', type: 'Legend', tags: ['Ekko'] });
    const hush = makeCard({ id: 'rad-041-167', setId: 'rad', code: 'RAD-041/167', name: 'Hush', type: '' });
    const armorer = makeCard({ id: 'rad-002-167', setId: 'rad', code: 'RAD-002/167', name: 'Battlefield Armorer', type: 'Spell', domains: ['Chaos'] });
    const device = makeCard({ id: 'rad-017-167', setId: 'rad', code: 'RAD-017/167', name: 'Detonation Amplifier', type: 'Gear', tags: ['Device'] });
    const sig = makeCard({ id: 'rad-140-167', setId: 'rad', code: 'RAD-140/167', name: 'Chronobreak', type: 'Spell' });
    enrichFromDotgg([champ, legend, hush, armorer, device, sig], [
      row({ id: 'RAD-015', name: 'Akali - Brash', type: ['Unit'], supertype: 'Champion', tags: ['Akali', 'Ionia'], color: ['Fury'] }),
      row({ id: 'RAD-139', name: 'Ekko - Boy Who Shattered Time', type: ['Legend'], tags: ['Ekko'] }),
      row({ id: 'RAD-041', name: 'Hush', type: ['Spell'], color: ['Calm'] }),
      row({ id: 'RAD-002', name: 'Battlefield Armorer', type: ['Unit'], color: ['Fury'] }),
      row({ id: 'RAD-017', name: 'Detonation Amplifier', type: ['Gear'], tags: null }),
      row({ id: 'RAD-140', name: 'Chronobreak', type: ['Spell'], supertype: 'Signature', tags: ['Ekko'] }),
    ]);
    expect(champ).toMatchObject({ supertype: 'Champion', tags: ['Akali', 'Ionia'] });
    expect(legend).toMatchObject({ type: 'Legend', supertype: null, tags: ['Ekko'] });
    expect(hush).toMatchObject({ type: 'Spell', domains: ['Calm'] });
    expect(armorer).toMatchObject({ type: 'Unit', domains: ['Fury'] });
    expect(device.tags).toEqual([]);
    expect(sig).toMatchObject({ supertype: 'Signature', tags: ['Ekko'] });
  });

  it('never puts Champion on anything but a unit', () => {
    const legend = makeCard({ id: 'ogs-017-024', setId: 'ogs', code: 'OGS-017/024', name: 'Dark Child', type: 'Legend', supertype: 'Champion' });
    const spell = makeCard({ id: 'rad-050-167', setId: 'rad', code: 'RAD-050/167', name: 'Odd', type: 'Spell' });
    enrichFromDotgg([legend, spell], [row({ id: 'RAD-050', name: 'Odd', type: ['Spell'], supertype: 'Champion' })]);
    expect(legend.supertype).toBeNull();
    expect(spell.supertype).toBeNull();
  });

  it('matches promos to the card they reprint, and repairs their equipment', () => {
    const atlas = makeCard({
      id: 'opp-086-221', setId: 'opp', code: 'OPP-086/221', name: 'World Atlas', type: 'Gear', might: null,
      text: '[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)',
    });
    enrichFromDotgg([atlas], [row({
      id: 'SFD-086', name: 'World Atlas', set_name: 'Spiritforged', type: ['Gear'], mightBonus: '2',
      effect: '[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)<br />+2 :rb_might: When I hold, play two Gold gear tokens exhausted.',
    })]);
    expect(atlas.might).toBe(2);
    expect(atlas.text).toBe('[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)\nWhen I hold, play two Gold gear tokens exhausted.');
  });

  it('keeps errata next to the printed text and ignores non-English printings', () => {
    const c = makeCard({ id: 'ogn-005-298', setId: 'ogn', code: 'OGN-005/298', name: 'Disintegrate', type: 'Spell', text: 'Deal 3 to a unit.' });
    const akali = makeCard({ id: 'ven-038-166', setId: 'ven', code: 'VEN-038/166', name: 'Akali, Silent', type: 'Unit', tags: ['Akali'] });
    enrichFromDotgg([c, akali], [
      row({ id: 'OGN-005', name: 'Disintegrate', set_name: 'Origins', type: ['Spell'], effect: 'Deal 3 to a unit.', errata: 'Deal 3 to a unit at a battlefield.' }),
      row({ id: 'VEN-038-P', name: 'Akali - Silent (China 1st Anniversary Promo)', set_name: 'Vendetta', type: ['Unit'], tags: ['Akali', 'Ionia', 'X'] }),
    ]);
    expect(c.text).toBe('Deal 3 to a unit.');
    expect(c.errata).toBe('Deal 3 to a unit at a battlefield.');
    expect(akali.tags).toEqual(['Akali']);
  });
});
