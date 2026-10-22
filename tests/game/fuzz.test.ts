import { describe, expect, it } from 'vitest';
import {
  choose, createGame, ENGINE_VERSION, hashState, replay, type GameRecord, type GameSetup, type GameState,
} from '../../src/game/index.ts';
import { checkInvariants, checkViews } from '../../src/game/state/invariants.ts';
import { mulberry32 } from '../../src/game/state/rng.ts';
import { SERAPHINE } from './helpers/decks.ts';

/*
 * Fuzzing (§14.7): Seraphine mirror games between two bots that pick a
 * random real option at every decision. Every game must end (a win, or the
 * turn limit as a rules loop), every position must keep the invariants
 * (§3.14; the slow JSON round trip and the views every 50 decisions), and
 * the record of the game must replay to the same state hash.
 */

const GAMES = 200;

function playRandom(seed: number): { end: GameState; record: GameRecord; decisions: number } {
  const setup: GameSetup = { seed, decks: [SERAPHINE, SERAPHINE] };
  let s = createGame(setup, { check: true }).state;
  let r = (seed * 2654435761) >>> 0;
  const answers: GameRecord['answers'] = [];
  while (s.pending) {
    const d = s.pending;
    const real = d.options.filter((o) => !o.ui);
    const step = mulberry32(r);
    r = step.next;
    const key = real[Math.floor(step.value * real.length)].key;
    answers.push({ d: d.id, k: key, by: d.player });
    s = choose(s, { decision: d.id, key }, { inPlace: true }).state;
    const n = answers.length;
    const fails = checkInvariants(s, { json: n % 20 === 0 });
    if (n % 50 === 0) fails.push(...checkViews(s));
    if (fails.length > 0) throw new Error(`seed ${seed}, answer ${n} ('${key}' to ${d.kind}):\n${fails.join('\n')}`);
  }
  const record: GameRecord = {
    engine: ENGINE_VERSION, defsHash: s.defsHash, setup, answers,
    meta: { started: '', difficulty: 'random', humanSeat: 0, aiKnowsList: false },
  };
  return { end: s, record, decisions: answers.length };
}

describe('§14.7 fuzzing: random Seraphine mirrors', () => {
  it(`${GAMES} games end without an invariant failure and replay to the same hash`, () => {
    const winners = [0, 0, 0];
    let turns = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      const g = playRandom(seed);
      expect(g.end.result, `seed ${seed}`).not.toBeNull();
      expect(checkInvariants(g.end)).toEqual([]);
      expect(hashState(replay(g.record).state), `seed ${seed} replay`).toBe(hashState(g.end));
      winners[g.end.result!.winner ?? 2]++;
      turns += g.end.turn.n;
    }
    expect(winners[0]).toBeGreaterThan(GAMES / 5);                  // both seats win
    expect(winners[1]).toBeGreaterThan(GAMES / 5);
    expect(turns / GAMES).toBeLessThan(60);
  }, 300_000);
});
