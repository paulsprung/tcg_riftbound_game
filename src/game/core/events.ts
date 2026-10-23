/*
 * Game events (§6.8): what happened, in order, for the log, the animations
 * and the view delta (P6). Procedures emit them as they commit changes;
 * choose() hands them to the caller and empties the queue.
 *
 * Every event carries its sequence number, the game action it belongs to
 * (`group`: events of one group happened at the same time), who may see the
 * identities it mentions (`vis`), and the rule it implements (P12).
 * observe() (core/view.ts) blanks what a viewer outside `vis` may not see.
 *
 * The whole union is declared now; M0 emits gameStart, gameOver,
 * battlefieldsChosen, playOrder, mulligan, deciding, zone, draw, recycle
 * and shuffle. The rest arrive with the procedures that cause them.
 */
import { allMask } from '../state/ids.ts';
import { mint, pushEvent } from '../state/mut.ts';
import type {
  ChainItem, CombatState, DefId, GameResult, GameState, ItemId, Loc, Mask, ObjId, Outcome, Phase, PlayerId, RunePool,
  Step, Zone,
} from '../state/types.ts';
import type { DecisionStub } from './decisions.ts';
import { knows } from './view.ts';
import { copyJson } from '../state/clone.ts';

export interface EventBase { seq: number; group: number; vis: Mask; rule: string }

export type EventBody =
  | { k: 'gameStart' | 'gameOver'; result?: GameResult }
  | { k: 'battlefieldsChosen'; bfs: ObjId[] } | { k: 'playOrder'; first: PlayerId } | { k: 'mulligan'; p: PlayerId; n: number }
  | { k: 'turnStart'; p: PlayerId; n: number; additional: boolean } | { k: 'phase'; phase: Phase; step: Step }
  | { k: 'priority' | 'focus'; p: PlayerId | null } | { k: 'deciding'; stub: DecisionStub }
  | { k: 'zone'; obj: ObjId; prev?: ObjId; def?: DefId; from: Zone; to: Zone; why: string;   // every zone change
      knew?: Mask; knows?: Mask }     // who knew the card before (prev) / knows it after (obj); default vis
  | { k: 'draw' | 'discard' | 'recycle' | 'banish' | 'channel' | 'burn'; p: PlayerId; objs: ObjId[] }
  | { k: 'reveal' | 'look'; objs: ObjId[]; to: Mask } | { k: 'hide'; obj: ObjId; bf: number } | { k: 'revealFacedown'; obj: ObjId }
  | { k: 'shuffle'; p: PlayerId; zone: 'deck' | 'runeDeck'; count: number } | { k: 'forget'; p: PlayerId; zone: 'hand' }
  | { k: 'tokenGone'; obj: ObjId }
  | { k: 'chainPush'; item: ItemId; kind: ChainItem['kind']; source?: ObjId } | { k: 'finalize' | 'chainPop' | 'counter'; item: ItemId }
  | { k: 'playFailed'; item: ItemId; reason: string } | { k: 'played'; item: ItemId; def: DefId; p?: PlayerId }
  | { k: 'enter'; obj: ObjId; at: Loc; exhausted: boolean } | { k: 'exhaust' | 'ready'; objs: ObjId[] }
  | { k: 'deal'; to: ObjId; n: number; sources: ObjId[]; combat: boolean } | { k: 'heal'; objs: ObjId[] }
  | { k: 'kill'; objs: ObjId[] } | { k: 'buff' | 'spendBuff' | 'stun' | 'unstun' | 'empower' | 'disempower'; objs: ObjId[] }
  | { k: 'attach'; obj: ObjId; to: ObjId; equipped: boolean } | { k: 'detach'; obj: ObjId }
  | { k: 'move'; objs: ObjId[]; from: Loc[]; to: Loc; standard: boolean } | { k: 'recall'; objs: ObjId[] }
  | { k: 'control'; bf: number; p: PlayerId | null } | { k: 'contested'; bf: number; p: PlayerId | null }
  | { k: 'mightChanged'; obj: ObjId; from: number | null; to: number | null } | { k: 'keywordsChanged'; obj: ObjId }
  | { k: 'becomeMighty'; obj: ObjId } | { k: 'controlChanged'; obj: ObjId; p: PlayerId }
  | { k: 'staged'; bf: number; what: 'showdown' | 'combat' } | { k: 'showdownStart' | 'showdownEnd'; bf: number }
  | { k: 'combatStart'; bf: number; attacker: PlayerId } | { k: 'designate'; objs: ObjId[]; d: 'attacker' | 'defender' | null }
  | { k: 'assign'; by: PlayerId; to: ObjId; n: number } | { k: 'combatResult'; bf: number; result: CombatState['result'] }
  | { k: 'combatEnd'; bf: number }
  | { k: 'score'; p: PlayerId; bf: number; how: 'conquer' | 'hold'; point: boolean; drewInstead: boolean }
  | { k: 'points'; p: PlayerId; delta: number; total: number } | { k: 'xp'; p: PlayerId; delta: number } | { k: 'burnOut'; p: PlayerId }
  | { k: 'pool'; p: PlayerId; pool: RunePool } | { k: 'payment'; p: PlayerId; summary: string }
  | { k: 'replaced'; source: ObjId; event: string } | { k: 'outcome'; item: ItemId; instr: string; outcome: Outcome }
  | { k: 'rollback'; reason: 'back' | 'illegal' | 'declined' };

export type GameEvent = EventBase & EventBody;
export type EventKind = EventBody['k'];

/** What a procedure hands to emit(): the event without its sequence number.
    `group` defaults to a group of its own, `vis` to every player. */
export type EventDraft = EventBody & { rule: string; group?: number; vis?: Mask };

/**
 * Records an event. With presentation off (AI rollouts, StepOptions.present
 * false) the event is dropped, but its sequence number and group are still
 * taken, so the state comes out the same either way.
 */
export function emit(s: GameState, x: { present: boolean }, ev: EventDraft): GameEvent {
  const seq = mint(s, 'event');
  const group = ev.group ?? mint(s, 'group');
  const e = { ...ev, seq, group, vis: ev.vis ?? allMask(s.players.length) } as GameEvent;
  if (x.present) pushEvent(s, copyJson(e));
  return e;
}

/** A new game-action group: events emitted with it happened at once. */
export const newGroup = (s: GameState) => mint(s, 'group');

/** The players who know these objects as they are now: the `vis` of an
    event that names them (a draw is visible to its drawer only). */
export function knowers(s: GameState, objs: readonly ObjId[]): Mask {
  let m = allMask(s.players.length);
  for (const id of objs) {
    const o = s.objects[id];
    if (!o) continue;
    for (const p of s.players) if (!knows(s, p.id, o)) m &= ~(1 << p.id);
  }
  return m;
}

/**
 * Emits the 'zone' event of one card's move (§7.4): `prev` is its id before
 * the move, `obj` after, `def` what it is. Its identity is visible to whoever
 * knew the card before or knows it after: a drawer sees what they drew, the
 * owner sees their own card leave the hand face down. Take `before` with
 * knowers() ahead of the move.
 *
 * The two halves are kept apart as well (`knew`, `knows`), because a viewer
 * may know one side only: a drawer never saw the card's old id in the deck,
 * and an owner who recycles two cards in random order must not learn which
 * new id is which card (§7.2). observe() shows `prev` to `knew` and `obj` to
 * `knows`.
 */
export function emitZone(s: GameState, x: { present: boolean }, z: {
  obj: ObjId; prev: ObjId; from: Zone; to: Zone; why: string; rule: string; before: Mask; group?: number;
}): GameEvent {
  const after = knowers(s, [z.obj]);
  return emit(s, x, {
    k: 'zone', obj: z.obj, prev: z.prev, def: s.objects[z.obj]?.def, from: z.from, to: z.to, why: z.why,
    knew: z.before, knows: after, rule: z.rule, group: z.group, vis: z.before | after,
  });
}
