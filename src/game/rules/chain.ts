/*
 * The chain (§5.7, Spec C §6, [327–340]): adding items, taking them off,
 * and the counters that say when the newest one resolves.
 *
 *   add      a card, token or ability becomes a Pending item; the state
 *            Closes [354.1], [402.1]; any item but an Add ability resets
 *            the priority passes [339.1]; a card played or a non-Add
 *            ability activated during a showdown resets the Focus passes
 *            [348] (Spec C Q4: triggers and Add abilities never do); the
 *            item whose arrival made the chain says what opened it [346.1]
 *   remove   leaving the chain makes a cleanup outstanding [319.5]; an
 *            emptied chain opens the state again [340.2], and during a
 *            showdown Focus passes on unless a trigger or an Add ability
 *            opened the chain [340.2.a], [346.1], Spec C Q3
 *
 * Add abilities (the rune abilities of [164.2]) are chain items too: they
 * finalize and resolve at once, never wait for priority and move no
 * counter [430.2], [430.2.a].
 */
import { emit } from '../core/events.ts';
import { append, removeValue, setField } from '../state/mut.ts';
import type {
  ChainItem, GameState, ItemId, ObjId, PlayContext, PlayedRecord, PlayerId, Zone,
} from '../state/types.ts';
import { isShowdownState, nextPlayer } from './board.ts';
import { requestCleanup } from './tasks.ts';

type X = { present: boolean };

export const itemById = (s: GameState, id: ItemId): ChainItem | undefined => s.chain.find((i) => i.id === id);

/** A fresh play context for an item at step 1 (§3.7). */
export function playContext(s: GameState, o: {
  mode: 'discretionary' | 'limited'; origin: Zone; item: ItemId; by: PlayerId;
  instructedBy?: PlayContext['instructedBy'];
}): PlayContext {
  const facts: PlayedRecord = {
    item: o.item, turn: s.turn.n, by: o.by, turnPlayer: s.turn.player, mode: o.mode, from: o.origin.z, paidOptional: [],
    showOff: [], energySpent: 0, powerSpent: 0, costObjects: {},
  };
  const ctx: PlayContext = {
    mode: o.mode, step: 1, origin: structuredClone(o.origin), closedTheState: s.chain.length === 0,
    atStart: { showdown: isShowdownState(s), turnPlayer: s.turn.player, phase: s.turn.phase },
    choices: { asPlayed: {}, optionalCosts: {}, executions: [{ modes: [], dests: {}, targets: {} }] },
    paid: [], facts, lookBack: {}, restrictions: [], snap2: null, ...(o.instructedBy ? { instructedBy: o.instructedBy } : {}),
  };
  return ctx;
}

/**
 * Puts a new item on the chain [354], [402], [389.2]. `played`: a card
 * played or a non-Add ability activated by a player, which resets the
 * Focus passes of a showdown [348].
 */
export function addItem(s: GameState, x: X, it: ChainItem, o: { played: boolean }) {
  const opens = s.chain.length === 0;
  append(s, s.chain, it);
  if (opens) {
    setField(s, s.turn, 'chainOrigin', it.isAdd ? 'add' : it.kind === 'card' || it.kind === 'token' ? 'card' : it.kind);
  }
  if (!it.isAdd) {
    setField(s, s.turn, 'passes', 0);                                // [339.1]
    setField(s, s.turn, 'priority', null);                           // re-awarded once nothing is pending [337.4]
    if (o.played && isShowdownState(s)) setField(s, s.turn, 'focusPasses', 0);   // [348]
  }
  emit(s, x, { k: 'chainPush', item: it.id, kind: it.kind, ...(it.source !== undefined ? { source: it.source } : {}),
    rule: it.kind === 'triggered' ? '389.2' : it.kind === 'activated' ? '402.1' : '354.2' });
  requestCleanup(s);                                                 // [319.3]
}

/**
 * Takes an item off the chain [319.5]. When that empties the chain the
 * state is Open again [340.2]: nobody holds priority, the passes start
 * over, and in a showdown Focus moves on unless a trigger or an Add ability
 * opened the chain [340.2.a], [346.1].
 */
export function removeItem(s: GameState, x: X, id: ItemId) {
  const it = itemById(s, id);
  if (it) removeValue(s, s.chain, it);                               // in place: holders of other items stay valid
  emit(s, x, { k: 'chainPop', item: id, rule: '319.5' });
  requestCleanup(s);
  if (s.chain.length > 0) return;
  const origin = s.turn.chainOrigin;
  setField(s, s.turn, 'chainOrigin', null);
  setField(s, s.turn, 'passes', 0);
  setField(s, s.turn, 'priority', null);
  if (s.showdown && s.turn.focus !== null && origin !== 'triggered' && origin !== 'add') {
    const p = nextPlayer(s, s.turn.focus);
    setField(s, s.turn, 'focus', p);
    emit(s, x, { k: 'focus', p, rule: '340.2.a' });
  }
}

/** An item that finalized or resolved during the Expiration Step makes the
    step run again [317.2.e]. */
export function markFepr(s: GameState) {
  if (s.turn.phase === 'ending' && s.turn.step === 'expiration') setField(s, s.turn.expiration, 'feprHappened', true);
}

/** Finalizes an item [359.1], [407.1]: no longer Pending. */
export function finalizeItem(s: GameState, x: X, it: ChainItem) {
  setField(s, it.play, 'step', 6);
  setField(s, it, 'status', 'finalized');
  emit(s, x, { k: 'finalize', item: it.id, rule: it.kind === 'card' || it.kind === 'token' ? '359.1' : '407.1' });
  markFepr(s);
  requestCleanup(s);                                                 // [319.4]
}

/** A usage counter's key [383.3.e]: per player for "for each player, the
    first time" [383.1.b], '*' otherwise. */
export const usageKey = (source: ObjId, ability: string, p: PlayerId | '*') => `${source}|${ability}|${p}`;

export function countUsage(s: GameState, key: string) {
  setField(s, s, 'usage', { ...s.usage, [key]: (s.usage[key] ?? 0) + 1 });
}
