import { describe, expect, it } from 'vitest';
import { setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, keys, put, reask, settle, start, type Game } from './helpers/scenario.ts';

/*
 * Combat with vanilla units (M1.1; the battlefields' triggers let go by): Spec G §13 items 1, 6 (D1, D2, D7,
 * D13), 7, 8, 13, 19, 20 and the damage assignment of §5.10.4, by rule.
 *
 * Every scenario: P0's turn 1, P0 attacks battlefield 0, which P1 controls.
 */

/** P0's attackers in base, P1's defenders at bf0 (controlled by P1); P0
    moves every attacker in and both players pass the combat showdown. */
function attack(seed: number, attackers: string[], defenders: string[], o: { defenderDamage?: number } = {}) {
  const g = start(seed);
  const a = attackers.map((def) => put(g, def, 0, base(0)));
  const d = defenders.map((def) => put(g, def, 1, bf(0), { damage: o.defenderDamage }));
  control(g, 0, 1);
  reask(g);
  act(g, 'move');
  for (const id of a) if (keys(g).includes(`u:${id}`)) act(g, `u:${id}`);
  if (keys(g).includes('done')) act(g, 'done');
  if (keys(g).includes('loc:bf0')) act(g, 'loc:bf0');
  return { g, a, d };
}

const passShowdown = (g: Game) => {
  expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0 });   // the Attacker has Focus [466.2.c.1.a]
  act(g, 'pass');
  act(g, 'pass');
  settle(g);                                                         // the battlefields' triggers go by
};

describe('Spec G §13: combat', () => {
  it('[323.12] [466.2.c] moving into enemy units opens a combat: the mover attacks, holds Focus, units designated', () => {
    const { g, a, d } = attack(1, ['heimerdinger-academy-instructor'], ['meticulous-restorationist']);
    expect(g.s.combat).toMatchObject({ bf: 0, attacker: 0, defender: 1, openedNewShowdown: true, step: 'showdown' });
    expect(g.s.showdown).toEqual({ bf: 0, kind: 'combat' });
    expect(g.s.turn.focus).toBe(0);
    expect(g.s.objects[a[0]].designation).toBe('attacker');
    expect(g.s.objects[d[0]].designation).toBe('defender');
    expect(g.s.bfs[0].contested).toBe(0);
  });

  it('[467.2.c] [468.5.d] attackers left alone win, establish control and Conquer', () => {
    const { g, d } = attack(2, ['heimerdinger-academy-instructor'], ['meticulous-restorationist']);
    passShowdown(g);
    expect(g.s.objects[d[0]]).toBeUndefined();
    expect(evs(g, 'combatResult').at(-1)?.result).toEqual(['won', 'lost']);
    expect(g.s.bfs[0]).toMatchObject({ controller: 0, contested: null });
    expect(g.s.players[0].points).toBe(1);
    expect(g.s.combat).toBeNull();
    expect(Object.values(g.s.objects).every((o) => o.designation === null)).toBe(true);
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0 });
  });

  it('[468.1.a.1–2] [468.3.d] defenders left: every unit heals, attackers are recalled, no result, control stays', () => {
    const { g, a, d } = attack(3, ['heimerdinger-academy-instructor'], ['meticulous-restorationist']);
    setField(g.s, g.s.objects[a[0]], 'stunned', true);              // adds nothing: both sides survive
    const elsewhere = put(g, 'heimerdinger-academy-instructor', 0, base(0), { damage: 1 });
    passShowdown(g);
    expect(g.s.objects[a[0]]).toMatchObject({ zone: { z: 'base', p: 0 }, damage: [], designation: null });
    expect(g.s.objects[d[0]].damage).toEqual([]);
    expect(g.s.objects[elsewhere].damage).toEqual([]);                // all units, at every location
    expect(evs(g, 'recall').at(-1)?.rule).toBe('468.1.a.2');
    expect(evs(g, 'combatResult').at(-1)?.result).toEqual(['noResult', 'noResult']);
    expect(g.s.bfs[0]).toMatchObject({ controller: 1, contested: null });
    expect(g.s.players[0].points).toBe(0);
  });

  it('[468.5.b] both sides wiped out: no result, the battlefield becomes uncontrolled', () => {
    const { g } = attack(4, ['hunting-dog'], ['hunting-dog']);
    passShowdown(g);
    expect(g.s.bfs[0].here).toEqual([]);
    expect(g.s.bfs[0].controller).toBeNull();
    expect(evs(g, 'combatResult').at(-1)?.result).toEqual(['noResult', 'noResult']);
  });

  it('[467.2.c.3] D1: lethal in full, one unit at a time (5 among 3-Might units is 3 + 2)', () => {
    const { g, d } = attack(5, ['heimerdinger-academy-instructor'], ['hunting-dog', 'herald-of-the-emperor', 'hunting-dog']);
    passShowdown(g);
    expect(g.s.pending).toMatchObject({ kind: 'assignNext', player: 0 });
    expect(g.s.pending!.options.map((o) => o.meta?.amount)).toEqual([3, 3, 3]);
    act(g, `a:${d[1]}`);
    expect(g.s.pending!.options.map((o) => o.meta?.amount)).toEqual([2, 2]);
    act(g, `a:${d[2]}`);
    const dealt = evs(g, 'deal').filter((e) => d.includes(e.to));
    expect(dealt.map((e) => [e.to, e.n])).toEqual([[d[1], 3], [d[2], 2]]);
  });

  it('[467.2.c.4] D2: no overkill: units with 1 damage take at most 2 each (2 + 2 + 1)', () => {
    const { g, d } = attack(6, ['heimerdinger-academy-instructor'], ['hunting-dog', 'herald-of-the-emperor', 'hunting-dog'],
      { defenderDamage: 1 });
    passShowdown(g);
    expect(g.s.pending!.options.map((o) => o.meta?.amount)).toEqual([2, 2, 2]);
    act(g, `a:${d[0]}`); act(g, `a:${d[1]}`);                       // the last one is the only choice left
    expect(evs(g, 'deal').filter((e) => d.includes(e.to)).map((e) => e.n)).toEqual([2, 2, 1]);
  });

  it('[815] [826] [467.2.c.6] Tank units first, Backline units last', () => {
    const { g, d } = attack(7, ['heimerdinger-academy-instructor'], ['enthusiastic-promoter', 'hunting-dog',
      'steadfast-outrider']);
    passShowdown(g);                                                 // each tier has one unit: no choice to make
    const hit = (id: number) => evs(g, 'deal').find((e) => e.to === id)?.n;
    expect([hit(d[2]), hit(d[1]), hit(d[0])]).toEqual([3, 2, undefined]);   // Tank 3, then 2 to the plain unit
  });

  it('[467.2.c.4] [467.2.c.10] excess once every unit has lethal: one unit takes it all; several, the player places it', () => {
    const one = attack(8, ['the-empyrean'], ['meticulous-restorationist']);
    passShowdown(one.g);
    expect(one.g.s.combat).toBeNull();
    expect(evs(one.g, 'deal').find((e) => e.to === one.d[0])?.n).toBe(8);
    const two = attack(9, ['the-empyrean'], ['meticulous-restorationist', 'meticulous-restorationist']);
    passShowdown(two.g);
    act(two.g, `a:${two.d[0]}`);
    expect(two.g.s.pending).toMatchObject({ kind: 'assignExcess' });
    act(two.g, `x:${two.d[1]}`);
    act(two.g, 'done');
    const hit = (id: number) => evs(two.g, 'deal').find((e) => e.to === id)?.n;
    expect([hit(two.d[0]), hit(two.d[1])]).toEqual([2, 6]);
  });

  it('[424.1.b] [467.2.a–b] a stunned unit adds 0 to its side\'s total', () => {
    const { g, a, d } = attack(10, ['heimerdinger-academy-instructor'], ['meticulous-restorationist']);
    setField(g.s, g.s.objects[a[0]], 'stunned', true);
    passShowdown(g);
    expect(evs(g, 'deal').some((e) => e.to === d[0])).toBe(false);
    expect(g.s.bfs[0].controller).toBe(1);
  });

  it('[467.2.d] [418.6.c] all combat damage is dealt at once, sources the opposing units, their controller responsible', () => {
    const { g, a, d } = attack(11, ['heimerdinger-academy-instructor'], ['heimerdinger-academy-instructor']);
    passShowdown(g);
    const deals = evs(g, 'deal').filter((e) => e.combat);
    expect(deals).toHaveLength(2);
    expect(deals.find((e) => e.to === d[0])?.sources).toEqual(a);
    expect(deals.find((e) => e.to === a[0])?.sources).toEqual(d);
    expect(g.s.log.deaths.map((x) => x.inCombat)).toEqual([true, true]);
  });
});
