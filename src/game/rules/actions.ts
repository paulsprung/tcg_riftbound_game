/*
 * The game actions the engine performs (Spec F), each as one function that
 * changes the state through state/mut.ts, emits its events with the rule it
 * implements, and makes a cleanup outstanding where [319] says one is:
 *
 *   draw [414] with Burn Out [432]      channel [431]      exhaust [415]
 *   ready [416]      recycle a rune [417]      Add to the pool and pay
 *   from it [430], [445], [167]      deal [418]      heal [419]
 *   kill [429]      move [447–455]      recall [456–460]      gain points
 *   [194]      battlefield control and Contested [190]
 *
 * M1.2 adds what the chain's spells and abilities do: banish [428], burn
 * [441], discard [423], buff [427], stun [424], look [425], "+N [M] this
 * turn" [479.4], drawing a given card [414.1] and recycling cards [417].
 * Tokens that leave the board cease to exist [186.1].
 *
 * The full pipeline of §6.3 (proposed events, replacements) arrives with
 * M1.3; nothing can replace these yet, so each commits at once. Burn Out
 * is the one replacement the rules themselves make [432.5], and it is
 * applied here. The actions triggers listen to (an Exhaust action, a Kill
 * action) tell abilities/triggers.ts what happened once committed.
 */
import { endGame } from '../core/end.ts';
import { emit, emitZone, knowers, newGroup } from '../core/events.ts';
import { emptyPool } from '../state/blank.ts';
import { fire, placeSelfLeave } from '../abilities/triggers.ts';
import { bit } from '../state/ids.ts';
import { append, deleteObject, mint, moveObject, setField } from '../state/mut.ts';
import { shuffled, shuffleZone } from '../state/rng.ts';
import { locOf, Z } from '../state/zones.ts';
import type { Domain, GameObject, GameState, Loc, ObjId, PlayerId, PowerReq, RunePool, Zone } from '../state/types.ts';
import { opponentsOf } from './board.ts';
import { isType, snapshotOf } from './chars.ts';
import { friendsAt } from './targets.ts';
import { maxBuffs, victoryScore } from './defaults.ts';
import { requestCleanup } from './tasks.ts';
import { copyJson } from '../state/clone.ts';

type X = { present: boolean };

// ---- cards from the Main Deck ----

/**
 * Draws n cards [414]. A draw from an empty Main Deck burns out first, then
 * goes on [432.1.a], [315.4.b.1–2]: as many as possible, Burn Out, the rest.
 * Returns the cards drawn (they are new objects in the hand).
 */
export function drawCards(s: GameState, x: X, p: PlayerId, n: number, rule: string): ObjId[] {
  const drawn: ObjId[] = [];
  const group = newGroup(s);
  let burnOuts = 0;
  while (drawn.length < n && !s.result) {
    const prev = s.players[p].deck[0];
    if (prev === undefined) {
      burnOut(s, x, p, burnOuts++);
      continue;
    }
    const before = knowers(s, [prev]);
    const obj = moveObject(s, prev, Z.hand(p));                     // the top card [414.1.a]
    emitZone(s, x, { obj, prev, from: Z.deck(p), to: Z.hand(p), why: 'draw', rule, before, group });
    drawn.push(obj);
  }
  if (drawn.length > 0) {
    setField(s, s.log.draws, p, s.log.draws[p] + drawn.length);
    emit(s, x, { k: 'draw', p, objs: drawn, rule, group, vis: knowers(s, drawn) });
  }
  return drawn;
}

/**
 * Burn Out [432.2]: the trash is recycled into the Main Deck in random
 * order, then an opponent gains 1 point (in a Duel the only one, no choice
 * [432.2.c]). `seq` counts the burn-outs this action caused before: from the
 * second on, a point that brings the player to the Victory Score with more
 * than every opponent wins at once, without a cleanup [432.3.b–c.1].
 */
export function burnOut(s: GameState, x: X, p: PlayerId, seq: number) {
  emit(s, x, { k: 'burnOut', p, rule: '432' });
  const group = newGroup(s);
  for (const prev of s.players[p].trash.slice()) {
    const before = knowers(s, [prev]);
    const obj = moveObject(s, prev, Z.deck(p), { pos: 'bottom' });
    emitZone(s, x, { obj, prev, from: Z.trash(p), to: Z.deck(p), why: 'burnOut', rule: '432.2.b', before, group });
  }
  const ids = shuffleZone(s, { z: 'deck', p });
  emit(s, x, { k: 'shuffle', p, zone: 'deck', count: ids.length, rule: '432.2.b' });
  const opp = opponentsOf(s, p)[0];
  gainPoints(s, x, opp, 1, 'burnOut', '432.2.c');
  const pts = s.players[opp].points;
  if (seq >= 1 && pts >= victoryScore(s) && opponentsOf(s, opp).every((q) => s.players[q].points < pts)) {
    endGame(s, x, { winner: opp, reason: 'burnout', rule: '432.3.c.1', turn: s.turn.n });
  }
}

// ---- points ----

/** A player gains points [194.1]. A point change makes the win check due:
    a cleanup becomes outstanding (Spec C Q9). */
export function gainPoints(s: GameState, x: X, p: PlayerId, n: number, why: 'conquer' | 'hold' | 'effect' | 'burnOut',
  rule: string) {
  if (n <= 0) return;
  const total = s.players[p].points + n;
  setField(s, s.players[p], 'points', total);
  append(s, s.log.points, { p, n, why });
  emit(s, x, { k: 'points', p, delta: n, total, rule });
  requestCleanup(s);
}

// ---- runes and the Rune Pool ----

/** Channels up to n runes from the top of the Rune Deck, ready [431.2.a];
    as many as there are [431.3]. Returns how many. */
export function channelRunes(s: GameState, x: X, p: PlayerId, n: number, rule: string, exhausted = false): number {
  const group = newGroup(s);
  const objs: ObjId[] = [];
  for (let i = 0; i < n; i++) {
    const prev = s.players[p].runeDeck[0];
    if (prev === undefined) break;
    const before = knowers(s, [prev]);
    const obj = moveObject(s, prev, Z.base(p), { exhausted, controller: p });   // controller: [191.4]
    emitZone(s, x, { obj, prev, from: Z.runeDeck(p), to: Z.base(p), why: 'channel', rule, before, group });
    objs.push(obj);
  }
  if (objs.length > 0) {
    emit(s, x, { k: 'channel', p, objs, rule, group });
    requestCleanup(s);                                               // entering the board [319.6]
  }
  return objs.length;
}

/** Recycles a rune: to the bottom of its owner's Rune Deck [417.1.b]. */
export function recycleRune(s: GameState, x: X, id: ObjId, rule: string): ObjId {
  const o = s.objects[id];
  const before = knowers(s, [id]);
  const from = copyJson(o.zone);
  const obj = moveObject(s, id, Z.runeDeck(o.owner), { pos: 'bottom' });
  const group = newGroup(s);
  emitZone(s, x, { obj, prev: id, from, to: Z.runeDeck(o.owner), why: 'recycle', rule, before, group });
  emit(s, x, { k: 'recycle', p: o.owner, objs: [obj], rule, group });
  requestCleanup(s);                                                 // leaving the board [319.6]
  return obj;
}

/** Exhausts objects as one action [415]: one event, one row of the turn
    log ("exhaust three or more at the same time" sees it, §1.2). */
export function exhaust(s: GameState, x: X, p: PlayerId, objs: ObjId[], rule: string, byCost: boolean) {
  const ready = objs.filter((id) => !s.objects[id].exhausted);
  if (ready.length === 0) return;
  const group = newGroup(s);
  for (const id of ready) setField(s, s.objects[id], 'exhausted', true);
  append(s, s.log.exhausted, { p, objs: ready, group, byCost });
  emit(s, x, { k: 'exhaust', objs: ready, rule, group });
  requestCleanup(s);                                                 // a status change [319.7]
  fire(s, x, { e: 'exhausted', p, objs: ready });                       // "when I become exhausted" [415]
}

/** Readies objects as one action [416]; ready ones: nothing happens [416.1.c]. */
export function ready(s: GameState, x: X, objs: ObjId[], rule: string) {
  const tired = objs.filter((id) => s.objects[id].exhausted);
  if (tired.length === 0) return;
  for (const id of tired) setField(s, s.objects[id], 'exhausted', false);
  emit(s, x, { k: 'ready', objs: tired, rule });
  requestCleanup(s);
}

const poolTotal = (pool: RunePool) =>
  pool.energy + pool.universal + Object.values(pool.power).reduce((a, b) => a + b, 0);

/** Adds Energy and Power to a player's Rune Pool [430.1], [166.1]. */
export function addToPool(s: GameState, x: X, p: PlayerId, energy: number, power: Domain[], rule: string) {
  const pool = s.players[p].pool;
  if (energy > 0) setField(s, pool, 'energy', pool.energy + energy);
  for (const d of power) setField(s, pool.power, d, pool.power[d] + 1);
  emit(s, x, { k: 'pool', p, pool: copyJson(pool), rule });
}

/**
 * Pays a cost from the pool [357.1], [445.1]: Energy pays Energy only
 * [163.1]; each Power symbol takes Power of a domain it accepts, else
 * universal Power [163.2.b], [135.2.e.6.c]. The caller made sure the pool
 * covers it (rules/resources.ts). Returns the Power spent per domain.
 */
export function payFromPool(s: GameState, x: X, p: PlayerId, energy: number, power: PowerReq[], rule: string, spell = false) {
  const pool = s.players[p].pool;
  const plain = Math.min(pool.energy, energy);
  setField(s, pool, 'energy', pool.energy - plain);
  let rest = energy - plain;                                         // restricted Energy pays the rest [430]
  if (rest > 0) {
    const restricted = pool.restricted.map((r) => {
      if (rest <= 0 || r.kind !== 'energy' || (r.onlyFor === 'spells' && !spell)) return r;
      const take = Math.min(rest, r.amount);
      rest -= take;
      return { ...r, amount: r.amount - take };
    }).filter((r) => r.amount > 0);
    setField(s, pool, 'restricted', restricted);
  }
  for (const req of power.slice().sort(byWidth)) {
    const d = poolDomainFor(pool, req);
    if (d) setField(s, pool.power, d, pool.power[d] - 1);
    else setField(s, pool, 'universal', pool.universal - 1);
  }
  emit(s, x, { k: 'pool', p, pool: copyJson(pool), rule });
}

/** Narrow Power symbols first, so a broad one doesn't take the only Power a
    narrow one could use: one domain, then a choice of some, then any. */
export const byWidth = (a: PowerReq, b: PowerReq) => width(a) - width(b);
const width = (r: PowerReq) => (r.k === 'domain' ? 1 : r.k === 'anyOf' ? r.ds.length : 6);

/** The domain whose Power in the pool pays a symbol, or null for universal. */
export function poolDomainFor(pool: RunePool, req: PowerReq): Domain | null {
  const ds = req.k === 'domain' ? [req.d] : req.k === 'anyOf' ? req.ds : (Object.keys(pool.power) as Domain[]);
  return ds.find((d) => pool.power[d] > 0) ?? null;
}

/** Every player's pool empties; unspent Energy and Power are lost [167],
    [316.3], [317.2.d]. */
export function emptyPools(s: GameState, x: X, rule: string) {
  for (const pl of s.players) {
    if (poolTotal(pl.pool) === 0 && pl.pool.restricted.length === 0) continue;
    setField(s, pl, 'pool', emptyPool());
    emit(s, x, { k: 'pool', p: pl.id, pool: emptyPool(), rule });
  }
}

// ---- damage and death ----

/**
 * Deals damage as one Deal action [418]: every amount at the same time,
 * each a mark of the player responsible [142.3.a]. Only valid damage (1 or
 * more) is dealt [418.1.e]. `lastDamage` keeps who did it for the kills of
 * the next cleanup [429.5.c].
 */
export function deal(s: GameState, x: X, hits: { to: ObjId; n: number }[], o: {
  sources: ObjId[]; by: PlayerId | null; combat: boolean; rule: string; item?: number;
}) {
  const group = newGroup(s);
  for (const h of hits) {
    if (h.n < 1) continue;
    const u = s.objects[h.to];
    append(s, u.damage, { amount: h.n, by: o.by, sources: o.sources, combat: o.combat, group });
    setField(s, u, 'lastDamage', { item: o.item ?? null, sources: o.sources, by: o.by, combat: o.combat });
    emit(s, x, { k: 'deal', to: h.to, n: h.n, sources: o.sources, combat: o.combat, rule: o.rule, group });
  }
  requestCleanup(s);                                                 // a status change [319.7]
}

/** Heals units: removes all their damage [419.1]. */
export function heal(s: GameState, x: X, units: ObjId[], rule: string) {
  const hurt = units.filter((id) => s.objects[id].damage.length > 0);
  if (hurt.length === 0) return;
  for (const id of hurt) setField(s, s.objects[id], 'damage', []);
  emit(s, x, { k: 'heal', objs: hurt, rule });
  requestCleanup(s);
}

/**
 * Kills units as one Kill action [429]: each goes to its owner's trash
 * [429.1], [056] as a new object [124]. The turn log keeps what each was as
 * it died (last-known information [383.2.c.3.b]).
 */
export function kill(s: GameState, x: X, units0: ObjId[], o: { rule: string; inCombat: (id: ObjId) => boolean }) {
  // "The next time it would die this turn, heal it, exhaust it, and recall
  // it instead" (Highlander, Tactical Retreat): a replacement [367].
  const units: ObjId[] = [];
  for (const id of units0) {
    const e = s.effects.find((f) => (f.spec as { s?: string } | null)?.s === 'replaceDeath' && 'objs' in f.affects
      && f.affects.objs.includes(id));
    if (!e || !isType(s.objects[id], 'unit')) { units.push(id); continue; }
    setField(s, s, 'effects', s.effects.filter((f) => f.id !== e.id));
    emit(s, x, { k: 'replaced', source: e.source ?? id, event: 'die', rule: '369.1' });
    heal(s, x, [id], '419');
    exhaust(s, x, s.objects[id].controller ?? s.objects[id].owner, [id], '415', false);
    recall(s, x, [id], '457');
  }
  if (units.length === 0) return;
  const group = newGroup(s);
  emit(s, x, { k: 'kill', objs: units.slice(), rule: o.rule, group });
  const deaths: { snap: ReturnType<typeof snapshotOf>; at: Loc | null; item: number | null; alone: boolean }[] = [];
  const snaps = units.map((id) => snapshotOf(s, id));               // all at once: they die simultaneously [303.1]
  const alone = units.map((id) => isType(s.objects[id], 'unit') && friendsAt(s, id).length === 0);
  units.forEach((id, i) => placeSelfLeave(s, x, id, snaps[i], { alone: alone[i] }));   // Deathknell, before the move [808.1.d.2]
  for (const [i, id] of units.entries()) {
    const u = s.objects[id];
    const snap = snaps[i], at = locOf(u), inCombat = o.inCombat(id), item = u.lastDamage?.item ?? null;
    toZone(s, x, id, Z.trash(u.owner), { why: 'kill', rule: o.rule, group });
    append(s, s.log.deaths, { snap, group, inCombat, at });
    deaths.push({ snap, at, item, alone: alone[i] });
  }
  requestCleanup(s);                                                 // leaving the board [319.6]
  fire(s, x, { e: 'died', deaths });
}

/**
 * Moves a card to a non-board zone with its 'zone' event [124]. A token
 * going anywhere but the chain ceases to exist instead [186.1]. Returns the
 * new id, or null for a token that is gone.
 */
export function toZone(s: GameState, x: X, id: ObjId, to: Zone, o: { why: string; rule: string; group?: number;
  pos?: 'top' | 'bottom' }): ObjId | null {
  const u = s.objects[id];
  const from = copyJson(u.zone);
  if (locOf(u) !== null) detachAll(s, x, id, '719.5');              // attachments stay on the board [719.5]
  if (u.token && to.z !== 'chain') {
    deleteObject(s, id);
    emit(s, x, { k: 'tokenGone', obj: id, rule: '186.1', group: o.group });
    return null;
  }
  const before = knowers(s, [id]);
  const obj = moveObject(s, id, to, o.pos ? { pos: o.pos } : {});
  emitZone(s, x, { obj, prev: id, from, to, why: o.why, rule: o.rule, before, group: o.group });
  return obj;
}

/** Banishes cards [428]: each to its owner's banishment [428.1], [056]. */
export function banish(s: GameState, x: X, objs: ObjId[], rule: string) {
  if (objs.length === 0) return;
  const group = newGroup(s);
  const out: ObjId[] = [];
  const fromBoard = objs.some((id) => locOf(s.objects[id]) !== null);
  for (const id of objs) {
    const n = toZone(s, x, id, Z.banish(s.objects[id].owner), { why: 'banish', rule, group });
    if (n !== null) out.push(n);
  }
  if (out.length > 0) emit(s, x, { k: 'banish', p: s.objects[out[0]].owner, objs: out, rule, group });
  if (fromBoard) requestCleanup(s);                                  // [319.6]
}

/** Burns n [441]: from the top of the Main Deck to the trash, as many as
    possible; an empty deck burns out first, then the burn goes on
    [441.4], [432.1.b]. */
export function burn(s: GameState, x: X, p: PlayerId, n: number, rule: string) {
  const group = newGroup(s);
  const burned: ObjId[] = [];
  let burnOuts = 0;
  while (burned.length < n && !s.result) {
    const top = s.players[p].deck[0];
    if (top === undefined) {
      burnOut(s, x, p, burnOuts++);
      continue;
    }
    burned.push(toZone(s, x, top, Z.trash(p), { why: 'burn', rule, group })!);
  }
  if (burned.length > 0) emit(s, x, { k: 'burn', p, objs: burned, rule, group });
}

/** Discards cards from a hand to the trash [423.1]. */
export function discard(s: GameState, x: X, p: PlayerId, objs: ObjId[], rule: string) {
  if (objs.length === 0) return;
  const group = newGroup(s);
  const out = objs.map((id) => toZone(s, x, id, Z.trash(p), { why: 'discard', rule, group })!);
  setField(s, s.log.discards, p, s.log.discards[p] + out.length);
  emit(s, x, { k: 'discard', p, objs: out, rule, group });
  fire(s, x, { e: 'discarded', p, objs: out });                      // "When you discard me" [423]
}

/** Draws a given card [414.1]: "draw one of them". */
export function drawCard(s: GameState, x: X, p: PlayerId, id: ObjId, rule: string): ObjId {
  const group = newGroup(s);
  const before = knowers(s, [id]);
  const from = copyJson(s.objects[id].zone);
  const obj = moveObject(s, id, Z.hand(p));
  emitZone(s, x, { obj, prev: id, from, to: Z.hand(p), why: 'draw', rule, before, group });
  setField(s, s.log.draws, p, s.log.draws[p] + 1);
  emit(s, x, { k: 'draw', p, objs: [obj], rule, group, vis: knowers(s, [obj]) });
  return obj;
}

/** Recycles cards of a Main Deck to its bottom [417.1]; several go in a
    random order [417.5], so nobody knows which new id is which (§7.2). */
export function recycleCards(s: GameState, x: X, p: PlayerId, objs: ObjId[], rule: string) {
  if (objs.length === 0) return;
  const group = newGroup(s);
  const order = objs.length > 1 ? shuffledIds(s, objs) : objs;
  const out: ObjId[] = [];
  for (const id of order) {
    const before = knowers(s, [id]);
    const from = copyJson(s.objects[id].zone);
    const obj = moveObject(s, id, Z.deck(p), { pos: 'bottom', ...(objs.length > 1 ? { knownBy: 0 } : {}) });
    emitZone(s, x, { obj, prev: id, from, to: Z.deck(p), why: 'recycle', rule, before, group });
    out.push(obj);
  }
  emit(s, x, { k: 'recycle', p, objs: out, rule, group, vis: knowers(s, out) });
}

/** A player looks at cards [425]: they know them now, nobody else does. */
export function look(s: GameState, x: X, p: PlayerId, objs: ObjId[], rule: string) {
  if (objs.length === 0) return;
  for (const id of objs) setField(s, s.objects[id], 'knownBy', s.objects[id].knownBy | bit(p));
  emit(s, x, { k: 'look', objs: objs.slice(), to: bit(p), rule, vis: bit(p) });
}

/** Buffs units [427]: one buff counter each, none on a unit that has one
    [427.1.b], [702.3]. Returns the units buffed. */
export function buffUnits(s: GameState, x: X, units: ObjId[], rule: string, by: PlayerId | null = null): ObjId[] {
  const done = units.filter((id) => s.objects[id].buffs < maxBuffs(s, id));
  if (done.length === 0) return done;
  for (const id of done) setField(s, s.objects[id], 'buffs', s.objects[id].buffs + 1);
  emit(s, x, { k: 'buff', objs: done, rule });
  requestCleanup(s);                                                 // [319.7]
  fire(s, x, { e: 'buffed', objs: done, by });                       // "When you buff a friendly unit" (Mistfall)
  return done;
}

/** Spends a buff of each unit [702.2.b]. Returns the units that had one. */
export function spendBuffs(s: GameState, x: X, units: ObjId[], rule: string): ObjId[] {
  const done = units.filter((id) => s.objects[id].buffs > 0);
  for (const id of done) setField(s, s.objects[id], 'buffs', s.objects[id].buffs - 1);
  if (done.length > 0) {
    emit(s, x, { k: 'spendBuff', objs: done, rule });
    requestCleanup(s);
  }
  return done;
}

/** Stuns units [424]: until the end of the turn [424.1.a.2]. */
export function stunUnits(s: GameState, x: X, units: ObjId[], rule: string, by: PlayerId | null = null): ObjId[] {
  const done = units.filter((id) => !s.objects[id].stunned);
  if (done.length === 0) return done;
  for (const id of done) setField(s, s.objects[id], 'stunned', true);
  emit(s, x, { k: 'stun', objs: done, rule });
  requestCleanup(s);
  fire(s, x, { e: 'stunned', objs: done, by });                      // "When you [Stun] an enemy unit" (Vex, Mocking)
  return done;
}

/** "+N [M] this turn" on a locked set of units [479.4], its amount fixed now
    [479.4.b]; a negative N lowers it (Might may go below 0 [143.2.c]). */
export function addMight(s: GameState, x: X, units: ObjId[], n: number, o: { controller: PlayerId; source: ObjId | null;
  item: number | null; rule: string; until?: 'thisTurn' | 'thisCombat' | 'permanent' }) {
  if (units.length === 0 || n === 0) return;
  append(s, s.effects, {
    id: mint(s, 'eff'), ts: mint(s, 'ts'), controller: o.controller, source: o.source, item: o.item, rule: o.rule,
    layer: 4, sub: n > 0 ? 'inc' : 'dec', affects: { objs: units.slice() }, spec: { s: 'might', n }, until: o.until ?? 'thisTurn',
  });
  for (const id of units) emit(s, x, { k: 'mightChanged', obj: id, from: null, to: null, rule: o.rule });
  requestCleanup(s);                                                 // a Might change can make damage lethal [319.7]
}

/** A continuous effect on a locked set of objects for the rest of the turn
    [479]: "its base Might becomes N" (layer 2), "give … [Shield 2]" (layer
    3). The objects are fixed now [479.4.b]. */
export function addEffect(s: GameState, x: X, objs: ObjId[], spec: { s: 'baseMight'; n: number } | { s: 'keyword'; kw: string;
  value: number } | { s: 'cantMove' } | { s: 'replaceDeath' }, o: { controller: PlayerId; source: ObjId | null; item: number | null;
  rule: string; until?: 'thisTurn' | 'thisCombat' | 'permanent' }) {
  if (objs.length === 0) return;
  append(s, s.effects, {
    id: mint(s, 'eff'), ts: mint(s, 'ts'), controller: o.controller, source: o.source, item: o.item, rule: o.rule,
    layer: spec.s === 'baseMight' ? 2 : 3, affects: { objs: objs.slice() }, spec, until: o.until ?? 'thisTurn',
  });
  for (const id of objs) {
    if (spec.s === 'baseMight') emit(s, x, { k: 'mightChanged', obj: id, from: null, to: null, rule: o.rule });
    else if (spec.s === 'keyword') emit(s, x, { k: 'keywordsChanged', obj: id, rule: o.rule });
  }
  requestCleanup(s);                                                 // a Might change can make damage lethal [319.7]
}

// ---- movement ----

/**
 * Moves units to one destination as one Move action [448]: instantaneous,
 * no chain [448.3]; each keeps its object, damage and status, since a
 * board-to-board change is not a zone change [124]. Each counts a move this
 * turn. Contested is applied where the movers' controller doesn't control
 * the battlefield [452], [190.3.a.1]; then a cleanup [455].
 */
export function moveUnits(s: GameState, x: X, units: ObjId[], to: Loc, o: { by: PlayerId | null; standard: boolean;
  rule: string }) {
  if (units.length === 0) return;
  const group = newGroup(s);
  const from = units.map((id) => locOf(s.objects[id])!);
  units.forEach((id, i) => {
    moveObject(s, id, to);
    carryAttachments(s, id);                                         // not a move for them [719.3.a], [448.1]
    setField(s, s.objects[id], 'moves', s.objects[id].moves + 1);
    append(s, s.log.moves, { obj: id, from: from[i], to, by: o.by, standard: o.standard, group });
  });
  emit(s, x, { k: 'move', objs: units.slice(), from, to, standard: o.standard, rule: o.rule, group });
  if (to.z === 'bf') {
    for (const id of units) applyContested(s, x, to.bf, s.objects[id].controller!);
  }
  requestCleanup(s);
  fire(s, x, { e: 'moved', objs: units.slice(), to, by: o.by });    // "When I move", "When you move an enemy unit"
}

/** Whether an effect forbids a unit to move this turn (Vex, Apathetic). */
export const cantMove = (s: GameState, id: ObjId) => s.effects.some((e) => (e.spec as { s?: string } | null)?.s === 'cantMove'
  && 'objs' in e.affects && e.affects.objs.includes(id));

/** A unit's attachments go where it goes [719.3]. */
function carryAttachments(s: GameState, id: ObjId) {
  const u = s.objects[id];
  for (const g of Object.values(s.objects)) {
    if (g.attachedTo !== id || sameZoneLoc(g, u)) continue;
    moveObject(s, g.id, u.zone);
  }
}
const sameZoneLoc = (a: GameObject, b: GameObject) => JSON.stringify(a.zone) === JSON.stringify(b.zone);

// ---- attachment [435], [436], [716–719] ----

/** Attaches a non-unit to a unit [435]: its location becomes the unit's,
    not a move [435.4]; a unit can't be attached [435.1.h.1]. */
export function attach(s: GameState, x: X, obj: ObjId, to: ObjId, rule: string): boolean {
  const g = s.objects[obj], u = s.objects[to];
  if (!g || !u || isType(g, 'unit') || !isType(u, 'unit') || g.attachedTo === to) return false;
  if (locOf(g) === null || locOf(u) === null) return false;
  if (g.attachedTo !== null) detach(s, x, obj, '435.1.f');
  setField(s, g, 'attachedTo', to);
  if (!sameZoneLoc(g, u)) moveObject(s, obj, u.zone);
  emit(s, x, { k: 'attach', obj, to, equipped: true, rule });
  requestCleanup(s);                                                 // [319.7]
  return true;
}

/** Detaches a card [436]: it stays where it is [436.4]. */
export function detach(s: GameState, x: X, obj: ObjId, rule: string): boolean {
  const g = s.objects[obj];
  if (!g || g.attachedTo === null) return false;
  setField(s, g, 'attachedTo', null);
  emit(s, x, { k: 'detach', obj, rule });
  requestCleanup(s);
  return true;
}

/** Every card attached to a unit detaches (the unit leaves the board [719.5]). */
export function detachAll(s: GameState, x: X, unit: ObjId, rule: string) {
  for (const g of Object.values(s.objects)) if (g.attachedTo === unit) detach(s, x, g.id, rule);
}

// ---- more zone changes ----

/** Returns cards to their owners' hands: from the board (a token ceases to
    exist [186.1]) or from a trash. */
export function returnToHand(s: GameState, x: X, objs: ObjId[], rule: string): ObjId[] {
  const group = newGroup(s);
  const out: ObjId[] = [];
  const left: { snap: ReturnType<typeof snapshotOf>; at: Loc | null }[] = [];
  for (const id of objs) {
    const o = s.objects[id];
    if (!o) continue;
    const at = locOf(o);
    if (at) left.push({ snap: snapshotOf(s, id), at });
    const n = toZone(s, x, id, Z.hand(o.owner), { why: 'returnToHand', rule, group });
    if (n !== null) out.push(n);
  }
  if (left.length > 0) {
    requestCleanup(s);                                               // [319.6]
    fire(s, x, { e: 'returned', objs: left });
  }
  return out;
}

/** Recycles a permanent or a card to its owner's Main Deck [417.1.a]. */
export function recyclePermanent(s: GameState, x: X, id: ObjId, rule: string): ObjId | null {
  const o = s.objects[id];
  const onBoard = locOf(o) !== null;
  const n = toZone(s, x, id, Z.deck(o.owner), { why: 'recycle', rule, pos: 'bottom' });
  if (onBoard) requestCleanup(s);
  if (n !== null) emit(s, x, { k: 'recycle', p: o.owner, objs: [n], rule, vis: knowers(s, [n]) });
  return n;
}

/** Puts the top N cards of a Main Deck into the trash, as many as there are (not a Burn [441]). */
export function mill(s: GameState, x: X, p: PlayerId, n: number, rule: string): ObjId[] {
  const group = newGroup(s);
  const out: ObjId[] = [];
  for (let i = 0; i < n; i++) {
    const top = s.players[p].deck[0];
    if (top === undefined) break;
    out.push(toZone(s, x, top, Z.trash(p), { why: 'mill', rule, group })!);
  }
  return out;
}

/** A player gains XP [730.1]. */
export function gainXp(s: GameState, x: X, p: PlayerId, n: number, rule: string) {
  if (n <= 0) return;
  setField(s, s.players[p], 'xp', s.players[p].xp + n);
  setField(s, s.log.xpGained, p, (s.log.xpGained[p] ?? 0) + n);
  emit(s, x, { k: 'xp', p, delta: n, rule });
  requestCleanup(s);
}

/** A player spends XP [730.2]; false if they have too little [203.3]. */
export function spendXp(s: GameState, x: X, p: PlayerId, n: number, rule: string): boolean {
  if (s.players[p].xp < n) return false;
  setField(s, s.players[p], 'xp', s.players[p].xp - n);
  emit(s, x, { k: 'xp', p, delta: -n, rule });
  requestCleanup(s);
  return true;
}

/** Adds universal Power ([A]) or Energy only for spells to a pool [430], [163.2.b]. */
export function addSpecial(s: GameState, x: X, p: PlayerId, o: { energy?: number; universal?: number; onlyFor?: 'spells';
  source: string }, rule: string) {
  const pool = s.players[p].pool;
  if (o.universal) setField(s, pool, 'universal', pool.universal + o.universal);
  if (o.energy) {
    if (o.onlyFor) append(s, pool.restricted, { amount: o.energy, kind: 'energy', onlyFor: o.onlyFor, source: o.source });
    else setField(s, pool, 'energy', pool.energy + o.energy);
  }
  emit(s, x, { k: 'pool', p, pool: copyJson(pool), rule });
}

/** Recalls permanents to their controller's base [457]: not a move [458],
    damage and status stay [460]. */
export function recall(s: GameState, x: X, objs: ObjId[], rule: string) {
  if (objs.length === 0) return;
  for (const id of objs) {
    moveObject(s, id, Z.base(s.objects[id].controller ?? s.objects[id].owner));
    carryAttachments(s, id);
  }
  emit(s, x, { k: 'recall', objs: objs.slice(), rule });
  requestCleanup(s);
}

// ---- battlefields ----

/** A unit of p becomes present at a battlefield p doesn't control: p
    applies Contested, unless it is Contested already [190.3.a]. */
export function applyContested(s: GameState, x: X, bf: number, p: PlayerId) {
  const b = s.bfs[bf];
  if (b.contested !== null || b.controller === p) return;
  setField(s, b, 'contested', p);
  emit(s, x, { k: 'contested', bf, p, rule: '190.3.a' });
}

export function clearContested(s: GameState, x: X, bf: number, rule: string) {
  if (s.bfs[bf].contested === null) return;
  setField(s, s.bfs[bf], 'contested', null);
  emit(s, x, { k: 'contested', bf, p: null, rule });
}

/** A battlefield's controller [190.2]; its object has the same one. */
export function setController(s: GameState, x: X, bf: number, p: PlayerId | null, rule: string) {
  const b = s.bfs[bf];
  if (b.controller === p) return;
  setField(s, b, 'controller', p);
  setField(s, s.objects[b.obj], 'controller', p);
  emit(s, x, { k: 'control', bf, p, rule });
  requestCleanup(s);
}

const shuffledIds = (s: GameState, ids: ObjId[]) => shuffled(s, ids);

/** Facedown cards at a battlefield whose controller doesn't control it go
    to their owners' trash, revealed [323.6.a], [468.5.c], [422.4]. */
export function trashForeignFacedown(s: GameState, x: X, bf: number, rule: string) {
  const b = s.bfs[bf];
  for (const id of b.facedown.slice()) {
    const o = s.objects[id];
    if (o.controller === b.controller) continue;
    const before = knowers(s, [id]);
    const obj = moveObject(s, id, Z.trash(o.owner));
    emitZone(s, x, { obj, prev: id, from: Z.facedown(bf), to: Z.trash(o.owner), why: 'trash', rule, before });
  }
}
