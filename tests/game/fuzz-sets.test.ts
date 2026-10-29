import { describe, expect, it } from 'vitest';
import {
  choose, createGame, ENGINE_VERSION, hashState, replay, viewFor, type DeckList, type GameRecord, type GameSetup, type GameState,
} from '../../src/game/index.ts';
import { decide, type AiLevel } from '../../src/game/ai/agent.ts';
import { checkInvariants, checkViews } from '../../src/game/state/invariants.ts';
import { mulberry32 } from '../../src/game/state/rng.ts';
import { randomDeck } from './helpers/randomDeck.ts';

/*
 * Fuzzing whole sets (§14.7): random legal decks built from one set's cards
 * (cards/defs: every card executable), random bots and the computer. Every
 * game must end, every position keep the invariants, every record replay to
 * the same hash, and the computer answer only with options.
 *
 * Default: a small sample per set. More is opt-in:
 *
 *   FUZZ_SET_GAMES=200 npx vitest run tests/game/fuzz-sets.test.ts         (random games per set)
 *   FUZZ_SET_AI=20 npx vitest run tests/game/fuzz-sets.test.ts              (Normal-vs-Beginner games per set)
 */

const SETS = ['ogn', 'sfd', 'unl', 'rad', 'ven'];
/** Sets with cards left undefined (unsure, docs/CARDS-UNSURE.md): their decks take only executable cards. */
const PARTIAL = ['rad', 'ven'];
const GAMES = Number(process.env.FUZZ_SET_GAMES ?? 8);
const AI_GAMES = Number(process.env.FUZZ_SET_AI ?? 2);

interface Played { end: GameState; record: GameRecord; illegal: string[] }

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
    s = choose(s, { decision: d.id, key }, { inPlace: lv === null }).state;
    const n = answers.length;
    const fails = checkInvariants(s, { json: n % 40 === 0 });
    if (n % 100 === 0) fails.push(...checkViews(s));
    if (fails.length > 0) throw new Error(`seed ${seed}, answer ${n} ('${key}' to ${d.kind}):\n${fails.join('\n')}`);
  }
  const record: GameRecord = {
    engine: ENGINE_VERSION, defsHash: s.defsHash, setup, answers,
    meta: { started: '', difficulty: 'random', humanSeat: 0, aiKnowsList: false },
  };
  return { end: s, record, illegal };
}

const decksFor = (set: string, seed: number): [DeckList, DeckList] => {
  const o = { executable: PARTIAL.includes(set) };
  return [randomDeck(set, seed * 2 + 1, o)!, randomDeck(set, seed * 2 + 2, o)!];
};

for (const set of SETS) {
  describe(`§14.7 fuzzing: random ${set.toUpperCase()} decks`, () => {
    it('every set legend with a champion of its tag gives a legal random deck', () => {
      for (let i = 0; i < 20; i++) expect(randomDeck(set, 100 + i, { executable: PARTIAL.includes(set) }), `seed ${100 + i}`).not.toBeNull();
    });

    const BATCH = 4;
    for (let b = 0; b * BATCH < GAMES; b++) {
      const n = Math.min(BATCH, GAMES - b * BATCH);
      it(`random bots, games ${b * BATCH + 1}–${b * BATCH + n}: end, keep the invariants, replay`, async () => {
        for (let i = 0; i < n; i++) {
          await new Promise((res) => setTimeout(res, 0));
          const seed = 11000 + b * BATCH + i;
          const decks = decksFor(set, seed);
          const g = play(seed, decks, [null, null]);
          const name = `${decks[0].legend} vs ${decks[1].legend} (seed ${seed})`;
          expect(g.end.result, name).not.toBeNull();
          expect(checkInvariants(g.end), name).toEqual([]);
          expect(hashState(replay(g.record).state), `${name} replay`).toBe(hashState(g.end));
        }
      }, 600_000);
    }

    for (let i = 0; i < AI_GAMES; i++) {
      it(`Normal vs Beginner ${i + 1}: legal answers, the game ends, replays`, async () => {
        await new Promise((res) => setTimeout(res, 0));
        const seed = 12000 + i;
        const decks = decksFor(set, seed);
        const levels: [AiLevel, AiLevel] = i % 2 === 0 ? ['normal', 'beginner'] : ['beginner', 'normal'];
        const g = play(seed, decks, levels);
        expect(g.illegal).toEqual([]);
        expect(g.end.result).not.toBeNull();
        expect(hashState(replay(g.record).state)).toBe(hashState(g.end));
      }, 600_000);
    }
  });
}
