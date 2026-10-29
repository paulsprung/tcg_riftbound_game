import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { setField } from '../../src/game/state/mut.ts';
import { moveDestinations } from '../../src/game/rules/move.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, hide, moveTo, nextTurn, onBoard } from './helpers/cards.ts';
import { attack, defsIn, dmg, emptyHand, equip, foe, tbl } from './helpers/setCards.ts';

/*
 * Unleashed (UNL), the cards beyond the Champion Decks (cards/defs/unl-set.ts):
 * one behaviour test per card at least.
 */

const xp = (g: ReturnType<typeof tbl>, n: number, p: 0 | 1 = 0) => setField(g.s, g.s.players[p], 'xp', n);

describe('Unleashed set: batch 1', () => {
  it("Abandon: counter a spell, it returns to its owner's hand; Predict", () => {
    const g = tbl(9601, { first: 1 });
    const u = put(g, 'shipyard-skulker', 1, base(1));
    const a = inHand(g, 'abandon', 0);
    const ps = inHand(g, 'primal-strength', 1);
    reask(g); act(g, `play:${ps}`); drive(g, [`t:${u}`, `play:${a}`]);
    expect(evs(g, 'counter')).toHaveLength(1);
    expect(defsIn(g, 'hand', 1)).toContain('primal-strength');
    expect(mightOf(g.s, u)).toBe(3);
  });

  it('Abandoned Hall: a player who plays a spell may give their unit here +1', () => {
    const g = tbl(9602, { bfs: ['abandoned-hall'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'rune-prison', [`t:${e}`]);
    expect(mightOf(g.s, u)).toBe(4);
  });

  it('Alpha Strike: a friendly unit deals its Might split among enemy units at battlefields; 1 XP per kill', () => {
    const g = tbl(9603);
    const u = put(g, 'mountain-drake', 0, base(0));
    const a = foe(g, 'shipyard-skulker');
    const b = put(g, 'mystic-poro', 1, bf(1));
    cast(g, 'alpha-strike', [`t:${u}`, `x:${a}`, `x:${a}`, `x:${a}`, `x:${b}`, `x:${b}`, `x:${a}`, `x:${a}`, `x:${a}`, `x:${a}`, `x:${a}`]);
    expect(g.s.objects[a]).toBeUndefined();
    expect(g.s.objects[b]).toBeUndefined();
    expect(g.s.players[0].xp).toBe(2);
  });

  it("Alpha Wildclaw: your weaker units here can't be chosen by enemy spells", () => {
    const g = tbl(9604, { first: 1 });
    const w = put(g, 'alpha-wildclaw', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    const v = put(g, 'shipyard-skulker', 0, base(0));
    control(g, 0, 0);
    const r = inHand(g, 'rune-prison', 1);
    reask(g); act(g, `play:${r}`);
    expect(keys(g)).not.toContain(`t:${u}`);
    expect(keys(g)).toContain(`t:${w}`);
    expect(keys(g)).toContain(`t:${v}`);
  });

  it('Altar of Blood: a unit that would die here in combat is saved for [A][A][A]', () => {
    const g = tbl(9605, { bfs: [undefined, 'altar-of-blood'] });
    foe(g, 'shipyard-skulker');
    const p = put(g, 'vanguard-sergeant', 0, base(0));
    setField(g.s, g.s.objects[p], 'damage', [{ amount: 2, by: null, sources: [], combat: false, group: 0 }]);
    attack(g, p);
    expect(g.s.objects[p]?.zone).toEqual({ z: 'base', p: 0 });
    expect(g.s.objects[p].exhausted).toBe(true);
    expect(dmg(g, p)).toBe(0);
  });

  it("Angler Beast: return all units with 2 or less to their owners' hands", () => {
    const g = tbl(9606);
    put(g, 'mystic-poro', 1, base(1));
    const s = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'angler-beast');
    expect(defsIn(g, 'hand', 1)).toContain('mystic-poro');
    expect(g.s.objects[s]).toBeDefined();
  });

  it('Arachnoid Horror: it and friendly units may be played where an enemy unit is alone', () => {
    const g = tbl(9607);
    foe(g, 'mystic-poro');
    const id = inHand(g, 'arachnoid-horror');
    reask(g); act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf1');
    act(g, 'loc:bf1'); drive(g);
    const sk = inHand(g, 'shipyard-skulker');
    put(g, 'arachnoid-horror', 0, base(0));
    reask(g); act(g, `play:${sk}`);
    expect(keys(g)).toContain('loc:bf1');
  });

  it('Ashe, Focused: banish a card from their hand; it returns when they hold', () => {
    const g = tbl(9608);
    const c = inHand(g, 'premonition', 1);
    cast(g, 'ashe-focused', [`pick:${c}`]);
    expect(defsIn(g, 'banish', 1)).toContain('premonition');
    foe(g, 'shipyard-skulker');
    nextTurn(g);
    expect(defsIn(g, 'hand', 1)).toContain('premonition');
  });

  it('Atakhan: killing a friendly unit makes me cheaper by its cost', () => {
    const g = tbl(9609);
    runes(g, 0, [...ready('order', 4), ...ready('fury', 8)]);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const id = inHand(g, 'atakhan');
    reask(g); act(g, `play:${id}`); act(g, 'yes');
    if (keys(g).includes(`pick:${u}`)) act(g, `pick:${u}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 7 } });
  });

  it('Atakhan: when I attack, the defender must kill one of their units here', () => {
    const g = tbl(9610);
    foe(g, 'mountain-drake'); put(g, 'mountain-drake', 1, bf(1));
    const a = put(g, 'atakhan', 0, base(0));
    attack(g, a);
    expect(onBoard(g, 'mountain-drake', 1)).toHaveLength(1);
  });

  it('Bandle Soldier: Level 3: I enter ready', () => {
    const g = tbl(9611);
    xp(g, 3);
    cast(g, 'bandle-soldier');
    expect(g.s.objects[onBoard(g, 'bandle-soldier', 0)[0]].exhausted).toBe(false);
  });

  it('Baron Nashor: adds the Baron Pit and enters there; others +2; units can move to the Pit from anywhere', () => {
    const g = tbl(9612);
    runes(g, 0, [...ready('chaos', 4), ...ready('fury', 8)]);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'baron-nashor');
    expect(g.s.bfs).toHaveLength(3);
    const n = onBoard(g, 'baron-nashor', 0)[0];
    expect(g.s.objects[n].zone).toEqual({ z: 'bf', bf: 2 });
    expect(mightOf(g.s, u)).toBe(5);
    expect(moveDestinations(g.s, u)).toContainEqual({ z: 'bf', bf: 2 });
  });

  it('Bewitching Spirit: the chosen player discards 1', () => {
    const g = tbl(9613);
    const n = handSize(g, 1);
    cast(g, 'bewitching-spirit', ['mode:1']);
    expect(handSize(g, 1)).toBe(n - 1);
  });

  it('Black Flame Altar: units here with Temporary have Shield', () => {
    const g = tbl(9614, { bfs: ['black-flame-altar'] });
    const t = put(g, 'sprite', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    expect(hasKeyword(g.s, t, 'shield')).toBe(true);
    expect(hasKeyword(g.s, u, 'shield')).toBe(false);
  });

  it('Black Rose Dignitary: Deathknell: channel 1 rune exhausted', () => {
    const g = tbl(9615);
    const d = put(g, 'black-rose-dignitary', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'soul-harvest', [`t:${d}`]);
    const ch = evs(g, 'channel').find((c) => c.rule === '431');
    expect(ch?.objs).toHaveLength(1);
    expect(g.s.objects[ch!.objs[0]].exhausted).toBe(true);
  });

  it("Blighted Battleaxe: at the end of your turn, if I didn't conquer, unattach and deal 4 to me", () => {
    const g = tbl(9616);
    const u = put(g, 'mountain-drake', 0, base(0));
    const e = equip(g, 'blighted-battleaxe', u);
    reask(g); act(g, 'end'); drive(g);
    expect(evs(g, 'detach').some((d) => d.obj === e)).toBe(true);
    expect(evs(g, 'deal').some((d) => d.to === u && d.n === 4)).toBe(true);
  });

  it('Blood Rose: playing a unit, may pay [1] for 1 XP; spend 3 XP to ready a unit', () => {
    const g = tbl(9617);
    put(g, 'blood-rose', 0, base(0));
    cast(g, 'shipyard-skulker');
    expect(g.s.players[0].xp).toBe(1);
    const br = onBoard(g, 'blood-rose', 0)[0];
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    xp(g, 3);
    reask(g); act(g, `act:${br}#1`); drive(g, [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Blue Sentinel: its hold triggers twice here; [A] at the start of the Main Phase', () => {
    const g = tbl(9618);
    put(g, 'blue-sentinel', 0, bf(0));
    control(g, 0, 0);
    nextTurn(g);
    expect(g.s.players[0].pool.universal).toBe(2);
  });

  it('Bone Skewer: an opponent plays a unit from their hand to the battlefield, stunned', () => {
    const g = tbl(9619);
    const c = inHand(g, 'shipyard-skulker', 1);
    cast(g, 'bone-skewer', [`t:${g.s.bfs[0].obj}`, `pick:${c}`]);
    const u = onBoard(g, 'shipyard-skulker', 1)[0];
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
    expect(g.s.objects[u].stunned).toBe(true);
  });

  it('Call to Battle: move your unit to your battlefield; the opponent moves one of theirs there', () => {
    const g = tbl(9620);
    put(g, 'mountain-drake', 0, bf(0));
    control(g, 0, 0);
    const s = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'call-to-battle', [`t:${s}`, 'loc:bf0', `pick:${e}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(s))).toBe(true);
    expect(evs(g, 'move').some((m) => m.objs.includes(e) && m.to.z === 'bf')).toBe(true);
  });

  it('Chakram Dancer: your other units here have Shield this turn', () => {
    const g = tbl(9621);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'chakram-dancer', ['loc:bf0']);
    expect(hasKeyword(g.s, u, 'shield')).toBe(true);
  });

  it('Clash of Giants: two units deal their Mights to each other', () => {
    const g = tbl(9622);
    const a = put(g, 'mountain-drake', 0, base(0));
    const b = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'clash-of-giants', [`t:${a}`, `t:${b}`]);
    expect(dmg(g, a)).toBe(3);
    expect(g.s.objects[b]).toBeUndefined();
  });

  it('Concentrate: draw 2; Level 6 costs [2] less, Level 11 [4] less', () => {
    const g = tbl(9623);
    xp(g, 6);
    const id = inHand(g, 'concentrate');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
    const h = tbl(9624);
    xp(h, 11);
    const n = handSize(h);
    cast(h, 'concentrate');
    expect(handSize(h)).toBe(n + 2);
  });

  it('Conscription: take an enemy unit with 3 or less, exhaust and recall it; with 5 XP any enemy unit', () => {
    const g = tbl(9625);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'conscription', [`t:${e}`]);
    expect(g.s.objects[e]).toMatchObject({ controller: 0, exhausted: true, zone: { z: 'base', p: 0 } });
    const h = tbl(9626);
    xp(h, 5);
    const d = foe(h, 'mountain-drake');
    const id = inHand(h, 'conscription');
    reask(h); act(h, `play:${id}`); act(h, 'yes'); drive(h, [`t:${d}`]);
    expect(h.s.objects[d]).toMatchObject({ controller: 0, zone: { z: 'base', p: 0 } });
    expect(h.s.players[0].xp).toBe(0);
  });

  it("Crescent Guardian: after a spell, may pay [P] more to enter ready", () => {
    const g = tbl(9627);
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'rune-prison', [`t:${e}`]);
    const id = inHand(g, 'crescent-guardian');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g);
    expect(g.s.objects[onBoard(g, 'crescent-guardian', 0)[0]].exhausted).toBe(false);
  });

  it('Crescent Strike: 4 to an enemy unit at a battlefield, 1 to each other enemy unit there', () => {
    const g = tbl(9628);
    const a = foe(g, 'mountain-drake');
    const b = put(g, 'mountain-drake', 1, bf(1));
    cast(g, 'crescent-strike', [`t:${g.s.bfs[1].obj}`, `t:${a}`]);
    expect([dmg(g, a), dmg(g, b)]).toEqual([4, 1]);
  });
});

void inTrash; void moveTo;

const top = (g: ReturnType<typeof tbl>, def: string, p: 0 | 1 = 0) => {
  const id = g.s.players[p].deck[0];
  setField(g.s, g.s.objects[id], 'def', def);
  return id;
};

describe('Unleashed set: batch 2', () => {
  it('Crowd Favorite: spend 2 XP to buff me', () => {
    const g = tbl(9631);
    const u = put(g, 'crowd-favorite', 0, base(0));
    xp(g, 2);
    reask(g); act(g, `act:${u}#0`); drive(g);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Cursed Sarcophagus: banish the units of your trash; [E]: play one of them', () => {
    const g = tbl(9632);
    inTrash(g, 'shipyard-skulker');
    cast(g, 'cursed-sarcophagus');
    expect(defsIn(g, 'banish')).toContain('shipyard-skulker');
    const c = onBoard(g, 'cursed-sarcophagus', 0)[0];
    reask(g); act(g, `act:${c}#1`); drive(g);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
  });

  it("Curtain Call: each Repeat chooses a mode the others didn't", () => {
    const g = tbl(9633);
    put(g, 'shipyard-skulker', 1, base(1));
    const id = inHand(g, 'curtain-call');
    reask(g); act(g, `play:${id}`);
    act(g, 'yes');                                                   // a second Repeat would have no mode left
    const n = handSize(g);
    act(g, 'mode:0');                                                // the second execution: mode 2, the only one left
    drive(g);
    expect(handSize(g)).toBe(n + 1);
    expect(evs(g, 'deal').some((d) => d.n === 3)).toBe(true);
  });

  it('Daisy: [1] less per pet tag; with all four, stun an enemy unit here as I attack', () => {
    const g = tbl(9634);
    put(g, 'bird', 0, base(0)); put(g, 'mystic-poro', 0, base(0));
    const id = inHand(g, 'daisy');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 7 } });
    const h = tbl(9635);
    put(h, 'bird', 0, base(0)); put(h, 'mystic-poro', 0, base(0)); put(h, 'alpha-wildclaw', 0, base(0)); put(h, 'stalking-wolf', 0, base(0));
    const e = foe(h, 'mountain-drake');
    const d = put(h, 'daisy', 0, base(0));
    attack(h, d);
    expect(evs(h, 'stun').some((x) => x.objs.includes(e))).toBe(true);
  });

  it("Dancing Grenade: deal 2; its controller may play it again for [A], dealing 1 more each time", () => {
    const g = tbl(9636);
    const e = foe(g, 'mountain-drake');
    cast(g, 'dancing-grenade', [`t:${e}`]);
    const ns = evs(g, 'deal').map((d) => d.n);
    expect(ns.slice(0, 2)).toEqual([2, 3]);
  });

  it('Deadly Flourish: deal 3 to an enemy unit; when it dies this turn, a Gold', () => {
    const g = tbl(9637);
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'deadly-flourish', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
    expect(onBoard(g, 'gold', 0)).toHaveLength(1);
  });

  it('Death from Below: kill a unit at a battlefield; if it had 3 or less, may play this again from the trash for [A]', () => {
    const g = tbl(9638);
    const a = foe(g, 'shipyard-skulker');
    const b = put(g, 'mystic-poro', 1, bf(1));
    cast(g, 'death-from-below', [`t:${a}`, `t:${b}`]);
    expect(g.s.objects[a]).toBeUndefined();
    expect(g.s.objects[b]).toBeUndefined();
  });

  it('Demacian Diplomat: gain 1 XP', () => {
    const g = tbl(9639);
    cast(g, 'demacian-diplomat');
    expect(g.s.players[0].xp).toBe(1);
  });

  it("Determined Sentry: I can't move to base", () => {
    const g = tbl(9640);
    const u = put(g, 'determined-sentry', 0, bf(0));
    control(g, 0, 0);
    expect(moveDestinations(g.s, u)).toEqual([]);
  });

  it('Diana, Lunari: as a showdown begins here, may pay [1] to Predict, then draw the top card if a spell', () => {
    const g = tbl(9641);
    const d = put(g, 'diana-lunari', 0, base(0));
    const t = top(g, 'premonition');
    moveTo(g, [d], 0);
    drive(g, [`keep:${t}`]);
    expect(defsIn(g, 'hand')).toContain('premonition');
  });

  it('Diana, Scorn of the Moon: [E]: add [1], only during showdowns', () => {
    const g = tbl(9642, { legends: ['diana-scorn-of-the-moon'] });
    const l = g.s.players[0].legend[0];
    reask(g);
    expect(keys(g)).not.toContain(`act:${l}#0`);
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    expect(g.s.showdown).not.toBeNull();
    expect(keys(g)).toContain(`act:${l}#0`);
  });

  it("Disposal Order: recycle up to 3 cards from opponents' trashes, or draw 1", () => {
    const g = tbl(9643);
    const c = inTrash(g, 'premonition', 1);
    cast(g, 'disposal-order', ['mode:0', `t:${c}`, 'done']);
    expect(defsIn(g, 'trash', 1)).not.toContain('premonition');
    expect(defsIn(g, 'deck', 1)).toContain('premonition');
  });

  it('Double Trouble: look at 3, may draw a unit, recycle the rest', () => {
    const g = tbl(9644);
    const t = top(g, 'mountain-drake');
    cast(g, 'double-trouble', [`pick:${t}`]);
    expect(defsIn(g, 'hand')).toContain('mountain-drake');
  });

  it('Downstage Dramatics: draw 1', () => {
    const g = tbl(9645);
    const n = handSize(g);
    cast(g, 'downstage-dramatics');
    expect(handSize(g)).toBe(n + 1);
  });

  it('Dragonsoul Sage: [E]: add [1]', () => {
    const g = tbl(9646);
    const u = put(g, 'dragonsoul-sage', 0, base(0));
    reask(g); act(g, `act:${u}#0`); drive(g);
    expect(g.s.players[0].pool.energy).toBe(1);
  });

  it('Dramatic Visionary: Deathknell: Predict 2', () => {
    const g = tbl(9647);
    const u = put(g, 'dramatic-visionary', 0, bf(0));
    control(g, 0, 0);
    setField(g.s, g.s.objects[u], 'damage', [{ amount: 9, by: null, sources: [], combat: false, group: 0 }]);
    reask(g); drive(g);
    expect(evs(g, 'look').some((l) => l.objs.length === 2)).toBe(true);
  });

  it('Dusk Rose Lab: at the start of your Beginning Phase, may kill a unit you control here to draw 1', () => {
    const g = tbl(9648, { bfs: ['dusk-rose-lab'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    nextTurn(g);
    expect(g.s.objects[u]).toBeUndefined();
  });

  it('Eclipse: -4 this turn; Predict', () => {
    const g = tbl(9649);
    const u = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'eclipse', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
    expect(evs(g, 'look')).not.toHaveLength(0);
  });

  it('Elder Dragon: up to one enemy unit at each location takes 1; any of your damage kills enemy units', () => {
    const g = tbl(9650);
    runes(g, 0, [...ready('body', 6), ...ready('fury', 6)]);
    const a = put(g, 'mountain-drake', 1, base(1));
    const b = foe(g, 'mountain-drake');
    const c = put(g, 'mountain-drake', 1, bf(1));
    cast(g, 'elder-dragon', [`pick:${a}`, `pick:${b}`]);
    expect(g.s.objects[a]).toBeUndefined();
    expect(g.s.objects[b]).toBeUndefined();
    expect(g.s.objects[c]).toBeDefined();
  });

  it('Enthralling Protector: spend 2 XP to buff me', () => {
    const g = tbl(9651);
    const u = put(g, 'enthralling-protector', 0, base(0));
    xp(g, 2);
    reask(g); act(g, `act:${u}#0`); drive(g);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Evershade Stalker: discard 1, then draw 1', () => {
    const g = tbl(9652);
    const n = handSize(g);
    cast(g, 'evershade-stalker');
    expect(handSize(g)).toBe(n);
    expect(g.s.log.discards[0]).toBe(1);
  });

  it('Fate Weaver: look at 4, may draw a spell costing [4] or more', () => {
    const g = tbl(9653);
    const t = top(g, 'primal-strength');
    cast(g, 'fate-weaver', [`pick:${t}`]);
    expect(defsIn(g, 'hand')).toContain('primal-strength');
  });

  it('Flurry of Feathers: counter a spell, or four Birds', () => {
    const g = tbl(9654);
    cast(g, 'flurry-of-feathers', ['mode:1']);
    expect(onBoard(g, 'bird', 0)).toHaveLength(4);
  });

  it('Forbidding Waste: a unit defending alone here has -2', () => {
    const g = tbl(9655, { bfs: [undefined, 'forbidding-waste'] });
    const e = foe(g, 'mountain-drake');
    setField(g.s, g.s.objects[e], 'designation', 'defender');
    expect(mightOf(g.s, e)).toBe(8);
  });

  it('Forgotten Library: while you control it, Predict after a spell you spent [4] or more on', () => {
    const g = tbl(9656, { bfs: ['forgotten-library'] });
    put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'rune-prison', [`t:${u}`]);
    expect(evs(g, 'look')).toHaveLength(0);
    cast(g, 'primal-strength', [`t:${u}`]);
    expect(evs(g, 'look')).toHaveLength(1);
  });
});

describe('Unleashed set: batch 3', () => {
  it('Forgotten Signpost: exhaust a unit to move another one to its location', () => {
    const g = tbl(9661);
    const sp = put(g, 'forgotten-signpost', 0, base(0));
    const a = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    const b = put(g, 'mystic-poro', 0, base(0));
    reask(g); act(g, `act:${sp}#0`); drive(g, [`t:${b}`, `pick:${a}`]);
    expect(g.s.objects[a].exhausted).toBe(true);
    expect(g.s.objects[b].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it('Fresh Beans: playing a unit during a showdown, may exhaust this to draw 1', () => {
    const g = tbl(9662);
    put(g, 'fresh-beans', 0, base(0));
    const n = handSize(g);
    cast(g, 'shipyard-skulker');
    expect(handSize(g)).toBe(n);
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    expect(g.s.showdown).not.toBeNull();
    const m = handSize(g);
    const sk = inHand(g, 'zaunite-bouncer');
    drive(g, [`play:${sk}`]);
    expect(handSize(g)).toBe(m + 1);                                 // the unit was added and played; one drawn
  });

  it('Friendship: +1 for each pet tag among your units', () => {
    const g = tbl(9663);
    put(g, 'bird', 0, base(0)); put(g, 'mystic-poro', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'friendship', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Frigid Jewel: your second draw each turn gives a friendly unit +2', () => {
    const g = tbl(9664);
    put(g, 'frigid-jewel', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.log.draws, 0, 0);
    cast(g, 'downstage-dramatics');
    expect(mightOf(g.s, u)).toBe(3);
    cast(g, 'downstage-dramatics');
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Frisky Hunter: a Bird here', () => {
    const g = tbl(9665);
    cast(g, 'frisky-hunter');
    expect(onBoard(g, 'bird', 0)).toHaveLength(1);
  });

  it("Frozen Fortress: at the start of each player's Beginning Phase, 1 to each unit here", () => {
    const g = tbl(9666, { bfs: ['frozen-fortress'] });
    const u = put(g, 'mystic-poro', 0, bf(0));
    control(g, 0, 0);
    reask(g); act(g, 'end'); drive(g);
    expect(evs(g, 'deal').some((d) => d.to === u && d.n === 1)).toBe(true);
  });

  it("Galio, Indefatigable: I don't deal combat damage", () => {
    const g = tbl(9667);
    const e = foe(g, 'shipyard-skulker');
    const a = put(g, 'galio-indefatigable', 0, base(0));
    attack(g, a);
    expect(g.s.objects[e]).toBeDefined();
    expect(dmg(g, e)).toBe(0);
  });

  it('Gemhand Hunter: Level 6: +1', () => {
    const g = tbl(9668);
    const u = put(g, 'gemhand-hunter', 0, base(0));
    expect(mightOf(g.s, u)).toBe(2);
    xp(g, 6);
    expect(mightOf(g.s, u)).toBe(3);
  });

  it('Gentle Gemdragon: playing it or another Dragon readies up to 2 runes', () => {
    const g = tbl(9669);
    put(g, 'gentle-gemdragon', 0, base(0));
    cast(g, 'mountain-drake');
    expect(evs(g, 'ready').some((r) => r.objs.length === 2)).toBe(true);
  });

  it("Grim Apothecary: may return a friendly unit at a battlefield to its owner's hand", () => {
    const g = tbl(9670);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'grim-apothecary', ['loc:base', `t:${u}`]);
    expect(defsIn(g, 'hand')).toContain('shipyard-skulker');
  });

  it('Grim Resolve: +3; when it wins a combat this turn, 2 XP', () => {
    const g = tbl(9671);
    foe(g, 'shipyard-skulker');
    const u = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'grim-resolve', [`t:${u}`]);
    attack(g, u);
    expect(g.s.players[0].xp).toBe(2);
  });

  it('Gustwalker: Level 3: +1 and Ganking', () => {
    const g = tbl(9672);
    const u = put(g, 'gustwalker', 0, base(0));
    xp(g, 3);
    expect(mightOf(g.s, u)).toBe(4);
    expect(hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it('Gutter Palace: exactly 4 cards and 4 units at battlefields: win; Discard 1, [E]: a Bird', () => {
    const g = tbl(9673);
    const gp = put(g, 'gutter-palace', 0, base(0));
    reask(g); act(g, `act:${gp}#1`); drive(g);
    expect(onBoard(g, 'bird', 0)).toHaveLength(1);
    const h = tbl(9674);
    put(h, 'gutter-palace', 0, base(0));
    for (let i = 0; i < 4; i++) put(h, 'shipyard-skulker', 0, bf(0));
    control(h, 0, 0);
    emptyHand(h);
    for (let i = 0; i < 4; i++) inHand(h, 'shipyard-skulker');
    nextTurn(h);
    expect(h.s.result?.winner).toBe(0);
  });

  it('Heedless Resurrection: kill a friendly unit to play a unit from your trash that costs no more', () => {
    const g = tbl(9675);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    inTrash(g, 'mountain-drake');
    const c = inTrash(g, 'mystic-poro');
    cast(g, 'heedless-resurrection', [`pick:${u}`, `pick:${c}`]);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
    expect(onBoard(g, 'mountain-drake', 0)).toHaveLength(0);
  });

  it('Heroic Charge: +1 to a friendly unit and stun an enemy unit at its location', () => {
    const g = tbl(9676);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    const e = put(g, 'mystic-poro', 1, bf(0));
    cast(g, 'heroic-charge', [`t:${u}`, `t:${e}`]);
    expect(evs(g, 'mightChanged').some((m) => m.obj === u)).toBe(true);
    expect(evs(g, 'stun').some((x) => x.objs.includes(e))).toBe(true);
  });

  it('Honeyfruit: enters exhausted; [E]: add [A]; Level 6: [1][A] too', () => {
    const g = tbl(9677);
    cast(g, 'honeyfruit');
    const h = onBoard(g, 'honeyfruit', 0)[0];
    expect(g.s.objects[h].exhausted).toBe(true);
    setField(g.s, g.s.objects[h], 'exhausted', false);
    xp(g, 6);
    reask(g); act(g, `act:${h}#2`); drive(g);
    expect(g.s.players[0].pool).toMatchObject({ energy: 1, universal: 1 });
  });

  it('Hwei, Brooding Painter: moving, draw 1 and discard 1; a spell discarded draws 1 more', () => {
    const g = tbl(9678);
    const u = put(g, 'hwei-brooding-painter', 0, base(0));
    const c = inHand(g, 'premonition');
    const n = handSize(g);
    moveTo(g, [u], 0);
    drive(g, [`pick:${c}`]);
    expect(defsIn(g, 'trash')).toContain('premonition');
    expect(handSize(g)).toBe(n + 1);
  });

  it('Icevale Archer: when I attack, may pay [1] to give a unit here -1', () => {
    const g = tbl(9679);
    const e = foe(g, 'mountain-drake');
    const a = put(g, 'icevale-archer', 0, base(0));
    attack(g, a, [`t:${e}`]);
    expect(evs(g, 'mightChanged').some((m) => m.obj === e)).toBe(true);
  });

  it('Imposing Challenger: moving, may move a weaker enemy unit here to a different battlefield', () => {
    const h = tbl(9681);
    const c = put(h, 'imposing-challenger', 0, base(0));
    const f = put(h, 'mystic-poro', 1, bf(0));
    control(h, 0, 1);
    moveTo(h, [c], 0);
    drive(h, [`t:${f}`, 'loc:bf1']);
    expect(evs(h, 'move').some((m) => m.objs.includes(f))).toBe(true);
  });

  it('Insightful Investigator: may pay 2 XP: they discard a card of your choice and draw 1', () => {
    const g = tbl(9682);
    xp(g, 2);
    const c = inHand(g, 'premonition', 1);
    cast(g, 'insightful-investigator', [`pick:${c}`]);
    expect(defsIn(g, 'trash', 1)).toContain('premonition');
    expect(g.s.players[0].xp).toBe(0);
  });

  it('Inviolus Vox: when I conquer, a friendly unit +8', () => {
    const g = tbl(9683);
    const u = put(g, 'inviolus-vox', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(mightOf(g.s, u)).toBe(16);
  });

  it('Irresistible Faefolk: moving to a battlefield, may move an enemy unit there', () => {
    const g = tbl(9684);
    const u = put(g, 'irresistible-faefolk', 0, base(0));
    const e = put(g, 'mystic-poro', 1, base(1));
    moveTo(g, [u], 0);
    drive(g, [`t:${e}`]);
    expect(g.s.objects[e]?.zone ?? { z: 'gone' }).not.toEqual({ z: 'base', p: 1 });
  });

  it('Isolate: move an enemy unit from a battlefield to its base; draw 1 if an enemy unit is alone there', () => {
    const g = tbl(9685);
    const a = foe(g, 'mystic-poro');
    put(g, 'mystic-poro', 1, bf(1));
    const n = handSize(g);
    cast(g, 'isolate', [`t:${a}`]);
    expect(g.s.objects[a].zone).toEqual({ z: 'base', p: 1 });
    expect(handSize(g)).toBe(n + 1);
  });

  it('Ivern, Friend to All: choose a pet tag as played; conquer or hold with all four tags: 1 point', () => {
    const g = tbl(9686);
    put(g, 'bird', 0, base(0)); put(g, 'mystic-poro', 0, base(0)); put(g, 'alpha-wildclaw', 0, base(0));
    const id = inHand(g, 'ivern-friend-to-all');
    reask(g); act(g, `play:${id}`); act(g, 'mode:2'); drive(g, ['loc:base']);
    const iv = onBoard(g, 'ivern-friend-to-all', 0)[0];
    setField(g.s, g.s.objects[iv], 'exhausted', false);
    moveTo(g, [iv], 0);
    drive(g);
    expect(g.s.players[0].points).toBe(2);
  });

  it('Ivern, the Green Father: conquering, may exhaust me to replace that battlefield with a Brush', () => {
    const g = tbl(9687, { legends: ['ivern-green-father'] });
    const u = put(g, 'mystic-poro', 0, base(0));
    const was = g.s.bfs[0].obj;
    moveTo(g, [u], 0);
    drive(g);
    expect(g.s.objects[g.s.bfs[0].obj].def).toBe('brush');
    expect(mightOf(g.s, u)).toBe(3);
    expect(g.s.objects[was]).toBeUndefined();
    expect(g.s.bfs[0].replacedChain).toHaveLength(1);
  });
});

describe('Unleashed set: batch 4', () => {
  it('Ivern, Nurturer: look at 3, may draw a unit; a pet revealed buffs a friendly unit', () => {
    const g = tbl(9691);
    const t = top(g, 'mystic-poro');
    cast(g, 'ivern-nurturer', [`pick:${t}`]);
    expect(defsIn(g, 'hand')).toContain('mystic-poro');
    expect(g.s.objects[onBoard(g, 'ivern-nurturer', 0)[0]].buffs).toBe(1);
  });

  it("Jhin, Meticulous Killer: after spending [4] on a spell, may be played for [B]", () => {
    const g = tbl(9692);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'primal-strength', [`t:${u}`]);
    const id = inHand(g, 'jhin-meticulous-killer');
    reask(g); act(g, `play:${id}`);
    if (keys(g).includes('yes')) act(g, 'yes');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 0 } });
  });

  it('Jhin, Murderous Artist: when I move, add [1][A]', () => {
    const g = tbl(9693);
    const u = put(g, 'jhin-murderous-artist', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(evs(g, 'pool').some((p) => p.pool.energy === 1 && p.pool.universal === 1)).toBe(true);
  });

  it('Jhin, Virtuoso: may banish a spell you spent [4] on; at four, put them in the trash, channel 4, draw 1', () => {
    const g = tbl(9694, { legends: ['jhin-virtuoso'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    for (let i = 0; i < 3; i++) {
      const c = inTrash(g, 'primal-strength');
      setField(g.s, g.s.objects[c], 'zone', { z: 'banish', p: 0 });
      g.s.players[0].trash.splice(g.s.players[0].trash.indexOf(c), 1);
      g.s.players[0].banish.push(c);
      setField(g.s, g.s.objects[c], 'links', [{ group: 'jhin-virtuoso', source: c, zone: 'banish' }]);
    }
    const n = handSize(g);
    cast(g, 'primal-strength', [`t:${u}`]);
    expect(defsIn(g, 'banish')).not.toContain('primal-strength');
    expect(defsIn(g, 'trash').filter((d) => d === 'primal-strength')).toHaveLength(4);
    expect(handSize(g)).toBe(n + 1);
    expect(evs(g, 'channel').some((c) => c.rule === '431')).toBe(true);
  });

  it('Katarina, Reckless: hiding a card readies me; playing from face down deals 2 to an enemy unit', () => {
    const g = tbl(9695);
    const k = put(g, 'katarina-reckless', 0, bf(0), { exhausted: true });
    control(g, 0, 0);
    hide(g, 'back-off', 0);
    expect(g.s.objects[k].exhausted).toBe(false);
  });

  it('Keeper of Masks: two Reflections here that become copies of me (without my play effect)', () => {
    const g = tbl(9696);
    cast(g, 'keeper-of-masks');
    expect(onBoard(g, 'keeper-of-masks', 0)).toHaveLength(3);
    expect(Object.values(g.s.objects).filter((o) => o.def === 'keeper-of-masks' && o.token)).toHaveLength(2);
  });

  it("Keeper's Verdict: an enemy unit at a battlefield goes on the top or bottom of its owner's deck", () => {
    const g = tbl(9697);
    const e = foe(g, 'mountain-drake');
    cast(g, 'keepers-verdict', [`t:${e}`, 'mode:0']);
    expect(g.s.objects[g.s.players[1].deck[0]].def).toBe('mountain-drake');
  });

  it("Kha'Zix, Mutating Horror: attacking an enemy unit alone here: +2 and 2 XP", () => {
    const g = tbl(9698);
    foe(g, 'mountain-drake');
    const k = put(g, 'khazix-mutating-horror', 0, base(0));
    attack(g, k);
    expect(g.s.players[0].xp).toBe(2);
  });

  it("Kha'Zix, Voidreaver: win a combat: 1 XP; XP abilities", () => {
    const g = tbl(9699, { legends: ['khazix-voidreaver'] });
    foe(g, 'mystic-poro');
    attack(g, put(g, 'mountain-drake', 0, base(0)));
    expect(g.s.players[0].xp).toBe(1);
    const l = g.s.players[0].legend[0];
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g); act(g, `act:${l}#1`); drive(g, [`t:${u}`]);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Kinkou Initiate: draw 1 if your other units have total Might 5 or more', () => {
    const g = tbl(9700);
    put(g, 'shipyard-skulker', 0, base(0));
    const n = handSize(g);
    cast(g, 'kinkou-initiate');
    expect(handSize(g)).toBe(n);
    put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'kinkou-initiate');
    expect(handSize(g)).toBe(n + 1);
  });

  it('LeBlanc, Deceiver: conquering, may discard 1 and exhaust me for a ready Reflection copying a unit there, with Temporary', () => {
    const g = tbl(9701, { legends: ['leblanc-deceiver'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    const copies = Object.values(g.s.objects).filter((o) => o.def === 'shipyard-skulker' && o.token);
    expect(copies).toHaveLength(1);
    expect(copies[0].zone).toEqual({ z: 'bf', bf: 0 });
    expect(hasKeyword(g.s, copies[0].id, 'temporary')).toBe(true);
  });

  it("LeBlanc, Everywhere at Once: your Temporary effects at my battlefield don't trigger", () => {
    const g = tbl(9702);
    put(g, 'leblanc-everywhere-at-once', 0, bf(0));
    const t = put(g, 'sprite', 0, bf(0));
    const b = put(g, 'sprite', 0, base(0));
    control(g, 0, 0);
    nextTurn(g);
    expect(g.s.objects[t]).toBeDefined();
    expect(g.s.objects[b]).toBeUndefined();
  });

  it("LeBlanc, Fragmented: Deathknell: draw 1, or 2 in your Beginning Phase", () => {
    const g = tbl(9703);
    const l = put(g, 'leblanc-fragmented', 0, bf(0));
    control(g, 0, 0);
    const n = handSize(g);
    cast(g, 'soul-harvest', [`t:${l}`]);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Lillia, Bashful Bloom: [4], [E]: a ready Sprite, [1] less per friendly Temporary unit', () => {
    const g = tbl(9704, { legends: ['lillia-bashful-bloom'] });
    put(g, 'sprite', 0, base(0)); put(g, 'sprite', 0, base(0));
    const l = g.s.players[0].legend[0];
    reask(g); act(g, `act:${l}#0`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
    drive(g, ['loc:base']);
    expect(onBoard(g, 'sprite', 0)).toHaveLength(3);
  });

  it('Lillia, Fae Fawn: moving from a location leaves a Sprite there', () => {
    const g = tbl(9705);
    const u = put(g, 'lillia-fae-fawn', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(onBoard(g, 'sprite', 0).map((id) => g.s.objects[id].zone)).toEqual([{ z: 'base', p: 0 }]);
  });

  it('Lillia, Protector of Dreams: +1 per token unit played; your token units have Tank', () => {
    const g = tbl(9706);
    const l = put(g, 'lillia-protector-of-dreams', 0, base(0));
    cast(g, 'flurry-of-feathers', ['mode:1']);
    expect(mightOf(g.s, l)).toBe(8);
    expect(hasKeyword(g.s, onBoard(g, 'bird', 0)[0], 'tank')).toBe(true);
  });

  it("Lilting Lullaby: counter a spell; its controller can't play spells this turn", () => {
    const g = tbl(9707, { first: 1 });
    const u = put(g, 'shipyard-skulker', 1, base(1));
    const a = inHand(g, 'lilting-lullaby', 0);
    const ps = inHand(g, 'primal-strength', 1);
    const rp = inHand(g, 'rune-prison', 1);
    reask(g); act(g, `play:${ps}`); drive(g, [`t:${u}`, `play:${a}`]);
    expect(evs(g, 'counter')).toHaveLength(1);
    reask(g);
    expect(keys(g)).not.toContain(`play:${rp}`);
  });

  it('Lonely Poro: Deathknell: if I died alone, draw 1', () => {
    const g = tbl(9708);
    const l = put(g, 'lonely-poro', 0, bf(0));
    control(g, 0, 0);
    const n = handSize(g);
    cast(g, 'soul-harvest', [`t:${l}`]);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Lotus Trap: double all damage dealt to a unit this turn', () => {
    const g = tbl(9709);
    const u = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'lotus-trap', [`t:${u}`]);
    cast(g, 'clash-of-giants', [`t:${put(g, 'shipyard-skulker', 0, base(0))}`, `t:${u}`]);
    expect(dmg(g, u)).toBe(6);
  });

  it('Lunar Boon: discard 1, then draw 2', () => {
    const g = tbl(9710);
    const n = handSize(g);
    cast(g, 'lunar-boon');
    expect(handSize(g)).toBe(n + 1);
  });

  it("Maduli, the Gatekeeper: can't be readied; [P]: move me to an occupied enemy battlefield I outmight", () => {
    const g = tbl(9711);
    const m = put(g, 'maduli-the-gatekeeper', 0, base(0), { exhausted: true });
    cast(g, 'upstage-comedy', [`t:${m}`]);
    expect(g.s.objects[m].exhausted).toBe(true);
    foe(g, 'mystic-poro');
    reask(g); act(g, `act:${m}#1`); drive(g);
    expect(evs(g, 'move').some((x) => x.objs.includes(m) && x.to.z === 'bf')).toBe(true);
  });

  it('Master Yi, Tempered: Level 6: Deflect and Ganking', () => {
    const g = tbl(9712);
    const u = put(g, 'master-yi-tempered', 0, base(0));
    xp(g, 6);
    expect(hasKeyword(g.s, u, 'deflect') && hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it('Master Yi, Unstoppable: cheaper with Level; Level 16: not chosen by enemies', () => {
    const g = tbl(9713);
    xp(g, 11);
    const id = inHand(g, 'master-yi-unstoppable');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 6 } });
  });

  it('Master Yi, Wuju Master: Level 6: your units +1; Level 11: they enter ready', () => {
    const g = tbl(9714, { legends: ['master-yi-wuju-master'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    xp(g, 11);
    expect(mightOf(g.s, u)).toBe(4);
    cast(g, 'mountain-drake');
    expect(g.s.objects[onBoard(g, 'mountain-drake', 0)[0]].exhausted).toBe(false);
  });

  it('Mirror Image: a ready Reflection in your base becomes a copy of a unit, with Temporary', () => {
    const g = tbl(9715);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'mirror-image', [`t:${e}`]);
    const c = onBoard(g, 'mountain-drake', 0);
    expect(c).toHaveLength(1);
    expect(g.s.objects[c[0]]).toMatchObject({ token: true, exhausted: false });
    expect(mightOf(g.s, c[0])).toBe(10);
    expect(hasKeyword(g.s, c[0], 'temporary')).toBe(true);
  });
});
