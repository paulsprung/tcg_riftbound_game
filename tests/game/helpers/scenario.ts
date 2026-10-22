import { run, runCtx } from '../../../src/game/core/run.ts';
import {
  choose, createGame, type DefId, type GameEvent, type GameState, type Loc, type ObjId, type PlayerId,
} from '../../../src/game/index.ts';
import { checkInvariants } from '../../../src/game/state/invariants.ts';
import { createObject, moveObject, popFrame, setField, setPending } from '../../../src/game/state/mut.ts';
import { requestCleanup } from '../../../src/game/rules/tasks.ts';
import { SERAPHINE } from './decks.ts';

/*
 * A small scenario harness (§14.4) for the M1.1 rules tests: start a
 * Seraphine mirror with a fixed First Player, put units where a test needs
 * them, and answer decisions by key, checking every invariant on the way.
 *
 * Tests may write the state directly (only src/game is held to the
 * mutation rule); after changing the board under a pending priority
 * decision, `reask` throws that decision away and lets the master loop ask
 * it again, so its options fit the new board.
 */

export interface Game { s: GameState; events: GameEvent[] }

/** A Seraphine mirror at P0's first Main Phase priority, both hands kept. */
export function start(seed = 1, o: { first?: PlayerId } = {}): Game {
  const r = createGame({ seed, decks: [SERAPHINE, SERAPHINE], firstPlayer: o.first ?? 0 }, { check: true });
  const g: Game = { s: r.state, events: [...r.events] };
  while (g.s.pending?.kind === 'mulligan') act(g, 'done');
  return g;
}

/** Answers the pending decision with a key it offers. */
export function act(g: Game, key: string): Game {
  const d = g.s.pending;
  if (!d) throw new Error(`nothing pending to answer '${key}'`);
  if (!d.options.some((o) => o.key === key)) {
    throw new Error(`'${key}' is not an option of ${d.kind} (${d.options.map((o) => o.key).join(' ')})`);
  }
  const r = choose(g.s, { decision: d.id, key }, { check: true });
  g.s = r.state;
  g.events.push(...r.events);
  return g;
}

/**
 * Lets the battlefields' and cards' triggers go by (M1.2): declines every
 * "may" and every trigger cost, orders triggers as listed, takes the first
 * card of a resolution-time choice, and passes priority on chains, until a
 * decision of another kind is pending. `may` answers the "may" decisions
 * instead.
 */
export function settle(g: Game, o: { may?: 'yes' | 'no' } = {}): Game {
  for (let i = 0; i < 200 && g.s.pending; i++) {
    const d = g.s.pending;
    const it = d.ctx.item === undefined ? undefined : g.s.chain.find((c) => c.id === d.ctx.item);
    if (d.kind === 'may') act(g, o.may ?? 'no');
    else if (d.kind === 'payment' && it?.kind === 'triggered') act(g, 'decline');
    else if (d.kind === 'orderTriggers' || d.kind === 'pickCard' || d.kind === 'predict') act(g, d.options[0].key);
    else if (d.kind === 'priority' && d.prompt.window === 'chain') act(g, 'pass');
    else break;
  }
  return g;
}

/** The keys of the pending decision. */
export const keys = (g: Game) => g.s.pending?.options.map((o) => o.key) ?? [];

/** Answers 'pass' (or the given key) while the pending decision is a priority
    decision of that window, up to n times. */
export function passWhile(g: Game, test: (g: Game) => boolean, n = 20): Game {
  for (let i = 0; i < n && g.s.pending && test(g); i++) act(g, 'pass');
  return g;
}

/** Ends turns until it is p's Main Phase again. */
export function endTurn(g: Game): Game {
  act(g, 'end');
  passWhile(g, () => keys(g).join() === 'pass');
  return g;
}

/** Puts a card on the board for p: a unit at a location, ready unless said. */
export function put(g: Game, def: DefId, p: PlayerId, loc: Loc, o: { exhausted?: boolean; damage?: number } = {}): ObjId {
  const zone = loc.z === 'base' ? { z: 'base' as const, p: loc.p } : { z: 'bf' as const, bf: loc.bf };
  const obj = createObject(g.s, { def, printing: null, owner: p, zone, controller: p, exhausted: o.exhausted ?? false });
  if (o.damage) setField(g.s, obj, 'damage', [{ amount: o.damage, by: null, sources: [], combat: false, group: 0 }]);
  return obj.id;
}

export const bf = (i: number): Loc => ({ z: 'bf', bf: i });
export const base = (p: PlayerId): Loc => ({ z: 'base', p });

/** Gives a battlefield to a player (its object too). */
export function control(g: Game, i: number, p: PlayerId | null) {
  setField(g.s, g.s.bfs[i], 'controller', p);
  setField(g.s, g.s.objects[g.s.bfs[i].obj], 'controller', p);
}

/** Drops the pending decision and its frame and lets the engine ask again. */
export function reask(g: Game): Game {
  if (!g.s.pending) throw new Error('nothing pending');
  popFrame(g.s);
  setPending(g.s, null);
  requestCleanup(g.s);                                               // the board changed [319]
  const x = runCtx({ check: true });
  run(g.s, x);
  g.events.push(...g.s.out.splice(0));
  const fails = checkInvariants(g.s);
  if (fails.length > 0) throw new Error(fails.join('\n'));
  return g;
}

/** The events of a kind, in order. */
export const evs = <K extends GameEvent['k']>(g: Game, k: K) =>
  g.events.filter((e) => e.k === k) as EventOf<K>[];

type EventOf<K extends GameEvent['k']> = GameEvent extends infer E ? E extends { k: infer EK } ? K extends EK ? E & { k: K }
  : never : never : never;

/** P's ready runes in base. */
export const readyRunes = (g: Game, p: PlayerId) =>
  g.s.players[p].base.filter((id) => g.s.objects[id].def.endsWith('-rune') && !g.s.objects[id].exhausted);

/** Puts a card of p's in their hand, known to them only. */
export function inHand(g: Game, def: string, p: PlayerId = 0): ObjId {
  return createObject(g.s, { def, printing: null, owner: p, zone: { z: 'hand', p } }).id;
}

/** Puts a card of p's in their trash. */
export function inTrash(g: Game, def: string, p: PlayerId = 0): ObjId {
  return createObject(g.s, { def, printing: null, owner: p, zone: { z: 'trash', p } }).id;
}

/** Replaces p's runes in base: [domain, ready][]. */
export function runes(g: Game, p: PlayerId, list: [string, boolean][]) {
  for (const id of g.s.players[p].base.slice()) {
    if (g.s.objects[id].def.endsWith('-rune')) moveObject(g.s, id, { z: 'runeDeck', p }, { pos: 'bottom', knownBy: 0 });
  }
  for (const [d, ready] of list) {
    createObject(g.s, { def: `${d}-rune`, printing: null, owner: p, zone: { z: 'base', p }, exhausted: !ready });
  }
}

/** n ready runes of a domain. */
export const ready = (d: string, n: number): [string, boolean][] => Array.from({ length: n }, () => [d, true]);
