import { describe, expect, it } from 'vitest';
import { hasKeyword, keywordOf, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject } from '../../src/game/state/mut.ts';
import { act, base, bf, control, endTurn, evs, inHand, inTrash, keys, put, reask, runes, ready } from './helpers/scenario.ts';
import { cast, drive, handSize, moveTo, onBoard, RICH, table } from './helpers/cards.ts';

/*
 * The Proving Grounds starter decks (Annie, Garen, Lux, Master Yi): one
 * behaviour test per card at least (cards/defs/ogs.ts).
 */

describe('Proving Grounds: Annie', () => {
  it('Annie, Dark Child: at the end of your turn, ready up to 2 runes', () => {
    const g = table(1, { legends: ['annie-dark-child'] });
    runes(g, 0, [['fury', false], ['fury', false], ['chaos', false]]);
    reask(g);
    act(g, 'end');
    expect(g.s.pending).toMatchObject({ kind: 'target', player: 0 });
    drive(g, [`t:${g.s.players[0].base[0]}`, `t:${g.s.players[0].base[1]}`]);
    expect(g.s.players[0].base.filter((id) => !g.s.objects[id].exhausted)).toHaveLength(2);
  });

  it('Disintegrate: deal 3 to a unit at a battlefield; if this kills it, draw 1', () => {
    const g = table(2);
    control(g, 0, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(0));                 // 3 Might
    const big = put(g, 'mega-mech', 1, bf(0));
    const h = handSize(g);
    cast(g, 'disintegrate', [`t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
    expect(handSize(g)).toBe(h + 1);                                   // it died of it: draw 1
    cast(g, 'disintegrate', [`t:${big}`]);
    expect(g.s.objects[big].damage[0].amount).toBe(3);
    expect(handSize(g)).toBe(h + 1);                                   // it survived: no draw
  });

  it('Gust: return a unit at a battlefield with 3 Might or less to its owner\'s hand', () => {
    const g = table(3);
    control(g, 0, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(0));
    const big = put(g, 'mega-mech', 1, bf(0));
    const id = inHand(g, 'gust');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending?.options.map((o) => o.key)).not.toContain(`t:${big}`);
    drive(g, [`t:${foe}`]);
    expect(g.s.players[1].hand.map((x) => g.s.objects[x].def)).toContain('shipyard-skulker');
  });

  it('Morbid Return: return a unit from your trash to your hand', () => {
    const g = table(4);
    const dead = inTrash(g, 'hunting-dog');
    cast(g, 'morbid-return', [`t:${dead}`]);
    expect(g.s.players[0].hand.map((x) => g.s.objects[x].def)).toContain('hunting-dog');
  });

  it('Sai Scout: Vision (Predict as it is played); may be played to an open battlefield', () => {
    const g = table(5);
    const id = inHand(g, 'sai-scout');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toEqual(expect.arrayContaining(['loc:base', 'loc:bf0', 'loc:bf1']));   // both open
    act(g, 'loc:bf0');
    drive(g);
    expect(evs(g, 'look').length).toBeGreaterThan(0);                  // Vision's Predict [817.1.b]
    expect(onBoard(g, 'sai-scout', 0).map((u) => g.s.objects[u].zone)).toEqual([{ z: 'bf', bf: 0 }]);
  });

  it('Sneaky Deckhand: may be played to an open battlefield, not to one the opponent holds', () => {
    const g = table(6);
    control(g, 1, 1);
    put(g, 'shipyard-skulker', 1, bf(1));
    const id = inHand(g, 'sneaky-deckhand');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf0');
    expect(keys(g)).not.toContain('loc:bf1');
  });

  it('Traveling Merchant: when I move, discard 1, then draw 1', () => {
    const g = table(7);
    const m = put(g, 'traveling-merchant', 0, base(0));
    const h = handSize(g);
    moveTo(g, [m], 0);
    drive(g);
    expect(evs(g, 'discard')).toHaveLength(1);
    expect(handSize(g)).toBe(h);
  });

  it('Maddened Marauder: Tank; when you play me, move a unit from a battlefield to its base', () => {
    const g = table(8);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    cast(g, 'maddened-marauder', [`t:${foe}`]);
    expect(g.s.objects[foe].zone).toEqual({ z: 'base', p: 1 });
    expect(hasKeyword(g.s, onBoard(g, 'maddened-marauder', 0)[0], 'tank')).toBe(true);
  });

  it('Annie, Fiery: your spells and abilities deal 1 Bonus Damage; Void Gate adds 1 to units there', () => {
    const g = table(9, { bfs: ['void-gate'] });
    control(g, 0, 1);
    control(g, 1, 1);
    put(g, 'annie-fiery', 0, base(0));
    const a = put(g, 'mega-mech', 1, bf(0));
    const b = put(g, 'mega-mech', 1, bf(1));
    cast(g, 'incinerate', [`t:${a}`]);
    expect(g.s.objects[a].damage[0].amount).toBe(4);                   // 2 + Annie 1 + Void Gate 1
    cast(g, 'incinerate', [`t:${b}`]);
    expect(g.s.objects[b].damage[0].amount).toBe(3);
  });

  it('Firestorm: deal 3 to all enemy units at a battlefield', () => {
    const g = table(10);
    control(g, 1, 1);
    const f1 = put(g, 'shipyard-skulker', 1, bf(1));
    const f2 = put(g, 'mega-mech', 1, bf(1));
    control(g, 0, 0);
    const mine = put(g, 'mega-mech', 0, bf(0));
    cast(g, 'firestorm', [`t:${g.s.bfs[1].obj}`]);
    expect(g.s.objects[f1]).toBeUndefined();
    expect(g.s.objects[f2].damage[0].amount).toBe(3);
    expect(g.s.objects[mine].damage).toEqual([]);
  });

  it('Incinerate: deal 2 to a unit at a battlefield (not in base)', () => {
    const g = table(11);
    const home = put(g, 'shipyard-skulker', 1, base(1));
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    const id = inHand(g, 'incinerate');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).not.toContain(`t:${home}`);
    drive(g, [`t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(2);
  });

  it('Annie, Stubborn: when you play me, return a spell from your trash to your hand', () => {
    const g = table(12);
    inTrash(g, 'incinerate');
    inTrash(g, 'hunting-dog');
    cast(g, 'annie-stubborn');
    expect(g.s.players[0].hand.map((x) => g.s.objects[x].def)).toContain('incinerate');
    expect(g.s.players[0].trash.map((x) => g.s.objects[x].def)).toEqual(['hunting-dog']);
  });

  it('Flash: move up to 2 friendly units to base', () => {
    const g = table(13);
    control(g, 0, 0);
    const a = put(g, 'shipyard-skulker', 0, bf(0));
    const b = put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'flash', [`t:${a}`, `t:${b}`]);
    expect([g.s.objects[a].zone, g.s.objects[b].zone]).toEqual([base(0), base(0)]);
  });

  it('Tibbers: when you play me, deal 3 to all units at battlefields', () => {
    const g = table(14);
    control(g, 1, 1);
    const f1 = put(g, 'shipyard-skulker', 1, bf(1));
    const home = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'tibbers');
    expect(g.s.objects[f1]).toBeUndefined();
    expect(g.s.objects[home].damage).toEqual([]);
  });

  it('Void Gate: spells and abilities deal 1 Bonus Damage to units here; not combat damage', () => {
    const g = table(15, { bfs: ['void-gate'] });
    control(g, 0, 1);
    const foe = put(g, 'mega-mech', 1, bf(0));
    cast(g, 'incinerate', [`t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(3);
  });
});

describe('Proving Grounds: Garen', () => {
  it('Garen, Might of Demacia: when you conquer with 4+ units at that battlefield, draw 2', () => {
    const g = table(20, { legends: ['garen-might-of-demacia'] });
    const units = [0, 1, 2, 3].map(() => put(g, 'shipyard-skulker', 0, base(0)));
    const h = handSize(g);
    moveTo(g, units, 0);
    drive(g);
    expect(g.s.bfs[0].controller).toBe(0);
    expect(handSize(g)).toBe(h + 2);
  });

  it('Confront: units you play this turn enter ready; draw 1', () => {
    const g = table(21);
    const h = handSize(g);
    cast(g, 'confront');
    expect(handSize(g)).toBe(h + 1);
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[onBoard(g, 'shipyard-skulker', 0)[0]].exhausted).toBe(false);
    endTurn(g); endTurn(g);
    cast(g, 'shipyard-skulker');
    expect(onBoard(g, 'shipyard-skulker', 0).filter((u) => g.s.objects[u].exhausted)).toHaveLength(1);
  });

  it('Crackshot Corsair: when I attack, deal 1 to an enemy unit here', () => {
    const g = table(22);
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    const c = put(g, 'crackshot-corsair', 0, base(0));
    moveTo(g, [c], 1);
    drive(g);
    expect(evs(g, 'deal').some((e) => e.to === foe && e.n === 1 && !e.combat)).toBe(true);
  });

  it('Dune Drake: when I attack, +2 this turn if there is a ready enemy unit here', () => {
    const g = table(23);
    control(g, 1, 1);
    put(g, 'shipyard-skulker', 1, bf(1));
    const d = put(g, 'dune-drake', 0, base(0));
    moveTo(g, [d], 1);
    drive(g);
    expect(evs(g, 'deal').find((e) => e.combat && e.sources.includes(d))?.n).toBe(7);   // 5 + 2
    expect(mightOf(g.s, d)).toBe(7);
  });

  it('First Mate: when you play me, ready another unit', () => {
    const g = table(24);
    const tired = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'first-mate', [`t:${tired}`]);
    expect(g.s.objects[tired].exhausted).toBe(false);
  });

  it('Back to Back: two friendly units each +2 this turn', () => {
    const g = table(25);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const b = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'back-to-back', [`t:${a}`, `t:${b}`]);
    expect([mightOf(g.s, a), mightOf(g.s, b)]).toEqual([5, 5]);
  });

  it('Noxian Drummer: when I move to a battlefield, play a Recruit here', () => {
    const g = table(26);
    const d = put(g, 'noxian-drummer', 0, base(0));
    moveTo(g, [d], 0);
    drive(g);
    expect(onBoard(g, 'recruit', 0).map((u) => g.s.objects[u].zone)).toEqual([{ z: 'bf', bf: 0 }]);
  });

  it('Garen, Commander: other friendly units have +1 here', () => {
    const g = table(27);
    const gar = put(g, 'garen-commander', 0, base(0));
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const away = put(g, 'shipyard-skulker', 0, bf(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    expect([mightOf(g.s, gar), mightOf(g.s, a), mightOf(g.s, away), mightOf(g.s, foe)]).toEqual([5, 4, 3, 3]);
  });

  it('Recruit the Vanguard: play four Recruit tokens', () => {
    const g = table(28);
    cast(g, 'recruit-the-vanguard');
    expect(onBoard(g, 'recruit', 0)).toHaveLength(4);
  });

  it('Vanguard Attendant: I enter ready', () => {
    const g = table(29);
    cast(g, 'vanguard-attendant');
    expect(g.s.objects[onBoard(g, 'vanguard-attendant', 0)[0]].exhausted).toBe(false);
  });

  it('Decisive Strike: friendly units +2 this turn', () => {
    const g = table(30);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'decisive-strike');
    expect([mightOf(g.s, a), mightOf(g.s, foe)]).toEqual([5, 3]);
  });

  it('Trifarian War Camp: units here have +1', () => {
    const g = table(31, { bfs: ['trifarian-war-camp'] });
    const a = put(g, 'shipyard-skulker', 0, bf(0));
    const b = put(g, 'shipyard-skulker', 1, bf(0));
    const c = put(g, 'shipyard-skulker', 1, bf(1));
    expect([mightOf(g.s, a), mightOf(g.s, b), mightOf(g.s, c)]).toEqual([4, 4, 3]);
  });
});

describe('Proving Grounds: Lux', () => {
  it('Lux, Lady of Luminosity: when you play a spell that costs 5 or more, draw 1', () => {
    const g = table(40, { legends: ['lux-lady-of-luminosity'] });
    const foe = put(g, 'mega-mech', 1, base(1));
    const h = handSize(g);
    cast(g, 'final-spark', [`t:${foe}`]);
    expect(handSize(g)).toBe(h + 1);                                   // the legend draws 1
    runes(g, 0, ready('mind', 2));
    const foe2 = put(g, 'mega-mech', 1, base(1));
    cast(g, 'stupefy', [`t:${foe2}`]);
    expect(handSize(g)).toBe(h + 2);                                   // Stupefy's own draw; not the legend's
  });

  it('Eager Apprentice: at a battlefield, your spells cost 1 less, to a minimum of 1', () => {
    const g = table(41);
    control(g, 0, 0);
    put(g, 'eager-apprentice', 0, bf(0));
    const foe = put(g, 'mega-mech', 1, base(1));
    const id = inHand(g, 'final-spark');
    reask(g);
    act(g, `play:${id}`);
    act(g, `t:${foe}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 7 } });
    act(g, 'back');
    const st = inHand(g, 'stupefy');
    reask(g);
    act(g, `play:${st}`);
    act(g, `t:${foe}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });   // 1 stays 1
  });

  it('Falling Comet: deal 6 to a unit at a battlefield', () => {
    const g = table(42);
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    cast(g, 'falling-comet', [`t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(6);
  });

  it('Lecturing Yordle: Tank; when you play me, draw 1', () => {
    const g = table(43);
    const h = handSize(g);
    cast(g, 'lecturing-yordle');
    expect(handSize(g)).toBe(h + 1);
  });

  it('Stupefy: -1 this turn, to a minimum of 1; draw 1', () => {
    const g = table(44);
    const one = put(g, 'recruit', 1, base(1));
    const three = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'stupefy', [`t:${one}`]);
    cast(g, 'stupefy', [`t:${three}`]);
    expect([mightOf(g.s, one), mightOf(g.s, three)]).toEqual([1, 2]);
  });

  it('Ravenbloom Student: when you play a spell, +1 this turn', () => {
    const g = table(45);
    const st = put(g, 'ravenbloom-student', 0, base(0));
    cast(g, 'confront');
    expect(mightOf(g.s, st)).toBe(3);
  });

  it('Singularity: deal 6 to each of up to two units', () => {
    const g = table(46);
    const a = put(g, 'mega-mech', 1, base(1));
    const b = put(g, 'mega-mech', 1, base(1));
    cast(g, 'singularity', [`t:${a}`, `t:${b}`]);
    expect([g.s.objects[a].damage[0].amount, g.s.objects[b].damage[0].amount]).toEqual([6, 6]);
  });

  it('Lux, Illuminated: when you play a spell that costs 5 or more, +3 this turn', () => {
    const g = table(47);
    const lux = put(g, 'lux-illuminated', 0, base(0));
    const foe = put(g, 'mega-mech', 1, base(1));
    cast(g, 'final-spark', [`t:${foe}`]);
    expect(mightOf(g.s, lux)).toBe(8);
  });

  it('Blast of Power: kill a unit at a battlefield', () => {
    const g = table(48);
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    cast(g, 'blast-of-power', [`t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
  });

  it('Lux, Crownguard: [Reaction] [E]: Add [2], only for spells', () => {
    const g = table(49);
    runes(g, 0, ready('order', 1));
    const cg = put(g, 'lux-crownguard', 0, base(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const st = inHand(g, 'stupefy');
    const unitCard = inHand(g, 'mega-mech');
    reask(g);
    act(g, `act:${cg}#0`);
    expect(g.s.players[0].pool.restricted).toEqual([{ amount: 2, kind: 'energy', onlyFor: 'spells', source: 'lux-crownguard' }]);
    expect(g.s.chain).toEqual([]);                                     // an Add: resolved at once [430.2]
    expect(keys(g)).not.toContain(`play:${unitCard}`);
    act(g, `play:${st}`);
    act(g, `t:${foe}`);
    drive(g);
    expect(g.s.players[0].pool.restricted).toEqual([{ amount: 1, kind: 'energy', onlyFor: 'spells', source: 'lux-crownguard' }]);
  });

  it('Final Spark: deal 8 to a unit', () => {
    const g = table(50);
    const foe = put(g, 'mega-mech', 1, base(1));
    cast(g, 'final-spark', [`t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
  });

  it('Startipped Peak: when you hold here, you may channel 1 rune exhausted', () => {
    const g = table(51, { bfs: ['startipped-peak'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const n = g.s.players[0].base.length;
    endTurn(g); endTurn(g);
    drive(g);
    expect(evs(g, 'channel').some((e) => e.rule === '431')).toBe(true);
    expect(g.s.players[0].base.length).toBeGreaterThan(n);
  });
});

describe('Proving Grounds: Master Yi', () => {
  it('Master Yi, Wuju Bladesman: a friendly unit defending alone gets +2', () => {
    const g = table(60, { legends: [undefined, 'master-yi-wuju-bladesman'] });
    control(g, 1, 1);
    const def = put(g, 'shipyard-skulker', 1, bf(1));
    const att = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [att], 1);
    expect(mightOf(g.s, def)).toBe(5);
    drive(g);
    expect(g.s.objects[att]).toBeUndefined();
  });

  it('En Garde: +1, and +1 more if it is the only unit you control there', () => {
    const g = table(61);
    const lone = put(g, 'shipyard-skulker', 0, bf(0));
    const a = put(g, 'shipyard-skulker', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'en-garde', [`t:${lone}`]);
    cast(g, 'en-garde', [`t:${a}`]);
    expect([mightOf(g.s, lone), mightOf(g.s, a)]).toEqual([5, 4]);
  });

  it('Meditation: may exhaust a friendly unit as an additional cost: draw 2, otherwise 1', () => {
    const g = table(62);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g);
    cast(g, 'meditation', ['yes', `pick:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(true);
    expect(handSize(g)).toBe(h + 2);
    cast(g, 'meditation', ['no']);
    expect(handSize(g)).toBe(h + 3);
  });

  it('Wielder of Water: +2 while attacking or defending alone', () => {
    const g = table(63);
    control(g, 1, 1);
    put(g, 'mega-mech', 1, bf(1));
    const w = put(g, 'wielder-of-water', 0, base(0));
    expect(mightOf(g.s, w)).toBe(2);
    moveTo(g, [w], 1);
    expect(mightOf(g.s, w)).toBe(4);
  });

  it('Cannon Barrage: deal 2 to all enemy units in combat', () => {
    const g = table(64);
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    const away = put(g, 'mega-mech', 1, base(1));
    const att = put(g, 'mega-mech', 0, base(0));
    const id = inHand(g, 'cannon-barrage');
    moveTo(g, [att], 1);
    expect(g.s.pending).toMatchObject({ kind: 'priority', prompt: { window: 'showdown' }, player: 0 });
    act(g, `play:${id}`);
    drive(g);
    expect(evs(g, 'deal').filter((e) => !e.combat).map((e) => [e.to, e.n])).toEqual([[foe, 2]]);
    expect(g.s.objects[away].damage).toEqual([]);
  });

  it('Mobilize: channel 1 rune exhausted; if you can\'t, draw 1', () => {
    const g = table(65);
    const n = g.s.players[0].base.length;
    cast(g, 'mobilize');
    expect(g.s.players[0].base.length).toBe(n + 1);
    for (const id of g.s.players[0].runeDeck.slice()) moveObject(g.s, id, base(0), { exhausted: true });
    runes(g, 0, RICH);
    for (const id of g.s.players[0].runeDeck.slice()) moveObject(g.s, id, { z: 'trash', p: 0 });
    const h = handSize(g);
    cast(g, 'mobilize');
    expect(handSize(g)).toBe(h + 1);
  });

  it('Stormclaw Ursine: Tank; when you play me, channel 1 rune exhausted', () => {
    const g = table(66);
    const n = g.s.players[0].base.length;
    cast(g, 'stormclaw-ursine');
    expect(g.s.players[0].base.length).toBe(n + 2);                     // the unit and a rune
  });

  it('Master Yi, Meditative: +4 while you have 8+ runes', () => {
    const g = table(67);
    const yi = put(g, 'master-yi-meditative', 0, base(0));
    expect(mightOf(g.s, yi)).toBe(8);
    runes(g, 0, ready('calm', 7));
    expect(mightOf(g.s, yi)).toBe(4);
  });

  it('Gentlemen\'s Duel: +3 to a friendly unit, then it and an enemy unit deal their Might to each other', () => {
    const g = table(68);
    const me = put(g, 'shipyard-skulker', 0, base(0));
    const foe = put(g, 'mega-mech', 1, base(1));
    cast(g, 'gentlemens-duel', [`t:${me}`, `t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(6);                 // 3 + 3
    expect(g.s.objects[me]).toBeUndefined();                           // 8 back
    const big = put(g, 'mega-mech', 0, base(0));
    const small = put(g, 'shipyard-skulker', 1, base(1));
    runes(g, 0, RICH);
    cast(g, 'gentlemens-duel', [`t:${big}`, `t:${small}`]);
    expect(g.s.objects[small]).toBeUndefined();
    expect(g.s.objects[big].damage[0].amount).toBe(3);
  });

  it('Master Yi, Honed: Ganking; I enter ready', () => {
    const g = table(69);
    cast(g, 'master-yi-honed');
    const yi = onBoard(g, 'master-yi-honed', 0)[0];
    expect(g.s.objects[yi].exhausted).toBe(false);
    expect(hasKeyword(g.s, yi, 'ganking')).toBe(true);
  });

  it('Highlander: the next time it would die this turn, heal, exhaust and recall it instead', () => {
    const g = table(70);
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'highlander', [`t:${u}`]);
    cast(g, 'final-spark', [`t:${u}`]);
    expect(g.s.objects[u]).toMatchObject({ zone: base(0), exhausted: true, damage: [] });
    runes(g, 0, RICH);
    cast(g, 'final-spark', [`t:${u}`]);
    expect(g.s.objects[u]).toBeUndefined();                            // only the next time
  });

  it('Fortified Position: when you defend here, a unit gains Shield 2 this combat', () => {
    const g = table(71, { bfs: [undefined, 'fortified-position'] });
    control(g, 1, 1);
    const def = put(g, 'shipyard-skulker', 1, bf(1));
    const att = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [att], 1);
    drive(g, [`t:${def}`]);
    expect(g.s.objects[att]).toBeUndefined();
    expect(keywordOf(g.s, def, 'shield')).toBe(0);                     // this combat only
  });
});
