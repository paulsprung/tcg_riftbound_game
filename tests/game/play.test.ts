import { describe, expect, it } from 'vitest';
import type { GameState, ObjId } from '../../src/game/index.ts';
import { createObject, moveObject, setField } from '../../src/game/state/mut.ts';
import { paymentPlans } from '../../src/game/rules/resources.ts';
import { act, base, bf, control, evs, keys, put, readyRunes, reask, start, type Game } from './helpers/scenario.ts';

/*
 * Playing units and gear (Spec D, [349–359]), payment plans (§4.5, Spec B
 * §6, [164.2], [357], [445]) and the Standard Move (Spec F §35.3, [144]),
 * with card abilities off (M1.1).
 */

/** Puts a card of p's in their hand, known to them only. */
function inHand(g: Game, def: string, p: 0 | 1 = 0): ObjId {
  return createObject(g.s, { def, printing: null, owner: p, zone: { z: 'hand', p } }).id;
}

/** Gives p runes in base: [domain, ready][]. */
function runes(g: Game, p: 0 | 1, list: [string, boolean][]) {
  for (const id of g.s.players[p].base.slice()) {
    if (g.s.objects[id].def.endsWith('-rune')) moveObject(g.s, id, { z: 'runeDeck', p }, { pos: 'bottom', knownBy: 0 });
  }
  for (const [d, ready] of list) {
    createObject(g.s, { def: `${d}-rune`, printing: null, owner: p, zone: { z: 'base', p }, exhausted: !ready });
  }
}

const withoutRng = (s: GameState) => ({ ...s, next: null, rng: null, frames: null, pending: null, epoch: null, turn: { ...s.turn, decisionsThisTurn: 0 } });

describe('Spec D: playing a unit', () => {
  it('[354] [355.2] [357] [359.2.c] a unit goes via the chain to the chosen location, exhausted, paid by a plan', () => {
    const g = start(1);
    const card = inHand(g, 'strigian-oracle');                       // [2]
    put(g, 'hunting-dog', 0, bf(1));
    control(g, 1, 0);
    reask(g);
    expect(keys(g)).toContain(`play:${card}`);
    act(g, `play:${card}`);
    expect(g.s.chain).toHaveLength(1);                               // step 1: on the chain, state Closed [354.1]
    expect(g.s.pending).toMatchObject({ kind: 'location', back: true });
    expect(keys(g)).toEqual(['loc:base', 'loc:bf1', 'back']);         // base or a battlefield P0 controls [355.2.a]
    act(g, 'loc:bf1');
    expect(g.s.pending).toMatchObject({ kind: 'payment' });
    expect(keys(g)).toEqual(['pay:0', 'decline', 'back']);
    act(g, 'pay:0');
    const unit = g.s.bfs[1].here.find((id) => g.s.objects[id].def === 'strigian-oracle')!;
    expect(unit).toBeDefined();
    expect(g.s.objects[unit]).toMatchObject({ exhausted: true, controller: 0, played: { by: 0, energySpent: 2 } });
    expect(g.s.chain).toEqual([]);
    expect(readyRunes(g, 0)).toEqual([]);
    expect(g.s.log.played.map((r) => r.def)).toEqual(['strigian-oracle']);
    expect(evs(g, 'enter').at(-1)).toMatchObject({ exhausted: true, rule: '359.2.c' });
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0 });
  });

  it('[359.2.d] gear enters ready at its controller\'s base, with no location to choose; Deploy gear waits for M1.3', () => {
    const g = start(2);
    const gear = inHand(g, 'blood-rose');                            // [1]
    const poster = inHand(g, 'concert-poster');                      // [1], Deploy
    control(g, 0, 0);
    reask(g);
    expect(keys(g)).not.toContain(`play:${poster}`);
    act(g, `play:${gear}`);
    expect(g.s.pending?.kind).toBe('payment');                       // no location decision for gear
    act(g, 'pay:0');
    const o = Object.values(g.s.objects).find((x) => x.def === 'blood-rose')!;
    expect(o).toMatchObject({ zone: { z: 'base', p: 0 }, exhausted: false });
  });

  it('[358.5] back and [445.2.a] decline restore the state exactly, but nobody unsees the card', () => {
    for (const how of ['back', 'decline']) {
      const g = start(4);
      const card = inHand(g, 'strigian-oracle');
      reask(g);
      const before = structuredClone(g.s);
      act(g, `play:${card}`);                                        // base is the only location: chosen on its own
      expect(g.s.pending?.kind).toBe('payment');
      act(g, how);
      expect(g.s.players[0].hand).toContain(card);                   // same id: the play never happened
      expect(g.s.objects[card].knownBy).toBe(3);                     // P1 saw it on the chain [§4.4]
      const after = structuredClone(g.s);
      after.objects[card].knownBy = before.objects[card].knownBy;
      expect(withoutRng(after)).toEqual(withoutRng(before));
      expect(evs(g, 'rollback').map((e) => e.reason)).toEqual([how === 'back' ? 'back' : 'declined']);
      expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0 });
    }
  });

  it('[420.2.a] [203.3] only cards the player can pay for are offered; spells not yet (M1.2)', () => {
    const g = start(5);
    const cheap = inHand(g, 'strigian-oracle');                      // [2]
    const dear = inHand(g, 'heimerdinger-academy-instructor');       // [6][Y]
    const spell = inHand(g, 'burn-away');
    reask(g);
    expect(keys(g)).toContain(`play:${cheap}`);
    expect(keys(g)).not.toContain(`play:${dear}`);
    expect(keys(g)).not.toContain(`play:${spell}`);
  });

  it('[420.1.a] the Chosen Champion can be played from the Champion Zone', () => {
    const g = start(6);
    runes(g, 0, [['mind', true], ['mind', true], ['mind', true], ['mind', true], ['order', true]]);
    reask(g);
    const champ = g.s.players[0].champion!;
    act(g, `play:${champ}`);
    act(g, 'pay:0');
    expect(g.s.players[0].champion).toBeNull();
    expect(g.s.players[0].base.some((id) => g.s.objects[id].def === 'seraphine-inspiring')).toBe(true);
  });
});

describe('§4.5 payment plans', () => {
  it('[164.2] Energy by exhausting, Power by recycling: least attrition first, exhausted runes recycled before ready ones', () => {
    const g = start(7);
    runes(g, 0, [['order', true], ['order', true], ['order', true], ['order', false], ['mind', true]]);
    const plans = paymentPlans(g.s, 0, { energy: 0, power: [{ k: 'domain', d: 'order' }] });
    expect(plans.length).toBeGreaterThan(1);
    expect(plans[0].attrition).toBe(1);
    const recycled = plans[0].steps.filter((st) => st.ability === 'recycle').map((st) => g.s.objects[st.obj]);
    expect(recycled.map((o) => [o.def, o.exhausted])).toEqual([['order-rune', true]]);
    expect(plans[0].leaves.readyRunes).toBe(4);
    // With Energy to pay too, exhausting a ready rune and then recycling it leaves the same board as
    // recycling the exhausted one: one plan, not two.
    const both = paymentPlans(g.s, 0, { energy: 1, power: [{ k: 'domain', d: 'order' }] });
    expect(both[0].leaves.readyRunes).toBe(3);
    expect(both.map((p) => p.steps.map((st) => g.s.objects[st.obj].def).join())).toEqual(
      ['mind-rune,order-rune', 'order-rune,order-rune']);   // exhaust the Mind rune or an Order one
  });

  it('a ready rune can be exhausted for Energy and then recycled for Power', () => {
    const g = start(8);
    runes(g, 0, [['mind', true]]);
    const [plan] = paymentPlans(g.s, 0, { energy: 1, power: [{ k: 'domain', d: 'mind' }] });
    expect(plan.steps.map((st) => st.ability)).toEqual(['exhaust', 'recycle']);
    expect(paymentPlans(g.s, 0, { energy: 2, power: [] })).toEqual([]);   // can't pay [203.3]
  });

  it('[135.2.e.6.c] a symbol of either domain takes Power of either; [A] any', () => {
    const g = start(9);
    runes(g, 0, [['mind', false], ['order', false]]);
    const anyOf = paymentPlans(g.s, 0, { energy: 0, power: [{ k: 'anyOf', ds: ['mind', 'order'] }] });
    expect(anyOf).toHaveLength(2);
    expect(paymentPlans(g.s, 0, { energy: 0, power: [{ k: 'domain', d: 'fury' }] })).toEqual([]);
    expect(paymentPlans(g.s, 0, { energy: 0, power: [{ k: 'any' }, { k: 'domain', d: 'mind' }] })).toHaveLength(1);
  });

  it('[166.2] what the pool holds pays first', () => {
    const g = start(10);
    setField(g.s, g.s.players[0].pool, 'energy', 2);
    const [plan] = paymentPlans(g.s, 0, { energy: 2, power: [] });
    expect(plan.steps).toEqual([]);
    expect(plan.fromPool.energy).toBe(2);
  });
});

describe('Spec F §35: the Standard Move', () => {
  it('[144.3] [144.3.c] several units move as one action, their exhausts paid together', () => {
    const g = start(11);
    const a = put(g, 'strigian-oracle', 0, base(0));
    const b = put(g, 'hunting-dog', 0, base(0));
    reask(g);
    act(g, 'move');
    expect(g.s.pending).toMatchObject({ kind: 'moveUnits', batch: expect.stringMatching(/^move:/) });
    act(g, `u:${a}`); act(g, `u:${b}`);                              // nothing left to add: done on its own
    expect(keys(g)).toEqual(['loc:bf0', 'loc:bf1', 'back']);         // base → a battlefield [144.4.a]
    act(g, 'loc:bf0');
    const ex = evs(g, 'exhaust').at(-1)!;
    expect(ex.objs.sort()).toEqual([a, b].sort());
    expect(evs(g, 'move').at(-1)).toMatchObject({ objs: [a, b], standard: true, to: { z: 'bf', bf: 0 } });
    expect(g.s.log.exhausted.at(-1)).toMatchObject({ byCost: true });
  });

  it('[144.4.a–b] [144.3.a] units share one destination; from a battlefield only back to base', () => {
    const g = start(12);
    const home = put(g, 'strigian-oracle', 0, base(0));
    const away = put(g, 'hunting-dog', 0, bf(1));
    control(g, 1, 0);
    reask(g);
    act(g, 'move');
    expect(keys(g)).toContain(`u:${home}`);
    act(g, `u:${away}`);                                             // then nothing shares a destination with it:
    void home;                                                       // done and base are chosen on their own
    expect(g.s.objects[away].zone).toEqual({ z: 'base', p: 0 });
  });

  it('[144.1.c] no Standard Move during a showdown; back leaves a move unmade', () => {
    const g = start(13);
    put(g, 'strigian-oracle', 0, base(0));
    put(g, 'strigian-oracle', 0, base(0));
    reask(g);
    act(g, 'move');
    act(g, 'back');
    expect(g.s.pending).toMatchObject({ kind: 'priority' });
    expect(evs(g, 'move')).toEqual([]);
    act(g, 'move');
    act(g, keys(g)[0]); act(g, 'done'); act(g, 'loc:bf0');
    expect(g.s.showdown).not.toBeNull();
    expect(keys(g)).toEqual(['pass']);
  });
});
