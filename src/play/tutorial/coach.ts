import type { Decision, ObjId, ObservedEvent, PlayerView } from '../../game/index.ts';
import type { Affordances } from '../model/affordances.ts';

/*
 * The hook a scripted tutorial plugs into (block H builds on it): a Coach
 * sees what the human sees (their view, the events they observed, their
 * pending decision) and may, per step,
 *
 *   - show a prompt (title, text, an optional Next button),
 *   - highlight cards, lanes or buttons (by object id, lane, option key),
 *   - restrict the choices: only the option keys it allows stay clickable
 *     (the engine's options themselves never change, so a tutorial can't
 *     make an illegal move legal).
 *
 * The game screen asks the coach for its step on every render and tells it
 * about every answer the human sends; the opponent of a tutorial is a
 * scripted seat of the host (Seat { k: 'script' }) on a fixed seed. Every
 * clickable element also carries data attributes (data-obj, data-key,
 * data-lane) so a script can point at anything on the table.
 */

export interface CoachHighlight {
  objs?: ObjId[];
  lanes?: (number | 'base')[];
  /** Option keys whose buttons (and cards) are highlighted. */
  keys?: string[];
}

export interface CoachStep {
  id: string;
  title?: string;
  text: string;
  highlight?: CoachHighlight;
  /** Which option keys the human may send now; all when absent. */
  allow?: (key: string) => boolean;
  /** Show a Next button (for steps that only explain). */
  next?: boolean;
  /** Where the bubble sits; the prompt bar by default. */
  anchor?: 'prompt' | 'top';
}

export interface CoachContext {
  view: PlayerView;
  events: readonly ObservedEvent[];
  decision: Decision | null;
}

export interface Coach {
  step(ctx: CoachContext): CoachStep | null;
  /** The Next button of a step was pressed. */
  onNext?(step: CoachStep): void;
  /** The human answered (after the host accepted the keys). */
  onAnswer?(keys: readonly string[], ctx: CoachContext): void;
}

/** Affordances with only the allowed keys left clickable. */
export function restrict(a: Affordances | null, allow: ((key: string) => boolean) | undefined): Affordances | null {
  if (!a || !allow) return a;
  const objects: Affordances['objects'] = {};
  for (const [id, o] of Object.entries(a.objects)) {
    const keys = o.keys.filter(allow);
    if (keys.length > 0 || o.selected) objects[Number(id)] = { ...o, keys };
  }
  const lanes: Affordances['lanes'] = {};
  for (const [lane, keys] of Object.entries(a.lanes)) {
    const ok = (keys ?? []).filter(allow);
    if (ok.length > 0) lanes[lane === 'base' ? 'base' : Number(lane)] = ok;
  }
  const players: Affordances['players'] = {};
  for (const [p, keys] of Object.entries(a.players)) {
    const ok = (keys ?? []).filter(allow);
    if (ok.length > 0) players[Number(p) as 0 | 1] = ok;
  }
  return { ...a, objects, lanes, players, buttons: a.buttons.filter((b) => b.key === null || allow(b.key)) };
}
