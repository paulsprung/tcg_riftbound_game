/*
 * Rule-based answers (§11.4 cheapPolicy, §11.7 Beginner): a score for each
 * real option of a decision, read off a complete state (a determinized
 * sample, or blankFill of a view). Fast, no simulation:
 *
 *   priority (main)  play the dearest affordable card; move when the combat
 *                    estimate wins or a battlefield is free to take; else end
 *   priority (other) pass, unless a card can be played (a Reaction or an
 *                    Action), which scores a little
 *   moveUnits        units that win somewhere; done once a winning group is
 *                    picked
 *   moveDest         where the estimate wins best (an empty battlefield we
 *                    don't control first), base last
 *   target           a harmful slot: the most valuable enemy unit; else the
 *                    most valuable friendly one
 *   payment          the engine's ranking (plan 0)
 *   assignNext       kill what is worth most first
 *   may, costs       yes; tokens before cards as a cost
 *   setup            play first; set aside cards costing 5 or more
 */
import { parseKey, type Decision, type Option } from '../core/decisions.ts';
import { findCard } from '../cards/oracle.ts';
import { TOKENS } from '../cards/tokens.ts';
import { unitsAt } from '../rules/board.ts';
import { damageOf, mightOf } from '../rules/chars.ts';
import type { GameState, ObjId, PlayerId } from '../state/types.ts';
import { unitValue } from './evaluate.ts';

export const realOptions = (d: Decision): Option[] => d.options.filter((o) => !o.ui);

const objOf = (o: Option) => parseKey(o.key)?.obj;
const costOf = (s: GameState, id: ObjId | undefined) => {
  const o = id === undefined ? undefined : s.objects[id];
  return o ? findCard(o.def)?.cost?.energy ?? 0 : 0;
};
const isToken = (s: GameState, id: ObjId | undefined) => id !== undefined && !!s.objects[id]?.token;

/** Might of p's units at a battlefield. */
export function mightAt(s: GameState, p: PlayerId, bf: number): number {
  let n = 0;
  for (const id of unitsAt(s, { z: 'bf', bf })) if (s.objects[id].controller === p) n += Math.max(0, mightOf(s, id));
  return n;
}

/** The ready units of p that a Standard Move could take (in base or at a battlefield). */
export function readyUnits(s: GameState, p: PlayerId): ObjId[] {
  const out = unitsAt(s, { z: 'base', p }).filter((id) => !s.objects[id].exhausted);
  s.bfs.forEach((_, bf) => {
    for (const id of unitsAt(s, { z: 'bf', bf })) if (s.objects[id].controller === p && !s.objects[id].exhausted) out.push(id);
  });
  return out;
}

/** How good moving `might` more to bf looks for p: a free conquer, a won
    combat, or a loss (negative). */
export function moveGain(s: GameState, p: PlayerId, bf: number, might: number): number {
  const opp = s.players.find((q) => q.id !== p)!.id;
  const theirs = mightAt(s, opp, bf), mine = mightAt(s, p, bf) + might;
  const b = s.bfs[bf];
  if (theirs === 0) return b.controller === p ? 0.2 : 3 + might * 0.05;   // conquer (or reinforce)
  if (mine > theirs) return 2 + (mine - theirs) * 0.1;
  if (mine === theirs) return -0.5;
  return -2;
}

/** Scores for the real options of s.pending (higher is better). */
export function heuristicScores(s: GameState, d: Decision): number[] {
  const me = d.player;
  const opts = realOptions(d);
  const kind = d.kind;
  const head = (o: Option) => parseKey(o.key)?.head;
  return opts.map((o) => {
    const k = parseKey(o.key);
    switch (kind) {
      case 'playOrder': return o.key === 'first' ? 1 : 0;
      case 'mulligan': {
        if (o.key === 'done') return 0.5;
        return costOf(s, objOf(o)) >= 5 ? 1 + costOf(s, objOf(o)) * 0.01 : 0;
      }
      case 'priority': {
        const window = d.prompt.window;
        if (head(o) === 'play') {
          const c = o.meta?.cost?.energy ?? costOf(s, objOf(o));
          return window === 'main' ? 2 + c * 0.3 : 0.3 + c * 0.05;
        }
        if (head(o) === 'act') {
          // a Gold (or any add-only token) is spent while paying, not on its own
          const id = objOf(o);
          if (isToken(s, id) && s.objects[id!]?.def === 'gold') return -0.5;
          return window === 'main' ? 1.2 : 0.2;
        }
        // hiding a card facedown: worth it in the main phase, where a unit stands to protect it
        if (head(o) === 'hide') return window === 'main' ? 0.7 : 0.1;
        if (o.key === 'move') {
          const units = readyUnits(s, me);
          const total = units.reduce((n, id) => n + Math.max(0, mightOf(s, id)), 0);
          if (units.length === 0 || total === 0) return -1;
          const best = Math.max(...s.bfs.map((_, bf) => moveGain(s, me, bf, total)));
          return best > 0 ? 1.5 + best * 0.1 : -1;
        }
        if (o.key === 'end') return 0.5;
        if (o.key === 'pass') return 0.5;
        return 0;
      }
      case 'moveUnits': {
        if (o.key === 'done') return 0.6;
        const id = objOf(o);
        return id === undefined ? 0 : 1 + Math.max(0, mightOf(s, id)) * 0.01;
      }
      case 'moveDest': {
        const units = s.frames.find((f) => f.f === 'move');
        const ids = units && units.f === 'move' ? units.units : [];
        const total = ids.reduce((n, id) => n + Math.max(0, mightOf(s, id)), 0);
        if (k?.loc === 'base') return -0.2;
        if (k?.loc !== undefined) return moveGain(s, me, k.loc.bf, total);
        return 0;
      }
      case 'hideWhere': {
        const bf = k?.loc !== undefined && k.loc !== 'base' ? k.loc.bf : undefined;
        return bf === undefined ? 0 : mightAt(s, me, bf);
      }
      case 'destination': {
        // an effect's move: away from the fight for the moved unit's owner is the safe default
        if (k?.loc === 'base') return 0.1;
        return 0;
      }
      case 'target': {
        if (o.key === 'done') return 0.1;
        const id = objOf(o);
        const ob = id === undefined ? undefined : s.objects[id];
        if (!ob) return 0.05;
        const value = (ob.zone.z === 'base' || ob.zone.z === 'bf') && findCard(ob.def)?.types.includes('unit') !== false
          ? unitValue(s, id!) : 1;
        const enemy = ob.controller !== me;
        return d.prompt.harm ? (enemy ? value : -value) : (enemy ? -value : value);
      }
      case 'payment': {
        if (o.key === 'decline') return -10;
        return -(k?.n ?? 0) * 0.1;
      }
      case 'assignNext': {
        const id = objOf(o);
        if (id === undefined) return 0;
        const lethal = Math.max(1, mightOf(s, id) - damageOf(s.objects[id]));
        const kills = (o.meta?.amount ?? 0) >= lethal;
        return (kills ? 10 : 0) + unitValue(s, id);
      }
      case 'assignExcess': return o.key === 'done' ? 1 : 0;
      case 'may': case 'optionalCost': case 'applyReplacement': return o.key === 'yes' ? 1 : 0;
      case 'showOff': return o.key === 'no' ? 0 : 1;
      case 'costObject': {
        const id = objOf(o);
        return isToken(s, id) ? 2 : 1 - costOf(s, id) * 0.05;
      }
      case 'predict': {
        const id = objOf(o);
        const c = costOf(s, id);
        return head(o) === 'keep' ? (c <= 4 ? 1 : 0) : 0.5;
      }
      case 'chooseBattlefield': {
        const bf = k?.n;
        return bf === undefined ? 0 : mightAt(s, me, bf) - mightAt(s, s.players.find((q) => q.id !== me)!.id, bf);
      }
      case 'pickCard': {
        const id = objOf(o);
        // discard the cheapest, draw the dearest
        return d.prompt.t === 'discard' ? -costOf(s, id) : costOf(s, id);
      }
      case 'addAbility': return o.key === 'done' ? 1 : 0;
      default: return 0;
    }
  });
}

/** The tokens a decision mentions are never in a deck list; nothing to do. */
export const isTokenDef = (def: string) => Object.hasOwn(TOKENS, def);

/** The best-scoring option (the first among equals). */
export function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

/** cheapPolicy (§11.4): the heuristic, with ε-random exploration. */
export function cheapAnswer(s: GameState, d: Decision, rand: () => number, eps = 0.05): string {
  const opts = realOptions(d);
  if (opts.length === 1) return opts[0].key;
  if (rand() < eps) {
    const safe = opts.filter((o) => o.key !== 'decline');
    return (safe.length > 0 ? safe : opts)[Math.floor(rand() * (safe.length > 0 ? safe : opts).length)].key;
  }
  return opts[argmax(heuristicScores(s, d))].key;
}
