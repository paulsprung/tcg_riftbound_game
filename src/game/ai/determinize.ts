/*
 * Determinization (§11.3): from the AI's view to a complete game state it
 * can simulate. What is unknown in a view is exactly its stubs (both decks'
 * and rune decks' order and identities, the opponent's hand); each stub
 * becomes a card drawn from what is left of its owner's list once every
 * card the AI can see is taken out ("open list": the built-in decks'
 * lists are public, TR 401.5). The sample keeps the stub's alias as its id,
 * so option keys mean the same in every sample (an information-set action),
 * and gets a fresh engine RNG from the AI's own generator.
 *
 * The AI never builds a state from setup data (§2.2): this is the only way
 * it gets one. A sample whose pools run dry (a list that doesn't fit what
 * was seen) falls back to vanilla placeholders for the rest.
 */
import type { DeckList } from '../decks/decklist.ts';
import { placeholderFor, PLACEHOLDER_DEF } from '../core/redact.ts';
import type { PlayerView, Stub } from '../core/view.ts';
import { TOKENS } from '../cards/tokens.ts';
import { copyJson } from '../state/clone.ts';
import type { DefId, GameObject, GameState, ObjId, PlayerId } from '../state/types.ts';

/** A complete state sampled from a view; only the AI's simulations hold one. */
export type SimState = GameState;

const isStub = (o: GameObject | Stub): o is Stub => !('def' in o);

/** The cards of a list as a flat multiset, per pool. */
function pools(list: DeckList | undefined): { main: DefId[]; runes: DefId[] } {
  const flat = (es: { def: DefId; n: number }[]) => es.flatMap((e) => Array.from({ length: e.n }, () => e.def));
  return { main: list ? flat(list.main) : [], runes: list ? flat(list.runes) : [] };
}

/** Removes one copy of def from a pool; false when there is none. */
function take(pool: DefId[], def: DefId): boolean {
  const i = pool.indexOf(def);
  if (i < 0) return false;
  pool.splice(i, 1);
  return true;
}

/** Fisher–Yates with the AI's generator. */
export function shuffleWith<T>(xs: T[], rand: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The unknown cards of each player: their list minus every card of theirs
 * the viewer knows (tokens are never in a list [185]).
 */
export function unknownPools(v: PlayerView, decks: readonly DeckList[]): { main: DefId[]; runes: DefId[] }[] {
  const out = v.players.map((pl) => pools(decks[pl.id]));
  for (const o of Object.values(v.objects)) {
    if (isStub(o) || Object.hasOwn(TOKENS, o.def)) continue;
    const pool = out[o.owner];
    if (!pool) continue;
    if (!take(pool.main, o.def)) take(pool.runes, o.def);
  }
  return out;
}

/** One sample of the hidden information of a view (§11.3). */
export function determinize(v: PlayerView, decks: readonly DeckList[], rand: () => number): SimState {
  const { me: _me, opponentDecision: _stub, ...rest } = copyJson(v);
  const left = unknownPools(v, decks).map((p) => ({ main: shuffleWith(p.main, rand), runes: shuffleWith(p.runes, rand) }));
  const objects: Record<ObjId, GameObject> = {};
  for (const o of Object.values(rest.objects)) {
    if (!isStub(o)) { objects[o.id] = o; continue; }
    const base = placeholderFor(o);
    const pool = left[o.owner as PlayerId];
    const from = o.zone.z === 'runeDeck' ? pool?.runes : pool?.main;
    const def = from && from.length > 0 ? from.pop()! : PLACEHOLDER_DEF;
    objects[o.id] = { ...base, def };
  }
  const seed = Math.floor(rand() * 4294967296) >>> 0;
  return { ...rest, objects, rng: seed } as SimState;
}
