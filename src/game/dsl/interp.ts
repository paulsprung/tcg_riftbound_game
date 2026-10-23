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
import { abilityIn, cardDef, keywordCost } from '../cards/registry.ts';
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
import { fire } from '../abilities/triggers.ts';
import {
  addEffect, addMight, addSpecial, attach, banish, buffUnits, burn, cantMove, channelRunes, deal, detach, discard, drawCard,
  drawCards, gainPoints, gainXp, kill, look, mill, moveUnits, ready, recycleCards, recyclePermanent, returnToHand, spendBuffs,
  stunUnits, toZone,
} from '../rules/actions.ts';
import { itemById, markFepr, removeItem } from '../rules/chain.ts';
import { energyCostOf, keywordOf, mightOf, snapshotOf, tagsOf, typesOf } from '../rules/chars.ts';
import { evalCond, type CondCtx } from '../rules/conditions.ts';
import { mint } from '../state/mut.ts';
import { hereOf, sameLoc, selectAll, stillLegal, type SelCtx } from '../rules/targets.ts';
import { requestCleanup } from '../rules/tasks.ts';
import { costOf, putOnChain, resourceCost } from '../play/playCard.ts';
import { payStep } from '../play/pay.ts';
import { findCard } from '../cards/oracle.ts';
import { staticsFor } from '../layers/derive.ts';
import { opponentsOf, turnOrderFromTurnPlayer, unitsAt } from '../rules/board.ts';
import type { ResourceCost } from '../rules/resources.ts';

type ResolveFrame = FrameOf<'resolve'>;
type X = { present: boolean };

/** One instruction of an item, with the key its outcome is recorded under.
    `guard`: a branch of an `if` or a `may`, executed only when it was taken.
    `exec`: the execution it belongs to (0, then one per paid Repeat [820]). */
interface Step { key: string; instr: InstrAst; slots: SlotAst[]; exec: number; guard?: { key: string; branch: 'then' | 'else' } }

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
function flatten(body: InstrAst[], prefix: string, slots: SlotAst[], exec: number, guard?: Step['guard']): Step[] {
  const out: Step[] = [];
  body.forEach((instr, i) => {
    const key = `${prefix}${i}`;
    out.push({ key, instr, slots, exec, ...(guard ? { guard } : {}) });
    if (instr.op === 'if') {
      out.push(...flatten(instr.then, `${key}.t`, slots, exec, { key, branch: 'then' }));
      out.push(...flatten(instr.else ?? [], `${key}.e`, slots, exec, { key, branch: 'else' }));
    }
    if (instr.op === 'may') out.push(...flatten(instr.then, `${key}.t`, slots, exec, { key, branch: 'then' }));
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
  it.play.choices.executions.forEach((ex, e) => {
    const pre = e === 0 ? '' : `x${e}.`;
    out.push(...flatten(prog.body, `${pre}b`, own, e));
    (prog.modes?.of ?? []).forEach((m, mi) => {
      if (!ex.modes.includes(mi)) return;
      out.push(...flatten(m.body, `${pre}m${mi}.`, [...own, ...(m.choose ?? [])], e));
    });
  });
  return out;
}

/** Where the battlefields the item's slots chose are ("friendly units there"). */
function slotLocs(s: GameState, it: ChainItem, exec = 0): Record<string, Loc | null> {
  const out: Record<string, Loc | null> = {};
  for (const [slot, ts] of Object.entries(it.play.choices.executions[exec]?.targets ?? {})) {
    const t = ts[0];
    if (t?.k !== 'obj') continue;
    const bf = s.bfs.findIndex((b) => b.obj === t.id);
    out[slot] = bf >= 0 ? { z: 'bf', bf } : null;
  }
  return out;
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
function bind(f: ResolveFrame, name: string, objs: ObjId[]) {
  f.env.bound = { ...f.env.bound, [name]: { objs } };
}

const targetsOf = (it: ChainItem, st: Step, slot: string): TargetRef[] =>
  it.play.choices.executions[st.exec]?.targets[slot] ?? [];

/** What a reference names now, or null when the information is gone
    [359.3.e.12]. Targets come back with the illegal ones dropped. */
function resolveRef(s: GameState, it: ChainItem, env: Env, r: RefAst | SelAst, st: Step, c: SelCtx):
  { objs: ObjId[]; ignored?: Outcome } {
  if (typeof r === 'object' && 'k' in r) return { objs: selectAll(s, r, c) };      // a set locked now [479.4]
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
  if ('bound' in r) return { objs: objsOf(env.bound[r.bound]).filter((id) => s.objects[id]) };
  const v = 'info' in r ? it.trigger?.[r.info] : it.trigger?.subject;
  return typeof v === 'number' && s.objects[v] ? { objs: [v] } : { objs: [], ignored: { o: 'ignored', why: 'nullInfo' } };
}

/** The object a reference names at all, legal or not, live or looked back. */
function firstOf(s: GameState, it: ChainItem, env: Env, r: RefAst, st: Step, c: SelCtx): ObjId | null {
  if (typeof r === 'object' && 'slot' in r) {
    const t = targetsOf(it, st, r.slot)[0];
    return t?.k === 'obj' ? t.id : null;
  }
  if (typeof r === 'object' && 'bound' in r) return objsOf(env.bound[r.bound])[0] ?? null;   // even if it moved since
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
      return Math.max(0, it.play.lookBack[id]?.chars.might ?? 0);    // look-back [359.3.e.13]
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
  }
}

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
    if (spec.to === 'here') {
      const h = hereOf(s, st.host), at = locOf(s.objects[target]);
      if (!h || !at || !sameLoc(h, at)) continue;
    }
    n += spec.n;
  }
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
  const c: SelCtx = { controller: it.controller, source: it.source ?? null, slotLoc: slotLocs(s, it, st.exec), eventBf, subject };
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
  if ('dest' in to) return it.play.choices.executions[st.exec]?.dests[to.dest] ?? null;
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
  const p = it.controller;
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
  switch (ins.op) {
    case 'deal': case 'banish': case 'kill': case 'stun': case 'buff': case 'might': {
      const target = ins.op === 'deal' || ins.op === 'might' ? ins.to : ins.what;
      const r = ref(target);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      if (ins.op === 'deal') {
        const n = val((ins as Extract<InstrAst, { op: 'deal' }>).n);
        if (n <= 0) return negated;                                  // no Deal, no bonus [715.4]
        deal(s, x, objs.map((to) => ({ to, n: n + bonusDamage(s, it, to) })), { sources: attribution, by: p, combat: false,
          rule: '418', item: it.id });
      } else if (ins.op === 'banish') { lookBack(s, it, objs); banish(s, x, objs, '428'); }
      else if (ins.op === 'kill') { lookBack(s, it, objs); kill(s, x, objs, { rule: '429', inCombat: () => false }); }
      else if (ins.op === 'stun') return stunUnits(s, x, objs, '424', p).length > 0 ? ok : { o: 'negated', why: 'noop' };
      else if (ins.op === 'buff') return buffUnits(s, x, objs, '427', p).length > 0 ? ok : { o: 'negated', why: 'noop' };
      else {
        const m = ins as Extract<InstrAst, { op: 'might' }>;
        const n = m.sign * val(m.n);
        for (const id of objs) {
          // "to a minimum of 1 [M]": a decrease that stops at 1, fixed now [479.4.b].
          const amount = m.floor !== undefined && n < 0 ? -Math.min(-n, Math.max(0, mightOf(s, id) - m.floor)) : n;
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
      else addEffect(s, x, objs, { s: 'keyword', kw: ins.kw.kw, value: ins.kw.value ?? 1 }, o);
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
      const took = evalCond(s, ins.cond, { ...condCtx(s, it), bound: f.env.bound }) ? 'then' : 'else';
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
      info.item = it.id;
      append(s, s.delayed, { id, controller: p, createdBy: it.id, createdTurn: s.turn.n,
        ability: { ...ins.ability, id: `eff:${id}#0` } as unknown as Json,
        window: { during: 'thisTurn', uses: ins.uses }, info });
      return ok;
    }
    case 'draws': {
      if (ins.who === 'opponents') {
        for (const q of opponentsOf(s, p)) drawCards(s, x, q, ins.n, '414');
        return ok;
      }
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
      ready(s, x, r.objs, '416');
      return ok;
    }
    case 'draw': {
      if (ins.from) {
        const ids = objsOf(f.env.bound[(ins.from as { bound: string }).bound]).filter((id) => s.objects[id]?.zone.z === 'deck');
        if (ids.length === 0) return negated;
        for (const id of ids) drawCard(s, x, p, id, '414.1');
        return ok;
      }
      const n = val(ins.n);
      if (n <= 0) return negated;
      drawCards(s, x, p, n, '414');
      return ok;
    }
    case 'burn': burn(s, x, p, ins.n, '441'); return ok;
    case 'mill': return mill(s, x, p, ins.n, '108.2').length > 0 ? ok : negated;
    case 'channel': return channelRunes(s, x, p, ins.n, '431', ins.exhausted === true) > 0 ? ok : negated;
    case 'look': {
      const top = s.players[p].deck.slice(0, ins.n);
      look(s, x, p, top, '425');
      bind(f, ins.bind, top);
      return top.length > 0 ? ok : negated;
    }
    case 'revealTop': {                                              // [425]: everyone sees it
      const top = s.players[p].deck.slice(0, 1);
      if (top.length === 0) return negated;
      setField(s, s.objects[top[0]], 'knownBy', allMask(s.players.length));
      emit(s, x, { k: 'reveal', objs: top, to: allMask(s.players.length), rule: '425' });
      bind(f, ins.bind, top);
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
      const from = objsOf(f.env.bound[ins.from]).filter((id) => s.objects[id]);
      if (from.length <= ins.n) {
        bind(f, ins.bind, from);
        return from.length > 0 ? ok : negated;
      }
      if (got === undefined) return choice('pick', { objs: from, n: ins.n, who: p });
      bind(f, ins.bind, objsOf(got));
      return ok;
    }
    case 'recycleRest': {
      const minus = objsOf(f.env.bound[ins.minus]);
      const rest = objsOf(f.env.bound[ins.from]).filter((id) => !minus.includes(id) && s.objects[id]?.zone.z === 'deck');
      if (rest.length === 0) return negated;
      recycleCards(s, x, p, rest, '417');
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
      if (ins.id !== undefined) bind(f, ins.id, picked);
      return ok;
    }
    case 'predict': {
      const n = val(ins.n);
      const top = s.players[p].deck.slice(0, n);
      if (top.length === 0) return negated;                          // no Burn Out [437.4.a]
      if (got === undefined) {
        look(s, x, p, top, '437.1');
        return choice('predict', { objs: top, who: p });
      }
      const recycled = objsOf(got);
      recycleCards(s, x, p, recycled, '437.1.a');
      return ok;
    }
    case 'playToken': {
      let at: Loc | undefined;
      if (ins.at === 'yourBase') at = { z: 'base', p };
      else if (ins.at === 'here') {
        const h = hereOf(s, it.source ?? null);
        if (!h) return { o: 'ignored', why: 'nullInfo' };            // "here" is gone [359.3.e.12]
        at = h;
      } else if (typeof ins.at === 'object') {
        const bf = it.trigger?.[ins.at.info];
        if (typeof bf !== 'number' || bf < 0) return { o: 'ignored', why: 'nullInfo' };
        at = { z: 'bf', bf };
      } else if (playedFromFacedown !== null && isUnitToken(ins.token)) {
        at = { z: 'bf', bf: playedFromFacedown };                   // [811.1.d.5]
      }
      for (let n = 0; n < ins.n; n++) {
        putOnChain(s, x, { obj: { token: ins.token, owner: p }, controller: p, by: { item: it.id, instr: st.key },
          overrides: { ...(at ? { at } : {}), ...(ins.ready ? { ready: true } : {}), ...(ins.exhausted ? { exhausted: true } : {}) } });
      }
      return ok;
    }
    case 'playSelf': {
      const id = f.env.self;
      const o = id === null ? undefined : s.objects[id];
      if (!o || o.zone.z !== 'trash') return { o: 'ignored', why: 'nullInfo' };   // it left the trash [420.3.c]
      putOnChain(s, x, { obj: id!, controller: p, by: { item: it.id, instr: st.key },
        overrides: { cost: resourceCost(ins.cost, findCard(o.def)?.domains ?? []) } });
      return ok;
    }
    case 'playCard': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const id = r.objs.find((o) => s.objects[o].zone.z === 'trash');
      if (id === undefined) return negated;
      const cost = costOf(s, id);
      const less = ins.energyLess === undefined ? 0 : val(ins.energyLess);
      putOnChain(s, x, { obj: id, controller: p, by: { item: it.id, instr: st.key },
        overrides: { cost: { energy: Math.max(0, cost.energy - less), power: cost.power } } });
      return ok;
    }
    case 'move': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const units = r.objs.filter((id) => onBoard(s, id) && !cantMove(s, id));
      const groups = new Map<string, { to: Loc; units: ObjId[] }>();
      for (const id of units) {
        const to = moveDest(s, it, st, id, ins.to);
        const at = locOf(s.objects[id])!;
        if (!to || sameLoc(to, at)) continue;                        // not a valid destination [355.4.a]
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
      const deck = r.objs.filter((id) => s.objects[id].zone.z === 'deck');
      if (ins.op === 'recycle' && deck.length > 0) {                // a revealed card back to the bottom [417]
        recycleCards(s, x, p, deck, '417');
        return ok;
      }
      const objs = r.objs.filter((id) => onBoard(s, id) || s.objects[id].zone.z === 'trash');
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
      lookBack(s, it, [target.obj!]);
      counterItem(s, x, target);
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
      addSpecial(s, x, p, { energy: ins.energy, universal: ins.power, onlyFor: ins.onlyFor,
        source: it.source !== undefined ? s.objects[it.source]?.def ?? '' : '' }, '430');
      return ok;
    case 'win':
      endGame(s, x, { winner: p, reason: 'effect', rule: '195', turn: s.turn.n });
      return ok;
    case 'points':
      gainPoints(s, x, p, ins.n, 'effect', '194.1');
      return ok;
    case 'attach': {
      const a = ref(ins.what), b = ref(ins.to);
      if (a.ignored) return a.ignored;
      if (b.ignored) return b.ignored;
      const g = a.objs[0], u = b.objs[0];
      if (g === undefined || u === undefined) return negated;
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
      const cands = selectAll(s, ins.from, c).filter((id) => s.objects[id].buffs > 0);
      if (cands.length === 0) return negated;
      if (cands.length > 1 && got === undefined) return choice('pick', { objs: cands, n: 1, who: p, t: 'spendBuff' });
      const u = cands.length === 1 ? cands[0] : objsOf(got)[0];
      return spendBuffs(s, x, [u], '702.2.b').length > 0 ? ok : negated;
    }
    case 'eachPlayerKills': {
      if (got === undefined) return choice('eachKill', { order: turnOrderFromTurnPlayer(s), picks: [], i: 0 });
      const picks = objsOf(got).filter((id) => s.objects[id] && onBoard(s, id));
      if (picks.length === 0) return negated;
      kill(s, x, picks, { rule: '429', inCombat: () => false });
      return ok;
    }
    case 'pay': {
      if (got === undefined) {
        const cost = resourceCost(ins.cost, it.source !== undefined ? findCard(s.objects[it.source]?.def ?? '')?.domains ?? [] : []);
        return choice('pay', { who: p, item: it.id, energy: cost.energy, power: cost.power as unknown as Json });
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
    case 'playerEffect':
      append(s, s.effects, { id: mint(s, 'eff'), ts: mint(s, 'ts'), controller: p, source: it.source ?? it.obj ?? null,
        item: it.id, rule: '479', layer: 4, affects: { player: p }, spec: ins.spec as unknown as Json, until: ins.until });
      requestCleanup(s);
      return ok;
    case 'replaceDeath': case 'cantMove': {
      const r = ref(ins.what);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      addEffect(s, x, objs, { s: ins.op }, effOpts(ins.op === 'replaceDeath' ? '367' : '421'));
      return ok;
    }
  }
}

const isUnitToken = (t: string) => ['recruit', 'sprite', 'sandSoldier', 'mech', 'bird', 'reflection', 'tentacle', 'shadowClone']
  .includes(t);

/** Counters an item [426]: a card goes to its owner's trash, not played. */
export function counterItem(s: GameState, x: X, it: ChainItem) {
  setField(s, it, 'countered', true);
  emit(s, x, { k: 'counter', item: it.id, rule: '426' });
  if (it.obj !== undefined && s.objects[it.obj]) toZone(s, x, it.obj, Z.trash(it.owner), { why: 'countered', rule: '426' });
  removeItem(s, x, it.id);
}

/** The end of a resolution [359.3.d], [407.5], [340]. */
function finishResolve(s: GameState, x: X, f: ResolveFrame): StepOut {
  const it = itemById(s, f.item);
  if (it) {
    if (it.kind === 'card') {
      const card = s.objects[it.obj!];
      const types = typesOf(card);
      toZone(s, x, card.id, Z.trash(it.owner), { why: 'resolved', rule: '359.3.d' });
      emit(s, x, { k: 'played', item: it.id, def: card.def, p: it.controller, rule: '420.4.a' });
      append(s, s.log.played, { p: it.controller, card: card.card, def: card.def, isCard: true, types, from: it.play.origin.z,
        energySpent: it.play.facts.energySpent, powerSpent: it.play.facts.powerSpent, countered: false });
      fire(s, x, { e: 'played', p: it.controller, obj: null, def: card.def, isCard: true, types, energy: energyCostOf(card),
        from: it.play.origin.z });
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
  if (f.op === 'eachKill') {
    const l = f.locals as { order: PlayerId[]; picks: ObjId[]; i: number };
    const key = answer(f);
    if (key !== undefined) {
      f.locals = { ...l, picks: [...l.picks, parseKey(key)!.obj!], i: l.i + 1 };
      return 'continue';
    }
    for (let i = l.i; i < l.order.length; i++) {
      const q = l.order[i];
      const mine = [...unitsAt(s, { z: 'base', p: q }), ...s.bfs.flatMap((_, bf) => unitsAt(s, { z: 'bf', bf }))]
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

