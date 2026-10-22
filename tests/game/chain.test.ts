import { describe, expect, it } from 'vitest';
import { explainUnavailable, viewFor } from '../../src/game/index.ts';
import { mightOf } from '../../src/game/rules/chars.ts';
import {
  act, base, evs, inHand, keys, put, ready, reask, runes, settle, start, type Game,
} from './helpers/scenario.ts';

/*
 * The chain, priority and Focus (M1.2): Spec C §14 items 8–10, 15–17 and
 * 22, Spec D §8–§10 (timing, finalize, resolution with illegal targets),
 * the interpreter's outcomes, Reactions in showdowns, and the general
 * feasibility filter and explanations.
 */

const chainDefs = (g: Game) => g.s.chain.map((i) => (i.obj !== undefined ? g.s.objects[i.obj].def : i.ability));

/** The items of the cards played, in order (rune Add abilities are items too). */
const cards = (g: Game) => evs(g, 'chainPush').filter((e) => e.kind === 'card').map((e) => e.item);

/** Plays a spell with one target and pays plan 0. */
function cast(g: Game, card: number, target?: number) {
  act(g, `play:${card}`);
  if (target !== undefined && g.s.pending?.kind === 'target') act(g, `t:${target}`);
  act(g, 'pay:0');
}

describe('the chain: finalize, priority, resolve [337–340]', () => {
  it('[337.4] [338] [339] [340.4] newest first: a Reaction resolves before the spell it answered', () => {
    const g = start(21);
    runes(g, 0, ready('mind', 10));
    runes(g, 1, ready('mind', 7));
    const theirs = put(g, 'shipyard-skulker', 1, base(1));
    const mine = put(g, 'shipyard-skulker', 0, base(0));
    const nova = inHand(g, 'supernova', 0);
    const moon = inHand(g, 'moonlight-affliction', 1);
    reask(g);
    cast(g, nova, theirs);
    expect(g.s.chain.map((i) => i.status)).toEqual(['finalized']);   // a spell waits on the chain [359.3]
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0, prompt: { window: 'chain' } });   // [337.4]
    expect(keys(g)).toEqual(['pass']);                               // no Reaction in P0's hand
    act(g, 'pass');
    expect(g.s.turn.passes).toBe(1);
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 1 });   // [339.2]
    expect(keys(g)).toContain(`play:${moon}`);
    cast(g, moon, mine);
    expect(chainDefs(g)).toEqual(['supernova', 'moonlight-affliction']);
    expect(g.s.turn.passes).toBe(0);                                 // an item was added [339.1]
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 1 });   // the newest item's controller [337.4]
    act(g, 'pass');
    act(g, 'pass');                                                  // every player passed in sequence [339.1]
    expect(chainDefs(g)).toEqual(['supernova']);                     // Moonlight Affliction resolved first [340.1]
    expect(mightOf(g.s, mine)).toBe(3 - 10);
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0 });   // [340.4]: Supernova's controller
    const hand = g.s.players[0].hand.length;
    act(g, 'pass');
    act(g, 'pass');
    expect(g.s.chain).toEqual([]);
    expect(g.s.objects[theirs]).toBeUndefined();                     // 10 damage, killed in the next cleanup [323.4]
    expect(g.s.players[0].hand.length).toBe(hand + 2);               // Draw 2
    expect(g.s.players[0].trash.map((id) => g.s.objects[id].def)).toContain('supernova');   // [359.3.d]
    expect(g.s.players[1].trash.map((id) => g.s.objects[id].def)).toContain('moonlight-affliction');
    const [novaItem, moonItem] = cards(g);
    expect(evs(g, 'outcome').map((e) => [e.item, e.instr, e.outcome.o])).toEqual([
      [moonItem, 'b0', 'executed'], [novaItem, 'b0', 'executed'], [novaItem, 'b1', 'executed'],
    ]);
    expect(g.s.log.played.map((r) => r.def)).toEqual(['moonlight-affliction', 'supernova']);   // played at resolution [420.4.a]
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0, prompt: { window: 'main' } });
  });

  it('[359.3.e.6–7] [359.3.e.5] a target that died before resolution: that instruction is ignored, the rest executes', () => {
    const g = start(22);
    runes(g, 0, ready('mind', 17));
    const x = put(g, 'shipyard-skulker', 1, base(1), { damage: 1 });
    const nova = inHand(g, 'supernova', 0);
    const moon = inHand(g, 'moonlight-affliction', 0);
    reask(g);
    cast(g, nova, x);
    expect(keys(g)).toContain(`play:${moon}`);                       // P0 may add a Reaction on their own spell [338.1.a.5]
    cast(g, moon, x);
    act(g, 'pass'); act(g, 'pass');                                  // Moonlight resolves: -10, lethal with 1 damage
    expect(g.s.objects[x]).toBeUndefined();                          // killed in the cleanup between the two [323.4], [321.1]
    const hand = g.s.players[0].hand.length;
    act(g, 'pass'); act(g, 'pass');
    const [nova0] = cards(g);
    expect(evs(g, 'outcome').filter((e) => e.item === nova0).map((e) => e.outcome))
      .toEqual([{ o: 'ignored', why: 'targets' }, { o: 'executed' }]);
    expect(g.s.players[0].hand.length).toBe(hand + 2);
  });

  it('[358.4] [309.1.a] only Reactions join a chain; default-timing cards wait for an Open state', () => {
    const g = start(23);
    runes(g, 0, ready('mind', 20));
    const x = put(g, 'shipyard-skulker', 1, base(1));
    const nova = inHand(g, 'supernova', 0);
    const nova2 = inHand(g, 'supernova', 0);
    const note = inHand(g, 'high-note', 0);
    reask(g);
    expect(keys(g)).toEqual(expect.arrayContaining([`play:${nova}`, `play:${nova2}`, `play:${note}`]));   // own Main, Open
    cast(g, nova, x);
    expect(keys(g)).toContain(`play:${note}`);
    expect(keys(g)).not.toContain(`play:${nova2}`);
    const why = explainUnavailable(viewFor(g.s, 0), nova2);
    expect(why.map((r) => r.rule)).toContain('309.1.a');
  });

  it('[358.5] back on a target choice undoes the spell exactly', () => {
    const g = start(24);
    runes(g, 0, ready('mind', 10));
    const x = put(g, 'shipyard-skulker', 1, base(1));
    const y = put(g, 'shipyard-skulker', 0, base(0));
    const nova = inHand(g, 'supernova', 0);
    reask(g);
    act(g, `play:${nova}`);
    expect(g.s.pending).toMatchObject({ kind: 'target', back: true });
    expect(keys(g)).toEqual(expect.arrayContaining([`t:${y}`, `t:${x}`, 'back']));
    act(g, 'back');
    expect(g.s.chain).toEqual([]);
    expect(g.s.players[0].hand).toContain(nova);
    expect(g.s.pending).toMatchObject({ kind: 'priority', prompt: { window: 'main' } });
  });

  it('[355.16] [403.3] a spell without a legal target is not offered, and the explanation says why', () => {
    const g = start(25);
    runes(g, 0, ready('mind', 10));
    const nova = inHand(g, 'supernova', 0);
    reask(g);
    expect(Object.values(g.s.objects).some((o) => ['base', 'bf'].includes(o.zone.z) && o.def !== 'mind-rune'
      && g.s.bfs.every((b) => b.obj !== o.id) && o.zone.z !== 'legend')).toBe(false);   // no unit anywhere
    expect(keys(g)).not.toContain(`play:${nova}`);
    expect(explainUnavailable(viewFor(g.s, 0), nova).map((r) => r.rule)).toContain('355.16');
  });
});

describe('showdowns: Focus and Reactions [345–348]', () => {
  it('[308.1.a] [340.2.a] [348] a Reaction in a showdown; when its chain empties, Focus passes on', () => {
    const g = start(26);
    runes(g, 0, ready('mind', 6));
    const mover = put(g, 'shipyard-skulker', 0, base(0));
    const x = put(g, 'shipyard-skulker', 1, base(1));
    const note = inHand(g, 'high-note', 0);
    const nova = inHand(g, 'supernova', 0);
    reask(g);
    act(g, 'move'); if (keys(g).includes(`u:${mover}`)) { act(g, `u:${mover}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    settle(g);
    expect(g.s.showdown).toEqual({ bf: 0, kind: 'nonCombat' });
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 0, prompt: { window: 'showdown' } });
    expect(keys(g)).toContain(`play:${note}`);                       // [Reaction] opens a chain in a showdown [308.1.a]
    expect(keys(g)).not.toContain(`play:${nova}`);                   // no Action or Reaction
    act(g, 'pass');                                                  // Focus to P1 [347.2.b]
    expect(g.s.turn).toMatchObject({ focus: 1, focusPasses: 1 });
    act(g, 'pass');                                                  // both passed in sequence: closes [348]
    settle(g);
    expect(g.s.showdown).toBeNull();
    expect(g.s.bfs[0].controller).toBe(0);
    void x;
  });

  it('[348] playing in a showdown resets the Focus passes; [340.2.a] Focus moves on after the spell', () => {
    const g = start(27);
    runes(g, 0, ready('mind', 6));
    const mover = put(g, 'shipyard-skulker', 0, base(0));
    const x = put(g, 'shipyard-skulker', 1, base(1));
    const note = inHand(g, 'high-note', 0);
    reask(g);
    act(g, 'move'); if (keys(g).includes(`u:${mover}`)) { act(g, `u:${mover}`); act(g, 'done'); }
    act(g, 'loc:bf0');
    settle(g);
    expect(g.s.turn.focus).toBe(0);
    cast(g, note, x);
    expect(g.s.turn.focusPasses).toBe(0);
    expect(g.s.turn.chainOrigin).toBe('card');
    act(g, 'pass'); act(g, 'pass');                                  // High Note resolves
    const exhausted = [...g.s.players[0].base, ...g.s.bfs.flatMap((b) => b.here)]
      .filter((id) => g.s.objects[id].controller === 0 && g.s.objects[id].exhausted && g.s.objects[id].def === 'shipyard-skulker');
    expect(mightOf(g.s, x)).toBe(3 - exhausted.length);              // X read at resolution [479.4.b]
    expect(g.s.chain).toEqual([]);
    expect(g.s.turn.focus).toBe(1);                                  // [340.2.a]
    expect(g.s.pending).toMatchObject({ kind: 'priority', player: 1, prompt: { window: 'showdown' } });
    act(g, 'pass'); act(g, 'pass');
    settle(g);
    expect(g.s.showdown).toBeNull();
  });

  it('[317.2.c] "this turn" Might effects expire in the ending cleanup', () => {
    const g = start(28);
    runes(g, 0, ready('mind', 7));
    const x = put(g, 'shipyard-skulker', 1, base(1));
    const moon = inHand(g, 'moonlight-affliction', 0);
    reask(g);
    cast(g, moon, x);
    act(g, 'pass'); act(g, 'pass');
    expect(mightOf(g.s, x)).toBe(-7);
    expect(g.s.effects).toHaveLength(1);
    act(g, 'end');
    expect(g.s.effects).toEqual([]);
    expect(mightOf(g.s, x)).toBe(3);
  });
});
