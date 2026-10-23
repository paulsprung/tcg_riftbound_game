/*
 * The master loop: HOT FEPR (§5.2, Spec C §6.2, [332–340]). When no frame
 * is active, the first row that applies is done, then the driver runs on:
 *
 *   H   an Outstanding Task: run it, oldest first [334], [333]
 *   F   a pending chain item: the oldest one finishes its steps [337.1],
 *       [337.1.b]: a limited play or a token from its step 2, a trigger
 *       from its step 2 (play/playCard.ts, play/playAbility.ts)
 *   E/P the chain is not empty and not everyone has passed: priority to
 *       the controller of the newest item if nobody holds it [312.2.c],
 *       [337.4]; ask it [338]
 *   R   everyone passed in sequence: the newest finalized item resolves
 *       [339.1], [340] (dsl/interp.ts)
 *   S   a showdown, not everyone passed Focus: the Focus holder gets
 *       priority [335.1], [313.2]; S′ once everyone has, it closes [348]
 *   C   a combat whose showdown has closed: its next step [467], [468]
 *   M   the Main Phase, Neutral Open: the Turn Player gets priority [335],
 *       [312.2.a]
 *   N   otherwise nobody has priority; the next step, phase or turn [305]
 *
 * A priority decision is asked from a 'priority' frame (answers go to the
 * top frame). What it offers depends on its window (rules/timing.ts):
 * in the own Main Phase, Neutral Open, any card or activated ability, the
 * Standard Move and ending the turn; on a chain, [Reaction] cards and
 * abilities, or pass ([338.1.b], [339]); holding Focus in a showdown,
 * [Action] or [Reaction] ones, or pass (Focus moves on [347.2]).
 */
import { K, parseKey, type Option } from './decisions.ts';
import { answer, ask, call, defineLoop, defineSteps, taskFrame, type FrameOf } from './frames.ts';
import { EngineError } from './errors.ts';
import { pushFrame, setField, takeTask } from '../state/mut.ts';
import type { GameState } from '../state/types.ts';
import { startResolve } from '../dsl/interp.ts';
import { activatable, activateFrame, triggerFrame } from '../play/playAbility.ts';
import { costOf, limitedPlayFrame, playableCards, playFrame, timingFrom } from '../play/playCard.ts';
import { activatedBySub } from '../abilities/objAbilities.ts';
import { hideable, hideFrame } from '../rules/hide.ts';
import { cheapestCost } from '../play/cost.ts';
import { nextPlayer } from '../rules/board.ts';
import { nextCombatStep } from '../rules/combat.ts';
import { canStandardMove, moveFrame } from '../rules/move.ts';
import { closeShowdown, passFocus } from '../rules/showdown.ts';
import { advance, endMainPhase } from '../rules/turn.ts';

type PriorityFrame = FrameOf<'priority'>;

defineLoop((s, x) => {
  const t = s.turn;
  const task = t.tasks.length > 0 ? takeTask(s) : null;
  if (task) { pushFrame(s, taskFrame(s, task)); return; }                         // H
  const pending = s.chain.find((i) => i.status === 'pending');                  // F [337.1.b]: oldest first
  if (pending) {
    if (pending.kind === 'triggered') pushFrame(s, triggerFrame(pending));
    else if (pending.kind === 'card' || pending.kind === 'token') pushFrame(s, limitedPlayFrame(pending));
    else throw new EngineError(`item ${pending.id} (${pending.kind}) is pending outside its activation`);
    return;
  }
  const players = s.players.length;
  if (s.chain.length > 0) {
    if (t.passes >= players) { startResolve(s); return; }                         // R
    if (t.priority === null) setField(s, t, 'priority', s.chain[s.chain.length - 1].controller);                       // E/P
    pushFrame(s, { f: 'priority', pc: 0, window: 'chain' });
    return;
  }
  if (s.showdown) {
    if (t.focusPasses >= players) { closeShowdown(s, x); return; }               // S′
    setField(s, t, 'priority', t.focus);                                          // S
    pushFrame(s, { f: 'priority', pc: 0, window: 'showdown' });
    return;
  }
  if (s.combat) { nextCombatStep(s); return; }                                    // C
  if (t.phase === 'main') {                                                       // M
    setField(s, t, 'priority', t.player);
    pushFrame(s, { f: 'priority', pc: 0, window: 'main' });
    return;
  }
  setField(s, t, 'priority', null);                                               // N
  advance(s, x);
});

/** What the priority holder may do now (§5.5). */
export function priorityOptions(s: GameState, window: PriorityFrame['window']): Option[] {
  const p = s.turn.priority!;
  const out: Option[] = playableCards(s, p, window).map((id) => {
    const c = cheapestCost(s, id, p, costOf(s, id));                 // what it could cost now (§4.6 cheap stage)
    const t = timingFrom(s, id);
    return { key: K.play(id), refs: [{ obj: id }], meta: { cost: { energy: c.energy, power: c.power, other: [] },
      timing: window === 'main' ? 'default' as const : t.reaction && window === 'chain' ? 'reaction' as const
        : t.action ? 'action' as const : 'reaction' as const } };
  });
  for (const a of activatable(s, p, window)) out.push({ key: K.act(a.obj, a.sub), refs: [{ obj: a.obj }] });
  if (window !== 'main') {
    out.push({ key: K.pass });
    return out;
  }
  for (const h of hideable(s, p)) out.push({ key: K.hide(h), refs: [{ obj: h }] });      // [811.1.b]
  if (canStandardMove(s, p)) out.push({ key: K.move });
  out.push({ key: K.end });
  return out;
}

const RULE = { main: '316.5', chain: '338', showdown: '347' } as const;

defineSteps('priority', [
  (s, f, x) => {
    const key = answer(f);
    if (key === undefined) {
      return ask(s, f, x, {
        player: s.turn.priority!, kind: 'priority', prompt: { t: 'priority', window: f.window },
        ctx: { rule: RULE[f.window] }, options: priorityOptions(s, f.window), privateOptions: true,
      });
    }
    if (key === K.end) { endMainPhase(s, x); return 'done'; }                   // [316.9]
    if (key === K.move) return call(s, f, moveFrame(s.turn.priority!));          // [144]
    if (key === K.pass) {
      if (f.window === 'showdown') passFocus(s, x);                               // [347.2]
      else {
        setField(s, s.turn, 'passes', s.turn.passes + 1);                        // [339]
        setField(s, s.turn, 'priority', nextPlayer(s, s.turn.priority!));
      }
      return 'done';
    }
    const k = parseKey(key)!;
    if (k.head === 'act') {                                                       // [377], [402]
      return call(s, f, activateFrame(k.obj!, activatedBySub(s, k.obj!, k.sub!)!.id));
    }
    if (k.head === 'hide') return call(s, f, hideFrame(s.turn.priority!, k.obj!));   // [422]
    return call(s, f, playFrame(k.obj!));                                         // [420.2]
  },
  () => 'done',
]);
