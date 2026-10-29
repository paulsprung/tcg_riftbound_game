/*
 * Showdowns (§5.8, Spec C §9, [341–348]).
 *
 *   begin   cleanup step 9 [323.11], [344]: the player who applied
 *           Contested gains Focus [345] (and Priority, which the master
 *           loop awards once the cleanup is over [320.1]).
 *   pass    the Focus holder passes: Focus to the next player [347.2.b];
 *           once every player has passed in sequence without playing a card
 *           or activating an ability, the showdown closes [347.2.a], [348].
 *   close   a combat showdown hands over to the Damage Step [348.1]; after a
 *           non-combat showdown, a lone player with units there who doesn't
 *           control it establishes control, a Conquer if they haven't
 *           scored it this turn [348.2.a], [348.2.a.1]. Contested is cleared
 *           with it (Spec C Q1); with nobody there, step 8 of the next
 *           cleanup removes it [190.3.b.1].
 */
import { emit } from '../core/events.ts';
import { setField } from '../state/mut.ts';
import type { GameState } from '../state/types.ts';
import { nextPlayer, playersWithUnitsAt } from './board.ts';
import { establishControl } from './scoring.ts';
import { requestCleanup } from './tasks.ts';
import { fire } from '../abilities/triggers.ts';

type X = { present: boolean };

/** A non-combat showdown begins at a battlefield [344.2]. */
export function beginShowdown(s: GameState, x: X, bf: number) {
  const b = s.bfs[bf];
  setField(s, b.staged, 'showdown', false);
  setField(s, s, 'showdown', { bf, kind: 'nonCombat' });
  setField(s, s.turn, 'focus', b.contested);                         // [345]
  setField(s, s.turn, 'focusPasses', 0);
  emit(s, x, { k: 'showdownStart', bf, rule: '344' });
  emit(s, x, { k: 'focus', p: b.contested, rule: '345' });
  fire(s, x, { e: 'showdown', bf });                                 // "When a showdown begins here"
}

/** The Focus holder passes [347.2]. */
export function passFocus(s: GameState, x: X) {
  const passes = s.turn.focusPasses + 1;
  setField(s, s.turn, 'focusPasses', passes);
  setField(s, s.turn, 'priority', null);
  if (passes < s.players.length) {
    const p = nextPlayer(s, s.turn.focus!);
    setField(s, s.turn, 'focus', p);                                 // [347.2.b]
    emit(s, x, { k: 'focus', p, rule: '347.2.b' });
  }
}

/** Every player passed Focus in sequence: the showdown closes [348]. */
export function closeShowdown(s: GameState, x: X) {
  const sd = s.showdown!;
  setField(s, s, 'showdown', null);
  setField(s, s.turn, 'focus', null);                                // [313.5]
  setField(s, s.turn, 'priority', null);
  setField(s, s.turn, 'focusPasses', 0);
  emit(s, x, { k: 'showdownEnd', bf: sd.bf, rule: '348' });
  if (sd.kind === 'combat') {
    // [348.1]: the combat goes on with its Damage Step, as its next task.
    setField(s, s.combat!, 'step', 'damage');
    setField(s, s.combat!, 'next', 'damage');
  } else {
    const present = playersWithUnitsAt(s, sd.bf);
    if (present.length === 1 && s.bfs[sd.bf].controller !== present[0]) {
      establishControl(s, x, sd.bf, present[0], '348.2.a');
    }
  }
  requestCleanup(s);                                                 // Spec C Q9
}
