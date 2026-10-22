import { describe, expect, it } from 'vitest';
import { concede } from '../../src/game/index.ts';
import { setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, endTurn, evs, keys, put, reask, settle, start } from './helpers/scenario.ts';

/*
 * The turn, phases, priority, cleanups and scoring of a Seraphine mirror
 * with card abilities off (M1.1): Spec C §14 items 1–7, 13, 18, 20–21 and
 * Spec G §13 items 10–13 and 18, by rule number.
 */

describe('Spec C §14: the turn', () => {
  it('[315–317] [319.2] phases run in order, each transition making a cleanup outstanding first', () => {
    const g = start(1);
    const phases = evs(g, 'phase').map((e) => `${e.phase}/${e.step}`);
    expect(phases).toEqual(['awaken/none', 'beginning/beginningStep', 'beginning/scoring', 'channel/none', 'draw/none',
      'main/none']);
    endTurn(g);
    const after = evs(g, 'phase').slice(6).map((e) => `${e.phase}/${e.step}`);
    expect(after).toEqual(['ending/endingStep', 'ending/expiration', 'awaken/none', 'beginning/beginningStep',
      'beginning/scoring', 'channel/none', 'draw/none', 'main/none']);
    expect(evs(g, 'turnStart').map((e) => [e.n, e.p])).toEqual([[1, 0], [2, 1]]);
    expect(g.s.turn).toMatchObject({ n: 2, player: 1, phase: 'main', priority: 1 });
  });

  it('[315.3.b] [487.7] [315.4.b] channel 2, the second player 3 on their first Channel Phase only; both draw on turn 1', () => {
    const g = start(2);
    expect(g.s.players[0].base).toHaveLength(2);
    expect(g.s.players[0].hand).toHaveLength(5);                    // 4 + the turn-1 draw: no skip in a Duel
    endTurn(g);
    expect(g.s.players[1].base).toHaveLength(3);
    expect(g.s.players[1].hand).toHaveLength(5);
    expect(evs(g, 'channel').map((e) => [e.p, e.objs.length, e.rule])).toEqual([[0, 2, '315.3.b'], [1, 3, '487.7']]);
    endTurn(g);
    endTurn(g);
    expect(g.s.players[1].base).toHaveLength(5);                    // 3 + 2
    expect(g.s.history.channelPhasesTaken).toEqual([2, 2]);
  });

  it('[315.1.b] Awaken readies only the Turn Player\'s objects', () => {
    const g = start(3);
    const mine = put(g, 'meticulous-restorationist', 0, base(0), { exhausted: true });
    const theirs = put(g, 'meticulous-restorationist', 1, base(1), { exhausted: true });
    reask(g);
    endTurn(g);
    expect(g.s.objects[theirs].exhausted).toBe(false);
    expect(g.s.objects[mine].exhausted).toBe(true);
    expect(evs(g, 'ready').at(-1)?.rule).toBe('315.1.b');
  });

  it('[312.2.a] [316.5.b] only the Turn Player gets priority, and only in their Main Phase', () => {
    const g = start(4);
    endTurn(g);
    endTurn(g);
    const asked = evs(g, 'deciding').filter((e) => e.stub.kind === 'priority');
    expect(asked.length).toBeGreaterThan(2);
    let turnPlayer = 0;
    for (const e of g.events) {
      if (e.k === 'turnStart') turnPlayer = e.p;
      if (e.k === 'deciding' && e.stub.kind === 'priority') expect(e.stub.player).toBe(turnPlayer);
    }
  });

  it('[316.3] [167] the Main Phase empties both Rune Pools; [317.2.d] so does the end of turn', () => {
    const g = start(5);
    setField(g.s, g.s.players[1].pool, 'energy', 3);
    setField(g.s, g.s.players[0].pool, 'energy', 2);
    reask(g);
    act(g, 'end');
    expect(g.s.players.map((p) => p.pool.energy)).toEqual([0, 0]);
    expect(evs(g, 'pool').map((e) => e.rule)).toContain('317.2.d');
    setField(g.s, g.s.players[0].pool, 'energy', 1);                 // floated during P1's turn
    endTurn(g);
    expect(evs(g, 'pool').filter((e) => e.rule === '316.3' || e.rule === '317.2.d').length).toBeGreaterThan(1);
  });

  it('[315.4.b.1–2] [432.2] an empty Main Deck burns out: trash shuffled back, opponent +1, then the draw', () => {
    const g = start(6);
    const deck = g.s.players[1].deck.slice();
    for (const id of deck) {                                         // move P1's deck to their trash
      g.s.players[1].deck.splice(g.s.players[1].deck.indexOf(id), 1);
      g.s.players[1].trash.push(id);
      g.s.objects[id].zone = { z: 'trash', p: 1 };
      g.s.objects[id].knownBy = 3;
    }
    reask(g);
    endTurn(g);
    expect(evs(g, 'burnOut').map((e) => e.p)).toEqual([1]);
    expect(g.s.players[0].points).toBe(1);
    expect(g.s.players[1].hand).toHaveLength(5);
    expect(g.s.players[1].deck).toHaveLength(deck.length - 1);
    expect(g.s.players[1].trash).toHaveLength(0);
  });

  it('[432.3.c.1] repeated burn-outs in one draw win at once, without a cleanup', () => {
    const g = start(7);
    for (const z of ['deck', 'trash'] as const) {
      for (const id of g.s.players[1][z].slice()) {
        delete g.s.objects[id];
        g.s.players[1][z].splice(g.s.players[1][z].indexOf(id), 1);
      }
    }
    setField(g.s, g.s.players[0], 'points', 6);
    reask(g);
    act(g, 'end');
    expect(evs(g, 'burnOut')).toHaveLength(2);
    expect(g.s.result).toMatchObject({ winner: 0, reason: 'burnout', rule: '432.3.c.1' });
  });
});

describe('Spec C §14: cleanups, showdowns, control', () => {
  it('[323.4] [321] lethal damage kills in the next cleanup; [317.2.b] the ending cleanup heals the rest', () => {
    const g = start(8);
    const dead = put(g, 'meticulous-restorationist', 1, base(1), { damage: 2 });
    const hurt = put(g, 'heimerdinger-academy-instructor', 1, base(1), { damage: 2 });
    reask(g);
    act(g, 'end');                                                   // the next cleanup runs on the way
    expect(g.s.objects[dead]).toBeUndefined();
    expect(g.s.players[1].trash.map((id) => g.s.objects[id].def)).toContain('meticulous-restorationist');
    expect(g.s.log.deaths.length + evs(g, 'kill').length).toBeGreaterThan(0);
    expect(g.s.objects[hurt].damage).toEqual([]);
  });

  it('[344.2] [345] [348.2.a] moving to an empty battlefield: a showdown, Focus to the mover, then control and a Conquer', () => {
    const g = start(9);
    const u = put(g, 'meticulous-restorationist', 0, base(0));
    reask(g);
    act(g, 'move');                                                  // one unit: picked and confirmed on its own
    act(g, 'loc:bf1');
    expect(g.s.showdown).toEqual({ bf: 1, kind: 'nonCombat' });
    expect(g.s.pending).toMatchObject({ player: 0, kind: 'priority' });
    expect(g.s.turn.focus).toBe(0);
    expect(g.s.objects[u]).toMatchObject({ exhausted: true, zone: { z: 'bf', bf: 1 }, moves: 1 });
    expect(g.s.bfs[1].contested).toBe(0);
    act(g, 'pass');
    expect(g.s.pending).toMatchObject({ player: 1, kind: 'priority' });   // [347.2.b]
    act(g, 'pass');                                                  // [347.2.a] everyone passed
    expect(g.s.showdown).toBeNull();
    expect(g.s.bfs[1]).toMatchObject({ controller: 0, contested: null, scoredBy: 1 });
    expect(g.s.players[0].points).toBe(1);
    expect(evs(g, 'score').map((e) => [e.how, e.point])).toEqual([['conquer', true]]);
    expect(g.s.pending).toMatchObject({ player: 0, kind: 'priority' });
  });

  it('[472] a battlefield scores once per turn: lost and re-conquered, no second point', () => {
    const g = start(10);
    put(g, 'meticulous-restorationist', 0, base(0));
    reask(g);
    act(g, 'move'); act(g, 'loc:bf0'); act(g, 'pass'); act(g, 'pass'); settle(g);
    expect(g.s.players[0].points).toBe(1);
    // Taken away and won back the same turn.
    for (const id of g.s.bfs[0].here.slice()) setField(g.s, g.s.objects[id], 'exhausted', false);
    reask(g);
    act(g, 'move');                                                  // one unit, one way to go: base
    expect(g.s.bfs[0].controller).toBeNull();                       // [323.5] empty, Open: control lost
    for (const id of g.s.players[0].base) setField(g.s, g.s.objects[id], 'exhausted', false);
    reask(g);
    const u = g.s.players[0].base.find((id) => g.s.objects[id].def === 'meticulous-restorationist')!;
    act(g, 'move');
    if (keys(g).includes(`u:${u}`)) { act(g, `u:${u}`); act(g, 'done'); }
    act(g, 'loc:bf0'); act(g, 'pass'); act(g, 'pass'); settle(g);
    expect(g.s.bfs[0].controller).toBe(0);
    expect(g.s.players[0].points).toBe(1);
    expect(evs(g, 'score')).toHaveLength(1);
  });

  it('[315.2.b] [471.2] the Scoring Step Holds each controlled battlefield, in the order the Turn Player picks', () => {
    const g = start(11);
    put(g, 'meticulous-restorationist', 1, bf(0));
    put(g, 'meticulous-restorationist', 1, bf(1));
    control(g, 0, 1);
    control(g, 1, 1);
    reask(g);
    act(g, 'end');
    expect(g.s.pending).toMatchObject({ player: 1, kind: 'chooseBattlefield' });
    act(g, 'bf1');
    expect(evs(g, 'score').map((e) => [e.bf, e.how])).toEqual([[1, 'hold'], [0, 'hold']]);
    expect(g.s.players[1].points).toBe(2);
  });

  it('[473.1.a.1] a Hold gives the 8th point; [323.1] [194.2] the cleanup after it declares the winner', () => {
    const g = start(12);
    put(g, 'meticulous-restorationist', 1, bf(0));
    control(g, 0, 1);
    setField(g.s, g.s.players[1], 'points', 7);
    reask(g);
    act(g, 'end');
    expect(g.s.result).toEqual({ winner: 1, reason: 'score', rule: '323.1', turn: 2 });
    expect(g.s.pending).toBeNull();
  });

  it('[194.2.b] at or above the Victory Score with a tie, play goes on', () => {
    const g = start(13);
    setField(g.s, g.s.players[0], 'points', 8);
    setField(g.s, g.s.players[1], 'points', 8);
    reask(g);
    act(g, 'end');
    expect(g.s.result).toBeNull();
  });

  it('[473.1.b.1] at 7, a Conquer without every battlefield scored draws a card instead; with both, the 8th point', () => {
    const g = start(14);
    setField(g.s, g.s.players[0], 'points', 7);
    put(g, 'meticulous-restorationist', 0, base(0));
    put(g, 'meticulous-restorationist', 0, base(0));
    reask(g);
    const hand = g.s.players[0].hand.length;
    act(g, 'move');
    const [a] = keys(g).filter((k) => k.startsWith('u:'));
    act(g, a); act(g, 'done'); act(g, 'loc:bf0'); act(g, 'pass'); act(g, 'pass'); settle(g);
    expect(g.s.players[0].points).toBe(7);
    expect(g.s.players[0].hand).toHaveLength(hand + 1);
    expect(evs(g, 'score').at(-1)).toMatchObject({ how: 'conquer', point: false, drewInstead: true });
    act(g, 'move'); act(g, 'loc:bf1'); act(g, 'pass'); act(g, 'pass'); settle(g);
    expect(evs(g, 'score').at(-1)).toMatchObject({ bf: 1, point: true });
    expect(g.s.result).toMatchObject({ winner: 0, reason: 'score' });
  });

  it('[650] [651.1] a player may concede at any time, even during the other player\'s showdown', () => {
    const g = start(15);
    put(g, 'meticulous-restorationist', 0, base(0));
    reask(g);
    act(g, 'move'); act(g, 'loc:bf0');
    act(g, 'pass');
    expect(g.s.pending?.player).toBe(1);
    const r = concede(g.s, 0, { check: true });
    expect(r.state.result).toMatchObject({ winner: 1, reason: 'concede', rule: '650' });
    expect(r.state.pending).toBeNull();
  });
});
