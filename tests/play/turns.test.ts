import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { hashState, replay, viewFor, type PlayerView } from '../../src/game/index.ts';
import { botAnswer } from '../../src/play/host/bot.ts';
import { BUILT_IN_DECKS } from '../../src/play/host/decks.ts';
import { GameHost, type Clock } from '../../src/play/host/GameHost.ts';
import { affordances } from '../../src/play/model/affordances.ts';
import { boardOf } from '../../src/play/model/board.ts';
import { cardIndex, isRune, nameOf } from '../../src/play/model/cards.ts';
import { describeAll } from '../../src/play/model/describe.ts';
import { gameSetup } from '../../src/play/model/setup.ts';
import { stageOf } from '../../src/play/model/stage.ts';

/*
 * The Play tab: a human against the simple bot through the host,
 * turn after turn to the end of a game. The "human" here answers from its
 * own view with the bot's heuristic, clicking only what the affordances
 * offer.
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const SERAPHINE = BUILT_IN_DECKS.find((b) => b.id === 'seraphine')!.deck;
const now: Clock = { after(_ms, fn) { fn(); return () => {}; } };

function host(seed: number) {
  const setup = gameSetup({ human: 0, mine: SERAPHINE, theirs: SERAPHINE, champion: SERAPHINE.chosenChampion,
    order: 'random', seed }, ix);
  const h = new GameHost({ setup, human: 0, clock: now, check: true });
  h.start();
  return h;
}

const view = (h: GameHost): PlayerView => h.getSnapshot().view;

function playToTheEnd(h: GameHost, max = 3000) {
  let r = 0.5;
  const random = () => (r = (r * 9301 + 49297) % 233280 / 233280);
  for (let i = 0; i < max && !view(h).result; i++) {
    const v = view(h);
    expect(v.pending, `step ${i}: the human must have a decision while the game is on`).not.toBeNull();
    const a = affordances(v, v.pending);
    const key = botAnswer(v, random);
    const offered = [...Object.values(a.objects).flatMap((o) => o.keys), ...Object.values(a.lanes).flat(),
      ...a.buttons.map((b) => b.key)];
    expect(offered, `'${key}' is clickable`).toContain(key);
    expect(h.commit([key])).toBe(true);
  }
}

describe('the Play tab plays whole turns (M1.1, with the chain of M1.2)', () => {
  it('a human and the bot play a game to its end; the record replays to the same state', () => {
    for (const seed of [1, 2]) {
      const h = host(seed);
      playToTheEnd(h);
      const v = view(h);
      expect(v.result, `seed ${seed}`).not.toBeNull();
      expect(stageOf(v).k).toBe('over');
      const r = h.record();
      expect(r.answers.some((x) => x.auto)).toBe(true);              // pass-only priority answered for the human
      const end = replay(r).state;
      expect(viewFor(end, 0)).toEqual(v);
      expect(hashState(end)).toBe(hashState(replay(r).state));
    }
  }, 60_000);

  it('shows the board, the score and a log of the turns from the human\'s view', () => {
    const h = host(3);
    playToTheEnd(h, 120);
    const v = view(h);
    const b = boardOf(v, isRune);
    expect(b.turn).toBeGreaterThan(1);
    expect(b.me.runes.length + b.opponent.runes.length).toBeGreaterThan(0);
    const lines = describeAll(h.getSnapshot().events, {
      me: 0, nameOf: (d) => nameOf(ix, d),
      objOf: (id) => { const o = v.objects[id]; return o ? { def: 'def' in o ? o.def : null, owner: o.owner } : null; },
      bfObj: (i) => v.bfs[i]?.obj,
    }).map((l) => l.text);
    expect(lines.some((t) => /^Turn \d+: /.test(t))).toBe(true);
    expect(lines.some((t) => /channels? \d rune/.test(t))).toBe(true);
    expect(lines.some((t) => / plays? /.test(t))).toBe(true);
    expect(v.players[1].hand.every((id) => id < 0)).toBe(true);      // the opponent's hand stays hidden
  });

  it('offers the human\'s priority options as clickable cards and buttons', () => {
    const h = host(4);
    for (let i = 0; i < 50 && !(view(h).pending?.kind === 'priority' && view(h).pending?.prompt.window === 'main'); i++) {
      const v = view(h);
      h.commit([botAnswer(v, () => 0.3)]);
    }
    const v = view(h);
    const a = affordances(v, v.pending);
    expect(a.prompt).toMatch(/Your turn/);
    expect(a.buttons.map((x) => x.label)).toContain('End turn');
    for (const [id, o] of Object.entries(a.objects)) {
      expect(o.keys.every((k) => k === `play:${id}`)).toBe(true);
      expect(v.players[0].hand.includes(Number(id)) || v.players[0].champion === Number(id)).toBe(true);
    }
  });
});
