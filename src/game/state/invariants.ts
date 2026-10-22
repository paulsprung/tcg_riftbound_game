/*
 * Invariants a state must satisfy whenever the engine is at rest: after
 * createGame() and after every choose() (§3.14). Tests and the fuzzer run
 * them after every step (StepOptions.check); a broken one is an engine bug.
 *
 * This file holds the structural invariants every state has (zones agree
 * with objects, ids, knowledge bits, the decision and the frames, JSON
 * round trip) and the rule invariants of the rules built so far: the board
 * before the first turn and the battlefields (Spec A §5.3). Spec C §1.5
 * joins with the chain and showdowns, and so on. Each check returns its
 * failures as text; assertInvariants() throws them all at once.
 *
 * Two more checks are run by the tests rather than after every step:
 * checkSetupDone() (Spec A §5.3, once setup has finished) and checkViews()
 * (§3.14 item 4: views hide what they must).
 */
import { checkOptions, stubOf } from '../core/decisions.ts';
import { InvariantError } from '../core/errors.ts';
import type { Stub } from '../core/view.ts';
import { knows, viewFor } from '../core/view.ts';
import { isLethal, isType } from '../rules/chars.ts';
import { openingHandSize, turnOrder } from '../rules/defaults.ts';
import { hashState, stableJson } from './clone.ts';
import { allMask, bit } from './ids.ts';
import { isPublic, sameZone, zoneLabel } from './zones.ts';
import type { GameObject, GameState, ObjId, Zone } from './types.ts';

type Check = (s: GameState) => string[];

/** Every id in exactly one zone array, and that array is its zone. */
const zonesAgree: Check = (s) => {
  const out: string[] = [];
  const holder: Record<number, string> = {};
  const hold = (id: ObjId, where: Zone, label = zoneLabel(where)) => {
    if (holder[id] !== undefined) out.push(`object ${id} is in both ${holder[id]} and ${label}`);
    holder[id] = label;
    const o = s.objects[id];
    if (!o) out.push(`${label} holds ${id}, which is not an object`);
    else if (!sameZone(o.zone, where)) out.push(`${label} holds ${id}, whose zone is ${zoneLabel(o.zone)}`);
  };
  for (const pl of s.players) {
    const p = pl.id;
    for (const z of ['base', 'hand', 'deck', 'runeDeck', 'trash', 'banish', 'legend'] as const) {
      for (const id of pl[z]) hold(id, { z, p });
    }
    if (pl.champion !== null) hold(pl.champion, { z: 'champion', p });
  }
  s.bfs.forEach((b, bf) => {
    hold(b.obj, { z: 'bf', bf }, `battlefield ${bf}`);
    for (const id of b.here) hold(id, { z: 'bf', bf });
    for (const id of b.facedown) hold(id, { z: 'facedown', bf });
  });
  for (const it of s.chain) if (it.obj !== undefined) hold(it.obj, { z: 'chain', item: it.id });
  for (const key of Object.keys(s.objects)) {
    const o = s.objects[Number(key)];
    if (o.id !== Number(key)) out.push(`objects[${key}] has id ${o.id}`);
    if (o.zone.z === 'gone') out.push(`token ${o.id} ceased to exist but was not deleted [186.1]`);
    else if (holder[o.id] === undefined) out.push(`object ${o.id} is in no zone array (zone ${zoneLabel(o.zone)})`);
  }
  return out;
};

/** Ids below their counters; one object per physical card; knowledge bits
    within the players, and complete in public zones (§7.2). */
const idsAndKnowledge: Check = (s) => {
  const out: string[] = [];
  const all = allMask(s.players.length);
  const cards: Record<number, ObjId> = {};
  for (const o of Object.values(s.objects)) {
    if (o.id >= s.next.obj) out.push(`object ${o.id} is not below next.obj ${s.next.obj}`);
    if (o.card >= s.next.card) out.push(`card ${o.card} is not below next.card ${s.next.card}`);
    if (cards[o.card] !== undefined) out.push(`card ${o.card} is both object ${cards[o.card]} and ${o.id}`);
    cards[o.card] = o.id;
    if ((o.knownBy & ~all) !== 0) out.push(`object ${o.id} knownBy ${o.knownBy} names no player`);
    if (isPublic(o.zone.z) && o.knownBy !== all) out.push(`object ${o.id} is public but knownBy ${o.knownBy}`);
    if (o.token && !['base', 'bf', 'chain'].includes(o.zone.z)) out.push(`token ${o.id} is off the board [186.1]`);
  }
  for (const pl of s.players) {
    if (pl.points < 0) out.push(`P${pl.id} has ${pl.points} points [194.4]`);
    if (pl.xp < 0) out.push(`P${pl.id} has ${pl.xp} XP`);
  }
  return out;
};

/** The one open question and the frames (§3.14 items 1, 6, 8). */
const decisionAndFrames: Check = (s) => {
  const out: string[] = [];
  const f = s.frames[s.frames.length - 1];
  if (s.result && s.pending) out.push('a decision is pending after the game ended');
  if (s.pending) {
    const d = s.pending;
    if (!f) out.push(`decision ${d.id} is pending but no frame asked it`);
    else if (f.answer !== undefined) out.push(`decision ${d.id} is pending but the top frame holds an answer`);
    if (d.id !== s.next.decision - 1) out.push(`decision ${d.id} is not the newest one (next.decision ${s.next.decision})`);
    if (!s.players.some((pl) => pl.id === d.player)) out.push(`decision ${d.id} is asked of P${d.player}, not in the game`);
    try { checkOptions(d.options, `decision ${d.id}`); } catch (e) { out.push((e as Error).message); }
  } else if (f && !s.result) {
    // At rest the engine has run until a decision, the end of the game, or
    // (M0) the end of everything there was to run; a frame left over means a
    // step stopped without asking (§3.14 item 1).
    out.push(`the '${f.f}' frame is stopped with no decision pending`);
  }
  if (f?.await === 'tasks') out.push(`the top frame ('${f.f}') still waits for tasks`);
  if (!s.showdown && !s.combat && s.turn.focus !== null) out.push('focus is held in a Neutral state [313.5]');
  if (s.out.length > 0) out.push(`${s.out.length} events were not handed over`);
  return out;
};

/** The state is JSON and survives a round trip (§3.14 item 3). */
const json: Check = (s) => {
  try {
    stableJson(s);
    return hashState(JSON.parse(JSON.stringify(s))) === hashState(s) ? [] : ['the JSON round trip changes the state'];
  } catch (e) {
    return [(e as Error).message];
  }
};

/** Each battlefield's object is at its own slot and shares its controller
    [190.2]; turn fields name players. */
const battlefieldsAndTurn: Check = (s) => {
  const out: string[] = [];
  s.bfs.forEach((b, bf) => {
    const o = s.objects[b.obj];
    if (!o || o.zone.z !== 'bf' || o.zone.bf !== bf) out.push(`battlefield ${bf}'s object ${b.obj} is not at bf${bf}`);
    else if (o.controller !== b.controller) {
      out.push(`battlefield ${bf}: its object's controller is ${o.controller}, the slot's ${b.controller}`);
    }
  });
  const ids = s.players.map((p) => p.id);
  const t = s.turn;
  const named = [t.player, t.firstPlayer, ...t.queue.map((q) => q.player), ...(t.priority === null ? [] : [t.priority]),
    ...(t.focus === null ? [] : [t.focus])];
  if (named.some((p) => !ids.includes(p))) out.push(`the turn names a player who isn't in the game: ${named}`);
  return out;
};

/** Before the first turn nothing has happened on the board: only legends and
    battlefields are on it, nobody has points, XP or resources, and nothing
    is on the chain or outstanding (Spec A §5.2 step 8, §5.3; [118]). */
const beforeFirstTurn: Check = (s) => {
  if (s.turn.n !== 0) return [];
  const out: string[] = [];
  for (const pl of s.players) {
    for (const z of ['base', 'trash', 'banish'] as const) {
      if (pl[z].length > 0) out.push(`P${pl.id}'s ${z} holds ${pl[z].length} before the first turn`);
    }
    if (pl.points !== 0 || pl.xp !== 0) out.push(`P${pl.id} has points or XP before the first turn`);
    const pool = pl.pool;
    if (pool.energy + pool.universal + Object.values(pool.power).reduce((a, b) => a + b, 0) + pool.restricted.length > 0) {
      out.push(`P${pl.id}'s Rune Pool is not empty before the first turn`);
    }
  }
  s.bfs.forEach((b, bf) => {
    if (b.controller !== null || b.contested !== null) out.push(`battlefield ${bf} is controlled before the first turn`);
    if (b.here.length + b.facedown.length > 0) out.push(`battlefield ${bf} holds cards before the first turn`);
  });
  if (s.chain.length > 0 || s.turn.tasks.length > 0) out.push('the chain or the tasks are not empty before the first turn');
  return out;
};

/**
 * The rules' own invariants whenever the engine waits (Spec C §1.5, Spec G
 * §1.5, Spec B §15): no pending chain item while priority is asked [337];
 * no Discretionary decision while tasks are outstanding or a cleanup runs
 * [320.1], [334]; after the cleanups that precede priority, no unit with
 * lethal damage [323.4] and designations only at the combat battlefield
 * [323.2]; units unattached [143.5] and at a location of their controller's
 * [141.1.a.1]; Contested never by the controller [190.3.a]; a combat between
 * two players, with its combat showdown during Step 1 [464], [466.2]; pools
 * never negative.
 */
const rules: Check = (s) => {
  const out: string[] = [];
  for (const o of Object.values(s.objects)) {
    if (!isType(o, 'unit') || (o.zone.z !== 'base' && o.zone.z !== 'bf')) continue;
    if (o.attachedTo !== null) out.push(`unit ${o.id} is attached [143.5]`);
    if (o.zone.z === 'base' && o.zone.p !== o.controller && !s.turn.inCleanup) {
      out.push(`unit ${o.id} is in P${o.zone.p}'s base but controlled by P${o.controller} [323.6]`);
    }
  }
  s.bfs.forEach((b, bf) => {
    if (b.contested !== null && b.contested === b.controller) out.push(`bf${bf} is Contested by its controller [190.3.a]`);
  });
  for (const pl of s.players) {
    const pool = pl.pool;
    if (pool.energy < 0 || pool.universal < 0 || Object.values(pool.power).some((n) => n < 0)) {
      out.push(`P${pl.id}'s Rune Pool is negative`);
    }
  }
  const c = s.combat;
  if (c) {
    if (c.attacker === c.defender) out.push('a combat with one player [464]');
    if (c.step === 'showdown' && (s.showdown?.kind !== 'combat' || s.showdown.bf !== c.bf)) {
      out.push('a combat in Step 1 without its combat showdown [466.2]');
    }
  }
  if (s.pending?.kind === 'priority') {
    if (s.chain.some((i) => i.status === 'pending')) out.push('priority is asked with a pending chain item [337]');
    if (s.turn.tasks.length > 0 || s.turn.inCleanup) out.push('priority is asked with tasks outstanding [334], [320.1]');
    for (const o of Object.values(s.objects)) {
      if ((o.zone.z === 'base' || o.zone.z === 'bf') && isType(o, 'unit') && isLethal(s, o.id)) {
        out.push(`unit ${o.id} has lethal damage at a priority decision [323.4]`);
      }
      const atCombat = c !== null && o.zone.z === 'bf' && o.zone.bf === c.bf;
      if (o.designation !== null && !atCombat) out.push(`unit ${o.id} has a designation outside combat [323.2.c]`);
    }
    if (s.turn.priority !== s.pending.player) out.push(`P${s.pending.player} is asked priority P${s.turn.priority} holds`);
  }
  return out;
};

const CHECKS: Check[] = [zonesAgree, idsAndKnowledge, decisionAndFrames, battlefieldsAndTurn, beforeFirstTurn, rules, json];

/** Every broken invariant, as text; empty when the state is sound. The
    JSON round trip is the slow one: a fuzzer may run it less often. */
export function checkInvariants(s: GameState, o: { json?: boolean } = {}): string[] {
  return CHECKS.filter((c) => o.json !== false || c !== json).flatMap((c) => c(s));
}

export function assertInvariants(s: GameState) {
  const failures = checkInvariants(s);
  if (failures.length > 0) throw new InvariantError(failures);
}

/**
 * Spec A §5.3, once setup has finished: each player has their legend, their
 * Chosen Champion, an opening hand of 4 and the rest of the deck, 12 runes
 * and an empty base; two uncontrolled battlefields, one from each player
 * [487.4]; the First Player's turn queued [115.1.c]; nobody but its owner
 * knows a card in a hand or a deck.
 */
export function checkSetupDone(s: GameState): string[] {
  const out: string[] = [];
  if (s.frames.length > 0 || s.pending || s.result) out.push('setup has not finished');
  if (s.turn.n !== 0 || s.turn.phase !== 'setup') out.push('the first turn has already started');
  for (const pl of s.players) {
    const p = pl.id, at = `P${p}`;
    if (pl.legend.length !== 1) out.push(`${at}: ${pl.legend.length} cards in the Legend Zone [111]`);
    if (pl.champion === null) out.push(`${at}: no Chosen Champion [112]`);
    const hand = openingHandSize(s, p);
    if (pl.hand.length !== hand) out.push(`${at}: ${pl.hand.length} cards in hand, ${hand} expected [116], [117]`);
    const deck = 40 - 1 - hand;                                          // TR 402.1: the Chosen Champion is one of the 40
    if (s.rules.deckSize === 'exactly40' ? pl.deck.length !== deck : pl.deck.length < deck) {
      out.push(`${at}: ${pl.deck.length} cards in the Main Deck, ${deck} expected`);
    }
    if (pl.runeDeck.length !== 12) out.push(`${at}: ${pl.runeDeck.length} runes, 12 expected [103.4.a]`);
    for (const id of pl.hand) {
      if (s.objects[id].knownBy !== bit(p)) out.push(`${at}: hand card ${id} is known by ${s.objects[id].knownBy}`);
    }
    for (const id of [...pl.deck, ...pl.runeDeck]) {
      if ((s.objects[id].knownBy & ~bit(p)) !== 0) out.push(`${at}: deck card ${id} is known by ${s.objects[id].knownBy}`);
    }
  }
  const per = s.mode.battlefieldsPerPlayer;
  if (s.bfs.length !== s.players.length * per) out.push(`${s.bfs.length} battlefields [487.4]`);
  for (const pl of s.players) {
    const own = s.bfs.filter((b) => s.objects[b.obj]?.owner === pl.id).length;
    if (own !== per) out.push(`P${pl.id} provided ${own} battlefields, ${per} expected [487.5]`);
  }
  const order = turnOrder(s);
  if (s.turn.player !== s.turn.firstPlayer || s.turn.queue.map((q) => q.player).join() !== order.join()) {
    out.push(`the turn queue ${s.turn.queue.map((q) => q.player)} doesn't start with the First Player [115.1.c]`);
  }
  return out;
}

const STUB_KEYS = ['controller', 'facedown', 'id', 'owner', 'zone'];

/**
 * §3.14 item 4 for every player: a view shows an object's identity exactly
 * where its viewer knows it; every unknown object is a stub with a negative
 * alias and nothing but public facts; no real id or card of an unknown
 * object appears in a zone; the RNG is 0; the other players' decision is
 * only its stub; nothing is left in the event queue.
 */
export function checkViews(s: GameState): string[] {
  const out: string[] = [];
  for (const pl of s.players) {
    const p = pl.id, at = `P${p}'s view`;
    const v = viewFor(s, p);
    if (v.rng !== 0) out.push(`${at}: the RNG is visible`);
    if (v.out.length > 0) out.push(`${at}: holds events`);
    if (v.me !== p) out.push(`${at}: me is ${v.me}`);
    const mine = s.pending?.player === p;
    if (stableJson(v.pending) !== stableJson(mine ? s.pending : null)) out.push(`${at}: wrong pending decision`);
    if (stableJson(v.opponentDecision) !== stableJson(s.pending && !mine ? stubOf(s.pending) : null)) {
      out.push(`${at}: wrong stub of the other player's decision`);
    }
    const unknown = Object.values(s.objects).filter((o) => !knows(s, p, o));
    const shown: Record<number, GameObject | Stub> = v.objects;
    for (const o of Object.values(s.objects)) {
      if (unknown.includes(o)) {
        if (shown[o.id] !== undefined) out.push(`${at}: shows unknown object ${o.id} under its real id`);
      } else if (stableJson(shown[o.id]) !== stableJson(o)) out.push(`${at}: object ${o.id} differs from the state`);
    }
    const stubs = Object.entries(shown).filter(([key]) => Number(key) < 0);
    if (stubs.length !== unknown.length) out.push(`${at}: ${stubs.length} stubs for ${unknown.length} unknown objects`);
    for (const [key, st] of stubs) {
      if (st.id !== Number(key)) out.push(`${at}: stub ${key} has id ${st.id}`);
      const extra = Object.keys(st).filter((k) => !STUB_KEYS.includes(k));
      if (extra.length > 0) out.push(`${at}: stub ${key} shows ${extra.join(', ')}`);
    }
    const hidden = unknown.map((o) => o.id);
    for (const q of v.players) {
      for (const id of [...q.hand, ...q.deck, ...q.runeDeck]) {
        if (hidden.includes(id)) out.push(`${at}: the real id ${id} of an unknown card is in P${q.id}'s zones`);
        else if (shown[id] === undefined) out.push(`${at}: P${q.id}'s zones name ${id}, which the view doesn't hold`);
      }
    }
    for (const f of v.frames) {
      if ('snap' in f && f.snap !== null) out.push(`${at}: a '${f.f}' frame keeps its snapshot`);
      if (f.f === 'setup' && f.p !== p && f.locals !== null) out.push(`${at}: shows another player's setup locals`);
    }
  }
  return out;
}
