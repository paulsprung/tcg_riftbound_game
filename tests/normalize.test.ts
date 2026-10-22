import { makeCard } from './fixtures.ts';
import { describe, expect, it } from 'vitest';
import { tidyCards, buildDb, normalizeRiftcodex, normalizeRiot, parseRarity, plainText, variantFromCode } from '../src/data/normalize.ts';

const riot = (over: Record<string, unknown> = {}) => ({
  id: 'ogn-056-298',
  collectorNumber: 56,
  name: 'Adaptatron',
  set: { label: 'Card Set', value: { id: 'OGN', label: 'Origins' } },
  cardType: { label: 'Card Type', type: [{ id: 'unit', label: 'Unit' }] },
  publicCode: 'OGN-056/298',
  rarity: { label: 'Rarity', value: { id: 'uncommon', label: 'Uncommon' } },
  domain: { label: 'Domain', values: [{ id: 'fury', label: 'Fury' }, { id: 'body', label: 'Body' }] },
  cardImage: { url: 'https://cmsassets.rgpub.io/x.png?accountingTag=RB' },
  orientation: 'portrait',
  illustrator: { label: 'Artist', values: [{ id: 'a', label: 'Someone' }] },
  text: { label: 'Ability', richText: { type: 'html', body: '<p>When I conquer, you may kill a gear.<br />Then buff me.</p>' } },
  energy: { label: 'Energy', value: { id: 4, label: '4' } },
  might: { label: 'Might', value: { id: 3, label: '3' } },
  tags: { label: 'Tags', tags: ['Mech', 'Piltover'] },
  ...over,
});

const riftcodex = (over: Record<string, unknown> = {}) => ({
  id: '69c4',
  name: 'Adaptatron',
  riftbound_id: 'ogn-056-298',
  collector_number: 56,
  classification: { type: 'Unit', supertype: null, rarity: 'Uncommon', domain: ['Fury'] },
  text: { plain: 'When I conquer, you may kill a gear.', flavour: 'Beep.' },
  set: { set_id: 'OGN', label: 'Origins' },
  media: { image_url: 'https://cmsassets.rgpub.io/x.png', artist: 'Someone' },
  orientation: 'portrait',
  metadata: { alternate_art: false, overnumbered: false, signature: false },
  ...over,
});

describe('normalizeRiot', () => {
  it('reads the gallery shape', () => {
    expect(normalizeRiot(riot())).toMatchObject({
      id: 'ogn-056-298', name: 'Adaptatron', setId: 'ogn', setName: 'Origins', code: 'OGN-056/298',
      number: 56, rarity: 'uncommon', variant: 'base', type: 'Unit', domains: ['Fury', 'Body'],
      energy: 4, might: 3, power: null, tags: ['Mech', 'Piltover'], artist: 'Someone',
      text: 'When I conquer, you may kill a gear.\nThen buff me.',
    });
  });

  it('joins name and subtitle', () => {
    expect(normalizeRiot(riot({ name: 'Ahri', subtitle: 'Inquisitive' }))?.name).toBe('Ahri, Inquisitive');
  });

  it('recognises tokens by their code', () => {
    const t = normalizeRiot(riot({ publicCode: 'UNL-T04', cardType: { type: [] } }));
    expect(t?.type).toBe('Token');
    expect(t?.supertype).toBe('Token');
  });
});

describe('variantFromCode', () => {
  it.each([
    ['OGN-056/298', 'common', 'base'],
    ['OGN-066a/298', 'showcase', 'alt-art'],
    ['OGN-299/298', 'showcase', 'overnumbered'],
    ['UNL-229*/219', 'rare', 'signature'],
    ['RAD-SP1/005', 'showcase', 'alt-art'],
    ['RAD-R01', 'common', 'base'],
    ['RAD-R01a', 'showcase', 'alt-art'],
    ['OPP-007b/298', 'promo', 'promo'],
  ] as const)('%s', (code, rarity, variant) => {
    expect(variantFromCode(code, rarity)).toBe(variant);
  });
});

describe('normalizeRiftcodex', () => {
  it('builds the printed code from riftbound_id and reads the flags', () => {
    const c = normalizeRiftcodex(riftcodex({ riftbound_id: 'unl-229*-219', metadata: { signature: true } }));
    expect(c?.code).toBe('UNL-229*/219');
    expect(c?.variant).toBe('signature');
  });

  it('skips records without an id or name', () => {
    expect(normalizeRiftcodex({ name: 'nameless' })).toBeNull();
  });
});

describe('buildDb', () => {
  it('prefers Riot, enriches from Riftcodex, keeps Riftcodex-only promos', () => {
    const db = buildDb(
      [riot()],
      [
        riftcodex(),
        riftcodex(),   // duplicate record
        riftcodex({ riftbound_id: 'opp-007b-298', name: 'Fury Rune', set: { set_id: 'OPP', label: 'Promos' },
          classification: { type: 'Rune', rarity: 'Promo' } }),
      ],
    );
    expect(db.cards).toHaveLength(2);
    const a = db.cards.find((c) => c.id === 'ogn-056-298')!;
    expect(a.domains).toEqual(['Fury', 'Body']);   // Riot's, not Riftcodex's
    expect(a.flavor).toBe('Beep.');                 // Riftcodex fills the gap
    expect(db.sets.map((s) => s.id)).toEqual(['ogn', 'opp']);
  });
});

describe('text helpers', () => {
  it('flattens rich text', () => {
    expect(plainText('<p>A &amp; B</p><p>C</p>')).toBe('A & B\nC');
  });
  it('does not mistake uncommon for common', () => {
    expect(parseRarity('Uncommon')).toBe('uncommon');
    expect(parseRarity({ id: 'common', label: 'Common' })).toBe('common');
    expect(parseRarity('???')).toBe('unknown');
  });
});

describe('tidyCards', () => {
  it('writes names and texts in one style', () => {
    const cards = [
      makeCard({ id: 'a', name: 'Annie - Dark Child (Metal)', type: 'Legend', tags: ['Annie'] }),
      makeCard({ id: 'b', name: 'Dark Child, Starter', type: 'Legend', tags: ['Annie'] }),
      makeCard({ id: 'c', name: 'Heimerdinger - Inventor' }),
      makeCard({ id: 'd', name: 'Recruit (DE)', text: '[NO TEXT]' }),
      makeCard({ id: 'e', text: '[Level 3][&gt;] I have +1.' }),
    ];
    tidyCards(cards);
    expect(cards.map((c) => c.name)).toEqual(['Annie, Dark Child', 'Annie, Dark Child', 'Heimerdinger, Inventor', 'Recruit (DE)', 'e']);
    expect(cards[0].edition).toBe('Metal');
    expect(cards[3].text).toBe('');
    expect(cards[4].text).toBe('[Level 3][>] I have +1.');
  });
});
