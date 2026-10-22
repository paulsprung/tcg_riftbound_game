import { parseKey, type Decision, type DefId, type ObjId, type PlayerId, type PlayerView } from '../../game/index.ts';

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

/** A card's name for prompts; the UI passes the card index's. */
export type Names = (def: DefId) => string;
const plainName: Names = (def) => def;
/** The card an ability id names ('strigian-oracle#0' → 'strigian-oracle'). */
const defOf = (id: unknown) => (typeof id === 'string' ? (id.includes('#') ? id.slice(0, id.indexOf('#')) : id) : '');

/** The decision's prompt in words. */
export function promptText(d: Pick<Decision, 'kind' | 'prompt'>, names: Names = plainName): string {
  const card = defOf(d.prompt.card);
  switch (d.kind) {
    case 'playOrder': return 'You were picked at random to choose: play first or second?';
    case 'mulligan': {
      const max = typeof d.prompt.max === 'number' ? d.prompt.max : 2;
      return `Choose up to ${max} cards to set aside. You draw that many, then they go to the bottom of your deck.`;
    }
    case 'priority':
      if (d.prompt.window === 'main') return 'Your turn: play a card from your hand, move units, or end the turn.';
      if (d.prompt.window === 'showdown') return 'Showdown: you have Focus. Play an Action or a Reaction, or pass.';
      return 'You have priority on the chain: play a Reaction, or pass to let the newest item resolve.';
    case 'location': return card ? `Where should ${names(card)} enter?` : 'Where should it enter?';
    case 'payment': {
      const e = typeof d.prompt.energy === 'number' ? d.prompt.energy : 0;
      const power = Array.isArray(d.prompt.power) ? d.prompt.power.length : 0;
      return `${card ? `${names(card)}: pay` : 'Pay'} ${e} Energy${power > 0 ? ` and ${power} Power` : ''}: choose how.`;
    }
    case 'target': {
      const max = typeof d.prompt.max === 'number' ? d.prompt.max : 1;
      const chosen = typeof d.prompt.chosen === 'number' ? d.prompt.chosen : 0;
      const what = d.prompt.harm ? 'a target' : 'a unit';
      return `${names(card)}: choose ${max > 1 ? `up to ${max} units (${chosen} chosen)` : what}.`;
    }
    case 'mode': {
      const pick = typeof d.prompt.pick === 'number' ? d.prompt.pick : 1;
      const chosen = Array.isArray(d.prompt.chosen) ? d.prompt.chosen.length : 0;
      return `${names(card)}: choose ${pick - chosen} more mode${pick - chosen === 1 ? '' : 's'}.`;
    }
    case 'may': return `Use ${names(defOf(d.prompt.ability))}'s ability?`;
    case 'orderTriggers':
      return 'Several of your abilities trigger at once: choose the one to put on the chain first (it resolves last).';
    case 'predict': return 'Predict: keep the top card of your Main Deck, or recycle it to the bottom.';
    case 'pickCard': return d.prompt.t === 'discard' ? 'Choose a card to discard.' : 'Choose the card to draw.';
    case 'addAbility': return 'Pay rune by rune: tap runes to add Energy or Power, then Done.';
    case 'moveUnits': return 'Choose the units to move (all go to the same place), then Done.';
    case 'moveDest': return 'Choose where they move: a battlefield, or back to base.';
    case 'chooseBattlefield':
      return d.prompt.t === 'holdOrder' ? 'You hold several battlefields: which scores first?'
        : 'Several battlefields are waiting: choose where the showdown or combat happens first.';
    case 'assignNext': return `Assign your ${d.prompt.left} combat damage: choose the next enemy unit (lethal damage, in order).`;
    case 'assignExcess': return `Every enemy unit has lethal damage: place the remaining ${d.prompt.left}.`;
    case 'assignTier': return 'This unit has Tank and Backline: which counts for your assignment?';
    case 'showOff': return `${names(card)}: Show Off? Reveal a card from your hand or pick a friendly card on the board.`;
    case 'optionalCost': {
      const ab = defOf(d.prompt.ability);
      return ab === card ? `${names(card)}: pay its optional additional cost (it then costs less)?`
        : `${names(card)}: use ${names(ab)}'s additional cost to make it cheaper?`;
    }
    case 'costObject': {
      const n = typeof d.prompt.n === 'number' ? d.prompt.n : 1;
      const chosen = typeof d.prompt.chosen === 'number' ? d.prompt.chosen : 0;
      const verb = d.prompt.what === 'kill' ? 'kill' : 'exhaust';
      return `${names(card)}: choose ${n > 1 ? `${n - chosen} more units` : 'a unit'} to ${verb} as part of its cost.`;
    }
    case 'applyReplacement': {
      const tok = typeof d.prompt.token === 'string' ? names(d.prompt.token) : 'a token';
      const instead = typeof d.prompt.with === 'string' ? names(d.prompt.with) : 'another token';
      return `${names(defOf(d.prompt.ability))}: play a ${instead} instead of the ${tok}?`;
    }
    default: return `Choose (${d.kind})`;
  }
}

function buttonLabel(d: Decision, key: string, draft: readonly string[], names: Names, view: PlayerView): string {
  if (d.kind === 'mulligan' && key === 'done') {
    return draft.length === 0 ? 'Keep my hand' : `Set aside ${draft.length}`;
  }
  const k = parseKey(key);
  if (k?.head === 'pay' && k.n !== undefined) {
    const plans = Array.isArray(d.prompt.plans) ? d.prompt.plans : [];
    return `Pay: ${String(plans[k.n] ?? `plan ${k.n + 1}`)}`;
  }
  if (d.kind === 'assignExcess' && key === 'done') return 'Rest on the last one';
  if (k?.head === 'mode' && k.n !== undefined && Array.isArray(d.prompt.labels)) {
    return String(d.prompt.labels[k.n] ?? key).replace(/\[M\]/g, 'Might');
  }
  const ref = d.options.find((o) => o.key === key)?.refs?.find((r) => 'obj' in r) as { obj: ObjId } | undefined;
  const o = ref ? view.objects[ref.obj] : undefined;
  const name = o && 'def' in o ? names(o.def) : 'a card';
  if (k?.head === 'next') return `${name} first`;
  if (k?.head === 'keep') return `Keep ${name} on top`;
  if (k?.head === 'recycle') return `Recycle ${name}`;
  if (k?.head === 'pick' && d.kind === 'showOff') return `Show off ${name}`;
  if (k?.head === 'pick' && d.kind === 'costObject') return `${d.prompt.what === 'kill' ? 'Kill' : 'Exhaust'} ${name}`;
  if (k?.head === 'pick') return d.prompt.t === 'discard' ? `Discard ${name}` : `Draw ${name}`;
  if (d.kind === 'showOff' && key === 'no') return 'Don\'t show off';
  if (d.kind === 'optionalCost') return key === 'yes' ? 'Pay it' : 'Don\'t';
  if (d.kind === 'applyReplacement') return key === 'yes' ? 'Instead' : 'Keep it';
  if (k?.head === 't') return name;
  return META_LABEL[key] ?? key;
}

/** Zones whose cards the table doesn't show: their options are buttons. */
const OFF_TABLE = ['deck', 'runeDeck', 'trash', 'banish', 'chain'];

const PRIMARY = ['done', 'first', 'pass', 'yes', 'pay:0'];

export function affordances(
  view: PlayerView, d: Decision | null, draft: readonly string[] = [], first: Decision | null = d, names: Names = plainName,
): Affordances {
  const shown = d ?? first;
  const out: Affordances = {
    prompt: shown ? promptText(shown, names) : '', rule: shown?.ctx.rule ?? '', objects: {}, lanes: {}, players: {}, buttons: [],
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
    const obj = k.obj === undefined ? undefined : view.objects[k.obj];
    if (k.obj !== undefined && (!obj || OFF_TABLE.includes(obj.zone.z))) {
      out.buttons.push({ key: o.key, label: buttonLabel(d, o.key, draft, names, view), commit: [...draft, o.key] });
    } else if (k.obj !== undefined) {
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
        key: o.key, label: buttonLabel(d, o.key, draft, names, view), primary: primary || undefined,
        hotkey: primary ? 'Enter' : o.key === 'back' ? 'Escape' : undefined, commit: [...draft, o.key],
      });
    }
  }
  return out;
}
