/*
 * The turn (§5.4, Spec C §5, [314–317]): turn start, the phases and their
 * steps, the tasks each phase makes outstanding, and the turn handoff.
 *
 *   Awaken     [315.1]  the Turn Player readies everything they control
 *   Beginning  [315.2]  Beginning Step ("at the start of your Beginning
 *                       Phase" effects), then the Scoring Step: the Turn
 *                       Player Holds every battlefield they control
 *   Channel    [315.3]  channel 2 runes; the second player channels 3 in
 *                       their first Channel Phase in a Duel [487.7]
 *   Draw       [315.4]  draw 1 (Burn Out from an empty deck [432])
 *   Main       [316]    every Rune Pool empties, start-of-Main effects, then
 *                       the Turn Player acts until they end the turn [316.9]
 *   Ending     [317]    Ending Step, then the Expiration Step: an ending
 *                       cleanup, repeated while anything went through FEPR
 *                       [317.2.e–f]; then the next queued turn [317.3]
 *
 * Every transition between phases, and between the steps inside one, makes
 * a normal cleanup outstanding before the new phase's tasks [319.2] (Spec C
 * Q10): that is the cleanup in which a battlefield held only by Temporary
 * units is lost before scoring [816.1.b]. The master loop moves on by
 * itself in every phase but the Main Phase once nothing is outstanding,
 * pending or ongoing [335] (core/loop.ts).
 */
import { K, parseKey } from '../core/decisions.ts';
import { endGame } from '../core/end.ts';
import { emit } from '../core/events.ts';
import { answer, ask } from '../core/frames.ts';
import { emptyTurnLog } from '../state/blank.ts';
import { hasBit } from '../state/ids.ts';
import { resetDecisionCount, setField } from '../state/mut.ts';
import type { GameState, Phase, PhaseTaskId, Step, Task } from '../state/types.ts';
import { channelRunes, drawCards, emptyPools, ready } from './actions.ts';
import { channelCount, drawCount, turnOrder } from './defaults.ts';
import { score } from './scoring.ts';
import { fire } from '../abilities/triggers.ts';
import { defineTask, enqueue } from './tasks.ts';
import { isType } from './chars.ts';
import { staticsFor } from '../layers/derive.ts';

type X = { present: boolean };

/** The tasks a phase or step makes outstanding as it begins. */
const TASKS: Partial<Record<`${Phase}/${Step}`, PhaseTaskId[]>> = {
  'awaken/none': ['awaken.readyAll'],
  'beginning/beginningStep': ['beginning.startEffects'],
  'beginning/scoring': ['scoring.holdAll'],
  'channel/none': ['channel.channel'],
  'draw/none': ['draw.draw'],
  'main/none': ['main.emptyPools', 'main.startEffects'],
  'ending/endingStep': ['ending.endOfTurnEffects'],
};

const RULE: Partial<Record<Phase | Step, string>> = {
  awaken: '315.1', beginningStep: '315.2.a', scoring: '315.2.b', channel: '315.3', draw: '315.4', main: '316',
  endingStep: '317.1', expiration: '317.2',
};

/** Begins a phase or step: the transition's cleanup, then its tasks [319.2]. */
export function enterPhase(s: GameState, x: X, phase: Phase, step: Step) {
  setField(s, s.turn, 'phase', phase);
  setField(s, s.turn, 'step', step);
  setField(s, s.turn, 'priority', null);
  emit(s, x, { k: 'phase', phase, step, rule: RULE[step] ?? RULE[phase] ?? '314' });
  if (phase === 'ending' && step === 'endingStep') {
    // "Until your next Ending Phase": such permissions end as the Turn Player's Ending Phase begins (Radiance FAQ).
    const p = s.turn.player;
    const ends = (e: (typeof s.effects)[number]) => typeof e.until === 'object' && (e.until as { untilEnding?: number }).untilEnding === p;
    if (s.effects.some(ends)) setField(s, s, 'effects', s.effects.filter((e) => !ends(e)));
  }
  const tasks: Task[] = [{ t: 'cleanup', v: 'normal' }];
  for (const id of TASKS[`${phase}/${step}`] ?? []) tasks.push({ t: 'phase', id });
  if (phase === 'ending' && step === 'expiration') {
    // [317.2.a]: the Ending Special Cleanup, then the check that returns to
    // the start of the step if anything went through FEPR [317.2.e–f].
    setField(s, s.turn.expiration, 'feprHappened', false);
    tasks.push({ t: 'cleanup', v: 'ending' }, { t: 'expirationCheck' });
  }
  enqueue(s, ...tasks);
}

/**
 * Moves on when nothing is left to do in the current phase or step [305],
 * [335]: the next step, phase or turn. The Main Phase ends only when the
 * Turn Player says so (endMainPhase, [316.9]); the Expiration Step hands the
 * turn over from its own check.
 */
export function advance(s: GameState, x: X) {
  const { phase, step } = s.turn;
  switch (phase) {
    case 'setup': return startTurn(s, x);                            // [118]
    case 'awaken': return enterPhase(s, x, 'beginning', 'beginningStep');
    case 'beginning': return step === 'beginningStep' ? enterPhase(s, x, 'beginning', 'scoring')
      : enterPhase(s, x, 'channel', 'none');
    case 'channel': return enterPhase(s, x, 'draw', 'none');
    case 'draw': return enterPhase(s, x, 'main', 'none');
    case 'main': return endMainPhase(s, x);
    case 'ending': return step === 'endingStep' ? enterPhase(s, x, 'ending', 'expiration') : startTurn(s, x);
  }
}

/** The Turn Player ends the turn: the Main Phase ends and the Ending Phase
    begins [316.9.a–b]. */
export function endMainPhase(s: GameState, x: X) {
  enterPhase(s, x, 'ending', 'endingStep');
}

/**
 * The next queued turn begins [317.3], [306]: its player becomes the Turn
 * Player (an Additional Turn waits at the front of the queue [735], [738]);
 * the per-turn memory is reset: the turn log, "once each turn" counters
 * [383.3.e], moves this turn, who scored each battlefield [472]. A game
 * past the turn limit ends as a rules loop (§8).
 */
export function startTurn(s: GameState, x: X) {
  const queue = s.turn.queue.length > 0 ? s.turn.queue : turnOrder(s).map((player) => ({ player, additional: false }));
  const [head, ...rest] = queue;
  const n = s.turn.n + 1;
  if (n > s.rules.turnLimit) {
    endGame(s, x, { winner: null, reason: 'loop', rule: 'turnLimit (§8)', turn: s.turn.n });
    return;
  }
  setField(s, s.turn, 'queue', rest.length > 0 ? rest : turnOrder(s).map((player) => ({ player, additional: false })));
  setField(s, s.turn, 'player', head.player);
  setField(s, s.turn, 'additional', head.additional);
  setField(s, s.turn, 'n', n);
  setField(s, s.turn, 'expiration', { loops: 0, feprHappened: false });
  setField(s, s.history.turnsTaken, head.player, s.history.turnsTaken[head.player] + 1);
  setField(s, s, 'log', emptyTurnLog(n, s.players.length));
  setField(s, s, 'usage', {});
  for (const o of Object.values(s.objects)) if (o.moves !== 0) setField(s, o, 'moves', 0);
  for (const b of s.bfs) setField(s, b, 'scoredBy', 0);
  resetDecisionCount(s);
  emit(s, x, { k: 'turnStart', p: head.player, n, additional: head.additional, rule: '317.3' });
  enterPhase(s, x, 'awaken', 'none');
}

// ---- the phase tasks ----

/** [315.1.b]: the Turn Player readies every game object they control that
    can be readied (units, gear, runes, legend), as one Ready action. */
defineTask('awaken.readyAll', [(s, _f, x) => {
  const p = s.turn.player;
  const mine = Object.values(s.objects).filter((o) =>
    o.controller === p && o.exhausted && ['base', 'bf', 'legend'].includes(o.zone.z) && s.bfs.every((b) => b.obj !== o.id)
    // Firebrand Raider: "Units don't ready during the Awaken Phase."
    && !(isType(o, 'unit') && staticsFor(s, null, 'noAwakenReady').length > 0));
  ready(s, x, mine.map((o) => o.id), '315.1.b');
  return 'done';
}]);

/** [315.2.a]: "at the start of your Beginning Phase" effects trigger
    (phase triggers, abilities/triggers.ts); the count of Beginning Phases
    begun ("first Beginning Phase", [190.6.b]) is kept. */
defineTask('beginning.startEffects', [(s, _f, x) => {
  const p = s.turn.player;
  setField(s, s.history.beginningPhasesStarted, p, s.history.beginningPhasesStarted[p] + 1);
  // a Limited deck with no Legend and no Chosen Champion: one card more, once (TR 602.4.a.5.b)
  if (s.history.beginningPhasesStarted[p] === 1 && s.players[p].limitedDraw) drawCards(s, x, p, 1, 'TR 602.4.a.5.b');
  fire(s, x, { e: 'phase', at: 'beginning', p });
  return 'done';
}]);

/**
 * [315.2.b.2]: the Turn Player Holds every battlefield they control, one
 * Scoring each [471.2], in an order they choose when there are several
 * (Spec G Q11).
 */
defineTask('scoring.holdAll', [(s, f, x) => {
  const p = s.turn.player;
  const held = s.bfs.map((b, bf) => ({ b, bf })).filter(({ b }) => b.controller === p && !hasBit(b.scoredBy, p))
    .map(({ bf }) => bf);
  if (held.length === 0) return 'done';
  let bf = held[0];
  if (held.length > 1) {
    const key = answer(f);
    if (key === undefined) {
      return ask(s, f, x, {
        player: p, kind: 'chooseBattlefield', prompt: { t: 'holdOrder' }, ctx: { rule: '315.2.b.2' },
        options: held.map((i) => ({ key: K.bf(i), refs: [{ loc: { z: 'bf', bf: i } }] })), privateOptions: false,
      });
    }
    bf = parseKey(key)!.n!;
  }
  score(s, x, p, bf, 'hold');
  return 'continue';                                                 // the next battlefield, if any
}]);

/** [315.3.b]: channel 2 runes, as many as possible [315.3.b.1]; one more for
    the second player's first Channel Phase in a Duel [487.7]. */
defineTask('channel.channel', [(s, _f, x) => {
  const p = s.turn.player;
  const n = channelCount(s, p);
  channelRunes(s, x, p, n, n > 2 ? '487.7' : '315.3.b');
  setField(s, s.history.channelPhasesTaken, p, s.history.channelPhasesTaken[p] + 1);
  return 'done';
}]);

/** [315.4.b]: draw 1; an empty Main Deck burns out, then the draw goes on [315.4.b.1–2]. */
defineTask('draw.draw', [(s, _f, x) => {
  // Endless Riches: "Skip your Draw Phase."
  if (staticsFor(s, null, 'skipDraw').some(({ st }) => st.ctl === s.turn.player)) return 'done';
  drawCards(s, x, s.turn.player, drawCount(s, s.turn.player), '315.4.b');
  return 'done';
}]);

/** [316.3]: every player's Rune Pool empties, not only the Turn Player's [167]. */
defineTask('main.emptyPools', [(s, _f, x) => {
  emptyPools(s, x, '316.3');
  return 'done';
}]);

/** [316.4] and [317.1.a]: "at the start of your Main Phase" and "at the end
    of your turn" effects trigger. */
defineTask('main.startEffects', [(s, _f, x) => {
  fire(s, x, { e: 'phase', at: 'mainStart', p: s.turn.player });
  return 'done';
}]);
defineTask('ending.endOfTurnEffects', [(s, _f, x) => {
  fire(s, x, { e: 'phase', at: 'endOfTurn', p: s.turn.player });
  return 'done';
}]);

/**
 * [317.2.e–f]: if any chain item was finalized or resolved during the
 * Expiration Step, the step starts again; otherwise the turn ends and the
 * next queued turn begins [317.3]. A step that keeps repeating ends the game
 * as a rules loop (§8 expirationLoopCap, Spec C Q13).
 */
defineTask('expirationCheck', [(s, _f, x) => {
  if (!s.turn.expiration.feprHappened) {
    startTurn(s, x);
    return 'done';
  }
  const loops = s.turn.expiration.loops + 1;
  if (loops > s.rules.expirationLoopCap) {
    endGame(s, x, { winner: null, reason: 'loop', rule: 'expirationLoopCap (§8)', turn: s.turn.n });
    return 'continue';
  }
  setField(s, s.turn.expiration, 'loops', loops);
  enterPhase(s, x, 'ending', 'expiration');
  return 'done';
}]);
