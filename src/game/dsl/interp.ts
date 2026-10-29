/*
 * The interpreter (§9.3): resolving a chain item [340], [359.3.d],
 * [407.5]. The master loop's R row starts it once every player has passed
 * in sequence; a 'resolve' frame then runs the item's instructions top to
 * bottom (a spell's own text, then each chosen mode's in printed order;
 * once more for each paid Repeat, with that execution's choices [820.2]),
 * and for each instruction:
 *
 *   1  stops if the item has left the chain [359.3.e.15];
 *   2  re-checks its targets: all illegal → ignored, it does nothing
 *      [359.3.e.6–7]; some illegal → it acts on the legal ones [359.3.e.8];
 *   3  reads its referents now ("here", "your units", X) [359.3.f.2]; those
 *      that no longer exist → ignored [359.3.e.12];
 *   4  asks a resolution-time choice in an 'instr' frame (which card to
 *      draw, what to discard, Predict, "you may", a cost within the
 *      instruction [740.4.a], which buff to spend) [355.18], resuming with
 *      the answer;
 *   5  performs it, as much as it can [055];
 *   6  records its outcome on the item and in an 'outcome' event
 *      [359.3.e.14].
 *
 * Nothing finalizes or resolves meanwhile and no cleanup runs: an event
 * that would make one outstanding sets cleanupRequested [158.3], [321];
 * triggers wait as placeTriggers tasks. Then a spell goes to its owner's
 * trash and counts as played [359.3.d], [420.4.a] (even if every
 * instruction was ignored [359.3.e.10]); the item leaves the chain [319.5].
 */
import { abilityIn, cardDef, keywordCost, keywordsOf } from '../cards/registry.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { endGame } from '../core/end.ts';
import { emit, emitZone, knowers } from '../core/events.ts';
import { answer, ask, defineSteps, ret, takeRet, type FrameOf, type StepOut } from '../core/frames.ts';
import { EngineError } from '../core/errors.ts';
import { allMask } from '../state/ids.ts';
import { append, moveObject, pushFrame, setField } from '../state/mut.ts';
import { Z, locOf } from '../state/zones.ts';
import type {
  ChainItem, Env, GameState, Json, Loc, ObjId, Outcome, PlayerId, PowerReq, TargetRef,
} from '../state/types.ts';
import type { InstrAst, MoveToAst, ProgAst, RefAst, SelAst, SlotAst, ValueAst } from './ast.ts';
import { collect, fire, placeAll, placeSelfLeave } from '../abilities/triggers.ts';
import {
  addEffect, addMight, addSpecial, attach, banish, buffUnits, burn, cantMove, channelRunes, deal, detach, discard, drawCard,
  drawCards, exhaust, gainPoints, gainXp, heal, kill, look, mill, moveUnits, ready, recall, recycleCards, recyclePermanent, recycleRune, returnToHand,
  replaceBattlefield, setEmpowered, spendBuffs, spendXp, stunUnits, swapBackBattlefield, toZone,
} from '../rules/actions.ts';
import { itemById, markFepr, removeItem } from '../rules/chain.ts';
import { energyCostOf, isType, keywordOf, mightOf, snapshotOf, tagsOf, typesOf } from '../rules/chars.ts';
import { evalCond, tagsAmong, type CondCtx } from '../rules/conditions.ts';
import { mint } from '../state/mut.ts';
import { hereOf, matches, maxEmpowerOf, predOk, sameLoc, selectAll, slotLocsOf, stillLegal, type SelCtx } from '../rules/targets.ts';
import { requestCleanup } from '../rules/tasks.ts';
import { costOf, putOnChain, resourceCost } from '../play/playCard.ts';
import { payStep } from '../play/pay.ts';
import { noMoveToBase } from '../rules/move.ts';
import { findCard } from '../cards/oracle.ts';
import { derive, staticsFor } from '../layers/derive.ts';
import { opponentsOf, turnOrderFromTurnPlayer, unitsAt } from '../rules/board.ts';
import { goldsOf, type ResourceCost } from '../rules/resources.ts';
import { copyJson } from '../state/clone.ts';
import { chooseNext } from '../play/choices.ts';

type ResolveFrame = FrameOf<'resolve'>;
type X = { present: boolean };

/** One instruction of an item, with the key its outcome is recorded under.
    `guard`: a branch of an `if` or a `may`, executed only when it was taken.
    `exec`: the execution it belongs to (0, then one per paid Repeat [820]). */
interface Step { key: string; instr: InstrAst; slots: SlotAst[]; exec: number; guard?: { key: string; branch: string };
  /** The player a "for each player" step is executed as. */
  as?: PlayerId }

/** Players in turn order from p, or from the one after p [MP]. */
const orderFrom = (n: number, p: PlayerId, next: boolean): PlayerId[] =>
  Array.from({ length: n }, (_, i) => ((p + i + (next ? 1 : 0)) % n) as PlayerId);

/** The program an item executes as it resolves: a spell's text, an
    ability's effect. */
export function programOf(s: GameState, it: ChainItem): ProgAst | undefined {
  if (it.kind === 'card') return cardDef(s.objects[it.obj!].def)?.spell;
  if (it.ability) {
    const a = abilityIn(s, it.ability);
    return a && (a.kind === 'triggered' || a.kind === 'activated') ? a.effect : undefined;
  }
  return undefined;
}

/** An instruction list as steps; an `if`'s and a `may`'s branches follow it, guarded. */
interface Who { n: number; controller: PlayerId; as?: PlayerId }

function flatten(body: InstrAst[], prefix: string, slots: SlotAst[], exec: number, guard: Step['guard'] | undefined, who: Who): Step[] {
  const out: Step[] = [];
  body.forEach((instr, i) => {
    const key = `${prefix}${i}`;
    out.push({ key, instr, slots, exec, ...(guard ? { guard } : {}), ...(who.as !== undefined ? { as: who.as } : {}) });
    if (instr.op === 'if') {
      out.push(...flatten(instr.then, `${key}.t`, slots, exec, { key, branch: 'then' }, who));
      out.push(...flatten(instr.else ?? [], `${key}.e`, slots, exec, { key, branch: 'else' }, who));
    }
    if (instr.op === 'may') out.push(...flatten(instr.then, `${key}.t`, slots, exec, { key, branch: 'then' }, who));
    if (instr.op === 'choiceBy') {
      instr.modes.forEach((m, mi) => out.push(...flatten(m.body, `${key}.m${mi}.`, slots, exec, { key, branch: `m${mi}` }, who)));
    }
    if (instr.op === 'forEach') {
      const me = who.as ?? who.controller;
      const order = orderFrom(who.n, me, instr.from === 'next').filter((q) => instr.who === 'each' || q !== me);
      // Each player's steps are guarded by the forEach itself (taken once it executes).
      for (const q of order) out.push(...flatten(instr.body, `${key}.p${q}.`, slots, exec, guard, { ...who, as: q }));
    }
  });
  return out;
}

/** The instructions in order: the program's own, then each chosen mode's
    in printed order [355.3]; again for each further execution [820.1.d]. */
function stepsOf(s: GameState, it: ChainItem): Step[] {
  const prog = programOf(s, it);
  if (!prog) return [];
  const own = prog.choose ?? [];
  const out: Step[] = [];
  const who: Who = { n: s.players.length, controller: it.controller };
  it.play.choices.executions.forEach((ex, e) => {
    const pre = e === 0 ? '' : `x${e}.`;
    out.push(...flatten(prog.body, `${pre}b`, own, e, undefined, who));
    (prog.modes?.of ?? []).forEach((m, mi) => {
      if (!ex.modes.includes(mi)) return;
      out.push(...flatten(m.body, `${pre}m${mi}.`, [...own, ...(m.choose ?? [])], e, undefined, who));
    });
  });
  return out;
}

/** Where the battlefields the item's slots chose are ("friendly units there"). */
function slotLocs(s: GameState, it: ChainItem, exec = 0): Record<string, Loc | null> {
  return slotLocsOf(s, it.play.choices.executions[exec]);
}

/** What the item's conditions read: its controller, its source, the facts of
    the play that made it [135.2.b.7], its outcomes so far, what the trigger
    captured and its source's last-known information. */
function condCtx(s: GameState, it: ChainItem): CondCtx {
  const src = it.source ?? it.obj ?? null;
  const facts = it.kind === 'card' ? it.play.facts : (src !== null ? s.objects[src]?.played ?? null : null);
  return { controller: it.controller, source: src, facts, outcomes: it.outcomes, item: it, info: it.trigger,
    lki: it.sourceLki ?? null };
}

/** The R row: the newest finalized item resolves [339.1], [340.1]. */
export function startResolve(s: GameState) {
  const it = [...s.chain].reverse().find((i) => i.status === 'finalized');
  if (!it) throw new EngineError('every player passed, but no finalized item is on the chain');
  setField(s, s.turn, 'resolving', it.id);
  const env: Env = { self: it.source ?? null, thisObj: it.obj ?? null, controller: it.controller, bound: {}, execution: 0 };
  pushFrame(s, { f: 'resolve', item: it.id, ip: [0], env });
}

// ---- references ----

const objsOf = (v: Json | undefined): ObjId[] =>
  (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.objs) ? (v.objs as number[]) : []);
/** Binds a name for the rest of the resolution ("them", "the other"); the
    frame's own bookkeeping, not a change to the game. */
function bind(s: GameState, f: ResolveFrame, name: string, objs: ObjId[]) {
  const key = f.env.as === undefined ? name : `${name}#p${f.env.as}`;
  // The cards too, so "it" can be found after it changed zones (a drawn card, a discarded one).
  const cards = objs.map((id) => s.objects[id]?.card ?? -1);
  f.env.bound = { ...f.env.bound, [key]: { objs, cards } };
}

const targetsOf = (it: ChainItem, st: Step, slot: string): TargetRef[] =>
  it.play.choices.executions[st.exec]?.targets[slot] ?? [];

/** What a reference names now, or null when the information is gone
    [359.3.e.12]. Targets come back with the illegal ones dropped. */
function resolveRef(s: GameState, it: ChainItem, env: Env, r: RefAst | SelAst, st: Step, c: SelCtx):
  { objs: ObjId[]; ignored?: Outcome } {
  if (typeof r === 'object' && 'k' in r) return { objs: selectAll(s, r, c) };      // a set locked now [479.4]
  if (r === 'this') {
    const id = thisOf(s, it, env);
    return id !== null ? { objs: [id] } : { objs: [], ignored: { o: 'ignored', why: 'nullInfo' } };
  }
  if (typeof r === 'object' && 'paid' in r) {                        // the objects a cost exhausted or killed
    const snaps = Object.values(it.play.facts.costObjects ?? {}).flat().filter((sn) => sn.id !== it.source);   // not "[E]" itself
    const objs = snaps.filter((sn) => (r.paid === 'kill' ? !s.objects[sn.id] : !!s.objects[sn.id])).map((sn) => sn.id);
    return { objs: objs.filter((id) => s.objects[id]) };
  }
  if (r === 'self') {
    const id = env.self;
    return id !== null && s.objects[id] ? { objs: [id] } : { objs: [], ignored: { o: 'ignored', why: 'nullInfo' } };
  }
  if ('slot' in r) {
    const slot = st.slots.find((sl) => sl.id === r.slot)!;
    const chosen = targetsOf(it, st, r.slot);
    if (chosen.length === 0) return { objs: [] };                                // "up to" with none chosen
    const legal = chosen.filter((t) => stillLegal(s, t, slot, c)).map((t) => (t as { id: ObjId }).id);
    return legal.length === 0 ? { objs: [], ignored: { o: 'ignored', why: 'targets' } } : { objs: legal };
  }
  if ('bound' in r) return { objs: boundObjs(env, r.bound).filter((id) => s.objects[id]) };
  if ('now' in r) {
    const id = nowOf(s, it, env, r.now, st, c);
    return id !== null ? { objs: [id] } : { objs: [], ignored: { o: 'ignored', why: 'nullInfo' } };
  }
  const v = 'info' in r ? it.trigger?.[r.info] : it.trigger?.subject;
  return typeof v === 'number' && s.objects[v] ? { objs: [v] } : { objs: [], ignored: { o: 'ignored', why: 'nullInfo' } };
}

/** The item's source as an id, if it still exists. */
const env0 = (it: ChainItem): ObjId | null => it.source ?? null;

/** "this": the card whose text the item's ability is: the spell itself, the Equipment an effect text comes from, or the source. */
function thisOf(s: GameState, it: ChainItem, env: Env): ObjId | null {
  if (it.kind === 'card' && it.obj !== undefined) return it.obj;
  const def = it.ability ? it.ability.slice(0, it.ability.indexOf('#')) : null;
  const src = env.self;
  if (src !== null && s.objects[src]) {
    if (s.objects[src].def === def) return src;
    const g = Object.values(s.objects).find((o) => o.attachedTo === src && o.def === def);
    if (g) return g.id;
  }
  return null;
}

/** The objects a name is bound to: its own binding, else every player's of a "for each player" block. */
export function boundObjs(env: Env, name: string): ObjId[] {
  if (env.as !== undefined && env.bound[`${name}#p${env.as}`] !== undefined) return objsOf(env.bound[`${name}#p${env.as}`]);
  if (env.bound[name] !== undefined) return objsOf(env.bound[name]);
  return Object.keys(env.bound).filter((k) => k.startsWith(`${name}#p`)).flatMap((k) => objsOf(env.bound[k]));
}

/** The card an object was, wherever it is now [124]: the one object with its card identity. */
function nowOf(s: GameState, it: ChainItem, env: Env, r: RefAst, st: Step, c: SelCtx): ObjId | null {
  let card: number | undefined;
  const subjectCard = it.trigger?.subjectCard;
  if (typeof r === 'object' && 'event' in r && typeof subjectCard === 'number' && subjectCard >= 0
    && !(typeof it.trigger?.subject === 'number' && s.objects[it.trigger.subject as number])) card = subjectCard;   // a dying card, now in its trash
  else if (r === 'self') card = (env.self !== null ? s.objects[env.self]?.card : undefined) ?? it.sourceLki?.card;
  else {
    const id = firstOf(s, it, env, r, st, c);
    if (id === null) return null;
    card = s.objects[id]?.card ?? it.play.lookBack[id]?.card;
  }
  if (card === undefined) return null;
  const o = Object.values(s.objects).find((x) => x.card === card && !x.token);
  return o ? o.id : null;
}

/** The object a reference names at all, legal or not, live or looked back. */
function firstOf(s: GameState, it: ChainItem, env: Env, r: RefAst, st: Step, c: SelCtx): ObjId | null {
  if (typeof r === 'object' && 'slot' in r) {
    const t = targetsOf(it, st, r.slot)[0];
    return t?.k === 'obj' ? t.id : null;
  }
  if (typeof r === 'object' && 'bound' in r) return boundObjs(env, r.bound)[0] ?? null;   // even if it moved since
  return resolveRef(s, it, env, r, st, c).objs[0] ?? null;
}

/** A number an instruction reads as it executes [359.3.f.2]. */
function value(s: GameState, it: ChainItem, env: Env, v: ValueAst, st: Step, c: SelCtx): number {
  if (typeof v === 'number') return v;
  switch (v.v) {
    case 'count': return selectAll(s, v.of, c).length;
    case 'info': {
      const n = it.trigger?.[v.key];
      return typeof n === 'number' ? n : 0;
    }
    case 'shownPower': {
      const n = it.trigger?.shownPower ?? shownPower(condCtx(s, it).facts ?? null);
      return typeof n === 'number' ? n : 0;
    }
    case 'might': {
      const id = firstOf(s, it, env, v.of, st, c);
      if (id === null) return 0;
      if (s.objects[id] && onBoard(s, id)) return Math.max(0, mightOf(s, id));
      if (it.play.lookBack[id]) return Math.max(0, it.play.lookBack[id].chars.might ?? 0);   // look-back [359.3.e.13]
      return s.objects[id] ? Math.max(0, mightOf(s, id)) : 0;       // a card off the board: its Might (a burned card)
    }
    case 'energyOf': {
      const id = firstOf(s, it, env, v.of, st, c);
      if (id === null) return 0;
      const snap = it.play.lookBack[id];
      return snap ? snap.chars.cost?.energy ?? 0 : s.objects[id] ? energyCostOf(s.objects[id]) : 0;
    }
    case 'kw': {
      const src = env.self;
      if (src !== null && s.objects[src] && onBoard(s, src)) return keywordOf(s, src, v.kw);
      return it.sourceLki?.chars.keywords[v.kw]?.value ?? 1;
    }
    case 'sum': return (v.of as ValueAst[]).reduce((n: number, w) => n + value(s, it, env, w, st, c), 0);
    case 'points': return s.players[c.controller].points;
    case 'excess': return s.combat?.excess[c.controller] ?? 0;
    case 'playedThisTurn': return s.log.played.filter((r) => r.p === c.controller && r.isCard).length;
    case 'diff': return Math.max(0, value(s, it, env, v.a, st, c) - value(s, it, env, v.b, st, c));
    case 'maxMight': return Math.max(0, ...selectAll(s, v.of, c).map((id) => mightOf(s, id)));
    case 'countBound': return boundObjs(env, v.name).filter((id) => !v.where || (s.objects[id] && v.where.every((w) => predOk(s, w, id, c)))).length;
    case 'holdPoints': return s.log.points.filter((r) => r.p === c.controller && r.why === 'hold').reduce((n, r) => n + r.n, 0);
    case 'x': {
      const b = env.bound[v.name] as { n?: number } | undefined;
      return typeof b?.n === 'number' ? b.n : 0;
    }
    case 'tagsAmong': return tagsAmong(s, c.controller, v.tags);
    case 'sumMight': return selectAll(s, v.of, c).reduce((n, id) => n + Math.max(0, mightOf(s, id)), 0);
    case 'cardDeals': {
      const card = it.obj !== undefined ? s.objects[it.obj]?.card : undefined;
      return card === undefined ? 0 : (s.log.cardDeals ?? []).filter((k) => k === card).length;
    }
    case 'conquered': return conqueredBfs(s, c.controller);
    case 'damageOn': {
      const id = firstOf(s, it, env, v.of, st, c);
      return id !== null && s.objects[id] ? s.objects[id].damage.reduce((n, d) => n + d.amount, 0) : 0;
    }
    case 'empowerCount': return env.self !== null ? s.objects[env.self]?.empowered ?? 0 : 0;
    case 'if': return evalCond(s, v.cond, { ...condCtx(s, it), bound: env.bound }) ? value(s, it, env, v.then, st, c) : value(s, it, env, v.else, st, c);
    case 'minEnergyBound': {
      const ids = boundObjs(env, v.name).filter((id) => s.objects[id]);
      return ids.length === 0 ? 0 : Math.min(...ids.map((id) => energyCostOf(s.objects[id])));
    }
    case 'paidEnergy': {                                             // what a non-standard cost of the play took
      const facts = condCtx(s, it).facts;
      return Object.values(facts?.costObjects ?? {}).flat().filter((sn) => sn.id !== it.source)
        .reduce((n, sn) => n + (sn.chars.cost?.energy ?? 0), 0);
    }
    case 'shownMight': {
      const pick = (condCtx(s, it).facts?.showOff ?? []).flatMap((r) => r.picks)[0];
      return Math.max(0, pick?.chars.might ?? 0);
    }
    case 'kwOf': {
      const id = firstOf(s, it, env, v.of, st, c);
      if (id === null) return 0;
      if (s.objects[id] && onBoard(s, id)) return keywordOf(s, id, v.kw);
      return it.play.lookBack[id]?.chars.keywords[v.kw]?.value ?? 0;
    }
    case 'xCost': {
      const n = Object.entries(it.play.choices.asPlayed).find(([k]) => k.startsWith('xpow:'))?.[1];
      return typeof n === 'number' ? n : 0;
    }
  }
}

/** How many different battlefields p conquered this turn. */
export const conqueredBfs = (s: GameState, p: PlayerId) => new Set(s.log.scored.filter((r) => r.p === p && r.how === 'conquer').map((r) => r.bf)).size;

/** The Power cost of the card shown off, from its snapshot [832.1.d]. */
export function shownPower(facts: { showOff: { picks: { chars: { cost: { power: unknown[] } | null } }[] }[] } | null): number {
  const pick = facts?.showOff.flatMap((r) => r.picks)[0];
  return pick?.chars.cost?.power.length ?? 0;
}

/** Keeps what an instruction is about to move off the board, for look-back [359.3.e.13]. */
function lookBack(s: GameState, it: ChainItem, objs: ObjId[]) {
  for (const id of objs) setField(s, it.play.lookBack, id, snapshotOf(s, id));
}

const onBoard = (s: GameState, id: ObjId) => locOf(s.objects[id]) !== null;

/** Bonus Damage for one target of a Deal by a spell or ability [712–715]:
    every instance summed, never negative [714]. */
function bonusDamage(s: GameState, it: ChainItem, target: ObjId): number {
  let n = 0;
  for (const { st, spec } of staticsFor(s, null, 'bonusDamage')) {
    if (spec.by === 'you' && st.ctl !== it.controller) continue;
    if (spec.from === 'friendlyGear') {                              // "Abilities of friendly gear deal 1 Bonus Damage"
      const src = it.source === undefined ? undefined : s.objects[it.source] ?? null;
      const gear = it.kind !== 'card' && (src ? isType(src, 'gear') && src.controller === st.ctl
        : it.sourceLki?.chars.types.includes('gear') === true && it.sourceLki.controller === st.ctl);
      if (!gear) continue;
    }
    if (spec.to === 'here') {
      const h = hereOf(s, st.host), at = locOf(s.objects[target]);
      if (!h || !at || !sameLoc(h, at)) continue;
    }
    n += spec.n;
  }
  n += typeof it.play.choices.asPlayed.bonusDamage === 'number' ? it.play.choices.asPlayed.bonusDamage : 0;   // Ravenborn Tome
  return Math.max(0, n);
}

// ---- the resolve frame ----

defineSteps('resolve', (s, f, x) => {
  const it = itemById(s, f.item);
  const steps = it ? stepsOf(s, it) : [];
  const i = f.ip[0];
  if (!it || i >= steps.length) return finishResolve(s, x, f);       // [359.3.e.15], or the end
  const st = steps[i];
  if (st.guard && f.env.bound[`if:${st.guard.key}`] !== st.guard.branch) {   // the branch it didn't take
    f.ip = [i + 1];
    return 'continue';
  }
  const eventBf = typeof it.trigger?.bf === 'number' ? it.trigger.bf : null;
  const subject = typeof it.trigger?.subject === 'number' ? it.trigger.subject : null;
  if (f.env.as !== st.as) {                                          // the player this step is executed as
    const env = { ...f.env };
    if (st.as === undefined) delete env.as; else env.as = st.as;
    f.env = env;
  }
  const ex = it.play.choices.executions[st.exec];
  const slotObjs = Object.fromEntries(Object.entries(ex?.targets ?? {}).map(([k, ts]) => [k, ts.flatMap((t) => (t.k === 'obj' ? [t.id] : []))]));
  const killed = Object.values(it.play.facts.costObjects ?? {}).flat().find((sn) => sn.chars.types.includes('unit') && !s.objects[sn.id]);
  const c: SelCtx = { controller: st.as ?? it.controller, source: it.source ?? null, slotLoc: slotLocs(s, it, st.exec), eventBf, subject,
    eventFrom: it.trigger?.from && typeof it.trigger.from === 'object' ? it.trigger.from as unknown as Loc : null,
    lkiHere: it.sourceLki?.loc ?? null, slotObjs,
    paidCost: killed ? { energy: killed.chars.cost?.energy ?? 0, power: killed.chars.cost?.power.length ?? 0 } : null };
  const got = takeRet(f);
  // A linked instruction is ignored when the one it is linked to was [359.3.e.14.a].
  const linkedTo = st.instr.link === undefined ? undefined : it.outcomes[`id:${st.instr.link}`];
  const out: Outcome | 'asked' = linkedTo?.o === 'ignored' ? { o: 'ignored', why: 'linked' } : execute(s, x, f, it, st, c, got);
  if (out === 'asked') return 'continue';
  setField(s, it.outcomes, st.key, out);
  if (st.instr.id !== undefined) setField(s, it.outcomes, `id:${st.instr.id}`, out);
  emit(s, x, { k: 'outcome', item: it.id, instr: st.key, outcome: out, rule: '359.3.e' });
  f.ip = [i + 1];
  return 'continue';
});

/** Where a move takes a unit, or null when there is no such place now. */
function moveDest(s: GameState, it: ChainItem, st: Step, id: ObjId, to: MoveToAst): Loc | null {
  if (to === 'base') return { z: 'base', p: s.objects[id].controller ?? s.objects[id].owner };
  if (to === 'here') {
    const h = hereOf(s, it.source ?? null);
    return h && h.z === 'bf' ? h : null;
  }
  if (to === 'eventTo') {
    const l = it.trigger?.to as Loc | undefined;
    return l && typeof l === 'object' ? (l.z === 'base' ? { z: 'base', p: s.objects[id].controller ?? s.objects[id].owner } : l) : null;
  }
  if ('dest' in to) return it.play.choices.executions[st.exec]?.dests[to.dest] ?? null;
  if ('slotBf' in to) return slotLocs(s, it, st.exec)[to.slotBf] ?? null;
  if ('locOf' in to) return null;                                    // resolved by the caller (needs the env)
  const bf = it.trigger?.[to.info];
  return typeof bf === 'number' && bf >= 0 ? { z: 'bf', bf } : null;
}

/** The cost of an Equipment's Equip ability as Weaponmaster pays it [821.1.c]:
    as if activated targeting this unit, reduced by [A]. */
function weaponmasterCost(s: GameState, gear: ObjId, unit: ObjId): ResourceCost | null {
  const o = s.objects[gear];
  const c = keywordCost(o.def, 'equip');
  if (!c) return null;                                               // no Equip ability: nothing happens [821.1.c.4]
  const cost = resourceCost(c, findCard(o.def)?.domains ?? []);
  const less = cardDef(o.def)?.keywords.find((k) => k.kw === 'equip')?.equipLessBy;
  if (less && typeof less === 'object' && less.v === 'might') cost.energy = Math.max(0, cost.energy - Math.max(0, mightOf(s, unit)));
  const literal = s.rules.weaponmasterReduction === 'literalA';
  const i = cost.power.findIndex((r) => (literal ? r.k === 'any' : true));
  if (i >= 0) cost.power = cost.power.filter((_, j) => j !== i);
  return cost;
}

/** Performs one instruction; 'asked' when it pushed an 'instr' frame for a
    resolution-time choice and runs again with the answer. */
function execute(s: GameState, x: X, f: ResolveFrame, it: ChainItem, st: Step, c: SelCtx, got: Json | undefined):
  Outcome | 'asked' {
  const ins = st.instr;
  const p = st.as ?? it.controller;
  const ok: Outcome = { o: 'executed' };
  const negated: Outcome = { o: 'negated', why: 'impossible' };
  const attribution = [...(it.obj !== undefined ? [it.obj] : []), ...(it.source !== undefined ? [it.source] : [])];
  const choice = (op: string, locals: Json): 'asked' => {
    pushFrame(s, { f: 'instr', op, pc: 0, locals });
    return 'asked';
  };
  const ref = (r: RefAst | SelAst) => resolveRef(s, it, f.env, r, st, c);
  const val = (v: ValueAst) => value(s, it, f.env, v, st, c);
  const effOpts = (rule: string) => ({ controller: p, source: it.source ?? it.obj ?? null, item: it.id, rule });
  const playedFromFacedown = it.kind === 'card' && it.play.origin.z === 'facedown' ? it.play.origin.bf : null;
  /** Gangplank: "If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] this turn
      instead": the objects this item chose that are so protected get +N instead and are dropped. */
  const immune = (objs: ObjId[]): ObjId[] => {
    const chosen = new Set(it.play.choices.executions.flatMap((ex) => Object.values(ex.targets).flat()).flatMap((t) => (t.k === 'obj' ? [t.id] : [])));
    return objs.filter((id) => {
      const sp = chosen.has(id) && onBoard(s, id) ? staticsFor(s, id, 'chosenImmune')[0]?.spec : undefined;
      if (!sp) return true;
      emit(s, x, { k: 'replaced', source: id, event: 'chosenEffect', rule: '369.1' });
      addMight(s, x, [id], sp.n, { ...effOpts('479.4'), until: 'thisTurn' });
      return false;
    });
  };
  /** One limited play of a card a playCard instruction names [420.3]. */
  const playOne = (id: ObjId) => {
    {
      const ins = st.instr as Extract<InstrAst, { op: 'playCard' }>;
      const o = s.objects[id];
      const printed = costOf(s, id);
      const cost = ins.cost ? resourceCost(ins.cost, findCard(o.def)?.domains ?? []) : printed;
      const less = ins.free ? cost.energy : ins.energyLess === undefined ? 0 : val(ins.energyLess);
      let at: Loc | undefined;
      const who = ins.by === 'owner' ? o.owner : p;
      const atObj = ins.atRef ? firstOf(s, it, f.env, ins.atRef, st, c) : null;
      if (atObj !== null && s.objects[atObj] && typesOf(o).includes('unit')) at = locOf(s.objects[atObj]) ?? undefined;
      if (typesOf(o).includes('unit') && ins.at === 'here') {
        const h = hereOf(s, it.source ?? null);
        if (h) at = h;
      } else if (typesOf(o).includes('unit') && ins.at === 'base') at = { z: 'base', p: who };
      // "back to the same location or to their base": where the card was before it left the board (look-back).
      const was = ins.sameOrBase || ins.sameLoc ? Object.values(it.play.lookBack).find((sn) => sn.card === o.card)?.loc ?? null : null;
      const locs: Loc[] | undefined = ins.sameOrBase ? [{ z: 'base', p: who }, ...(was && was.z === 'bf' ? [was] : [])]
        : ins.sameLoc ? [was && (was.z === 'bf' || was.p === who) ? was : { z: 'base', p: who }] : undefined;
      const played = putOnChain(s, x, { obj: id, controller: who, by: { item: it.id, instr: st.key },
        overrides: { cost: { energy: Math.max(0, cost.energy - less), power: ins.free === 'all' ? [] : cost.power }, ...(at ? { at } : {}),
          ...(ins.anyBf ? { anyBf: true } : {}), ...(locs && typesOf(o).includes('unit') ? { locs } : {}) } });
      const onChain = itemById(s, played.id);
      if (ins.leaveChain && onChain) setField(s, onChain, 'onLeaveChain', ins.leaveChain);
    }
  };
  switch (ins.op) {
    case 'deal': case 'banish': case 'kill': case 'stun': case 'buff': case 'might': {
      const target = ins.op === 'deal' || ins.op === 'might' ? ins.to : ins.what;
      const r = ref(target);
      if (r.ignored) return r.ignored;
      if (ins.op === 'banish') {                                     // from the board or any other zone [428]
        const objs = r.objs.filter((id) => s.objects[id] && s.objects[id].zone.z !== 'banish' && s.objects[id].zone.z !== 'chain');
        if (objs.length === 0) return negated;
        lookBack(s, it, objs.filter((id) => onBoard(s, id)));
        const out = banish(s, x, objs, '428', ins.linkGroup, p);
        if (ins.id !== undefined) bind(s, f, ins.id, out);              // "banish it, then play it"
        return ok;
      }
      let objs = r.objs.filter((id) => onBoard(s, id));
      if (ins.op === 'stun' || (ins.op === 'might' && ins.sign < 0)) objs = immune(objs);
      if (objs.length === 0) return negated;
      if (ins.op === 'deal') {
        const n = val((ins as Extract<InstrAst, { op: 'deal' }>).n);
        if (n <= 0) return negated;                                  // no Deal, no bonus [715.4]
        deal(s, x, objs.map((to) => ({ to, n: n + bonusDamage(s, it, to) })), { sources: attribution, by: p, combat: false,
          rule: '418', item: it.id, spell: it.kind === 'card' });
        const card = it.obj !== undefined ? s.objects[it.obj]?.card : undefined;   // "each time this spell has dealt damage this turn"
        if (card !== undefined) setField(s, s.log, 'cardDeals', [...(s.log.cardDeals ?? []), card]);
      }
      else if (ins.op === 'kill') { lookBack(s, it, objs); kill(s, x, objs, { rule: '429', inCombat: () => false, by: p, spell: it.kind === 'card' }); }
      else if (ins.op === 'stun') return stunUnits(s, x, objs, '424', p).length > 0 ? ok : { o: 'negated', why: 'noop' };
      else if (ins.op === 'buff') return buffUnits(s, x, objs, '427', p).length > 0 ? ok : { o: 'negated', why: 'noop' };
      else {
        const m = ins as Extract<InstrAst, { op: 'might' }>;
        const n = m.sign * val(m.n);
        const chosenNow = new Set(it.play.choices.executions.flatMap((ex) => Object.values(ex.targets).flat()).flatMap((t) => (t.k === 'obj' ? [t.id] : [])));
        // Mel, Newly Awakened: "… would give -[M] to a unit it chooses, it gives an additional -1 [M]."
        const extra = n < 0 ? staticsFor(s, null, 'extraDecrease').filter(({ st }) => st.ctl === p).reduce((k, { spec }) => k + spec.n, 0) : 0;
        for (const id of objs) {
          const n1 = n - (extra > 0 && chosenNow.has(id) ? extra : 0);
          // "to a minimum of 1 [M]": a decrease that stops at 1, fixed now [479.4.b].
          const amount = m.floor !== undefined && n1 < 0 ? -Math.min(-n1, Math.max(0, mightOf(s, id) - m.floor)) : n1;
          addMight(s, x, [id], amount, { ...effOpts('479.4'), until: m.until });
        }
      }
      return ok;
    }
    case 'baseMight': case 'grant': {
      const r = ref(ins.to);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      const o = { ...effOpts(ins.op === 'baseMight' ? '479.2' : '479.3'), until: ins.until };
      if (ins.op === 'baseMight') addEffect(s, x, objs, { s: 'baseMight', n: val(ins.n) }, o);
      else if (ins.n !== undefined) {                                // "[Assault] equal to its Might": each its own value, now
        for (const id of objs) {
          const n = ins.n === undefined ? 1 : value(s, it, f.env, ins.n, st, { ...c, subject: id });
          if (n > 0) addEffect(s, x, [id], { s: 'keyword', kw: ins.kw.kw, value: n }, o);
        }
      } else addEffect(s, x, objs, { s: 'keyword', kw: ins.kw.kw, value: ins.kw.value ?? 1 }, o);
      return ok;
    }
    case 'double': {                                                 // [433]: +its Might, fixed now
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      for (const id of objs) addMight(s, x, [id], Math.max(0, mightOf(s, id)), { ...effOpts('433'), until: ins.until });
      return ok;
    }
    case 'if': {
      // The condition is read as the instruction executes [359.3.e]; the
      // branch it takes runs next (the frame's own bookkeeping).
      const took = evalCond(s, ins.cond, { ...condCtx(s, it), bound: f.env.bound, value: val, thisObj: thisOf(s, it, f.env) })
        ? 'then' : 'else';
      f.env.bound = { ...f.env.bound, [`if:${st.key}`]: took };
      return ok;
    }
    case 'may': {
      if (got === undefined) return choice('may', { who: p, item: it.id });
      const yes = (got as { yes?: boolean }).yes === true;
      f.env.bound = { ...f.env.bound, [`if:${st.key}`]: yes ? 'then' : 'else' };
      return yes ? ok : { o: 'negated', why: 'declined' };
    }
    case 'delayed': {
      // A delayed ability [390–393]: controlled by the item's controller as it
      // is created (Spec E Q10), for the rest of this turn.
      if (s.turn.phase === 'ending' && s.turn.step === 'expiration') return negated;   // too late to trigger [359.3.e.16]
      const id = mint(s, 'eff');
      const info: Record<string, Json> = it.obj !== undefined && s.objects[it.obj] ? { from: s.objects[it.obj].def } : {};
      if (it.source !== undefined && s.objects[it.source]) info.from = s.objects[it.source].def;
      for (const [k, r] of Object.entries(ins.capture ?? {})) {
        if (r === 'eventBf') info[k] = typeof it.trigger?.bf === 'number' ? it.trigger.bf : -1;
        else if (r === 'hereBf') { const h = hereOf(s, it.source ?? null); info[k] = h?.z === 'bf' ? h.bf : -1; }
        else info[k] = firstOf(s, it, f.env, r, st, c);
      }
      for (const [k, v] of Object.entries(ins.captureN ?? {})) info[k] = val(v);   // "that many"
      info.item = it.id;
      append(s, s.delayed, { id, controller: p, createdBy: it.id, createdTurn: s.turn.n,
        ability: { ...ins.ability, id: `eff:${id}#0` } as unknown as Json,
        window: { during: ins.lasting ? 'game' : 'thisTurn', uses: ins.uses }, info });
      return ok;
    }
    case 'draws': {
      if (ins.who === 'opponents') {
        for (const q of opponentsOf(s, p)) drawCards(s, x, q, ins.n, '414');
        return ok;
      }
      if (ins.who === 'caster') { drawCards(s, x, it.controller, ins.n, '414'); return ok; }
      const r = ins.who.controllerOf;
      const t = typeof r === 'object' && 'slot' in r ? targetsOf(it, st, r.slot)[0] : undefined;
      if (t?.k !== 'obj') return { o: 'ignored', why: 'nullInfo' };
      const who = s.objects[t.id] && onBoard(s, t.id) ? s.objects[t.id].controller : it.play.lookBack[t.id]?.controller ?? null;
      if (who === null) return { o: 'ignored', why: 'nullInfo' };
      drawCards(s, x, who, ins.n, '414');
      return ok;
    }
    case 'ready': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      // "Spells and abilities can't ready enemy units and gear" (Mageseeker Warden).
      const objs = r.objs.filter((id) => !staticsFor(s, null, 'noReadyByEffects').some(({ st: w, spec }) =>
        matches(s, spec.to, id, { controller: w.ctl, source: w.host })));
      ready(s, x, objs, '416', p);
      return ok;
    }
    case 'exhaust': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => (onBoard(s, id) || s.objects[id].zone.z === 'legend') && !s.objects[id].exhausted);
      if (objs.length === 0) return negated;
      exhaust(s, x, p, objs, '415', false);
      return ok;
    }
    case 'recall': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      recall(s, x, objs, '457');
      return ok;
    }
    case 'gainControl': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const to = (id: ObjId) => (ins.toOwner ? s.objects[id].owner : p);
      const objs = r.objs.filter((id) => onBoard(s, id) && s.objects[id].controller !== to(id));
      if (objs.length === 0) return negated;
      for (const id of objs) {
        const q = to(id);
        setField(s, s.objects[id], 'controller', q);
        emit(s, x, { k: 'controlChanged', obj: id, p: q, rule: '479.2.a' });
      }
      if (ins.id !== undefined) bind(s, f, ins.id, objs);              // "take control of it and recall it"
      requestCleanup(s);
      return ok;
    }
    case 'extraTurn':
      setField(s, s.turn, 'queue', [{ player: p, additional: true }, ...s.turn.queue]);   // [734], [738]
      return ok;
    case 'banishThis':
      if (it.kind !== 'card') return negated;
      setField(s, it, 'onLeaveChain', 'banish');
      return ok;
    case 'choose': {
      let min = ins.min, max = ins.max;
      if (ins.count !== undefined) {                                 // "that many": exactly as many as the value says
        const n = val(ins.count);
        if (n <= 0) { bind(s, f, ins.bind, []); return negated; }
        min = n; max = n;
      }
      const not = (ins.notSlots ?? []).flatMap((sl) => targetsOf(it, st, sl).flatMap((t) => (t.k === 'obj' ? [t.id] : [])));
      const below = ins.mightBelow === undefined ? undefined : val(ins.mightBelow);
      const cands = [...new Set(ins.sel.flatMap((sel) => selectAll(s, sel, c)))].filter((id) => !not.includes(id)
        && (below === undefined || mightOf(s, id) < below));
      if (got === undefined) {
        if (cands.length === 0) { bind(s, f, ins.bind, []); return negated; }
        if (cands.length <= min && min === max) { bind(s, f, ins.bind, cands); return ok; }
        return choice('choose', { objs: cands, min, max, who: p, sum: ins.sumMightMax ?? null,
          ...(ins.oneEachLoc ? { oneEachLoc: true } : {}), ...(ins.sameController ? { sameCtl: true } : {}) });
      }
      const picked = objsOf(got);
      bind(s, f, ins.bind, picked);
      return picked.length > 0 ? ok : { o: 'negated', why: 'declined' };
    }
    case 'draw': {
      if (ins.from) {
        const ids = boundObjs(f.env, (ins.from as { bound: string }).bound).filter((id) => s.objects[id]?.zone.z === 'deck');
        if (ids.length === 0) return negated;
        for (const id of ids) drawCard(s, x, p, id, '414.1');
        return ok;
      }
      const n = val(ins.n);
      if (n <= 0) return negated;
      drawCards(s, x, p, n, '414');
      return ok;
    }
    case 'burn': {
      const burned = burn(s, x, p, ins.n, '441');
      if (ins.bind) bind(s, f, ins.bind, burned);                    // "When you burn a unit this way"
      return ok;
    }
    case 'grantAbility': {                                           // "give it '[A][A]: Ready me.'"
      const r = ref(ins.to);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, { s: 'grantAbility', ability: ins.ability }, { ...effOpts('479'), until: ins.until });
      return ok;
    }
    case 'mill': return mill(s, x, p, ins.n, '108.2').length > 0 ? ok : negated;
    case 'channel': {
      const want = val(ins.n);
      if (want <= 0) return negated;
      const n = channelRunes(s, x, ins.caster ? it.controller : p, want, '431', ins.exhausted === true);
      return n >= want ? ok : n > 0 ? { o: 'partial' } : negated;
    }
    case 'look': {
      const top = s.players[p].deck.slice(0, ins.n);
      look(s, x, p, top, '425');
      bind(s, f, ins.bind, top);
      if (top.length > 0) fire(s, x, { e: 'seen', p, objs: top });     // Nocturne, Horrifying
      return top.length > 0 ? ok : negated;
    }
    case 'revealTop': {                                              // [425]: everyone sees it
      // Void Hatchling: "look at the top card first. You may recycle it. Then reveal those cards."
      const peek = `peek:${st.key}`;
      if (f.env.bound[peek] === undefined && staticsFor(s, null, 'peekBeforeReveal').some(({ st: h }) => h.ctl === p)
        && s.players[p].deck.length > 0) {
        if (got === undefined) {
          look(s, x, p, s.players[p].deck.slice(0, 1), '425');
          return choice('predict', { objs: s.players[p].deck.slice(0, 1), who: p });
        }
        recycleCards(s, x, p, objsOf(got), '417');
        f.env.bound = { ...f.env.bound, [peek]: true };
      }
      const top = s.players[p].deck.slice(0, ins.n ?? 1);
      if (top.length === 0) return negated;
      for (const id of top) setField(s, s.objects[id], 'knownBy', allMask(s.players.length));
      emit(s, x, { k: 'reveal', objs: top, to: allMask(s.players.length), rule: '425' });
      bind(s, f, ins.bind, top);
      fire(s, x, { e: 'seen', p, objs: top, reveal: true });
      return ok;
    }
    case 'toHand': {
      const r = ref(ins.what);
      const ids = r.objs.filter((id) => s.objects[id]?.zone.z === 'deck');
      if (ids.length === 0) return negated;
      for (const id of ids) {
        const before = knowers(s, [id]);
        const from = s.objects[id].zone;
        const obj = moveObject(s, id, Z.hand(p), { knownBy: allMask(s.players.length) });
        emitZone(s, x, { obj, prev: id, from, to: Z.hand(p), why: 'toHand', rule: '425', before });
      }
      return ok;
    }
    case 'pick': {
      const mightMax = ins.mightMax === undefined ? undefined : val(ins.mightMax);
      const energyMax = ins.energyMax === undefined ? undefined : val(ins.energyMax);
      const from = boundObjs(f.env, ins.from).filter((id) => s.objects[id] && (ins.where ?? []).every((w) => predOk(s, w, id, c))
        && (mightMax === undefined || mightOf(s, id) <= mightMax) && (energyMax === undefined || energyCostOf(s.objects[id]) <= energyMax));
      if (ins.min !== undefined && ins.min < ins.n) {                // "you may …": none is an answer
        if (got === undefined) {
          if (from.length === 0) { bind(s, f, ins.bind, []); return negated; }
          return choice('choose', { objs: from, min: ins.min, max: ins.n, who: p, sum: null });
        }
        bind(s, f, ins.bind, objsOf(got));
        return objsOf(got).length > 0 ? ok : { o: 'negated', why: 'declined' };
      }
      if (from.length <= ins.n) {
        bind(s, f, ins.bind, from);
        return from.length > 0 ? ok : negated;
      }
      if (got === undefined) return choice('pick', { objs: from, n: ins.n, who: p });
      bind(s, f, ins.bind, objsOf(got));
      return ok;
    }
    case 'recycleRest': {
      const minus = boundObjs(f.env, ins.minus);
      const rest = boundObjs(f.env, ins.from).filter((id) => !minus.includes(id) && s.objects[id]?.zone.z === 'deck');
      if (rest.length === 0) return negated;
      const owners = rest.map((id) => s.objects[id].owner);
      for (const q of s.players) {                                   // each to its owner's deck [417.1]
        const mine = rest.filter((_, i) => owners[i] === q.id);
        if (mine.length > 0) recycleCards(s, x, q.id, mine, '417');
      }
      return ok;
    }
    case 'discard': {
      const hand = s.players[p].hand;
      if (hand.length === 0) return negated;                         // as many as possible [423.4]
      if (got === undefined) return choice('discard', { objs: hand.slice(), n: Math.min(ins.n, hand.length), who: p });
      const picked = objsOf(got);
      for (const id of picked) lookBack(s, it, [id]);
      discard(s, x, p, picked, '423');
      // "Discard 1. Deal its Energy cost …": what was discarded, by name.
      if (ins.id !== undefined) bind(s, f, ins.id, picked);
      return ok;
    }
    case 'predict': {
      const n = val(ins.n);
      const top = s.players[p].deck.slice(0, n);
      if (top.length === 0) return negated;                          // no Burn Out [437.4.a]
      if (got === undefined) {
        look(s, x, p, top, '437.1');
        fire(s, x, { e: 'seen', p, objs: top });
        return choice('predict', { objs: top, who: p });
      }
      const recycled = objsOf(got);
      recycleCards(s, x, p, recycled, '437.1.a');
      return ok;
    }
    case 'playToken': {
      let at: Loc | undefined;
      let q = ins.caster ? it.controller : p;
      if (ins.who) {                                                 // "Its controller plays a Gold gear token"
        const id = firstOf(s, it, f.env, ins.who.controllerOf, st, c);
        const w = id === null ? null : s.objects[id] && onBoard(s, id) ? s.objects[id].controller : it.play.lookBack[id]?.controller ?? null;
        if (w === null) return { o: 'ignored', why: 'nullInfo' };
        q = w;
      }
      if (ins.at === 'yourBase') at = { z: 'base', p: q };
      else if (ins.at === 'here') {
        const h = hereOf(s, it.source ?? null);
        if (!h) return { o: 'ignored', why: 'nullInfo' };            // "here" is gone [359.3.e.12]
        at = h;
      } else if (typeof ins.at === 'object' && 'slot' in ins.at) {   // "to a single battlefield" chosen by a slot
        const l = slotLocs(s, it, st.exec)[ins.at.slot];
        if (!l || l.z !== 'bf') return { o: 'ignored', why: 'nullInfo' };
        at = l;
      } else if (typeof ins.at === 'object') {
        const bf = it.trigger?.[ins.at.info];
        if (typeof bf !== 'number' || bf < 0) return { o: 'ignored', why: 'nullInfo' };
        at = { z: 'bf', bf };
      } else if (ins.at === 'eventFrom') {                           // "When I move from a location, … there"
        const l = it.trigger?.from as Loc | undefined;
        if (!l || typeof l !== 'object') return { o: 'ignored', why: 'nullInfo' };
        at = l.z === 'base' ? { z: 'base', p: q } : l;
      } else if (playedFromFacedown !== null && isUnitToken(ins.token)) {
        at = { z: 'bf', bf: playedFromFacedown };                   // [811.1.d.5]
      }
      const count = val(ins.n);
      if (count <= 0) return negated;
      // "They become copies of me" [446]: the copied object's copyable traits now (its definition).
      let copyOf: string | undefined;
      if (ins.copyOf) {
        const id = firstOf(s, it, f.env, ins.copyOf, st, c) ?? (ins.copyOf === 'self' ? env0(it) : null);
        copyOf = id === null ? undefined : s.objects[id]?.def ?? it.play.lookBack[id]?.def ?? (ins.copyOf === 'self' ? it.sourceLki?.def : undefined);
        if (copyOf === undefined) return { o: 'ignored', why: 'nullInfo' };
      }
      for (let n = 0; n < count; n++) {
        const rdy = ins.ready || (ins.readyFirst !== undefined && n < ins.readyFirst);
        putOnChain(s, x, { obj: { token: ins.token, owner: q }, controller: q, by: { item: it.id, instr: st.key },
          overrides: { ...(at ? { at } : {}), ...(rdy ? { ready: true } : {}), ...(ins.exhausted ? { exhausted: true } : {}),
            ...(copyOf ? { copyOf } : {}), ...(ins.give ? { give: ins.give } : {}) } });
      }
      return ok;
    }
    case 'playSelf': {
      const id = f.env.self;
      const o = id === null ? undefined : s.objects[id];
      if (!o || o.zone.z !== 'trash') return { o: 'ignored', why: 'nullInfo' };   // it left the trash [420.3.c]
      const played = putOnChain(s, x, { obj: id!, controller: p, by: { item: it.id, instr: st.key },
        overrides: { cost: resourceCost(ins.cost, findCard(o.def)?.domains ?? []) } });
      if (ins.leaveChain) setField(s, itemById(s, played.id)!, 'onLeaveChain', ins.leaveChain);
      return ok;
    }
    case 'playCard': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const all = r.objs.filter((o) => ['trash', 'hand', 'banish', 'deck'].includes(s.objects[o].zone.z));
      if (all.length === 0) return negated;
      for (const id of ins.each ? all : all.slice(0, 1)) playOne(id);
      return ok;
    }
    case 'playLinked': {                                             // "Play all units banished with this, ignoring their costs"
      const ids = (ins.anyOwner ? s.players.flatMap((q) => q.banish) : s.players[p].banish)
        .filter((id) => s.objects[id].links.some((l) => l.group === ins.group));
      if (ids.length === 0) return negated;
      for (const id of ids) putOnChain(s, x, { obj: id, controller: p, by: { item: it.id, instr: st.key }, overrides: { cost: { energy: 0, power: [] } } });
      return ok;
    }
    case 'banishTop': {                                              // "Banish the top card of your Main Deck" [428]
      const top = s.players[p].deck.slice(0, ins.n);
      if (top.length === 0) { bind(s, f, ins.bind, []); return negated; }
      bind(s, f, ins.bind, banish(s, x, top, '428', undefined, p));
      return ok;
    }
    case 'killAllBut': {                                             // "Kill the rest"
      const keep = new Set(ins.keep.flatMap((k) => boundObjs({ ...f.env, as: undefined }, k)));
      const objs = selectAll(s, ins.sel, { ...c, controller: it.controller }).filter((id) => !keep.has(id));
      if (objs.length === 0) return negated;
      lookBack(s, it, objs);
      kill(s, x, objs, { rule: '429', inCombat: () => false, by: p, spell: it.kind === 'card' });
      return ok;
    }
    case 'preventAmount': case 'grantFlow': case 'protect': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => (ins.op === 'grantFlow' ? s.objects[id].zone.z === 'trash' : onBoard(s, id)));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, ins.op === 'grantFlow' ? { s: 'flowGrant' } : ins.op === 'protect' ? { s: 'noEnemyChoose' }
        : { s: 'preventAmount', n: ins.n }, effOpts(ins.op === 'protect' ? '479' : '438'));
      return ok;
    }
    case 'kwFromKw': {                                               // "I have [Assault] equal to my [Shield]" this turn
      const r = ref(ins.to);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, { s: 'kwFromKw', kw: ins.kw, from: ins.from }, effOpts('479.3'));
      return ok;
    }
    case 'empower': case 'disempower': {                             // [442], [443]
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => (onBoard(s, id) || s.objects[id].zone.z === 'legend')
        && (ins.op === 'empower' ? s.objects[id].empowered < maxEmpowerOf(s, id) : s.objects[id].empowered > 0));
      if (objs.length === 0) return negated;
      setEmpowered(s, x, objs, ins.op === 'empower', p);
      return ok;
    }
    case 'move': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const units = r.objs.filter((id) => onBoard(s, id) && !cantMove(s, id)
        // Jagged Cutlass: "I can't be moved by enemy spells and abilities."
        && !(s.objects[id].controller !== p && staticsFor(s, id, 'noEnemyMove').length > 0));
      const groups = new Map<string, { to: Loc; units: ObjId[] }>();
      const target = typeof ins.to === 'object' && 'locOf' in ins.to ? firstOf(s, it, f.env, ins.to.locOf, st, c) : null;
      for (const id of units) {
        const to = typeof ins.to === 'object' && 'locOf' in ins.to
          ? (target !== null && s.objects[target] ? locOf(s.objects[target]) : null) : moveDest(s, it, st, id, ins.to);
        const at = locOf(s.objects[id])!;
        if (!to || sameLoc(to, at)) continue;                        // not a valid destination [355.4.a]
        if (to.z === 'base' && at.z === 'bf' && noMoveToBase(s, at.bf, id)) continue;   // Vilemaw's Lair
        const k = JSON.stringify(to);
        if (!groups.has(k)) groups.set(k, { to, units: [] });
        groups.get(k)!.units.push(id);
      }
      if (groups.size === 0) return negated;
      for (const g of groups.values()) moveUnits(s, x, g.units, g.to, { by: p, standard: false, rule: '421' });
      return ok;
    }
    case 'returnToHand': case 'recycle': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const deck = r.objs.filter((id) => s.objects[id].zone.z === 'deck' || (ins.op === 'recycle' && s.objects[id].zone.z === 'hand'));
      if (ins.op === 'recycle' && deck.length > 0) {                // a revealed card (or one in a hand) to the bottom [417]
        const owners = deck.map((id) => s.objects[id].owner);
        for (const q of s.players) {
          const mine = deck.filter((_, i) => owners[i] === q.id);
          if (mine.length > 0) recycleCards(s, x, q.id, mine, '417');
        }
        return ok;
      }
      const objs = (ins.op === 'returnToHand' ? immune(r.objs) : r.objs).filter((id) => onBoard(s, id)
        || ['trash', 'facedown', 'champion', ...(ins.op === 'returnToHand' ? ['banish'] : [])].includes(s.objects[id].zone.z));
      if (objs.length === 0) return negated;
      lookBack(s, it, objs.filter((id) => onBoard(s, id)));
      if (ins.op === 'returnToHand') returnToHand(s, x, objs, '428');
      else for (const id of objs) recyclePermanent(s, x, id, '417');
      return ok;
    }
    case 'counter': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const target = s.chain.find((c2) => c2.obj !== undefined && r.objs.includes(c2.obj));
      if (!target) return negated;
      // "This can't be countered"; Mel: "Your spells and abilities can't be countered".
      if ((cardDef(s.objects[target.obj!].def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'cantBeCountered' && !a.spec.yours)
        || staticsFor(s, null, 'cantBeCountered').some(({ st, spec }) => spec.yours && st.ctl === target.controller)) return negated;
      lookBack(s, it, [target.obj!]);
      counterItem(s, x, target, ins.to);
      return ok;
    }
    case 'fight': case 'dealFrom': {
      const a = ref(ins.op === 'fight' ? ins.a : ins.from), b = ref(ins.op === 'fight' ? ins.b : ins.to);
      if (a.ignored) return a.ignored;
      if (b.ignored) return b.ignored;
      const ua = a.objs.find((id) => onBoard(s, id)), ub = b.objs.find((id) => onBoard(s, id));
      if (ua === undefined || ub === undefined) return negated;
      const ma = Math.max(0, mightOf(s, ua)), mb = Math.max(0, mightOf(s, ub));
      // The units are the sources [418.6.b.3]: no Bonus Damage of spells and abilities.
      deal(s, x, [{ to: ub, n: ma }], { sources: [ua], by: s.objects[ua].controller, combat: false, rule: '418.6.b.3', item: it.id });
      if (ins.op === 'fight') {
        deal(s, x, [{ to: ua, n: mb }], { sources: [ub], by: s.objects[ub].controller, combat: false, rule: '418.6.b.3', item: it.id });
      }
      return ok;
    }
    case 'gainXp': {
      const n = val(ins.n);
      if (n <= 0) return negated;
      gainXp(s, x, p, n, '730.1');
      return ok;
    }
    case 'add':
      addSpecial(s, x, p, { energy: ins.energy, universal: ins.power, onlyFor: ins.onlyFor, ...(ins.domain ? { domain: ins.domain } : {}),
        source: it.source !== undefined ? s.objects[it.source]?.def ?? '' : '' }, '430');
      return ok;
    case 'win':
      endGame(s, x, { winner: p, reason: 'effect', rule: '195', turn: s.turn.n });
      return ok;
    case 'points':
      if (ins.who === 'opponent') for (const q of opponentsOf(s, p)) gainPoints(s, x, q, ins.n, 'effect', '194.1');
      else gainPoints(s, x, p, ins.n, 'effect', '194.1');
      return ok;
    case 'heal': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id) && s.objects[id].damage.length > 0);
      if (objs.length === 0) return negated;
      heal(s, x, objs, '419');
      return ok;
    }
    case 'attach': {
      const a = ref(ins.what), b = ref(ins.to);
      if (a.ignored) return a.ignored;
      if (b.ignored) return b.ignored;
      const g = a.objs[0], u = b.objs[0];
      if (g === undefined || u === undefined) return negated;
      if (s.objects[g].controller !== s.objects[u].controller) return negated;   // only to a unit with the same controller [435]
      return attach(s, x, g, u, '435') ? ok : negated;
    }
    case 'detach': {
      const r = ref(ins.from);
      if (r.ignored) return r.ignored;
      const unit = r.objs[0];
      if (unit !== undefined && s.objects[unit].attachedTo !== null) return detach(s, x, unit, '436') ? ok : negated;   // "detach it"
      const gear = unit === undefined ? [] : Object.values(s.objects).filter((o) => o.attachedTo === unit
        && tagsOf(o).includes('Equipment')).map((o) => o.id);
      if (gear.length === 0) return negated;
      if (gear.length > 1 && got === undefined) return choice('pick', { objs: gear, n: 1, who: p, t: 'detach' });
      const g = gear.length === 1 ? gear[0] : objsOf(got)[0];
      return detach(s, x, g, '436') ? ok : negated;
    }
    case 'spendBuff': {
      const from = ins.from;
      if (typeof from === 'string' || !('k' in from)) {               // a bound set: each of them spends its buff
        const r = ref(from);
        if (r.ignored) return r.ignored;
        return spendBuffs(s, x, r.objs.filter((id) => onBoard(s, id)), '702.2.b').length > 0 ? ok : negated;
      }
      const cands = selectAll(s, from, c).filter((id) => s.objects[id].buffs > 0);
      if (cands.length === 0) return negated;
      if (cands.length > 1 && got === undefined) return choice('pick', { objs: cands, n: 1, who: p, t: 'spendBuff' });
      const u = cands.length === 1 ? cands[0] : objsOf(got)[0];
      return spendBuffs(s, x, [u], '702.2.b').length > 0 ? ok : negated;
    }
    case 'eachPlayerKills': {
      if (got === undefined) {
        // "each opponent must kill one of their units", "the defender must kill one of their units here";
        // "If you paid my additional cost, you don't kill a unit this way."
        const skipMe = ins.who === 'opponents' || (ins.exceptIf !== undefined && evalCond(s, ins.exceptIf, condCtx(s, it)));
        const order = turnOrderFromTurnPlayer(s).filter((q) => !skipMe || q !== p);
        let at: Loc | null = null;
        if (ins.at === 'here') {
          at = hereOf(s, it.source ?? null) ?? it.sourceLki?.loc ?? null;
          if (!at) return { o: 'ignored', why: 'nullInfo' };
        }
        return choice('eachKill', { order, picks: [], i: 0, ...(at ? { at } : {}) });
      }
      const picks = objsOf(got).filter((id) => s.objects[id] && onBoard(s, id));
      if (picks.length === 0) return negated;
      kill(s, x, picks, { rule: '429', inCombat: () => false });
      return ok;
    }
    case 'pay': {
      if (ins.cost.xp !== undefined) {                               // "You may pay 2 XP to …": asked, then spent
        if (s.players[p].xp < ins.cost.xp) return negated;
        if (got === undefined) return choice('may', { who: p, item: it.id });
        if ((got as { yes?: boolean }).yes !== true) return { o: 'negated', why: 'declined' };
        spendXp(s, x, p, ins.cost.xp, '730.2');
        return ok;
      }
      if (got === undefined) {
        const cost = resourceCost(ins.cost, it.source !== undefined ? findCard(s.objects[it.source]?.def ?? '')?.domains ?? [] : []);
        let who: PlayerId | null = p;
        if (ins.who) {                                               // "unless its controller pays [2]"
          const id = firstOf(s, it, f.env, ins.who.controllerOf, st, c);
          const t = id === null ? undefined : s.chain.find((i) => i.obj === id);
          who = t ? t.controller : id !== null ? s.objects[id]?.controller ?? null : null;
          if (who === null) return { o: 'ignored', why: 'nullInfo' };
        }
        return choice('pay', { who, item: it.id, energy: cost.energy, power: cost.power as unknown as Json });
      }
      return (got as { paid?: boolean }).paid ? ok : { o: 'negated', why: 'declined' };
    }
    case 'equipToSelf': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const gear = r.objs[0], me = f.env.self;
      if (gear === undefined || me === null || !s.objects[me] || !onBoard(s, me) || !onBoard(s, gear)) return negated;
      if (got === undefined) {
        const cost = weaponmasterCost(s, gear, me);
        if (!cost) return negated;
        if (cost.energy > 0 || cost.power.length > 0) {
          return choice('pay', { who: p, item: it.id, energy: cost.energy, power: cost.power as unknown as Json });
        }
      } else if (!(got as { paid?: boolean }).paid) return { o: 'negated', why: 'declined' };
      return attach(s, x, gear, me, '821.1.c') ? ok : negated;      // can't: it stays where it is [821.1.c.5]
    }
    case 'playerEffect': {
      let whom = ins.who === 'opponents' ? opponentsOf(s, p) : ins.who === 'all' ? s.players.map((q) => q.id) : [p];
      if (typeof ins.who === 'object') {                             // "Its controller can't play spells this turn"
        const id = firstOf(s, it, f.env, ins.who.controllerOf, st, c);
        const onChain = id === null ? undefined : s.chain.find((i) => i.obj === id);
        const q = onChain ? onChain.controller : id === null ? null : s.objects[id]?.controller ?? it.play.lookBack[id]?.controller ?? null;
        if (q === null) return { o: 'ignored', why: 'nullInfo' };
        whom = [q];
      }
      for (const q of whom) {
        append(s, s.effects, { id: mint(s, 'eff'), ts: mint(s, 'ts'), controller: p, source: it.source ?? it.obj ?? null,
          item: it.id, rule: '479', layer: 4, affects: { player: q }, spec: ins.spec as unknown as Json, until: ins.until });
      }
      requestCleanup(s);
      return ok;
    }
    case 'forEach': return ok;
    case 'preventNext': case 'putOnTop': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      if (ins.op === 'putOnTop') {
        const id = r.objs.find((o) => s.objects[o].zone.z === 'hand' || onBoard(s, o));
        if (id === undefined) return negated;
        if (onBoard(s, id)) {                                        // "Its owner places it on the top of their Main Deck"
          lookBack(s, it, [id]);
          placeSelfLeave(s, x, id, snapshotOf(s, id), {}, false);
          toZone(s, x, id, Z.deck(s.objects[id].owner), { why: 'putOnDeck', rule: '108.4', pos: 'top' });
          requestCleanup(s);
          return ok;
        }
        toZone(s, x, id, Z.deck(s.objects[id].owner), { why: 'putOnDeck', rule: '108.4', pos: 'top' });
        return ok;
      }
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, { s: 'preventNext' }, effOpts('438'));
      return ok;
    }
    case 'grantKeywordsOf': {                                        // "my keywords and +[M] equal to my Might"
      const from = firstOf(s, it, f.env, ins.from, st, c);
      const r = ref(ins.to);
      if (r.ignored) return r.ignored;
      const to = r.objs.filter((id) => onBoard(s, id));
      if (from === null || !s.objects[from] || to.length === 0) return negated;
      for (const [kw, v] of Object.entries(derive(s, from).keywords)) {
        if (v) addEffect(s, x, to, { s: 'keyword', kw, value: v }, { ...effOpts('479.3'), until: 'thisTurn' });
      }
      addMight(s, x, to, Math.max(0, mightOf(s, from)), { ...effOpts('479.4'), until: 'thisTurn' });
      return ok;
    }
    case 'swapMight': {                                              // each gets the other's Might, fixed now
      const a = firstOf(s, it, f.env, ins.a, st, c), b = firstOf(s, it, f.env, ins.b, st, c);
      if (a === null || b === null || !s.objects[a] || !s.objects[b] || !onBoard(s, a) || !onBoard(s, b)) return negated;
      const ma = mightOf(s, a), mb = mightOf(s, b);
      addMight(s, x, [a], mb - ma, { ...effOpts('479.4'), until: 'thisTurn' });
      addMight(s, x, [b], ma - mb, { ...effOpts('479.4'), until: 'thisTurn' });
      return ok;
    }
    case 'addX': {
      const b = f.env.bound[ins.name] as { n?: number } | undefined;
      const n = typeof b?.n === 'number' ? b.n : 0;
      if (n <= 0) return negated;
      addSpecial(s, x, p, ins.as === 'energy' ? { energy: n, source: '' } : { universal: n, source: '' }, '430');
      return ok;
    }

    case 'choiceBy': {
      if (got === undefined) {
        let who: PlayerId | null = p;
        if (ins.who === 'opponent') who = opponentsOf(s, p)[0] ?? null;   // "Choose an opponent. They …" (a Duel)
        else if (ins.who !== 'self') {
          const id = firstOf(s, it, f.env, ins.who.controllerOf, st, c);
          who = id === null ? null : s.objects[id] && onBoard(s, id) ? s.objects[id].controller : it.play.lookBack[id]?.controller ?? null;
        }
        if (who === null) return { o: 'ignored', why: 'nullInfo' };
        return choice('mode', { who, item: it.id, labels: ins.modes.map((m) => m.label) });
      }
      f.env.bound = { ...f.env.bound, [`if:${st.key}`]: `m${(got as { n: number }).n}` };
      return ok;
    }
    case 'revealHand': {
      const objs = opponentsOf(s, p).flatMap((q) => s.players[q].hand);
      if (objs.length === 0) return negated;
      for (const id of objs) setField(s, s.objects[id], 'knownBy', allMask(s.players.length));
      emit(s, x, { k: 'reveal', objs: objs.slice(), to: allMask(s.players.length), rule: '425' });
      return ok;
    }
    case 'discardCards': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => s.objects[id].zone.z === 'hand');
      if (objs.length === 0) return negated;
      const owners = objs.map((id) => s.objects[id].owner);
      for (const q of s.players) {
        const mine = objs.filter((_, i) => owners[i] === q.id);
        if (mine.length > 0) discard(s, x, q.id, mine, '423');
      }
      return ok;
    }
    case 'discardHand': {
      const hand = s.players[p].hand.slice();
      if (hand.length === 0) return negated;
      discard(s, x, p, hand, '423');
      return ok;
    }
    case 'revealUntil': {                                            // [425]
      const deck = s.players[p].deck;
      const shown: ObjId[] = [];
      let found: ObjId | null = null;
      for (const id of deck) {
        shown.push(id);
        if (ins.types.some((t) => typesOf(s.objects[id]).includes(t))) { found = id; break; }
      }
      if (shown.length === 0) return negated;
      for (const id of shown) setField(s, s.objects[id], 'knownBy', allMask(s.players.length));
      emit(s, x, { k: 'reveal', objs: shown.slice(), to: allMask(s.players.length), rule: '425' });
      bind(s, f, ins.bind, found === null ? [] : [found]);
      bind(s, f, ins.rest, shown.filter((id) => id !== found));
      fire(s, x, { e: 'seen', p, objs: shown.slice(0, 1) });
      return found === null ? { o: 'partial' } : ok;
    }
    case 'revealRune': {
      const top = s.players[p].runeDeck[0];
      if (top === undefined) return negated;
      const domains = findCard(s.objects[top].def)?.domains ?? [];
      setField(s, s.objects[top], 'knownBy', allMask(s.players.length));
      emit(s, x, { k: 'reveal', objs: [top], to: allMask(s.players.length), rule: '425' });
      recycleRune(s, x, top, '417');
      f.env.bound = { ...f.env.bound, [ins.bind]: { domains } };
      return ok;
    }
    case 'payX': {                                                   // "Pay any amount of [A]"
      if (got === undefined) {
        // As much Power as p could make: ready runes, the pool's Power, Gold (a payment that fails pays nothing).
        const pool = s.players[p].pool;
        const max = ins.kind === 'energy' ? Math.min(12, pool.energy + s.players[p].base.filter((id) => s.objects[id].def.endsWith('-rune')
          && !s.objects[id].exhausted).length) : Math.min(12, s.players[p].base.filter((id) => s.objects[id].def.endsWith('-rune')).length
          + pool.universal + Object.values(pool.power).reduce((a, b) => a + b, 0) + goldsOf(s, p).length);
        if (max === 0) { f.env.bound = { ...f.env.bound, [ins.bind]: { n: 0 } }; return negated; }
        return choice('number', { who: p, max, item: it.id });
      }
      const g = got as { n?: number; paid?: boolean };
      if (g.n !== undefined) {
        f.env.bound = { ...f.env.bound, [ins.bind]: { n: g.n } };
        if (g.n === 0) return { o: 'negated', why: 'declined' };
        return choice('pay', { who: p, item: it.id, energy: ins.kind === 'energy' ? g.n : 0,
          power: (ins.kind === 'energy' ? [] : Array.from({ length: g.n }, () => ({ k: 'any' }))) as unknown as Json });
      }
      if (!g.paid) { f.env.bound = { ...f.env.bound, [ins.bind]: { n: 0 } }; return { o: 'negated', why: 'declined' }; }
      return ok;
    }
    case 'dealSplit': {
      const objs = selectAll(s, ins.to, c);
      if (objs.length === 0) return negated;
      // "It deals damage equal to its Might split among …": the unit is the source, no Bonus Damage [418.6.b.3].
      let from: ObjId | undefined;
      if (ins.from) {
        const r = ref(ins.from);
        if (r.ignored) return r.ignored;
        from = r.objs.find((id) => onBoard(s, id));
        if (from === undefined) return negated;
      }
      const n = val(ins.n);
      if (n <= 0) return negated;
      const hitsOf = (hs: { to: ObjId; n: number }[]) => (from !== undefined
        ? (deal(s, x, hs, { sources: [from], by: s.objects[from].controller, combat: false, rule: '418.6.b.3', item: it.id }), true)
        : dealHits(s, x, it, hs, p));
      if (got === undefined) {
        if (objs.length === 1) return hitsOf([{ to: objs[0], n }]) ? ok : negated;
        return choice('split', { objs, n, who: p });
      }
      const picks = objsOf(got);
      const hits = [...new Set(picks)].map((to) => ({ to, n: picks.filter((y) => y === to).length }));
      const live = hits.filter((h) => s.objects[h.to] && onBoard(s, h.to));
      return live.length > 0 && hitsOf(live) ? ok : negated;
    }
    case 'recycleAllBut': {
      const keep = new Set(ins.keep.flatMap((k) => boundObjs({ ...f.env, as: undefined }, k)));
      const all = [...new Set(ins.sel.flatMap((sel) => selectAll(s, sel, { ...c, controller: it.controller })))].filter((id) => !keep.has(id));
      if (all.length === 0) return negated;
      const hand = all.filter((id) => s.objects[id].zone.z === 'hand');
      for (const id of all) if (s.objects[id] && onBoard(s, id)) recyclePermanent(s, x, id, '417');
      for (const q of s.players) {
        const mine = hand.filter((id) => s.objects[id]?.owner === q.id && s.objects[id].zone.z === 'hand');
        if (mine.length > 0) recycleCards(s, x, q.id, mine, '417');
      }
      return ok;
    }
    case 'retarget': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const target = s.chain.find((i) => i.obj !== undefined && r.objs.includes(i.obj));
      if (!target) return negated;
      if (got === undefined) {
        setField(s, target, 'controller', p);                         // "Gain control of a spell"
        emit(s, x, { k: 'controlChanged', obj: target.obj!, p, rule: '479.2.a' });
        return choice('retarget', { item: target.id, who: p, pc: 0 });
      }
      return ok;
    }
    case 'swap': {
      const a = ref(ins.a), b = ref(ins.b);
      if (a.ignored) return a.ignored;
      if (b.ignored) return b.ignored;
      const ua = a.objs.find((id) => onBoard(s, id)), ub = b.objs.find((id) => onBoard(s, id));
      if (ua === undefined || ub === undefined) return negated;
      const la = locOf(s.objects[ua])!, lb = locOf(s.objects[ub])!;
      if (sameLoc(la, lb)) return negated;
      const toA = (l: Loc, u: ObjId): Loc => (l.z === 'base' ? { z: 'base', p: s.objects[u].controller ?? s.objects[u].owner } : l);
      moveUnits(s, x, [ua], toA(lb, ua), { by: p, standard: false, rule: '421' });
      moveUnits(s, x, [ub], toA(la, ub), { by: p, standard: false, rule: '421' });
      return ok;
    }
    case 'returnChampion': {
      const pl = s.players[p];
      if (pl.champion !== null) return negated;
      const id = pl.trash.find((t) => findCard(s.objects[t].def)?.name === pl.chosenChampionName || s.objects[t].def === pl.chosenChampionName);
      if (id === undefined) return negated;
      const from = s.objects[id].zone;
      const before = knowers(s, [id]);
      const obj = moveObject(s, id, Z.champion(p));
      emitZone(s, x, { obj, prev: id, from, to: Z.champion(p), why: 'returnChampion', rule: '108.3', before });
      return ok;
    }
    case 'activateConquer': {                                        // [383.4.g]
      const h = hereOf(s, it.source ?? null);
      if (!h || h.z !== 'bf') return negated;
      const found = collect(s, { e: 'scored', p, bf: h.bf, how: 'conquer' }).filter((t) => {
        const o = t.source === null ? undefined : s.objects[t.source];
        const at = o ? locOf(o) : null;
        return !!o && isUnitObj(o.def) && at?.z === 'bf' && at.bf === h.bf;
      });
      if (found.length === 0) return negated;
      placeAll(s, x, found.map((t) => ({ ...t, synthetic: true })), 'turnOrder');
      return ok;
    }
    case 'replay': {                                                 // as the spell leaves the chain [420.3]
      if (it.kind !== 'card') return negated;
      let q: PlayerId | null = p;
      if (ins.who !== 'self') {
        const id = firstOf(s, it, f.env, ins.who.controllerOf, st, c);
        q = id === null ? null : s.objects[id] && onBoard(s, id) ? s.objects[id].controller : it.play.lookBack[id]?.controller ?? null;
      }
      if (q === null) return { o: 'ignored', why: 'nullInfo' };
      setField(s, it, 'replay', { who: q, cost: resourceCost(ins.cost, findCard(s.objects[it.obj!]?.def ?? '')?.domains ?? []) as unknown as Json });
      return ok;
    }
    case 'toTrash': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => ['banish', 'hand', 'deck'].includes(s.objects[id].zone.z));
      if (objs.length === 0) return negated;
      for (const id of objs) toZone(s, x, id, Z.trash(s.objects[id].owner), { why: 'putInTrash', rule: '108.2' });
      return ok;
    }
    case 'doubleDamage': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, { s: 'doubleDamage' }, effOpts('433'));
      return ok;
    }
    case 'replaceBf': {                                              // [439]
      const h = ins.at === 'eventBf' ? (typeof it.trigger?.bf === 'number' ? it.trigger.bf : -1)
        : (() => { const l = hereOf(s, it.source ?? null); return l?.z === 'bf' ? l.bf : -1; })();
      if (h < 0 || !s.bfs[h]) return { o: 'ignored', why: 'nullInfo' };
      if (ins.back) return swapBackBattlefield(s, x, h) ? ok : negated;
      return replaceBattlefield(s, x, h, ins.token!, p) ? ok : negated;
    }
    case 'lookAt': {                                                 // "You can look at their facedown cards" [425]
      const objs = selectAll(s, ins.what, c).filter((id) => (s.objects[id].knownBy & (1 << p)) === 0);
      look(s, x, p, objs, '425');
      return ok;
    }
    case 'banishIfDies': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, { s: 'banishIfDies' }, effOpts('367'));
      return ok;
    }
    case 'replaceDeath': case 'cantMove': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, ins.op === 'replaceDeath' && ins.cost ? { s: 'replaceDeath', cost: ins.cost as unknown as Json }
        : { s: ins.op }, effOpts(ins.op === 'replaceDeath' ? '367' : '421'));
      return ok;
    }
  }
}

/** A Deal of chosen amounts by the item ("split among"), as one action [418]. */
function dealHits(s: GameState, x: X, it: ChainItem, hits: { to: ObjId; n: number }[], p: PlayerId): boolean {
  if (hits.length === 0) return false;
  const attribution = [...(it.obj !== undefined ? [it.obj] : []), ...(it.source !== undefined ? [it.source] : [])];
  deal(s, x, hits.map((h) => ({ to: h.to, n: h.n + bonusDamage(s, it, h.to) })), { sources: attribution, by: p, combat: false,
    rule: '418', item: it.id, spell: it.kind === 'card' });
  return true;
}

const isUnitObj = (def: string) => (findCard(def)?.types ?? []).includes('unit') || isUnitToken(def);

const isUnitToken = (t: string) => ['recruit', 'sprite', 'sandSoldier', 'mech', 'bird', 'reflection', 'tentacle', 'shadowClone']
  .includes(t);

/** Counters an item [426]: a card goes to its owner's trash, not played. */
export function counterItem(s: GameState, x: X, it: ChainItem, to?: 'hand') {
  setField(s, it, 'countered', true);
  emit(s, x, { k: 'counter', item: it.id, rule: '426' });
  // "Return it to its owner's hand instead of putting it in their trash" (Abandon).
  if (it.obj !== undefined && s.objects[it.obj]) toZone(s, x, it.obj, to === 'hand' ? Z.hand(it.owner) : Z.trash(it.owner), { why: 'countered', rule: '426' });
  removeItem(s, x, it.id);
}

/** The end of a resolution [359.3.d], [407.5], [340]. */
function finishResolve(s: GameState, x: X, f: ResolveFrame): StepOut {
  const it = itemById(s, f.item);
  if (it) {
    if (it.kind === 'card') {
      const card = s.objects[it.obj!];
      const types = typesOf(card);
      // [Flow]: played from the trash for its Flow cost, "Then banish it".
      const flow = it.play.origin.z === 'trash' && it.play.mode === 'discretionary'
        && (keywordsOf(card.def).some((k) => k.kw === 'flow') || it.play.choices.asPlayed.flow === true);
      const to = it.onLeaveChain === 'banish' || flow ? Z.banish(it.owner) : it.onLeaveChain === 'recycle' ? Z.deck(it.owner) : Z.trash(it.owner);
      const left = toZone(s, x, card.id, to, { why: 'resolved', rule: '359.3.d', ...(to.z === 'deck' ? { pos: 'bottom' as const } : {}) });
      if (left !== null && to.z === 'banish') fire(s, x, { e: 'banished', by: it.controller, objs: [left] });   // [Flow]: "banish it"
      emit(s, x, { k: 'played', item: it.id, def: card.def, p: it.controller, rule: '420.4.a' });
      append(s, s.log.played, { p: it.controller, card: card.card, def: card.def, isCard: true, types, from: it.play.origin.z,
        energySpent: it.play.facts.energySpent, powerSpent: it.play.facts.powerSpent, countered: false });
      fire(s, x, { e: 'played', p: it.controller, obj: null, def: card.def, isCard: true, types, energy: energyCostOf(card),
        from: it.play.origin.z, spent: it.play.facts.energySpent, ...(left !== null ? { cardObj: left } : {}) });
      // "Its controller may play this spell again for [A]": a play from the trash, declined at its payment [420.3].
      if (it.replay && left !== null && s.objects[left]?.zone.z === 'trash') {
        putOnChain(s, x, { obj: left, controller: it.replay.who, by: { item: it.id, instr: 'replay' },
          overrides: { cost: it.replay.cost as unknown as ResourceCost } });
      }
    } else if (it.ability && it.source !== undefined) {
      append(s, s.log.abilitiesResolved, { p: it.controller, source: it.source, ability: it.ability });
    }
  }
  setField(s, s.turn, 'resolving', null);
  setField(s, s.turn, 'cleanupRequested', false);
  if (it) removeItem(s, x, it.id);                                   // [319.5]
  setField(s, s.turn, 'passes', 0);                                  // [339.1]
  setField(s, s.turn, 'priority', null);                             // [340.4]
  markFepr(s);                                                       // [317.2.e]
  requestCleanup(s);
  return 'done';
}

// ---- resolution-time choices ----

interface ChoiceLocals { objs: ObjId[]; n?: number; who: PlayerId; chosen?: ObjId[]; kept?: ObjId[]; t?: string }

/**
 * An instruction's choice [355.18]: 'pick' (one of the looked-at cards to
 * draw, a buff to spend, an Equipment to detach), 'discard' (cards from the
 * hand), 'predict' (recycle or keep each card looked at [437.1.a]; kept
 * cards stay on top in their order), 'may' (yes or no), 'pay' (a cost
 * within the instruction [740.4.a]: a payment plan, or decline) and
 * 'eachKill' (each player in turn order picks one of their units, Cull the
 * Weak). Cards and plans are the deciding player's private information.
 */
defineSteps('instr', (s, f, x) => {
  if (f.op === 'may') {
    const l = f.locals as { who: PlayerId; item: number };
    const key = answer(f);
    if (key !== undefined) return ret(s, f, { yes: key === K.yes });
    return ask(s, f, x, { player: l.who, kind: 'may', prompt: { t: 'mayInstr' }, ctx: { item: l.item, rule: '359.3.e' },
      options: [{ key: K.yes }, { key: K.no }], privateOptions: false });
  }
  if (f.op === 'pay') {
    const l = f.locals as unknown as { who: PlayerId; item: number; energy: number; power: PowerReq[] };
    const r = payStep(s, f, x, { payer: l.who, cost: { energy: l.energy, power: l.power }, what: 'cost', item: l.item, back: false,
      onBack: () => ret(s, f, { paid: false }), onDecline: () => ret(s, f, { paid: false }), rule: '740.4.a' });
    if (typeof r === 'string') return r;
    return ret(s, f, { paid: true });
  }
  if (f.op === 'mode') {                                             // a player picks one of the modes (choiceBy)
    const l = f.locals as { who: PlayerId; item: number; labels: string[] };
    const key = answer(f);
    if (key !== undefined) return ret(s, f, { n: parseKey(key)!.n! });
    return ask(s, f, x, { player: l.who, kind: 'mode', prompt: { t: 'mode', pick: 1, chosen: [], labels: l.labels },
      ctx: { item: l.item, rule: '355.3' }, options: l.labels.map((_, i) => ({ key: K.mode(i) })), privateOptions: false, mustAsk: true });
  }
  if (f.op === 'number') {                                           // "any amount": 0 … max
    const l = f.locals as { who: PlayerId; max: number; item: number };
    const key = answer(f);
    if (key !== undefined) return ret(s, f, { n: parseKey(key)!.n! });
    return ask(s, f, x, { player: l.who, kind: 'number', prompt: { t: 'number', max: l.max }, ctx: { item: l.item, rule: '740.4.a' },
      options: Array.from({ length: l.max + 1 }, (_, i) => ({ key: K.n(i) })), privateOptions: false, mustAsk: true });
  }
  if (f.op === 'split') {                                            // one point of damage at a time
    const l = f.locals as unknown as { objs: ObjId[]; n: number; who: PlayerId; picks?: ObjId[] };
    const picks = l.picks ?? [];
    const key = answer(f);
    if (key !== undefined) {
      const next = [...picks, parseKey(key)!.obj!];
      if (next.length >= l.n) return ret(s, f, { objs: next });
      f.locals = { ...l, picks: next } as unknown as Json;
      return 'continue';
    }
    const live = l.objs.filter((id) => s.objects[id]);
    if (live.length === 0) return ret(s, f, { objs: picks });
    return ask(s, f, x, { player: l.who, kind: 'split', prompt: { t: 'split', left: l.n - picks.length, total: l.n },
      ctx: { rule: '418' }, options: live.map((id) => ({ key: K.x(id), refs: [{ obj: id }], meta: { amount: 1 } })),
      privateOptions: false, batch: `split:p${l.who}` });
  }
  if (f.op === 'retarget') {                                         // "You may make new choices for it"
    const l = f.locals as { item: number; who: PlayerId; pc: number; old?: Json };
    const target = itemById(s, l.item);
    if (!target) return ret(s, f, {});
    if (l.pc === 0) {
      const key = answer(f);
      if (key === undefined) {
        return ask(s, f, x, { player: l.who, kind: 'may', prompt: { t: 'newChoices' }, ctx: { item: l.item, rule: '359.3.e' },
          options: [{ key: K.yes }, { key: K.no }], privateOptions: false });
      }
      if (key !== K.yes) return ret(s, f, {});
      const old = copyJson(target.play.choices) as unknown as Json;
      const ex = target.play.choices.executions[0];
      setField(s, ex, 'targets', {});
      setField(s, ex, 'dests', {});
      const asPlayed = { ...target.play.choices.asPlayed };
      for (const k of Object.keys(asPlayed)) if (k.startsWith('slot:')) delete asPlayed[k];
      setField(s, target.play.choices, 'asPlayed', asPlayed);
      f.locals = { ...l, pc: 1, old };
      return 'continue';
    }
    const restore = () => { setField(s, target.play, 'choices', l.old as unknown as typeof target.play.choices); return ret(s, f, {}); };
    const r = chooseNext(s, f, x, target, programOf(s, target), { back: false, onBack: restore, onImpossible: restore,
      what: s.objects[target.obj ?? -1]?.def ?? 'spell' });
    return r === 'complete' ? ret(s, f, {}) : r;
  }
  if (f.op === 'choose') {                                           // any number between min and max, one pick at a time
    const l = f.locals as unknown as { objs: ObjId[]; min: number; max: number; who: PlayerId; sum: number | null; chosen?: ObjId[] };
    const chosen = l.chosen ?? [];
    const key = answer(f);
    if (key === K.done) return ret(s, f, { objs: chosen });
    if (key !== undefined) {
      const next = [...chosen, parseKey(key)!.obj!];
      if (next.length >= l.max) return ret(s, f, { objs: next });
      f.locals = { ...l, chosen: next } as unknown as Json;
      return 'continue';
    }
    const total = chosen.reduce((n, id) => n + Math.max(0, mightOf(s, id)), 0);
    const ll = l as typeof l & { oneEachLoc?: boolean; sameCtl?: boolean };
    const locKey = (id: ObjId) => JSON.stringify(locOf(s.objects[id]));
    const left = l.objs.filter((id) => s.objects[id] && !chosen.includes(id)
      && (l.sum === null || total + Math.max(0, mightOf(s, id)) <= l.sum)
      && (!ll.oneEachLoc || !chosen.some((c2) => s.objects[c2] && locKey(c2) === locKey(id)))   // "up to one at each location"
      && (!ll.sameCtl || chosen.every((c2) => s.objects[c2]?.controller === s.objects[id].controller)));   // "with the same controller"
    if (left.length === 0 && chosen.length >= Math.min(l.min, l.objs.length)) return ret(s, f, { objs: chosen });
    const hidden = left.some((id) => s.objects[id].zone.z === 'hand' || s.objects[id].zone.z === 'deck');
    const options: Option[] = left.map((id) => ({ key: K.pick(id), refs: [{ obj: id }] }));
    if (chosen.length >= Math.min(l.min, l.objs.length)) options.push({ key: K.done });
    return ask(s, f, x, { player: l.who, kind: 'pickCard', prompt: { t: 'choose', n: l.max, min: l.min, chosen: chosen.length },
      ctx: { rule: '355.18' }, options, privateOptions: hidden, batch: `choose:p${l.who}` });
  }
  if (f.op === 'eachKill') {
    const l = f.locals as { order: PlayerId[]; picks: ObjId[]; i: number; at?: Loc };
    const key = answer(f);
    if (key !== undefined) {
      f.locals = { ...l, picks: [...l.picks, parseKey(key)!.obj!], i: l.i + 1 };
      return 'continue';
    }
    for (let i = l.i; i < l.order.length; i++) {
      const q = l.order[i];
      const mine = (l.at ? unitsAt(s, l.at) : [...unitsAt(s, { z: 'base', p: q }), ...s.bfs.flatMap((_, bf) => unitsAt(s, { z: 'bf', bf }))])
        .filter((id) => s.objects[id].controller === q);
      if (mine.length === 0) continue;
      if (i !== l.i) { f.locals = { ...l, i }; return 'continue'; }
      return ask(s, f, x, { player: q, kind: 'pickCard', prompt: { t: 'killOwn', n: 1 }, ctx: { rule: '429' },
        options: mine.map((id) => ({ key: K.pick(id), refs: [{ obj: id }] })), privateOptions: false, batch: `eachKill:p${q}` });
    }
    return ret(s, f, { objs: l.picks });
  }
  const l = f.locals as unknown as ChoiceLocals;
  const chosen = l.chosen ?? [], kept = l.kept ?? [];
  const key = answer(f);
  if (key !== undefined) {
    const k = parseKey(key)!;
    const next: ChoiceLocals = k.head === 'keep' ? { ...l, kept: [...kept, k.obj!] } : { ...l, chosen: [...chosen, k.obj!] };
    if (f.op !== 'predict' && next.chosen!.length >= (l.n ?? 1)) return ret(s, f, { objs: next.chosen! });
    f.locals = next as unknown as Json;
    return 'continue';
  }
  if (f.op === 'predict') {
    const id = l.objs.find((o) => !chosen.includes(o) && !kept.includes(o));
    if (id === undefined) return ret(s, f, { objs: chosen });
    return ask(s, f, x, {
      player: l.who, kind: 'predict', prompt: { t: 'predict', n: l.objs.length }, ctx: { rule: '437.1' },
      options: [{ key: K.recycle(id), refs: [{ obj: id }] }, { key: K.keep(id), refs: [{ obj: id }] }],
      privateOptions: true, batch: `predict:p${l.who}`,
    });
  }
  const options: Option[] = l.objs.filter((id) => !chosen.includes(id)).map((id) => ({ key: K.pick(id), refs: [{ obj: id }] }));
  const board = l.t === 'spendBuff' || l.t === 'detach';
  return ask(s, f, x, {
    player: l.who, kind: 'pickCard', prompt: { t: f.op === 'discard' ? 'discard' : l.t ?? 'pickToDraw', n: l.n ?? 1 },
    ctx: { rule: f.op === 'discard' ? '423.1.a' : board ? '702.2.b' : '355.18' }, options, privateOptions: !board,
    batch: `${f.op}:p${l.who}`,
  });
});

