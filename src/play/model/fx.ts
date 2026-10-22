import type { ObjId, ObservedEvent, PlayerId } from '../../game/index.ts';

/*
 * Animations from the event log (§12.6), the light way: the events that
 * arrived since the last frame say which cards entered, moved, took damage
 * or were buffed, which lanes flashed (control, showdown, combat) and whose
 * score moved. The table gives those cards and lanes a short CSS animation
 * (off with the app's Effects toggle and under prefers-reduced-motion), and
 * outlines what the opponent just did, so their actions can be followed.
 */

export type FxKind = 'enter' | 'draw' | 'move' | 'hit' | 'heal' | 'buff' | 'stun' | 'ready';

export interface Fx {
  /** Increases with every batch: a key that restarts the animations. */
  token: number;
  objs: Record<ObjId, { k: FxKind; n?: number }>;
  lanes: Record<number, 'control' | 'clash' | 'score'>;
  score: PlayerId[];
  chain: boolean;
  /** The batch came from someone else's answer: outline what it touched. */
  theirs: boolean;
}

export const NO_FX: Fx = { token: 0, objs: {}, lanes: {}, score: [], chain: false, theirs: false };

/** The effects of a batch of observed events. */
export function fxOf(events: readonly ObservedEvent[], token: number, theirs: boolean): Fx {
  const out: Fx = { token, objs: {}, lanes: {}, score: [], chain: false, theirs };
  const set = (id: ObjId | null | undefined, k: FxKind, n?: number) => {
    if (id === null || id === undefined) return;
    const prev = out.objs[id];
    if (k === 'hit' && prev?.k === 'hit') out.objs[id] = { k, n: (prev.n ?? 0) + (n ?? 0) };
    else if (!prev || k === 'hit') out.objs[id] = n === undefined ? { k } : { k, n };
  };
  for (const e of events) {
    switch (e.k) {
      case 'zone':
        if (e.to.z === 'base' || e.to.z === 'bf') set(e.obj, 'enter');
        else if (e.to.z === 'hand') set(e.obj, 'draw');
        else if (e.to.z === 'chain') out.chain = true;
        break;
      case 'draw': for (const id of e.objs) set(id, 'draw'); break;
      case 'move': case 'recall': for (const id of e.objs) set(id, 'move'); break;
      case 'deal': set(e.to, 'hit', e.n); break;
      case 'heal': for (const id of e.objs) set(id, 'heal'); break;
      case 'buff': case 'empower': for (const id of e.objs) set(id, 'buff'); break;
      case 'mightChanged': if ((e.to ?? 0) > (e.from ?? 0)) set(e.obj, 'buff'); break;
      case 'stun': for (const id of e.objs) set(id, 'stun'); break;
      case 'ready': for (const id of e.objs) set(id, 'ready'); break;
      case 'control': out.lanes[e.bf] = 'control'; break;
      case 'showdownStart': case 'combatStart': out.lanes[e.bf] = 'clash'; break;
      case 'score': out.lanes[e.bf] = 'score'; break;
      case 'points': if (!out.score.includes(e.p)) out.score.push(e.p); break;
      case 'chainPush': case 'chainPop': out.chain = true; break;
      default: break;
    }
  }
  return out;
}

/** Whether a batch is worth animating at all. */
export const hasFx = (f: Fx) =>
  Object.keys(f.objs).length > 0 || Object.keys(f.lanes).length > 0 || f.score.length > 0 || f.chain;
