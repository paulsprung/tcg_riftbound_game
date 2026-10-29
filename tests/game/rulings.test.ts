import { describe, expect, it } from 'vitest';
import { hasKeyword, isType, mightOf } from '../../src/game/rules/chars.ts';
import { createObject, moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, keys, put, reask } from './helpers/scenario.ts';
import { cast, drive, moveTo, nextTurn, onBoard } from './helpers/cards.ts';
import { attack, defsIn, dmg, equip, foe, tbl, type G } from './helpers/setCards.ts';

/*
 * The cards of docs/CARD-RULINGS.md: one test (at least) per ruling, pinning
 * the behaviour the ruling settles.
 */

/** Puts a card on top of p's Main Deck. */
const onTop = (g: G, def: string, p: 0 | 1 = 0) =>
  createObject(g.s, { def, printing: null, owner: p, zone: { z: 'deck', p }, pos: 'top' }).id;
const offered = (g: G, key: string) => { reask(g); return keys(g).includes(key); };
const banished = (g: G, def: string, p: 0 | 1 = 0) => g.s.players[p].banish.find((id) => g.s.objects[id].def === def);
/** Ends P0's turn and the opponent's; P0's next turn begins, answering with `answers` first. */
function toMyTurn(g: G, answers: string[] = []) {
  reask(g); act(g, 'end'); drive(g);
  if (g.s.pending?.kind === 'priority' && g.s.pending.player === 1) act(g, 'end');
  drive(g, answers);
}

describe('Rulings: the cards that were left undefined', () => {
  it('Akali, Brash: the first move adds [1][A]; the second banishes the top card, playable until this turn\'s Ending Phase', () => {
    const g = tbl(9901);
    const a = put(g, 'akali-brash', 0, base(0));
    onTop(g, 'shipyard-skulker');
    moveTo(g, [a], 0); drive(g);
    expect(g.s.players[0].pool.energy).toBeGreaterThanOrEqual(1);
    expect(banished(g, 'shipyard-skulker')).toBeUndefined();
    setField(g.s, g.s.objects[a], 'exhausted', false);
    moveTo(g, [a], 'base'); drive(g);
    const c = banished(g, 'shipyard-skulker')!;
    expect(c).toBeDefined();
    expect(offered(g, `play:${c}`)).toBe(true);
    nextTurn(g);                                                     // banished during my turn: this Ending Phase ends it
    const c2 = banished(g, 'shipyard-skulker')!;
    expect(c2).toBeDefined();
    expect(offered(g, `play:${c2}`)).toBe(false);
  });

  it('Akali, Brash: the banished card is played paying its cost', () => {
    const g = tbl(9902);
    const a = put(g, 'akali-brash', 0, base(0));
    onTop(g, 'shipyard-skulker');
    moveTo(g, [a], 0); drive(g);
    setField(g.s, g.s.objects[a], 'exhausted', false);
    moveTo(g, [a], 'base'); drive(g);
    const c = banished(g, 'shipyard-skulker')!;
    reask(g); act(g, `play:${c}`); drive(g);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
    expect(evs(g, 'payment').length).toBeGreaterThan(0);
  });

  it('Runeblade Anvil: leaving the board on an opponent\'s turn: playable until my next turn\'s Ending Phase (Radiance FAQ)', () => {
    const g = tbl(9903);
    onTop(g, 'shipyard-skulker');
    cast(g, 'runeblade-anvil');
    const first = banished(g, 'shipyard-skulker')!;                // "When you play this": the first banish
    expect(first).toBeDefined();
    onTop(g, 'mountain-drake');
    reask(g); act(g, 'end'); drive(g);                               // P1's turn now
    const anvil = onBoard(g, 'runeblade-anvil', 0)[0];
    cast(g, 'an-offer-you-cant-refuse', [`t:${anvil}`], 1);          // P1 kills it: "when this leaves the board"
    const second = banished(g, 'mountain-drake')!;
    expect(second).toBeDefined();
    expect(offered(g, `play:${first}`)).toBe(false);                 // the first window ended as my Ending Phase began
    reask(g); act(g, 'end'); drive(g);                               // my turn again
    expect(offered(g, `play:${second}`)).toBe(true);
    nextTurn(g);
    expect(offered(g, `play:${banished(g, 'mountain-drake')!}`)).toBe(false);
  });

  it('Shady Spectacles: the equipped unit becomes a copy of another friendly unit, keeps its damage and buff, and stops when detached', () => {
    const g = tbl(9904);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const model = put(g, 'mountain-drake', 0, base(0));
    setField(g.s, g.s.objects[u], 'buffs', 1);
    setField(g.s, g.s.objects[u], 'damage', [{ amount: 1, by: null, sources: [], combat: false, group: 0 }]);
    const sp = put(g, 'shady-spectacles', 0, base(0));
    reask(g); act(g, `act:${sp}#kwequip`); drive(g, [`t:${u}`, `pick:${model}`]);
    const o = g.s.objects[u];
    expect(o.def).toBe('mountain-drake');
    expect(o.buffs).toBe(1);
    expect(dmg(g, u)).toBe(1);
    expect(mightOf(g.s, u)).toBe(mightOf(g.s, model) + 1);
    cast(g, 'an-offer-you-cant-refuse', [`t:${sp}`]);                // Spectacles leaves: the copy ends
    expect(g.s.objects[u].def).toBe('shipyard-skulker');
    expect(g.s.objects[u].copyFx).toBeUndefined();
  });

  it('Shady Spectacles: the copy is chosen again on each attach; Empowered is a status and is not copied (Vendetta FAQ)', () => {
    const g = tbl(9905);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const v = put(g, 'mountain-drake', 0, base(0));
    const w = put(g, 'ahri-confident', 0, base(0));
    setField(g.s, g.s.objects[w], 'empowered', 1);
    const sp = put(g, 'shady-spectacles', 0, base(0));
    reask(g); act(g, `act:${sp}#kwequip`); drive(g, [`t:${u}`, `pick:${w}`]);
    expect(g.s.objects[u].def).toBe('ahri-confident');
    expect(g.s.objects[u].empowered).toBe(0);                        // a status: not copied
    expect(hasKeyword(g.s, u, 'disarm')).toBe(true);
    expect(g.s.objects[v].def).toBe('mountain-drake');
  });

  it('Orianna, Lady of Clockwork: pay [1]: a gear becomes a unit with Might equal to its Energy cost; it moves and fights', () => {
    const g = tbl(9906, { legends: ['orianna-lady-of-clockwork'] });
    const gear = put(g, 'arena-bar', 0, base(0));
    const cost = 3;
    expect(isType(g.s.objects[gear], 'unit')).toBe(false);
    toMyTurn(g, [`t:${gear}`]);                                      // at the start of my Main Phase: pay [1], choose it
    expect(isType(g.s.objects[gear], 'unit')).toBe(true);
    expect(mightOf(g.s, gear)).toBe(cost);
    const e = foe(g, 'shipyard-skulker');
    setField(g.s, g.s.objects[gear], 'exhausted', false);
    attack(g, gear);
    expect(evs(g, 'designate').some((d) => d.objs.includes(gear) && d.d === 'attacker')).toBe(true);
    expect(dmg(g, e) > 0 || !g.s.objects[e]).toBe(true);
  });

  it('Orianna, Lady of Clockwork: an attached Equipment detaches as it becomes a unit, and the previous unit gear stops at the next choice', () => {
    const g = tbl(9907, { legends: ['orianna-lady-of-clockwork'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const eq = equip(g, 'shady-spectacles', u);
    const map = put(g, 'arena-bar', 0, base(0));
    toMyTurn(g, [`t:${eq}`]);
    expect(g.s.objects[eq].attachedTo).toBeNull();
    expect(isType(g.s.objects[eq], 'unit')).toBe(true);
    expect(mightOf(g.s, eq)).toBe(4);
    toMyTurn(g, [`t:${map}`]);
    expect(isType(g.s.objects[eq], 'unit')).toBe(false);
    expect(isType(g.s.objects[map], 'unit')).toBe(true);
  });

  it('The Ball: a unit gear with [Ganking] moves from battlefield to battlefield; playing or moving it: choose one', () => {
    const g = tbl(9908, { legends: ['orianna-lady-of-clockwork'] });
    const e = foe(g, 'mountain-drake');
    void e;
    cast(g, 'the-ball', ['loc:bf0', 'mode:0']);
    const ball = onBoard(g, 'the-ball', 0)[0];
    expect(g.s.objects[ball].zone).toEqual({ z: 'bf', bf: 0 });
    toMyTurn(g, [`t:${ball}`]);
    expect(isType(g.s.objects[ball], 'unit')).toBe(true);
    expect(hasKeyword(g.s, ball, 'ganking')).toBe(true);
    setField(g.s, g.s.objects[ball], 'exhausted', false);
    const before = mightOf(g.s, e) > 0 ? dmg(g, e) : 0;
    moveTo(g, [ball], 1);
    drive(g, ['mode:1']);
    expect(evs(g, 'move').some((m) => m.objs.includes(ball) && m.to.z === 'bf')).toBe(true);
    expect(evs(g, 'deal').some((d) => d.to === e && d.n === 2 && !d.combat && d.sources.includes(ball))).toBe(true);
    expect(evs(g, 'designate').some((d) => d.objs.includes(ball) && d.d === 'attacker')).toBe(true);
    void before;
  });

  it('The Ball: while it is not a unit it has no Standard Move', () => {
    const g = tbl(9909);
    cast(g, 'the-ball', ['loc:bf0', 'mode:0']);
    const ball = onBoard(g, 'the-ball', 0)[0];
    setField(g.s, g.s.objects[ball], 'exhausted', false);
    reask(g);
    if (keys(g).includes('move')) { act(g, 'move'); expect(keys(g)).not.toContain(`u:${ball}`); }
  });

  it('Neeko, Blending In: adds one of the deck\'s chosen legends, ready, while she is on the board (Radiance patch notes)', () => {
    const g = tbl(9910);
    setField(g.s, g.s.players[0], 'extra', { 'neeko-blending-in': ['ziggs-hexplosives-expert', 'ornn-fire-below-the-mountain'] });
    cast(g, 'neeko-blending-in', ['mode:0']);
    const added = g.s.players[0].legend.slice(1);
    expect(added).toHaveLength(1);
    expect(g.s.objects[added[0]].def).toBe('ziggs-hexplosives-expert');
    expect(g.s.objects[added[0]].exhausted).toBe(false);
    expect(offered(g, `act:${added[0]}#0`)).toBe(true);              // its abilities work
    cast(g, 'neeko-blending-in', []);                                // a second Neeko: only the other one is left
    expect(g.s.players[0].legend.slice(1).map((id) => g.s.objects[id].def)).toEqual(['ziggs-hexplosives-expert', 'ornn-fire-below-the-mountain']);
    const neeko = onBoard(g, 'neeko-blending-in', 0)[0];
    moveObject(g.s, neeko, { z: 'trash', p: 0 });                    // she leaves: her legend ceases to exist
    expect(g.s.players[0].legend).toHaveLength(2);
    expect(g.s.objects[added[0]]).toBeUndefined();
  });

  it('Neeko, Blending In: without chosen legends nothing is added', () => {
    const g = tbl(9911);
    cast(g, 'neeko-blending-in');
    expect(g.s.players[0].legend).toHaveLength(1);
    void control; void bf; void defsIn; void inHand;
  });
});
