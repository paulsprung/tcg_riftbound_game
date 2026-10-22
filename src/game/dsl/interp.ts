/*
 * The interpreter (§9.3): resolving a chain item [340], [359.3.d],
 * [407.5]. The master loop's R row starts it once every player has passed
 * in sequence; a 'resolve' frame then runs the item's instructions top to
 * bottom (a spell's own text, then each chosen mode's in printed order),
 * and for each instruction:
 *
 *   1  stops if the item has left the chain [359.3.e.15];
 *   2  re-checks its targets: all illegal → ignored, it does nothing
 *      [359.3.e.6–7]; some illegal → it acts on the legal ones [359.3.e.8];
 *   3  reads its referents now ("here", "your units", X) [359.3.f.2]; those
 *      that no longer exist → ignored [359.3.e.12];
 *   4  asks a resolution-time choice in an 'instr' frame (which card to
 *      draw, what to discard, Predict) [355.18], resuming with the answer;
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
import { abilityById, cardDef } from '../cards/registry.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { emit } from '../core/events.ts';
import { answer, ask, defineSteps, ret, takeRet, type FrameOf, type StepOut } from '../core/frames.ts';
import { EngineError } from '../core/errors.ts';
import { append, pushFrame, setField } from '../state/mut.ts';
import { Z, locOf } from '../state/zones.ts';
import type {
  ChainItem, Env, GameState, Json, Loc, ObjId, Outcome, PlayerId, TargetRef,
} from '../state/types.ts';
import type { InstrAst, ProgAst, RefAst, SelAst, SlotAst, ValueAst } from './ast.ts';
import { fire } from '../abilities/triggers.ts';
import {
  addMight, banish, buffUnits, burn, channelRunes, deal, discard, drawCard, drawCards, kill, look, ready, recycleCards,
  stunUnits, toZone,
} from '../rules/actions.ts';
import { itemById, markFepr, removeItem } from '../rules/chain.ts';
import { energyCostOf, typesOf } from '../rules/chars.ts';
import { hereOf, selectAll, stillLegal, type SelCtx } from '../rules/targets.ts';
import { requestCleanup } from '../rules/tasks.ts';
import { putOnChain, resourceCost } from '../play/playCard.ts';
import { findCard } from '../cards/oracle.ts';

type ResolveFrame = FrameOf<'resolve'>;
type X = { present: boolean };

/** One instruction of an item, with the key its outcome is recorded under. */
interface Step { key: string; instr: InstrAst; slots: SlotAst[] }

/** The program an item executes as it resolves: a spell's text, an
    ability's effect. */
export function programOf(s: GameState, it: ChainItem): ProgAst | undefined {
  if (it.kind === 'card') return cardDef(s.objects[it.obj!].def)?.spell;
  if (it.ability) {
    const a = abilityById(it.ability);
    return a?.effect;
  }
  return undefined;
}

/** The instructions in order: the program's own, then each chosen mode's
    in printed order [355.3]. */
function stepsOf(s: GameState, it: ChainItem): Step[] {
  const prog = programOf(s, it);
  if (!prog) return [];
  const own = prog.choose ?? [];
  const out: Step[] = prog.body.map((instr, i) => ({ key: `b${i}`, instr, slots: own }));
  const chosen = it.play.choices.executions[0].modes;
  (prog.modes?.of ?? []).forEach((m, mi) => {
    if (!chosen.includes(mi)) return;
    m.body.forEach((instr, i) => out.push({ key: `m${mi}.${i}`, instr, slots: [...own, ...(m.choose ?? [])] }));
  });
  return out;
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
    const chosen: TargetRef[] = it.play.choices.executions[0].targets[r.slot] ?? [];
    if (chosen.length === 0) return { objs: [] };                                // "up to" with none chosen
    const legal = chosen.filter((t) => stillLegal(s, t, slot, c)).map((t) => (t as { id: ObjId }).id);
    return legal.length === 0 ? { objs: [], ignored: { o: 'ignored', why: 'targets' } } : { objs: legal };
  }
  if ('bound' in r) return { objs: objsOf(env.bound[r.bound]).filter((id) => s.objects[id]) };
  const subject = it.trigger?.subject;
  return typeof subject === 'number' && s.objects[subject] ? { objs: [subject] }
    : { objs: [], ignored: { o: 'ignored', why: 'nullInfo' } };
}

function value(s: GameState, v: ValueAst, c: SelCtx): number {
  return typeof v === 'number' ? v : selectAll(s, v.of, c).length;
}

const onBoard = (s: GameState, id: ObjId) => locOf(s.objects[id]) !== null;

// ---- the resolve frame ----

defineSteps('resolve', (s, f, x) => {
  const it = itemById(s, f.item);
  const steps = it ? stepsOf(s, it) : [];
  const i = f.ip[0];
  if (!it || i >= steps.length) return finishResolve(s, x, f);       // [359.3.e.15], or the end
  const st = steps[i];
  const c: SelCtx = { controller: it.controller, source: it.source ?? null };
  const got = takeRet(f);
  const out = execute(s, x, f, it, st, c, got);
  if (out === 'asked') return 'continue';
  setField(s, it.outcomes, st.key, out);
  emit(s, x, { k: 'outcome', item: it.id, instr: st.key, outcome: out, rule: '359.3.e' });
  f.ip = [i + 1];
  return 'continue';
});

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
  switch (ins.op) {
    case 'deal': case 'banish': case 'kill': case 'stun': case 'buff': case 'might': {
      const target = ins.op === 'deal' || ins.op === 'might' ? ins.to : ins.what;
      const r = resolveRef(s, it, f.env, target, st, c);
      if (r.ignored) return r.ignored;
      const objs = r.objs.filter((id) => onBoard(s, id));
      if (objs.length === 0) return negated;
      if (ins.op === 'deal') {
        deal(s, x, objs.map((to) => ({ to, n: value(s, ins.n, c) })), { sources: attribution, by: p, combat: false,
          rule: '418' });
      } else if (ins.op === 'banish') banish(s, x, objs, '428');
      else if (ins.op === 'kill') kill(s, x, objs, { rule: '429', inCombat: () => false });
      else if (ins.op === 'stun') return stunUnits(s, x, objs, '424').length > 0 ? ok : { o: 'negated', why: 'noop' };
      else if (ins.op === 'buff') return buffUnits(s, x, objs, '427').length > 0 ? ok : { o: 'negated', why: 'noop' };
      else if (ins.op === 'might') addMight(s, x, objs, ins.sign * value(s, ins.n, c), { controller: p, source: it.source ?? it.obj ?? null, item: it.id,
        rule: '479.4' });
      return ok;
    }
    case 'ready': {
      const r = resolveRef(s, it, f.env, ins.what, st, c);
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
      drawCards(s, x, p, value(s, ins.n, c), '414');
      return ok;
    }
    case 'burn': burn(s, x, p, ins.n, '441'); return ok;
    case 'channel': return channelRunes(s, x, p, ins.n, '431', ins.exhausted === true) > 0 ? ok : negated;
    case 'look': {
      const top = s.players[p].deck.slice(0, ins.n);
      look(s, x, p, top, '425');
      bind(f, ins.bind, top);
      return top.length > 0 ? ok : negated;
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
      discard(s, x, p, objsOf(got), '423');
      return ok;
    }
    case 'predict': {
      const top = s.players[p].deck.slice(0, ins.n);
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
      }
      for (let n = 0; n < ins.n; n++) {
        putOnChain(s, x, { obj: { token: ins.token, owner: p }, controller: p, by: { item: it.id, instr: st.key },
          overrides: at ? { at } : {} });
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
  }
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
      fire(s, x, { e: 'played', p: it.controller, obj: null, def: card.def, isCard: true, types, energy: energyCostOf(card) });
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

interface ChoiceLocals { objs: ObjId[]; n?: number; who: PlayerId; chosen?: ObjId[]; kept?: ObjId[] }

/**
 * An instruction's choice [355.18]: 'pick' (one of the looked-at cards to
 * draw), 'discard' (cards from the hand), 'predict' (recycle or keep each
 * card looked at [437.1.a]; kept cards stay on top in their order, which is
 * all Predict 1 needs). All are the deciding player's private information.
 * Hands the chosen cards back as { objs }.
 */
defineSteps('instr', (s, f, x) => {
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
  return ask(s, f, x, {
    player: l.who, kind: 'pickCard', prompt: { t: f.op === 'discard' ? 'discard' : 'pickToDraw', n: l.n ?? 1 },
    ctx: { rule: f.op === 'discard' ? '423.1.a' : '355.18' }, options, privateOptions: true, batch: `${f.op}:p${l.who}`,
  });
});
