import type { Affordances } from '../model/affordances.ts';
import type { CardSlot } from '../model/board.ts';

/*
 * What the table needs to let the human answer by clicking (§12.5): the
 * affordances of their pending decision and a way to send one key. Cards
 * that answer it glow; lanes and the base get a button.
 */
export interface Acts {
  a: Affordances | null;
  /** Why a card can't be used now (§12.7), by object. */
  why?: Record<number, string>;
  send: (key: string) => void;
}

/** The click handler for a card, when tapping it answers the decision. */
export function actOn(acts: Acts | undefined, slot: CardSlot): ((s: CardSlot) => void) | undefined {
  const keys = acts?.a?.objects[slot.id]?.keys ?? [];
  if (keys.length === 0) return undefined;
  return () => acts!.send(keys[0]);
}

const LANE_LABEL: Record<string, string> = {
  moveDest: 'Move here', location: 'Play here', chooseBattlefield: 'Choose', destination: 'Move here', hideWhere: 'Hide here',
};

/** The buttons a lane (or the base, 'base') gets. */
export function laneButtons(acts: Acts | undefined, lane: number | 'base', kind: string | undefined) {
  const keys = acts?.a?.lanes[lane] ?? [];
  return keys.map((key) => ({ key, label: LANE_LABEL[kind ?? ''] ?? 'Choose' }));
}
