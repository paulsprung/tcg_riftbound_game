/*
 * Hidden information (§7): what one player may know of a game.
 *
 * One predicate, knows(), decides whether a player knows an object; one
 * mechanism, the view, is the state with everything the viewer doesn't know
 * replaced by positional stubs, the RNG removed and the other player's
 * options stripped (P5). The UI renders views, the AI only ever receives
 * views, and observe() gives each player the events as they saw them.
 *
 * The alias walker that builds a view lives in core/redact.ts; this module
 * holds the predicate, the view types and the three entry points.
 *
 * In M0 views cover hands, decks and rune decks; facedown cards arrive with
 * Hidden (M2), reveals and looks with M1 (§7.5).
 */
import { hasBit } from '../state/ids.ts';
import type { GameObject, GameState, ObjId, PlayerId, Zone } from '../state/types.ts';
import type { DecisionStub } from './decisions.ts';
import { EngineError } from './errors.ts';
import type { GameEvent } from './events.ts';
import { placeholderFor, redact } from './redact.ts';

export type { DecisionStub } from './decisions.ts';

/** Whether player p knows what object o is (§7.1). */
export function knows(_s: GameState, p: PlayerId, o: GameObject): boolean {
  switch (o.zone.z) {
    case 'deck': case 'runeDeck': return hasBit(o.knownBy, p);                 // Secret [108.4.e], [108.5]
    case 'hand': return o.owner === p || hasBit(o.knownBy, p);                 // Private [108.7.c]
    case 'facedown': return o.controller === p || hasBit(o.knownBy, p);        // [107.3.f], [129.4]
    default: return true;                                                       // public zones [109]
  }
}

/** < 0: an object the viewer doesn't know. Depends only on the zone and the
    object's position among the viewer's unknown objects there (§7.3); in
    another player's hand, a hand being unordered [108.7.d], that position
    says nothing about when the card arrived. */
export type Alias = number;

/** What a viewer sees of an object they don't know: only public facts. */
export interface Stub {
  id: Alias;
  zone: Zone;
  owner: PlayerId;
  controller: PlayerId | null;
  facedown?: { hiddenOnTurn: number; bf: number };
}

/** A state in which some objects are stubs. */
export type Redacted<S extends GameState> = Omit<S, 'objects'> & { objects: Record<number, GameObject | Stub> };

declare const VIEW: unique symbol;

/** One player's view: a complete game state minus exactly what that player
    may not know, in the same shape. Only core/view.ts makes one. */
export type PlayerView = Redacted<GameState> & {
  readonly [VIEW]: true;
  me: PlayerId;
  opponentDecision: DecisionStub | null;
};

/**
 * An event as one player saw it (§7.4). Where the player may not see an
 * identity, it is blanked: a card they don't know after a move is `obj:
 * null` (an anonymous card moving), its old id `prev` is shown only to those
 * who knew it before, `def` only to those who knew it on either side, and
 * the cards of a draw, recycle or other summary are null entries. Everything
 * else is the event as the engine emitted it.
 */
export type ObservedEvent = Observed<GameEvent>;

type Observed<E> = E extends { k: 'zone' } ? Omit<E, 'obj' | 'knew' | 'knows'> & { obj: ObjId | null }
  : E extends { k: 'hide' } ? Omit<E, 'obj'> & { obj: ObjId | null }
  : E extends { objs: ObjId[] } ? Omit<E, 'objs'> & { objs: (ObjId | null)[] }
  : E;

/** p's view of s (§7.3). */
export function viewFor(s: GameState, p: PlayerId): PlayerView {
  return redact(s, p, (o) => knows(s, p, o));
}

/** The events of one step as player p saw them (§7.4). */
export function observe(events: GameEvent[], p: PlayerId): ObservedEvent[] {
  return events.map((e) => observed(structuredClone(e), p));
}

function observed(e: GameEvent, p: PlayerId): ObservedEvent {
  const sees = hasBit(e.vis, p);
  switch (e.k) {
    case 'zone': {
      const { obj, prev, def, knew, knows: after, ...rest } = e;
      const before = hasBit(knew ?? e.vis, p), now = hasBit(after ?? e.vis, p);
      const out: ObservedEvent = { ...rest, obj: now ? obj : null };
      if (before && prev !== undefined) out.prev = prev;
      if ((before || now) && def !== undefined) out.def = def;
      return out;
    }
    case 'hide': return { ...e, obj: sees ? e.obj : null };
    case 'draw': case 'discard': case 'recycle': case 'banish': case 'channel': case 'burn': case 'reveal': case 'look':
      return { ...e, objs: sees ? e.objs : e.objs.map(() => null) };
    default:
      if (!sees) throw new EngineError(`observe(): '${e.k}' events are never hidden, but this one is (vis ${e.vis})`);
      return e;
  }
}

/**
 * The view as a game state: every stub replaced by a vanilla placeholder
 * under its alias (no abilities, no cost; PLACEHOLDER_DEF). Feasibility and
 * the explanations run on it, so they use nothing the viewer can't see
 * (§4.6, §12.7).
 */
export function blankFill(v: PlayerView): GameState {
  const { me: _me, opponentDecision: _stub, ...rest } = structuredClone(v);
  const objects: Record<ObjId, GameObject> = {};
  for (const o of Object.values(rest.objects)) objects[o.id] = 'def' in o ? o : placeholderFor(o);
  return { ...rest, objects } as GameState;
}
