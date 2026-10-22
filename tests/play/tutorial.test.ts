import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { replay, viewFor, type PlayerView } from '../../src/game/index.ts';
import { botAnswer } from '../../src/play/host/bot.ts';
import { GameHost, type Clock } from '../../src/play/host/GameHost.ts';
import { suggestKey } from '../../src/play/model/assign.ts';
import { cardIndex } from '../../src/play/model/cards.ts';
import {
  createTutorialCoach, HUMAN, LESSON_STEPS, opponentSeat, TUTORIAL_SCORE, tutorialSetup, type TutorialCoach,
} from '../../src/play/tutorial/lesson.ts';

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const now: Clock = { after(_ms, fn) { fn(); return () => {}; } };

function rand(seed: number) {
  let r = seed / 1000;
  return () => (r = (r * 9301 + 49297) % 233280 / 233280);
}

export function newTutorialHost() {
  return new GameHost({ setup: tutorialSetup(ix), seats: [{ k: 'human' }, opponentSeat()], clock: now, check: true });
}

/** A human who does what the coach says: Next on explanations, the first
    allowed (highlighted first) option otherwise; free play by the bot. */
export function follow(h: GameHost, coach: TutorialCoach, max = 3000, log?: string[], pickLast = false) {
  const random = rand(3);
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    const snap = h.getSnapshot();
    const v: PlayerView = snap.view;
    const decision = v.pending;
    const step = coach.step({ view: v, events: snap.events, decision });
    if (step && seen[seen.length - 1] !== step.id) seen.push(step.id);
    if (v.result) break;
    if (step?.next) { coach.onNext?.(step); continue; }
    if (!decision) throw new Error(`no decision for the human at step ${step?.id} (${snap.error})`);
    const real = decision.options.filter((o) => !o.ui).map((o) => o.key);
    let key: string;
    if (step?.allow) {
      const ok = real.filter(step.allow);
      expect(ok.length, `step ${step.id}: nothing allowed in ${decision.kind}`).toBeGreaterThan(0);
      key = pickLast ? ok[ok.length - 1] : ok.find((k) => step.highlight?.keys?.includes(k)) ?? ok[0];
    } else if (!pickLast && step?.highlight?.keys?.some((k) => real.includes(k))) key = real.find((k) => step.highlight!.keys!.includes(k))!;
    else if (decision.kind.startsWith('assign')) key = suggestKey(v, decision);
    else key = botAnswer(v, random);
    log?.push(`T${v.turn.n} ${v.players[0].points}-${v.players[1].points} ${step?.id ?? '-'} ${decision.kind} ${JSON.stringify(decision.prompt).slice(0, 60)} [${real.join(' ')}] => ${key}`);
    expect(h.commit([key]), h.getSnapshot().error ?? '').toBe(true);
    coach.onAnswer?.([key], { view: h.getSnapshot().view, events: h.getSnapshot().events, decision: h.getSnapshot().view.pending });
  }
  return seen;
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
