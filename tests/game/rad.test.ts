import { describe, expect, it } from 'vitest';
import { hasKeyword, keywordOf, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, keys, put, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, hide, moveTo, nextTurn, onBoard, opt, RICH, table } from './helpers/cards.ts';

/*
 * The Radiance Evelynn Showdown Deck (the Seraphine deck is in
 * seraphine.test.ts): one behaviour test per card at least (cards/defs/rad.ts).
 */

/** A table where P0 holds bf0 with a unit there, so cards can be hidden at it. */
function hiding(seed: number, o: Parameters<typeof table>[1] = {}) {
  const g = table(seed, o);
  control(g, 0, 0);
  put(g, 'shipyard-skulker', 0, bf(0));
  return g;
}

describe('Radiance: Evelynn', () => {
  it('Evelynn, Agony\'s Embrace: once each turn, playing a card from face down draws 1 (and discards 1 off-turn)', () => {
    const g = hiding(401, { legends: ['evelynn-agonys-embrace'] });
    const a = hide(g, 'consult-the-past', 0);
    nextTurn(g);
    const h = handSize(g);
    reask(g);
    act(g, `play:${a}`);
    drive(g);
    expect(handSize(g)).toBe(h + 3);                                   // its 2 and the legend's 1
  });

  it('Evelynn, Consuming: Ambush; when you play a card from face down, ready me, +1 this turn', () => {
    const g = hiding(402);
    const e = put(g, 'evelynn-consuming', 0, base(0), { exhausted: true });
    const a = hide(g, 'consult-the-past', 0);
    nextTurn(g);
    setField(g.s, g.s.objects[e], 'exhausted', true);
    reask(g);
    act(g, `play:${a}`);
    drive(g);
    expect([g.s.objects[e].exhausted, mightOf(g.s, e)]).toEqual([false, 6]);
  });

  it('Evelynn, In Control: Disarm; when I hold with a facedown card of yours here, score 1 point', () => {
    const g = hiding(403);
    put(g, 'evelynn-in-control', 0, bf(0));
    hide(g, 'consult-the-past', 0);
    nextTurn(g);
    expect(g.s.players[0].points).toBe(2);                             // the hold and the ability
  });

  it('Last Caress: the next unit you play this turn may go to any battlefield, and is buffed', () => {
    const g = table(404);
    cast(g, 'last-caress');
    const id = inHand(g, 'shipyard-skulker');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toEqual(expect.arrayContaining(['loc:bf0', 'loc:bf1']));
    drive(g, ['loc:bf1']);
    const u = onBoard(g, 'shipyard-skulker', 0)[0];
    expect([g.s.objects[u].zone, g.s.objects[u].buffs]).toEqual([bf(1), 1]);
  });

  it('Bushwhack Trap: Deploy; its battlefield\'s controller may hide an additional card there', () => {
    const g = hiding(405);
    put(g, 'bushwhack-trap', 0, bf(0));
    hide(g, 'consult-the-past', 0);
    hide(g, 'pakaa-cub', 0);
    expect(g.s.bfs[0].facedown).toHaveLength(2);
    const third = inHand(g, 'back-off');
    reask(g);
    expect(keys(g)).not.toContain(`hide:${third}`);
  });

  it('K\'Sante, Courageous: Accelerate, Shield 2; when I hold, channel 1 rune', () => {
    const g = table(406);
    control(g, 0, 0);
    const k = put(g, 'ksante-courageous', 0, bf(0));
    expect(keywordOf(g.s, k, 'shield')).toBe(2);
    nextTurn(g);
    expect(evs(g, 'channel').some((e) => e.rule === '431')).toBe(true);
  });

  it('Gutter Guardian: Hidden; Show Off a card with Hidden; if you showed off, Add [A]', () => {
    const g = table(407);
    const shown = inHand(g, 'pakaa-cub');
    const id = inHand(g, 'gutter-guardian');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toContain(`pick:${shown}`);
    expect(keys(g)).not.toContain(`pick:${g.s.players[0].hand[0]}`);
    drive(g, [`pick:${shown}`]);
    expect(g.s.players[0].pool.universal).toBe(1);
  });

  it('Demon Shade: Hidden; a friendly unit moves to an open battlefield, or gets Ganking if there is none', () => {
    const g = table(408);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'demon-shade', ['mode:0', 'loc:bf1']);
    expect(g.s.objects[u].zone).toEqual(bf(1));
    const g2 = table(418);
    control(g2, 0, 0);
    control(g2, 1, 1);
    const v = put(g2, 'shipyard-skulker', 0, bf(0));
    put(g2, 'shipyard-skulker', 1, bf(1));
    const id = inHand(g2, 'demon-shade');
    reask(g2);
    act(g2, `play:${id}`);
    opt(g2, `t:${v}`);
    expect(keys(g2)).not.toContain('mode:0');                          // no open battlefield
    drive(g2, ['mode:1']);
    expect(hasKeyword(g2.s, v, 'ganking')).toBe(true);
  });

  it('The Good Stuff: Deploy; discard 1 then draw 3 when played; returns to hand when you hold here', () => {
    const g = table(409);
    const h = handSize(g);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'the-good-stuff', ['loc:bf0']);
    expect(handSize(g)).toBe(h + 2);                                   // +1 −1 +3 −1 played
    nextTurn(g);
    expect(g.s.players[0].hand.map((x) => g.s.objects[x].def)).toContain('the-good-stuff');
  });

  it('Elnuk Herd: Hidden; a friendly unit +3 this turn, then recycle me if played from face down', () => {
    const g = hiding(410);
    const fd = hide(g, 'elnuk-herd', 0);
    nextTurn(g);
    const away = put(g, 'shipyard-skulker', 0, base(0));
    const u = g.s.bfs[0].here[0];
    reask(g);
    act(g, `play:${fd}`);
    expect(keys(g)).not.toContain(`t:${away}`);                        // its play effect chooses at its battlefield [811.1.d.3]
    drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
    expect(onBoard(g, 'elnuk-herd', 0)).toHaveLength(0);
  });

  it('Reckless Innovator: when I become exhausted, a Gold token or pay [P] to draw 1', () => {
    const g = table(411);
    const r = put(g, 'reckless-innovator', 0, base(0));
    moveTo(g, [r], 0);
    drive(g, ['mode:0']);
    expect(onBoard(g, 'gold', 0)).toHaveLength(1);
  });

  it('Wind and Ghosts: a unit at a battlefield: banished if 3 Might or less, else returned to hand', () => {
    const g = table(412);
    control(g, 1, 1);
    const small = put(g, 'shipyard-skulker', 1, bf(1));
    const big = put(g, 'mega-mech', 1, bf(1));
    cast(g, 'wind-and-ghosts', [`t:${small}`]);
    runes(g, 0, RICH);
    cast(g, 'wind-and-ghosts', [`t:${big}`]);
    expect(g.s.players[1].banish.map((x) => g.s.objects[x].def)).toEqual(['shipyard-skulker']);
    expect(g.s.players[1].hand.map((x) => g.s.objects[x].def)).toContain('mega-mech');
  });

  it('Sneaky Zeebles: when I conquer, Add [A]', () => {
    const g = table(413);
    const z = put(g, 'sneaky-zeebles', 0, base(0));
    moveTo(g, [z], 0);
    drive(g);
    expect(g.s.players[0].pool.universal).toBe(1);
  });

  it('Hold \'Em: costs [2] less once you played a unit or gear to a battlefield this turn; +3 this turn', () => {
    const g = table(414);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const a = inHand(g, 'hold-em');
    reask(g);
    act(g, `play:${a}`);
    if (g.s.pending?.kind === 'target') act(g, g.s.pending.options[0].key);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
    act(g, 'back');
    cast(g, 'shipyard-skulker', ['loc:bf0']);
    reask(g);
    act(g, `play:${a}`);
    if (g.s.pending?.kind === 'target') act(g, g.s.pending.options[0].key);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
  });

  it('The Water\'s Wage: a Gold token exhausted; on your turn from face down, three ready Gold tokens', () => {
    const g = hiding(415);
    cast(g, 'the-waters-wage');
    expect(onBoard(g, 'gold', 0).filter((x) => g.s.objects[x].exhausted)).toHaveLength(1);
    const fd = hide(g, 'the-waters-wage', 0);
    nextTurn(g);
    reask(g);
    act(g, `play:${fd}`);
    drive(g);
    expect(onBoard(g, 'gold', 0)).toHaveLength(4);
  });

  it('Momentary Companion: Hidden; played on an opponent\'s turn, it gets Temporary', () => {
    const g = hiding(416);
    const fd = hide(g, 'momentary-companion', 0);
    reask(g);
    act(g, 'end');
    drive(g);
    // The opponent's turn: P0 plays it from face down with [Reaction] in a chain.
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const opp = inHand(g, 'discipline', 1);
    reask(g);
    act(g, `play:${opp}`);
    opt(g, `t:${foe}`);
    drive(g, [`play:${fd}`]);
    const m = onBoard(g, 'momentary-companion', 0)[0];
    expect(hasKeyword(g.s, m, 'temporary')).toBe(true);
  });

  it('Suave Negotiator: you and an opponent each draw 1', () => {
    const g = table(417);
    const h0 = handSize(g, 0), h1 = handSize(g, 1);
    cast(g, 'suave-negotiator');
    expect([handSize(g, 0), handSize(g, 1)]).toEqual([h0 + 1, h1 + 1]);
  });

  it('Wrath of the Freljord: I enter ready; Shield 3', () => {
    const g = table(419);
    cast(g, 'wrath-of-the-freljord');
    const w = onBoard(g, 'wrath-of-the-freljord', 0)[0];
    expect([g.s.objects[w].exhausted, keywordOf(g.s, w, 'shield')]).toEqual([false, 3]);
  });

  it('Black Market Broker: when you play a card from face down, a Gold token', () => {
    const g = hiding(420);
    put(g, 'black-market-broker', 0, base(0));
    const fd = hide(g, 'pakaa-cub', 0);
    nextTurn(g);
    reask(g);
    act(g, `play:${fd}`);
    drive(g);
    expect(onBoard(g, 'gold', 0)).toHaveLength(1);
  });

  it('Siren\'s Song: move an enemy unit that moved this turn', () => {
    const g = table(421, { first: 1 });
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const song = inHand(g, 'sirens-song', 0);
    reask(g);
    act(g, 'move');
    opt(g, `u:${foe}`);
    opt(g, 'done');
    opt(g, 'loc:bf0');
    drive(g, [`play:${song}`, 'loc:base']);
    expect(g.s.objects[foe].zone).toEqual(base(1));
  });

  it('Siren of the Shallows: Disarm and Ganking', () => {
    const g = table(422);
    const s = put(g, 'siren-of-the-shallows', 0, base(0));
    expect([hasKeyword(g.s, s, 'disarm'), hasKeyword(g.s, s, 'ganking')]).toEqual([true, true]);
  });

  it('Bandle Scouts\' Academy: when you hide a card here, a Gold token', () => {
    const g = hiding(423, { bfs: ['bandle-scouts-academy'] });
    hide(g, 'pakaa-cub', 0);
    expect(onBoard(g, 'gold', 0)).toHaveLength(1);
  });

  it('Rakelstake: the first time each player plays a unit or gear here each turn, they Predict', () => {
    const g = table(424, { bfs: ['rakelstake'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'shipyard-skulker', ['loc:bf0']);
    const looks = evs(g, 'look').length;
    expect(looks).toBeGreaterThan(0);
    cast(g, 'shipyard-skulker', ['loc:bf0']);
    expect(evs(g, 'look').length).toBe(looks);
  });

  it('Bandle Tree: any player may hide an additional card here', () => {
    const g = hiding(425, { bfs: ['bandle-tree'] });
    hide(g, 'pakaa-cub', 0);
    hide(g, 'pakaa-cub', 0);
    expect(g.s.bfs[0].facedown).toHaveLength(2);
  });

  it('Pakaa Cub: Hidden (a unit played from face down goes to its battlefield)', () => {
    const g = hiding(426);
    const fd = hide(g, 'pakaa-cub', 0);
    nextTurn(g);
    reask(g);
    act(g, `play:${fd}`);
    drive(g);
    expect(onBoard(g, 'pakaa-cub', 0).map((x) => g.s.objects[x].zone)).toEqual([bf(0)]);
  });
});

void moveObject;
