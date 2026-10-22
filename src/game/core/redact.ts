/*
 * The alias walker (§7.3): makes one player's view out of a state.
 *
 * Every object the viewer doesn't know becomes a positional stub with a
 * negative alias, and every field that holds an ObjId is rewritten through
 * the same alias map, so no real id of an unknown object survives: real ids
 * are minted in order and would tell when a card arrived and where it was.
 * An alias depends only on the zone and the object's position among the
 * viewer's unknown objects there: decks and rune decks from the top, a hand
 * by index, facedown cards by battlefield and slot.
 *
 *   alias = −(1 + zoneSlot × 256 + i)
 *
 * Stubs of one zone are interchangeable: nothing else in a view names one
 * of them (the setup frame's private locals, which could, are hidden), so
 * which hidden card gets which alias carries no information. Nor does the
 * order of the view itself: stubs are listed by alias, and another
 * player's hand lists the cards the viewer knows before the stubs.
 *
 * The id counters (state.next) and the epoch stay in views: every mint and
 * every change counted so far is something all players see happen (a card
 * moving, a shuffle, a decision, an event), so they tell nothing hidden. The
 * invariance test (§14.5 #2) fails the day one of them does.
 *
 * The walker knows the paths of the state M0 and M1.1 fill: zones,
 * objects, battlefields, the decision, the chain, the combat, and the
 * setup, priority, cleanup, task, play, move and assign frames (a play's S0
 * snapshot is dropped). Continuous effects, delayed abilities, pending
 * triggers and the other frames hold ObjIds and snapshots too; the walker
 * refuses a state that has any of them until their paths are added here,
 * alongside the procedure that first writes them, rather than let an id
 * slip through.
 *
 * This module and core/view.ts write into the copy they make, never into the
 * live state (the purity test allows them that).
 */
import { cloneState } from '../state/clone.ts';
import { bit } from '../state/ids.ts';
import { visibility } from '../state/zones.ts';
import type { Frame, GameObject, GameState, ObjId, PlayerId, Zone } from '../state/types.ts';
import { stubOf, type Decision, type DecisionStub, type Ref } from './decisions.ts';
import { NotImplementedError } from './errors.ts';
import type { Alias, PlayerView, Stub } from './view.ts';

/** Room for each zone's unknown objects in the alias space. */
export const ALIAS_STRIDE = 256;

/** The alias slot of a zone that can hold unknown objects; null for zones
    every player sees. */
export function zoneSlot(z: Zone): number | null {
  switch (z.z) {
    case 'hand': return z.p * 4;
    case 'deck': return z.p * 4 + 1;
    case 'runeDeck': return z.p * 4 + 2;
    case 'facedown': return 64 + z.bf;
    default: return null;
  }
}

export const aliasOf = (slot: number, i: number): Alias => -(1 + slot * ALIAS_STRIDE + i);

/** Real id → alias, for exactly the objects p doesn't know. */
export type AliasMap = Record<ObjId, Alias>;

/** The alias of every object the viewer doesn't know (§7.3), given the
    predicate that decides it (core/view.ts knows()). */
export function aliasMap(s: GameState, known: (o: GameObject) => boolean): AliasMap {
  const out: AliasMap = {};
  const walk = (z: Zone, ids: readonly ObjId[]) => {
    const slot = zoneSlot(z)!;
    let i = 0;
    for (const id of ids) {
      if (known(s.objects[id])) continue;
      if (i >= ALIAS_STRIDE) {
        throw new NotImplementedError(`more than ${ALIAS_STRIDE} unknown cards in one zone`, 'core/redact.ts');
      }
      out[id] = aliasOf(slot, i++);
    }
  };
  for (const pl of s.players) {
    walk({ z: 'hand', p: pl.id }, pl.hand);
    walk({ z: 'deck', p: pl.id }, pl.deck);
    walk({ z: 'runeDeck', p: pl.id }, pl.runeDeck);
  }
  s.bfs.forEach((b, bf) => walk({ z: 'facedown', bf }, b.facedown));
  return out;
}

/** What a viewer sees of an object they don't know: its public facts. */
function stubFor(o: GameObject, alias: Alias): Stub {
  const stub: Stub = { id: alias, zone: structuredClone(o.zone), owner: o.owner, controller: o.controller };
  if (o.facedown) stub.facedown = { hiddenOnTurn: o.facedown.hiddenOnTurn, bf: o.facedown.bf };
  return stub;
}

/** What the walker can't redact yet, or null. */
function unsupported(s: GameState): string | null {
  if (s.effects.length > 0) return 'continuous effects';
  if (s.delayed.length > 0) return 'delayed abilities';
  if (s.turn.tasks.some((t) => t.t === 'placeTriggers')) return 'pending triggers';
  const f = s.frames.find((fr) => !FRAMES.includes(fr.f));
  return f ? `'${f.f}' frames` : null;
}

/** Frames whose fields the walker knows. */
const FRAMES: readonly Frame['f'][] = ['setup', 'priority', 'cleanup', 'task', 'play', 'move', 'assign'];

/**
 * Builds p's view of s (§7.3): a copy in which unknown objects are stubs,
 * ObjIds of unknown objects are aliases everywhere, the RNG is 0, the other
 * players' decision is only its stub and nothing private to another player
 * remains in a frame.
 */
export function redact(s: GameState, p: PlayerId, known: (o: GameObject) => boolean): PlayerView {
  const missing = unsupported(s);
  if (missing) throw new NotImplementedError(`views of states with ${missing}`, 'their ObjId paths in core/redact.ts');
  const aliases = aliasMap(s, known);
  const a = (id: ObjId): ObjId => aliases[id] ?? id;
  const as = (ids: ObjId[]) => ids.map(a);

  const v = cloneState({ ...s, out: [] });
  const objects: Record<number, GameObject | Stub> = {};
  const stubs: Stub[] = [];
  for (const o of Object.values(v.objects)) {
    const alias = aliases[o.id];
    if (alias !== undefined) {
      stubs.push(stubFor(o, alias));
      continue;
    }
    if (o.attachedTo !== null) o.attachedTo = a(o.attachedTo);
    for (const d of o.damage) d.sources = as(d.sources);
    if (o.lastDamage) o.lastDamage.sources = as(o.lastDamage.sources);
    for (const l of o.links) l.source = a(l.source);
    if (o.aliasOf !== undefined) o.aliasOf = a(o.aliasOf);
    objects[o.id] = o;
  }
  // Negative keys keep the order they were added in (positive ones always
  // run in ascending order), so stubs go in by alias: not even the order of
  // a view's keys may follow the real ids.
  for (const st of stubs.sort((x, y) => y.id - x.id)) objects[st.id] = st;
  for (const pl of v.players) {
    // A hand is unordered [108.7.d]: its arrival order is for its owner's
    // eyes. Another player sees the cards they know first and the stubs
    // after, so where a known card sits among the unknown ones tells them
    // nothing about when the others arrived.
    const known = pl.hand.filter((id) => aliases[id] === undefined);
    pl.hand = [...known, ...as(pl.hand.filter((id) => aliases[id] !== undefined))];
    pl.deck = as(pl.deck);
    pl.runeDeck = as(pl.runeDeck);
  }
  for (const b of v.bfs) b.facedown = as(b.facedown);
  for (const f of v.frames) redactFrame(f, p, a);
  // Chain items and the combat name only public objects (the chain and the
  // board are public zones); rollback snapshots never leave the engine.
  for (const it of v.chain) {
    if (it.obj !== undefined) it.obj = a(it.obj);
    it.play.snap2 = null;
    it.play.lookBack = {};
  }

  const d = s.pending;
  const mine = d !== null && d.player === p;
  return {
    ...v, objects, rng: 0, pending: mine ? redactDecision(structuredClone(d), a) : null,
    me: p, opponentDecision: d !== null && !mine ? redactStub(stubOf(d), a) : null,
  } as unknown as PlayerView;
}

/** Frame locals that belong to one player: the setup frame's scratch (the
    cards set aside so far in a mulligan) is the deciding player's alone. A
    play's S0 snapshot is the whole true state: no view keeps it (§7.3). */
function redactFrame(f: Frame, p: PlayerId, a: (id: ObjId) => ObjId) {
  if (f.f === 'setup' && f.p !== p) f.locals = null;
  if (f.f === 'play') {
    f.snap = null;
    f.obj = a(f.obj);
  }
  if (f.f === 'move') f.snap = null;
}

function redactRefs(refs: Ref[], a: (id: ObjId) => ObjId) {
  for (const r of refs) if ('obj' in r) r.obj = a(r.obj);
}

/** The viewer's own decision. Its option keys already name unknown objects
    by the viewer's aliases, never by real ids (core/decisions.ts). */
function redactDecision(d: Decision, a: (id: ObjId) => ObjId): Decision {
  for (const o of d.options) if (o.refs) redactRefs(o.refs, a);
  if (d.ctx.source !== undefined) d.ctx.source = a(d.ctx.source);
  return d;
}

function redactStub(st: DecisionStub, a: (id: ObjId) => ObjId): DecisionStub {
  if (st.ctx.source !== undefined) st.ctx.source = a(st.ctx.source);
  return st;
}

/** The knowledge bits a placeholder gets: as its zone shows it (§7.2). */
function placeholderKnownBy(st: Stub): number {
  switch (visibility(st.zone.z)) {
    case 'private': return bit(st.owner);
    case 'facedown': return bit(st.controller ?? st.owner);
    default: return 0;
  }
}

/** The definition placeholders stand for: a vanilla card with no abilities
    and no cost (the card registry answers it from M1). */
export const PLACEHOLDER_DEF = 'placeholder';

/** A stub as a game object: a vanilla card in the stub's place, keyed and
    referenced by its alias. */
export function placeholderFor(st: Stub): GameObject {
  return {
    id: st.id, card: st.id, def: PLACEHOLDER_DEF, printing: null, token: false, owner: st.owner,
    controller: st.controller, zone: structuredClone(st.zone), knownBy: placeholderKnownBy(st), ts: 0, enteredTurn: 0,
    exhausted: false, damage: [], buffs: 0, stunned: false, empowered: 0, attachedTo: null, designation: null,
    facedown: st.facedown ? { ...st.facedown, by: st.controller ?? st.owner } : null, revealedUntil: null, moves: 0,
    lastDamage: null, played: null, links: [],
  };
}
