/*
 * Why a card or ability can't be used right now (§12.7), for the UI's
 * tooltips. It runs on the viewer's own information only: the view with
 * every unknown object a vanilla placeholder (blankFill), so the answer
 * never depends on a card the viewer can't see. An empty list means the
 * object is usable now (its option is in the viewer's pending decision).
 */
import { cardDef } from '../cards/registry.ts';
import type { ObjId } from '../state/types.ts';
import { activatedOf, canActivate } from '../play/playAbility.ts';
import { choicesPossible } from '../play/choices.ts';
import { costOf, playable, playLocations, resourceCost } from '../play/playCard.ts';
import { cheapestCost } from '../play/cost.ts';
import { isType } from '../rules/chars.ts';
import { paymentPlans } from '../rules/resources.ts';
import { cardTiming, windowAllows, type Window } from '../rules/timing.ts';
import type { Reason } from './decisions.ts';
import { blankFill, type PlayerView } from './view.ts';
import { findCard } from '../cards/oracle.ts';

const r = (text: string, rule: string): Reason => ({ text, rule });

export function explainUnavailable(v: PlayerView, obj: ObjId): Reason[] {
  const s = blankFill(v);
  const me = v.me;
  const o = s.objects[obj];
  if (!o || o.def === 'placeholder') return [r('You can\'t see this card.', '108.7.c')];
  const d = v.pending;
  if (d?.options.some((op) => op.refs?.some((ref) => 'obj' in ref && ref.obj === obj))) return [];
  const prio = d?.kind === 'priority' ? (d.prompt.window as Window) : null;
  const out: Reason[] = [];
  if (prio === null) {
    out.push(d ? r('Finish the current choice first.', '312.1.b.1')
      : r(v.turn.priority === me ? 'Wait for your decision.' : 'You don\'t have priority.', '312'));
  }
  const w: Window = prio ?? 'main';
  const fromHand = s.players[me].hand.includes(obj) || s.players[me].champion === obj;
  if (fromHand) {
    if (!playable(s, obj)) out.push(r('This spell isn\'t playable: its text is not implemented.', '§9.1'));
    else if (!windowAllows(w, cardTiming(o.def))) {
      out.push(w === 'chain' ? r('Only cards with [Reaction] can be played on a chain.', '309.1.a')
        : r('Only cards with [Action] or [Reaction] can be played in a showdown.', '308.1.a'));
    }
    if (paymentPlans(s, me, cheapestCost(s, obj, me, costOf(s, obj)), { limit: 1 }).length === 0) {
      out.push(r('You can\'t pay its cost.', '203.3'));
    }
    if (isType(o, 'spell') && !choicesPossible(s, cardDef(o.def)?.spell, { controller: me, source: null })) {
      out.push(r('It has no legal targets now.', '355.16'));
    }
    if (!isType(o, 'spell') && playLocations(s, obj, me).length === 0) out.push(r('There is nowhere to play it.', '355.2'));
    return out.length > 0 ? out : [r('It can\'t be played right now.', '358')];
  }
  const acts = activatedOf(o.def);
  if (acts.length > 0) {
    if (o.controller !== me) return [r('You don\'t control it.', '378')];
    for (const a of acts) {
      if (canActivate(s, me, obj, a, w)) continue;
      if (a.cost.exhaustSelf && o.exhausted) out.push(r('It is exhausted.', '415.4'));
      else if (paymentPlans(s, me, resourceCost(a.cost, findCard(o.def)?.domains ?? []), { limit: 1 }).length === 0) {
        out.push(r('You can\'t pay its cost.', '203.3'));
      } else if (!choicesPossible(s, a.effect, { controller: me, source: obj })) out.push(r('It has no legal targets now.', '403.3'));
      else out.push(r('Its timing doesn\'t allow it now.', '381'));
    }
    return out;
  }
  return out.length > 0 ? out : [r('Nothing to do with it right now.', '411')];
}
