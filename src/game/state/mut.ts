/*
 * The only writers of game state (P15). Everything else in the engine reads
 * the state and asks these helpers to change it; a test checks that no other
 * module assigns to a state structure.
 *
 * Two kinds of write:
 *
 *   real changes    objects, zones, players, battlefields, the turn, the
 *                   result. Each helper is set-if-changed and bumps
 *                   state.epoch only when a value really changes, which is
 *                   what the derived-value memo and the cleanup repetition
 *                   [322] key on (§5.9).
 *   procedural      the frame stack, the pending decision, the event queue,
 *                   the id counters, the RNG, turn.inCleanup and the
 *                   decision counter. They record how the engine is getting
 *                   through the rules, not a change in the game, so they
 *                   never bump the epoch.
 *
 * Zone changes follow [124]: a move between two board zones keeps the
 * object; any other move makes a new object with a new id and fresh board
 * status. Who knows a card afterwards follows the table of §7.2.
 */
import type { Decision } from '../core/decisions.ts';
import type { GameEvent } from '../core/events.ts';
import { EngineError } from '../core/errors.ts';
import { allMask, bit } from './ids.ts';
import { isBoard, isPublic, visibility, zoneLabel } from './zones.ts';
import type {
  BattlefieldState, CardRef, DefId, Frame, GameObject, GameResult, GameState, IdCounters, Mask, ObjId,
  PlayContext, PlayerId, Zone,
} from './types.ts';
import { copyJson } from './clone.ts';

// ---- procedural writes: never bump the epoch ----

/** Takes the next id of a kind. Ids are never reused (§4.4). */
export function mint(s: GameState, kind: keyof IdCounters): number {
  const id = s.next[kind];
  s.next[kind] = id + 1;
  return id;
}

export function setRng(s: GameState, state: number) {
  s.rng = state >>> 0;
}

export function pushFrame(s: GameState, f: Frame) {
  s.frames.push(f);
}

export function popFrame(s: GameState): Frame | undefined {
  return s.frames.pop();
}

export function clearFrames(s: GameState) {
  s.frames = [];
}

export function setPending(s: GameState, d: Decision | null) {
  s.pending = d;
}

export function pushEvent(s: GameState, e: GameEvent) {
  s.out.push(e);
}

/** Hands over the events since the last call and empties the queue. */
export function takeEvents(s: GameState): GameEvent[] {
  const out = s.out;
  s.out = [];
  return out;
}

/** Counts a decision this turn (loop guard, §8 turnDecisionCap). */
export function countDecision(s: GameState): number {
  return ++s.turn.decisionsThisTurn;
}

export function resetDecisionCount(s: GameState) {
  s.turn.decisionsThisTurn = 0;
}

export function setInCleanup(s: GameState, v: boolean) {
  s.turn.inCleanup = v;
}

// ---- real changes ----

const PROCEDURAL_ROOT: readonly string[] = ['next', 'rng', 'frames', 'pending', 'out', 'epoch'];
const PROCEDURAL_TURN: readonly string[] = ['inCleanup', 'decisionsThisTurn'];

function touch(s: GameState) {
  s.epoch++;
}

/** Deep equality of JSON values; undefined fields count as absent. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => same(x, b[i]));
  }
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(ra[k], rb[k]));
}

const copy = <T>(v: T): T => (typeof v === 'object' && v !== null ? copyJson(v) : v);

/**
 * Sets one field of a state structure (s itself, a player, the turn, a
 * battlefield, an object, a log row …) if the value differs. Object values
 * are copied in, so the caller's value never aliases the state. Returns
 * whether anything changed.
 */
export function setField<T extends object, K extends keyof T>(s: GameState, target: T, key: K, value: T[K]): boolean {
  if ((target as object) === s && PROCEDURAL_ROOT.includes(key as string)) {
    throw new EngineError(`'${String(key)}' is procedural state: use its own writer in state/mut.ts`);
  }
  if ((target as object) === s.turn && PROCEDURAL_TURN.includes(key as string)) {
    throw new EngineError(`'turn.${String(key)}' is procedural state: use its own writer in state/mut.ts`);
  }
  if (same(target[key], value)) return false;
  target[key] = copy(value);
  touch(s);
  return true;
}

/** Appends to a state array (a log, the task queue, a mask list …). */
export function append<T>(s: GameState, arr: T[], ...items: T[]) {
  if (items.length === 0) return;
  arr.push(...items.map(copy));
  touch(s);
}

/** Removes the first matching entry of a state array; false if absent. */
export function removeValue<T>(s: GameState, arr: T[], item: T): boolean {
  const i = arr.findIndex((x) => same(x, item));
  if (i < 0) return false;
  arr.splice(i, 1);
  touch(s);
  return true;
}

/** Takes the oldest outstanding task [333], or null when none is left. */
export function takeTask(s: GameState) {
  const t = s.turn.tasks.shift();
  if (t === undefined) return null;
  touch(s);
  return t;
}

export function setResult(s: GameState, r: GameResult) {
  setField(s, s, 'result', r);
}

// ---- objects and zones ----

/** Where a card goes in an ordered zone: decks are top first. */
export type Position = 'top' | 'bottom' | number;

export interface NewObject {
  def: DefId;
  printing: string | null;
  owner: PlayerId;
  zone: Zone;
  token?: boolean;
  /** Default: the owner [191.5.a.1]. */
  controller?: PlayerId | null;
  /** Default: a new physical card. Pass one to make a second object for
      the same card (never needed in M0). */
  card?: CardRef;
  /** Default: as the zone shows it (§7.2): everyone in a public zone, the
      owner in a hand, nobody in a deck, the controller face down. */
  knownBy?: Mask;
  pos?: Position;
  exhausted?: boolean;
}

/** Board status of a brand-new object [124.2]. */
function freshStatus() {
  return {
    exhausted: false, damage: [], buffs: 0, stunned: false, empowered: 0, attachedTo: null, designation: null,
    facedown: null, revealedUntil: null, moves: 0, lastDamage: null, played: null, links: [],
  } satisfies Partial<GameObject>;
}

function defaultKnownBy(s: GameState, z: Zone, owner: PlayerId, controller: PlayerId | null): Mask {
  switch (visibility(z.z)) {
    case 'public': return allMask(s.players.length);
    case 'private': return bit(owner);
    case 'secret': return 0;
    case 'facedown': return bit(controller ?? owner);
  }
}

/** Creates a card or token in a zone (setup, token creation). Not for
    battlefields: see createBattlefield. */
export function createObject(s: GameState, o: NewObject): GameObject {
  const id = mint(s, 'obj');
  const controller = o.controller !== undefined ? o.controller : o.owner;
  const obj: GameObject = {
    id, card: o.card ?? mint(s, 'card'), def: o.def, printing: o.printing, token: o.token ?? false,
    owner: o.owner, controller, zone: copyJson(o.zone),
    knownBy: o.knownBy ?? defaultKnownBy(s, o.zone, o.owner, controller),
    ts: mint(s, 'ts'), enteredTurn: s.turn.n, ...freshStatus(),
  };
  if (o.exhausted) obj.exhausted = true;
  s.objects[id] = obj;
  insert(s, obj.zone, id, o.pos);
  touch(s);
  return obj;
}

/** Puts a battlefield on the board, uncontrolled [113], [170.1]. Returns its
    index in state.bfs, which never changes for the game. */
export function createBattlefield(s: GameState, o: { def: DefId; printing: string | null; owner: PlayerId }): number {
  const bf = s.bfs.length;
  const id = mint(s, 'obj');
  s.objects[id] = {
    id, card: mint(s, 'card'), def: o.def, printing: o.printing, token: false, owner: o.owner, controller: null,
    zone: { z: 'bf', bf }, knownBy: allMask(s.players.length), ts: mint(s, 'ts'), enteredTurn: s.turn.n,
    ...freshStatus(),
  };
  const state: BattlefieldState = {
    obj: id, controller: null, contested: null, staged: { showdown: false, combat: false }, here: [], facedown: [],
    scoredBy: 0, replacedChain: [],
  };
  s.bfs.push(state);
  touch(s);
  return bf;
}

/**
 * Replace [439]: a battlefield token takes the place of the battlefield
 * object at index bf, the same space (units, controller, statuses stay with
 * the slot [439.1]); the replaced card goes to its owner's banishment as
 * Replaced [439.5] (a replaced token ceases to exist [439.6]) and is
 * remembered for a swap back [439.7]. Returns the token's id.
 */
export function replaceBattlefieldObj(s: GameState, bf: number, def: DefId, owner: PlayerId): ObjId {
  const b = s.bfs[bf];
  const old = s.objects[b.obj];
  const id = mint(s, 'obj');
  s.objects[id] = {
    id, card: mint(s, 'card'), def, printing: null, token: true, owner, controller: b.controller,
    zone: { z: 'bf', bf }, knownBy: allMask(s.players.length), ts: mint(s, 'ts'), enteredTurn: s.turn.n, ...freshStatus(),
  };
  b.obj = id;
  delete s.objects[old.id];
  if (!old.token) {
    const back = mint(s, 'obj');
    s.objects[back] = { ...old, id: back, controller: old.owner, zone: { z: 'banish', p: old.owner }, ts: mint(s, 'ts'),
      enteredTurn: s.turn.n, ...freshStatus() };
    s.players[old.owner].banish.push(back);
    b.replacedChain.push(back);
  }
  touch(s);
  return id;
}

/** Swap back [439.7]: the last card this slot replaced returns to it, the token stops existing. */
export function swapBackBattlefieldObj(s: GameState, bf: number): ObjId | null {
  const b = s.bfs[bf];
  const card = b.replacedChain[b.replacedChain.length - 1];
  const o = card === undefined ? undefined : s.objects[card];
  if (!o || o.zone.z !== 'banish') return null;
  const tok = s.objects[b.obj];
  extract(s, o.zone, o.id);
  delete s.objects[o.id];
  const id = mint(s, 'obj');
  s.objects[id] = { ...o, id, controller: b.controller, zone: { z: 'bf', bf }, knownBy: allMask(s.players.length), ts: mint(s, 'ts'),
    enteredTurn: s.turn.n, ...freshStatus() };
  b.replacedChain.pop();
  if (tok && tok.token) delete s.objects[tok.id];
  b.obj = id;
  touch(s);
  return id;
}

export interface MoveOptions {
  /** Ordered zones only; default: the bottom of a deck, the end elsewhere. */
  pos?: Position;
  /** Overrides the knowledge rules of §7.2 (a reveal, a random placement). */
  knownBy?: Mask;
  /** Who controls it afterwards; default: unchanged on the board, the owner
      elsewhere [191.5.a.1]. */
  controller?: PlayerId | null;
  exhausted?: boolean;
  /** Memory a new object keeps from the move that made it [391.5.c.1],
      [135.2.b.7]. */
  carry?: Partial<Pick<GameObject, 'played' | 'links' | 'named' | 'copiedFrom'>>;
  /** Gives the new object this id instead of a fresh one: a failed limited
      play returns its card to where it came from with the identity it had
      there (Spec D §8.5). The id must be free (the object it named left). */
  reuseId?: ObjId;
}

/** Who knows a card after it moved from `from` to `to` (§7.2). */
function knownAfter(s: GameState, o: GameObject, from: Zone, to: Zone, controller: PlayerId | null): Mask {
  const all = allMask(s.players.length);
  const seenLeaving = isPublic(from.z) || from.z === 'facedown';   // a facedown card is revealed as it leaves [422.4]
  switch (visibility(to.z)) {
    case 'public': return all;
    case 'facedown': return bit(controller ?? o.owner);
    case 'private':                                                // a hand
      if (seenLeaving) return all;
      return visibility(from.z) === 'secret' ? bit(o.owner) : o.knownBy;   // drawn: the owner only
    case 'secret':                                                 // a deck, at a known position
      if (seenLeaving) return all;
      return from.z === 'hand' ? o.knownBy & bit(o.owner) : o.knownBy;
  }
}

/**
 * Moves an object to another zone and returns its id afterwards: the same id
 * between two board zones, a new one otherwise [124]. Events are the
 * caller's to emit (it knows why the card moved).
 */
export function moveObject(s: GameState, id: ObjId, to: Zone, o: MoveOptions = {}): ObjId {
  const old = s.objects[id];
  if (!old) throw new EngineError(`moveObject: no object ${id}`);
  const from = old.zone;
  extract(s, from, id);
  let obj: GameObject;
  if (isBoard(from.z) && isBoard(to.z)) {
    obj = old;                                                     // not a zone change: same object [124], [448.1]
    obj.zone = copyJson(to);
    if (o.controller !== undefined) obj.controller = o.controller;
    obj.knownBy = o.knownBy ?? (isPublic(to.z) ? allMask(s.players.length) : obj.knownBy);
  } else {
    const controller = o.controller !== undefined ? o.controller : old.owner;
    if (o.reuseId !== undefined && s.objects[o.reuseId]) throw new EngineError(`moveObject: id ${o.reuseId} is taken`);
    if (isBoard(from.z)) {
      // A copy effect ends as its Equipment leaves the board [479.1]; the copy itself leaves as what it is [124].
      for (const h of Object.values(s.objects)) if (h.copyFx?.via === id) { h.def = h.copyFx.orig; delete h.copyFx; }
    }
    obj = {
      id: o.reuseId ?? mint(s, 'obj'), card: old.card, def: old.copyFx?.orig ?? old.def, printing: old.printing, token: old.token, owner: old.owner,
      controller, zone: copyJson(to), knownBy: o.knownBy ?? knownAfter(s, old, from, to, controller),
      ts: mint(s, 'ts'), enteredTurn: s.turn.n, ...freshStatus(), ...copyJson(o.carry ?? {}),
    };
    delete s.objects[id];
    s.objects[obj.id] = obj;
  }
  if (o.exhausted !== undefined) obj.exhausted = o.exhausted;
  insert(s, obj.zone, obj.id, o.pos);
  touch(s);
  return obj.id;
}

/** Shady Spectacles: `host` becomes a copy of `def` while the Equipment `via` is attached [479.1]; `def` null ends the
    copy effect (its own traits again). Only the definition changes: status, damage, buffs stay [124.2]. */
export function setCopy(s: GameState, host: ObjId, def: DefId | null, via: ObjId) {
  const h = s.objects[host];
  if (!h) throw new EngineError(`setCopy: no object ${host}`);
  if (def === null) {
    if (h.copyFx?.via !== via) return;
    h.def = h.copyFx.orig;
    delete h.copyFx;
  } else {
    const orig = h.copyFx?.orig ?? h.def;
    h.def = def;
    h.copyFx = { orig, via };
  }
  touch(s);
}

/** Orianna, Lady of Clockwork: a gear becomes a unit gear with this base Might (null: it stops being one) [137.3.b]. */
export function setAsUnit(s: GameState, gear: ObjId, v: { might: number; by: ObjId } | null) {
  const g = s.objects[gear];
  if (!g) throw new EngineError(`setAsUnit: no object ${gear}`);
  if (v === null) { if (!g.asUnit) return; delete g.asUnit; } else g.asUnit = { ...v };
  touch(s);
}

/** A token that leaves the board for anywhere but the chain ceases to
    exist [186.1]: it is taken out of its zone and out of the game. */
export function deleteObject(s: GameState, id: ObjId) {
  const o = s.objects[id];
  if (!o) throw new EngineError(`deleteObject: no object ${id}`);
  extract(s, o.zone, id);
  delete s.objects[id];
  touch(s);
}

/**
 * Puts the cards of a deck in a new order as new objects nobody knows: a
 * shuffle or a random placement (§7.2). The new ids are minted in the new
 * order, top first, so no id from before is left in the zone. Returns them.
 * (state/rng.ts shuffleZone picks the order.)
 */
export function reorderZone(s: GameState, z: Zone & { z: 'deck' | 'runeDeck' }, order: readonly ObjId[]): ObjId[] {
  const arr = s.players[z.p][z.z];
  if (order.length !== arr.length || !order.every((id) => arr.includes(id)) || new Set(order).size !== order.length) {
    throw new EngineError(`reorderZone: not a permutation of ${zoneLabel(z)}`);
  }
  const ids = order.map((oldId) => {
    const old = s.objects[oldId];
    const obj: GameObject = { ...old, id: mint(s, 'obj'), knownBy: 0, ts: mint(s, 'ts') };
    delete s.objects[oldId];
    s.objects[obj.id] = obj;
    return obj.id;
  });
  s.players[z.p][z.z] = ids;
  touch(s);
  return ids;
}

/** Adds an id to the array that holds its zone. */
function insert(s: GameState, z: Zone, id: ObjId, pos: Position | undefined) {
  switch (z.z) {
    case 'champion':
      if (s.players[z.p].champion !== null) throw new EngineError(`${zoneLabel(z)} is full [108.3.c.1]`);
      s.players[z.p].champion = id;
      return;
    case 'deck': case 'runeDeck': {
      const arr = s.players[z.p][z.z];
      if (pos === 'top') arr.unshift(id);
      else if (pos === undefined || pos === 'bottom') arr.push(id);
      else arr.splice(pos, 0, id);
      return;
    }
    case 'base': case 'hand': case 'trash': case 'banish': case 'legend':
      s.players[z.p][z.z].push(id);
      return;
    case 'bf': s.bfs[z.bf].here.push(id); return;
    case 'facedown': s.bfs[z.bf].facedown.push(id); return;
    case 'chain': case 'gone': return;                             // the chain item refers to its object (M1)
  }
}

/** Removes an id from the array that holds its zone. */
function extract(s: GameState, z: Zone, id: ObjId) {
  const drop = (arr: ObjId[]) => {
    const i = arr.indexOf(id);
    if (i < 0) throw new EngineError(`object ${id} is not in ${zoneLabel(z)}`);
    arr.splice(i, 1);
  };
  switch (z.z) {
    case 'champion':
      if (s.players[z.p].champion !== id) throw new EngineError(`object ${id} is not in ${zoneLabel(z)}`);
      s.players[z.p].champion = null;
      return;
    case 'base': case 'hand': case 'deck': case 'runeDeck': case 'trash': case 'banish': case 'legend':
      drop(s.players[z.p][z.z]);
      return;
    case 'bf':
      if (s.bfs[z.bf].obj === id) throw new EngineError('a battlefield does not move (Replace arrives in M5)');
      drop(s.bfs[z.bf].here);
      return;
    case 'facedown': drop(s.bfs[z.bf].facedown); return;
    case 'chain': case 'gone': return;
  }
}

// ---- rollback ----

/**
 * Puts the game back as it was at a snapshot taken earlier in the same
 * process: S0 of a discretionary play, taken before its step 1 (§4.4,
 * [358.5]). Everything the snapshot holds comes back, except what records
 * how the engine got here: the id counters (ids are never reused), the
 * frames, the pending decision, the events not yet handed over and the
 * decision count of the turn. Nobody can unsee a card: every knowledge bit
 * gained since the snapshot is kept, matched by CardRef (§4.4). The epoch
 * moves on, never back, so nothing memoized on it is mistaken for current.
 */
export function restoreSnapshot(s: GameState, snap: GameState) {
  const known: Record<CardRef, Mask> = {};
  for (const o of Object.values(s.objects)) known[o.card] = (known[o.card] ?? 0) | o.knownBy;
  const keep = { next: s.next, frames: s.frames, pending: s.pending, out: s.out, epoch: s.epoch };
  const decisions = s.turn.decisionsThisTurn;
  Object.assign(s, copyJson(snap), keep);
  s.turn.decisionsThisTurn = decisions;
  for (const o of Object.values(s.objects)) o.knownBy |= known[o.card] ?? 0;
  touch(s);
}

/** Keeps a limited play's S2 snapshot on its item (Spec D §8.5). The
    snapshot is a fresh copy already: it is stored as it is, not copied
    again (setField would). */
export function setSnap2(s: GameState, play: PlayContext, snap: GameState | null) {
  play.snap2 = snap;
  touch(s);
}

/** A copy of the state to roll back to: without the frames (and so without
    their own snapshots), the pending decision and the events (§4.4). */
export function snapshotState(s: GameState): GameState {
  return copyJson({ ...s, frames: [], pending: null, out: [] });
}
