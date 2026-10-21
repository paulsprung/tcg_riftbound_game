import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION, hashState, RecordMismatchError, replay, type GameRecord, type GameSetup,
} from '../../src/game/index.ts';
import { checkSetupDone } from '../../src/game/state/invariants.ts';
import { duel, playOut, positions, randomPicker, type PlayedOut } from './helpers/play.ts';

/*
 * Records and replays (§4.9): a game is its setup and its answers, so a
 * record of them reproduces every position, survives being saved as JSON,
 * and refuses to replay against another engine, other cards or a game it
 * doesn't fit.
 */

function recordOf(setup: GameSetup, g: PlayedOut, extra: Partial<GameRecord> = {}): GameRecord {
  return {
    engine: ENGINE_VERSION, defsHash: g.start.state.defsHash, setup,
    answers: g.steps.map((st) => ({ d: st.decision.id, k: st.key, by: st.decision.player })),
    meta: { started: '2026-10-21T12:00:00Z', difficulty: 'normal', humanSeat: 0, aiKnowsList: true }, ...extra,
  };
}

describe('§4.9 records and replays', () => {
  const setup = duel(41);
  const g = playOut(setup, randomPicker(41));
  const record = recordOf(setup, g);

  it('replays a setup to the same state, and to every point on the way', () => {
    const hashes = positions(g).map(hashState);
    expect(hashState(replay(record, { check: true }).state)).toBe(hashes.at(-1));
    for (let i = 0; i <= record.answers.length; i++) expect(hashState(replay(record, { until: i }).state)).toBe(hashes[i]);
    expect(checkSetupDone(replay(record).state)).toEqual([]);
  });

  it('replays the events too, in order', () => {
    const all = [g.start.events, ...g.steps.map((st) => st.after.events)].flat();
    expect(replay(record).events).toEqual(all);
  });

  it('survives a JSON round trip (autosave)', () => {
    const saved = JSON.parse(JSON.stringify(record)) as GameRecord;
    expect(hashState(replay(saved).state)).toBe(hashState(g.end));
  });

  it('replays a concession at its place [650]', () => {
    const conceded = replay({ ...record, concede: { p: 0, afterAnswer: 1 } });
    expect(conceded.state.result).toEqual({ winner: 1, reason: 'concede', rule: '650', turn: 0 });
    expect(conceded.events.at(-1)?.k).toBe('gameOver');
  });

  it('refuses another engine or other cards, and answers that don\'t fit', () => {
    expect(() => replay({ ...record, engine: '0.0.0' })).toThrow(RecordMismatchError);
    expect(() => replay({ ...record, defsHash: '0000000000000000' })).toThrow(RecordMismatchError);
    const wrong = (i: number, a: Partial<GameRecord['answers'][number]>) =>
      ({ ...record, answers: record.answers.map((x, j) => (j === i ? { ...x, ...a } : x)) });
    expect(() => replay(wrong(0, { d: 99 }))).toThrow(/doesn't fit decision/);
    expect(() => replay(wrong(0, { k: 'third' }))).toThrow(/doesn't fit decision/);
    expect(() => replay(wrong(1, { by: record.answers[1].by === 0 ? 1 : 0 }))).toThrow(RecordMismatchError);
  });
});
