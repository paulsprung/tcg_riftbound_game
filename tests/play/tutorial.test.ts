import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { replay, viewFor } from '../../src/game/index.ts';
import type { Clock } from '../../src/play/host/GameHost.ts';
import { cardIndex } from '../../src/play/model/cards.ts';
import { follow } from './tutorialFollow.ts';
import {
  createTutorialCoach, HUMAN, LESSON_STEPS, TUTORIAL_SCORE, tutorialHost,
} from '../../src/play/tutorial/lesson.ts';

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const now: Clock = { after(_ms, fn) { fn(); return () => {}; } };

export function newTutorialHost() {
  return tutorialHost(ix, { clock: now, check: true });
}

describe('the tutorial match', () => {
  it('runs to the end, every coached step reached, the same every time', () => {
    const runs = [0, 1].map(() => {
      const h = newTutorialHost();
      h.start();
      const coach = createTutorialCoach();
      const log: string[] = [];
      const seen = follow(h, coach, 3000, log);
      if (process.env.TUT_LOG) console.log(log.join('\n'), '\n', seen.join(' '));
      return { h, coach, seen };
    });
    const { h, coach, seen } = runs[0];
    const v = h.getSnapshot().view;
    expect(v.result?.winner).toBe(HUMAN);
    expect(v.players[HUMAN].points).toBeGreaterThanOrEqual(TUTORIAL_SCORE);
    for (const id of LESSON_STEPS) expect(seen).toContain(id);
    expect([null, 'finish-attack']).toContain(coach.at);
    expect(runs[1].h.record()).toEqual(h.record());
    expect(viewFor(replay(h.record()).state, HUMAN)).toEqual(v);
  });
});

describe('the stacked setup (GameSetup.stack)', () => {
  it('deals the lesson\'s opening hand, the human keeps it, the record replays', () => {
    const h = newTutorialHost();
    const v = h.getSnapshot().view;
    const hand = v.players[HUMAN].hand.map((id) => (v.objects[id] as { def: string }).def).sort();
    expect(hand).toEqual(['faithful-manufactor', 'high-note', 'hunting-dog', 'strigian-oracle']);
    expect(v.pending?.player).not.toBe(HUMAN);                  // the mulligan was kept for them
    expect(viewFor(replay(h.record()).state, HUMAN)).toEqual(v);
  });
});

describe('the tutorial never gets stuck', () => {
  it('a human who picks other allowed options and plays the finish their own way still reaches the end', () => {
    const h = newTutorialHost();
    h.start();
    const coach = createTutorialCoach();
    follow(h, coach, 4000, undefined, true);
    expect(h.getSnapshot().view.result).not.toBeNull();
    expect(h.getSnapshot().error).toBeNull();
  });
});

it.skipIf(!process.env.TUT_BOARD)('board dump', () => {
  const h = newTutorialHost(); h.start();
  const coach = createTutorialCoach();
  const log: string[] = [];
  try { follow(h, coach, Number(process.env.TUT_BOARD), log); } catch (e) { console.log(String(e)); }
  const r = h.record();
  const st = replay(r).state;
  void st;
  for (const a of r.answers.filter((a) => a.by === 1 && !a.auto)) console.log('opp', a.d, a.k);
  const v = h.getSnapshot().view;
  console.log(log.join('\n'));
  for (const b of v.bfs) console.log('bf', b.controller, b.here.map((id) => { const o = v.objects[id] as any; return `${o.def}@${o.controller}`; }));
  console.log(v.players.map((p) => p.base.map((id) => (v.objects[id] as any).def).filter((d: string) => !d.endsWith('rune'))));
});
