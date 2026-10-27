/*
 * Conditions (§9.2 CondAst): the "if" of an instruction [359.3.e], an
 * intervening "if" of a trigger [383.2.a.1], the "while" of a static
 * ability [365], a replacement [367] or a cost [356], and the conditions of
 * dependent keywords: Legion [812.1.c], Level [824.1.c]. A condition reads
 * the state now, the facts of the play that made the item [135.2.b.7], the
 * outcomes of the item's earlier instructions [359.3.e.14], what the
 * trigger condition captured [359.3.f.3] and the last-known information of
 * the source [383.2.c.3.b].
 */
import type { CondAst, RefAst } from '../dsl/ast.ts';
import { locOf } from '../state/zones.ts';
import type { ChainItem, GameState, Json, ObjId, Outcome, PlayedRecord, PlayerId, Snapshot } from '../state/types.ts';
import { cmp, predOk, selectAll } from './targets.ts';
import { victoryScore } from './defaults.ts';
import { findCard } from '../cards/oracle.ts';

export interface CondCtx {
  controller: PlayerId;
  /** "I/me": the ability's source, or the card being played. */
  source: ObjId | null;
  /** What was performed while the card was played ("if you showed off"). */
  facts?: PlayedRecord | null;
  /** The item's outcomes so far, by instruction id (`id:<name>`). */
  outcomes?: Record<string, Outcome>;
  /** The item, for the targets it chose. */
  item?: ChainItem;
  /** What the trigger condition captured. */
  info?: Record<string, Json>;
  /** The source as it left the board (Deathknell). */
  lki?: Snapshot | null;
  /** Names the resolution bound ("it": the revealed card). */
  bound?: Record<string, Json>;
  /** Where the card being played comes from. */
  origin?: string;
  /** The Equipment whose effect text is evaluated. */
  thisObj?: ObjId | null;
}

/** Whether an outcome counts as "you do" [359.3.e.14.b]: the instruction
    did what it said, in full or in part. */
export const didIt = (o: Outcome | undefined) => o !== undefined && (o.o === 'executed' || o.o === 'partial');

/** The object a reference names for a condition, or null. */
function refObj(s: GameState, r: RefAst, x: CondCtx): ObjId | null {
  if (r === 'self') return x.source;
  if (typeof r === 'object' && 'now' in r) {                           // the card wherever it is now
    const id = refObj(s, r.now, x);
    const card = (id !== null ? s.objects[id]?.card : undefined) ?? (r.now === 'self' ? x.lki?.card ?? x.item?.sourceLki?.card : undefined);
    const o = card === undefined ? undefined : Object.values(s.objects).find((y) => y.card === card && !y.token);
    return o ? o.id : null;
  }
  if ('slot' in r) {
    const t = x.item?.play.choices.executions[0].targets[r.slot]?.[0];
    return t?.k === 'obj' ? t.id : null;
  }
  if ('event' in r) return typeof x.info?.subject === 'number' ? x.info.subject : null;
  if ('info' in r) return typeof x.info?.[r.info] === 'number' ? (x.info[r.info] as number) : null;
  const b = x.bound?.[r.bound];
  const objs = b && typeof b === 'object' && !Array.isArray(b) && Array.isArray(b.objs) ? b.objs as number[] : [];
  return objs[0] ?? null;
}

export function evalCond(s: GameState, c: CondAst, x: CondCtx): boolean {
  switch (c.c) {
    case 'showedOff': return (x.facts?.showOff ?? []).some((r) => r.picks.length > 0);   // [832.1.c.1]
    case 'did': return didIt(x.outcomes?.[`id:${c.instr}`]);
    case 'not': return !evalCond(s, c.of, x);
    case 'and': return c.of.every((d) => evalCond(s, d, x));
    case 'or': return c.of.some((d) => evalCond(s, d, x));
    case 'yourTurn': return s.turn.player === x.controller;
    case 'selfAt': {
      const o = x.source === null ? undefined : s.objects[x.source];
      const loc = o ? locOf(o) : null;
      return loc !== null && (c.at === 'battlefield' ? loc.z === 'bf' : loc.z === 'base');
    }
    case 'count': {
      const eventBf = typeof x.info?.bf === 'number' ? x.info.bf : null;
      return cmp(selectAll(s, c.of, { controller: x.controller, source: x.source, eventBf }).length, c.op, c.n);
    }
    case 'legion': {                                                 // another card finalized by you this turn [812.1.c]
      const me = x.source === null ? undefined : s.objects[x.source]?.card;
      return s.log.finalized.some((f) => f.p === x.controller && f.isCard && f.card !== me);
    }
    case 'xp': return s.players[x.controller].xp >= c.n;             // [824.1.c]
    case 'playedFrom': return x.facts?.from === c.z;
    case 'playedTo': return x.facts?.to?.z === c.z;
    case 'paid': return (x.facts?.paidOptional ?? []).some((k) => k === c.ability || k.startsWith(`${c.ability}@`));
    case 'is': {
      const id = refObj(s, c.ref, x);
      return id !== null && !!s.objects[id] && predOk(s, c.pred, id, { controller: x.controller, source: x.source,
        subject: typeof x.info?.subject === 'number' ? x.info.subject : null, eventBf: typeof x.info?.bf === 'number' ? x.info.bf : null });
    }
    case 'thisTurn': {
      const p = x.controller;
      const types = c.types;
      const typed = (ts: string[]) => !types || types.some((t) => ts.includes(t));
      let n = 0;
      switch (c.what) {
        case 'discarded': n = s.log.discards[p]; break;
        case 'unitDied': n = s.log.deaths.filter((d) => d.snap.chars.types.includes('unit') && (c.rel === undefined
          || (c.rel === 'friendly' ? d.snap.controller === p : d.snap.controller !== null && d.snap.controller !== p))).length; break;
        case 'played': n = s.log.played.filter((r) => r.p === p && r.isCard && typed(r.types)
          && (!c.tag || (findCard(r.def)?.tags ?? []).includes(c.tag))).length; break;
        case 'playedToBf': n = s.log.played.filter((r) => r.p === p && r.to?.z === 'bf' && typed(r.types)).length; break;
        case 'finalized': n = s.log.finalized.filter((r) => r.p === p && r.isCard && typed(r.types)).length; break;
      }
      return cmp(n, c.op ?? '>=', c.n ?? 1);
    }
    case 'excess': return (s.combat?.excess[x.controller] ?? 0) >= c.n;
    case 'info': return JSON.stringify(x.info?.[c.key] ?? null) === JSON.stringify(c.eq);
    case 'handSize': return cmp(s.players[x.controller].hand.length, c.op, c.n);
    case 'opponentNearWin': return s.players.some((pl) => pl.id !== x.controller && pl.points >= victoryScore(s) - c.within);
    case 'firstBeginning': {
      const p = typeof x.info?.p === 'number' ? x.info.p : x.controller;
      return s.history.beginningPhasesStarted[p] === 1;
    }
    case 'full': return x.outcomes?.[`id:${c.instr}`]?.o === 'executed';
    case 'lkiAtBf': return x.lki?.loc?.z === 'bf';
    case 'notFromHand': return x.origin !== undefined && x.origin !== 'hand';
    case 'attachedThisTurn': return x.thisObj !== undefined && x.thisObj !== null && s.objects[x.thisObj]?.attachedTurn === s.turn.n;
    case 'chosenEnemies': return new Set(s.log.targeted.filter((t) => t.by === x.controller && t.enemy).map((t) => t.item)).size >= c.n;
    case 'controlsSelf': return x.source !== null && s.objects[x.source]?.controller === x.controller;
    case 'powerSpent': return (s.log.powerSpent[x.controller] ?? 0) >= c.n;
    case 'nearWin': return s.players[x.controller].points >= victoryScore(s) - c.within;
    case 'boundDomain': {
      const b = x.bound?.[c.name] as { domains?: string[] } | undefined;
      return (b?.domains ?? []).includes(c.d);
    }
    case 'lki': {
      const l = x.lki;
      if (!l) return false;
      if (c.pred.p === 'mighty') return (l.chars.might ?? 0) >= 5;
      if (c.pred.p === 'might') return cmp(l.chars.might ?? 0, c.pred.op, c.pred.n);
      return false;
    }
  }
}
