import { parseKey, type Decision, type ObjId, type PlayerId, type PlayerView } from '../../game/index.ts';

/*
 * What the human may click, derived from their pending decision alone
 * (§12.5): clickable means "this sends an option key", so the UI can't
 * offer anything the engine wouldn't accept.
 *
 * A batch (§4.7) is drafted in one widget: `draft` holds the keys picked
 * so far, and `d` is the decision those picks lead to, from the host's
 * preview (null once the draft completes the batch), and `first` the
 * batch's first decision, which names the batch when `d` is gone. Drafted
 * objects show as selected; taking one back is a UI edit of the draft,
 * not a key.
 */

export interface ObjectAffordance {
  /** Keys that tapping the object sends (or adds to the draft). */
  keys: string[];
  style: 'select' | 'toggle' | 'order';
  /** In the draft already. */
  selected?: boolean;
  badge?: string;
}

export interface Button {
  /** The option key the button answers with; null when it only commits
      the draft, which already completes the batch. */
  key: string | null;
  label: string;
  primary?: boolean;
  hotkey?: string;
  /** Everything the button sends, in order: the draft, then its key. */
  commit: string[];
}

export interface Affordances {
  /** The decision in words. */
  prompt: string;
  /** The rule the decision implements (P12). */
  rule: string;
  objects: Record<ObjId, ObjectAffordance>;
  lanes: Partial<Record<number | 'base', string[]>>;
  players: Partial<Record<PlayerId, string[]>>;
  buttons: Button[];
}

const META_LABEL: Record<string, string> = {
  pass: 'Pass', end: 'End turn', done: 'Done', yes: 'Yes', no: 'No', decline: 'Don\'t pay', back: 'Back',
  manualPay: 'Pay manually', first: 'Play first', second: 'Play second', move: 'Move units', tank: 'As Tank',
  backline: 'As Backline',
};

/** The decision's prompt in words. */
export function promptText(d: Pick<Decision, 'kind' | 'prompt'>): string {
  switch (d.kind) {
    case 'playOrder': return 'You were picked at random to choose: play first or second?';
    case 'mulligan': {
      const max = typeof d.prompt.max === 'number' ? d.prompt.max : 2;
      return `Choose up to ${max} cards to set aside. You draw that many, then they go to the bottom of your deck.`;
    }
    case 'priority':
      if (d.prompt.window === 'main') return 'Your turn: play a card from your hand, move units, or end the turn.';
      if (d.prompt.window === 'showdown') return 'Showdown: you have Focus. Play an Action, or pass.';
      return 'You have priority on the chain: respond, or pass.';
    case 'location': return 'Where should the unit enter? Your base, or a battlefield you control.';
    case 'payment': {
      const e = typeof d.prompt.energy === 'number' ? d.prompt.energy : 0;
      const power = Array.isArray(d.prompt.power) ? d.prompt.power.length : 0;
      return `Pay ${e} Energy${power > 0 ? ` and ${power} Power` : ''}: choose how.`;
    }
    case 'moveUnits': return 'Choose the units to move (all go to the same place), then Done.';
    case 'moveDest': return 'Choose where they move: a battlefield, or back to base.';
    case 'chooseBattlefield':
      return d.prompt.t === 'holdOrder' ? 'You hold several battlefields: which scores first?'
        : 'Several battlefields are waiting: choose where the showdown or combat happens first.';
    case 'assignNext': return `Assign your ${d.prompt.left} combat damage: choose the next enemy unit (lethal damage, in order).`;
    case 'assignExcess': return `Every enemy unit has lethal damage: place the remaining ${d.prompt.left}.`;
    case 'assignTier': return 'This unit has Tank and Backline: which counts for your assignment?';
    default: return `Choose (${d.kind})`;
  }
}

function buttonLabel(d: Decision, key: string, draft: readonly string[]): string {
  if (d.kind === 'mulligan' && key === 'done') {
    return draft.length === 0 ? 'Keep my hand' : `Set aside ${draft.length}`;
  }
  const k = parseKey(key);
  if (k?.head === 'pay' && k.n !== undefined) {
    const plans = Array.isArray(d.prompt.plans) ? d.prompt.plans : [];
    return `Pay: ${String(plans[k.n] ?? `plan ${k.n + 1}`)}`;
  }
  if (d.kind === 'assignExcess' && key === 'done') return 'Rest on the last one';
  return META_LABEL[key] ?? key;
}

const PRIMARY = ['done', 'first', 'pass', 'yes', 'pay:0'];

export function affordances(
  view: PlayerView, d: Decision | null, draft: readonly string[] = [], first: Decision | null = d,
): Affordances {
  const shown = d ?? first;
  const out: Affordances = {
    prompt: shown ? promptText(shown) : '', rule: shown?.ctx.rule ?? '', objects: {}, lanes: {}, players: {}, buttons: [],
  };
  for (const key of draft) {
    const obj = parseKey(key)?.obj;
    if (obj !== undefined) out.objects[obj] = { keys: [], style: 'toggle', selected: true };
  }
  if (!d) {
    if (draft.length > 0) {                                           // the draft completes its batch
      const label = first?.kind === 'mulligan' ? `Set aside ${draft.length}` : 'Confirm';
      out.buttons.push({ key: null, label, primary: true, hotkey: 'Enter', commit: [...draft] });
    }
    return out;
  }
  if (d.player !== view.me) throw new Error(`decision ${d.id} is P${d.player}'s, not the viewer's`);
  for (const o of d.options) {
    const k = parseKey(o.key);
    if (!k) continue;
    if (k.obj !== undefined) {
      const prev = out.objects[k.obj];
      out.objects[k.obj] = { keys: [...(prev?.keys ?? []), o.key], style: d.batch ? 'toggle' : 'select' };
    } else if (k.loc !== undefined) {
      const lane = k.loc === 'base' ? 'base' : k.loc.bf;
      (out.lanes[lane] ??= []).push(o.key);
    } else if (k.head === 'bf' && k.n !== undefined) {
      (out.lanes[k.n] ??= []).push(o.key);
    } else if (k.player !== undefined) {
      (out.players[k.player] ??= []).push(o.key);
    } else {
      const primary = PRIMARY.includes(o.key);
      out.buttons.push({
        key: o.key, label: buttonLabel(d, o.key, draft), primary: primary || undefined,
        hotkey: primary ? 'Enter' : o.key === 'back' ? 'Escape' : undefined, commit: [...draft, o.key],
      });
    }
  }
  return out;
}
