import '../game/helpers/setupOnly.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { replay, viewFor, type PlayerView } from '../../src/game/index.ts';
import { botAnswer, botPace } from '../../src/play/host/bot.ts';
import { BUILT_IN_DECKS } from '../../src/play/host/decks.ts';
import { GameHost, type Clock } from '../../src/play/host/GameHost.ts';
import { cardIndex } from '../../src/play/model/cards.ts';
import { gameSetup, type OrderChoice } from '../../src/play/model/setup.ts';
import { stageOf } from '../../src/play/model/stage.ts';

/*
 * The host (§12): it holds the true state, hands the UI the human's view
 * only, lets the setup bot answer through the same API, and records every
 * answer so the record replays the game.
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const [SERAPHINE, EVELYNN] = (['seraphine', 'evelynn'] as const).map((id) => BUILT_IN_DECKS.find((b) => b.id === id)!.deck);

/** A clock that runs the bot's answers when told to, not after a delay. */
function manualClock() {
  const queue: { ms: number; fn: () => void; live: boolean }[] = [];
  const clock: Clock = {
    after(ms, fn) {
      const job = { ms, fn, live: true };
      queue.push(job);
      return () => { job.live = false; };
    },
  };
  const tick = () => {
    const job = queue.shift();
    if (job?.live) job.fn();
    return job !== undefined;
  };
  const drain = () => { while (tick()); };
  return { clock, queue, tick, drain };
}

const now: Clock = { after(_ms, fn) { fn(); return () => {}; } };

function host(seed: number, order: OrderChoice = 'random', clock: Clock = now) {
  const setup = gameSetup({ human: 0, mine: SERAPHINE, theirs: EVELYNN, champion: SERAPHINE.chosenChampion, order,
    seed }, ix);
  const h = new GameHost({ setup, human: 0, clock, check: true, started: '2026-10-21T00:00:00Z' });
  h.start();
  return h;
}

const view = (h: GameHost): PlayerView => h.getSnapshot().view;

/** Answers the human's decisions until setup is done: first, then keep. */
function finishSetup(h: GameHost) {
  for (let i = 0; i < 10 && view(h).pending; i++) {
    const d = view(h).pending!;
    h.commit([d.kind === 'playOrder' ? 'first' : 'done']);
  }
}

describe('GameHost', () => {
  it('goes through the whole setup with the bot answering its own decisions', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = host(seed);
      finishSetup(h);
      const snap = h.getSnapshot();
      expect(stageOf(snap.view).k, `seed ${seed}`).toBe('ready');
      expect(snap.error).toBeNull();
      expect(snap.thinking).toBe(false);
      expect(snap.view.players.map((p) => p.hand.length)).toEqual([4, 4]);
    }
  });

  it('only ever shows the human their own view', () => {
    const h = host(7);
    const v = view(h);
    expect(v.me).toBe(0);
    expect(v.rng).toBe(0);
    expect(v.players[1].hand.every((id) => id < 0)).toBe(true);
    finishSetup(h);
    expect(view(h).players[1].hand.every((id) => id < 0)).toBe(true);
  });

  it('records every answer, the bot\'s included, and the record replays to the same view', () => {
    const h = host(8);
    finishSetup(h);
    const r = h.record();
    expect(r.answers.length).toBeGreaterThan(1);
    expect(new Set(r.answers.map((a) => a.by))).toEqual(new Set([0, 1]));
    expect(viewFor(replay(r).state, 0)).toEqual(view(h));
    expect(r.meta).toEqual({ started: '2026-10-21T00:00:00Z', difficulty: 'simple-bot', humanSeat: 0, aiKnowsList: false });
  });

  it('is deterministic: the same seed and answers give the same game', () => {
    const a = host(9), b = host(9);
    finishSetup(a);
    finishSetup(b);
    expect(a.record().answers).toEqual(b.record().answers);
    expect(view(a)).toEqual(view(b));
  });

  it('commits a mulligan batch at once, and refuses a bad key without changing anything', () => {
    const h = host(10, 'first');
    const d = view(h).pending!;
    expect(d.kind).toBe('mulligan');
    const [a, b] = view(h).players[0].hand;
    expect(h.commit([`set:${a}`, 'nonsense'])).toBe(false);
    expect(h.getSnapshot().error).toMatch(/nonsense/);
    expect(view(h).pending?.id).toBe(d.id);                          // the first key was not applied either
    expect(h.commit([`set:${a}`, `set:${b}`])).toBe(true);
    expect(h.getSnapshot().error).toBeNull();
    expect(view(h).players[0].hand).not.toContain(a);
    expect(h.record().answers.slice(0, 2).map((x) => x.k)).toEqual([`set:${a}`, `set:${b}`]);
  });

  it('previews a draft within the batch, but never past it', () => {
    const h = host(11, 'first');
    const [a, b] = view(h).players[0].hand;
    const one = h.preview([`set:${a}`]);
    expect(one.complete).toBe(false);
    expect(one.decision?.kind).toBe('mulligan');
    expect(one.decision?.options.map((o) => o.key)).not.toContain(`set:${a}`);
    expect(h.preview([`set:${a}`, `set:${b}`])).toEqual({ decision: null, complete: true });   // the redraw stays hidden
    expect(h.preview([`set:${a}`, 'done'])).toEqual({ decision: null, complete: true });
    expect(() => h.preview([`set:${a}`, 'done', 'done'])).toThrow(/past the human's batch/);
    expect(view(h).players[0].hand).toEqual([a, b, ...view(h).players[0].hand.slice(2)]);   // nothing committed
    expect(h.record().answers).toEqual([]);
  });

  it('paces the bot: it answers only when its clock fires, and stopping cancels it', () => {
    const m = manualClock();
    const h = host(12, 'second', m.clock);                          // the bot plays first, so it mulligans first
    expect(h.getSnapshot().thinking).toBe(true);
    expect(stageOf(view(h))).toEqual({ k: 'mulligan', decider: 1, mine: false });
    h.stop();
    m.drain();
    expect(h.getSnapshot().thinking).toBe(true);                     // a stopped host's bot doesn't answer
    h.start();
    m.drain();
    expect(stageOf(view(h))).toEqual({ k: 'mulligan', decider: 0, mine: true });
    expect(h.getSnapshot().thinking).toBe(false);
  });

  it('tells subscribers about every change', () => {
    const h = host(13, 'first');
    let calls = 0;
    const off = h.subscribe(() => { calls++; });
    const before = h.getSnapshot();
    h.commit(['done']);
    expect(calls).toBeGreaterThan(0);
    expect(h.getSnapshot()).not.toBe(before);
    off();
    const n = calls;
    finishSetup(h);
    expect(calls).toBe(n);
  });
});

describe('the setup bot', () => {
  it('plays first when it chooses the order, and answers from its own options otherwise', () => {
    const h = host(14, 'second');
    expect(h.record().answers.filter((a) => a.by === 1).every((a) => a.k === 'done' || a.k.startsWith('set:'))).toBe(true);
    const r = Array.from({ length: 30 }, (_, i) => i).find((seed) => {
      const g = host(seed, 'random', manualClock().clock);
      return view(g).opponentDecision?.kind === 'playOrder';
    });
    expect(r).toBeDefined();
    const g = host(r!);
    expect(view(g).turn.firstPlayer).toBe(1);                      // the bot was designated and went first
  });

  it('refuses to answer without a decision, and paces by kind only', () => {
    const h = host(15, 'first');
    finishSetup(h);
    expect(() => botAnswer(view(h), Math.random)).toThrow(/no decision/);
    expect(botPace('mulligan', () => 0)).toBe(250);
    expect(botPace('playOrder', () => 1)).toBe(1300);
  });
});
