import { describe, expect, it } from 'vitest';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { mightOf } from '../../src/game/rules/chars.ts';
import { Z } from '../../src/game/state/zones.ts';
import {
  act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes, settle, start, type Game,
} from './helpers/scenario.ts';

/*
 * Triggered and activated abilities, tokens and limited plays (M1.2):
 * play effects [383.4.a], "when I become exhausted" [415], once each turn
 * [383.3.e], simultaneous triggers [383.3.d], conquer and hold effects
 * [383.4.c–d], battlefield abilities [190.6], Deploy [830], Disarm [831],
 * playing a card from the trash with S2 rollback (Spec D §8.5), activated
 * abilities [377–381], [402–407], and Add abilities as chain items [430.2].
 */

/** Makes battlefield i a given battlefield card (tests only). */
const bfDef = (g: Game, i: number, def: string) => setField(g.s, g.s.objects[g.s.bfs[i].obj], 'def', def);
const defsAt = (g: Game, ids: number[]) => ids.map((id) => g.s.objects[id].def);
const passBoth = (g: Game) => { act(g, 'pass'); act(g, 'pass'); };

describe('triggered abilities [382–389]', () => {
  it('[383.4.a.2] [440.2.c] a play effect goes on the chain after the unit enters; its Recruit is played via the chain', () => {
    const g = start(31);
    runes(g, 0, ready('order', 3));
    const card = inHand(g, 'faithful-manufactor');
    reask(g);
    act(g, `play:${card}`);
    act(g, 'pay:0');
    const unit = g.s.players[0].base.find((id) => g.s.objects[id].def === 'faithful-manufactor')!;
    expect(g.s.objects[unit].exhausted).toBe(true);
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', status: 'finalized', source: unit,
      ability: 'faithful-manufactor#0' }]);
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0, prompt: { window: 'chain' } });
    passBoth(g);
    expect(g.s.chain).toEqual([]);
    const recruit = g.s.players[0].base.find((id) => g.s.objects[id].def === 'recruit')!;
    expect(g.s.objects[recruit]).toMatchObject({ token: true, exhausted: true, controller: 0 });   // "here": the base
    expect(g.s.log.played.map((r) => [r.def, r.isCard])).toEqual([['faithful-manufactor', true], ['recruit', false]]);
  });

  it('[359.3.e.12] "here" with its source gone is null information: the instruction is ignored', () => {
    const g = start(32);
    runes(g, 0, ready('mind', 4));
    const card = inHand(g, 'industrious-mechsmith');
    reask(g);
    act(g, `play:${card}`);
    act(g, 'pay:0');
    const unit = g.s.players[0].base.find((id) => g.s.objects[id].def === 'industrious-mechsmith')!;
    moveObject(g.s, unit, Z.trash(0));                               // gone before its play effect resolves
    passBoth(g);
    expect(evs(g, 'outcome').at(-1)?.outcome).toEqual({ o: 'ignored', why: 'nullInfo' });
    expect(Object.values(g.s.objects).some((o) => o.def === 'mech')).toBe(false);
  });

  it('[415] [437] "when I become exhausted": the Standard Move\'s cost places Predict before any showdown begins', () => {
    const g = start(33);
    const oracle = put(g, 'strigian-oracle', 0, base(0));
    reask(g);
    act(g, 'move');
    if (keys(g).includes(`u:${oracle}`)) { act(g, `u:${oracle}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', source: oracle }]);
    expect(g.s.showdown).toBeNull();                                 // Closed: step 9 waits [323.11]
    const top = g.s.players[0].deck[0];
    passBoth(g);
    expect(g.s.pending).toMatchObject({ kind: 'predict', player: 0, privateOptions: true });
    expect(keys(g).sort()).toEqual([`keep:${top}`, `recycle:${top}`]);
    expect(g.s.objects[top].knownBy).toBe(1);                       // looked at by P0 only
    act(g, `recycle:${top}`);
    expect(g.s.players[0].deck.includes(top)).toBe(false);
    expect(g.s.objects[g.s.players[0].deck.at(-1)!].card).toBeDefined();
    settle(g);
    expect(g.s.showdown).toEqual({ bf: 0, kind: 'nonCombat' });      // now the showdown begins
  });

  it('[383.3.e] [403.1] once each turn, "you may": declining doesn\'t use it up; once performed it doesn\'t trigger again', () => {
    const g = start(34);
    const units = [put(g, 'seraphine-inspiring', 0, base(0)), put(g, 'hunting-dog', 0, base(0)),
      put(g, 'hunting-dog', 0, base(0))];
    const moveAll = () => {
      act(g, 'move');
      for (const u of units) if (keys(g).includes(`u:${u}`)) act(g, `u:${u}`);
      if (keys(g).includes('done')) act(g, 'done');
    };
    reask(g);
    moveAll(); act(g, 'loc:bf0');
    expect(g.s.pending).toMatchObject({ kind: 'may', player: 0 });  // [403.1] decided as it finalizes
    act(g, 'no');
    expect(g.s.chain).toEqual([]);                                   // removed, not triggered [383.3.a.2]
    settle(g);
    while (g.s.pending?.kind === 'priority' && g.s.pending.prompt.window === 'showdown') act(g, 'pass');
    settle(g);
    for (const u of units) setField(g.s, g.s.objects[u], 'exhausted', false);
    reask(g);
    moveAll();                                                       // home again: three exhausted at once
    act(g, 'yes');
    passBoth(g);
    expect(g.s.log.draws[0]).toBeGreaterThan(0);
    expect(g.s.usage).toMatchObject({ [`${units[0]}|seraphine-inspiring#0|*`]: 1 });
    for (const u of units) setField(g.s, g.s.objects[u], 'exhausted', false);
    reask(g);
    moveAll(); act(g, 'loc:bf0');
    expect(g.s.chain.filter((i) => i.ability === 'seraphine-inspiring#0')).toEqual([]);   // [383.3.e.1]
  });

  it('[383.3.d] a player orders their simultaneous triggers; the one placed last resolves first', () => {
    const g = start(35);
    const a = put(g, 'strigian-oracle', 0, base(0));
    const b = put(g, 'seraphine-inspiring', 0, base(0));
    const c = put(g, 'hunting-dog', 0, base(0));
    reask(g);
    act(g, 'move');
    for (const u of [a, b, c]) if (keys(g).includes(`u:${u}`)) act(g, `u:${u}`);
    if (keys(g).includes('done')) act(g, 'done');
    act(g, 'loc:bf0');
    expect(g.s.pending).toMatchObject({ kind: 'orderTriggers', player: 0 });
    const inspiring = g.s.pending!.options.find((o) => o.refs?.some((r) => 'obj' in r && r.obj === b))!.key;
    act(g, inspiring);                                               // Seraphine's goes on first: it resolves last
    expect(g.s.chain.map((i) => i.source)).toEqual([b, a]);
    expect(g.s.pending?.kind).toBe('may');                           // the oldest pending item finalizes first [337.1.b]
  });

  it('[383.4.c] [830] Deploy gear: battlefields only, never recalled; its conquer effect pays [1] for a Recruit; an opponent\'s hold kills it', () => {
    const g = start(36);
    bfDef(g, 0, 'valley-of-idols');
    bfDef(g, 1, 'valley-of-idols');
    runes(g, 0, ready('order', 4));
    const poster = inHand(g, 'concert-poster');
    reask(g);
    act(g, `play:${poster}`);
    expect(keys(g)).toEqual(['loc:bf0', 'loc:bf1', 'back']);         // any battlefield, only battlefields [830.1.b.1–2]
    act(g, 'loc:bf1');
    act(g, 'pay:0');
    const gear = g.s.bfs[1].here[0];
    expect(g.s.objects[gear]).toMatchObject({ def: 'concert-poster', exhausted: false });
    expect(g.s.pending).toMatchObject({ kind: 'payment', player: 0 });   // "you may pay [1]": the payment is the may
    act(g, 'pay:0');
    passBoth(g);
    expect(defsAt(g, g.s.players[0].base).filter((d) => d === 'recruit')).toHaveLength(1);
    expect(g.s.bfs[1].here).toContain(gear);                          // not recalled [830.1.b.3]
    // P1 holds bf1 on their turn: Deploy's "when an opponent holds here, kill this" [830.1.b.4].
    put(g, 'hunting-dog', 1, bf(1));
    control(g, 1, 1);
    reask(g);
    act(g, 'end');
    settle(g);
    while (g.s.pending?.kind === 'priority' && g.s.pending.prompt.window === 'chain') act(g, 'pass');
    expect(g.s.objects[gear]).toBeUndefined();
    expect(defsAt(g, g.s.players[0].trash)).toContain('concert-poster');
  });

  it('[190.6.c] Valley of Idols: the player who played a unit there may pay [1] to buff it', () => {
    const g = start(37);
    bfDef(g, 1, 'valley-of-idols');
    control(g, 1, 0);
    put(g, 'hunting-dog', 0, bf(1));
    runes(g, 0, ready('order', 4));
    const card = inHand(g, 'hunting-dog');
    reask(g);
    act(g, `play:${card}`);
    act(g, 'loc:bf1');
    act(g, 'pay:0');
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', controller: 0, ability: 'valley-of-idols#0' }]);
    act(g, 'pay:0');                                                 // the trigger's cost [383.3.b]
    passBoth(g);
    const unit = g.s.bfs[1].here.find((id) => g.s.objects[id].def === 'hunting-dog' && g.s.objects[id].exhausted)!;
    expect(g.s.objects[unit].buffs).toBe(1);
    expect(mightOf(g.s, unit)).toBe(4);
  });

  it('[383.1.b] Black Rose Sanctum: for each player, the first non-token death there each turn, one Recruit', () => {
    const g = start(38);
    bfDef(g, 0, 'black-rose-sanctum');
    control(g, 0, 1);
    const a = put(g, 'shipyard-skulker', 1, bf(0), { damage: 3 });
    const b = put(g, 'shipyard-skulker', 1, bf(0), { damage: 3 });
    put(g, 'shipyard-skulker', 1, bf(0));
    reask(g);                                                        // the cleanup kills both at once
    expect(g.s.objects[a] ?? g.s.objects[b]).toBeUndefined();
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', controller: 1, ability: 'black-rose-sanctum#0' }]);
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 1 });   // its controller holds priority [337.4]
    passBoth(g);
    expect(defsAt(g, g.s.players[1].base)).toContain('recruit');
    const c = g.s.bfs[0].here.find((id) => g.s.objects[id].def === 'shipyard-skulker')!;
    setField(g.s, g.s.objects[c], 'damage', [{ amount: 5, by: null, sources: [], combat: false, group: 0 }]);
    reask(g);
    expect(g.s.chain).toEqual([]);                                   // not the first time this turn
  });

  it('[383.3.d.1] simultaneous triggers of both players: the Turn Player\'s go on first, so they resolve last', () => {
    const g = start(45);
    bfDef(g, 0, 'black-rose-sanctum');
    const a = put(g, 'shipyard-skulker', 0, bf(0), { damage: 3 });
    const b = put(g, 'shipyard-skulker', 1, bf(0), { damage: 3 });
    reask(g);                                                        // one Kill action, both die
    expect(g.s.objects[a] ?? g.s.objects[b]).toBeUndefined();
    expect(g.s.chain.map((i) => [i.ability, i.controller])).toEqual([['black-rose-sanctum#0', 0], ['black-rose-sanctum#0', 1]]);
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 1 });   // the newest item's controller [337.4]
    passBoth(g);
    expect(g.s.chain.map((i) => i.controller)).toEqual([0]);         // P1's resolved first
    passBoth(g);
    expect(defsAt(g, g.s.players[0].base)).toContain('recruit');
    expect(defsAt(g, g.s.players[1].base)).toContain('recruit');
  });

  it('[383.4.c] Ruined Monastery: when you conquer here, you may discard 1 and channel 1 rune exhausted', () => {
    const g = start(39);
    bfDef(g, 0, 'ruined-monastery');
    const unit = put(g, 'hunting-dog', 0, base(0));
    const junk = inHand(g, 'hunting-dog');
    reask(g);
    act(g, 'move');
    if (keys(g).includes(`u:${unit}`)) { act(g, `u:${unit}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    passBoth(g);                                                     // the showdown closes: Conquer
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', controller: 0, ability: 'ruined-monastery#0' }]);
    act(g, 'yes');
    passBoth(g);
    expect(g.s.pending).toMatchObject({ kind: 'pickCard', player: 0, privateOptions: true });
    const runesBefore = g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
    act(g, `pick:${junk}`);
    expect(defsAt(g, g.s.players[0].trash)).toContain('hunting-dog');
    const runesNow = g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune'));
    expect(runesNow).toHaveLength(runesBefore + 1);
    expect(g.s.objects[runesNow.at(-1)!].exhausted).toBe(true);      // channelled exhausted
  });

  it('[383.4.e] [831] Disarm: when it attacks, an enemy unit there gets -2 this turn', () => {
    const g = start(40);
    const sera = put(g, 'seraphine-inspiring', 0, base(0));
    const d = put(g, 'shipyard-skulker', 1, bf(0));
    control(g, 0, 1);
    reask(g);
    act(g, 'move');
    if (keys(g).includes(`u:${sera}`)) { act(g, `u:${sera}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    expect(g.s.combat).toMatchObject({ attacker: 0 });
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', ability: 'seraphine-inspiring#kw:disarm', source: sera }]);
    expect(g.s.chain[0].play.choices.executions[0].targets.a).toMatchObject([{ id: d }]);   // the only enemy unit: chosen
    passBoth(g);
    expect(mightOf(g.s, d)).toBe(1);
    expect(g.s.turn).toMatchObject({ focus: 0 });                    // a trigger's chain doesn't pass Focus [346.1]
  });
});

describe('modes and resolution-time choices [355.3], [355.18]', () => {
  it('[355.3] Encore: two modes, each with its own choices; a token\'s location is chosen as it is played [440.2.b.1]', () => {
    const g = start(46);
    runes(g, 0, ready('mind', 4));
    const x = put(g, 'hunting-dog', 1, base(1));
    const encore = inHand(g, 'encore');
    reask(g);
    expect(keys(g)).toContain(`play:${encore}`);                     // survives the feasibility probe (§4.6)
    act(g, `play:${encore}`);
    expect(g.s.pending).toMatchObject({ kind: 'mode', back: true });
    expect(keys(g)).toEqual(['mode:0', 'mode:1', 'mode:2', 'mode:3', 'back']);
    act(g, 'mode:1');
    act(g, 'mode:0');
    expect(g.s.chain[0].play.choices.executions[0].modes).toEqual([0, 1]);
    expect(g.s.chain[0].play.choices.executions[0].targets.a).toMatchObject([{ id: x }]);   // the only unit
    act(g, 'pay:0');
    passBoth(g);
    expect(g.s.objects[x].damage.reduce((n, d) => n + d.amount, 0)).toBe(2);
    const tokens = g.s.chain.filter((i) => i.kind === 'token');
    expect(tokens).toHaveLength(0);                                  // both Recruits played from base on their own
    expect(defsAt(g, g.s.players[0].base).filter((d) => d === 'recruit')).toHaveLength(2);
  });

  it('[414.1] [417] Encore\'s last mode: look at 2, draw the one picked, recycle the other; only the looker knew them', () => {
    const g = start(47);
    runes(g, 0, ready('mind', 4));
    const encore = inHand(g, 'encore');
    reask(g);
    act(g, `play:${encore}`);
    act(g, 'mode:1');
    act(g, 'mode:3');
    act(g, 'pay:0');
    const [top, second] = g.s.players[0].deck;
    const secondCard = g.s.objects[second].card;
    passBoth(g);
    while (g.s.pending?.kind === 'location') act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'pickCard', player: 0, privateOptions: true });
    expect(keys(g)).toEqual([`pick:${top}`, `pick:${second}`]);
    expect(g.s.objects[top].knownBy).toBe(1);
    act(g, `pick:${second}`);
    expect(g.s.players[0].deck.includes(top)).toBe(false);
    const bottom = g.s.objects[g.s.players[0].deck.at(-1)!];
    expect(bottom.knownBy).toBe(1);                                  // P0 knows what went to the bottom
    expect(g.s.players[0].hand.some((id) => g.s.objects[id].card === secondCard)).toBe(true);   // drawn [414.1]
    expect(evs(g, 'look').at(-1)).toMatchObject({ vis: 1 });
  });
});

describe('limited plays [420.3] and S2 (Spec D §8.5)', () => {
  function restorationist(seed: number) {
    const g = start(seed);
    runes(g, 0, ready('order', 9));
    const resto = inTrash(g, 'meticulous-restorationist');
    put(g, 'hunting-dog', 0, base(0), { exhausted: true });
    const anthem = inHand(g, 'raucous-anthem');
    reask(g);
    act(g, `play:${anthem}`);
    act(g, 'pay:0');
    passBoth(g);                                                     // Raucous Anthem resolves: played [420.4.a]
    expect(g.s.chain).toMatchObject([{ kind: 'triggered', ability: 'meticulous-restorationist#0', source: resto,
      controller: 0 }]);
    act(g, 'yes');
    passBoth(g);                                                     // the trigger resolves: step 1 of the play
    return { g, resto };
  }

  it('[420.3] a card played from the trash by an effect: no back, its own cost [Y], then it enters', () => {
    const { g } = restorationist(41);
    expect(g.s.chain).toMatchObject([{ kind: 'card', status: 'pending', play: { mode: 'limited' } }]);
    expect(g.s.chain[0].play.snap2).not.toBeNull();                  // S2 taken as step 2 began
    if (g.s.pending?.kind === 'location') act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment' });
    expect(g.s.pending!.back).toBeUndefined();                       // limited plays have no back (§4.4)
    expect(g.s.pending!.prompt).toMatchObject({ energy: 0, power: ['order'] });
    act(g, 'pay:0');
    expect(defsAt(g, g.s.players[0].base)).toContain('meticulous-restorationist');
    expect(g.s.log.played.at(-1)).toMatchObject({ def: 'meticulous-restorationist', from: 'trash' });
  });

  it('[445.2.a] [358.5] declining the cost rolls back to S2: the card returns to the trash as it was; the Anthem stands', () => {
    const { g, resto } = restorationist(42);
    if (g.s.pending?.kind === 'location') act(g, 'loc:base');
    const readied = g.s.players[0].base.filter((id) => g.s.objects[id].def === 'hunting-dog');
    act(g, 'decline');
    expect(g.s.chain).toEqual([]);
    expect(g.s.players[0].trash).toContain(resto);                   // same identity (Spec D §8.5)
    expect(g.s.objects[resto].zone).toEqual({ z: 'trash', p: 0 });
    expect(readied.every((id) => !g.s.objects[id].exhausted && mightOf(g.s, id) === 6)).toBe(true);   // the Anthem's effects stay
    expect(evs(g, 'rollback').at(-1)?.reason).toBe('declined');
    expect(g.s.pending).toMatchObject({ kind: 'priority', prompt: { window: 'main' } });
  });
});

describe('activated and Add abilities [377–381], [402–407], [430]', () => {
  it('[381] [402.1] [415.4] an [E] ability: activated at default timing, the source exhausted as its cost, then resolved', () => {
    const g = start(43);
    const stalker = put(g, 'pitiless-stalker', 0, base(0));
    const x = put(g, 'hunting-dog', 1, base(1));
    put(g, 'hunting-dog', 1, base(1));
    reask(g);
    const key = `act:${stalker}#0`;
    expect(keys(g)).toContain(key);
    act(g, key);
    expect(g.s.chain).toMatchObject([{ kind: 'activated', status: 'pending', source: stalker }]);   // closes the state [402.1]
    expect(g.s.pending).toMatchObject({ kind: 'target', back: true });
    act(g, 'back');                                                  // undone: S0
    expect(g.s.chain).toEqual([]);
    expect(g.s.objects[stalker].exhausted).toBe(false);
    act(g, key);
    act(g, `t:${x}`);
    expect(g.s.objects[stalker].exhausted).toBe(true);               // [E] paid at step 4
    expect(g.s.chain).toMatchObject([{ kind: 'activated', status: 'finalized' }]);
    passBoth(g);
    expect(g.s.objects[x].stunned).toBe(true);
    expect(keys(g)).not.toContain(key);                              // exhausted: can't pay [E] again
  });

  it('[430.2] [430.3] paying rune by rune: each tap is an Add ability that resolves at once, moving no counter', () => {
    const g = start(44);
    runes(g, 0, ready('mind', 10));
    const x = put(g, 'hunting-dog', 1, base(1));
    const nova = inHand(g, 'supernova');
    reask(g);
    act(g, `play:${nova}`);                                          // the only unit: chosen on its own
    expect(g.s.chain[0].play.choices.executions[0].targets.a).toMatchObject([{ id: x }]);
    expect(keys(g)).toContain('manualPay');
    act(g, 'manualPay');
    expect(g.s.pending).toMatchObject({ kind: 'addAbility', player: 0 });
    const runeIds = g.s.players[0].base.filter((id) => g.s.objects[id].def === 'mind-rune');
    for (const r of runeIds.slice(0, 9)) act(g, `act:${r}#exhaust`);
    expect(keys(g)).not.toContain('done');                           // 9 Energy, no Mind Power yet
    act(g, `act:${runeIds[9]}#recycle`);
    expect(g.s.players[0].pool).toMatchObject({ energy: 9, power: { mind: 1 } });
    const adds = evs(g, 'chainPush').filter((e) => e.kind === 'activated');
    expect(adds).toHaveLength(10);
    expect(g.s.chain).toHaveLength(1);                               // each one finalized and resolved at once
    act(g, 'done');
    expect(g.s.chain).toMatchObject([{ status: 'finalized' }]);
    expect(g.s.players[0].pool).toMatchObject({ energy: 0, power: { mind: 0 } });
  });
});
