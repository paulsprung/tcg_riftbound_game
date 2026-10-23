import { expect } from 'vitest';
import type { PlayerView } from '../../src/game/index.ts';
import { botAnswer } from '../../src/play/host/bot.ts';
import type { GameHost } from '../../src/play/host/GameHost.ts';
import { suggestKey } from '../../src/play/model/assign.ts';
import type { TutorialCoach } from '../../src/play/tutorial/lesson.ts';

function rand(seed: number) {
  let r = seed / 1000;
  return () => (r = (r * 9301 + 49297) % 233280 / 233280);
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

