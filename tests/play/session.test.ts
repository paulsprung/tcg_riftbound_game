import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { hashState, replay, viewFor, type GameRecord, type PlayerView } from '../../src/game/index.ts';
import { localAi } from '../../src/play/host/aiClient.ts';
import { localStore, memoryStore, resumable, SAVE_KEY, savedSeat, type SavedGame } from '../../src/play/host/autosave.ts';
import { botAnswer } from '../../src/play/host/bot.ts';
import { BUILT_IN_DECKS } from '../../src/play/host/decks.ts';
import { GameHost, type Clock, type SaveInfo, type Seat } from '../../src/play/host/GameHost.ts';
import { affordances } from '../../src/play/model/affordances.ts';
import { suggestKey } from '../../src/play/model/assign.ts';
import { cardIndex } from '../../src/play/model/cards.ts';
import { fxOf } from '../../src/play/model/fx.ts';
import { rulesReport } from '../../src/play/model/report.ts';
import { gameSetup } from '../../src/play/model/setup.ts';
import { restrict } from '../../src/play/tutorial/coach.ts';

/*
 * M1.4 sessions: the computer seat through the host, autosave and resume
 * (§4.9), hot-seat with its handoff and per-seat views (§12.1), the report
 * of a rules problem, and the tutorial hook's restriction.
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const SERAPHINE = BUILT_IN_DECKS.find((b) => b.id === 'seraphine')!.deck;
const now: Clock = { after(_ms, fn) { fn(); return () => {}; } };

const setupFor = (seed: number) => gameSetup({ human: 0, mine: SERAPHINE, theirs: SERAPHINE, champion: SERAPHINE.chosenChampion,
  order: 'random', seed }, ix);

function rand(seed: number) {
  let r = seed / 1000;
  return () => (r = (r * 9301 + 49297) % 233280 / 233280);
}

/** Answers the decisions of whoever is on screen with the bot's heuristic,
    taking over in hot-seat; stops after `max` answers or at the end. */
function drive(h: GameHost, max: number, random = rand(17), each?: (v: PlayerView) => void) {
  for (let i = 0; i < max; i++) {
    const snap = h.getSnapshot();
    if (snap.view.result) return;
    if (snap.handoff !== null) { h.takeOver(); continue; }
    const v = snap.view;
    each?.(v);
    if (!v.pending) throw new Error(`no decision on screen (${snap.error})`);
    expect(h.commit([botAnswer(v, random)]), h.getSnapshot().error ?? '').toBe(true);
  }
}

describe('the computer seat in the host (§11.2)', () => {
  it('a human plays the Normal computer to the end; its answers are recorded and replay', async () => {
    const h = new GameHost({ setup: setupFor(21), seats: [{ k: 'human' }, { k: 'ai', level: 'normal' }], clock: now });
    h.start();
    drive(h, 3000);
    const snap = h.getSnapshot();
    expect(snap.view.result).not.toBeNull();
    expect(snap.aiStats?.level).toBe('normal');
    const r = h.record();
    expect(r.meta.difficulty).toBe('normal');
    expect(viewFor(replay(r).state, 0)).toEqual(snap.view);
  }, 120_000);

  it('works with an asynchronous client (the worker protocol, run locally)', async () => {
    let pending: (() => void)[] = [];
    const clock: Clock = { after(_ms, fn) { pending.push(fn); return () => {}; } };
    const h = new GameHost({ setup: setupFor(22), seats: [{ k: 'human' }, { k: 'ai', level: 'beginner' }], clock, ai: localAi() });
    h.start();
    const random = rand(5);
    for (let i = 0; i < 400 && !h.getSnapshot().view.result; i++) {
      const v = h.getSnapshot().view;
      if (v.pending) { h.commit([botAnswer(v, random)]); continue; }
      const run = pending; pending = [];
      for (const fn of run) fn();
      await new Promise((r) => setTimeout(r, 0));                   // the client's promise
    }
    expect(h.getSnapshot().error).toBeNull();
    expect(h.record().answers.some((a) => a.by === 1 && !a.auto)).toBe(true);
  }, 60_000);
});

describe('autosave and resume (§4.9)', () => {
  it('saves after every answer and resumes at the same decision, then plays on', () => {
    const store = memoryStore();
    const seats: [Seat, Seat] = [{ k: 'human' }, { k: 'ai', level: 'beginner' }];
    const onSave = (r: GameRecord, at: SaveInfo) => {
      if (at.over) { store.clear(); return; }
      store.save({ v: 1, record: r, seats: seats.map(savedSeat) as SavedGame['seats'], savedAt: 'now', title: 't',
        turn: at.turn, points: at.points });
    };
    const h = new GameHost({ setup: setupFor(31), seats, clock: now, onSave });
    h.start();
    drive(h, 60);
    const saved = store.load()!;
    expect(saved.record.answers).toEqual(h.record().answers);
    expect(resumable(saved)).toBe(true);
    const back = GameHost.fromRecord(saved.record, { seats: saved.seats as [Seat, Seat], clock: now, onSave });
    expect(back.getSnapshot().view).toEqual(h.getSnapshot().view);
    expect(back.getSnapshot().events).toEqual(h.getSnapshot().events);
    back.start();
    drive(back, 3000, rand(3));
    expect(back.getSnapshot().view.result).not.toBeNull();
    expect(store.load()).toBeNull();                                // a finished game is cleared
    expect(hashState(replay(back.record()).state)).toBeTruthy();
  }, 120_000);

  it('round-trips through storage as JSON, and survives blocked storage', () => {
    const mem: Record<string, string> = {};
    const storage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; },
      removeItem: (k: string) => { delete mem[k]; } };
    const h = new GameHost({ setup: setupFor(32), clock: now });
    const g: SavedGame = { v: 1, record: h.record(), seats: [{ k: 'human' }, { k: 'bot' }], savedAt: 'x', title: 't', turn: 0,
      points: [0, 0] };
    localStore(storage).save(g);
    expect(JSON.parse(mem[SAVE_KEY])).toEqual(g);
    expect(localStore(storage).load()).toEqual(g);
    localStore(storage).clear();
    expect(localStore(storage).load()).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); } };
    const s = localStore(blocked);
    s.save(g);
    expect(s.load()).toEqual(g);                                    // kept in memory for the session
  });
});

describe('hot-seat (§12.1)', () => {
  it('shows each seat only its own view, with a handoff between seats', () => {
    const h = new GameHost({ setup: setupFor(41), seats: [{ k: 'human' }, { k: 'human' }], clock: now });
    h.start();
    expect(h.hotseat).toBe(true);
    let handoffs = 0, checked = 0, stubs = 0;
    for (let i = 0; i < 400 && !h.getSnapshot().view.result; i++) {
      const snap = h.getSnapshot();
      if (snap.handoff !== null) {
        handoffs++;
        expect(snap.handoff).not.toBe(snap.viewer);
        expect(h.commit(['pass'])).toBe(false);                      // nobody answers before the device is passed
        h.takeOver();
        expect(h.getSnapshot().viewer).toBe(snap.handoff);
        continue;
      }
      const v = snap.view;
      expect(v.me).toBe(snap.viewer);
      const other = v.players.find((p) => p.id !== v.me)!;
      // the other seat's hand is stubs, except cards it revealed
      for (const id of other.hand) if (id >= 0) expect(v.objects[id] && 'def' in v.objects[id]).toBe(true);
      stubs += other.hand.filter((id) => id < 0).length;
      checked++;
      if (v.pending) expect(v.pending.player).toBe(v.me);
      h.commit([botAnswer(v, rand(i))]);
    }
    expect(handoffs).toBeGreaterThan(3);
    expect(checked).toBeGreaterThan(50);
    expect(stubs).toBeGreaterThan(checked);
    expect(h.record().meta.humanSeat).toBe('hotseat');
  }, 60_000);
});

describe('the table helpers of M1.4', () => {
  it('the tutorial hook restricts the clickable options to the allowed keys', () => {
    const h = new GameHost({ setup: setupFor(51), clock: now });
    h.start();
    drive(h, 40);
    const v = h.getSnapshot().view;
    const a = affordances(v, v.pending);
    const all = [...a.buttons.map((b) => b.key), ...Object.values(a.objects).flatMap((o) => o.keys)];
    const keep = all.find((k) => k !== null)!;
    const r = restrict(a, (k) => k === keep)!;
    const left = [...r.buttons.map((b) => b.key), ...Object.values(r.objects).flatMap((o) => o.keys), ...Object.values(r.lanes).flat()];
    expect(left).toEqual([keep]);
  });

  it('animations come from the observed events; the report carries the record and the log', () => {
    const fx = fxOf([{ k: 'deal', to: 5, n: 3, sources: [], combat: true, seq: 1, group: 1, vis: 3, rule: '467' },
      { k: 'points', p: 1, delta: 1, total: 2, seq: 2, group: 2, vis: 3, rule: '473' }], 1, true);
    expect(fx.objs[5]).toEqual({ k: 'hit', n: 3 });
    expect(fx.score).toEqual([1]);
    const h = new GameHost({ setup: setupFor(52), clock: now });
    const rep = rulesReport({ record: h.record(), view: h.getSnapshot().view, description: ' Tank ignored ',
      log: [{ seq: 1, text: 'x', rule: '815', who: 'game' }], at: 'now' });
    expect(rep.description).toBe('Tank ignored');
    expect(rep.log).toEqual(['x [815]']);
    expect(replay(rep.record).state.pending?.id).toBe(h.getSnapshot().view.pending?.id);
  });

  it('suggests a legal assignment step', () => {
    const h = new GameHost({ setup: setupFor(53), clock: now });
    h.start();
    let seen = 0;
    drive(h, 2500, rand(9), (v) => {
      const d = v.pending;
      if (d && (d.kind === 'assignNext' || d.kind === 'assignExcess')) {
        seen++;
        expect(d.options.map((o) => o.key)).toContain(suggestKey(v, d));
      }
    });
    expect(seen).toBeGreaterThan(0);
  }, 60_000);
});
