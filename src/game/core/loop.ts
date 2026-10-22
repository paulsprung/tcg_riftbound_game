/*
 * The master loop: HOT FEPR (§5.2, Spec C §6.2, [332–340]). When no frame
 * is active, the first row that applies is done, then the driver runs on:
 *
 *   H   an Outstanding Task: run it, oldest first [334], [333]
 *   F   a pending chain item: finalize it [337.1] (only limited plays and
 *       triggers leave one outside its play frame: M1.2)
 *   E/P the chain is not empty and not everyone has passed: priority to
 *       the controller of the newest item if nobody holds it [312.2.c],
 *       [337.4]; ask it [338]
 *   R   everyone passed in sequence: resolve the newest item [339.1], [340]
 *       (spells and abilities, M1.2)
 *   S   a showdown, not everyone passed Focus: the Focus holder gets
 *       priority [335.1], [313.2]; S′ once everyone has, it closes [348]
 *   C   a combat whose showdown has closed: its next step [467], [468]
 *   M   the Main Phase, Neutral Open: the Turn Player gets priority [335],
 *       [312.2.a]
 *   N   otherwise nobody has priority; the next step, phase or turn [305]
 *
 * A priority decision is asked from a 'priority' frame (answers go to the
 * top frame). Its answers: pass ([338.1.b], [339]; in a showdown with an
 * empty chain, Focus moves on [347.2]); play a card; Standard Move; end
 * the turn [316.9]. M1.1 offers what a vanilla duel has: units and gear at
 * default timing, the move, the end of the turn, and passing.
 */
import { K, parseKey, type Option } from './decisions.ts';
import { answer, ask, call, defineLoop, defineSteps, taskFrame, type FrameOf } from './frames.ts';
import { NotImplementedError } from './errors.ts';
import { pushFrame, setField, takeTask } from '../state/mut.ts';
import type { GameState } from '../state/types.ts';
import { costOf, playableCards, playFrame } from '../play/playCard.ts';
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
  if (s.chain.some((i) => i.status === 'pending')) {                              // F
    throw new NotImplementedError('finalizing a pending item outside its play', 'limited plays and triggers (M1.2)');
  }
  const players = s.players.length;
  if (s.chain.length > 0) {
    if (t.passes >= players) throw new NotImplementedError('resolving a chain item', 'spells and abilities (M1.2)');   // R
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
  if (window !== 'main') return [{ key: K.pass }];          // Action / Reaction cards and abilities: M1.2
  const out: Option[] = playableCards(s, p).map((id) => {
    const c = costOf(s, id);
    return { key: K.play(id), refs: [{ obj: id }], meta: { cost: { energy: c.energy, power: c.power, other: [] },
      timing: 'default' as const } };
  });
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
    return call(s, f, playFrame(parseKey(key)!.obj!));                            // [420.2]
  },
  () => 'done',
]);
