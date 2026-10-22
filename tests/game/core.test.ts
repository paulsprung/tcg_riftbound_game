import { describe, expect, it } from 'vitest';
import { rng as packRng } from '../../src/pack/generate.ts';
import { DEFAULT_RULES, DUEL, type GameSetup } from '../../src/game/config.ts';
import { autoKey, canonical, K, parseKey, type AskSpec } from '../../src/game/core/decisions.ts';
import { emit, emitZone, knowers } from '../../src/game/core/events.ts';
import {
  answer, ask, awaitTasks, call, defineLoop, defineStart, defineSteps, next, ret, takeRet, type FrameOf, type StepTable,
} from '../../src/game/core/frames.ts';
import {
  choose, cloneState, concede, createGame, EngineError, EngineLoopError, ENGINE_VERSION, hashState,
  IllegalOptionError, RecordMismatchError, replay, StaleDecisionError,
  type DeckList, type GameRecord, type GameState, type PlayerId, type StepResult,
} from '../../src/game/index.ts';
import { blankState } from '../../src/game/state/blank.ts';
import { stableJson } from '../../src/game/state/clone.ts';
import { checkInvariants } from '../../src/game/state/invariants.ts';
import {
  append, countDecision, createBattlefield, createObject, mint, moveObject, pushFrame, setField, setInCleanup,
} from '../../src/game/state/mut.ts';
import { random, shuffled, shuffleZone } from '../../src/game/state/rng.ts';
import { Z } from '../../src/game/state/zones.ts';

/*
 * The engine core on a toy game: a made-up setup procedure written the way
 * real procedures are (frames, step tables, ask/answer), so the driver,
 * decisions, events, ids, the RNG and the mutation helpers are tested
 * without the real setup rules.
 */

const deck = (name: string): DeckList => ({
  name, source: 'custom', legend: 'toy-legend', chosenChampion: 'toy-champion', main: [{ def: 'toy-unit', n: 40 }],
  runes: [{ def: 'toy-rune', n: 12 }], battlefields: ['toy-bf-a', 'toy-bf-b', 'toy-bf-c'],
});
const SETUP: GameSetup = { seed: 7, decks: [deck('A'), deck('B')] };
const fresh = (seed = 7) => blankState({ seed, mode: DUEL, rules: DEFAULT_RULES });

/* Which toy procedure createGame() starts, and what the procedures saw. */
let script = 'toy';
let ran: string[] = [];

defineLoop(null, { replace: true });
defineStart((s, _setup, x) => {
  for (const p of [0, 1] as PlayerId[]) {
    createObject(s, { def: 'toy-legend', printing: null, owner: p, zone: Z.legend(p) });
    for (let i = 0; i < 6; i++) createObject(s, { def: `toy-${i}`, printing: null, owner: p, zone: Z.deck(p) });
    shuffleZone(s, { z: 'deck', p });
    emit(s, x, { k: 'shuffle', p, zone: 'deck', count: 6, rule: '114' });
  }
  createBattlefield(s, { def: 'toy-bf-a', printing: null, owner: 0 });
  createBattlefield(s, { def: 'toy-bf-b', printing: null, owner: 1 });
  pushFrame(s, { f: 'custom', handler: script, pc: 0, locals: null });
}, { replace: true });

const HANDLERS: Record<string, StepTable<FrameOf<'custom'>>> = {
  toy: [
    (s, f, x) => {                                   // P0 picks first or second: public, two options
      const key = answer(f);
      if (key === undefined) {
        return ask(s, f, x, { player: 0, kind: 'playOrder', prompt: { t: 'playOrder' }, ctx: { rule: 'TR 407' },
          options: [{ key: K.second }, { key: K.first }], privateOptions: false });
      }
      setField(s, s.turn, 'firstPlayer', key === K.first ? 0 : 1);
      emit(s, x, { k: 'playOrder', first: s.turn.firstPlayer, rule: 'TR 407' });
      return next(f);
    },
    (s, f, x) => {                                   // each player draws 2
      for (const pl of s.players) {
        for (let i = 0; i < 2; i++) {
          const prev = pl.deck[0], before = knowers(s, [prev]);
          const obj = moveObject(s, prev, Z.hand(pl.id));
          emitZone(s, x, { obj, prev, from: Z.deck(pl.id), to: Z.hand(pl.id), why: 'draw', rule: '116', before });
        }
      }
      return next(f);
    },
    (s, f, x) => {                                   // public, one option: answered without asking
      const key = answer(f);
      if (key === undefined) {
        return ask(s, f, x, { player: 0, kind: 'chooseOpponent', prompt: { t: 'chooseOpponent' },
          ctx: { rule: '432.2.c' }, options: [{ key: K.p(1) }], privateOptions: false });
      }
      f.locals = { opponent: key };
      return next(f);
    },
    (s, f, x) => {                                   // private, one option: asked all the same
      const card = s.players[1].hand[0];
      const key = answer(f);
      if (key === undefined) {
        return ask(s, f, x, { player: 1, kind: 'pickCard', prompt: { t: 'pickCard' }, ctx: { rule: '117' },
          options: [{ key: K.pick(card) }], privateOptions: true, back: true });
      }
      const before = knowers(s, [card]);
      const obj = moveObject(s, card, Z.deck(1), { pos: 'bottom', knownBy: 0 });
      emitZone(s, x, { obj, prev: card, from: Z.hand(1), to: Z.deck(1), why: 'mulligan', rule: '117.3', before });
      return next(f);
    },
    () => 'done',
  ],
  waits: [
    (s, f) => {
      append(s, s.turn.tasks, { t: 'expirationCheck' }, { t: 'phase', id: 'draw.draw' }, { t: 'cleanup', v: 'normal' });
      return awaitTasks(f);
    },
    (s) => { ran.push(`resumed with ${s.turn.tasks.length} tasks`); return 'done'; },
  ],
  parent: [
    (s, f) => call(s, f, { f: 'custom', handler: 'child', pc: 0, locals: null }),
    (_s, f) => { ran.push(`child returned ${takeRet(f)}`); return 'done'; },
  ],
  child: [(s, f) => ret(s, f, 42)],
  spin: [() => 'continue'],
  silent: [() => 'waiting'],
};
defineSteps('custom', (s, f, x) => HANDLERS[f.handler][f.pc](s, f, x), { replace: true });
defineSteps('task', (s, f) => {
  ran.push(`${f.task.t === 'phase' ? f.task.id : f.task.t} above ${s.frames.length - 1}`);
  return 'done';
}, { replace: true });
defineSteps('cleanup', (s, f) => { ran.push(`cleanup from epoch ${f.epoch0 === s.epoch}`); return 'done'; },
  { replace: true });

function start(handler: string, setup: GameSetup = SETUP): StepResult {
  script = handler;
  ran = [];
  return createGame(setup, { check: true });
}

/** Answers every pending decision with its first real option. */
function playOut(r: StepResult, o: { roundTrip?: boolean } = {}): { state: GameState; keys: string[]; hashes: string[] } {
  let s = r.state;
  const keys: string[] = [], hashes = [hashState(s)];
  while (s.pending) {
    if (o.roundTrip) s = JSON.parse(JSON.stringify(s)) as GameState;
    const d = s.pending!;
    const key = d.options.find((op) => !op.ui)!.key;
    keys.push(key);
    s = choose(s, { decision: d.id, key }, { check: true }).state;
    hashes.push(hashState(s));
  }
  return { state: s, keys, hashes };
}

describe('the seeded generator (P11)', () => {
  it.each([0, 1, 42, 2 ** 32 - 1, -5])('draws the same numbers as the pack generator from seed %i', (seed) => {
    const s = fresh(seed), pack = packRng(seed);
    for (let i = 0; i < 20; i++) expect(random(s)).toBe(pack());
  });

  it('shuffles reproducibly, and only permutes', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const a = shuffled(fresh(3), items), b = shuffled(fresh(3), items);
    expect(a).toEqual(b);
    expect(a).not.toEqual(items);
    expect(a.slice().sort((x, y) => x - y)).toEqual(items);
  });
});

describe('state/mut.ts (P15)', () => {
  it('bumps the epoch only when a value really changes', () => {
    const s = fresh();
    const e0 = s.epoch;
    expect(setField(s, s.turn, 'phase', 'setup')).toBe(false);
    expect(setField(s, s.turn, 'queue', [])).toBe(false);
    expect(s.epoch).toBe(e0);
    expect(setField(s, s.turn, 'phase', 'awaken')).toBe(true);
    expect(s.epoch).toBe(e0 + 1);
    const q = [{ player: 1 as PlayerId, additional: false }];
    setField(s, s.turn, 'queue', q);
    q[0].player = 0;                                   // the state holds its own copy
    expect(s.turn.queue[0].player).toBe(1);
  });

  it('writes procedural state without bumping the epoch, and only through its own writers', () => {
    const s = fresh();
    const e0 = s.epoch;
    mint(s, 'obj');
    countDecision(s);
    setInCleanup(s, true);
    pushFrame(s, { f: 'custom', handler: 'x', pc: 0, locals: null });
    expect(s.epoch).toBe(e0);
    expect(() => setField(s, s, 'pending', null)).toThrow(EngineError);
    expect(() => setField(s, s.turn, 'inCleanup', false)).toThrow(EngineError);
  });

  it('knows who knows a new card from its zone (§7.2)', () => {
    const s = fresh();
    const mk = (zone: ReturnType<typeof Z.hand>) => createObject(s, { def: 'x', printing: null, owner: 1, zone });
    expect(mk(Z.deck(1)).knownBy).toBe(0);
    expect(mk(Z.hand(1)).knownBy).toBe(0b10);
    expect(mk(Z.trash(1)).knownBy).toBe(0b11);
    expect(mk(Z.base(1)).knownBy).toBe(0b11);
  });

  it('makes a new object for a zone change and keeps it for a move on the board [124]', () => {
    const s = fresh();
    createBattlefield(s, { def: 'bf', printing: null, owner: 0 });
    const card = createObject(s, { def: 'u', printing: 'OGN-1', owner: 0, zone: Z.deck(0) });
    const inHand = moveObject(s, card.id, Z.hand(0));
    expect(inHand).not.toBe(card.id);
    expect(s.objects[card.id]).toBeUndefined();
    expect(s.objects[inHand]).toMatchObject({ card: card.card, def: 'u', printing: 'OGN-1', knownBy: 0b01 });
    const atBase = moveObject(s, inHand, Z.base(0));
    setField(s, s.objects[atBase], 'damage', [{ amount: 2, by: 1, sources: [], combat: false, group: 1 }]);
    const atBf = moveObject(s, atBase, Z.bf(0));
    expect(atBf).toBe(atBase);
    expect(s.objects[atBf].damage).toHaveLength(1);
    expect(s.bfs[0].here).toEqual([atBf]);
    const back = moveObject(s, atBf, Z.hand(0));
    expect(s.objects[back]).toMatchObject({ damage: [], knownBy: 0b11 });   // seen leaving the board
    const hidden = moveObject(s, back, Z.deck(0), { pos: 'bottom' });
    expect(s.objects[hidden].knownBy).toBe(0b01);    // from a hand, unseen: only its owner can tell which card
    const trashed = moveObject(s, s.players[0].deck[0], Z.trash(0));
    const bottom = moveObject(s, trashed, Z.deck(0), { pos: 'bottom' });
    expect(s.objects[bottom].knownBy).toBe(0b11);    // from a public zone to a known position: keeps its bits
    expect(checkInvariants(s)).toEqual([]);
  });

  it('keeps the Champion Zone to one card [108.3.c.1]', () => {
    const s = fresh();
    createObject(s, { def: 'c', printing: null, owner: 0, zone: Z.champion(0) });
    expect(() => createObject(s, { def: 'd', printing: null, owner: 0, zone: Z.champion(0) })).toThrow(EngineError);
  });

  it('re-mints every card of a shuffled deck in the new order, unknown to all (§7.2)', () => {
    const s = fresh();
    const cards = Array.from({ length: 8 }, (_, i) =>
      createObject(s, { def: `c${i}`, printing: null, owner: 0, zone: Z.deck(0), knownBy: 0b11 }));
    const before = s.players[0].deck.slice();
    const after = shuffleZone(s, { z: 'deck', p: 0 });
    expect(s.players[0].deck).toEqual(after);
    expect(after.some((id) => before.includes(id))).toBe(false);
    expect(after).toEqual(after.slice().sort((a, b) => a - b));   // minted top first
    expect(after.map((id) => s.objects[id].knownBy)).toEqual(after.map(() => 0));
    expect(after.map((id) => s.objects[id].card).sort()).toEqual(cards.map((c) => c.card).sort());
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('state/clone.ts', () => {
  it('hashes equal states equally, whatever the key order', () => {
    expect(stableJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    const s = fresh();
    expect(hashState(JSON.parse(JSON.stringify(s)))).toBe(hashState(s));
    expect(hashState(cloneState(s))).toBe(hashState(s));
    setField(s, s.turn, 'phase', 'main');
    expect(hashState(s)).not.toBe(hashState(fresh()));
  });

  it('refuses what JSON cannot carry', () => {
    expect(() => stableJson({ m: new Map() })).toThrow(TypeError);
    expect(() => stableJson({ f: () => 1 })).toThrow(TypeError);
  });
});

describe('option keys (Appendix A)', () => {
  it('parses every form of the grammar', () => {
    expect(parseKey('pass')).toEqual({ head: 'pass' });
    expect(parseKey('play:41')).toEqual({ head: 'play', obj: 41 });
    expect(parseKey('act:12#2')).toEqual({ head: 'act', obj: 12, sub: '2' });
    expect(parseKey('act:12#deflect')).toEqual({ head: 'act', obj: 12, sub: 'deflect' });
    expect(parseKey('hide:-3')).toEqual({ head: 'hide', obj: -3 });
    expect(parseKey('loc:base')).toEqual({ head: 'loc', loc: 'base' });
    expect(parseKey('loc:bf1')).toEqual({ head: 'loc', loc: { bf: 1 } });
    expect(parseKey('bf0')).toEqual({ head: 'bf', n: 0 });
    expect(parseKey('t:33')).toEqual({ head: 't', obj: 33 });
    expect(parseKey('t:item7')).toEqual({ head: 't', item: 7 });
    expect(parseKey('t:p1')).toEqual({ head: 't', player: 1 });
    expect(parseKey('pay:0')).toEqual({ head: 'pay', n: 0 });
    expect(parseKey('pick:57')).toEqual({ head: 'pick', obj: 57 });
    expect(parseKey('pick:seraphine-starry-eyed-songstress')).toEqual({ head: 'pick', def: 'seraphine-starry-eyed-songstress' });
    expect(parseKey('p1')).toEqual({ head: 'p', n: 1 });
    expect(parseKey('n:3')).toEqual({ head: 'n', n: 3 });
    expect(parseKey('name:Poro')).toEqual({ head: 'name', arg: 'Poro' });
    expect(parseKey('neeko:legend2')).toEqual({ head: 'neeko', arg: 'legend2' });
  });

  it('rejects malformed keys', () => {
    for (const k of ['', 'play:', 'play:x', 'loc:bf', 'loc:here', 'act:3', ':x', 'pick:Bad Name', 'bfx', 'pay:1.5']) {
      expect(parseKey(k), k).toBeNull();
    }
  });

  it('builds only keys it can parse', () => {
    const built = [K.play(1), K.act(2, 'deflect'), K.hide(3), K.u(4), K.locBf(1), K.locBase, K.bf(1), K.t(5),
      K.tItem(6), K.tPlayer(1), K.mode(2), K.alt(1), K.req(0), K.ord(0), K.pay(1), K.pick('a-b'), K.pick(7), K.keep(8),
      K.set(9), K.recycle(10), K.n(0), K.p(0), K.a(11), K.x(12), K.dmg(13), K.next(2), K.inst(1), K.name('x'),
      K.pass, K.end, K.done, K.back, K.yes, K.no, K.decline, K.manualPay, K.first, K.second, K.move, K.tank, K.backline];
    expect(built.filter((k) => parseKey(k) === null)).toEqual([]);
  });

  it('lists options in canonical order: kind, then number, then key (§4.2)', () => {
    const keys = ['pass', 'end', 'pay:10', 'play:41', 'move', 'pay:2', 'play:7', 'back', 't:item3', 't:p0', 't:12'];
    expect(canonical(keys.map((key) => ({ key }))).map((o) => o.key))
      .toEqual(['play:7', 'play:41', 'move', 't:12', 't:item3', 't:p0', 'pay:2', 'pay:10', 'pass', 'end', 'back']);
  });

  it('answers only public decisions with one real option by itself (§4.2)', () => {
    const spec = (o: Partial<AskSpec>): AskSpec => ({ player: 0, kind: 'target', prompt: { t: 'x' }, ctx: { rule: '355' },
      options: [{ key: 't:4' }, { key: 'back', ui: true }], privateOptions: false, ...o });
    const auto = (o: Partial<AskSpec>) => { const sp = spec(o); return autoKey(sp, sp.options); };
    expect(auto({})).toBe('t:4');
    expect(auto({ privateOptions: true })).toBeNull();
    expect(auto({ mustAsk: true })).toBeNull();
    expect(auto({ kind: 'priority', options: [{ key: 'pass' }] })).toBeNull();
    expect(auto({ options: [{ key: 't:4' }, { key: 't:5' }] })).toBeNull();
  });
});

describe('the driver (§5.1)', () => {
  it('runs the setup to the first decision', () => {
    const { state: s, events } = start('toy');
    expect(s.pending).toMatchObject({ id: 1, player: 0, kind: 'playOrder', ctx: { rule: 'TR 407' } });
    expect(s.pending!.options.map((o) => o.key)).toEqual(['first', 'second']);
    expect(events.map((e) => e.k)).toEqual(['gameStart', 'shuffle', 'shuffle', 'deciding']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(s.out).toEqual([]);
    expect(s.engine).toBe(ENGINE_VERSION);
  });

  it('resumes the asking frame with the answer, asks private single options, answers public ones', () => {
    const r1 = start('toy');
    const r2 = choose(r1.state, { decision: 1, key: 'second' }, { check: true });
    const s = r2.state;
    expect(s.turn.firstPlayer).toBe(1);
    expect(s.pending).toMatchObject({ id: 2, player: 1, kind: 'pickCard', privateOptions: true, back: true });
    expect(s.pending!.options.map((o) => o.key)).toEqual([K.pick(s.players[1].hand[0]), 'back']);
    expect((s.frames[0] as FrameOf<'custom'>).locals).toEqual({ opponent: 'p1' });   // auto-answered, not asked
    const draws = r2.events.filter((e) => e.k === 'zone');
    expect(draws.map((e) => e.vis)).toEqual([0b01, 0b01, 0b10, 0b10]);               // each draw seen by its drawer
    expect(r2.events.map((e) => e.k)).toEqual(['playOrder', 'zone', 'zone', 'zone', 'zone', 'deciding']);
  });

  it('shows a card leaving a hand face down to its owner only (§7.4)', () => {
    const r = start('toy');
    const s = choose(r.state, { decision: 1, key: 'first' }).state;
    const back = choose(s, { decision: 2, key: s.pending!.options[0].key }).events.find((e) => e.k === 'zone');
    expect(back).toMatchObject({ why: 'mulligan', vis: 0b10, def: expect.stringMatching(/^toy-/) });
  });

  it('rests with no decision once the M0 setup is over', () => {
    const { state: s } = playOut(start('toy'));
    expect(s.pending).toBeNull();
    expect(s.result).toBeNull();
    expect(s.frames).toEqual([]);
    expect(s.players.map((p) => p.hand.length)).toEqual([2, 1]);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('finds a frame stopped without a decision, and a decision that is not the newest (§3.14 item 1)', () => {
    const s = cloneState(start('toy').state);
    s.pending!.id = 0;
    expect(checkInvariants(s)).toEqual(['decision 0 is not the newest one (next.decision 2)']);
    s.pending = null;
    expect(checkInvariants(s)).toEqual(["the 'custom' frame is stopped with no decision pending"]);
  });

  it('never changes the state it is given, unless asked to work in place', () => {
    const s = start('toy').state;
    const h = hashState(s);
    choose(s, { decision: 1, key: 'first' });
    expect(hashState(s)).toBe(h);
    choose(s, { decision: 1, key: 'first' }, { inPlace: true });
    expect(s.pending?.id).toBe(2);
  });

  it('refuses a stale decision or an unknown key', () => {
    const s = start('toy').state;
    expect(() => choose(s, { decision: 2, key: 'first' })).toThrow(StaleDecisionError);
    expect(() => choose(s, { decision: 1, key: 'third' })).toThrow(IllegalOptionError);
  });

  it('is deterministic, and resumes identically from a JSON copy (P4, P11)', () => {
    const a = playOut(start('toy')), b = playOut(start('toy')), c = playOut(start('toy'), { roundTrip: true });
    expect(b.hashes).toEqual(a.hashes);
    expect(c.hashes).toEqual(a.hashes);
    const other = playOut(start('toy', { ...SETUP, seed: 8 }));
    expect(other.hashes[0]).not.toBe(a.hashes[0]);
  });

  it('runs outstanding tasks above a waiting frame, oldest first, then resumes it (fix F2)', () => {
    const { state: s } = start('waits');
    expect(ran).toEqual(['expirationCheck above 1', 'draw.draw above 1', 'cleanup from epoch true',
      'resumed with 0 tasks']);
    expect(s.frames).toEqual([]);
  });

  it('hands a child frame\'s value back to its caller', () => {
    start('parent');
    expect(ran).toEqual(['child returned 42']);
  });

  it('stops a procedure that never finishes, and one that waits without asking', () => {
    expect(() => start('spin')).toThrow(EngineLoopError);
    expect(() => start('silent')).toThrow(/without asking/);
  });

  it('ends a turn with too many decisions as a rules loop (§8 turnDecisionCap)', () => {
    const r = start('toy', { ...SETUP, rules: { turnDecisionCap: 1 } });
    const end = choose(r.state, { decision: 1, key: 'first' }, { check: true });
    expect(end.state.result).toMatchObject({ winner: null, reason: 'loop' });
    expect(end.state.pending).toBeNull();
    expect(end.events.at(-1)?.k).toBe('gameOver');
  });
});

describe('conceding and replaying', () => {
  it('lets a player concede at any time; the other player wins [650]', () => {
    const s = start('toy').state;
    const r = concede(s, 0, { check: true });
    expect(r.state.result).toEqual({ winner: 1, reason: 'concede', rule: '650', turn: 0 });
    expect(r.state.pending).toBeNull();
    expect(r.events.map((e) => e.k)).toEqual(['gameOver']);
    expect(() => choose(r.state, { decision: 1, key: 'first' })).toThrow(StaleDecisionError);
    expect(() => concede(r.state, 1)).toThrow(EngineError);
    expect(() => concede(s, 2 as PlayerId)).toThrow(/P2 is not in the game/);
  });

  const record = (answers: GameRecord['answers'], extra: Partial<GameRecord> = {}): GameRecord => ({
    engine: ENGINE_VERSION, defsHash: '', setup: SETUP, answers,
    meta: { started: '2026-10-21', difficulty: 'normal', humanSeat: 0, aiKnowsList: false }, ...extra,
  });

  it('replays a record to the same state, or to any point of it (§4.9)', () => {
    const played = playOut(start('toy'));
    const answers = played.keys.map((k, i) => ({ d: i + 1, k, by: (i === 0 ? 0 : 1) as PlayerId }));
    expect(hashState(replay(record(answers)).state)).toBe(played.hashes.at(-1));
    expect(hashState(replay(record(answers), { until: 1 }).state)).toBe(played.hashes[1]);
    const conceded = replay(record(answers, { concede: { p: 1, afterAnswer: 1 } }));
    expect(conceded.state.result?.winner).toBe(0);
  });

  it('refuses a record from another engine or one that does not fit the game', () => {
    expect(() => replay(record([], { engine: 'old' }))).toThrow(RecordMismatchError);
    expect(() => replay(record([{ d: 1, k: 'first', by: 1 }]))).toThrow(RecordMismatchError);
  });
});
