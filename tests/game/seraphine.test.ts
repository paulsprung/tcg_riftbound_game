import { describe, expect, it } from 'vitest';
import { viewFor } from '../../src/game/index.ts';
import { hasKeyword, keywordOf, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { Z } from '../../src/game/state/zones.ts';
import {
  act, base, bf, control, endTurn, evs, inHand, keys, put, ready, reask, runes, settle, start, type Game,
} from './helpers/scenario.ts';

/*
 * The rest of the Seraphine deck (M1.3, §13.2): layers (statics, base
 * Might, keyword grants), the replacement of a token play, the cost
 * pipeline (granted and optional additional costs, discounts, Deflect),
 * Show Off, delayed abilities, Deathknell with last-known information,
 * Shield, phase triggers, `if` / "if you do" and linked instructions.
 * Every card of the deck that M1.2 left vanilla or unplayable is here.
 */

/** The battlefields as cards without abilities, so their triggers stay out of the way. */
function quiet(g: Game) {
  setField(g.s, g.s.objects[g.s.bfs[0].obj], 'def', 'placeholder');
  setField(g.s, g.s.objects[g.s.bfs[1].obj], 'def', 'placeholder');
}

const begin = (seed: number) => {
  const g = start(seed);
  quiet(g);
  return g;
};
const passBoth = (g: Game) => { act(g, 'pass'); act(g, 'pass'); };
/** Answers with a key if the decision is asked: a single public option is applied by the engine itself. */
const opt = (g: Game, key: string) => { if (keys(g).includes(key)) act(g, key); };
const at = (g: Game, def: string, p: 0 | 1) => Object.values(g.s.objects)
  .filter((o) => o.def === def && o.controller === p && (o.zone.z === 'base' || o.zone.z === 'bf')).map((o) => o.id);
const legendOf = (g: Game, p: 0 | 1) => g.s.players[p].legend[0];

describe('layers [475–482]', () => {
  it('[479.4] Seraphine, Not Alone: +1 [M] for each OTHER exhausted unit you control', () => {
    const g = begin(201);
    const sera = put(g, 'seraphine-not-alone', 0, base(0));
    expect(mightOf(g.s, sera)).toBe(1);
    put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    put(g, 'strigian-oracle', 0, bf(0), { exhausted: true });
    put(g, 'shipyard-skulker', 1, base(1), { exhausted: true });   // an enemy: not "you control"
    put(g, 'shipyard-skulker', 0, base(0));                          // ready: not counted
    expect(mightOf(g.s, sera)).toBe(3);
    setField(g.s, g.s.objects[sera], 'exhausted', true);             // "other": itself never counts
    expect(mightOf(g.s, sera)).toBe(3);
  });

  it('[478] Steadfast Outrider: +2 while 2+ other friendly units and/or gear are at its battlefield; Tank', () => {
    const g = begin(202);
    control(g, 0, 0);
    const out = put(g, 'steadfast-outrider', 0, bf(0));
    put(g, 'shipyard-skulker', 0, bf(0));
    put(g, 'shipyard-skulker', 1, bf(0));                            // an enemy unit there: not friendly
    expect(mightOf(g.s, out)).toBe(3);
    put(g, 'concert-poster', 0, bf(0));                              // gear counts
    expect(mightOf(g.s, out)).toBe(5);
    expect(hasKeyword(g.s, out, 'tank')).toBe(true);
    moveObject(g.s, out, Z.base(0));                                 // "my battlefield": not a base
    put(g, 'shipyard-skulker', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    expect(mightOf(g.s, out)).toBe(3);
  });

  it('[479.2] Herald of the Emperor: the chosen unit\'s base Might becomes 5 this turn; buffs and +N apply on top', () => {
    const g = begin(203);
    runes(g, 0, ready('order', 5));
    const skulker = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[skulker], 'buffs', 1);
    const herald = inHand(g, 'herald-of-the-emperor');
    reask(g);
    act(g, `play:${herald}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    expect(g.s.pending).toMatchObject({ kind: 'target' });           // its play effect's target [403.2]
    opt(g, `t:${skulker}`);
    passBoth(g);
    expect(mightOf(g.s, skulker)).toBe(6);                          // base 5, +1 buff [479.2], [479.4]
    expect(g.s.effects).toMatchObject([{ layer: 2, spec: { s: 'baseMight', n: 5 }, until: 'thisTurn' }]);
    endTurn(g);
    expect(mightOf(g.s, skulker)).toBe(4);                          // "this turn" is over [317.2.c]
  });

  it('[420.4.a] [482] Piltovan Guidebot: when you play a card, may have its base Might become that card\'s Energy cost', () => {
    const g = begin(204);
    runes(g, 0, ready('order', 12));
    const bot = put(g, 'piltovan-guidebot', 0, base(0));
    const oracle = inHand(g, 'strigian-oracle');                     // Energy 2
    const maker = inHand(g, 'faithful-manufactor');                  // Energy 3; its Recruit is a token, not a card
    reask(g);
    act(g, `play:${oracle}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    expect(g.s.pending).toMatchObject({ kind: 'may', prompt: { ability: 'piltovan-guidebot#0' } });
    act(g, 'yes');
    passBoth(g);
    expect(mightOf(g.s, bot)).toBe(2);
    act(g, `play:${maker}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    settle(g, { may: 'yes' });                                       // Manufactor's Recruit; the bot takes 3
    expect(mightOf(g.s, bot)).toBe(3);                               // the latest timestamp wins [482]
    expect(evs(g, 'chainPush').filter((e) => e.kind === 'triggered').length).toBe(3);   // not for the token
  });

  it('[479.2] [479.4] a base-Might change keeps "+N this turn" on top (layer 2 before layer 4)', () => {
    const g = begin(205);
    runes(g, 0, ready('order', 12));
    const bot = put(g, 'piltovan-guidebot', 0, base(0));
    const anthem = inHand(g, 'raucous-anthem');
    reask(g);
    act(g, `play:${anthem}`);
    act(g, 'pay:0');
    settle(g, { may: 'no' });                                        // resolves; Guidebot's trigger declined
    expect(mightOf(g.s, bot)).toBe(6);                               // 3 + 3
    const oracle = inHand(g, 'strigian-oracle');
    reask(g);
    act(g, `play:${oracle}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    act(g, 'yes');
    passBoth(g);
    expect(mightOf(g.s, bot)).toBe(5);                               // base 2, then +3
  });

  it('[807.1.c] [814.1] Assault counts only while attacking, Shield only while defending; values sum [807.2]', () => {
    const g = begin(207);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const eff = (kw: string, value: number) => ({ id: 900 + value, ts: 900 + value, controller: 0 as const, source: null,
      item: null, layer: 3 as const, affects: { objs: [u] }, spec: { s: 'keyword', kw, value }, until: 'thisTurn' as const });
    setField(g.s, g.s, 'effects', [eff('assault', 2), eff('assault', 1), eff('shield', 3)]);
    expect([keywordOf(g.s, u, 'assault'), keywordOf(g.s, u, 'shield'), mightOf(g.s, u)]).toEqual([3, 3, 3]);
    setField(g.s, g.s.objects[u], 'designation', 'attacker');
    expect(mightOf(g.s, u)).toBe(6);
    setField(g.s, g.s.objects[u], 'designation', 'defender');
    expect(mightOf(g.s, u)).toBe(6 - 3 + 3);
  });

  it('[814] For Demacia!: friendly units at the chosen battlefield get Shield 2 this turn: +2 while defending', () => {
    const g = begin(206);
    control(g, 0, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(0));
    const home = put(g, 'shipyard-skulker', 1, base(1));
    const attacker = put(g, 'heimerdinger-academy-instructor', 0, base(0));
    runes(g, 1, ready('order', 3));
    const demacia = inHand(g, 'for-demacia', 1);
    reask(g);
    act(g, 'move');
    if (keys(g).includes(`u:${attacker}`)) { act(g, `u:${attacker}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    expect(g.s.combat).toMatchObject({ attacker: 0, defender: 1 });
    act(g, 'pass');                                                  // Focus to the Defender [347.2]
    expect(g.s.pending).toMatchObject({ player: 1, kind: 'priority' });
    act(g, `play:${demacia}`);
    act(g, `t:${g.s.bfs[0].obj}`);                                   // choose a battlefield
    act(g, 'pay:0');
    passBoth(g);
    expect(keywordOf(g.s, foe, 'shield')).toBe(2);
    expect(mightOf(g.s, foe)).toBe(5);                               // a defender: 3 + 2 [814.1]
    expect(hasKeyword(g.s, home, 'shield')).toBe(false);             // not there
    expect(mightOf(g.s, attacker)).toBe(5);                          // the opponent's units: not friendly
    act(g, 'pass');
    act(g, 'pass');                                                  // Focus passes round: damage
    settle(g);
    expect(evs(g, 'deal').filter((e) => e.combat).map((e) => [e.to, e.n]))
      .toEqual([[foe, 5], [attacker, 5]]);                           // the shielded defender dealt 5
  });
});

describe('replacements [367–375]: Heimerdinger, Academy Instructor', () => {
  it('[370.1.c] [371.2] while he is at a battlefield, a unit token you play may become a Mech at the same location', () => {
    const g = begin(211);
    control(g, 0, 0);
    const heimer = put(g, 'heimerdinger-academy-instructor', 0, bf(0));
    runes(g, 0, ready('order', 6));
    const a = inHand(g, 'faithful-manufactor');
    const b = inHand(g, 'faithful-manufactor');
    reask(g);
    act(g, `play:${a}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    passBoth(g);                                                     // the play effect resolves: a Recruit "here"
    expect(g.s.pending).toMatchObject({ kind: 'applyReplacement', player: 0, ctx: { source: heimer } });
    act(g, 'yes');
    expect(evs(g, 'replaced')).toMatchObject([{ source: heimer, event: 'playToken:recruit' }]);
    expect(at(g, 'mech', 0).map((id) => g.s.objects[id].zone)).toEqual([{ z: 'base', p: 0 }]);   // the same location
    expect(at(g, 'recruit', 0)).toEqual([]);
    expect(g.s.log.played.map((r) => r.def)).toEqual(['faithful-manufactor', 'mech']);
    act(g, `play:${b}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    passBoth(g);
    act(g, 'no');                                                    // declined: the Recruit is played [371.2.b]
    expect(at(g, 'recruit', 0)).toHaveLength(1);
  });

  it('[370.2] not while he is in base, not for a Mech already, not for the opponent\'s tokens', () => {
    const g = begin(212);
    put(g, 'heimerdinger-academy-instructor', 0, base(0));
    control(g, 1, 1);
    put(g, 'heimerdinger-academy-instructor', 1, bf(1));            // the opponent's: "you" is P1
    runes(g, 0, ready('mind', 8));
    const maker = inHand(g, 'faithful-manufactor');
    const smith = inHand(g, 'industrious-mechsmith');
    reask(g);
    act(g, `play:${maker}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    passBoth(g);
    expect(at(g, 'recruit', 0)).toHaveLength(1);                     // no question asked
    control(g, 0, 0);
    const heimer = at(g, 'heimerdinger-academy-instructor', 0)[0];
    moveObject(g.s, heimer, Z.bf(0));
    reask(g);
    act(g, `play:${smith}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    passBoth(g);
    expect(at(g, 'mech', 0)).toHaveLength(1);                        // a Mech for a Mech: nothing to replace
    expect(evs(g, 'replaced')).toEqual([]);
  });

  it('[373] each token of "play two Recruits" is its own event, decided on its own', () => {
    const g = begin(213);
    control(g, 0, 0);
    put(g, 'heimerdinger-academy-instructor', 0, bf(0));
    runes(g, 0, ready('order', 5));
    const display = inHand(g, 'rousing-display');
    reask(g);
    act(g, `play:${display}`);
    act(g, 'no');                                                    // no Show Off
    act(g, 'pay:0');
    passBoth(g);
    act(g, 'yes');
    act(g, 'no');
    expect(at(g, 'mech', 0)).toHaveLength(1);
    expect(at(g, 'recruit', 0)).toHaveLength(1);
  });
});

describe('the cost pipeline [356–357]', () => {
  it('[356.2.b] [356.4.d] [415.4] Seraphine\'s legend: exhaust it and three units as ONE action, the spell costs [2] less', () => {
    const g = begin(221);
    runes(g, 0, ready('mind', 3));
    const units = [put(g, 'seraphine-inspiring', 0, base(0)), put(g, 'shipyard-skulker', 0, base(0)),
      put(g, 'shipyard-skulker', 0, base(0))];
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const note = inHand(g, 'high-note');
    reask(g);
    const hand = g.s.players[0].hand.length;
    act(g, `play:${note}`);
    expect(g.s.pending).toMatchObject({ kind: 'optionalCost', prompt: { ability: 'seraphine-starry-eyed-songstress#0' } });
    act(g, 'yes');
    opt(g, `t:${foe}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });   // 3 − 2
    act(g, 'pay:0');
    const ex = evs(g, 'exhaust').filter((e) => e.rule === '357.2');
    expect(ex).toHaveLength(1);
    expect(ex[0].objs.slice().sort()).toEqual([legendOf(g, 0), ...units].sort());
    expect(g.s.chain.find((i) => i.ability === 'seraphine-inspiring#0')).toBeDefined();   // "three at the same time"
    settle(g, { may: 'yes' });
    expect(g.s.chain).toEqual([]);
    expect(g.s.players[0].hand.length).toBe(hand - 1 + 1);           // High Note left, Inspiring drew 1
    expect(mightOf(g.s, foe)).toBe(0);                               // −3: three exhausted units
  });

  it('[356.2.b.1] not offered without three ready friendly units; taken at once when only it makes the spell payable', () => {
    const g = begin(222);
    runes(g, 0, ready('mind', 3));
    put(g, 'shipyard-skulker', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const note = inHand(g, 'high-note');
    reask(g);
    act(g, `play:${note}`);
    opt(g, `t:${foe}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
    act(g, 'back');
    put(g, 'shipyard-skulker', 0, base(0));
    runes(g, 0, ready('mind', 1));
    reask(g);
    expect(keys(g)).toContain(`play:${note}`);                       // payable only with the legend's discount
    act(g, `play:${note}`);
    opt(g, `t:${foe}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
    expect(g.s.chain[0].play.choices.optionalCosts).toEqual({ [`seraphine-starry-eyed-songstress#0@${legendOf(g, 0)}`]: true });
  });

  it('[356.2.b] [357.2] Dune Devourer: kill a friendly unit as a cost for [2] less; the dog\'s Deathknell; Deflect', () => {
    const g = begin(223);
    runes(g, 0, ready('order', 6));
    const dog = put(g, 'hunting-dog', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    const dune = inHand(g, 'dune-devourer');
    reask(g);
    expect(keys(g)).toContain(`play:${dune}`);                       // 7 + [Y] is too much; 5 + [Y] is not
    act(g, `play:${dune}`);
    opt(g, 'loc:base');                                              // the cost was taken at once: only it is payable
    expect(g.s.pending).toMatchObject({ kind: 'costObject', prompt: { what: 'kill' } });
    act(g, `pick:${dog}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 5 } });
    act(g, 'pay:0');
    const unit = at(g, 'dune-devourer', 0)[0];
    expect(g.s.objects[unit].played).toMatchObject({ paidOptional: ['dune-devourer#0'],
      costObjects: { 'dune-devourer#0': [{ def: 'hunting-dog' }] } });
    expect(g.s.objects[dog]).toBeUndefined();
    settle(g);
    const bird = at(g, 'bird', 0)[0];
    expect(hasKeyword(g.s, bird, 'deflect')).toBe(true);
    expect(hasKeyword(g.s, unit, 'deflect')).toBe(true);
  });

  it('[356.4.g] Party Crasher costs [1] less for each exhausted unit you control, read as the cost is determined', () => {
    const g = begin(224);
    runes(g, 0, ready('order', 4));
    const crasher = inHand(g, 'party-crasher');
    reask(g);
    expect(keys(g)).not.toContain(`play:${crasher}`);
    for (let i = 0; i < 5; i++) put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    reask(g);
    act(g, `play:${crasher}`);
    opt(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4, power: ['order'] } });
    act(g, 'pay:0');
    expect(hasKeyword(g.s, at(g, 'party-crasher', 0)[0], 'tank')).toBe(true);
  });

  it('[809] Deflect: an opponent choosing it pays [A] more; its controller doesn\'t; a target nobody could pay for is not offered', () => {
    const g = begin(225);
    runes(g, 0, ready('mind', 4));
    const theirs = put(g, 'dune-devourer', 1, base(1));
    const mine = put(g, 'dune-devourer', 0, base(0));
    const note = inHand(g, 'high-note');
    reask(g);
    act(g, `play:${note}`);
    expect(g.s.pending?.options.find((o) => o.key === `t:${theirs}`)?.meta).toEqual({ deflect: 1 });
    opt(g, `t:${theirs}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3, power: ['any'] } });
    act(g, 'back');
    act(g, `play:${note}`);
    opt(g, `t:${mine}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3, power: [] } });
    act(g, 'back');
    runes(g, 0, []);
    setField(g.s, g.s.players[0].pool, 'energy', 3);                 // Energy only: no [A] to pay with
    reask(g);
    act(g, `play:${note}`);                                          // only one target left: chosen at once
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3, power: [] } });
    expect(g.s.chain[0].play.choices.executions[0].targets.a).toMatchObject([{ id: mine }]);
  });

  it('[405.2] [809] a trigger choosing a Deflect unit costs [A]; declining removes it', () => {
    const g = begin(226);
    control(g, 0, 1);
    const dune = put(g, 'dune-devourer', 1, bf(0));
    const sera = put(g, 'seraphine-inspiring', 0, base(0));
    reask(g);
    act(g, 'move');
    if (keys(g).includes(`u:${sera}`)) { act(g, `u:${sera}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { card: 'seraphine-inspiring#kw:disarm', power: ['any'] } });
    act(g, 'decline');
    expect(evs(g, 'playFailed').at(-1)).toMatchObject({ reason: 'unpaid' });
    expect(mightOf(g.s, dune)).toBe(7);
  });
});

describe('Show Off [832]', () => {
  it('[832.1.c] Rousing Display: revealing a card with Energy [7]+ from hand makes four Recruits; the reveal ends "back"', () => {
    const g = begin(231);
    runes(g, 0, ready('order', 5));
    const crasher = inHand(g, 'party-crasher');
    const small = inHand(g, 'shipyard-skulker');
    const display = inHand(g, 'rousing-display');
    reask(g);
    act(g, `play:${display}`);
    expect(g.s.pending).toMatchObject({ kind: 'showOff', back: true });
    expect(keys(g)).toContain(`pick:${crasher}`);
    expect(keys(g)).not.toContain(`pick:${small}`);
    expect(keys(g)).toContain('no');
    act(g, `pick:${crasher}`);
    expect(g.s.objects[crasher].knownBy).toBe(3);                    // the opponent saw it [832.1.c]
    expect(evs(g, 'reveal')).toMatchObject([{ objs: [crasher] }]);
    expect(g.s.pending).toMatchObject({ kind: 'payment' });
    expect(g.s.pending?.back).toBeUndefined();
    act(g, 'pay:0');
    passBoth(g);
    settle(g);
    expect(at(g, 'recruit', 0)).toHaveLength(4);
  });

  it('[832.1.c] a friendly card on the board may be picked instead, unrevealed; not showing off makes two', () => {
    const g = begin(232);
    runes(g, 0, ready('order', 10));
    const emp = put(g, 'the-empyrean', 0, base(0));
    const a = inHand(g, 'rousing-display');
    const b = inHand(g, 'rousing-display');
    reask(g);
    act(g, `play:${a}`);
    act(g, `pick:${emp}`);
    act(g, 'pay:0');
    passBoth(g);
    settle(g);
    expect(evs(g, 'reveal')).toEqual([]);
    expect(at(g, 'recruit', 0)).toHaveLength(4);
    act(g, `play:${b}`);
    act(g, 'no');
    act(g, 'pay:0');
    passBoth(g);
    settle(g);
    expect(at(g, 'recruit', 0)).toHaveLength(6);
  });

  it('[383.2.a.1] [437] The Empyrean: if it showed off a card, Predict its Power cost, then draw 2; otherwise nothing', () => {
    const g = begin(233);
    runes(g, 0, ready('mind', 16));
    const shown = inHand(g, 'seraphine-inspiring');                  // [4] + one Mind Power
    const a = inHand(g, 'the-empyrean');
    const b = inHand(g, 'the-empyrean');
    reask(g);
    const hand = g.s.players[0].hand.length;
    act(g, `play:${a}`);
    act(g, `pick:${shown}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', ability: 'the-empyrean#0', trigger: { shownPower: 1 } }]);
    passBoth(g);
    expect(g.s.pending).toMatchObject({ kind: 'predict', prompt: { n: 1 } });
    act(g, g.s.pending!.options.find((o) => o.key.startsWith('keep:'))!.key);
    expect(g.s.players[0].hand.length).toBe(hand - 1 + 2);
    act(g, `play:${b}`);
    act(g, 'no');
    opt(g, 'loc:base');
    act(g, 'pay:0');
    expect(g.s.chain).toEqual([]);                                   // the intervening "if" was false: no trigger
  });
});

describe('delayed abilities [390–393]: Fanfare', () => {
  it('[391.4] the next three times you play a unit this turn, draw 1; tokens are units; then it is spent', () => {
    const g = begin(241);
    runes(g, 0, ready('order', 12));
    const fanfare = inHand(g, 'fanfare');
    const maker = inHand(g, 'faithful-manufactor');
    const x = inHand(g, 'shipyard-skulker');
    const y = inHand(g, 'shipyard-skulker');
    reask(g);
    act(g, `play:${fanfare}`);
    act(g, 'pay:0');
    passBoth(g);
    expect(g.s.delayed).toMatchObject([{ controller: 0, window: { during: 'thisTurn', uses: 3 } }]);
    expect(viewFor(g.s, 1).delayed).toHaveLength(1);                 // views carry them (§7.3)
    const draws = () => evs(g, 'draw').filter((e) => e.rule === '414').length;
    act(g, `play:${maker}`);
    opt(g, 'loc:base');
    act(g, 'pay:0');
    settle(g);                                                       // its Recruit is a unit played too
    expect(draws()).toBe(2);
    for (const card of [x, y]) {
      act(g, `play:${card}`);
      opt(g, 'loc:base');
      act(g, 'pay:0');
      settle(g);
    }
    expect(draws()).toBe(3);
    expect(g.s.delayed[0].window).toMatchObject({ uses: 0 });
    endTurn(g);
    expect(g.s.delayed).toEqual([]);                                 // over with the turn [317.2.c]
  });
});

describe('Deathknell [808] with last-known information', () => {
  it('[808.1.d] Hunting Dog killed by damage: its Deathknell plays a Bird with Deflect to its controller\'s base', () => {
    const g = begin(251);
    runes(g, 0, ready('mind', 10));
    const dog = put(g, 'hunting-dog', 1, base(1));
    const nova = inHand(g, 'supernova');
    reask(g);
    act(g, `play:${nova}`);
    opt(g, `t:${dog}`);
    act(g, 'pay:0');
    passBoth(g);                                                     // 10 damage; the cleanup kills it
    expect(g.s.objects[dog]).toBeUndefined();
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', ability: 'hunting-dog#0', controller: 1, source: dog,
      sourceLki: { def: 'hunting-dog', controller: 1, loc: { z: 'base', p: 1 } } }]);
    passBoth(g);
    const bird = at(g, 'bird', 1)[0];
    expect(g.s.objects[bird]).toMatchObject({ token: true, zone: { z: 'base', p: 1 } });
    expect(keywordOf(g.s, bird, 'deflect')).toBe(1);
  });

  it('[383.2.c.3.a] banished, it doesn\'t die: no Deathknell', () => {
    const g = begin(252);
    runes(g, 0, ready('order', 4));
    const dog = put(g, 'hunting-dog', 1, base(1));
    const away = inHand(g, 'burn-away');
    reask(g);
    act(g, `play:${away}`);
    opt(g, `t:${dog}`);
    act(g, 'pay:0');
    passBoth(g);
    expect(g.s.chain).toEqual([]);
    expect(at(g, 'bird', 1)).toEqual([]);
  });

  it('[429.1.a.2] dying in combat (a cleanup kill) triggers it too', () => {
    const g = begin(253);
    control(g, 0, 1);
    put(g, 'hunting-dog', 1, bf(0));
    const big = put(g, 'the-empyrean', 0, base(0));
    reask(g);
    act(g, 'move');
    if (keys(g).includes(`u:${big}`)) { act(g, `u:${big}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    passBoth(g);
    settle(g);
    expect(at(g, 'bird', 1)).toHaveLength(1);
  });
});

describe('instructions: "if you do", links, look-back [359.3.e.13–14]', () => {
  it('[359.3.e.14.b] Deathgrip: kill a friendly unit; if you do, its Might (look-back) to another; draw 1', () => {
    const g = begin(261);
    runes(g, 0, ready('order', 4));
    const k = put(g, 'shipyard-skulker', 0, base(0));
    const t = put(g, 'strigian-oracle', 0, base(0));
    const grip = inHand(g, 'deathgrip');
    reask(g);
    act(g, `play:${grip}`);
    opt(g, `t:${k}`);
    expect(keys(g)).not.toContain(`t:${k}`);                         // "another" [355.9]
    opt(g, `t:${t}`);
    act(g, 'pay:0');
    const hand = g.s.players[0].hand.length;
    passBoth(g);
    expect(mightOf(g.s, t)).toBe(2 + 3);
    expect(g.s.players[0].hand.length).toBe(hand + 1);
  });

  it('[359.3.e.14.b] the unit gone before resolution: the kill is ignored, "if you do" fails, the draw still happens', () => {
    const g = begin(262);
    runes(g, 0, ready('order', 4));
    const k = put(g, 'shipyard-skulker', 0, base(0));
    const t = put(g, 'strigian-oracle', 0, base(0));
    const grip = inHand(g, 'deathgrip');
    reask(g);
    act(g, `play:${grip}`);
    opt(g, `t:${k}`);
    opt(g, `t:${t}`);
    act(g, 'pay:0');
    moveObject(g.s, k, Z.trash(0));
    const hand = g.s.players[0].hand.length;
    passBoth(g);
    expect(mightOf(g.s, t)).toBe(2);
    expect(g.s.players[0].hand.length).toBe(hand + 1);
  });

  it('[359.3.e.14.a] Hidden Blade: its controller draws 2; the target gone, the linked draw is ignored too', () => {
    const g = begin(263);
    runes(g, 0, ready('order', 6));
    control(g, 0, 1);
    const a = put(g, 'shipyard-skulker', 1, bf(0));
    const b = put(g, 'shipyard-skulker', 1, bf(0));
    const one = inHand(g, 'hidden-blade');
    const two = inHand(g, 'hidden-blade');
    reask(g);
    const theirs = g.s.players[1].hand.length;
    act(g, `play:${one}`);
    opt(g, `t:${a}`);
    act(g, 'pay:0');
    passBoth(g);
    expect(g.s.objects[a]).toBeUndefined();
    expect(g.s.players[1].hand.length).toBe(theirs + 2);             // "its controller", from look-back
    act(g, `play:${two}`);
    opt(g, `t:${b}`);
    act(g, 'pay:0');
    moveObject(g.s, b, Z.base(1));                                   // no longer "at a battlefield"
    passBoth(g);
    expect(evs(g, 'outcome').slice(-2).map((e) => e.outcome)).toEqual([{ o: 'ignored', why: 'targets' },
      { o: 'ignored', why: 'linked' }]);
    expect(g.s.players[1].hand.length).toBe(theirs + 2);
  });
});

describe('phase triggers [315.2.a], [317.1.a]', () => {
  it('Sona, Harmonious: at the end of your turn, if at a battlefield, ready up to 4 friendly runes', () => {
    const g = begin(271);
    control(g, 0, 0);
    const sona = put(g, 'sona-harmonious', 0, bf(0));
    runes(g, 0, [['mind', false], ['mind', false], ['order', true]]);
    reask(g);
    act(g, 'end');
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', ability: 'sona-harmonious#0', source: sona }]);
    const tired = g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune') && g.s.objects[id].exhausted);
    for (const r of tired) opt(g, `t:${r}`);
    act(g, 'done');
    passBoth(g);
    expect(tired.every((r) => !g.s.objects[r].exhausted)).toBe(true);
  });

  it('[383.2.a.1] its intervening "if" is false in base: it doesn\'t trigger', () => {
    const g = begin(272);
    put(g, 'sona-harmonious', 0, base(0));
    reask(g);
    act(g, 'end');
    expect(evs(g, 'chainPush').filter((e) => e.kind === 'triggered')).toEqual([]);
  });
});
