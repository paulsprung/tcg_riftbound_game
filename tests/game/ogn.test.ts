import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, reask, runes, ready } from './helpers/scenario.ts';
import { cast, drive, handSize, hide, moveTo, nextTurn, onBoard, opt, RICH, table } from './helpers/cards.ts';

/*
 * The Origins Champion Decks (Jinx, Lee Sin, Viktor): one behaviour test per
 * card at least (cards/defs/ogn.ts).
 */

const defsIn = (g: ReturnType<typeof table>, z: 'hand' | 'trash', p: 0 | 1 = 0) => g.s.players[p][z].map((x) => g.s.objects[x].def);

describe('Origins: Jinx', () => {
  it('Jinx, Loose Cannon: at the start of your Beginning Phase, draw 1 if you have one or fewer cards', () => {
    const g = table(101, { legends: ['jinx-loose-cannon'] });
    for (const id of g.s.players[0].hand.slice()) moveObject(g.s, id, { z: 'trash', p: 0 });
    nextTurn(g);
    expect(handSize(g)).toBe(2);                                        // the legend's 1, then the Draw Phase's 1
    nextTurn(g);
    expect(handSize(g)).toBe(3);                                        // 2 in hand: no extra draw
  });

  it('Brazen Buccaneer: may discard 1 as an additional cost to cost [2] less', () => {
    const g = table(102);
    const id = inHand(g, 'brazen-buccaneer');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    expect(g.s.pending).toMatchObject({ kind: 'costObject', prompt: { what: 'discard' } });
    act(g, g.s.pending!.options[0].key);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
    drive(g);
    expect(evs(g, 'discard')).toHaveLength(1);
    expect(onBoard(g, 'brazen-buccaneer', 0)).toHaveLength(1);
  });

  it('Chemtech Enforcer: Assault 2; when you play me, discard 1', () => {
    const g = table(103);
    cast(g, 'chemtech-enforcer');
    expect(evs(g, 'discard')).toHaveLength(1);
    const u = onBoard(g, 'chemtech-enforcer', 0)[0];
    setField(g.s, g.s.objects[u], 'designation', 'attacker');
    expect(mightOf(g.s, u)).toBe(4);
  });

  it('Flame Chompers: when you discard me, you may pay [R] to play me', () => {
    const g = table(104);
    for (const id of g.s.players[0].hand.slice()) moveObject(g.s, id, { z: 'trash', p: 0 });
    inHand(g, 'flame-chompers');
    cast(g, 'chemtech-enforcer', ['yes']);
    expect(onBoard(g, 'flame-chompers', 0)).toHaveLength(1);
  });

  it('Get Excited: discard 1, deal its Energy cost to a unit at a battlefield', () => {
    const g = table(105);
    for (const id of g.s.players[0].hand.slice()) moveObject(g.s, id, { z: 'trash', p: 0 });
    const card = inHand(g, 'mega-mech');                               // Energy 7
    control(g, 1, 1);
    const foe = put(g, 'mountain-drake', 1, bf(1));
    cast(g, 'get-excited', [`t:${foe}`, `pick:${card}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(7);
  });

  it('Magma Wurm: other friendly units enter ready', () => {
    const g = table(106);
    put(g, 'magma-wurm', 0, base(0));
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[onBoard(g, 'shipyard-skulker', 0)[0]].exhausted).toBe(false);
    const g2 = table(161);
    cast(g2, 'magma-wurm');
    expect(g2.s.objects[onBoard(g2, 'magma-wurm', 0)[0]].exhausted).toBe(true);   // not itself
  });

  it('Raging Soul: Assault and Ganking once you discarded a card this turn', () => {
    const g = table(107);
    const r = put(g, 'raging-soul', 0, base(0));
    expect(hasKeyword(g.s, r, 'ganking')).toBe(false);
    cast(g, 'chemtech-enforcer');
    expect([hasKeyword(g.s, r, 'ganking'), hasKeyword(g.s, r, 'assault')]).toEqual([true, true]);
  });

  it('Void Seeker: deal 4 to a unit at a battlefield, draw 1', () => {
    const g = table(108);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    const h = handSize(g);
    cast(g, 'void-seeker', [`t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
    expect(handSize(g)).toBe(h + 1);
  });

  it('Jinx, Demolitionist: Accelerate (pay [1][C]: enter ready); when you play me, discard 2', () => {
    const g = table(109);
    const id = inHand(g, 'jinx-demolitionist');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'optionalCost', prompt: { ability: 'jinx-demolitionist#kw:accelerate' } });
    act(g, 'yes');
    drive(g);
    const j = onBoard(g, 'jinx-demolitionist', 0)[0];
    expect(g.s.objects[j].exhausted).toBe(false);
    expect(evs(g, 'discard')[0].objs).toHaveLength(2);
  });

  it('Vi, Destructive: Ganking; recycle 1 from your trash: +1 this turn', () => {
    const g = table(110);
    const vi = put(g, 'vi-destructive', 0, base(0));
    inTrash(g, 'shipyard-skulker');
    reask(g);
    expect(hasKeyword(g.s, vi, 'ganking')).toBe(true);
    act(g, `act:${vi}#0`);
    drive(g);
    expect(mightOf(g.s, vi)).toBe(4);
    expect(g.s.players[0].trash).toHaveLength(0);
    reask(g);
    expect(keys(g)).not.toContain(`act:${vi}#0`);                      // nothing left to recycle
  });

  it('Cemetery Attendant: when you play me, return a unit from your trash to your hand', () => {
    const g = table(111);
    inTrash(g, 'hunting-dog');
    cast(g, 'cemetery-attendant');
    expect(defsIn(g, 'hand')).toContain('hunting-dog');
  });

  it('Fight or Flight: Hidden; move a unit from a battlefield to its base (from face down: one there)', () => {
    const g = table(112);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const fd = hide(g, 'fight-or-flight', 0);
    expect(g.s.objects[fd]).toMatchObject({ zone: { z: 'facedown', bf: 0 }, knownBy: 1 });
    nextTurn(g);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    const here = put(g, 'shipyard-skulker', 0, bf(0));
    put(g, 'shipyard-skulker', 0, bf(0));
    reask(g);
    act(g, `play:${fd}`);
    expect(keys(g)).not.toContain(`t:${foe}`);                         // targets at its battlefield [811.1.d.2]
    drive(g, [`t:${here}`]);
    expect(g.s.objects[here].zone).toEqual(base(0));
  });

  it('Undercover Agent: Deathknell: discard 2, then draw 2', () => {
    const g = table(113);
    const a = put(g, 'undercover-agent', 0, base(0));
    const h = handSize(g);
    cast(g, 'final-spark', [`t:${a}`]);
    expect(evs(g, 'discard')[0].objs).toHaveLength(2);
    expect(handSize(g)).toBe(h);
  });

  it('Fading Memories: give a unit at a battlefield or a gear Temporary (killed at its controller\'s next Beginning Phase)', () => {
    const g = table(114);
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    cast(g, 'fading-memories', [`t:${foe}`]);
    expect(hasKeyword(g.s, foe, 'temporary')).toBe(true);
    reask(g);
    act(g, 'end');
    drive(g);
    expect(g.s.objects[foe]).toBeUndefined();
  });

  it('Scrapheap: draw 1 when played, discarded or killed', () => {
    const g = table(115);
    const h = handSize(g);
    cast(g, 'scrapheap');
    expect(handSize(g)).toBe(h + 1);
    for (const id of g.s.players[0].hand.slice()) moveObject(g.s, id, { z: 'trash', p: 0 });
    inHand(g, 'scrapheap');
    cast(g, 'chemtech-enforcer');
    expect(handSize(g)).toBe(1);
  });

  it('Rhasa the Sunderer: costs [1] less for each card in your trash', () => {
    const g = table(116);
    for (let i = 0; i < 6; i++) inTrash(g, 'shipyard-skulker');
    const id = inHand(g, 'rhasa-the-sunderer');
    reask(g);
    act(g, `play:${id}`);
    opt(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
  });

  it('Reaver\'s Row: when you defend here, you may move a friendly unit here to base', () => {
    const g = table(117, { bfs: [undefined, 'reavers-row'] });
    control(g, 1, 1);
    const d = put(g, 'shipyard-skulker', 1, bf(1));
    const att = put(g, 'mega-mech', 0, base(0));
    moveTo(g, [att], 1);
    drive(g, ['yes', `t:${d}`]);
    expect(g.s.objects[d].zone).toEqual(base(1));
    expect(g.s.bfs[1].controller).toBe(0);
  });

  it('Targon\'s Peak: when you conquer here, ready up to 2 runes at the end of this turn', () => {
    const g = table(118, { bfs: ['targons-peak'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    runes(g, 0, [['calm', false], ['calm', false], ['calm', false]]);
    moveTo(g, [u], 0);
    drive(g);
    expect(g.s.delayed).toHaveLength(1);
    reask(g);
    act(g, 'end');
    const r = g.s.players[0].base.filter((x) => g.s.objects[x].def === 'calm-rune');
    drive(g, [`t:${r[0]}`, `t:${r[1]}`, 'done']);
    expect(g.s.players[0].base.filter((x) => g.s.objects[x].def === 'calm-rune' && !g.s.objects[x].exhausted).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('Zaun Warrens: when you conquer here, discard 1, then draw 1', () => {
    const g = table(119, { bfs: ['zaun-warrens'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g);
    moveTo(g, [u], 0);
    drive(g);
    expect(evs(g, 'discard')).toHaveLength(1);
    expect(handSize(g)).toBe(h);
  });
});

describe('Origins: Lee Sin', () => {
  it('Lee Sin, Blind Monk: [1], [E]: buff a friendly unit', () => {
    const g = table(120, { legends: ['lee-sin-blind-monk'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${g.s.players[0].legend[0]}#0`);
    drive(g, [`t:${u}`]);
    expect(g.s.objects[u].buffs).toBe(1);
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);
  });

  it('Charm: move an enemy unit (any other location)', () => {
    const g = table(121);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    const id = inHand(g, 'charm');
    reask(g);
    act(g, `play:${id}`);
    opt(g, `t:${foe}`);
    expect(g.s.pending).toMatchObject({ kind: 'destination' });
    expect(keys(g)).toEqual(expect.arrayContaining(['loc:base', 'loc:bf0']));
    drive(g, ['loc:base']);
    expect(g.s.objects[foe].zone).toEqual(base(1));
  });

  it('Stand United: buff a friendly unit; buffs give +1 more to friendly units this turn', () => {
    const g = table(122);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const b = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[b], 'buffs', 1);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    setField(g.s, g.s.objects[foe], 'buffs', 1);
    cast(g, 'stand-united', [`t:${a}`]);
    expect([mightOf(g.s, a), mightOf(g.s, b), mightOf(g.s, foe)]).toEqual([5, 5, 4]);
  });

  it('Discipline: +2 this turn, draw 1', () => {
    const g = table(123);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g);
    cast(g, 'discipline', [`t:${a}`]);
    expect([mightOf(g.s, a), handSize(g)]).toEqual([5, h + 1]);
  });

  it('Mask of Foresight: a friendly unit attacking or defending alone gets +1', () => {
    const g = table(124);
    put(g, 'mask-of-foresight', 0, base(0));
    control(g, 1, 1);
    put(g, 'shipyard-skulker', 1, bf(1));
    const a = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [a], 1);
    drive(g);
    expect(g.s.bfs[1].controller).toBe(0);                             // 4 beats 3
    expect(g.s.objects[a]).toBeDefined();
  });

  it('Wizened Elder: +1 more while buffed', () => {
    const g = table(125);
    const w = put(g, 'wizened-elder', 0, base(0));
    expect(mightOf(g.s, w)).toBe(4);
    setField(g.s, g.s.objects[w], 'buffs', 1);
    expect(mightOf(g.s, w)).toBe(6);
  });

  it('Bilgewater Bully: Ganking while buffed', () => {
    const g = table(126);
    const b = put(g, 'bilgewater-bully', 0, bf(0));
    expect(hasKeyword(g.s, b, 'ganking')).toBe(false);
    setField(g.s, g.s.objects[b], 'buffs', 1);
    expect(hasKeyword(g.s, b, 'ganking')).toBe(true);
  });

  it('Challenge: a friendly and an enemy unit deal their Might to each other', () => {
    const g = table(127);
    const me = put(g, 'mega-mech', 0, base(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'challenge', [`t:${me}`, `t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
    expect(g.s.objects[me].damage[0].amount).toBe(3);
  });

  it('Pit Rookie: when you play me, buff another friendly unit', () => {
    const g = table(128);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'pit-rookie', [`t:${a}`]);
    expect(g.s.objects[a].buffs).toBe(1);
  });

  it('Wildclaw Shaman: may spend a buff to buff me and ready me', () => {
    const g = table(129);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[a], 'buffs', 1);
    cast(g, 'wildclaw-shaman', ['yes']);
    const w = onBoard(g, 'wildclaw-shaman', 0)[0];
    expect([g.s.objects[a].buffs, g.s.objects[w].buffs, g.s.objects[w].exhausted]).toEqual([0, 1, false]);
  });

  it('Lee Sin, Centered: other buffed friendly units at my battlefield have +2', () => {
    const g = table(130);
    const lee = put(g, 'lee-sin-centered', 0, bf(0));
    const a = put(g, 'shipyard-skulker', 0, bf(0));
    const b = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[a], 'buffs', 1);
    setField(g.s, g.s.objects[b], 'buffs', 1);
    setField(g.s, g.s.objects[lee], 'buffs', 1);
    expect([mightOf(g.s, a), mightOf(g.s, b), mightOf(g.s, lee)]).toEqual([6, 4, 7]);
  });

  it('Mistfall: when you buff a friendly unit, you may pay [O] and exhaust this to ready it', () => {
    const g = table(131, { legends: ['lee-sin-blind-monk'] });
    const m = put(g, 'mistfall', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    reask(g);
    act(g, `act:${g.s.players[0].legend[0]}#0`);
    drive(g, [`t:${u}`]);
    expect([g.s.objects[u].exhausted, g.s.objects[m].exhausted]).toEqual([false, true]);
  });

  it('Udyr, Wildman: spend my buff: one mode not chosen this turn', () => {
    const g = table(132);
    const u = put(g, 'udyr-wildman', 0, base(0), { exhausted: true });
    setField(g.s, g.s.objects[u], 'buffs', 1);
    reask(g);
    act(g, `act:${u}#0`);
    drive(g, ['mode:2']);
    expect([g.s.objects[u].exhausted, g.s.objects[u].buffs]).toEqual([false, 0]);
    setField(g.s, g.s.objects[u], 'buffs', 1);
    reask(g);
    act(g, `act:${u}#0`);
    expect(keys(g)).not.toContain('mode:2');                           // chosen this turn
    drive(g, ['mode:3']);
    expect(hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it('Grove of the God-Willow: when you hold here, draw 1', () => {
    const g = table(133, { bfs: ['grove-of-the-god-willow'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const h = handSize(g);
    nextTurn(g);
    expect(handSize(g)).toBe(h + 2);                                   // hold + draw phase
  });

  it('Monastery of Hirana: when you conquer here, you may spend a buff to draw 1', () => {
    const g = table(134, { bfs: ['monastery-of-hirana'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[u], 'buffs', 1);
    const h = handSize(g);
    moveTo(g, [u], 0);
    drive(g, ['yes']);
    expect([g.s.objects[u].buffs, handSize(g)]).toEqual([0, h + 1]);
  });
});

describe('Origins: Viktor', () => {
  it('Viktor, Herald of the Arcane: [1], [E]: play a Recruit token', () => {
    const g = table(140, { legends: ['viktor-herald-of-the-arcane'] });
    reask(g);
    act(g, `act:${g.s.players[0].legend[0]}#0`);
    drive(g);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(1);
  });

  it('Consult the Past: Hidden, Reaction; draw 2; from face down it costs nothing', () => {
    const g = table(141);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const fd = hide(g, 'consult-the-past', 0);
    nextTurn(g);
    runes(g, 0, []);
    reask(g);
    expect(keys(g)).toContain(`play:${fd}`);                           // no base cost [811.1.b]
    const h = handSize(g);
    act(g, `play:${fd}`);
    drive(g);
    expect(handSize(g)).toBe(h + 2);
  });

  it('Orb of Regret: [E]: -1 this turn, to a minimum of 1', () => {
    const g = table(142);
    const orb = put(g, 'orb-of-regret', 0, base(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    reask(g);
    act(g, `act:${orb}#0`);
    drive(g, [`t:${foe}`]);
    expect(mightOf(g.s, foe)).toBe(2);
  });

  it('Smoke Screen: -4, to a minimum of 1', () => {
    const g = table(143);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'smoke-screen', [`t:${foe}`]);
    expect(mightOf(g.s, foe)).toBe(1);
  });

  it('Sprite Call: play a ready 3 Might Sprite with Temporary', () => {
    const g = table(144);
    cast(g, 'sprite-call');
    const sp = onBoard(g, 'sprite', 0)[0];
    expect([g.s.objects[sp].exhausted, mightOf(g.s, sp), hasKeyword(g.s, sp, 'temporary')]).toEqual([false, 3, true]);
    nextTurn(g);
    expect(g.s.objects[sp]).toBeUndefined();                           // Temporary [816.1.b]
  });

  it('Mushroom Pouch: at the start of your Beginning Phase, draw 1 if you control a facedown card at a battlefield', () => {
    const g = table(145);
    put(g, 'mushroom-pouch', 0, base(0));
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    hide(g, 'consult-the-past', 0);
    const h = handSize(g);
    nextTurn(g);
    expect(handSize(g)).toBe(h + 2);
  });

  it('Heimerdinger, Inventor: has the [E] abilities of friendly legends, units and gear', () => {
    const g = table(146, { legends: ['viktor-herald-of-the-arcane'] });
    const h = put(g, 'heimerdinger-inventor', 0, base(0));
    put(g, 'orb-of-regret', 0, base(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    reask(g);
    expect(keys(g)).toEqual(expect.arrayContaining([`act:${h}#g0`, `act:${h}#g1`]));
    const orbCopy = keys(g).find((k) => k.startsWith(`act:${h}#g`) && g.s.pending!.options.length > 0)!;
    void orbCopy;
    act(g, `act:${h}#g1`);
    drive(g, [`t:${foe}`]);
    expect(g.s.objects[h].exhausted).toBe(true);
  });

  it('Viktor, Innovator: when you play a card on an opponent\'s turn, a Recruit to your base', () => {
    const g = table(147);
    put(g, 'viktor-innovator', 0, base(0));
    cast(g, 'shipyard-skulker');
    expect(onBoard(g, 'recruit', 0)).toHaveLength(0);
    reask(g);
    act(g, 'end');
    drive(g);
    const st = inHand(g, 'stupefy', 0);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const opp = inHand(g, 'discipline', 1);
    reask(g);
    act(g, `play:${opp}`);
    act(g, `t:${foe}`);
    drive(g, [`play:${st}`, `t:${foe}`]);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(1);
  });

  it('Wraith of Echoes: the first time another friendly unit dies each turn, draw 1', () => {
    const g = table(148);
    put(g, 'wraith-of-echoes', 0, base(0));
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const b = put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g);
    cast(g, 'final-spark', [`t:${a}`]);
    expect(handSize(g)).toBe(h + 1);
    runes(g, 0, RICH);
    cast(g, 'final-spark', [`t:${b}`]);
    expect(handSize(g)).toBe(h + 1);                                   // only the first time
  });

  it('Cruel Patron: as an additional cost to play me, kill a friendly unit', () => {
    const g = table(149);
    const id = inHand(g, 'cruel-patron');
    reask(g);
    expect(keys(g)).not.toContain(`play:${id}`);                       // nothing to kill
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `play:${id}`);
    drive(g);
    expect(g.s.objects[u]).toBeUndefined();
    expect(onBoard(g, 'cruel-patron', 0)).toHaveLength(1);
  });

  it('Cull the Weak: each player kills one of their units', () => {
    const g = table(150);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const b = put(g, 'mega-mech', 0, base(0));
    const c = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'cull-the-weak', [`pick:${a}`]);
    expect([g.s.objects[a], g.s.objects[c]]).toEqual([undefined, undefined]);
    expect(g.s.objects[b]).toBeDefined();
  });

  it('Hidden Blade: Hidden; kill a unit at a battlefield, its controller draws 2', () => {
    const g = table(151);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const fd = hide(g, 'hidden-blade', 0);
    nextTurn(g);
    const mine = put(g, 'shipyard-skulker', 0, bf(0));
    const h = handSize(g, 0);
    reask(g);
    act(g, `play:${fd}`);
    drive(g, [`t:${mine}`]);
    expect(g.s.objects[mine]).toBeUndefined();
    expect(handSize(g, 0)).toBe(h + 2);                                // its controller draws 2
  });

  it('Soaring Scout: Deathknell: channel 1 rune exhausted', () => {
    const g = table(152);
    const sc = put(g, 'soaring-scout', 0, base(0));
    const n = g.s.players[0].base.length;
    cast(g, 'final-spark', [`t:${sc}`]);
    expect(g.s.players[0].base.length).toBe(n);                        // −1 scout, +1 rune
    expect(evs(g, 'channel').length).toBeGreaterThan(0);
  });

  it('Grand Strategem: friendly units +5 this turn', () => {
    const g = table(153);
    runes(g, 0, [...RICH, ...ready('order', 2)]);
    const a = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'grand-strategem');
    expect(mightOf(g.s, a)).toBe(8);
  });

  it('Altar to Unity: when you hold here, a Recruit in your base', () => {
    const g = table(154, { bfs: ['altar-to-unity'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    nextTurn(g);
    expect(onBoard(g, 'recruit', 0).map((u) => g.s.objects[u].zone)).toEqual([base(0)]);
  });

  it('The Grand Plaza: when you hold here with 7+ units here, you win', () => {
    const g = table(155, { bfs: ['the-grand-plaza'] });
    control(g, 0, 0);
    for (let i = 0; i < 7; i++) put(g, 'recruit', 0, bf(0));
    nextTurn(g);
    expect(g.s.result).toMatchObject({ winner: 0, reason: 'effect' });
  });
});
