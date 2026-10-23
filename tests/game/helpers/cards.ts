import { setField } from '../../../src/game/state/mut.ts';
import type { DefId, ObjId, PlayerId } from '../../../src/game/index.ts';
import { act, inHand, keys, reask, runes, start, type Game } from './scenario.ts';

/*
 * Card behaviour tests (the starter decks): a Seraphine mirror at P0's first
 * Main Phase with quiet battlefields, any legend or battlefield swapped in,
 * plenty of runes, and a driver that answers what a test doesn't care about.
 */

/** Two runes of every domain, ready: 12 Energy, 2 Power of each domain. */
export const RICH: [string, boolean][] = ['fury', 'calm', 'mind', 'body', 'chaos', 'order']
  .flatMap((d): [string, boolean][] => [[d, true], [d, true]]);

/** A table for card tests: battlefields without abilities, legends as given. */
export function table(seed: number, o: { legends?: [DefId?, DefId?]; bfs?: [DefId?, DefId?]; first?: PlayerId } = {}): Game {
  const g = start(seed, { first: o.first ?? 0 });
  setBf(g, 0, o.bfs?.[0] ?? 'placeholder');
  setBf(g, 1, o.bfs?.[1] ?? 'placeholder');
  for (const p of [0, 1] as const) setLegend(g, p, o.legends?.[p] ?? 'placeholder');
  runes(g, 0, RICH);
  runes(g, 1, RICH);
  return g;
}

/** A legend without abilities that interfere, or the one a test is about. */
export function setLegend(g: Game, p: PlayerId, def: DefId) {
  setField(g.s, g.s.objects[g.s.players[p].legend[0]], 'def', def);
}

export function setBf(g: Game, i: number, def: DefId) {
  setField(g.s, g.s.objects[g.s.bfs[i].obj], 'def', def);
}

/**
 * Answers decisions until the turn player's Main Phase priority: keys from
 * `answers` first (each used once, when offered), then: pass on chains and
 * in showdowns, payment plan 0, yes to "may", no to optional costs and Show
 * Off, base as a location, otherwise the first real option.
 */
export function drive(g: Game, answers: string[] = [], o: { max?: number } = {}): Game {
  const left = answers.slice();
  for (let i = 0; i < (o.max ?? 300) && g.s.pending && !g.s.result; i++) {
    const d = g.s.pending;
    if (d.kind === 'priority' && d.prompt.window === 'main' && !left.some((k) => keys(g).includes(k))) break;
    const j = left.findIndex((k) => keys(g).includes(k));
    if (j >= 0) { act(g, left.splice(j, 1)[0]); continue; }
    const has = (k: string) => keys(g).includes(k);
    if (d.kind === 'priority') act(g, 'pass');
    else if (d.kind === 'payment') act(g, has('pay:0') ? 'pay:0' : 'decline');
    else if (d.kind === 'may' || d.kind === 'applyReplacement') act(g, 'yes');
    else if (d.kind === 'optionalCost' || d.kind === 'showOff') act(g, 'no');
    else if (d.kind === 'location' && has('loc:base')) act(g, 'loc:base');
    else act(g, d.options.find((x) => !x.ui && x.key !== 'done')?.key ?? d.options.find((x) => !x.ui)!.key);
  }
  return g;
}

/** Puts a card in p's hand and plays it from P0's Main Phase priority, then drives. */
export function cast(g: Game, def: DefId, answers: string[] = [], p: PlayerId = 0): ObjId {
  const id = inHand(g, def, p);
  reask(g);
  act(g, `play:${id}`);
  drive(g, answers);
  return id;
}

/** p's objects of a definition on the board. */
export const onBoard = (g: Game, def: DefId, p?: PlayerId) => Object.values(g.s.objects)
  .filter((o) => o.def === def && (p === undefined || o.controller === p) && (o.zone.z === 'base' || o.zone.z === 'bf'))
  .map((o) => o.id);

export const handSize = (g: Game, p: PlayerId = 0) => g.s.players[p].hand.length;

/** A Standard Move of these units to a location ('base' or a battlefield index), from Main Phase priority. */
export function moveTo(g: Game, units: ObjId[], to: number | 'base'): Game {
  reask(g);
  act(g, 'move');
  for (const u of units) if (keys(g).includes(`u:${u}`)) act(g, `u:${u}`);
  if (keys(g).includes('done')) act(g, 'done');
  const k = to === 'base' ? 'loc:base' : `loc:bf${to}`;
  if (keys(g).includes(k)) act(g, k);
  return g;
}

/** Hides a [Hidden] card of P0's at a battlefield P0 controls (the controller must hold it). */
export function hide(g: Game, def: DefId, bf: number): ObjId {
  const id = inHand(g, def, 0);
  reask(g);
  act(g, `hide:${id}`);
  if (keys(g).includes(`loc:bf${bf}`)) act(g, `loc:bf${bf}`);
  drive(g);
  const fd = g.s.bfs[bf].facedown[g.s.bfs[bf].facedown.length - 1];
  return fd;
}

/** Ends P0's turn and the opponent's, back to P0's Main Phase (driving what comes up). */
export function nextTurn(g: Game): Game {
  reask(g);
  act(g, 'end');
  drive(g);
  if (g.s.pending?.kind === 'priority' && g.s.pending.player === 1) act(g, 'end');
  drive(g);
  return g;
}

/** Answers with a key only if it is asked (a single public option is applied by the engine itself). */
export const opt = (g: Game, key: string) => { if (keys(g).includes(key)) act(g, key); };
