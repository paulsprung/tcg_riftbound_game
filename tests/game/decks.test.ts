import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { banOf } from '../../src/game/cards/legality.ts';
import {
  findCard, isChampionUnit, isMainDeckCard, isSignature, ORACLE, oracleCard, printedKeywords,
} from '../../src/game/cards/oracle.ts';
import { BASIC_RUNES } from '../../src/game/cards/runes.ts';
import { deckDefs, mainCount, runeCount, type DeckEntry, type DeckList } from '../../src/game/decks/decklist.ts';
import { EVELYNN_PRECON, PRECONS, SERAPHINE_PRECON } from '../../src/game/decks/precons.ts';
import {
  isLegalDeck, isUnmodifiedPrecon, validateDeck, type DeckMode, type Issue, type ValidateOptions,
} from '../../src/game/decks/validate.ts';
import type { DefId } from '../../src/game/state/types.ts';

/*
 * Decks (§13): the two Radiance Showdown precons, and the validator against
 * the deck-construction rules of Spec A §1 [101–103], Unique [825] and the
 * Tournament Rules (TR 402.1, TR 601).
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));

const codes = (issues: Issue[]) => issues.map((i) => `${i.severity} ${i.code} ${i.rule}`);
const errors = (d: DeckList, mode: DeckMode = 'sanctioned', o: ValidateOptions = {}) =>
  validateDeck(d, mode, o).filter((i) => i.severity === 'error');
const rules = (d: DeckList, mode: DeckMode = 'sanctioned', o: ValidateOptions = {}) =>
  errors(d, mode, o).map((i) => i.rule);

/**
 * A legal 40-card deck for a legend: the champion once, `cards`, then three
 * copies each of plain cards inside the identity (no champions, Signature
 * cards, deck rules or bans, nothing that waits for Radiance's launch),
 * taken in id order; six runes of each identity domain and three Origins
 * battlefields.
 */
function deckFor(legend: DefId, champion: DefId, cards: DeckEntry[] = []): DeckList {
  const identity = oracleCard(legend).domains;
  const main: DeckEntry[] = [{ def: champion, n: 1 }, ...cards];
  const used = new Set(main.map((e) => e.def));
  const filler = ORACLE.cards.filter((c) => isMainDeckCard(c) && !isChampionUnit(c) && !isSignature(c) && !c.deck
    && c.domains.length > 0 && c.domains.every((d) => identity.includes(d)) && !used.has(c.id)
    && !banOf('2v2', c.id) && c.sets.some((s) => s !== 'rad' && s !== 'opp' && s !== 'pr'));
  for (const c of filler) {
    const n = Math.min(3, 40 - mainCount({ main } as DeckList));
    if (n === 0) break;
    main.push({ def: c.id, n });
  }
  const runes = Object.entries(BASIC_RUNES).filter(([, d]) => identity.includes(d)).map(([def]) => ({ def, n: 6 }));
  const battlefields = ORACLE.cards.filter((c) => c.types.includes('battlefield') && c.sets.includes('ogn')
    && !banOf('2v2', c.id)).slice(0, 3).map((c) => c.id);
  return { name: `${legend} test deck`, source: 'custom', legend, chosenChampion: champion, main, runes, battlefields };
}

/** The deck with `def`'s copies set to `n` (removed for 0, added if new). */
function withCopies(d: DeckList, def: DefId, n: number): DeckList {
  const main = d.main.filter((e) => e.def !== def);
  return { ...d, main: n > 0 ? [...main, { def, n }] : main };
}

/** Takes `n` cards off the last filler entries, so another card fits. */
function trim(d: DeckList, n: number): DeckList {
  const main = d.main.map((e) => ({ ...e }));
  for (let i = main.length - 1; n > 0 && i > 0; i--) {
    const take = Math.min(n, main[i].n);
    main[i].n -= take;
    n -= take;
  }
  return { ...d, main: main.filter((e) => e.n > 0) };
}

const JINX = 'jinx-loose-cannon';
const SERAPHINE = SERAPHINE_PRECON;

describe('the Radiance Showdown precons (§13.1)', () => {
  it.each(PRECONS.map((p) => [p.id, p] as const))('%s: every card resolves in cards.json', (_, p) => {
    const ids = new Set(db.cards.map((c) => c.id));
    for (const def of deckDefs(p.deck)) {
      const c = findCard(def);
      expect(c, def).toBeDefined();
      expect(c!.printings.every((id) => ids.has(id)), def).toBe(true);
    }
  });

  it.each(PRECONS.map((p) => [p.id, p] as const))('%s: legal in every mode, Standard and 2v2', (_, p) => {
    for (const mode of ['casual', 'sanctioned', 'playable'] as const) {
      expect(codes(validateDeck(p.deck, mode))).toEqual([]);
      expect(codes(validateDeck(p.deck, mode, { format: '2v2' }))).toEqual([]);
    }
  });

  it.each(PRECONS.map((p) => [p.id, p] as const))('%s: 40 cards with the champion copies, 12 runes, 3 battlefields', (_, p) => {
    const d = p.deck;
    expect(mainCount(d)).toBe(40);
    expect(runeCount(d)).toBe(12);
    expect(d.battlefields).toHaveLength(3);
    expect(new Set(d.battlefields.map((b) => oracleCard(b).name)).size).toBe(3);
    expect(d.source).toBe('precon');
    expect(p.releases).toBe('2026-10-23');
  });

  it('103.3.a the champion options are the legend\'s champion units, in the deck; the default is the cheapest', () => {
    for (const { deck: d } of PRECONS) {
      const tag = oracleCard(d.legend).championTag;
      const options = d.championOptions!.map(oracleCard);
      expect(options.every((c) => isChampionUnit(c) && c.championTag === tag)).toBe(true);
      expect(options.every((c) => d.main.some((e) => e.def === c.id))).toBe(true);
      const cheapest = Math.min(...options.map((c) => c.cost!.energy));
      expect(oracleCard(d.chosenChampion).cost!.energy).toBe(cheapest);
    }
    expect(SERAPHINE_PRECON.chosenChampion).toBe('seraphine-inspiring');
    expect(EVELYNN_PRECON.chosenChampion).toBe('evelynn-entrancing');
    expect(SERAPHINE_PRECON.main.filter((e) => SERAPHINE_PRECON.championOptions!.includes(e.def)))
      .toEqual([{ def: 'seraphine-not-alone', n: 1 }, { def: 'seraphine-inspiring', n: 2 }]);
  });

  it('103.3.a every champion option validates as the Chosen Champion', () => {
    for (const { deck: d } of PRECONS) {
      for (const def of d.championOptions!) expect(codes(validateDeck({ ...d, chosenChampion: def }, 'sanctioned'))).toEqual([]);
    }
  });

  it('103.3.d exactly one Signature card each, with the champion tag: Encore and Last Caress', () => {
    const sigs = (d: DeckList) => d.main.filter((e) => isSignature(oracleCard(e.def)));
    expect(sigs(SERAPHINE_PRECON)).toEqual([{ def: 'encore', n: 1 }]);
    expect(sigs(EVELYNN_PRECON)).toEqual([{ def: 'last-caress', n: 1 }]);
  });

  it('103.3.c champion units of other champions are ordinary cards, never Chosen Champion candidates', () => {
    expect(isChampionUnit(oracleCard('heimerdinger-academy-instructor'))).toBe(true);
    expect(rules({ ...SERAPHINE_PRECON, chosenChampion: 'heimerdinger-academy-instructor' }))
      .toEqual(['103.3.a.2', '103.3.a']);
    expect(rules({ ...EVELYNN_PRECON, championOptions: undefined, chosenChampion: 'ksante-courageous' }))
      .toEqual(['103.3.a.2']);
  });

  it('811.1.b Evelynn, Entrancing, the default Chosen Champion, has Hidden', () => {
    expect(printedKeywords(oracleCard('evelynn-entrancing')).map((k) => k.kw)).toContain('hidden');
  });

  it('use the tokens the slice needs: Recruit, Mech and Bird; Gold', () => {
    const text = (d: DeckList) => [...d.main.map((e) => e.def), ...d.battlefields].map((def) => oracleCard(def).rules)
      .join('\n');
    for (const t of ['Recruit', 'Mech', 'Bird']) expect(text(SERAPHINE_PRECON)).toContain(`${t} unit token`);
    expect(text(EVELYNN_PRECON)).toContain('Gold gear token');
    expect(text(EVELYNN_PRECON)).not.toContain('Bomb');
  });

  it('TR 601.2.b before Radiance launches they are casual decks; from October 23rd, 2026 sanctioned ones', () => {
    for (const { deck: d } of PRECONS) {
      const early = validateDeck(d, 'sanctioned', { asOf: '2026-10-21' });
      expect(early.length).toBeGreaterThan(0);
      expect(early.every((i) => i.code === 'notReleased' && i.severity === 'error' && i.rule === 'TR 601.2.b')).toBe(true);
      expect(early.every((i) => i.message.endsWith('legal from 2026-10-23, when its set launches'))).toBe(true);
      expect(isLegalDeck(validateDeck(d, 'casual', { asOf: '2026-10-21' }))).toBe(true);
      expect(validateDeck(d, 'sanctioned', { asOf: '2026-10-23' })).toEqual([]);
    }
    // Cards printed in an earlier set are legal already.
    const early = validateDeck(SERAPHINE_PRECON, 'sanctioned', { asOf: '2026-10-21' }).flatMap((i) => i.defs);
    expect(early).not.toContain('faithful-manufactor');
    expect(early).not.toContain('valley-of-idols');
    expect(early).toContain('encore');
  });
});

describe('the validator (Spec A §1.7)', () => {
  it('accepts the test decks', () => {
    expect(codes(validateDeck(deckFor(JINX, 'jinx-rebel'), 'sanctioned'))).toEqual([]);
    expect(codes(validateDeck(deckFor('volibear-relentless-storm', 'volibear-furious'), 'sanctioned'))).toEqual([]);
  });

  it('103.2 the legend must be a legend', () => {
    expect(rules({ ...SERAPHINE, legend: 'encore' })).toContain('103.2');
  });

  it('103.3 / TR 601.1.b at least 40 cards for casual play, exactly 40 for sanctioned play', () => {
    const d41 = withCopies(SERAPHINE, 'party-crasher', 2);
    const d39 = withCopies(SERAPHINE, 'party-crasher', 0);
    expect(rules(d41, 'casual')).toEqual([]);
    expect(rules(d41, 'sanctioned')).toEqual(['TR 601.1.b']);
    expect(rules(d39, 'casual')).toEqual(['103.3']);
    expect(rules(d39, 'playable')).toEqual(['TR 601.1.b']);
  });

  it('133.4 only units, gear and spells go in the Main Deck', () => {
    const d = trim(SERAPHINE, 2);
    expect(rules({ ...d, main: [...d.main, { def: 'mind-rune', n: 1 }, { def: 'valley-of-idols', n: 1 }] }))
      .toEqual(['133.4']);
  });

  it('103.2.b the Main Deck follows the domain identity: single, several, no domain', () => {
    const d = trim(SERAPHINE, 1);
    expect(rules({ ...d, main: [...d.main, { def: 'supernova', n: 1 }] }, 'casual')).toEqual([]);
    expect(errors({ ...d, main: [...d.main, { def: 'fight-or-flight', n: 1 }] }, 'casual', { format: null })
      .map((i) => [i.rule, i.defs])).toEqual([['103.3.c', ['fight-or-flight']]]);                       // Chaos
    // Multi-domain: allowed only when the identity has every domain [103.2.b.4].
    expect(errors({ ...d, main: [...d.main, { def: 'arcane-shift', n: 1 }] }).map((i) => i.rule))
      .toContain('103.3.c');                                                                             // Mind/Chaos
    // No domain: allowed in any deck [103.2.b.5].
    expect(errors({ ...d, main: [...d.main, { def: 'neeko-blending-in', n: 1 }] })).toEqual([]);
  });

  it('TR 402.1 the Chosen Champion is one of the 40', () => {
    const d = deckFor(JINX, 'jinx-rebel');
    expect(rules({ ...d, chosenChampion: 'jinx-demolitionist' })).toEqual(['103.3.a.2']);
    expect(errors({ ...d, chosenChampion: 'jinx-demolitionist' })[0].message).toMatch(/not in the Main Deck/);
  });

  it('103.3.a.2 Loose Cannon may choose Jinx, Rebel or Jinx, Demolitionist; never Tibbers', () => {
    expect(rules(deckFor(JINX, 'jinx-rebel'))).toEqual([]);
    expect(rules(deckFor(JINX, 'jinx-demolitionist'))).toEqual([]);
    // Tibbers has the Annie tag but is a Signature unit, not a champion unit.
    const annie = deckFor('annie-dark-child', 'tibbers');
    expect(errors(annie).filter((i) => i.code === 'chosenChampion').map((i) => i.message))
      .toEqual(['Tibbers is not a champion unit']);
    // A champion unit with another tag.
    expect(rules(deckFor(JINX, 'volibear-furious'))).toContain('103.3.a.2');
  });

  it('103.3.a the Chosen Champion must be one of the champion options', () => {
    expect(rules({ ...SERAPHINE, championOptions: ['seraphine-not-alone'] })).toEqual(['103.3.a']);
  });

  it('103.3.b.1 the Chosen Champion counts toward its three copies', () => {
    // Volibear, Furious as Chosen Champion and 2 more copies: 3.
    const d = trim(deckFor('volibear-relentless-storm', 'volibear-furious'), 2);
    expect(rules(withCopies(d, 'volibear-furious', 3))).toEqual([]);
    expect(rules(withCopies(trim(d, 1), 'volibear-furious', 4))).toEqual(['103.3.b']);
  });

  it('103.3.b.2 different names are different cards: three Yasuo, Remorseful and three Yasuo, Windrider', () => {
    const d = trim(deckFor('yasuo-unforgiven', 'yasuo-remorseful'), 5);
    const both = withCopies(withCopies(d, 'yasuo-remorseful', 3), 'yasuo-windrider', 3);
    expect(mainCount(both)).toBe(40);
    expect(rules(both)).toEqual([]);
  });

  it('825.3.a a Unique card is limited to one copy', () => {
    const d = trim(deckFor('ornn-fire-below-the-mountain', 'ornn-blacksmith'), 2);
    expect(rules({ ...d, main: [...d.main, { def: 'forgefire-cape', n: 1 }, { def: 'rabadons-deathcrown', n: 1 }] }))
      .toEqual([]);
    expect(rules({ ...d, main: [...d.main, { def: 'forgefire-cape', n: 2 }] })).toEqual(['825.3.a']);
  });

  it('a card can lift the copy limit for its name (Spiderling)', () => {
    const d = trim(deckFor('miss-fortune-bounty-hunter', 'miss-fortune-buccaneer'), 8);
    expect(rules({ ...d, main: [...d.main, { def: 'spiderling', n: 8 }] })).toEqual([]);
  });

  it('103.3.d.1 at most 3 Signature cards in total, whatever their names', () => {
    const ornn = trim(deckFor('ornn-fire-below-the-mountain', 'ornn-blacksmith'), 3);
    const three = [{ def: 'forgefire-cape', n: 1 }, { def: 'rabadons-deathcrown', n: 1 }, { def: 'shurelyas-requiem', n: 1 }];
    expect(rules({ ...ornn, main: [...ornn.main, ...three] })).toEqual([]);
    const jinx = trim(deckFor(JINX, 'jinx-rebel'), 4);
    expect(rules({ ...jinx, main: [...jinx.main, { def: 'super-mega-death-rocket', n: 4 }] }))
      .toEqual(['103.3.b', '103.3.d.1']);
  });

  it('103.3.d.2 every Signature card has the legend\'s champion tag', () => {
    // Siphon Power is Viktor's: inside Seraphine's Mind/Order identity, but not hers.
    const d = trim(SERAPHINE, 1);
    expect(rules({ ...d, main: [...d.main, { def: 'siphon-power', n: 1 }] })).toEqual(['103.3.d.2']);
  });

  it('103.4.a twelve runes of the identity', () => {
    expect(rules({ ...SERAPHINE, runes: [{ def: 'mind-rune', n: 6 }, { def: 'order-rune', n: 5 }] })).toEqual(['103.4.a']);
    expect(rules({ ...SERAPHINE, runes: [{ def: 'mind-rune', n: 6 }, { def: 'fury-rune', n: 6 }] }))
      .toEqual(['103.4.a.1']);
    expect(rules({ ...SERAPHINE, runes: [{ def: 'mind-rune', n: 12 }] })).toEqual([]);   // any split [103.4.a]
    expect(rules({ ...SERAPHINE, runes: [{ def: 'mind-rune', n: 11 }, { def: 'encore', n: 1 }] }))
      .toContain('103.4.a');
  });

  it('103.5 three battlefields with different names', () => {
    expect(rules({ ...SERAPHINE, battlefields: SERAPHINE.battlefields.slice(0, 2) })).toEqual(['103.5.a']);
    expect(rules({ ...SERAPHINE, battlefields: ['valley-of-idols', 'valley-of-idols', 'ruined-monastery'] }))
      .toEqual(['103.5.c']);
    expect(rules({ ...SERAPHINE, battlefields: ['valley-of-idols', 'encore', 'ruined-monastery'] }))
      .toEqual(['103.5']);
  });

  it('TR 601.2.d banned cards and battlefields (Standard list of 2026-09-18)', () => {
    const d = { ...SERAPHINE, battlefields: ['obelisk-of-power', ...SERAPHINE.battlefields.slice(1)] };
    expect(errors(d).map((i) => [i.code, i.rule, i.message])).toEqual(
      [['banned', 'TR 601.2.d', 'Obelisk of Power is banned in Standard Constructed (since 2026-03-31)']]);
    expect(rules(d, 'casual', { format: null })).toEqual([]);                 // no format: no ban list
    const ekko = deckFor('ekko-boy-who-shattered-time', 'ekko-recurrent');
    expect(errors(ekko).map((i) => i.defs)).toContainEqual(['ekko-recurrent']);
  });

  it('TR 601.2.d the 2v2 list also bans Master Yi, Wuju Bladesman', () => {
    const yi = deckFor('master-yi-wuju-bladesman', 'master-yi-honed');
    expect(rules(yi)).toEqual([]);
    expect(rules(yi, 'sanctioned', { format: '2v2' })).toEqual(['TR 601.2.d']);
  });

  it('TR 601.2.d.2 an unmodified precon may keep its banned cards, at low OPL only', () => {
    const banned: DeckList = { ...SERAPHINE, battlefields: ['reavers-row', ...SERAPHINE.battlefields.slice(1)] };
    const o: ValidateOptions = { precons: [banned] };
    expect(isUnmodifiedPrecon({ ...banned, chosenChampion: 'seraphine-not-alone' }, [banned])).toBe(true);
    expect(codes(validateDeck(banned, 'sanctioned', o))).toEqual(['warning banned TR 601.2.d.2']);
    expect(codes(validateDeck(banned, 'sanctioned', { ...o, opl: 'high' }))).toEqual(['error banned TR 601.2.d']);
    const changed = withCopies(withCopies(banned, 'party-crasher', 0), 'supernova', 3);
    expect(codes(validateDeck(changed, 'sanctioned', o))).toEqual(['error banned TR 601.2.d']);
  });

  it('103.1 Neeko asks for up to 3 more legends with different names', () => {
    const base = trim(SERAPHINE, 1);
    const neeko = { ...base, main: [...base.main, { def: 'neeko-blending-in', n: 1 }] };
    const pick = (legends: DefId[]) => ({ ...neeko, extra: { 'neeko-blending-in': legends } });
    expect(rules(neeko)).toEqual([]);                                     // "up to": none is fine
    expect(rules(pick(['jinx-loose-cannon', 'annie-dark-child', 'evelynn-agonys-embrace']))).toEqual([]);
    expect(rules(pick(['jinx-loose-cannon', 'annie-dark-child', 'evelynn-agonys-embrace', 'yasuo-unforgiven'])))
      .toEqual(['103.1']);
    expect(rules(pick(['seraphine-starry-eyed-songstress']))).toEqual(['103.1']);   // the deck's own legend
    expect(rules(pick(['jinx-loose-cannon', 'jinx-loose-cannon']))).toEqual(['103.1']);
    expect(rules(pick(['encore']))).toEqual(['103.1']);
    expect(codes(validateDeck({ ...SERAPHINE, extra: { 'neeko-blending-in': ['jinx-loose-cannon'] } }, 'sanctioned')))
      .toEqual(['warning extraChoices 103.1']);
  });

  it('names unknown cards and bad counts', () => {
    const d = trim(SERAPHINE, 1);
    const bad = validateDeck({ ...d, main: [...d.main, { def: 'no-such-card', n: 1 }, { def: 'supernova', n: 0 }] },
      'sanctioned');
    expect(codes(bad)).toEqual(['error count 103', 'error unknownCard 103']);
    expect(bad[1].defs).toEqual(['no-such-card']);
  });

  it('§9.1 playable decks need every card supported, once the engine can say so', () => {
    const supported = (def: DefId) => def !== 'encore';
    expect(rules(SERAPHINE, 'playable', { supported })).toEqual(['§9.1']);
    expect(errors(SERAPHINE, 'playable', { supported })[0].defs).toEqual(['encore']);
    expect(rules(SERAPHINE, 'sanctioned', { supported })).toEqual([]);
  });
});
