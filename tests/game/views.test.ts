import './helpers/setupOnly.ts';
import { describe, expect, it } from 'vitest';
import { K, parseKey, stubOf } from '../../src/game/core/decisions.ts';
import { aliasOf, PLACEHOLDER_DEF, zoneSlot } from '../../src/game/core/redact.ts';
import { blankFill } from '../../src/game/core/view.ts';
import {
  choose, cloneState, concede, createGame, knows, NotImplementedError, observe, viewFor, type GameEvent, type ObservedEvent,
  type PlayerId, type Stub,
} from '../../src/game/index.ts';
import { stableJson } from '../../src/game/state/clone.ts';
import { checkInvariants, checkViews } from '../../src/game/state/invariants.ts';
import { append, pushFrame } from '../../src/game/state/mut.ts';
import { duel, playOut, positions, randomPicker, scripted, type PlayedOut } from './helpers/play.ts';
import { fold, perturb, shapeOf, tableOf } from './helpers/views.ts';

/*
 * Hidden information (§7, §14.5) on every position of setup: views leak
 * nothing, don't change when hidden cards do, and agree with the events
 * each player observed.
 */

const PLAYERS: PlayerId[] = [0, 1];
const zoneEvents = (es: ObservedEvent[]) => es.filter((e) => e.k === 'zone');

/* A spread of setups: random answers, plus the mulligans that recycle 0, 1
   and 2 cards, with either player first. */
const games: [string, PlayedOut][] = [
  ...Array.from({ length: 6 }, (_, i): [string, PlayedOut] => [`random ${i}`, playOut(duel(100 + i), randomPicker(i))]),
  ['two and one', playOut(duel(7, { firstPlayer: 0 }), scripted([(d) => d.options[1].key, (d) => d.options[0].key,
    (d) => d.options[3].key, K.done]))],
  ['keep and two', playOut(duel(8), scripted(['second', K.done, (d) => d.options[0].key, (d) => d.options[2].key]))],
];

describe('§14.5 #1: views show identities only where the viewer knows them', () => {
  it.each(games)('%s: at every position, for both players', (_name, g) => {
    for (const s of positions(g)) expect(checkViews(s)).toEqual([]);
  });

  it('turns unknown cards into positional stubs: hands by index, decks from the top', () => {
    const s = createGame(duel(3, { firstPlayer: 0 })).state;
    const v = viewFor(s, 0);
    expect(v.players[1].hand).toEqual([0, 1, 2, 3].map((i) => aliasOf(zoneSlot({ z: 'hand', p: 1 })!, i)));
    expect(v.players[0].deck.slice(0, 2)).toEqual([aliasOf(1, 0), aliasOf(1, 1)]);       // own deck: secret too
    expect(v.players[0].hand).toEqual(s.players[0].hand);                                  // own hand: real objects
    const stub = v.objects[v.players[1].hand[0]] as Stub;
    expect(stub).toEqual({ id: -(1 + 4 * 256), zone: { z: 'hand', p: 1 }, owner: 1, controller: 1 });
    expect(v.objects[v.players[0].champion!]).toEqual(s.objects[s.players[0].champion!]);   // public zones as they are
  });

  it('hides the RNG and the other player\'s options, and keeps the viewer\'s own decision whole', () => {
    const s = createGame(duel(3, { firstPlayer: 0 })).state;
    const mine = viewFor(s, 0), theirs = viewFor(s, 1);
    expect([mine.rng, theirs.rng]).toEqual([0, 0]);
    expect(mine.pending).toEqual(s.pending);
    expect(mine.opponentDecision).toBeNull();
    expect(theirs.pending).toBeNull();
    expect(theirs.opponentDecision).toEqual({ player: 0, kind: 'mulligan', ctx: { rule: '117' } });
    expect(theirs.me).toBe(1);
  });

  it('hides a mulligan in progress from the other player', () => {
    const s0 = createGame(duel(3, { firstPlayer: 0 })).state;
    const s = choose(s0, { decision: s0.pending!.id, key: s0.pending!.options[0].key }).state;
    expect(s.frames[0]).toMatchObject({ f: 'setup', p: 0, locals: { set: [s0.players[0].hand[0]] } });
    expect(viewFor(s, 0).frames[0]).toMatchObject({ locals: { set: [s0.players[0].hand[0]] } });
    expect(viewFor(s, 1).frames[0]).toMatchObject({ f: 'setup', p: 0, locals: null });
  });

  it('fills stubs with vanilla placeholders for feasibility and explanations (blankFill)', () => {
    const s = createGame(duel(3, { firstPlayer: 0 })).state;
    const filled = blankFill(viewFor(s, 0));
    expect(checkInvariants(filled)).toEqual([]);
    const placeholders = Object.values(filled.objects).filter((o) => o.def === PLACEHOLDER_DEF);
    expect(placeholders).toHaveLength(4 + 35 + 35 + 12 + 12);
    expect(placeholders.every((o) => o.id < 0 && o.card === o.id && !knows(filled, 0, o))).toBe(true);
    expect(filled.players[1].hand.map((id) => filled.objects[id].knownBy)).toEqual([2, 2, 2, 2]);
    expect('me' in filled || 'opponentDecision' in filled).toBe(false);
  });

  it('refuses states whose ObjId paths it doesn\'t know yet, rather than leak through them', () => {
    const s = createGame(duel(3)).state;
    pushFrame(s, { f: 'hide', by: 0, obj: null, bf: null, pc: 0, snap: null });
    expect(() => viewFor(s, 0)).toThrow(NotImplementedError);
  });

  it('[391] carries delayed abilities: their info is aliased like any other ObjId path', () => {
    const s = createGame(duel(3)).state;
    const hidden = s.players[1].deck[0];
    append(s, s.delayed, { id: 1, controller: 0, createdBy: null, createdTurn: 0, ability: null,
      window: { at: 'endOfTurn' }, info: { objs: [hidden] } });
    const v = viewFor(s, 0);
    expect(v.delayed).toHaveLength(1);
    expect((v.delayed[0].info as { objs: number[] }).objs[0]).toBeLessThan(0);   // an alias, never the real id
  });
});

describe('§14.5 #2: views don\'t change when what the viewer can\'t know does', () => {
  it.each(games)('%s: hidden cards swapped, ids and card refs renamed, RNG re-seeded', (_name, g) => {
    positions(g).forEach((s, i) => {
      for (const p of PLAYERS) {
        const { state: t } = perturb(s, p, 31 * i + p + 1);
        expect(checkInvariants(t)).toEqual([]);
        expect(stableJson(t)).not.toBe(stableJson(s));
        expect(stableJson(viewFor(t, p))).toBe(stableJson(viewFor(s, p)));
        expect(JSON.stringify(viewFor(t, p))).toBe(JSON.stringify(viewFor(s, p)));   // the order of keys too
      }
    });
  });

  it('[108.7.d] shows the cards it knows in another player\'s hand first, wherever they arrived', () => {
    const s = createGame(duel(3, { firstPlayer: 0 })).state;
    const hand = s.players[1].hand, slot = zoneSlot({ z: 'hand', p: 1 })!;
    const knowing = (i: number) => {
      const t = cloneState(s);
      t.objects[hand[i]].knownBy = 0b11;                                  // say a reveal showed it to player 0
      expect(checkViews(t)).toEqual([]);
      return viewFor(t, 0).players[1].hand;
    };
    for (const i of [0, 2, 3]) expect(knowing(i)).toEqual([hand[i], aliasOf(slot, 0), aliasOf(slot, 1), aliasOf(slot, 2)]);
    expect(viewFor(s, 1).players[1].hand).toEqual(hand);                  // the owner keeps arrival order
  });
});

describe('§14.5 #3: no link survives a shuffle or a random placement', () => {
  it('[114] leaves no id from before a shuffle in the deck', () => {
    const s = createGame(duel(4)).state;
    for (const pl of s.players) {
      expect(Math.min(...pl.deck)).toBeGreaterThan(Math.max(...pl.legend, pl.champion!));   // all minted by the shuffle
    }
  });

  it('[117.3], [417.5] tells nobody which new card is which after recycling two', () => {
    const s = createGame(duel(4, { firstPlayer: 0 })).state;
    const [a, b] = s.players[0].hand;
    const r1 = choose(s, { decision: s.pending!.id, key: K.set(a) });
    const r2 = choose(r1.state, { decision: r1.state.pending!.id, key: K.set(b) });
    const recycles = r2.events.filter((e): e is Extract<GameEvent, { k: 'zone' }> => e.k === 'zone' && e.why === 'mulligan');
    expect(recycles.map((e) => [e.knew, e.knows])).toEqual([[1, 0], [1, 0]]);
    for (const p of PLAYERS) {
      const seen = zoneEvents(observe(r2.events, p)).filter((e) => e.k === 'zone' && e.why === 'mulligan');
      expect(seen.map((e) => e.k === 'zone' && e.obj)).toEqual([null, null]);
      expect(seen.map((e) => e.k === 'zone' && e.prev !== undefined)).toEqual([p === 0, p === 0]);
    }
    expect(r2.state.objects[a]).toBeUndefined();
    expect(r2.state.objects[b]).toBeUndefined();
  });
});

describe('§14.5 #4: what a player observes of a step doesn\'t depend on hidden cards', () => {
  it.each(games)('%s: the same answer on a perturbed copy gives the same observed events', (_name, g) => {
    g.steps.forEach((st, i) => {
      for (const p of PLAYERS) {
        const { state: t, rename } = perturb(st.before, p, 17 * i + p + 3);
        const obj = parseKey(st.key)?.obj;
        const key = obj === undefined ? st.key : st.key.replace(`:${obj}`, `:${rename(obj)}`);
        const other = choose(t, { decision: t.pending!.id, key });
        expect(observe(other.events, p).map(shapeOf)).toEqual(observe(st.after.events, p).map(shapeOf));
        expect(viewFor(other.state, p).pending?.options.length).toBe(viewFor(st.after.state, p).pending?.options.length);
      }
    });
  });
});

describe('§14.5 #5 (P6): folding the observed events over a view gives the next view', () => {
  it.each(games)('%s: at every step, for both players', (_name, g) => {
    for (const st of g.steps) {
      for (const p of PLAYERS) {
        const before = tableOf(viewFor(st.before, p));
        expect(fold(before, observe(st.after.events, p))).toEqual(tableOf(viewFor(st.after.state, p)));
      }
    }
  });

  it('also across a concession [650]', () => {
    const s = createGame(duel(6)).state;
    const r = choose(s, { decision: s.pending!.id, key: 'first' });
    const end = concede(r.state, 1);
    for (const p of PLAYERS) {
      expect(fold(tableOf(viewFor(r.state, p)), observe(end.events, p))).toEqual(tableOf(viewFor(end.state, p)));
    }
  });
});

describe('§7.4: events per viewer', () => {
  const s = createGame(duel(2, { firstPlayer: 1 }));

  it('shows a draw to its drawer as a card, to the other player as a card back, and its old deck id to nobody', () => {
    const draw = s.events.find((e) => e.k === 'zone' && e.why === 'draw')!;
    expect(draw).toMatchObject({ from: { z: 'deck', p: 1 }, to: { z: 'hand', p: 1 }, knew: 0, knows: 0b10 });
    const [mine] = zoneEvents(observe([draw], 1)), [theirs] = zoneEvents(observe([draw], 0));
    expect(mine).toMatchObject({ obj: s.state.players[1].hand[0], def: expect.any(String) });
    expect(mine).not.toHaveProperty('prev');
    expect(theirs).toEqual({ k: 'zone', obj: null, from: { z: 'deck', p: 1 }, to: { z: 'hand', p: 1 }, why: 'draw',
      seq: draw.seq, group: draw.group, vis: 0b10, rule: '116' });
  });

  it('blanks the cards of a summary for players outside its vis', () => {
    const summary = s.events.find((e) => e.k === 'draw' && e.p === 1)!;
    expect(observe([summary], 1)[0]).toEqual(summary);
    expect(observe([summary], 0)[0]).toMatchObject({ k: 'draw', p: 1, objs: [null, null, null, null] });
  });

  it('passes public events through as they are', () => {
    const pub = s.events.filter((e) => ['gameStart', 'battlefieldsChosen', 'shuffle', 'playOrder', 'deciding'].includes(e.k));
    for (const p of PLAYERS) expect(observe(pub, p)).toEqual(pub);
    const deciding = s.events.find((e) => e.k === 'deciding');
    expect(deciding).toMatchObject({ stub: stubOf(s.state.pending!) });
  });
});
