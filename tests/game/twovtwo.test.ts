import { describe, expect, it } from 'vitest';
import { choose, concede, createGame, hashState, replay, STARTERS, TWO_V_TWO, viewFor, type GameRecord, type GameSetup, type GameState } from '../../src/game/index.ts';
import { decide } from '../../src/game/ai/agent.ts';
import { checkInvariants } from '../../src/game/state/invariants.ts';
import { mulberry32 } from '../../src/game/state/rng.ts';
import { isType } from '../../src/game/rules/chars.ts';
import { allied, opponentsOf, teammates } from '../../src/game/rules/teams.ts';

/*
 * 2v2, Magma Chamber [491]: four starters in two teams, played out by
 * random bots and by the computer. Every game must end, keep the
 * invariants, keep both teammates on the same points, never put two
 * teammates' units on one battlefield or three players at one, and replay.
 */

const decks = (k: number) => [0, 1, 2, 3].map((i) => STARTERS[(k * 3 + i * 2) % STARTERS.length].deck);
const setupFor = (seed: number, k: number): GameSetup => ({ seed, decks: decks(k), mode: TWO_V_TWO });

/** The board rules of more than two players, and the shared points. */
function boardOk(s: GameState) {
  for (const b of s.bfs) {
    const players = [...new Set(b.here.map((id) => s.objects[id]).filter((o) => o.controller !== null && isType(o, 'unit')).map((o) => o.controller!))];
    expect(players.length, 'at most two players at a battlefield').toBeLessThanOrEqual(2);
    if (players.length === 2) expect(allied(s, players[0], players[1]), 'never two teammates at one battlefield').toBe(false);
  }
  expect(s.players[0].points).toBe(s.players[2].points);
  expect(s.players[1].points).toBe(s.players[3].points);
}

function playOut(seed: number, k: number, ai: boolean) {
  const setup = setupFor(seed, k);
  let s = createGame(setup, { check: true }).state;
  let r = seed >>> 0;
  const answers: GameRecord['answers'] = [];
  while (s.pending && answers.length < 12000) {
    const d = s.pending;
    const real = d.options.filter((o) => !o.ui).map((o) => o.key);
    let key: string;
    if (ai) key = decide({ level: 'beginner', me: d.player, seed, decks: setup.decks }, viewFor(s, d.player)).key;
    else { const st = mulberry32(r); r = st.next; key = real[Math.floor(st.value * real.length)]; }
    if (!real.includes(key)) key = real[0];
    answers.push({ d: d.id, k: key, by: d.player });
    s = choose(s, { decision: d.id, key }, { check: answers.length % 200 === 0 }).state;
    if (answers.length % 25 === 0) boardOk(s);
  }
  return { s, setup, answers };
}

describe('2v2 (Magma Chamber) [491]', () => {
  it('sets up four players: teams sit alternately, the First Player brings no battlefield, 11 to win', () => {
    const s = createGame(setupFor(3, 0)).state;
    expect(s.players).toHaveLength(4);
    expect(s.bfs).toHaveLength(3);
    expect(s.bfs.every((b) => s.objects[b.obj].owner !== s.turn.firstPlayer)).toBe(true);
    expect(teammates(s, 0)).toEqual([2]);
    expect(opponentsOf(s, 1)).toEqual([0, 2]);
    expect(s.mode.victoryScore).toBe(11);
    checkInvariants(s);
  });

  for (const seed of [1, 2, 3]) {
    it(`random bots, seed ${seed}: the game ends, teammates share points, the board stays legal`, () => {
      const { s } = playOut(seed, seed, false);
      expect(s.result, 'the game ends').not.toBeNull();
      if (process.env.TWO_LOG) console.log(seed, JSON.stringify(s.result), s.players.map((p) => p.points).join(','), s.turn.n);
      boardOk(s);
      checkInvariants(s);
    }, 120_000);
  }

  it('the computer plays a 2v2 to its end', () => {
    const { s } = playOut(9, 2, true);
    expect(s.result).not.toBeNull();
    if (process.env.TWO_LOG) console.log('ai', JSON.stringify(s.result), s.players.map((p) => p.points).join(','), s.turn.n);
    boardOk(s);
  }, 240_000);

  it('a player who concedes loses for the team', () => {
    const s = createGame(setupFor(4, 1)).state;
    const out = concede(s, 2).state;
    expect([1, 3]).toContain(out.result!.winner);
  });

  it('a record replays to the same state', () => {
    const { s, setup, answers } = playOut(7, 3, false);
    const r = replay({ engine: s.engine, defsHash: s.defsHash, setup, answers, meta: { started: '', difficulty: 'test', humanSeat: 'hotseat', aiKnowsList: false } } as unknown as GameRecord);
    expect(hashState(r.state)).toBe(hashState(s));
  }, 120_000);
});
