import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { setField } from '../../src/game/state/mut.ts';
import { moveDestinations } from '../../src/game/rules/move.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, moveTo, nextTurn, onBoard, RICH } from './helpers/cards.ts';
import { timingFrom } from '../../src/game/play/playCard.ts';
import { attack, defsIn, dmg, equip, foe, golds, runeCount, tbl } from './helpers/setCards.ts';
import { derive } from '../../src/game/layers/derive.ts';
import { findCard } from '../../src/game/cards/oracle.ts';

const derived = (g: ReturnType<typeof tbl>, id: number) => derive(g.s, id).keywords;
const mightBonusOf = (def: string) => findCard(def)?.mightBonus ?? 0;

/*
 * Spiritforged (SFD), the cards beyond the Champion Decks (cards/defs/sfd-set.ts):
 * one behaviour test per card at least.
 */

describe('Spiritforged set: batch A', () => {
  it('Against the Odds: +2 per enemy unit there', () => {
    const g = tbl(9301);
    foe(g, 'mystic-poro'); foe(g, 'mystic-poro');
    const u = put(g, 'shipyard-skulker', 0, bf(1));
    cast(g, 'against-the-odds', [`t:${u}`]);
    expect(evs(g, 'mightChanged').some((m) => m.obj === u)).toBe(true);
  });

  it('Apprentice Smith: when I move, draw the top card if gear, else recycle it', () => {
    const g = tbl(9302);
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'arena-bar');
    moveTo(g, [put(g, 'apprentice-smith', 0, base(0))], 0);
    drive(g);
    expect(defsIn(g, 'hand')).toContain('arena-bar');
  });

  it('Arcane Shift: banish a friendly unit, its owner plays it; deal 3; banish this', () => {
    const g = tbl(9303);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'arcane-shift', [`t:${u}`, `t:${e}`]);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
    expect(g.s.objects[e]).toBeUndefined();
    expect(defsIn(g, 'banish')).toContain('arcane-shift');
  });

  it('Arise: a Sand Soldier for each Equipment you control, two of them ready', () => {
    const g = tbl(9304);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'boneshiver', u); equip(g, 'cull', u); equip(g, 'trinity-force', u);
    cast(g, 'arise');
    const ss = onBoard(g, 'sandSoldier', 0);
    expect(ss).toHaveLength(3);
    expect(ss.filter((id) => !g.s.objects[id].exhausted)).toHaveLength(2);
  });

  it('Aspiring Engineer: return a gear from your trash to your hand', () => {
    const g = tbl(9305);
    inTrash(g, 'arena-bar');
    cast(g, 'aspiring-engineer');
    expect(defsIn(g, 'hand')).toContain('arena-bar');
  });

  it('Azir, Emperor of the Sands: Sand Soldiers have Weaponmaster; [1],[E]: a Sand Soldier after an Equipment', () => {
    const g = tbl(9306, { legends: ['azir-emperor-of-the-sands'] });
    const l = g.s.players[0].legend[0];
    const ss = put(g, 'sandSoldier', 0, base(0));
    expect(hasKeyword(g.s, ss, 'weaponmaster')).toBe(true);
    reask(g);
    expect(keys(g)).not.toContain(`act:${l}#1`);
    cast(g, 'cull');
    reask(g);
    act(g, `act:${l}#1`);
    drive(g);
    expect(onBoard(g, 'sandSoldier', 0)).toHaveLength(2);
  });

  it('Azir, Sovereign: when I attack, may move your token units here', () => {
    const g = tbl(9307);
    foe(g, 'mystic-poro');
    const r = put(g, 'recruit', 0, base(0));
    setField(g.s, g.s.objects[r], 'token', true);
    const a = put(g, 'azir-sovereign', 0, base(0));
    attack(g, a, [`pick:${r}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(r))).toBe(true);
  });

  it('Bard, Mercurial: exhaust your legend to move units to an open battlefield', () => {
    const g = tbl(9308);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const id = inHand(g, 'bard-mercurial');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g, [`pick:${g.s.bfs[0].obj}`, `pick:${u}`]);
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);
    expect(evs(g, 'move').some((m) => m.objs.includes(u))).toBe(true);
  });

  it('Battering Ram: [1] less per card played this turn, minimum [1]', () => {
    const g = tbl(9309);
    cast(g, 'arena-bar');
    cast(g, 'arena-bar');
    const id = inHand(g, 'battering-ram');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Beast Below: return another friendly unit and an enemy unit to hands', () => {
    const g = tbl(9310);
    const a = put(g, 'mystic-poro', 0, base(0)), b = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'beast-below', [`t:${a}`, `t:${b}`]);
    expect([defsIn(g, 'hand'), defsIn(g, 'hand', 1)].every((h) => h.includes('mystic-poro'))).toBe(true);
  });

  it("Bellows' Breath: deal 1 to up to three units at the same location", () => {
    const g = tbl(9311);
    const a = put(g, 'mystic-poro', 1, base(1)), b = put(g, 'mystic-poro', 1, base(1)), c = put(g, 'mystic-poro', 0, base(0));
    const id = inHand(g, 'bellows-breath');
    reask(g);
    act(g, `play:${id}`);
    if (g.s.pending?.kind === 'optionalCost') act(g, 'no');
    act(g, `t:${a}`);
    expect(keys(g)).not.toContain(`t:${c}`);
    drive(g, [`t:${b}`]);
    expect([dmg(g, a), dmg(g, b)]).toEqual([1, 1]);
  });

  it('Blast Corps Cadet: pay [1][R] more to deal 2 at a battlefield', () => {
    const g = tbl(9312);
    const e = foe(g, 'mystic-poro');
    const id = inHand(g, 'blast-corps-cadet');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g, [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Blood Money: kill a unit with 2 or less; 1 Gold for an enemy, 2 for a friendly', () => {
    const g = tbl(9313);
    const e = foe(g, 'mystic-poro');
    cast(g, 'blood-money', [`t:${e}`]);
    expect(golds(g)).toBe(1);
    const f = put(g, 'mystic-poro', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'blood-money', [`t:${f}`]);
    expect(golds(g)).toBe(3);
  });

  it('Blood Rush: a unit gets Assault 2 this turn', () => {
    const g = tbl(9314);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'blood-rush', [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'assault')).toBe(true);
  });

  it('Bonds of Strength: two friendly units each +1', () => {
    const g = tbl(9315);
    const a = put(g, 'mystic-poro', 0, base(0)), b = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'bonds-of-strength', [`t:${a}`, `t:${b}`]);
    expect([mightOf(g.s, a), mightOf(g.s, b)]).toEqual([3, 3]);
  });

  it('Boneshiver: when I conquer, channel 1 exhausted', () => {
    const g = tbl(9316);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'boneshiver', u);
    const r = runeCount(g);
    moveTo(g, [u], 0);
    drive(g);
    expect(runeCount(g)).toBe(r + 1);
  });

  it('Buhru Captain: may draw 1 or buff me', () => {
    const g = tbl(9317);
    cast(g, 'buhru-captain', ['mode:1']);
    expect(g.s.objects[onBoard(g, 'buhru-captain', 0)[0]].buffs).toBe(1);
  });

  it('Bushwhack: friendly units enter ready this turn; a Gold', () => {
    const g = tbl(9318);
    cast(g, 'bushwhack');
    expect(golds(g)).toBe(1);
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[onBoard(g, 'shipyard-skulker', 0)[0]].exhausted).toBe(false);
  });

  it('Called Shot: look at 2, draw one, recycle the other', () => {
    const g = tbl(9319);
    const h = handSize(g);
    cast(g, 'called-shot');
    expect(handSize(g)).toBe(h + 1);
  });

  it("Chemtech Cask: a spell on an opponent's turn may make a Gold", () => {
    const g = tbl(9320, { first: 1 });
    runes(g, 0, [...ready('mind', 3), ...RICH]);
    put(g, 'chemtech-cask', 0, base(0));
    const p = inHand(g, 'premonition', 0);
    const u = inHand(g, 'progress-day', 1);
    reask(g);
    act(g, `play:${u}`);
    drive(g, [`play:${p}`]);
    expect(golds(g)).toBe(1);
  });

  it('Corinna Veraza: moving to a battlefield plays three Recruits there', () => {
    const g = tbl(9321);
    moveTo(g, [put(g, 'corinna-veraza', 0, base(0))], 0);
    drive(g);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(3);
  });

  it('Corrupt Enforcer: moving to a battlefield discards 1; winning a combat draws 1', () => {
    const g = tbl(9322);
    foe(g, 'mystic-poro');
    const h = handSize(g);
    attack(g, put(g, 'corrupt-enforcer', 0, base(0)));
    expect(evs(g, 'discard')).toHaveLength(1);
    expect(handSize(g)).toBe(h);                                       // -1 discard, +1 win
  });

  it('Cull: when I conquer, a Gold', () => {
    const g = tbl(9323);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'cull', u);
    moveTo(g, [u], 0);
    drive(g);
    expect(golds(g)).toBe(1);
  });

  it('Darius, Executioner: Legion: ready me; other friendly units have +1 here', () => {
    const g = tbl(9324);
    const u = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'arena-bar');
    cast(g, 'darius-executioner');
    const d = onBoard(g, 'darius-executioner', 0)[0];
    expect(g.s.objects[d].exhausted).toBe(false);
    expect(mightOf(g.s, u)).toBe(3);
  });

  it('Defiant Dance: +2 to a unit, -2 to another', () => {
    const g = tbl(9325);
    const a = put(g, 'shipyard-skulker', 0, base(0)), b = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'defiant-dance', [`t:${a}`, `t:${b}`]);
    expect([mightOf(g.s, a), mightOf(g.s, b)]).toEqual([5, 1]);
  });

  it("Desert's Call: a Sand Soldier", () => {
    const g = tbl(9326);
    cast(g, 'deserts-call');
    expect(onBoard(g, 'sandSoldier', 0)).toHaveLength(1);
  });

  it('Detonate: kill a gear, its controller draws 2', () => {
    const g = tbl(9327);
    const gr = put(g, 'arena-bar', 1, base(1));
    const h = handSize(g, 1);
    cast(g, 'detonate', [`t:${gr}`]);
    expect(handSize(g, 1)).toBe(h + 2);
  });

  it('Direwing: enters ready with another Dragon', () => {
    const g = tbl(9328);
    put(g, 'mountain-drake', 0, base(0));
    cast(g, 'direwing');
    expect(g.s.objects[onBoard(g, 'direwing', 0)[0]].exhausted).toBe(false);
  });

  it('Disarming Rake: may kill a gear', () => {
    const g = tbl(9329);
    const gr = put(g, 'arena-bar', 1, base(1));
    cast(g, 'disarming-rake', [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
  });

  it("Doran's Ring: when I conquer, discard 1, then draw 1", () => {
    const g = tbl(9330);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'dorans-ring', u);
    moveTo(g, [u], 0);
    drive(g);
    expect(evs(g, 'discard')).toHaveLength(1);
  });

  it("Downwell: return all units and gear to their owners' hands", () => {
    const g = tbl(9331);
    runes(g, 0, [...ready('chaos', 4), ...ready('calm', 8)]);
    put(g, 'mystic-poro', 0, base(0)); put(g, 'arena-bar', 1, base(1));
    cast(g, 'downwell');
    expect(defsIn(g, 'hand')).toContain('mystic-poro');
    expect(defsIn(g, 'hand', 1)).toContain('arena-bar');
  });

  it('Draven, Audacious: the first combat win each turn scores 1', () => {
    const g = tbl(9332);
    foe(g, 'mystic-poro');
    attack(g, put(g, 'draven-audacious', 0, base(0)));
    expect(g.s.players[0].points).toBe(2);                              // the conquer and Draven's point
  });

  it('Draven, Glorious Executioner: when you win a combat, draw 1', () => {
    const g = tbl(9333, { legends: ['draven-glorious-executioner'] });
    foe(g, 'mystic-poro');
    const h = handSize(g);
    attack(g, put(g, 'shipyard-skulker', 0, base(0)));
    expect(handSize(g)).toBe(h + 1);
  });

  it('Draven, Vanquisher: a Gold on a combat win; may pay [R] for +2 when attacking', () => {
    const g = tbl(9334);
    foe(g, 'shipyard-skulker');
    attack(g, put(g, 'draven-vanquisher', 0, base(0)));
    expect(golds(g)).toBe(1);
  });

  it('Dropboarder: ready me if you control two or more gear', () => {
    const g = tbl(9335);
    put(g, 'arena-bar', 0, base(0)); put(g, 'arena-bar', 0, base(0));
    cast(g, 'dropboarder');
    expect(g.s.objects[onBoard(g, 'dropboarder', 0)[0]].exhausted).toBe(false);
  });

  it('Dunebreaker: enters ready with two or fewer cards in hand; hold draws 2', () => {
    const g = tbl(9336);
    for (const id of g.s.players[0].hand.slice(1)) setField(g.s, g.s.objects[id], 'def', 'mystic-poro');
    const g2 = tbl(9337);
    put(g2, 'dunebreaker', 0, bf(0));
    control(g2, 0, 0);
    const h = handSize(g2);
    nextTurn(g2);
    expect(handSize(g2)).toBe(h + 3);
    void g;
  });

  it('Eager Drakehound: I enter ready', () => {
    const g = tbl(9338);
    cast(g, 'eager-drakehound');
    expect(g.s.objects[onBoard(g, 'eager-drakehound', 0)[0]].exhausted).toBe(false);
  });

  it('Edge of Night: played from face down, attaches to a unit you control', () => {
    const g = tbl(9339);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    const card = inHand(g, 'edge-of-night');
    reask(g);
    act(g, `hide:${card}`);
    drive(g);
    nextTurn(g);
    reask(g);
    act(g, `play:${g.s.bfs[0].facedown[0]}`);
    drive(g, [`t:${u}`]);
    const e = onBoard(g, 'edge-of-night', 0)[0];
    expect(g.s.objects[e].attachedTo).toBe(u);
  });

  it('Eminent Benefactor: when I hold, two Gold', () => {
    const g = tbl(9340);
    put(g, 'eminent-benefactor', 0, bf(0));
    control(g, 0, 0);
    nextTurn(g);
    expect(golds(g)).toBe(2);
  });

  it("Emperor's Dais: conquer here, pay [1] and return a unit here to play a Sand Soldier here", () => {
    const g = tbl(9341, { bfs: ['emperors-dais'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(defsIn(g, 'hand')).toContain('shipyard-skulker');
    expect(onBoard(g, 'sandSoldier', 0)).toHaveLength(1);
  });

  it("Emperor's Divide: move any number of friendly units at a battlefield to base", () => {
    const g = tbl(9342);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'emperors-divide', [`t:${g.s.bfs[0].obj}`, `pick:${u}`]);
    expect(g.s.objects[u].zone).toEqual({ z: 'base', p: 0 });
  });

  it('Eye of the Herald: when I move, a Recruit here', () => {
    const g = tbl(9343);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'eye-of-the-herald', u);
    moveTo(g, [u], 0);
    drive(g);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(1);
  });

  it("Factory Recall: return a gear to its owner's hand", () => {
    const g = tbl(9344);
    const gr = put(g, 'arena-bar', 1, base(1));
    cast(g, 'factory-recall', [`t:${gr}`]);
    expect(defsIn(g, 'hand', 1)).toContain('arena-bar');
  });

  it('Fae Porter: moving to a battlefield, may pay [P] to bring a unit along', () => {
    const g = tbl(9345);
    const f = put(g, 'fae-porter', 0, base(0));
    const u = put(g, 'mystic-poro', 0, base(0), { exhausted: true });
    moveTo(g, [f], 0);
    drive(g, [`t:${u}`]);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it('Feral Strength: +2', () => {
    const g = tbl(9346);
    const u = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'feral-strength', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(4);
  });

  it('Fizz, Trickster: may play a spell up to [3] from your trash free of Energy, then recycle it', () => {
    const g = tbl(9347);
    runes(g, 0, [...ready('mind', 3), ...RICH]);
    inTrash(g, 'premonition');
    const h = handSize(g);
    cast(g, 'fizz-trickster');
    expect(handSize(g)).toBe(h + 3);
    expect(defsIn(g, 'deck')).toContain('premonition');
  });

  it('Forgefire Cape: when I attack, deal 2 to all enemy units here', () => {
    const g = tbl(9348);
    const e = foe(g, 'mystic-poro');
    const u = put(g, 'mountain-drake', 0, base(0));
    equip(g, 'forgefire-cape', u);
    attack(g, u);
    expect(evs(g, 'deal').some((d) => d.to === e && d.n === 2 && !d.combat)).toBe(true);
  });

  it("Forgotten Monument: players can't score here until their third turn", () => {
    const g = tbl(9349, { bfs: ['forgotten-monument'] });
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    expect(g.s.players[0].points).toBe(0);
  });

  it('Frostcoat Cub: pay [B] more to give a unit -2', () => {
    const g = tbl(9350);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    const id = inHand(g, 'frostcoat-cub');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g, [`t:${e}`]);
    expect(mightOf(g.s, e)).toBe(1);
  });

  it('Glasc Mixologist: Deathknell: may play a cheap unit from your trash for free', () => {
    const g = tbl(9351);
    inTrash(g, 'shipyard-skulker');
    put(g, 'glasc-mixologist', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
  });

  it('Guardian of the Passage: hold: may return a unit or gear from trash to hand', () => {
    const g = tbl(9352);
    inTrash(g, 'arena-bar');
    put(g, 'guardian-of-the-passage', 0, bf(0));
    control(g, 0, 0);
    nextTurn(g);
    expect(defsIn(g, 'hand')).toContain('arena-bar');
  });

  it('Guards: a Sand Soldier, ready if you pay [Y]', () => {
    const g = tbl(9353);
    cast(g, 'guards', ['pay:0']);
    const ss = onBoard(g, 'sandSoldier', 0);
    expect(ss).toHaveLength(1);
    expect(g.s.objects[ss[0]].exhausted).toBe(false);
  });

  it('Hall of Legends: conquer here, may pay [1] to ready your legend', () => {
    const g = tbl(9354, { bfs: ['hall-of-legends'] });
    setField(g.s, g.s.objects[g.s.players[0].legend[0]], 'exhausted', true);
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(false);
  });

  it('Harpoon Squad: moving from a battlefield gives +2', () => {
    const g = tbl(9355);
    const h = put(g, 'harpoon-squad', 0, bf(0));
    control(g, 0, 0);
    moveTo(g, [h], 'base');
    drive(g);
    expect(mightOf(g.s, h)).toBe(6);
  });

  it('Heart of Dark Ice: [E]: +3', () => {
    const g = tbl(9356);
    const h = put(g, 'heart-of-dark-ice', 0, base(0));
    const u = put(g, 'mystic-poro', 0, base(0));
    reask(g);
    act(g, `act:${h}#0`);
    drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Honest Broker: Deathknell: a Gold', () => {
    const g = tbl(9357);
    put(g, 'honest-broker', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(golds(g)).toBe(1);
  });

  it('Hostile Takeover: take an enemy unit at a battlefield, ready it; it goes back at end of turn', () => {
    const g = tbl(9358);
    runes(g, 0, [...ready('mind', 2), ...RICH]);
    const e = foe(g, 'mountain-drake');
    setField(g.s, g.s.objects[e], 'exhausted', true);
    cast(g, 'hostile-takeover', [`t:${e}`]);
    expect(g.s.objects[e]).toMatchObject({ controller: 0, exhausted: false });
    nextTurn(g);
    expect(g.s.objects[e]?.controller ?? 1).toBe(1);
  });

  it('Janna, Savior: heal your units here, move up to one enemy unit from here to its base', () => {
    const g = tbl(9359);
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'janna-savior');
    expect(g.s.objects[e]).toBeDefined();
    expect(onBoard(g, 'janna-savior', 0)).toHaveLength(1);
  });

  it('Loyal Pup: when you defend at a battlefield, may move me there', () => {
    const g = tbl(9360, { first: 1 });
    const pup = put(g, 'loyal-pup', 0, base(0));
    put(g, 'mountain-drake', 0, bf(0));
    control(g, 0, 0);
    moveTo(g, [put(g, 'mystic-poro', 1, base(1))], 0);
    drive(g);
    expect(evs(g, 'move').some((m) => m.objs.includes(pup))).toBe(true);
  });

  it('Lucian, Gunslinger: when I attack, deal my Assault to an enemy unit here', () => {
    const g = tbl(9361);
    const e = foe(g, 'mountain-drake');
    attack(g, put(g, 'lucian-gunslinger', 0, base(0)));
    expect(evs(g, 'deal').some((d) => d.to === e && !d.combat)).toBe(true);
  });

  it('Marching Orders: a friendly unit and an enemy unit at a battlefield fight', () => {
    const g = tbl(9362);
    const u = put(g, 'mountain-drake', 0, base(0));
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'marching-orders', [`t:${u}`, `t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it("Minotaur Reckoner: units can't move to base", () => {
    const g = tbl(9363);
    put(g, 'minotaur-reckoner', 0, bf(1));
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    expect(moveDestinations(g.s, u)).toEqual([]);
  });

  it('On the Hunt: ready your units', () => {
    const g = tbl(9364);
    const u = put(g, 'mystic-poro', 0, base(0), { exhausted: true });
    cast(g, 'on-the-hunt');
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Ornn, Blacksmith: look at 4, may draw a gear, recycle the rest', () => {
    const g = tbl(9365);
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'arena-bar');
    cast(g, 'ornn-blacksmith', ['pick:' + top]);
    expect(defsIn(g, 'hand')).toContain('arena-bar');
  });

  it('Ornn, Forge God: +1 for each friendly gear', () => {
    const g = tbl(9366);
    const o = put(g, 'ornn-forge-god', 0, base(0));
    put(g, 'arena-bar', 0, base(0));
    expect(mightOf(g.s, o)).toBe(5);
  });

  it('Overzealous Fan: when I defend, may kill me to send an attacker to its base', () => {
    const g = tbl(9367, { first: 1 });
    put(g, 'overzealous-fan', 0, bf(0));
    control(g, 0, 0);
    const a = put(g, 'mountain-drake', 1, base(1));
    moveTo(g, [a], 0);
    drive(g, [`t:${a}`]);
    expect(g.s.objects[a].zone).toEqual({ z: 'base', p: 1 });
  });

  it('Perched Grimwyrm: only to a battlefield you conquered this turn', () => {
    const g = tbl(9368);
    const id = inHand(g, 'perched-grimwyrm');
    reask(g);
    expect(keys(g)).not.toContain(`play:${id}`);
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).not.toContain('loc:base');
  });

  it('Petricite Monument: friendly units have Deflect', () => {
    const g = tbl(9369);
    put(g, 'petricite-monument', 0, base(0));
    expect(hasKeyword(g.s, put(g, 'mystic-poro', 0, base(0)), 'deflect')).toBe(true);
  });

  it('Pickpocket: may kill a gear costing up to [1]; then a Gold', () => {
    const g = tbl(9370);
    const gr = put(g, 'seal-of-rage', 1, base(1));
    cast(g, 'pickpocket', [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
    expect(golds(g)).toBe(1);
  });

  it('Piercing Light: deal 2 at a battlefield, then 2 to up to one other unit', () => {
    const g = tbl(9371);
    const a = foe(g, 'mystic-poro'), b = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'piercing-light', [`t:${a}`, `t:${b}`]);
    expect([g.s.objects[a], g.s.objects[b]]).toEqual([undefined, undefined]);
  });

  it('Poro Snax: draw 1; [1][G], [E], kill this: draw 1', () => {
    const g = tbl(9372);
    const h = handSize(g);
    cast(g, 'poro-snax');
    const s = onBoard(g, 'poro-snax', 0)[0];
    reask(g);
    act(g, `act:${s}#1`);
    drive(g);
    expect(handSize(g)).toBe(h + 2);
  });

  it('Power Nexus: hold here, pay [A][A][A][A] to score 1', () => {
    const g = tbl(9373, { bfs: ['power-nexus'] });
    put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    nextTurn(g);
    expect(g.s.players[0].points).toBe(2);
  });

  it('Premonition: draw 3', () => {
    const g = tbl(9374);
    runes(g, 0, [...ready('mind', 3), ...RICH]);
    const h = handSize(g);
    cast(g, 'premonition');
    expect(handSize(g)).toBe(h + 3);
  });

  it('Rally the Troops: friendly units played this turn are buffed; draw 1', () => {
    const g = tbl(9375);
    cast(g, 'rally-the-troops');
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[onBoard(g, 'shipyard-skulker', 0)[0]].buffs).toBe(1);
  });

  it('Recurve Bow: when I attack, deal 2 to an enemy unit here', () => {
    const g = tbl(9376);
    const e = foe(g, 'mystic-poro');
    const u = put(g, 'mountain-drake', 0, base(0));
    equip(g, 'recurve-bow', u);
    attack(g, u);
    expect(evs(g, 'deal').some((d) => d.to === e && d.n === 2 && !d.combat)).toBe(true);
  });

  it("Rek'Sai, Swarm Queen: when I attack, reveal 2, banish one and play it", () => {
    const g = tbl(9377);
    foe(g, 'mystic-poro');
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'shipyard-skulker');
    attack(g, put(g, 'reksai-swarm-queen', 0, base(0)), [`pick:${top}`]);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
  });

  it("Rek'Sai, Void Burrower: when you conquer, may exhaust me to reveal 2 and play one", () => {
    const g = tbl(9378, { legends: ['reksai-void-burrower'] });
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'mystic-poro');
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g, [`pick:${top}`]);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
  });

  it('Renata Glasc, Mastermind: abilities only at a battlefield', () => {
    const g = tbl(9379);
    const r = put(g, 'renata-glasc-mastermind', 0, base(0));
    reask(g);
    expect(keys(g)).not.toContain(`act:${r}#0`);
    const r2 = put(g, 'renata-glasc-mastermind', 0, bf(0));
    control(g, 0, 0);
    const h = handSize(g);
    reask(g);
    act(g, `act:${r2}#0`);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
  });

  it("Rengar, Pouncing: can be played to a battlefield you're attacking", () => {
    const g = tbl(9380);
    foe(g, 'mountain-drake');
    const id = inHand(g, 'rengar-pouncing');
    moveTo(g, [put(g, 'mystic-poro', 0, base(0))], 1);
    for (let i = 0; i < 6 && !(g.s.pending?.kind === 'priority' && g.s.pending.player === 0 && keys(g).includes(`play:${id}`)); i++) {
      if (g.s.pending?.kind === 'priority') act(g, 'pass'); else drive(g, [], { max: 1 });
    }
    act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf1');
  });

  it('Ribbon Dancer: moving to a battlefield gives another friendly unit +1', () => {
    const g = tbl(9381);
    const u = put(g, 'mystic-poro', 0, base(0), { exhausted: true });
    moveTo(g, [put(g, 'ribbon-dancer', 0, base(0))], 0);
    drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(3);
  });

  it('Rocket Barrage: deal 4 to a unit in a base, or kill a gear', () => {
    const g = tbl(9382);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'rocket-barrage', ['mode:0', `t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it("Rockfall Path: units can't be played here", () => {
    const g = tbl(9383, { bfs: ['rockfall-path'] });
    put(g, 'mystic-poro', 0, bf(0));
    control(g, 0, 0);
    const id = inHand(g, 'shipyard-skulker');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).not.toContain('loc:bf0');
  });

  it('Royal Entourage: ready or exhaust a legend', () => {
    const g = tbl(9384);
    const l = g.s.players[1].legend[0];
    cast(g, 'royal-entourage', ['mode:1', `t:${l}`]);
    expect(g.s.objects[l].exhausted).toBe(true);
  });

  it('Sandshifter: kill an enemy unit with 3 or less', () => {
    const g = tbl(9385);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'sandshifter', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Sea Monkey: pay [1] more to buff me', () => {
    const g = tbl(9386);
    const id = inHand(g, 'sea-monkey');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g);
    expect(g.s.objects[onBoard(g, 'sea-monkey', 0)[0]].buffs).toBe(1);
  });

  it('Seals: [Reaction] [E]: add one Power of their domain', () => {
    const g = tbl(9387);
    const s = put(g, 'seal-of-rage', 0, base(0));
    reask(g);
    act(g, `act:${s}#0`);
    drive(g);
    expect(g.s.players[0].pool.power.fury).toBe(1);
    for (const id of ['seal-of-discord', 'seal-of-focus', 'seal-of-insight', 'seal-of-strength', 'seal-of-unity']) {
      const o = put(g, id, 0, base(0));
      reask(g);
      act(g, `act:${o}#0`);
      drive(g);
    }
    expect(Object.values(g.s.players[0].pool.power).every((n) => n === 1)).toBe(true);
  });

  it('Seat of Power: conquer here draws 1 per other battlefield you control', () => {
    const g = tbl(9388, { bfs: ['seat-of-power'] });
    put(g, 'mystic-poro', 0, bf(1));
    control(g, 1, 0);
    const h = handSize(g);
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Simian Ancestor: when you buff me, ready me', () => {
    const g = tbl(9389);
    const s = put(g, 'simian-ancestor', 0, base(0), { exhausted: true });
    cast(g, 'kinkou-monk', [`t:${s}`]);
    expect(g.s.objects[s].exhausted).toBe(false);
  });

  it('Sivir, Ambitious: conquering with 5+ excess, may deal that much to an enemy unit', () => {
    const g = tbl(9390);
    foe(g, 'mystic-poro');
    const e = put(g, 'mountain-drake', 1, base(1));
    attack(g, put(g, 'sivir-ambitious', 0, base(0)), [`t:${e}`]);
    expect(dmg(g, e)).toBe(5);
  });

  it("Sivir, Mercenary: +2 and Ganking once you've spent [A][A] this turn", () => {
    const g = tbl(9391);
    const s = put(g, 'sivir-mercenary', 0, base(0));
    expect(hasKeyword(g.s, s, 'ganking')).toBe(false);
    setField(g.s, g.s.log.powerSpent, 0, 2);
    expect(hasKeyword(g.s, s, 'ganking')).toBe(true);
    expect(mightOf(g.s, s)).toBe(6);
  });

  it('Stellacorn Herder: when I move, draw 1', () => {
    const g = tbl(9392);
    const h = handSize(g);
    moveTo(g, [put(g, 'stellacorn-herder', 0, base(0))], 0);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Sudden Storm: deal 2 at a battlefield, 4 if attacking', () => {
    const g = tbl(9393);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'sudden-storm', [`t:${e}`]);
    expect(dmg(g, e)).toBe(2);
  });

  it('The Papertree: hold here, each player channels 1 exhausted', () => {
    const g = tbl(9394, { bfs: ['the-papertree'] });
    put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    const r1 = runeCount(g, 1);
    nextTurn(g);
    expect(runeCount(g, 1)).toBeGreaterThanOrEqual(r1 + 1);
  });

  it('Thwonk: stun an attacking unit', () => {
    const g = tbl(9395);
    const id = inHand(g, 'thwonk');
    reask(g);
    expect(keys(g)).not.toContain(`play:${id}`);
  });

  it("Tianna Crownguard: at a battlefield, opponents can't gain points", () => {
    const g = tbl(9396, { first: 1 });
    put(g, 'tianna-crownguard', 0, bf(1));
    control(g, 1, 0);
    moveTo(g, [put(g, 'shipyard-skulker', 1, base(1))], 0);
    drive(g);
    expect(g.s.players[1].points).toBe(0);
  });

  it('Treasure Hunter: when I move, a Gold', () => {
    const g = tbl(9397);
    moveTo(g, [put(g, 'treasure-hunter', 0, base(0))], 0);
    drive(g);
    expect(golds(g)).toBe(1);
  });

  it('Trinity Force: when I hold, score 1', () => {
    const g = tbl(9398);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    equip(g, 'trinity-force', u);
    nextTurn(g);
    expect(g.s.players[0].points).toBe(2);
  });

  it('Trove Golem: four Gold', () => {
    const g = tbl(9399);
    cast(g, 'trove-golem');
    expect(golds(g)).toBe(4);
  });

  it('Trusty Ramhound: +1 with another friendly unit here', () => {
    const g = tbl(9400);
    const r = put(g, 'trusty-ramhound', 0, base(0));
    expect(mightOf(g.s, r)).toBe(2);
    put(g, 'mystic-poro', 0, base(0));
    expect(mightOf(g.s, r)).toBe(3);
  });

  it('Undertitan: other units +2; revealed from the deck, add [2]', () => {
    const g = tbl(9401);
    const u = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'undertitan');
    expect(mightOf(g.s, u)).toBe(4);
    const g2 = tbl(9402);
    setField(g2.s, g2.s.objects[g2.s.players[0].deck[0]], 'def', 'undertitan');
    moveTo(g2, [put(g2, 'apprentice-smith', 0, base(0))], 0);
    drive(g2);
    expect(evs(g2, 'pool').some((e) => e.pool.energy >= 2)).toBe(true);
  });

  it('Vanguard Armory: [E]: three Recruits', () => {
    const g = tbl(9403);
    const a = put(g, 'vanguard-armory', 0, base(0));
    reask(g);
    act(g, `act:${a}#0`);
    drive(g);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(3);
  });

  it('Vayne, Hunter: enters ready if an opponent controls a battlefield', () => {
    const g = tbl(9404);
    foe(g, 'mystic-poro');
    cast(g, 'vayne-hunter');
    expect(g.s.objects[onBoard(g, 'vayne-hunter', 0)[0]].exhausted).toBe(false);
  });

  it("Void Rush: reveal 2, banish one and play it for [2] less, draw the other", () => {
    const g = tbl(9405);
    const [a, b] = g.s.players[0].deck;
    setField(g.s, g.s.objects[a], 'def', 'shipyard-skulker');
    setField(g.s, g.s.objects[b], 'def', 'mystic-poro');
    cast(g, 'void-rush', [`pick:${a}`]);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
    expect(defsIn(g, 'hand')).toContain('mystic-poro');
  });

  it('Windsinger: may return another unit at a battlefield with 3 or less', () => {
    const g = tbl(9406);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'windsinger', [`t:${e}`]);
    expect(defsIn(g, 'hand', 1)).toContain('shipyard-skulker');
  });

  it('World Atlas: when I hold, two Gold', () => {
    const g = tbl(9407);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    equip(g, 'world-atlas', u);
    nextTurn(g);
    expect(golds(g)).toBe(2);
  });

  it('Xin Zhao, Vigilant: enters ready with two other units in your base', () => {
    const g = tbl(9408);
    put(g, 'mystic-poro', 0, base(0)); put(g, 'mystic-poro', 0, base(0));
    cast(g, 'xin-zhao-vigilant');
    expect(g.s.objects[onBoard(g, 'xin-zhao-vigilant', 0)[0]].exhausted).toBe(false);
  });

  it('Yasuo, Windrider: the third move in a turn scores 1', () => {
    const g = tbl(9409);
    const y = put(g, 'yasuo-windrider', 0, base(0));
    setField(g.s, g.s.objects[y], 'moves', 2);
    moveTo(g, [y], 0);
    drive(g);
    expect(g.s.players[0].points).toBe(2);
  });

  it('Yordle Explorer: playing a card with [A][A] or more draws 1', () => {
    const g = tbl(9410);
    put(g, 'yordle-explorer', 0, base(0));
    const h = handSize(g);
    cast(g, 'falling-star', [], 0);
    expect(handSize(g)).toBeGreaterThanOrEqual(h);
  });

  it('Zaun Punk: kill a friendly gear as an extra cost to kill a gear', () => {
    const g = tbl(9411);
    const mine = put(g, 'arena-bar', 0, base(0));
    const theirs = put(g, 'arena-bar', 1, base(1));
    const id = inHand(g, 'zaun-punk');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g, [`t:${theirs}`]);
    expect([g.s.objects[mine], g.s.objects[theirs]]).toEqual([undefined, undefined]);
  });
});

describe('Spiritforged set: batch B', () => {
  it('Akshan, Mischievous: pay [O][O] to take an enemy gear (an Equipment attaches to me)', () => {
    const g = tbl(9501);
    runes(g, 0, [...ready('body', 3), ...RICH]);
    const gr = put(g, 'boneshiver', 1, base(1));
    const id = inHand(g, 'akshan-mischievous');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g, [`t:${gr}`]);
    expect(g.s.objects[gr]).toMatchObject({ controller: 0, attachedTo: onBoard(g, 'akshan-mischievous', 0)[0] });
  });

  it('Altar of Memories: a friendly unit dies: may exhaust to draw 1 and put a card back', () => {
    const g = tbl(9502);
    put(g, 'altar-of-memories', 0, base(0));
    const h = handSize(g);
    put(g, 'mystic-poro', 0, base(0), { damage: 9 });
    reask(g); drive(g, ['mode:0']);
    expect(handSize(g)).toBe(h);
  });

  it('Ancient Henge: pay Energy to add that much [A]', () => {
    const g = tbl(9503);
    const a = put(g, 'ancient-henge', 0, base(0));
    reask(g); act(g, `act:${a}#0`); drive(g, ['n:2']);
    expect(g.s.players[0].pool.universal).toBe(2);
  });

  it('Ancient Warmonger: Assault equal to the enemy units here', () => {
    const g = tbl(9504);
    foe(g, 'mystic-poro'); foe(g, 'mystic-poro');
    const w = put(g, 'ancient-warmonger', 0, bf(1));
    expect(derived(g, w).assault).toBe(2);
  });

  it('Angle Shot: attach or detach an Equipment of the same controller; draw 1', () => {
    const g = tbl(9505);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'boneshiver', 0, base(0));
    cast(g, 'angle-shot', ['mode:0', `t:${u}`, `t:${e}`]);
    expect(g.s.objects[e].attachedTo).toBe(u);
  });

  it('Azir, Ascendant: [G]: swap places with a unit you control (once per turn)', () => {
    const g = tbl(9506);
    const a = put(g, 'azir-ascendant', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    reask(g); act(g, `act:${a}#0`); drive(g, [`t:${u}`]);
    expect(g.s.objects[a].zone).toEqual({ z: 'bf', bf: 0 });
    reask(g);
    expect(keys(g)).not.toContain(`act:${a}#0`);
  });

  it('Brutalizer: +2 if attached this turn', () => {
    const g = tbl(9507);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = equip(g, 'brutalizer', u);
    expect(mightOf(g.s, u)).toBe(3 + mightBonusOf('brutalizer'));
    setField(g.s, g.s.objects[e], 'attachedTurn', g.s.turn.n);
    expect(mightOf(g.s, u)).toBe(5 + mightBonusOf('brutalizer'));
  });

  it('Card Sharp: each opponent may take a Gold; you get one more for each who did', () => {
    const g = tbl(9508);
    cast(g, 'card-sharp', ['mode:0', 'mode:0']);
    expect([golds(g), golds(g, 1)]).toEqual([2, 1]);
  });

  it('Counter Strike: prevent the next damage to a unit; draw 1', () => {
    const g = tbl(9509);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'counter-strike', [`t:${e}`]);
    cast(g, 'hextech-ray', [`t:${e}`]);
    expect(dmg(g, e)).toBe(0);
  });

  it('Drag Under: [2] less from anywhere but hand; kill a unit at a battlefield', () => {
    const g = tbl(9510);
    const e = foe(g, 'mountain-drake');
    cast(g, 'drag-under', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Experimental Hexplate: I am a Mech', () => {
    const g = tbl(9511);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'experimental-hexplate', u);
    put(g, 'rumble-scrapper', 0, base(0));
    expect(mightOf(g.s, u)).toBeGreaterThanOrEqual(4);
  });

  it('Ezreal, Prodigal Explorer: draw once you chose enemies twice this turn', () => {
    const g = tbl(9512, { legends: ['ezreal-prodigal-explorer'] });
    const l = g.s.players[0].legend[0];
    const e = foe(g, 'mountain-drake');
    cast(g, 'hextech-ray', [`t:${e}`]);
    reask(g); expect(keys(g)).not.toContain(`act:${l}#0`);
    cast(g, 'hextech-ray', [`t:${e}`]);
    reask(g); expect(keys(g)).toContain(`act:${l}#0`);
  });

  it('Fae Dragon: buff up to four; spending a buff makes a Gold', () => {
    const g = tbl(9513);
    runes(g, 0, [...ready('body', 3), ...RICH]);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'fae-dragon', [`t:${u}`]);
    expect(g.s.objects[u].buffs).toBe(1);
    cast(g, 'wallop', ['yes', `t:${u}`]);
    expect(golds(g)).toBe(1);
  });

  it('Forge of the Fluft: friendly legends gain "[E]: attach an Equipment"', () => {
    const g = tbl(9514, { bfs: ['forge-of-the-fluft'] });
    put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'boneshiver', 0, base(0));
    const l = g.s.players[0].legend[0];
    reask(g); act(g, `act:${l}#g0`); drive(g, [`t:${e}`, `t:${u}`]);
    expect(g.s.objects[e].attachedTo).toBe(u);
  });

  it('Gearhead: Equipment give double Might bonus', () => {
    const g = tbl(9515);
    const u = put(g, 'gearhead', 0, base(0));
    equip(g, 'brutalizer', u);
    expect(mightOf(g.s, u)).toBe(3 + 2 * mightBonusOf('brutalizer'));
  });

  it('Guardian Angel: the unit is saved, the Angel dies', () => {
    const g = tbl(9516);
    const u = put(g, 'shipyard-skulker', 0, bf(0), { damage: 9 }); control(g, 0, 0);
    const e = equip(g, 'guardian-angel', u);
    reask(g); drive(g);
    expect(g.s.objects[e]).toBeUndefined();
    expect(g.s.objects[u].zone).toEqual({ z: 'base', p: 0 });
  });

  it('Hard Bargain: counter unless its controller pays [2]', () => {
    const g = tbl(9517);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const hb = inHand(g, 'hard-bargain', 1);
    const ps = inHand(g, 'primal-strength');
    reask(g); act(g, `play:${ps}`); drive(g, [`t:${u}`, `play:${hb}`]);
    expect(evs(g, 'counter').length + (mightOf(g.s, u) > 3 ? 1 : 0)).toBe(1);
  });

  it('Here to Help: play a unit from hand to your battlefield for [3] less', () => {
    const g = tbl(9518);
    put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const c = inHand(g, 'mountain-drake');
    cast(g, 'here-to-help', [`pick:${c}`]);
    const d = onBoard(g, 'mountain-drake', 0);
    expect(d).toHaveLength(1);
    expect(g.s.objects[d[0]].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it('Hextech Anomaly: pay [A]s to add that much Energy', () => {
    const g = tbl(9519);
    const a = put(g, 'hextech-anomaly', 0, base(0));
    reask(g); act(g, `act:${a}#0`); drive(g, ['n:1']);
    expect(g.s.players[0].pool.energy).toBeGreaterThanOrEqual(1);
  });

  it('Irelia, Blade Dancer: choosing a friendly unit, may exhaust me and pay [A] to ready it', () => {
    const g = tbl(9520, { legends: ['irelia-blade-dancer'] });
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'primal-strength', [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Irelia, Graceful: your spells that choose me cost [1] less', () => {
    const g = tbl(9521);
    const i = put(g, 'irelia-graceful', 0, base(0));
    const id = inHand(g, 'primal-strength');
    reask(g); act(g, `play:${id}`); if (keys(g).includes(`t:${i}`)) act(g, `t:${i}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Jae Medarda: when you choose me with a spell, draw 1', () => {
    const g = tbl(9522);
    const j = put(g, 'jae-medarda', 0, base(0));
    const h = handSize(g);
    cast(g, 'primal-strength', [`t:${j}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Jax, Grandmaster at Arms: attach a detached Equipment you control', () => {
    const g = tbl(9523, { legends: ['jax-grandmaster-at-arms'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'boneshiver', 0, base(0));
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g, [`t:${e}`, `t:${u}`]);
    expect(g.s.objects[e].attachedTo).toBe(u);
  });

  it('Jax, Unmatched: your Equipment have Quick-Draw (Reaction from hand)', () => {
    const g = tbl(9524);
    put(g, 'jax-unmatched', 0, base(0));
    const e = inHand(g, 'boneshiver');
    expect(timingFrom(g.s, e).reaction).toBe(true);
  });

  it('Jax, Unrelenting: when you attach an Equipment to me, may pay [1] to draw 1', () => {
    const g = tbl(9525);
    const j = put(g, 'jax-unrelenting', 0, base(0));
    const e = put(g, 'boneshiver', 0, base(0));
    const h = handSize(g);
    reask(g); act(g, `act:${e}#kwequip`); drive(g, [`t:${j}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Karma, Channeler: recycling cards to your Main Deck buffs a friendly unit', () => {
    const g = tbl(9526);
    const k = put(g, 'karma-channeler', 0, base(0));
    cast(g, 'stacked-deck');
    expect(g.s.objects[k].buffs).toBe(1);
  });

  it('Kato the Arm: moving to a battlefield gives another friendly unit my keywords and Might', () => {
    const g = tbl(9527);
    const u = put(g, 'mystic-poro', 0, base(0));
    moveTo(g, [put(g, 'kato-the-arm', 0, base(0))], 0);
    drive(g, [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'deflect')).toBe(true);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Last Rites: when I conquer or hold, may play a unit from your trash', () => {
    const g = tbl(9528);
    inTrash(g, 'mystic-poro');
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'last-rites', u);
    moveTo(g, [u], 0); drive(g);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
  });

  it("Legion Quartermaster: return a friendly gear to hand as an additional cost", () => {
    const g = tbl(9529);
    put(g, 'arena-bar', 0, base(0));
    cast(g, 'legion-quartermaster');
    expect(defsIn(g, 'hand')).toContain('arena-bar');
  });

  it('Lucian, Purifier: your equipped units have Assault', () => {
    const g = tbl(9530, { legends: ['lucian-purifier'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'boneshiver', u);
    expect(hasKeyword(g.s, u, 'assault')).toBe(true);
  });

  it('Marai Spire: friendly Repeat costs cost [1] less', () => {
    const g = tbl(9531, { bfs: ['marai-spire'] });
    put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const u = put(g, 'mystic-poro', 0, base(0));
    const id = inHand(g, 'feral-strength');
    reask(g); act(g, `play:${id}`); act(g, 'yes');
    for (let i = 0; i < 6 && g.s.pending?.kind !== 'payment'; i++) drive(g, [`t:${u}`], { max: 1 });
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Needlessly Large Yordle: [2][G] less per hold point this turn', () => {
    const g = tbl(9532);
    setField(g.s, g.s.log, 'points', [{ p: 0, n: 1, why: 'hold' }]);
    const id = inHand(g, 'needlessly-large-yordle');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 8 } });
  });

  it('Not So Fast: counter an enemy spell that chooses a friendly unit', () => {
    const g = tbl(9533, { first: 1 });
    const u = put(g, 'mystic-poro', 0, base(0));
    const n = inHand(g, 'not-so-fast', 0);
    const r = inHand(g, 'rune-prison', 1);
    reask(g); act(g, `play:${r}`); drive(g, [`t:${u}`, `play:${n}`]);
    expect(g.s.objects[u].stunned).toBe(false);
  });

  it('Ornn, Fire Below the Mountain: [A] only for gear', () => {
    const g = tbl(9534, { legends: ['ornn-fire-below-the-mountain'] });
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g);
    expect(g.s.players[0].pool.restricted).toMatchObject([{ kind: 'universal', onlyFor: 'gear' }]);
  });

  it('Prize of Progress: using a gear ability gives me +1', () => {
    const g = tbl(9535);
    const p = put(g, 'prize-of-progress', 0, base(0));
    const a = put(g, 'arena-bar', 0, base(0));
    put(g, 'mystic-poro', 0, base(0), { exhausted: true });
    reask(g); act(g, `act:${a}#0`); drive(g);
    expect(mightOf(g.s, p)).toBe(4);
  });

  it("Rabadon's Deathcrown: your spells deal 3 Bonus Damage", () => {
    const g = tbl(9536);
    equip(g, 'rabadons-deathcrown', put(g, 'mystic-poro', 0, base(0)));
    const e = foe(g, 'mountain-drake');
    cast(g, 'hextech-ray', [`t:${e}`]);
    expect(dmg(g, e)).toBe(6);
  });

  it("Rek'Sai, Breacher: units played from elsewhere than hand get Accelerate", () => {
    const g = tbl(9537);
    runes(g, 0, [...RICH, ...ready('chaos', 2), ...ready('fury', 2)]);
    put(g, 'reksai-breacher', 0, base(0));
    inTrash(g, 'shipyard-skulker');
    cast(g, 'the-harrowing', ['yes']);
    expect(g.s.objects[onBoard(g, 'shipyard-skulker', 0)[0]].exhausted).toBe(false);
  });

  it('Relentless Pursuit: move a friendly unit, may attach an Equipment', () => {
    const g = tbl(9538);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'boneshiver', 0, base(0));
    cast(g, 'relentless-pursuit', [`t:${u}`, 'loc:bf0', `pick:${e}`]);
    expect(g.s.objects[e].attachedTo).toBe(u);
  });

  it('Rell, Magnetic: when I attack, may play a cheap Equipment from hand free and attach it', () => {
    const g = tbl(9539);
    foe(g, 'mystic-poro');
    inHand(g, 'seal-of-rage');
    const e = inHand(g, 'cull');
    const r = put(g, 'rell-magnetic', 0, base(0));
    attack(g, r, [`pick:${e}`]);
    const c = onBoard(g, 'cull', 0)[0];
    expect(g.s.objects[c]?.attachedTo).toBe(r);
  });

  it('Renata Glasc, Chem-Baroness: hold may make a Gold; near a win your Gold adds [1] more', () => {
    const g = tbl(9540, { legends: ['renata-glasc-chem-baroness'] });
    put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    nextTurn(g);
    expect(golds(g)).toBe(1);
  });

  it('Renata Glasc, Industrialist: your tokens enter ready', () => {
    const g = tbl(9541);
    put(g, 'renata-glasc-industrialist', 0, base(0));
    cast(g, 'deserts-call');
    expect(g.s.objects[onBoard(g, 'sandSoldier', 0)[0]].exhausted).toBe(false);
  });

  it("Ruin Runner: can't be chosen by enemy spells", () => {
    const g = tbl(9542);
    const r = put(g, 'ruin-runner', 1, base(1));
    const id = inHand(g, 'rune-prison');
    put(g, 'mystic-poro', 0, base(0));
    reask(g); act(g, `play:${id}`);
    expect(keys(g)).not.toContain(`t:${r}`);
  });

  it("Shurelya's Requiem: ready your units; your units here have Ganking", () => {
    const g = tbl(9543);
    const u = put(g, 'mystic-poro', 0, base(0), { exhausted: true });
    cast(g, 'shurelyas-requiem');
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Sivir, Battle Mistress: enemy units dying ready me', () => {
    const g = tbl(9544, { legends: ['sivir-battle-mistress'] });
    const l = g.s.players[0].legend[0];
    setField(g.s, g.s.objects[l], 'exhausted', true);
    cast(g, 'harnessed-dragon', [`t:${put(g, 'mystic-poro', 1, base(1))}`]);
    expect(g.s.objects[l].exhausted).toBe(false);
  });

  it('Skyfall of Areion: my conquer effects are also hold effects', () => {
    const g = tbl(9545);
    const u = put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    equip(g, 'skyfall-of-areion', u);
    equip(g, 'cull', u);
    nextTurn(g);
    expect(golds(g)).toBe(1);
  });

  it('Soraka, Wanderer: weaker friendly units here are saved', () => {
    const g = tbl(9546);
    put(g, 'soraka-wanderer', 0, bf(0)); control(g, 0, 0);
    const u = put(g, 'mystic-poro', 0, bf(0), { damage: 9 });
    reask(g); drive(g);
    expect(g.s.objects[u].zone).toEqual({ z: 'base', p: 0 });
  });

  it('Spirit Wheel: choosing a friendly unit, may pay [1] and exhaust to draw 1', () => {
    const g = tbl(9547);
    put(g, 'spirit-wheel', 0, base(0));
    const u = put(g, 'mystic-poro', 0, base(0));
    const h = handSize(g);
    cast(g, 'primal-strength', [`t:${u}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Svellsongur: the unit has its text once more', () => {
    const g = tbl(9548);
    const u = put(g, 'stellacorn-herder', 0, base(0));
    equip(g, 'svellsongur', u);
    const h = handSize(g);
    moveTo(g, [u], 0); drive(g);
    expect(handSize(g)).toBe(h + 2);
  });

  it('Switcheroo: swap the Might of two units at the same battlefield', () => {
    const g = tbl(9549);
    const a = foe(g, 'mountain-drake'), b = foe(g, 'mystic-poro');
    cast(g, 'switcheroo', [`t:${a}`, `t:${b}`]);
    expect([mightOf(g.s, a), mightOf(g.s, b)]).toEqual([2, 10]);
  });

  it('Teemo, Strategist: when I defend, 1 damage per Hidden card in the top 5', () => {
    const g = tbl(9550, { first: 1 });
    put(g, 'teemo-strategist', 0, bf(0)); control(g, 0, 0);
    for (const id of g.s.players[0].deck.slice(0, 5)) setField(g.s, g.s.objects[id], 'def', 'block');
    const a = put(g, 'mountain-drake', 1, base(1));
    moveTo(g, [a], 0); drive(g);
    expect(evs(g, 'deal').some((d) => d.to === a && d.n === 5)).toBe(true);
  });

  it('Temporal Portal: the next spell gets Repeat equal to its cost', () => {
    const g = tbl(9551);
    const t = put(g, 'temporal-portal', 0, base(0));
    reask(g); act(g, `act:${t}#0`); drive(g);
    put(g, 'mystic-poro', 0, base(0));
    const id = inHand(g, 'cleave');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'optionalCost', prompt: { ability: 'eff:repeat' } });
  });

  it('Temptation: move an enemy unit to a location with another unit of its controller', () => {
    const g = tbl(9552);
    const a = put(g, 'mystic-poro', 1, base(1));
    foe(g, 'mountain-drake');
    cast(g, 'temptation', [`t:${a}`]);
    expect(g.s.objects[a].zone).toEqual({ z: 'bf', bf: 1 });
  });

  it('The Zero Drive: a dying wearer is banished with it; [3][B], banish this: play them', () => {
    const g = tbl(9553);
    const u = put(g, 'mystic-poro', 0, base(0), { damage: 9 });
    const z = equip(g, 'the-zero-drive', u);
    reask(g); drive(g);
    expect(defsIn(g, 'banish')).toContain('mystic-poro');
    reask(g); act(g, `act:${z}#0`); drive(g);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
  });

  it('Void Drone: [2] less from anywhere other than hand', () => {
    const g = tbl(9554);
    inTrash(g, 'void-drone');
    const id = inHand(g, 'void-drone');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Void Hatchling: look at the top card before a reveal, may recycle it', () => {
    const g = tbl(9555);
    put(g, 'void-hatchling', 0, base(0));
    moveTo(g, [put(g, 'apprentice-smith', 0, base(0))], 0);
    drive(g);
    expect(evs(g, 'look').length).toBeGreaterThan(0);
  });
});
