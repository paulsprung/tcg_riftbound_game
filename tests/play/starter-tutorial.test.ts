import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { STARTERS } from '../../src/game/decks/starters.ts';
import { findCard, replay, viewFor } from '../../src/game/index.ts';
import type { Clock } from '../../src/play/host/GameHost.ts';
import { cardIndex } from '../../src/play/model/cards.ts';
import {
  createStarterCoach, STARTER_CORE_STEPS, STARTER_TUTORIAL_SCORE, stackFor, starterTutorialDecks, starterTutorialHost, tutorOpponent,
} from '../../src/play/tutorial/starterLesson.ts';
import { follow } from './tutorialFollow.ts';

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const now: Clock = { after(_ms, fn) { fn(); return () => {}; } };

describe('the tutorial with the player\'s own starter deck', () => {
  it('stacks an opening hand of cheap units and a spell from the deck itself', () => {
    for (const st of STARTERS) {
      const [mine] = starterTutorialDecks(st);
      const top = stackFor(mine, true);
      const hand = top.slice(0, 4).map((d) => findCard(d)!);
      expect(hand[0].types[0], st.id).toBe('unit');
      expect(hand[0].cost!.energy, st.id).toBeLessThanOrEqual(2);
      expect(hand[0].cost!.power, st.id).toEqual([]);
      expect(hand.some((c) => c.types.includes('spell')), st.id).toBe(true);
      expect(tutorOpponent(st.id).id).not.toBe(st.id);
      const h = starterTutorialHost(st, ix, { clock: now, check: true });
      const v = h.getSnapshot().view;
      expect(v.players[0].hand.map((id) => (v.objects[id] as { def: string }).def).sort(), st.id).toEqual(top.slice(0, 4).sort());
      expect(v.pending?.player, st.id).not.toBe(0);           // the mulligan was kept for them
    }
  });

  for (const st of STARTERS) {
    it(`${st.id}: a player who follows the coach wins the match, every core step reached`, () => {
      const h = starterTutorialHost(st, ix, { clock: now, check: true });
      h.start();
      const coach = createStarterCoach();
      const log: string[] = [];
      const seen = follow(h, coach, 4000, log);
      if (process.env.TUT_LOG === st.id) console.log(log.join('\n'), '\n', seen.join(' '));
      const v = h.getSnapshot().view;
      expect(v.result?.winner, `${st.id}: ${seen.join(' ')}`).toBe(0);
      expect(h.getSnapshot().error).toBeNull();
      for (const id of STARTER_CORE_STEPS) expect(seen, st.id).toContain(id);
      expect(v.players[0].points).toBeGreaterThanOrEqual(STARTER_TUTORIAL_SCORE);
      expect(viewFor(replay(h.record()).state, 0)).toEqual(v);
    }, 30_000);
  }

  it('a player who ignores the coach (last allowed option) still wins: the tutor never takes its last point', () => {
    for (const st of STARTERS) {
      const h = starterTutorialHost(st, ix, { clock: now, check: true });
      h.start();
      follow(h, createStarterCoach(), 6000, undefined, true);
      const v = h.getSnapshot().view;
      expect(v.result?.winner, st.id).toBe(0);
      expect(v.players[1].points, st.id).toBeLessThan(STARTER_TUTORIAL_SCORE);
    }
  }, 120_000);
});
