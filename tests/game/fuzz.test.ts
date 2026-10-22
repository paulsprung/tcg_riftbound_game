import { afterAll, describe, expect, it } from 'vitest';
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
 *
 * Since M1.2 the games cast spells (on the chain, as Reactions in
 * showdowns), place and resolve triggers, play tokens and make limited
 * plays; the tally at the end checks that they did. The 200 games run in
 * four batches so no single test holds the worker for minutes.
 */

const GAMES = 200;
const BATCHES = 4;

interface Played { end: GameState; record: GameRecord; decisions: number; seen: Record<string, number> }

function playRandom(seed: number): Played {
  const setup: GameSetup = { seed, decks: [SERAPHINE, SERAPHINE] };
  let s = createGame(setup, { check: true }).state;
  let r = (seed * 2654435761) >>> 0;
  const answers: GameRecord['answers'] = [];
  const seen: Record<string, number> = {};
  const count = (k: string) => { seen[k] = (seen[k] ?? 0) + 1; };
  while (s.pending) {
    const d = s.pending;
    const real = d.options.filter((o) => !o.ui);
    const step = mulberry32(r);
    r = step.next;
    const key = real[Math.floor(step.value * real.length)].key;
    answers.push({ d: d.id, k: key, by: d.player });
    if (d.kind === 'priority' && key.startsWith('play:') && d.prompt.window !== 'main') count('reaction');
    const out = choose(s, { decision: d.id, key }, { inPlace: true });
    s = out.state;
    for (const e of out.events) {
      if (e.k === 'chainPush' && e.kind === 'triggered') count('trigger');
      if (e.k === 'chainPush' && e.kind === 'token') count('token');
      if (e.k === 'outcome') count('resolvedInstruction');
      if (e.k === 'rollback') count('rollback');
      if (e.k === 'played' && e.def === 'meticulous-restorationist') count('fromTrash');
    }
    const n = answers.length;
    const fails = checkInvariants(s, { json: n % 20 === 0 });
    if (n % 50 === 0) fails.push(...checkViews(s));
    if (fails.length > 0) throw new Error(`seed ${seed}, answer ${n} ('${key}' to ${d.kind}):\n${fails.join('\n')}`);
  }
  const record: GameRecord = {
    engine: ENGINE_VERSION, defsHash: s.defsHash, setup, answers,
    meta: { started: '', difficulty: 'random', humanSeat: 0, aiKnowsList: false },
  };
  return { end: s, record, decisions: answers.length, seen };
}

describe('§14.7 fuzzing: random Seraphine mirrors', () => {
  const winners = [0, 0, 0];
  const seen: Record<string, number> = {};
  let turns = 0, played = 0;

  for (let b = 0; b < BATCHES; b++) {
    const from = b * (GAMES / BATCHES) + 1, to = (b + 1) * (GAMES / BATCHES);
    it(`games ${from}–${to} end without an invariant failure and replay to the same hash`, async () => {
      for (let seed = from; seed <= to; seed++) {
        await new Promise((r) => setTimeout(r, 0));                  // let the worker talk to vitest between games
        const g = playRandom(seed);
        expect(g.end.result, `seed ${seed}`).not.toBeNull();
        expect(checkInvariants(g.end)).toEqual([]);
        expect(hashState(replay(g.record).state), `seed ${seed} replay`).toBe(hashState(g.end));
        winners[g.end.result!.winner ?? 2]++;
        turns += g.end.turn.n;
        played++;
        for (const [k, n] of Object.entries(g.seen)) seen[k] = (seen[k] ?? 0) + n;
      }
    }, 300_000);
  }

  afterAll(() => {
    if (played < GAMES) return;                                      // a batch failed; it reports itself
    expect(winners[0]).toBeGreaterThan(GAMES / 5);                  // both seats win
    expect(winners[1]).toBeGreaterThan(GAMES / 5);
    expect(turns / GAMES).toBeLessThan(60);
    // The games went through the chain's machinery (M1.2).
    for (const k of ['reaction', 'trigger', 'token', 'resolvedInstruction', 'rollback', 'fromTrash']) {
      expect(seen[k] ?? 0, k).toBeGreaterThan(GAMES / 10);
    }
  });
});
