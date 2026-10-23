import { afterAll, describe, expect, it } from 'vitest';
import {
  choose, createGame, ENGINE_VERSION, hashState, replay, STARTERS, viewFor, type DeckList, type GameRecord, type GameSetup,
  type GameState,
} from '../../src/game/index.ts';
import { decide, type AiLevel } from '../../src/game/ai/agent.ts';
import { checkInvariants, checkViews } from '../../src/game/state/invariants.ts';
import { mulberry32 } from '../../src/game/state/rng.ts';

/*
 * Fuzzing the 13 starter decks against each other (§14.7): random bots, and
 * the computer at Normal against Beginner. Every game must end, every
 * position keep the invariants (JSON round trip and views now and then),
 * every record replay to the same hash, and the computer never answer with
 * anything but an option.
 *
 * The default run plays a sample: each deck twice against a rotating
 * opponent (26 random games) and 6 Normal-vs-Beginner games. The full
 * matrix is opt-in:
 *
 *   FUZZ_STARTERS=all npx vitest run tests/game/fuzz-starters.test.ts      (169 random games)
 *   FUZZ_STARTERS_AI=all npx vitest run tests/game/fuzz-starters.test.ts   (169 AI games, slow)
 */

const N = STARTERS.length;
const ALL = process.env.FUZZ_STARTERS === 'all';
const ALL_AI = process.env.FUZZ_STARTERS_AI === 'all';

const pairs = (full: boolean, per: number): [number, number][] => {
  const out: [number, number][] = [];
  if (full) { for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) out.push([a, b]); return out; }
  for (let k = 0; k < per; k++) for (let a = 0; a < N; a++) out.push([a, (a + 1 + k * 5) % N]);
  return out;
};

interface Played { end: GameState; record: GameRecord; decisions: number; illegal: string[] }

/** What the games went through: the new machinery of the starter decks. */
const seen: Record<string, number> = {};
const count = (k: string) => { seen[k] = (seen[k] ?? 0) + 1; };

function play(seed: number, decks: [DeckList, DeckList], levels: [AiLevel | null, AiLevel | null]): Played {
  const setup: GameSetup = { seed, decks };
  let s = createGame(setup, { check: true }).state;
  let r = (seed * 2654435761) >>> 0;
  const answers: GameRecord['answers'] = [];
  const illegal: string[] = [];
  const plans: string[][] = [[], []];
  while (s.pending && answers.length < 6000) {
    const d = s.pending, p = d.player;
    const real = d.options.filter((o) => !o.ui).map((o) => o.key);
    let key: string;
    const lv = levels[p];
    if (lv === null) {
      const step = mulberry32(r);
      r = step.next;
      key = real[Math.floor(step.value * real.length)];
    } else if (plans[p].length > 0 && ['moveUnits', 'moveDest'].includes(d.kind) && real.includes(plans[p][0])) {
      key = plans[p].shift()!;
    } else {
      plans[p] = [];
      const reply = decide({ level: lv, me: p, seed, decks }, viewFor(s, p));
      key = reply.key;
      plans[p] = reply.plan ?? [];
    }
    if (!real.includes(key)) { illegal.push(`${d.kind}: '${key}'`); key = real[0]; }
    answers.push({ d: d.id, k: key, by: d.player });
    const out = choose(s, { decision: d.id, key }, { inPlace: lv === null });
    s = out.state;
    if (key.startsWith('hide:')) count('hide');
    if (key.startsWith('act:')) count('activate');
    for (const e of out.events) {
      if (e.k === 'attach') count('attach');
      if (e.k === 'xp') count('xp');
      if (e.k === 'counter') count('counter');
      if (e.k === 'move' && !e.standard) count('effectMove');
      if (e.k === 'zone' && e.from.z === 'facedown' && e.to.z === 'chain') count('fromFacedown');
      if (e.k === 'becomeMighty') count('mighty');
      if (e.k === 'replaced') count('replaced');
      if (e.k === 'zone' && e.why === 'returnToHand') count('returnToHand');
    }
    const n = answers.length;
    const fails = checkInvariants(s, { json: n % 40 === 0 });
    if (n % 100 === 0) fails.push(...checkViews(s));
    if (fails.length > 0) throw new Error(`seed ${seed}, answer ${n} ('${key}' to ${d.kind}):\n${fails.join('\n')}`);
  }
  const record: GameRecord = {
    engine: ENGINE_VERSION, defsHash: s.defsHash, setup, answers,
    meta: { started: '', difficulty: 'random', humanSeat: 0, aiKnowsList: false },
  };
  return { end: s, record, decisions: answers.length, illegal };
}

describe('§14.7 fuzzing: the starter decks against each other', () => {
  const randomPairs = pairs(ALL, 2);
  const BATCH = 13;
  let played = 0, turns = 0;
  const winners = [0, 0, 0];
  for (let b = 0; b * BATCH < randomPairs.length; b++) {
    const batch = randomPairs.slice(b * BATCH, (b + 1) * BATCH);
    it(`random bots, games ${b * BATCH + 1}–${b * BATCH + batch.length}: end, keep the invariants, replay`, async () => {
      for (const [i, [a, c]] of batch.entries()) {
        await new Promise((res) => setTimeout(res, 0));
        const seed = 5000 + b * BATCH + i;
        const g = play(seed, [STARTERS[a].deck, STARTERS[c].deck], [null, null]);
        const name = `${STARTERS[a].id} vs ${STARTERS[c].id} (seed ${seed})`;
        expect(g.end.result, name).not.toBeNull();
        expect(checkInvariants(g.end), name).toEqual([]);
        expect(hashState(replay(g.record).state), `${name} replay`).toBe(hashState(g.end));
        winners[g.end.result!.winner ?? 2]++;
        turns += g.end.turn.n;
        played++;
      }
    }, 600_000);
  }

  const aiPairs = ALL_AI ? pairs(true, 0) : [[0, 4], [5, 9], [10, 2], [7, 12], [3, 8], [11, 6]] as [number, number][];
  for (const [i, [a, c]] of aiPairs.entries()) {
    it(`Normal vs Beginner: ${STARTERS[a].id} vs ${STARTERS[c].id}: legal answers, the game ends, replays`, () => {
      const seed = 7000 + i;
      const levels: [AiLevel, AiLevel] = i % 2 === 0 ? ['normal', 'beginner'] : ['beginner', 'normal'];
      const g = play(seed, [STARTERS[a].deck, STARTERS[c].deck], levels);
      expect(g.illegal).toEqual([]);
      expect(g.end.result).not.toBeNull();
      expect(hashState(replay(g.record).state)).toBe(hashState(g.end));
    }, 600_000);
  }

  afterAll(() => {
    if (played < randomPairs.length) return;
    console.log('starter fuzz', JSON.stringify({ played, winners, avgTurns: turns / played, seen }));
  });
});
