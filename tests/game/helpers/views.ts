import { parseKey, stubOf } from '../../../src/game/core/decisions.ts';
import { knows } from '../../../src/game/core/view.ts';
import {
  cloneState, type DecisionStub, type GameObject, type GameResult, type GameState, type ObjId, type ObservedEvent,
  type PlayerId, type PlayerView,
} from '../../../src/game/index.ts';
import { mulberry32 } from '../../../src/game/state/rng.ts';
import { zoneLabel } from '../../../src/game/state/zones.ts';

/*
 * Tools for the hidden-information tests (§14.5).
 *
 * The fold (P6): a player who starts from their view and applies the events
 * as they observed them must arrive at their next view. The real
 * applyObserved belongs to the UI model (src/play/model, §12.6); this is a
 * reference version over what the table shows: every zone's cards, in order,
 * each either an identified card ('41:hunting-dog') or an anonymous one ('?'),
 * plus the turn order, the decision being made and the result.
 */

export interface Table {
  zones: Record<string, string[]>;
  first: PlayerId;
  player: PlayerId;
  queue: PlayerId[];
  deciding: DecisionStub | null;
  result: GameResult | null;
}

function entry(v: PlayerView, id: ObjId): string {
  const o = v.objects[id];
  if (!o) throw new Error(`view names ${id} but holds no such object`);
  return 'def' in o ? `${id}:${o.def}` : '?';
}

export function tableOf(v: PlayerView): Table {
  const zones: Record<string, string[]> = {};
  for (const pl of v.players) {
    for (const z of ['legend', 'hand', 'deck', 'runeDeck', 'trash', 'banish', 'base'] as const) {
      zones[zoneLabel({ z, p: pl.id })] = pl[z].map((id) => entry(v, id));
    }
    zones[zoneLabel({ z: 'champion', p: pl.id })] = pl.champion === null ? [] : [entry(v, pl.champion)];
  }
  v.bfs.forEach((b, bf) => {
    zones[`battlefield${bf}`] = [entry(v, b.obj)];
    zones[zoneLabel({ z: 'bf', bf })] = b.here.map((id) => entry(v, id));
    zones[zoneLabel({ z: 'facedown', bf })] = b.facedown.map((id) => entry(v, id));
  });
  return {
    zones, first: v.turn.firstPlayer, player: v.turn.player, queue: v.turn.queue.map((q) => q.player),
    deciding: v.pending ? stubOf(v.pending) : v.opponentDecision, result: v.result,
  };
}

/** One observed event applied to the table. A card the viewer didn't know
    leaves its zone from the top (draws take the top card [414.1.a]); cards
    enter decks at the bottom (recycling [417.1]) and hands in arrival order,
    a card the viewer knows ahead of the ones they don't. */
export function applyObserved(t0: Table, e: ObservedEvent): Table {
  const t = structuredClone(t0);
  switch (e.k) {
    case 'zone': {
      const from = t.zones[zoneLabel(e.from)], to = t.zones[zoneLabel(e.to)];
      const known = e.prev === undefined ? -1 : from.findIndex((x) => x.startsWith(`${e.prev}:`));
      const i = known >= 0 ? known : from.indexOf('?');
      if (i < 0) throw new Error(`fold: nothing in ${zoneLabel(e.from)} matches ${JSON.stringify(e)}`);
      from.splice(i, 1);
      // A view lists the hand cards it knows before the stubs (core/redact.ts).
      const stub = e.to.z === 'hand' && e.obj !== null ? to.indexOf('?') : -1;
      to.splice(stub >= 0 ? stub : to.length, 0, e.obj === null ? '?' : `${e.obj}:${e.def}`);
      break;
    }
    case 'shuffle': {
      const z = zoneLabel({ z: e.zone, p: e.p });
      t.zones[z] = t.zones[z].map(() => '?');
      break;
    }
    case 'playOrder': {
      const n = Object.keys(t.zones).filter((k) => k.startsWith('legend(')).length;
      t.first = t.player = e.first;
      t.queue = Array.from({ length: n }, (_, i) => ((e.first + i) % n) as PlayerId);
      break;
    }
    case 'deciding': t.deciding = e.stub; break;
    case 'gameOver': t.result = e.result ?? null; t.deciding = null; break;
    default: break;                       // summaries and announcements: the zone events moved the cards
  }
  return t;
}

/** The table after one step: the decision it answered is gone, then each
    event in order. */
export function fold(t: Table, events: ObservedEvent[]): Table {
  return events.reduce(applyObserved, { ...structuredClone(t), deciding: null });
}

/**
 * A copy of s that differs in everything p can't know (§14.5 #2): the hidden
 * cards of each zone swapped among themselves, the real ids and card refs of
 * every unknown object renamed, the generator re-seeded. Returns the copy and
 * the renaming, to translate answers that name renamed cards.
 */
export function perturb(s: GameState, p: PlayerId, seed: number): { state: GameState; rename: (id: ObjId) => ObjId } {
  let r = seed >>> 0;
  const shuffle = <T>(xs: T[]): T[] => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const step = mulberry32(r);
      r = step.next;
      const j = Math.floor(step.value * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const t = cloneState(s);
  const unknown = Object.values(t.objects).filter((o) => !knows(s, p, o));

  const byZone: Record<string, GameObject[]> = {};
  for (const o of unknown) (byZone[zoneLabel(o.zone)] ??= []).push(o);
  for (const group of Object.values(byZone)) {
    const faces = shuffle(group.map((o) => ({ def: o.def, printing: o.printing })));
    group.forEach((o, i) => Object.assign(o, faces[i]));
  }
  const cards = shuffle(unknown.map((o) => o.card));
  unknown.forEach((o, i) => { o.card = cards[i]; });

  const ids = unknown.map((o) => o.id), renamed = shuffle(ids);
  const map: Record<ObjId, ObjId> = {};
  ids.forEach((id, i) => { map[id] = renamed[i]; });
  const rename = (id: ObjId) => map[id] ?? id;
  const objects: Record<ObjId, GameObject> = {};
  for (const o of Object.values(t.objects)) objects[rename(o.id)] = { ...o, id: rename(o.id) };
  t.objects = objects;
  for (const pl of t.players) {
    for (const z of ['hand', 'deck', 'runeDeck'] as const) pl[z] = pl[z].map(rename);
  }
  for (const b of t.bfs) b.facedown = b.facedown.map(rename);
  for (const f of t.frames) {
    if (f.f === 'setup' && f.locals !== null) {
      const l = f.locals as { set: ObjId[] };
      f.locals = { set: l.set.map(rename) };
    }
  }
  if (t.pending) {
    for (const o of t.pending.options) {
      const id = parseKey(o.key)?.obj;
      if (id !== undefined) o.key = o.key.replace(`:${id}`, `:${rename(id)}`);
      for (const ref of o.refs ?? []) if ('obj' in ref) ref.obj = rename(ref.obj);
    }
  }
  t.rng = (s.rng ^ 0x9e3779b9 ^ seed) >>> 0;
  return { state: t, rename };
}

/** An observed event without the identities a draw or a reveal may show:
    what must not depend on hidden cards (§14.5 #4). */
export function shapeOf(e: ObservedEvent): ObservedEvent {
  const { def: _def, ...rest } = e as ObservedEvent & { def?: string };
  return rest as ObservedEvent;
}
