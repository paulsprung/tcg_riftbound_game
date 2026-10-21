import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import {
  buildOracle, formatOracle, normalizeText, OracleBuildError, parseCost, parseKeywordLine, slug, stripReminders,
} from '../../scripts/cards/oracle-build.ts';
import { banOf, FORMATS, isReleased, STANDARD_SETS } from '../../src/game/cards/legality.ts';
import {
  deckLimit, defOfPrinting, findCard, isChampionUnit, isSignature, ORACLE, oracleCard, printedKeywords,
  type OracleCard,
} from '../../src/game/cards/oracle.ts';
import { OVERRIDES } from '../../src/game/cards/overrides.ts';
import { BASIC_RUNE_TEXT, BASIC_RUNES } from '../../src/game/cards/runes.ts';
import { TOKEN_IDS, TOKENS } from '../../src/game/cards/tokens.ts';
import { EngineError } from '../../src/game/core/errors.ts';

/*
 * The oracle (§9.1): built from public/data/cards.json by
 * scripts/cards/build-oracle.ts and committed as oracle.gen.json. These
 * tests check that the committed file is current, that every override row
 * is still needed, and the oracle rows the engine relies on: names, text,
 * costs, keyword lines, deck rules, runes [164.2], tokens [187], bans.
 */

const cardsJson = readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8');
const committed = readFileSync(new URL('../../src/game/cards/oracle.gen.json', import.meta.url), 'utf8');
const db: CardDb = JSON.parse(cardsJson);
const built = buildOracle(cardsJson);
const card = (def: string): OracleCard => oracleCard(def);
const lines = (text: string) => text.split('\n');

describe('the generated oracle', () => {
  it('was built from the current cards.json (else run `npm run build-oracle`)', () => {
    expect(ORACLE.source.sha256).toBe(createHash('sha256').update(cardsJson).digest('hex'));
    expect(ORACLE.source.printings).toBe(db.cards.length);
  });

  it('is what the build script makes today, byte for byte', () => {
    expect(formatOracle(built.file)).toBe(committed);
  });

  it('builds without warnings', () => {
    expect(built.warnings).toEqual([]);
  });

  it('has one record per card name, tokens left out [185]', () => {
    expect(ORACLE.cards.length).toBeGreaterThan(1000);
    expect(new Set(ORACLE.cards.map((c) => c.name.toLowerCase())).size).toBe(ORACLE.cards.length);
    const tokens = db.cards.filter((c) => c.supertype === 'Token' || c.type === 'Token');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((c) => defOfPrinting(c.id)).map((c) => c.id)).toEqual([]);
    const others = db.cards.filter((c) => !tokens.includes(c));
    expect(others.filter((c) => !defOfPrinting(c.id)).map((c) => c.id)).toEqual([]);
  });

  it('looks cards up by id and by printing', () => {
    expect(defOfPrinting('rad-152-167')).toBe('encore');
    expect(card('encore').printings).toContain('rad-152-167');
    expect(findCard('no-such-card')).toBeUndefined();
    expect(findCard('constructor')).toBeUndefined();
    expect(() => oracleCard('no-such-card')).toThrow(EngineError);
  });
});

describe('override rows (each asserts it is still needed)', () => {
  it.each(OVERRIDES.map((r) => [r.id, r] as const))('%s is applied', (id, row) => {
    expect(card(row.def).fixes).toContain(id);
  });

  it('a row the data no longer needs stops the build', () => {
    const fixed = cardsJson.replace('play four to your base instead.disa', 'play four to your base instead.');
    expect(fixed).not.toBe(cardsJson);
    expect(() => buildOracle(fixed)).toThrow(OracleBuildError);
    expect(() => buildOracle(fixed)).toThrow(/rousing-display-disa is redundant/);
  });

  it('fix the data as each row says', () => {
    expect(card('rousing-display').text).toMatch(/play four to your base instead\.$/);
    expect(card('wraith-of-echoes').rules).toBe('The first time another friendly unit dies each turn, draw 1.');
    expect(card('patched-porobot').types).toEqual(['unit', 'gear']);
    expect(card('laurent-bladekeeper').rules).toBe('[Ganking]');
    expect(card('windsinger').keywords[0].keywords).toEqual([{ kw: 'hidden' }]);
    expect(printedKeywords(card('jagged-cutlass'))).toEqual([{ kw: 'equip', costs: [{ energy: 0,
      power: [{ k: 'domain', d: 'body' }] }] }]);
  });
});

describe('132 canonical names and DefIds', () => {
  it.each([
    ['rad-151-167', 'Seraphine, Starry-Eyed Songstress', 'seraphine-starry-eyed-songstress'],   // legend: subtitle only
    ['rad-153-167', "Evelynn, Agony's Embrace", 'evelynn-agonys-embrace'],
    ['ogs-017-024', 'Annie, Dark Child', 'annie-dark-child'],                                    // "Dark Child, Starter"
    ['opp-019-024', 'Master Yi, Wuju Bladesman', 'master-yi-wuju-bladesman'],                    // "… (Metal)"
    ['opp-193-221', 'Jax, Grandmaster at Arms', 'jax-grandmaster-at-arms'],                      // "At" in the promo
    ['opp-187-221', "Rek'Sai, Void Burrower", 'reksai-void-burrower'],                           // "Rek'sai - …"
    ['opp-120-219', 'Rengar, Trophy Hunter', 'rengar-trophy-hunter'],                            // "Rengar - Trophy Hunter"
    ['ogs-018-024', 'Tibbers', 'tibbers'],                                                       // "Tibbers, Annie"
    ['ogs-020-024', 'Highlander', 'highlander'],                                                 // "Highlander, Yi"
    ['ogn-252-298', 'Super Mega Death Rocket!', 'super-mega-death-rocket'],
    ['rad-086-167', "K'Sante, Courageous", 'ksante-courageous'],
    ['rad-070-167', "Hold 'Em", 'hold-em'],
    ['rad-117-167', 'For Demacia!', 'for-demacia'],
  ])('%s is %s (%s)', (printing, name, def) => {
    expect(defOfPrinting(printing)).toBe(def);
    expect(card(def).name).toBe(name);
  });

  it('keeps the data spellings for search', () => {
    expect(card('master-yi-wuju-bladesman').printedNames).toEqual(
      ['Wuju Bladesman, Starter', 'Master Yi - Wuju Bladesman (Metal)']);
    expect(card('encore').printedNames).toBeUndefined();
  });

  it('a DefId is the slug of the name', () => {
    for (const c of ORACLE.cards) expect(slug(c.name)).toBe(c.id);
    expect(slug('Kai’Sa, Daughter of the Void')).toBe('kaisa-daughter-of-the-void');
  });

  it('133.8.b legends, champion units and Signature cards carry their champion tag', () => {
    const legends = ORACLE.cards.filter((c) => c.types.includes('legend'));
    const tags = new Set(legends.map((c) => c.championTag));
    expect(legends.filter((c) => !c.championTag || !c.name.startsWith(`${c.championTag}, `))).toEqual([]);
    expect(ORACLE.cards.filter(isChampionUnit).filter((c) => !c.name.startsWith(`${c.championTag}, `))).toEqual([]);
    expect(ORACLE.cards.filter(isSignature).filter((c) => !tags.has(c.championTag))).toEqual([]);
    expect(card('heimerdinger-academy-instructor').championTag).toBe('Heimerdinger');   // tags: Yordle, …
  });

  it('133.7.a only units are champions; legends have no supertype', () => {
    expect(ORACLE.cards.filter((c) => c.supertypes.includes('champion') && !c.types.includes('unit'))).toEqual([]);
    expect(card('seraphine-starry-eyed-songstress').supertypes).toEqual([]);
  });
});

describe('oracle text', () => {
  it('is the errata where Riot has one', () => {
    expect(card('last-caress').source).toBe('errata');
    expect(card('last-caress').rules).toContain('The next unit you play this turn, even from face down, can be');
    expect(card('elnuk-herd').rules).toContain('give a friendly unit +3 [M] this turn');
    expect(card('neeko-blending-in').rules).toContain('choose up to 3 different legends');
  });

  it('is the newest printing\'s wording otherwise', () => {
    expect(card('sett-brawler').rules).toMatch(/^When you play me or when I conquer, buff me\./);   // VEN reprint
    expect(card('viktor-innovator').rules).toContain('Recruit unit token to your base.');
    expect(card('sett-brawler').source).toBe('printing');
  });

  it('135.2.d.3 keeps reminder text for display and drops it from the rules text', () => {
    // The newest printing has no reminder text; the display comes from one with the same wording that has it.
    expect(card('pouty-poro').printings[0]).toBe('ogn-013-298');
    expect(card('pouty-poro').text).toBe('[Deflect] (Opponents must pay [A] to choose me with a spell or ability.)');
    expect(card('pouty-poro').rules).toBe('[Deflect]');
    expect(stripReminders('[Hidden] (Hide now (later: [0]).)\nDraw 1. (Then rest.)')).toBe('[Hidden]\nDraw 1.');
  });

  it('135.2.e writes symbols in rules notation', () => {
    expect(normalizeText(':rb_energy_2::rb_rune_order: :rb_might: :rb_exhaust: :rb_rune_rainbow:'))
      .toBe('[2][Y] [M] [E] [A]');
    expect(normalizeText(':rb_rune_fury::rb_rune_calm::rb_rune_mind::rb_rune_body::rb_rune_chaos:'))
      .toBe('[R][G][B][O][P]');
    expect(card('high-note').rules).toContain('Give a unit -[M] this turn');
  });

  it('727 normalizes the keyword separators to [>]', () => {
    expect(card('noxus-hopeful').rules).toBe('[Legion][>] I cost [2] less.');
    expect(lines(card('tasty-faefolk').rules)[1]).toBe('[Deathknell][>] Channel 2 runes exhausted and draw 1.');
    expect(normalizeText('[Deathknell][&gt;] Draw 1.')).toBe('[Deathknell][>] Draw 1.');
  });

  it('rewrites the older "[E]: [Reaction] — X" template as "[Reaction][>] [E]: X"', () => {
    expect(card('seal-of-rage').rules).toBe('[Reaction][>] [E]: [Add] [R].');
    expect(card('sun-disc').rules).toBe('[Legion][>] [E]: The next unit you play this turn enters ready.');
  });

  it('355.3 puts each mode on its own line', () => {
    expect(lines(card('encore').rules)).toEqual([
      'Choose two —',
      '• Deal 2 to a unit.',
      '• Play two 1 [M] Recruit unit tokens.',
      '• Give up to two units each +1 [M] this turn.',
      '• Look at the top 2 cards of your Main Deck, draw 1 and recycle the other.',
    ]);
    expect(lines(card('reckless-innovator').rules).slice(1)).toEqual(
      ['When I become exhausted, choose one —', '• Play a Gold gear token exhausted.', '• Pay [P] to draw 1.']);
    expect(lines(card('twisted-fate-gambler').rules)[2]).toBe('• [B] — Draw 1.');
  });
});

describe('131 costs and Power symbols', () => {
  it('a single-domain card pays its own domain', () => {
    expect(card('supernova').cost).toEqual({ energy: 9, power: [{ k: 'domain', d: 'mind' }] });
    expect(card('hush').cost).toEqual({ energy: 1, power: [{ k: 'domain', d: 'calm' }, { k: 'domain', d: 'calm' }] });
    expect(card('rousing-display').cost).toEqual({ energy: 5, power: [] });
  });

  it('135.2.e.6.c a multi-domain card pays any one of its domains', () => {
    expect(card('encore').cost).toEqual({ energy: 3, power: [{ k: 'anyOf', ds: ['mind', 'order'] }] });
    expect(card('tibbers').cost!.power).toHaveLength(2);
  });

  it('135.2.e.6.b a card without a domain pays any domain', () => {
    expect(card('neeko-blending-in').domains).toEqual([]);
    expect(card('neeko-blending-in').cost!.power).toEqual([{ k: 'any' }]);
  });

  it('legends, runes and battlefields have no cost; units have Might, Equipment a Might bonus [137]', () => {
    for (const def of ['seraphine-starry-eyed-songstress', 'mind-rune', 'valley-of-idols']) {
      expect(card(def).cost).toBeUndefined();
    }
    expect(card('seraphine-not-alone').might).toBe(1);
    expect(card('long-sword').mightBonus).toBe(2);
    expect(card('concert-poster').mightBonus).toBeUndefined();
  });

  it('parses printed costs', () => {
    const any = { k: 'any' } as const;
    expect(parseCost('[1][G]', any)).toEqual({ energy: 1, power: [{ k: 'domain', d: 'calm' }] });
    expect(parseCost('[1], [E]', any)).toEqual({ energy: 1, power: [], exhaust: true });
    expect(parseCost('[Y], Kill a friendly unit', any))
      .toEqual({ energy: 0, power: [{ k: 'domain', d: 'order' }], other: ['Kill a friendly unit'] });
    expect(parseCost('[1][C][C]', { k: 'domain', d: 'fury' }).power).toEqual(
      [{ k: 'domain', d: 'fury' }, { k: 'domain', d: 'fury' }]);
  });
});

describe('803 keyword lines', () => {
  const kws = (def: string) => card(def).keywords;

  it('reads plain keywords and their values (X defaults to 1)', () => {
    expect(kws('mutated-mouser')).toEqual([
      { line: 0, keywords: [{ kw: 'shield', value: 2 }] }, { line: 1, keywords: [{ kw: 'tank' }] }]);
    expect(kws('garen-rugged')).toEqual([{ line: 0, keywords: [{ kw: 'assault', value: 2 }, { kw: 'shield', value: 2 }] }]);
    expect(kws('pouty-poro')).toEqual([{ line: 0, keywords: [{ kw: 'deflect', value: 1 }] }]);
    expect(printedKeywords(card('long-sword')).map((k) => k.kw)).toEqual(['quickDraw', 'equip']);
  });

  it('808 keeps the ability after [>]', () => {
    expect(kws('hunting-dog')).toEqual([{ line: 0, keywords: [{ kw: 'deathknell', joined: true }],
      body: 'Play a 1 [M] Bird unit token with [Deflect] to your base.' }]);
    expect(kws('dramatic-visionary').at(-1)!.body).toBe('[Predict 2].');
  });

  it('727.1.b.3 joins dependent keywords chained by [>>]', () => {
    expect(kws('baccai-witherclaw')[2]).toEqual({ line: 2,
      keywords: [{ kw: 'empowered', joined: true }, { kw: 'deathknell', joined: true }],
      body: 'Channel 2 runes exhausted.' });
    expect(kws('honeyfruit')[1]).toEqual({ line: 2,
      keywords: [{ kw: 'level', value: 6, joined: true }, { kw: 'reaction', joined: true }], body: '[E]: [Add] [1][A].' });
    expect(parseKeywordLine('[Level 11][>>][Legion][>] When you conquer, gain 1 point.', 0, { k: 'any' })).toEqual({
      line: 0, keywords: [{ kw: 'level', value: 11, joined: true }, { kw: 'legion', joined: true }],
      body: 'When you conquer, gain 1 point.' });
    // A keyword before the dependent one stands alone.
    expect(kws('gustwalker')).toEqual([{ line: 0, keywords: [{ kw: 'hunt', value: 2 }] },
      { line: 1, keywords: [{ kw: 'level', value: 3, joined: true }], body: 'I have +1 [M] and [Ganking].' }]);
  });

  it('818 / 820 / 827 / 829 read keyword costs: alternatives, Repeat costs, the sentence after a cost', () => {
    expect(printedKeywords(card('legion-marauder'))[0]).toEqual({ kw: 'empower', costs: [
      { energy: 1, power: [] }, { energy: 0, power: [{ k: 'domain', d: 'body' }] }] });
    expect(printedKeywords(card('curtain-call')).map((k) => k.costs)).toEqual([
      [{ energy: 1, power: [] }], [{ energy: 0, power: [{ k: 'any' }] }], [{ energy: 1, power: [{ k: 'any' }] }]]);
    expect(printedKeywords(card('blade-of-the-ruined-king'))[0].costs).toEqual(
      [{ energy: 0, power: [{ k: 'domain', d: 'order' }], other: ['Kill a friendly unit'] }]);
    expect(kws('frostcoat-mother')[0]).toEqual({ line: 0, keywords: [{ kw: 'empower', costs: [{ energy: 12, power: [] }] }],
      body: 'This ability costs [1] less for each rune you control.' });
    expect(printedKeywords(card('brittle-steel'))).toEqual(
      [{ kw: 'flow', costs: [{ energy: 4, power: [{ k: 'domain', d: 'fury' }] }] }]);
  });

  it('832 keeps what Show Off asks for', () => {
    expect(printedKeywords(card('rousing-display'))).toEqual([{ kw: 'showOff', arg: 'a card with Energy cost [7] or more' }]);
    expect(printedKeywords(card('incorrigible-construct'))).toEqual([{ kw: 'showOff', arg: 'a Mech' }]);
  });

  it('a keyword granted by a mode, or used as a noun, is not a printed keyword', () => {
    expect(kws('jayce-hammer-in-hand')).toEqual([]);
    expect(kws('risen-altar')).toEqual([]);
    expect(parseKeywordLine('Give a unit [Shield 2] this turn.', 0, { k: 'any' })).toBeNull();
  });
});

describe('deck rules in card text', () => {
  it('825.3.a Unique allows one copy', () => {
    expect(card('forgefire-cape').deck).toEqual(['unique']);
    expect(deckLimit(card('forgefire-cape'))).toBe(1);
  });

  it('a card may allow any number of copies (Spiderling)', () => {
    expect(deckLimit(card('spiderling'))).toBe(Infinity);
  });

  it('103.3.b three copies otherwise', () => {
    expect(deckLimit(card('encore'))).toBe(3);
  });

  it('103.1 Neeko asks for up to 3 more legends (errata)', () => {
    expect(card('neeko-blending-in').deck).toEqual([{ extraLegends: 3 }]);
  });
});

describe('164.2 basic runes', () => {
  it.each(Object.entries(BASIC_RUNES))('%s has the two rune abilities', (def, domain) => {
    const rune = card(def);
    expect(rune.types).toEqual(['rune']);
    expect(rune.supertypes).toEqual(['basic']);
    expect(rune.domains).toEqual([domain]);
    expect(rune.text).toBe(BASIC_RUNE_TEXT);
    expect(rune.source).toBe('rule');
    expect(rune.keywords.map((l) => [l.keywords, l.body])).toEqual([
      [[{ kw: 'reaction', joined: true }], '[E]: Add [1].'],
      [[{ kw: 'reaction', joined: true }], 'Recycle this: Add [C].'],
    ]);
  });

  it('there are exactly six basic runes and no other runes [164.1]', () => {
    expect(ORACLE.cards.filter((c) => c.types.includes('rune')).map((c) => c.id).sort())
      .toEqual(Object.keys(BASIC_RUNES).sort());
  });
});

describe('187 token templates', () => {
  it('has the twelve tokens of [187.1]–[187.12]', () => {
    expect(TOKEN_IDS).toHaveLength(12);
    expect(TOKEN_IDS.map((t) => TOKENS[t].rule)).toEqual(Array.from({ length: 12 }, (_, i) => `187.${i + 1}`));
    for (const t of TOKEN_IDS) expect(TOKENS[t].id).toBe(t);
  });

  it.each([
    ['recruit', 'unit', 1, ['Recruit'], []],
    ['sprite', 'unit', 3, ['Fae'], ['temporary']],
    ['sandSoldier', 'unit', 2, ['Shurima'], []],
    ['mech', 'unit', 3, ['Mech'], []],
    ['gold', 'gear', undefined, [], []],
    ['reflection', 'unit', 0, [], []],
    ['bird', 'unit', 1, ['Bird'], ['deflect']],
    ['brush', 'battlefield', undefined, [], []],
    ['baronPit', 'battlefield', undefined, [], []],
    ['tentacle', 'unit', 1, ['Bilgewater'], []],
    ['shadowClone', 'unit', 0, [], []],
    ['bomb', 'gear', undefined, [], ['deploy', 'deathknell']],
  ] as const)('%s: %s, Might %s, tags %j, keywords %j', (id, type, might, tags, keywords) => {
    const t = TOKENS[id];
    expect([t.type, t.might, t.tags, t.keywords]).toEqual([type, might, tags, keywords]);
  });

  it('gives Gold its Add ability [187.5]', () => {
    expect(TOKENS.gold.text).toBe('[Reaction][>] Kill this, [E]: [Add] [A].');
  });

  it('no card shares an id with a token', () => {
    expect(TOKEN_IDS.filter((t) => findCard(t))).toEqual([]);
  });

  it('has art for every token but the Tentacle, from token records only', () => {
    const ids = new Set([...db.cards, ...(db.tokenFaces ?? [])].map((c) => c.id));
    for (const t of TOKEN_IDS) {
      expect(ORACLE.tokenArt[t].filter((p) => !ids.has(p))).toEqual([]);
      expect(ORACLE.tokenArt[t].filter((p) => defOfPrinting(p))).toEqual([]);
    }
    expect(TOKEN_IDS.filter((t) => ORACLE.tokenArt[t].length === 0)).toEqual(['tentacle']);
    expect(ORACLE.tokenArt.recruit[0]).toBe('ven-t04');                 // the single face first
  });
});

describe('format legality (TR 601)', () => {
  it('601.3.c Standard is OGS, OGN, SFD, UNL, VEN and RAD; every card has a printing in one', () => {
    expect(STANDARD_SETS).toEqual(['ogs', 'ogn', 'sfd', 'unl', 'ven', 'rad']);
    expect(ORACLE.cards.filter((c) => !c.sets.some((s) => STANDARD_SETS.includes(s))).map((c) => c.id)).toEqual([]);
  });

  it('601.3.c.6.a Radiance is legal from October 23rd, 2026', () => {
    expect(isReleased('rad', '2026-10-22')).toBe(false);
    expect(isReleased('rad', '2026-10-23')).toBe(true);
    expect(isReleased('ven', '2026-10-21')).toBe(true);
  });

  it('601.2.d every banned card is a card of the kind the list says (lists of 2026-09-18)', () => {
    for (const f of Object.values(FORMATS)) {
      for (const ban of f.bans) {
        const c = card(ban.def);
        const kind = c.types.includes('battlefield') ? 'battlefield' : c.types.includes('legend') ? 'legend' : 'card';
        expect([ban.def, kind]).toEqual([ban.def, ban.kind]);
        expect(c.name.replace(/^The /, '')).toBe(ban.listed.replace(/^The /, ''));
      }
    }
    expect(FORMATS.standard.bans).toHaveLength(12);
    expect(FORMATS['2v2'].bans.map((b) => b.def)).toEqual([...FORMATS.standard.bans.map((b) => b.def),
      'master-yi-wuju-bladesman']);
    expect(banOf('standard', 'master-yi-wuju-bladesman')).toBeUndefined();
    expect(banOf('standard', 'ekko-recurrent')?.since).toBe('2026-09-18');
  });
});
