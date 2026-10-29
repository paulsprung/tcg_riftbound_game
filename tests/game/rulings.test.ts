import { describe, expect, it } from 'vitest';
import { hasKeyword, isType, mightOf } from '../../src/game/rules/chars.ts';
import { addEffect, kill } from '../../src/game/rules/actions.ts';
import { createObject, moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { cast, drive, moveTo, nextTurn, onBoard } from './helpers/cards.ts';
import { attack, defsIn, dmg, equip, foe, tbl, type G } from './helpers/setCards.ts';
import { randomDeck } from './helpers/randomDeck.ts';
import { choose, createGame, hashState, replay, ENGINE_VERSION, type DeckList, type GameRecord } from '../../src/game/index.ts';
import { checkInvariants } from '../../src/game/state/invariants.ts';
import { mulberry32 } from '../../src/game/state/rng.ts';

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

/** Answers like drive() until `stop` holds (or nothing is pending): keys from `answers` first. */
function until(g: G, stop: (g: G) => boolean, answers: string[] = []) {
  const left = answers.slice();
  for (let i = 0; i < 200 && g.s.pending && !stop(g); i++) {
    const j = left.findIndex((k) => keys(g).includes(k));
    if (j >= 0) { act(g, left.splice(j, 1)[0]); continue; }
    const d = g.s.pending;
    if (d.kind === 'priority') act(g, 'pass');
    else if (d.kind === 'payment') act(g, keys(g).includes('pay:0') ? 'pay:0' : 'decline');
    else if (d.kind === 'may' || d.kind === 'applyReplacement') act(g, 'yes');
    else act(g, d.options.find((x) => !x.ui && x.key !== 'done')?.key ?? d.options.find((x) => !x.ui)!.key);
  }
}

describe('Rulings: provisional readings confirmed or corrected', () => {
  it('Elder Dragon: the play effect targets one enemy unit per location; one moved away is unaffected (Unleashed FAQ)', () => {
    const g = tbl(9920);
    runes(g, 0, [...ready('body', 6), ...ready('fury', 6)]);
    const a = put(g, 'mountain-drake', 1, base(1));
    const b = foe(g, 'mountain-drake');
    const id = inHand(g, 'elder-dragon');
    reask(g); act(g, `play:${id}`);
    until(g, (h) => h.s.pending?.kind === 'target');
    expect(g.s.pending?.kind).toBe('target');                         // chosen as it finalizes: targets
    until(g, (h) => h.s.pending?.kind === 'priority' && h.s.chain.some((i) => i.status === 'finalized'), [`t:${a}`, `t:${b}`]);
    expect(keys(g)).not.toContain(`t:${a}`);
    moveObject(g.s, b, { z: 'base', p: 1 });                         // as if moved in response (the same object)
    drive(g);
    expect(g.s.objects[a]).toBeUndefined();                          // 1 of your damage kills
    expect(g.s.objects[b]).toBeDefined();
    expect(dmg(g, b)).toBe(0);
  });

  it("Temporal Breach: a unit at a base other than its owner's stays banished (Vendetta FAQ)", () => {
    const g = tbl(9921);
    const u = createObject(g.s, { def: 'vanguard-sergeant', printing: null, owner: 1, controller: 0, zone: { z: 'base', p: 0 } }).id;
    cast(g, 'temporal-breach', [`t:${u}`]);
    expect(onBoard(g, 'vanguard-sergeant')).toHaveLength(0);
    expect(defsIn(g, 'banish', 1)).toContain('vanguard-sergeant');
  });

  it('Ahri, Confident: a passive of yours that newly gives -[M] to an enemy unit here counts (Radiance patch notes)', () => {
    const g = tbl(9922);
    const e = foe(g, 'shipyard-skulker');
    const ahri = put(g, 'ahri-confident', 0, base(0));
    const leona = put(g, 'leona-zealot', 0, base(0));
    const rp = inHand(g, 'rune-prison');
    moveTo(g, [ahri, leona], 1);                                     // Disarm: -1 [M] (an ability): Ahri +1
    until(g, (h) => h.s.pending?.kind === 'priority' && h.s.pending.player === 0 && keys(h).includes(`play:${rp}`) && h.s.chain.length === 0);
    const n = evs(g, 'mightChanged').filter((m) => m.obj === ahri).length;
    act(g, `play:${rp}`);                                            // stunned: Leona's -8 newly applies
    until(g, (h) => evs(h, 'stun').length > 0 && h.s.chain.length === 0, [`t:${e}`]);
    expect(evs(g, 'mightChanged').filter((m) => m.obj === ahri).length).toBe(n + 1);
  });

  it('Mordekaiser, Twice Slain: "you may": declining lets him die; accepting, his controller picks the unit to kill', () => {
    const g = tbl(9923);
    const m = put(g, 'mordekaiser-twice-slain', 0, bf(0)); control(g, 0, 0);
    const poro = put(g, 'mystic-poro', 0, base(0));
    const drake = put(g, 'mountain-drake', 0, base(0));
    cast(g, 'void-seeker', [`t:${m}`]);
    cast(g, 'void-seeker', [`t:${m}`, 'yes', `t:${drake}`]);
    expect(g.s.objects[m]).toBeDefined();
    expect(g.s.objects[drake]).toBeUndefined();                      // the one picked, not the weakest
    expect(g.s.objects[poro]).toBeDefined();
    const g2 = tbl(9924);
    const m2 = put(g2, 'mordekaiser-twice-slain', 0, bf(0)); control(g2, 0, 0);
    const p2 = put(g2, 'mystic-poro', 0, base(0));
    cast(g2, 'void-seeker', [`t:${m2}`]);
    const id = inHand(g2, 'void-seeker');
    reask(g2); act(g2, `play:${id}`);
    until(g2, (h) => h.s.pending?.kind === 'applyReplacement', [`t:${m2}`]);
    act(g2, 'no'); drive(g2);
    expect(g2.s.objects[m2]).toBeUndefined();
    expect(g2.s.objects[p2]).toBeDefined();
  });

  it('Altar of Blood: its controller may decline to pay', () => {
    const g = tbl(9925, { bfs: [undefined, 'altar-of-blood'] });
    foe(g, 'shipyard-skulker');
    const p = put(g, 'vanguard-sergeant', 0, base(0));
    setField(g.s, g.s.objects[p], 'damage', [{ amount: 2, by: null, sources: [], combat: false, group: 0 }]);
    moveTo(g, [p], 1);
    until(g, (h) => h.s.pending?.kind === 'applyReplacement' && h.s.pending.prompt.unit === p);
    expect(g.s.pending?.player).toBe(0);
    act(g, 'no'); drive(g);
    expect(g.s.objects[p]).toBeUndefined();
  });

  it('Diana, Scorn of the Moon: usable outside showdowns; its Energy waits for one (see unl-all)', () => {
    const g = tbl(9926, { legends: ['diana-scorn-of-the-moon'] });
    reask(g);
    expect(keys(g)).toContain(`act:${g.s.players[0].legend[0]}#0`);
  });

  it('Shard of Undoing: a death outside your Beginning Phase does not use up "the first time"', () => {
    const g = tbl(9927);
    put(g, 'shard-of-undoing', 0, base(0));
    const a = put(g, 'mystic-poro', 0, base(0));
    const b = put(g, 'mystic-poro', 0, base(0));
    const x = { present: false };
    setField(g.s, g.s.turn, 'phase', 'awaken');
    kill(g.s, x, [a], { rule: '429', inCombat: () => false });
    expect(g.s.chain).toHaveLength(0);
    setField(g.s, g.s.turn, 'phase', 'beginning');
    kill(g.s, x, [b], { rule: '429', inCombat: () => false });
    expect(g.s.chain.filter((i) => i.ability === 'shard-of-undoing#0')).toHaveLength(1);
  });

  it('Stargazer: a spell given [Flow] (Kennen) has [Flow] too: [2] less from the trash', () => {
    const g = tbl(9928);
    put(g, 'stargazer', 0, base(0));
    foe(g, 'mountain-drake');
    const t = createObject(g.s, { def: 'void-seeker', printing: null, owner: 0, zone: { z: 'trash', p: 0 } }).id;
    addEffect(g.s, { present: false }, [t], { s: 'flowGrant' }, { controller: 0, source: null, item: null, rule: '829' });
    reask(g); act(g, `play:${t}`);
    until(g, (h) => h.s.pending?.kind === 'payment');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
  });

  it('Threshold of the Gray: a start-of-combat effect, before the designations [466.2.b]', () => {
    const g = tbl(9929, { bfs: [undefined, 'threshold-of-the-gray'] });
    foe(g, 'mountain-drake');
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 1);
    drive(g, [], { max: 6 });
    const seq = g.events.map((e) => e.k);
    expect(seq.indexOf('chainPush')).toBeLessThan(seq.indexOf('designate'));
    expect(g.s.players.map((p) => p.pool.energy)).toEqual([1, 1]);
  });

  it('Not So Fast and Repulse: an enemy ability that chooses a friendly unit can be countered', () => {
    const g = tbl(9930, { first: 1 });
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const ice = put(g, 'heart-of-dark-ice', 1, base(1));
    const n = inHand(g, 'not-so-fast', 0);
    reask(g); act(g, `act:${ice}#0`);
    until(g, (h) => h.s.pending?.kind === 'priority' && h.s.pending.player === 0, [`t:${u}`]);
    const ab = g.s.chain.find((i) => i.kind === 'activated')!;
    expect(keys(g)).toContain(`play:${n}`);
    drive(g, [`play:${n}`, `t:item${ab.id}`]);
    expect(evs(g, 'counter')).toHaveLength(1);
    expect(mightOf(g.s, u)).toBe(3);
    const g2 = tbl(9931, { first: 1 });
    const u2 = put(g2, 'shipyard-skulker', 0, bf(0)); control(g2, 0, 0);
    const ice2 = put(g2, 'heart-of-dark-ice', 1, base(1));
    const r = inHand(g2, 'repulse', 0);
    reask(g2); act(g2, `act:${ice2}#0`);
    until(g2, (h) => h.s.pending?.kind === 'priority' && h.s.pending.player === 0, [`t:${u2}`]);
    const ab2 = g2.s.chain.find((i) => i.kind === 'activated')!;
    drive(g2, [`play:${r}`, `t:${u2}`, `t:item${ab2.id}`]);
    expect(evs(g2, 'counter')).toHaveLength(1);
    expect(mightOf(g2.s, u2)).toBe(3);
  });

  it('Titanic Shrine and Dockside Lock-Up: a trigger\'s cost ("exhaust me to", "kill this to") may be declined [405.2]', () => {
    const g = tbl(9932);
    put(g, 'titanic-shrine', 0, base(0));
    const n = g.s.players[0].hand.length;
    const id = inHand(g, 'mountain-drake');
    reask(g); act(g, `play:${id}`);
    until(g, (h) => h.s.pending?.kind === 'may');
    expect(g.s.pending?.prompt.t).toBe('payTriggerCost');
    act(g, 'no'); drive(g);
    expect(g.s.players[0].hand.length).toBe(n);
  });

  it('Scuttle Crab: the cards they hide later that turn are seen too', () => {
    const g = tbl(9933, { first: 1 });
    const c = put(g, 'scuttle-crab', 0, bf(0)); control(g, 0, 0);
    control(g, 1, 1); put(g, 'mystic-poro', 1, bf(1));
    cast(g, 'void-seeker', [`t:${c}`], 1);                           // P1 kills it on their turn: Deathknell
    const card = inHand(g, 'bone-skewer', 1);
    reask(g); act(g, `hide:${card}`);
    if (keys(g).includes('loc:bf1')) act(g, 'loc:bf1');
    drive(g);
    const fd = g.s.bfs[1].facedown.at(-1)!;
    expect(fd).toBeDefined();
    expect(g.s.objects[fd].knownBy & 1).toBe(1);
  });

  it('Chronobreak: a banished token ceases to exist and is not played back (Radiance patch notes / riftboundfaq)', () => {
    const g = tbl(9934);
    createObject(g.s, { def: 'recruit', printing: null, owner: 0, zone: { z: 'base', p: 0 }, token: true });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const id = inHand(g, 'chronobreak');
    reask(g); act(g, `play:${id}`); drive(g, ['n:2']);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(0);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
    void u;
  });
});

const NEW = ['akali-brash', 'runeblade-anvil', 'neeko-blending-in', 'orianna-lady-of-clockwork', 'the-ball', 'shady-spectacles'];

/** A random RAD/VEN deck that has some of the cards defined in the rulings pass, the new ones put in where they fit. */
function deckWithNew(seed: number): DeckList {
  for (let k = 0; k < 200; k++) {
    const set = (seed + k) % 2 === 0 ? 'rad' : 'ven';
    const d = randomDeck(set, seed * 31 + k);
    if (!d) continue;
    const has = [d.legend, ...d.main.map((e) => e.def)].some((def) => NEW.includes(def));
    if (has) return d;
  }
  throw new Error('no deck');
}

describe('Rulings: random games with the new cards', () => {
  it('random bots: games end, keep the invariants and replay', async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((res) => setTimeout(res, 0));
      const seed = 13000 + i;
      const decks: [DeckList, DeckList] = [deckWithNew(seed), deckWithNew(seed + 500)];
      const setup = { seed, decks };
      let st = createGame(setup, { check: true }).state;
      let r = (seed * 2654435761) >>> 0;
      const answers: GameRecord['answers'] = [];
      while (st.pending && answers.length < 6000) {
        const d = st.pending;
        const real = d.options.filter((o) => !o.ui).map((o) => o.key);
        const step = mulberry32(r); r = step.next;
        const key = real[Math.floor(step.value * real.length)];
        answers.push({ d: d.id, k: key, by: d.player });
        st = choose(st, { decision: d.id, key }, { inPlace: true }).state;
        if (answers.length % 50 === 0) expect(checkInvariants(st), `seed ${seed}`).toEqual([]);
      }
      expect(st.result, `seed ${seed}`).not.toBeNull();
      const record: GameRecord = { engine: ENGINE_VERSION, defsHash: st.defsHash, setup, answers,
        meta: { started: '', difficulty: 'random', humanSeat: 0, aiKnowsList: false } };
      expect(hashState(replay(record).state)).toBe(hashState(st));
    }
  }, 600_000);
});
