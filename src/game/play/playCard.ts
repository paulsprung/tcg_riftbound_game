/*
 * The process of playing a card or a token (§5.6, Spec D, [349–359]): six
 * steps, each of its choices a decision of its own.
 *
 *   S0     a discretionary play [420.2]: snapshot BEFORE step 1, so a
 *          rollback puts the card back where it was with its old ObjId
 *          (fix F1, [358.5])
 *   1      the card moves to the chain as a new object [354], [124]; the
 *          state Closes [354.1]; the Play action is logged [420.5]; the
 *          cleanup this makes outstanding runs before step 2 [354.4] (fix
 *          F2: the frame waits for tasks). A limited play [420.3] (an
 *          instruction says "play …") does step 1 inside that instruction
 *          (putOnChain), and the master loop's F row starts this frame at
 *          step 2 once the instructing item has resolved [354.3]
 *   S2     a limited play: snapshot as step 2 begins (Spec D §8.5)
 *   2      choices [355]: Show Off [832.1.c] and optional additional costs
 *          [355.1.a] (play/cost.ts), a unit's location (its controller's
 *          base or a battlefield they control [355.2.a]), Deploy gear's
 *          battlefield [830.1.b], a token's replacements once its location
 *          is known (abilities/replacements.ts) [370.1.c], a spell's modes
 *          [355.3] and targets [355.5]
 *   3      the total cost [356] (play/cost.ts): the printed cost, or what
 *          the instructing effect says ("for [Y]", tokens: nothing
 *          [185.3.a.1]), Deflect, the additional costs and the discounts
 *   4      payment [357] (play/pay.ts): the objects of non-standard costs,
 *          Energy and Power, then the costs' actions [357.2]; declining
 *          undoes the play [445.2.a]
 *   5      legality [358]: choices still legal, timing [358.4]
 *   6      finalize [359]: a permanent leaves the chain at once and enters
 *          the board [337.2], [359.2] (a unit exhausted at its location, gear
 *          ready at base, Deploy gear at its battlefield), Played is logged
 *          and its Play Effects trigger [383.4.a.2]; a spell becomes a
 *          finalized item and waits for the players to pass [359.3]
 *
 * Rollback. A discretionary play goes back to S0 (`back` in steps 1–4,
 * `decline`, a failed step 5). A limited play has no `back`: it goes back
 * to S2 and its card returns to where it came from with the identity it
 * had there; a token whose play fails ceases to exist (Spec D §8.5, OQ-6).
 */
import { bfOpenTo } from '../rules/board.ts';
import { allied } from '../rules/teams.ts';
import { abilityById, cardDef } from '../cards/registry.ts';
import { ALL_TAGS, findCard, ORACLE } from '../cards/oracle.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { emit, emitZone, knowers } from '../core/events.ts';
import { allMask } from '../state/ids.ts';
import { tokenReplacements } from '../abilities/replacements.ts';
import {
  answer, ask, awaitTasks, defineSteps, next, type FrameOf, type RunCtx, type StepOut, type StepTable,
} from '../core/frames.ts';
import type { CostAst, KeywordAst, NonStdCostAst, SelAst } from '../dsl/ast.ts';
import {
  append, createBattlefield, createObject, deleteObject, mint, moveObject, restoreSnapshot, setField, setSnap2, snapshotState,
} from '../state/mut.ts';
import { Z } from '../state/zones.ts';
import type {
  CardType, ChainItem, DefId, Domain, Frame, GameObject, GameState, ItemId, Json, KeywordId, Loc, ObjId, PlayedRecord, PlayerId,
  PowerReq, TargetRef, TokenId,
} from '../state/types.ts';
import { fire } from '../abilities/triggers.ts';
import { addEffect, applyContested } from '../rules/actions.ts';
import { addItem, countUsage, finalizeItem, itemById, playContext, removeItem, usageKey } from '../rules/chain.ts';
import { energyCostOf, hasKeyword, isType, snapshotOf, tagsOf, typesOf } from '../rules/chars.ts';
import {
  cardShowOff, cheapestCost, costOffers, deflectFor, mandatoryCostsPossible, optionalOffers, powerOf, showOffCandidates,
  totalCost, xMax,
} from './cost.ts';
import { chooseCostObjects, performCostObjects } from './costObjects.ts';
import { keywordsOf } from '../cards/registry.ts';
import { evalCond } from '../rules/conditions.ts';
import { staticsFor } from '../layers/derive.ts';
import { paymentPlans, type ResourceCost } from '../rules/resources.ts';
import { isAlone, slotLocsOf, stillLegal } from '../rules/targets.ts';
import { cardTiming, givenTiming, timingOk, windowAllows, type Timing, type Window } from '../rules/timing.ts';
import { requestCleanup } from '../rules/tasks.ts';
import { choicesPossible, chooseNext, modeLegal, slotObjsOf, slotsOf } from './choices.ts';
import { payStep } from './pay.ts';
import { copyJson } from '../state/clone.ts';

type PlayFrame = FrameOf<'play'>;

/** The frame that plays a card the player chose at a priority decision. */
export const playFrame = (obj: ObjId): Frame => ({ f: 'play', item: null, obj, pc: 0, snap: null, revealed: false,
  rngUsed: false });

/** The frame that finishes a limited play from step 2 (the F row). */
export const limitedPlayFrame = (it: ChainItem): Frame => ({ f: 'play', item: it.id, obj: it.obj!, pc: 1, snap: null,
  revealed: false, rngUsed: false });

/** What an instruction that plays something changes about the play
    [420.3.b] (PlayContext.instructedBy.overrides). */
export interface PlayOverrides {
  /** Where it is played, fixed by the instruction ("to your base", "here"). */
  at?: Loc;
  /** The cost instead of the printed one ("for [Y]"); tokens cost nothing. */
  cost?: { energy: number; power: PowerReq[] };
  /** The card's ObjId before step 1, so a failed play returns it as it was. */
  origId?: ObjId;
  /** "Play a ready 3 [M] Sprite", "play a Gold gear token exhausted". */
  ready?: true;
  exhausted?: true;
  /** A token played as a copy of a card [446]: it enters with that definition's copyable traits. */
  copyOf?: DefId;
  /** Keywords it has from now on ("Give it [Temporary]"). */
  give?: KeywordAst[];
  /** "its owner plays it to any battlefield": every battlefield, and only those. */
  anyBf?: true;
  /** "back to the same location or to their base": only these locations. */
  locs?: Loc[];
}

const overridesOf = (it: ChainItem): PlayOverrides => (it.play.instructedBy?.overrides ?? {}) as PlayOverrides;

/** A cost of the effect language as resources [131]. 'C' is one of the
    card's domains [135.2.e.6.c]. */
export function resourceCost(c: CostAst, domains: Domain[]): ResourceCost {
  return { energy: c.energy ?? 0, power: powerOf(c, domains) };
}

/** A card's printed cost [131]; nothing from face down [811.1.b]. */
export function costOf(s: GameState, id: ObjId): ResourceCost {
  if (s.objects[id].zone.z === 'facedown') return { energy: 0, power: [] };
  const c = findCard(s.objects[id].def)?.cost;
  return { energy: c?.energy ?? 0, power: c?.power ?? [] };
}

/** Where a unit may be played: its controller's base, or a battlefield
    they control [355.2.a]. */
export function unitLocations(s: GameState, p: PlayerId): Loc[] {
  if (baseOnly(s, p)) return [{ z: 'base', p }];
  return [{ z: 'base', p }, ...s.bfs.flatMap((b, bf): Loc[] => (b.controller === p ? [{ z: 'bf', bf }] : []))];
}

/** "Opponents can only play units to their base" (Mageseeker Warden, while it is at a battlefield). */
/** "Units can't be played here." */
const noPlayHere = (s: GameState, bf: number) => staticsFor(s, null, 'noPlayHere').some(({ st }) => {
  const h = s.objects[st.host];
  return h.zone.z === 'bf' && h.zone.bf === bf;
});

const baseOnly = (s: GameState, p: PlayerId) => staticsFor(s, null, 'opponentsPlayToBase').some(({ st }) => st.ctl !== p);

/** A player effect on p of this kind ("can't play cards", "the next spell costs [5] less"). */
export const playerEffects = (s: GameState, p: PlayerId, kind: string) => s.effects.filter((e) =>
  (e.spec as { s?: string } | null)?.s === kind && 'player' in e.affects && e.affects.player === p);

const hasUnitsAt = (s: GameState, p: PlayerId, bf: number, except: ObjId | null = null) =>
  s.bfs[bf].here.some((u) => u !== except && isType(s.objects[u], 'unit') && s.objects[u].controller === p);

/** Battlefields an Ambush unit may be played to: where p has units [822.1.b]. */
export const ambushLocations = (s: GameState, p: PlayerId, def?: string): Loc[] =>
  s.bfs.flatMap((b, bf): Loc[] => (hasUnitsAt(s, p, bf) || (def !== undefined && ambushEnemy(def)
    && b.here.some((u) => isType(s.objects[u], 'unit') && s.objects[u].controller !== p)) ? [{ z: 'bf', bf }] : []));

/** Rengar, Trophy Hunter: "I can [Ambush] to a battlefield where there are enemy units, even if you don't have units there." */
const ambushEnemy = (def: string) => (cardDef(def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'ambushEnemy');

/** Whether a definition prints a keyword now (a card off the board). */
const printed = (def: string, kw: KeywordId) => keywordsOf(def).some((k) => k.kw === kw);

/** The permissions a card's own text gives to where it is played: "You may
    play me to an open battlefield" [170.11.c], "to an occupied enemy
    battlefield". */
function ownPlayTo(def: string): ('open' | 'occupiedEnemy' | 'attacking' | 'enemyAlone')[] {
  return (cardDef(def)?.abilities ?? []).flatMap((a) => (a.kind === 'static' && a.spec.s === 'playTo' ? [a.spec.where] : []));
}

/** "The next unit you play this turn … can be played to any battlefield" (Last Caress). */
const playAnywhere = (s: GameState, p: PlayerId, types: CardType[]) => s.effects.find((e) => {
  const spec = e.spec as { s?: string; types?: CardType[]; uses?: number } | null;
  return spec?.s === 'playAnywhere' && 'player' in e.affects && e.affects.player === p && (spec.uses ?? 1) > 0
    && (spec.types ?? []).some((t) => types.includes(t));
});

/** Where a permanent may be played: units as above, plus Ambush [822.1.b]
    and their own permissions; Deploy gear to any battlefield and only there
    [830.1.b.1–2]; other gear to base [359.2.d]. A card played from face
    down goes to its battlefield [811.1.d.1]. */
export function playLocations(s: GameState, id: ObjId, p: PlayerId, origin?: ChainItem['play']['origin']): Loc[] {
  const o = s.objects[id];
  if (origin?.z === 'facedown') {                                    // [811.1.d.1]; Last Caress: "even from face down"
    if (isType(o, 'unit') && playAnywhere(s, p, typesOf(o))) return s.bfs.map((_, bf): Loc => ({ z: 'bf', bf }));
    return isType(o, 'unit') || isType(o, 'gear') ? [{ z: 'bf', bf: origin.bf }] : [];
  }
  if (isType(o, 'unit')) {
    const out = unitLocations(s, p);
    const add = (l: Loc) => { if (!out.some((m) => m.z === l.z && (m.z === 'base' || m.bf === (l as typeof m).bf))) out.push(l); };
    if (printed(o.def, 'ambush')) ambushLocations(s, p, o.def).forEach(add);
    const others = staticsFor(s, null, 'othersPlayTo').filter(({ st, spec }) => st.ctl === p && st.host !== id
      && spec.types.some((t) => typesOf(o).includes(t))).map(({ spec }) => spec.where);
    for (const w of baseOnly(s, p) ? [] : [...ownPlayTo(o.def), ...others]) {
      s.bfs.forEach((b, bf) => {
        const units = b.here.filter((u) => isType(s.objects[u], 'unit'));
        if (w === 'open' && b.controller === null && units.length === 0) add({ z: 'bf', bf });   // [170.11.c]
        if (w === 'occupiedEnemy' && b.controller !== null && b.controller !== p && units.length > 0) add({ z: 'bf', bf });
        if (w === 'attacking' && s.combat?.bf === bf && s.combat.attacker === p) add({ z: 'bf', bf });   // "a battlefield you're attacking"
        // "to an occupied battlefield if an enemy unit is alone there" (Arachnoid Horror).
        if (w === 'enemyAlone' && units.some((u) => s.objects[u].controller !== p && isAlone(s, u))) add({ z: 'bf', bf });
      });
    }
    if (playAnywhere(s, p, typesOf(o)) && !baseOnly(s, p)) s.bfs.forEach((_, bf) => add({ z: 'bf', bf }));
    // "Play me only to a battlefield you conquered this turn" (Perched Grimwyrm).
    if ((cardDef(o.def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'playOnlyToConquered')) {
      return out.filter((l) => l.z === 'bf' && s.log.scored.some((r) => r.p === p && r.bf === l.bf && r.how === 'conquer'));
    }
    return out.filter((l) => l.z !== 'bf' || !noPlayHere(s, l.bf));    // Rockfall Path
  }
  if (isType(o, 'gear')) {
    return hasKeyword(s, id, 'deploy') || printed(o.def, 'deploy') ? s.bfs.map((_, bf): Loc => ({ z: 'bf', bf })) : [{ z: 'base', p }];
  }
  return [];
}

/** Where the item's permanent may be played: as playLocations says, or any battlefield when an instruction says so. */
function itemLocations(s: GameState, it: ChainItem, obj: ObjId): Loc[] {
  const locs = overridesOf(it).anyBf && isType(s.objects[obj], 'unit') ? s.bfs.map((_, bf): Loc => ({ z: 'bf', bf }))
    : overridesOf(it).locs ?? playLocations(s, obj, it.controller, it.play.origin);
  // a unit isn't played where its controller couldn't move it either [491]
  return isType(s.objects[obj], 'unit') ? locs.filter((l) => l.z !== 'bf' || bfOpenTo(s, l.bf, it.controller)) : locs;
}

/** A card in a trash given [Flow] this turn ("Flow equal to its cost"). */
const hasFlowGrant = (s: GameState, id: ObjId) => s.effects.some((e) => (e.spec as { s?: string } | null)?.s === 'flowGrant'
  && 'objs' in e.affects && e.affects.objs.includes(id));

/** A spell needs a definition to be played: without one it has nothing to
    execute. Units and gear without one are vanilla bodies. */
export function playable(s: GameState, id: ObjId): boolean {
  const o = s.objects[id];
  if (isType(o, 'unit') || isType(o, 'gear')) return true;
  return isType(o, 'spell') && cardDef(o.def)?.spell !== undefined;
}

/** A card's timing as it would be played from where it is: from face down
    it has [Reaction] from the turn after it was hidden [811.1.b]. */
export function timingFrom(s: GameState, id: ObjId): Timing {
  const o = s.objects[id];
  if (o.zone.z === 'facedown') return { action: false, reaction: true };
  const t = givenTiming(s, id, o.owner, cardTiming(o.def));
  // "Your Equipment everywhere have [Quick-Draw]" (Jax, Unmatched): its Reaction timing [819].
  if (tagsOf(o).includes('Equipment') && staticsFor(s, null, 'equipmentQuickDraw').some(({ st }) => st.ctl === o.owner)) t.reaction = true;
  return t;
}

/** The domains the cards in p's hand need Power of, for payment ranking. */
export function domainsNeeded(s: GameState, p: PlayerId, except: ObjId | null = null): Domain[] {
  const out: Domain[] = [];
  for (const id of s.players[p].hand) {
    if (id === except) continue;
    for (const req of costOf(s, id).power) if (req.k === 'domain' && !out.includes(req.d)) out.push(req.d);
  }
  return out;
}

/**
 * The cards p may start to play now from hand or the Champion Zone
 * [420.1.a]: a definition to execute, timing for this window (§5.5), a way
 * to pay, and choices that can be made (the cheap stage of §4.6; the
 * priority decision's feasibility filter completes it, core/feasible.ts).
 */
export function playableCards(s: GameState, p: PlayerId, w: Window = 'main'): ObjId[] {
  const pl = s.players[p];
  if (playerEffects(s, p, 'cantPlay').length > 0) return [];       // "opponents can't play cards this turn"
  // "Your opponents' [Hidden] cards can't be revealed here" (Noxus Saboteur).
  const sealed = (bf: number) => staticsFor(s, null, 'noFacedownPlayHere').some(({ st }) => {
    const h = s.objects[st.host];
    return st.ctl !== p && h.zone.z === 'bf' && h.zone.bf === bf;
  });
  const facedown = s.bfs.flatMap((b) => b.facedown).filter((id) => {
    const o = s.objects[id];
    return o.controller === p && o.facedown !== null && o.facedown.hiddenOnTurn < s.turn.n   // from the next turn [811.1.b]
      && !sealed(o.facedown.bf);
  });
  // Undying Legion: "You may play me from your trash for …" (while its condition holds).
  const fromTrash = pl.trash.filter((id) => printed(s.objects[id].def, 'flow') || hasFlowGrant(s, id)   // [Flow]
    || (cardDef(s.objects[id].def)?.abilities ?? []).some((a) => a.kind === 'static'
    && a.spec.s === 'playFromTrash' && (!a.while || evalCond(s, a.while, { controller: p, source: id, origin: 'trash' }))));
  // Endless Riches: "You may play cards from your trash."
  const allTrash = staticsFor(s, null, 'playAllFromTrash').some(({ st }) => st.ctl === p) ? pl.trash.filter((id) => !fromTrash.includes(id)) : [];
  // Akali, Brash; Runeblade Anvil: "Until your next Ending Phase, you may play that card" (a banished card).
  const fromBanish = pl.banish.filter((id) => s.effects.some((e) => (e.spec as { s?: string } | null)?.s === 'playFromBanish'
    && e.controller === p && 'objs' in e.affects && e.affects.objs.includes(id)));
  const from = [...pl.hand, ...(pl.champion === null ? [] : [pl.champion]), ...facedown, ...fromTrash, ...allTrash, ...fromBanish];
  // Fallen Feline: "While I'm at a battlefield, opponents can't play spells with that name."
  const namedOut = staticsFor(s, null, 'opponentsCantPlayNamed').filter(({ st }) => st.ctl !== p && s.objects[st.host]?.named?.kind === 'card')
    .map(({ st }) => s.objects[st.host].named!.value);
  // "Its controller can't play spells this turn" (Lilting Lullaby).
  const barred = playerEffects(s, p, 'cantPlayTypes').flatMap((e) => (e.spec as { types?: CardType[] }).types ?? []);
  return from.filter((id) => {
    const o = s.objects[id];
    if (!playable(s, id)) return false;
    if (typesOf(o).some((t) => barred.includes(t))) return false;
    if (isType(o, 'spell') && namedOut.includes(findCard(o.def)?.name ?? '')) return false;
    // Ol' Poro: "I can't be played on your first, second, or third turns."
    if ((cardDef(o.def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'cantBePlayed'
      && (!a.while || evalCond(s, a.while, { controller: p, source: id })))) return false;
    // Ambush: [Reaction] while being played to a battlefield where you have units [822.1.b].
    const ambush = isType(o, 'unit') && printed(o.def, 'ambush') && ambushLocations(s, p, o.def).length > 0;
    if (!windowAllows(w, timingFrom(s, id)) && !(ambush && w !== 'main')) return false;
    const kind = isType(o, 'spell') ? true : isType(o, 'gear') ? 'gear' as const : isType(o, 'unit') ? 'unit' as const : false;
    if (paymentPlans(s, p, cheapestCost(s, id, p, costOf(s, id)), { limit: 1, spell: kind }).length === 0) return false;
    if (!mandatoryCostsPossible(s, id, p)) return false;
    const origin = o.zone.z === 'facedown' ? o.zone : undefined;
    if (isType(o, 'spell')) {
      return choicesPossible(s, cardDef(o.def)!.spell, { controller: p, source: null,
        ...(origin?.z === 'facedown' ? { restrictBf: origin.bf } : {}) });
    }
    return playLocations(s, id, p, origin).length > 0;
  });
}

const itemOf = (s: GameState, f: PlayFrame): ChainItem => itemById(s, f.item!)!;
const backOk = (s: GameState, f: PlayFrame) => !f.revealed && !f.rngUsed && itemOf(s, f).play.mode === 'discretionary'
  && itemOf(s, f).play.origin.z !== 'facedown';

/**
 * Step 1 of a play, for a card an instruction plays or a token it makes
 * [354], [420.3], [440.2.c]: a Pending item on the chain. Its other steps
 * wait until the instructing item has resolved and the tasks are done.
 */
export function putOnChain(s: GameState, x: { present: boolean }, o: {
  obj: ObjId | { token: TokenId; owner: PlayerId }; controller: PlayerId; by: { item: ItemId; instr: string };
  overrides: PlayOverrides;
}): ChainItem {
  const item = mint(s, 'item');
  let obj: ObjId, origin: ChainItem['play']['origin'], owner: PlayerId, card: number | null, kind: ChainItem['kind'];
  const overrides: PlayOverrides = { ...o.overrides };
  if (typeof o.obj === 'number') {
    const c = s.objects[o.obj];
    origin = copyJson(c.zone);
    owner = c.owner;
    card = c.card;
    kind = 'card';
    overrides.origId = o.obj;
    const before = knowers(s, [o.obj]);
    obj = moveObject(s, o.obj, { z: 'chain', item }, { controller: o.controller });
    emitZone(s, x, { obj, prev: o.obj, from: origin, to: { z: 'chain', item }, why: 'play', rule: '354', before });
  } else {
    // "Play a token": created on the chain and played [440.2.c], [185.2.a];
    // owned by the controller of the effect that made it [183].
    origin = { z: 'chain', item };
    owner = o.obj.owner;
    card = null;
    kind = 'token';
    obj = createObject(s, { def: o.obj.token, printing: null, owner, zone: { z: 'chain', item }, token: true,
      controller: o.controller }).id;
    overrides.cost = { energy: 0, power: [] };
  }
  const it: ChainItem = {
    id: item, seq: item, kind, sub: 'normal', status: 'pending', controller: o.controller, owner, obj, isAdd: false,
    outcomes: {},
    play: playContext(s, { mode: 'limited', origin, item, by: o.controller,
      instructedBy: { item: o.by.item, instr: o.by.instr, overrides: overrides as unknown as Json } }),
  };
  addItem(s, x, it, { played: false });
  append(s, s.log.playActions, { p: o.controller, item, card, isCard: kind === 'card' });   // [420.5]
  return it;
}

/** Undoes a discretionary play [358.5], [445.2.a]: back to S0, the card
    where it was. Not a counter. */
function rollback(s: GameState, f: PlayFrame, x: RunCtx, reason: 'back' | 'illegal' | 'declined') {
  const item = f.item;
  const it = item === null ? null : itemOf(s, f);
  if (it && it.play.mode === 'limited') return rollbackLimited(s, f, x, reason);
  restoreSnapshot(s, f.snap!);
  if (reason === 'illegal' && item !== null) emit(s, x, { k: 'playFailed', item, reason: 'legality', rule: '358.5' });
  emit(s, x, { k: 'rollback', reason, rule: reason === 'declined' ? '445.2.a' : '358.5' });
  x.rollbacks = (x.rollbacks ?? 0) + 1;
  return 'done' as const;
}

/**
 * Undoes a limited play (Spec D §8.5): back to S2, so the instructing
 * item's own actions stand; the card goes back to where it came from as if
 * step 1 never happened (same identity, no triggers), a token ceases to
 * exist [186.1], and the item and what it caused are gone.
 */
function rollbackLimited(s: GameState, f: PlayFrame, x: RunCtx, reason: 'back' | 'illegal' | 'declined') {
  const it = itemOf(s, f);
  const id = it.id;
  if (it.play.snap2) restoreSnapshot(s, it.play.snap2);
  const again = itemById(s, id)!;
  const o = overridesOf(again);
  const card = s.objects[again.obj!];
  if (card.token) deleteObject(s, card.id);
  else {
    const origin = again.play.origin;
    const back = moveObject(s, card.id, origin, { reuseId: o.origId, ...(origin.z === 'deck' ? { pos: 'top' as const } : {}) });
    emitZone(s, x, { obj: back, prev: card.id, from: { z: 'chain', item: id }, to: origin, why: 'playFailed', rule: '358.5',
      before: knowers(s, [back]) });
  }
  removeItem(s, x, id);
  emit(s, x, { k: 'playFailed', item: id, reason: reason === 'declined' ? 'declined' : 'legality', rule: '358.5' });
  emit(s, x, { k: 'rollback', reason, rule: reason === 'declined' ? '445.2.a' : '358.5' });
  x.rollbacks = (x.rollbacks ?? 0) + 1;
  return 'done' as const;
}

const spellProg = (s: GameState, it: ChainItem) => cardDef(s.objects[it.obj!].def)?.spell;


// ---- step 2 and 4 helpers: Show Off, optional costs, replacements, cost objects ----

/** The Energy and Power base cost of the item's card [356.1]; from face
    down, nothing [811.1.b], [356.1.b.1]. */
const baseCost = (s: GameState, it: ChainItem): ResourceCost => overridesOf(it).cost
  ?? (it.play.origin.z === 'facedown' ? { energy: 0, power: [] } : costOf(s, it.obj!));

const chosenOptional = (it: ChainItem) => Object.entries(it.play.choices.optionalCosts).filter(([, v]) => v).map(([k]) => k);

/** The numbers chosen for "any number" costs ('x:<key>' in asPlayed). */
const xsOf = (it: ChainItem): Record<string, number> => Object.fromEntries(Object.entries(it.play.choices.asPlayed)
  .filter(([k, v]) => k.startsWith('x:') && typeof v === 'number').map(([k, v]) => [k.slice(2), v as number]));

const chosenTargets = (it: ChainItem): TargetRef[] => it.play.choices.executions.flatMap((ex) => Object.values(ex.targets).flat());

/** The amounts chosen for "pay any amount of Power" costs ('xpow:<key>' in asPlayed). */
const xpowOf = (it: ChainItem): Record<string, number> => Object.fromEntries(Object.entries(it.play.choices.asPlayed)
  .filter(([k, v]) => k.startsWith('xpow:') && typeof v === 'number').map(([k, v]) => [k.slice(5), v as number]));

/** The total cost of the item as chosen so far [356]. */
function playCost(s: GameState, it: ChainItem, extra: TargetRef[] = []): ResourceCost {
  const o = s.objects[it.obj!];
  return totalCost(s, { def: o.def, types: typesOf(o), p: it.controller, base: baseCost(s, it), chosen: chosenOptional(it), xs: xsOf(it), origin: it.play.origin.z, flow: it.play.choices.asPlayed.flow === true,
    targets: [...chosenTargets(it), ...extra], xpow: xpowOf(it), location: it.play.choices.location ?? null,
    fixedBase: overridesOf(it).cost !== undefined });
}

/** Whether choosing this target still leaves a cost the player can pay:
    a Deflect target adds [A] [809.1.c] (§4.6: options that can finish). */
function affordable(s: GameState, it: ChainItem, t: TargetRef): boolean {
  if (deflectFor(s, t, it.controller) === 0) return true;
  return paymentPlans(s, it.controller, playCost(s, it, [t]), { limit: 1, spell: isSpellItem(s, it) }).length > 0;
}

const isSpellItem = (s: GameState, it: ChainItem) => isType(s.objects[it.obj!], 'spell');

/** [832.1.c]: reveal a card from hand or pick a friendly one, or neither.
    Always asked, so that whether it is asked tells nothing about the hand. */
function showOffStep(s: GameState, f: PlayFrame, x: RunCtx, it: ChainItem) {
  const o = s.objects[f.obj];
  const key = answer(f);
  if (key === K.back) return rollback(s, f, x, 'back');
  const cands = showOffCandidates(s, it);
  if (key === undefined) {
    const options: Option[] = [...cands.map((c) => ({ key: K.pick(c.obj), refs: [{ obj: c.obj }] })), { key: K.no }];
    return ask(s, f, x, {
      player: it.controller, kind: 'showOff', prompt: { t: 'showOff', card: o.def }, ctx: { item: it.id, source: f.obj,
        rule: '832.1.c' }, options, privateOptions: true, back: backOk(s, f), mustAsk: true,
    });
  }
  if (key !== K.no) {
    const id = parseKey(key)!.obj!;
    const c = cands.find((z) => z.obj === id)!;
    setField(s, it.play.facts, 'showOff', [{ source: `${o.def}#kw:showOff`, picks: [snapshotOf(s, id)], fromHand: [c.fromHand] }]);
    if (c.fromHand) {                                                // revealed from hand; a board pick is not [832]
      setField(s, s.objects[id], 'knownBy', allMask(s.players.length));
      emit(s, x, { k: 'reveal', objs: [id], to: allMask(s.players.length), rule: '832.1.c' });
      f.revealed = true;                                             // nobody can unsee it: no more back (§4.4)
    }
  }
  setField(s, it.play.choices.asPlayed, 'showOff', true);
  return 'continue';
}

/** [355.1.a]: whether to pay an optional additional cost. When only one
    answer leaves a cost the player can pay, it is taken (§4.6). */
function optionalCostStep(s: GameState, f: PlayFrame, x: RunCtx, it: ChainItem, off: { key: string; a: { id: string } }) {
  const key = answer(f);
  if (key === K.back) return rollback(s, f, x, 'back');
  if (key === undefined) {
    const o = s.objects[f.obj];
    const can = (yes: boolean) => paymentPlans(s, it.controller, totalCost(s, { def: o.def, types: typesOf(o), p: it.controller,
      base: baseCost(s, it), chosen: [...chosenOptional(it), ...(yes ? [off.key] : [])], origin: it.play.origin.z, flow: it.play.choices.asPlayed.flow === true, estimatePaid: true }),
      { limit: 1, spell: isSpellItem(s, it) })
      .length > 0;
    // "Choose one you haven't already chosen": a Repeat is paid only while another mode is left for its execution.
    const prog = spellProg(s, it);
    const repeats = chosenOptional(it).filter((k) => (abilityById(k.split('@')[0]) as { repeat?: true } | undefined)?.repeat).length;
    const modesLeft = (off.a as { repeat?: true }).repeat && prog?.modes?.distinct
      ? prog.modes.of.filter((m) => modeLegal(s, m, { controller: it.controller, source: null })).length - (repeats + 1) * prog.modes.pick : 1;
    const yes = can(true) && modesLeft > 0, no = can(false);
    if (yes !== no) {
      setField(s, it.play.choices.optionalCosts, off.key, yes);
      return 'continue';
    }
    return ask(s, f, x, {
      player: it.controller, kind: 'optionalCost', prompt: { t: 'optionalCost', card: o.def, ability: off.a.id },
      ctx: { item: it.id, source: f.obj, rule: '355.1.a' }, options: [{ key: K.yes }, { key: K.no }], privateOptions: false,
      back: backOk(s, f),
    });
  }
  setField(s, it.play.choices.optionalCosts, off.key, key === K.yes);
  return 'continue';
}

/** [370.1.c], [371.2]: a replacement of the token's play, once its location
    is known. Applying it replaces the token on the chain by the other one
    at the same location; applied or declined, it is in the lineage now
    [370.2], [371.2.b]. */
function replacementStep(s: GameState, f: PlayFrame, x: RunCtx, it: ChainItem) {
  const offs = tokenReplacements(s, it);
  if (offs.length === 0) {
    setField(s, it.play.choices.asPlayed, 'replaced', true);
    return 'continue';
  }
  const off = offs[0];
  const who = s.objects[off.source].controller!;
  const key = off.a.may ? answer(f) : K.yes;
  if (key === undefined) {
    return ask(s, f, x, {
      player: who, kind: 'applyReplacement', prompt: { t: 'applyReplacement', ability: off.a.id, token: s.objects[f.obj].def,
        with: 'playToken' in off.a.instead ? off.a.instead.playToken : s.objects[f.obj].def }, ctx: { item: it.id, source: off.source, rule: '371.2' },
      options: [{ key: K.yes }, { key: K.no }], privateOptions: false,
    });
  }
  const lineage = [...((it.play.choices.asPlayed.lineage ?? []) as string[]), off.a.id];
  setField(s, it.play.choices.asPlayed, 'lineage', lineage);
  if (key !== K.yes) return 'continue';
  const old = s.objects[f.obj];
  if (off.a.limit) countUsage(s, usageKey(off.source, off.a.id, '*'));
  if ('extraCopy' in off.a.instead) {                                // Zilean: "that token and an additional copy of it"
    const ov = overridesOf(it);
    const loc = it.play.choices.location;
    const copy = putOnChain(s, x, { obj: { token: old.def as TokenId, owner: old.owner }, controller: it.controller,
      by: { item: it.play.instructedBy?.item ?? it.id, instr: it.play.instructedBy?.instr ?? 'replay' },
      overrides: { ...ov, ...(loc ? { at: loc } : {}) } });
    setField(s, copy.play.choices.asPlayed, 'lineage', lineage);
    emit(s, x, { k: 'replaced', source: off.source, event: `playToken:${old.def}`, rule: '369.1' });
    return 'continue';
  }
  const zone = copyJson(old.zone);
  deleteObject(s, old.id);
  const obj = createObject(s, { def: off.a.instead.playToken, printing: null, owner: old.owner, zone, token: true,
    controller: old.controller }).id;
  setField(s, it, 'obj', obj);
  f.obj = obj;
  emit(s, x, { k: 'replaced', source: off.source, event: `playToken:${old.def}`, rule: '369.1' });
  return 'continue';
}

/** A non-standard cost as step 3 recorded it in TotalCost.other. */
interface NonStd { key: string; src: ObjId | null; pay: NonStdCostAst }

/** [357.2]: the objects a non-standard cost exhausts, kills, discards or
    recycles, chosen by the player as step 4 begins (Spec D OQ-5), one per
    decision. */
function costObjectStep(s: GameState, f: PlayFrame, x: RunCtx, it: ChainItem, c: NonStd): 'complete' | StepOut {
  return chooseCostObjects(s, f, x, { item: it, src: c.src, key: c.key, pay: c.pay, what: s.objects[f.obj].def, back: backOk(s, f),
    onBack: () => rollback(s, f, x, 'back'), onImpossible: () => rollback(s, f, x, 'illegal') });
}

/** Performs a non-standard cost's actions [357.2]: one Exhaust action on
    the source and the chosen objects [415.4], one Kill action, the discard,
    the recycle. False when it can no longer be paid in full [203.3]. */
function payNonStd(s: GameState, x: RunCtx, it: ChainItem, c: NonStd): boolean {
  return performCostObjects(s, x, it, c.key, c.src, c.pay);
}

const STEPS: StepTable<PlayFrame> = [
  // Step 1 [354], with S0 taken first (fix F1).
  (s, f, x) => {
    f.snap = snapshotState(s);
    const card = s.objects[f.obj];
    const p = card.owner;
    const origin = copyJson(card.zone);
    const item = mint(s, 'item');
    const before = knowers(s, [f.obj]);
    const it: ChainItem = {
      id: item, seq: item, kind: 'card', sub: 'normal', status: 'pending', controller: p, owner: card.owner, obj: -1,
      isAdd: false, outcomes: {}, play: playContext(s, { mode: 'discretionary', origin, item, by: p }),
    };
    const flow = origin.z === 'trash' && hasFlowGrant(s, f.obj);    // Kennen: "give a spell in your trash [Flow]"
    const obj = moveObject(s, f.obj, { z: 'chain', item }, { controller: p });
    addItem(s, x, { ...it, obj }, { played: true });
    if (flow) setField(s, itemById(s, item)!.play.choices.asPlayed, 'flow', true);
    append(s, s.log.playActions, { p, item, card: card.card, isCard: true });   // [420.5]
    emitZone(s, x, { obj, prev: f.obj, from: origin, to: { z: 'chain', item }, why: 'play', rule: '354', before });
    f.obj = obj;
    f.item = item;
    return awaitTasks(f);                                             // [354.4]
  },

  // S2 for a limited play (Spec D §8.5); a discretionary play goes on.
  (s, f) => {
    const it = itemOf(s, f);
    if (it.play.mode === 'limited' && !it.play.snap2) setSnap2(s, it.play, snapshotState(s));
    return next(f);
  },

  // Step 2 [355]: Show Off and optional costs [355.1], location, a token's
  // replacements, then modes and targets.
  (s, f, x) => {
    const it = itemOf(s, f);
    const o = s.objects[f.obj];
    const spell = isType(o, 'spell');
    const asPlayed = it.play.choices.asPlayed;
    if (cardShowOff(o.def) && asPlayed.showOff !== true) return showOffStep(s, f, x, it);
    const open = optionalOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z).filter((c) => it.play.choices.optionalCosts[c.key] === undefined);
    if (open.length > 0) return optionalCostStep(s, f, x, it, open[0]);
    // "You may kill any number of friendly units as an additional cost": how many [355.1.a].
    const xOff = costOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z).find((c) => c.a.x && asPlayed[`x:${c.key}`] === undefined);
    if (xOff) {
      const max = xMax(s, xOff.a.x!, it.controller);
      const key = answer(f);
      if (key === K.back) return rollback(s, f, x, 'back');
      if (max === 0 || key !== undefined) {
        setField(s, asPlayed, `x:${xOff.key}`, max === 0 ? 0 : parseKey(key!)!.n!);
        return 'continue';
      }
      return ask(s, f, x, { player: it.controller, kind: 'number', prompt: { t: 'costNumber', card: o.def, ability: xOff.a.id, max },
        ctx: { item: it.id, source: f.obj, rule: '355.1.a' }, options: Array.from({ length: max + 1 }, (_, i) => ({ key: K.n(i) })),
        privateOptions: false, back: backOk(s, f) });
    }
    // Chronobreak: "As an additional cost to play this, pay any amount of Power": how much [355.1.a].
    const pOff = costOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z).find((c) => c.a.xPower && asPlayed[`xpow:${c.key}`] === undefined);
    if (pOff) {
      const key = answer(f);
      if (key === K.back) return rollback(s, f, x, 'back');
      // As much Power as could be made: runes, the pool's Power, Gold (a number that can't be paid fails at the payment).
      const pl = s.players[it.controller];
      const base = totalCost(s, { def: o.def, types: typesOf(o), p: it.controller, base: baseCost(s, it), chosen: chosenOptional(it), origin: it.play.origin.z, flow: it.play.choices.asPlayed.flow === true });
      const max = Math.max(0, Math.min(12, pl.base.filter((id) => s.objects[id].def.endsWith('-rune') && !s.objects[id].exhausted).length
        + pl.pool.universal + Object.values(pl.pool.power).reduce((a, b) => a + b, 0) - base.power.length - Math.max(0, base.energy - pl.pool.energy)));
      if (max === 0 || key !== undefined) {
        setField(s, asPlayed, `xpow:${pOff.key}`, max === 0 ? 0 : parseKey(key!)!.n!);
        return 'continue';
      }
      return ask(s, f, x, { player: it.controller, kind: 'number', prompt: { t: 'costNumber', card: o.def, ability: pOff.a.id, max },
        ctx: { item: it.id, source: f.obj, rule: '355.1.a' }, options: Array.from({ length: max + 1 }, (_, i) => ({ key: K.n(i) })),
        privateOptions: false, back: backOk(s, f) });
    }
    // Ivern: "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag" [355.1].
    const tagChoice = (cardDef(o.def)?.abilities ?? []).find((a) => a.kind === 'static' && a.spec.s === 'chooseTag');
    if (tagChoice && tagChoice.kind === 'static' && tagChoice.spec.s === 'chooseTag' && asPlayed.chosenTag === undefined) {
      const tags = tagChoice.spec.tags === 'any' ? ALL_TAGS.slice() : tagChoice.spec.tags;   // The List: "name a tag"
      const key = answer(f);
      if (key === K.back) return rollback(s, f, x, 'back');
      if (key !== undefined) {
        setField(s, asPlayed, 'chosenTag', tags[parseKey(key)!.n!]);
        return 'continue';
      }
      return ask(s, f, x, { player: it.controller, kind: 'mode', prompt: { t: 'mode', card: o.def, pick: 1, chosen: [], labels: tags },
        ctx: { item: it.id, source: f.obj, rule: '355.1' }, options: tags.map((_, i) => ({ key: K.mode(i) })), privateOptions: false,
        back: backOk(s, f), mustAsk: true });
    }
    // Fallen Feline: "When you play me, name a spell" — named as it is played.
    const naming = (cardDef(o.def)?.abilities ?? []).find((a) => a.kind === 'static' && a.spec.s === 'nameCard');
    if (naming && naming.kind === 'static' && naming.spec.s === 'nameCard' && asPlayed.namedCard === undefined) {
      const types = naming.spec.types;
      const names = [...new Set(ORACLE.cards.filter((c) => c.types.some((t) => types.includes(t))).map((c) => c.name))].sort();
      const key = answer(f);
      if (key === K.back) return rollback(s, f, x, 'back');
      if (key !== undefined) {
        setField(s, asPlayed, 'namedCard', names[parseKey(key)!.n!]);
        return 'continue';
      }
      return ask(s, f, x, { player: it.controller, kind: 'mode', prompt: { t: 'mode', card: o.def, pick: 1, chosen: [], labels: names },
        ctx: { item: it.id, source: f.obj, rule: '355.1' }, options: names.map((_, i) => ({ key: K.mode(i) })), privateOptions: false,
        back: backOk(s, f), mustAsk: true });
    }
    if (!spell && !it.play.choices.location) {
      // Dragon Roost: "If they do, they play it to this battlefield."
      const here = costOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z).find((c) => c.a.playHere && chosenOptional(it).includes(c.key));
      const hb = here?.src !== undefined && here.src !== null && s.objects[here.src]?.zone.z === 'bf' ? (s.objects[here.src].zone as { bf: number }).bf : -1;
      if (hb >= 0) {
        setField(s, it.play.choices, 'location', { z: 'bf', bf: hb });
        setField(s, asPlayed, 'fixedLoc', true);
        return 'continue';
      }
      const fixed = overridesOf(it).at;
      if (fixed) {
        setField(s, it.play.choices, 'location', fixed);
        return 'continue';
      }
      const key = answer(f);
      if (key === K.back) return rollback(s, f, x, 'back');
      let locs = itemLocations(s, it, f.obj);
      // Played where only Ambush allows it now: to a battlefield where you have units [822.1.b].
      if (!timingOk(s, it, { ignoreAmbush: true }) && printed(o.def, 'ambush')) {
        const amb = ambushLocations(s, it.controller, o.def);
        locs = locs.filter((l) => l.z === 'bf' && amb.some((m) => m.z === 'bf' && m.bf === l.bf));
      }
      // A location whose cost can't be paid is not offered (Hunters' Circle's discount only here) (§4.6).
      const payable = (l: Loc) => {
        const c = totalCost(s, { def: o.def, types: typesOf(o), p: it.controller, base: baseCost(s, it), chosen: chosenOptional(it), xs: xsOf(it),
          origin: it.play.origin.z, flow: it.play.choices.asPlayed.flow === true, xpow: xpowOf(it), location: l, fixedBase: overridesOf(it).cost !== undefined, estimatePaid: true });
        return paymentPlans(s, it.controller, c, { limit: 1, spell: isType(o, 'gear') ? 'gear' : 'unit' }).length > 0;
      };
      if (locs.some(payable)) locs = locs.filter(payable);
      if (locs.length === 0) return rollback(s, f, x, 'illegal');
      if (key === undefined) {
        const options: Option[] = locs.map((l) => ({ key: l.z === 'base' ? K.locBase : K.locBf(l.bf), refs: [{ loc: l }] }));
        return ask(s, f, x, {
          player: it.controller, kind: 'location', prompt: { t: 'location', card: o.def }, ctx: { item: it.id, source: f.obj,
            rule: hasKeyword(s, f.obj, 'deploy') ? '830.1.b' : '355.2' }, options, privateOptions: false, back: backOk(s, f),
        });
      }
      const k = parseKey(key)!;
      const loc: Loc = k.loc === 'base' ? { z: 'base', p: it.controller } : { z: 'bf', bf: (k.loc as { bf: number }).bf };
      setField(s, it.play.choices, 'location', loc);
      return 'continue';
    }
    if (it.kind === 'token' && asPlayed.replaced !== true) return replacementStep(s, f, x, it);
    if (spell) {
      const restrictBf = it.play.origin.z === 'facedown' ? it.play.origin.bf : undefined;
      // One execution more for each Repeat paid, each with its own choices [820.2].
      const repeats = costOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z).filter((c) => c.a.repeat && chosenOptional(it).includes(c.key));
      if (it.play.choices.executions.length < 1 + repeats.length) {
        setField(s, it.play.choices, 'executions', [...it.play.choices.executions, { modes: [], dests: {}, targets: {} }]);
        return 'continue';
      }
      const prog = spellProg(s, it);
      for (let e = 0; e < it.play.choices.executions.length; e++) {
        // "Choose one you haven't already chosen": each execution's mode differs from the earlier ones'.
        const modesUsed = prog?.modes?.distinct ? it.play.choices.executions.slice(0, e).flatMap((ex) => ex.modes) : [];
        const r = chooseNext(s, f, x, it, prog, {
          back: backOk(s, f), onBack: () => rollback(s, f, x, 'back'), onImpossible: () => rollback(s, f, x, 'illegal'),
          what: o.def, affordable: (t) => affordable(s, it, t), deflect: (t) => deflectFor(s, t, it.controller), exec: e,
          ...(restrictBf !== undefined ? { restrictBf } : {}), modesUsed,
          // A slot's `if` reads the optional costs decided so far ("If you paid the additional cost, choose … instead").
          cond: { controller: it.controller, source: null, facts: { ...it.play.facts, paidOptional: chosenOptional(it) } },
        });
        if (r !== 'complete') return r;
      }
    }
    setField(s, it.play, 'step', 2);
    return next(f);
  },

  // Step 3 [356]: the total cost.
  (s, f) => {
    const it = itemOf(s, f);
    const o = s.objects[f.obj];
    const c = playCost(s, it);
    const chosen = chosenOptional(it);
    const xs = xsOf(it);
    const other = costOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z)
      .filter((off) => off.a.pay && (!off.a.optional || chosen.includes(off.key)))
      .map((off) => ({ key: off.key, src: off.src, pay: off.a.pay! }) as unknown as Json);
    for (const off of costOffers(s, o.def, typesOf(o), it.controller, it.play.origin.z)) {   // the objects of an "any number" cost
      const n = xs[off.key] ?? 0;
      if (!off.a.x || n === 0) continue;
      const pay: NonStdCostAst = off.a.x.kill ? { kill: { sel: off.a.x.kill, n } } : { spendBuff: { sel: off.a.x.spendBuff!, n } };
      other.push({ key: off.key, src: null, pay } as unknown as Json);
    }
    void c;
    setField(s, it.play, 'cost', { energy: c.energy, power: c.power, other, components: [] });
    setField(s, it.play, 'step', 3);
    return next(f);
  },

  // Step 4 [357]: the objects of non-standard costs, then Energy and Power,
  // or decline [445.2.a]; then the non-standard costs' actions [357.2].
  (s, f, x) => {
    const it = itemOf(s, f);
    const other = (it.play.cost!.other ?? []) as unknown as NonStd[];
    for (const c of other) {
      const r = costObjectStep(s, f, x, it, c);
      if (r !== 'complete') return r;
    }
    const cost: ResourceCost = { energy: it.play.cost!.energy, power: it.play.cost!.power.slice() };
    // Atakhan: "I cost [1] less for each Energy it costs and [Y] less for each Power it costs" (the unit chosen to kill).
    for (const off of costOffers(s, s.objects[f.obj].def, typesOf(s.objects[f.obj]), it.controller, it.play.origin.z)) {
      if (!off.a.lessByPaid || !other.some((c) => c.key === off.key)) continue;
      const objs = ((it.play.choices.asPlayed[`cost:${off.key}:kill`] ?? []) as number[]).filter((id) => s.objects[id]);
      const req = powerOf({ power: [off.a.lessByPaid.power] }, findCard(s.objects[f.obj].def)?.domains ?? [])[0];
      for (const id of objs) {
        const c = findCard(s.objects[id].def)?.cost;
        cost.energy = Math.max(0, cost.energy - (c?.energy ?? 0));
        for (let i = 0; i < (c?.power.length ?? 0); i++) {
          const j = cost.power.findIndex((q) => JSON.stringify(q) === JSON.stringify(req));
          if (j >= 0) cost.power.splice(j, 1);
        }
      }
    }
    const r = payStep(s, f, x, {
      payer: it.controller, cost, what: s.objects[f.obj].def, item: it.id, source: f.obj, back: backOk(s, f),
      onBack: () => rollback(s, f, x, 'back'), onDecline: () => rollback(s, f, x, 'declined'), rule: '357',
      spell: isSpellItem(s, it) ? true : isType(s.objects[f.obj], 'gear') ? 'gear' : isType(s.objects[f.obj], 'unit') ? 'unit' : false,
    });
    if (typeof r === 'string') return r;
    setField(s, it.play, 'step', 4);
    if (r.energy + r.power > 0) {
      append(s, it.play.paid, { what: 'cost', replaced: false, objs: [], energy: r.energy, power: r.power });
      setField(s, it.play.facts, 'energySpent', r.energy);
      setField(s, it.play.facts, 'powerSpent', r.power);
      setField(s, s.log.powerSpent, it.controller, s.log.powerSpent[it.controller] + r.power);
    }
    for (const c of other) if (!payNonStd(s, x, it, c)) return rollback(s, f, x, 'illegal');   // impossible now [203.3]
    for (const key of chosenOptional(it)) {
      append(s, it.play.facts.paidOptional, key);                    // decided = paid [356.4.f.1]
      const [aid, src] = key.split('@');
      if (src !== undefined && (abilityById(aid) as { limit?: unknown } | undefined)?.limit) countUsage(s, usageKey(Number(src), aid, '*'));
    }
    return next(f);
  },

  // Step 5 [358]: the location and the targets must still be legal
  // [358.1], the timing right [358.4].
  (s, f, x) => {
    const it = itemOf(s, f);
    setField(s, it.play, 'step', 5);
    const loc = it.play.choices.location;
    if (loc && !overridesOf(it).at && it.play.choices.asPlayed.fixedLoc !== true) {
      const ok = itemLocations(s, it, f.obj).some((l) => l.z === loc.z
        && (l.z === 'base' ? l.p === (loc as typeof l).p : l.bf === (loc as typeof l).bf));
      if (!ok) return rollback(s, f, x, 'illegal');
    }
    const prog = spellProg(s, it);
    if (prog) {
      for (const ex of it.play.choices.executions) {
        const c = { controller: it.controller, source: null, slotLoc: slotLocsOf(s, ex), slotObjs: slotObjsOf(ex) };
        for (const slot of slotsOf(prog, ex.modes)) {
          if (slot.dest) continue;
          if ((ex.targets[slot.id] ?? []).some((t) => !stillLegal(s, t, slot, c))) return rollback(s, f, x, 'illegal');
        }
      }
    }
    if (!timingOk(s, it)) return rollback(s, f, x, 'illegal');
    return next(f);
  },

  // Step 6 [359]: finalize.
  (s, f, x) => {
    const it = itemOf(s, f);
    finalizeItem(s, x, it);                                          // [359.1]
    const p = it.controller;
    const card = s.objects[f.obj];
    const types = typesOf(card);
    // "The next unit you play this turn …": a token unit is played too [440.2.c] (Ekko, Boy Who Shattered Time).
    if (card.token && types.includes('unit')) {
      for (const e of playerEffects(s, p, 'grantAccelerate')) { useEffect(s, e.id); break; }
      for (const e of playerEffects(s, p, 'costLess')) {
        if (((e.spec as { types?: CardType[] }).types ?? []).includes('unit')) { useEffect(s, e.id); break; }
      }
    }
    if (!card.token) {
      // "The next spell you play this turn costs [5] less / deals 1 Bonus Damage": used up now.
      if (types.includes('spell')) for (const e of playerEffects(s, p, 'grantRepeat')) { useEffect(s, e.id); break; }
      if (types.includes('unit')) for (const e of playerEffects(s, p, 'grantAccelerate')) { useEffect(s, e.id); break; }
      for (const e of playerEffects(s, p, 'costLess')) {
        if (((e.spec as { types?: CardType[] }).types ?? []).some((t) => types.includes(t))) { useEffect(s, e.id); break; }
      }
      if (types.includes('spell')) {
        for (const e of playerEffects(s, p, 'nextSpellBonus')) {
          const n = (e.spec as { n?: number }).n ?? 1;
          const had = typeof it.play.choices.asPlayed.bonusDamage === 'number' ? it.play.choices.asPlayed.bonusDamage : 0;
          setField(s, it.play.choices.asPlayed, 'bonusDamage', had + n);
          useEffect(s, e.id);
        }
      }
    }
    if (!card.token) append(s, s.log.finalized, { p, card: card.card, isCard: true, types });   // [420.4.b]
    if (types.includes('spell')) {
      // What the spell chose: the turn log ("chose … this turn") and The Dreaming Tree.
      const chosen = [...new Set(it.play.choices.executions.flatMap((ex) => Object.values(ex.targets).flat())
        .flatMap((t) => (t.k === 'obj' && s.objects[t.id] ? [t.id] : [])))];
      for (const obj of chosen) append(s, s.log.targeted, { item: it.id, by: p, obj, spell: true, enemy: enemyThing(s, obj, p) });
      if (chosen.length > 0) fire(s, x, { e: 'chosen', p, objs: chosen, spell: true });
      requestCleanup(s);
      return 'done';                                                 // a spell waits on the chain [359.3]
    }
    // A permanent leaves the chain and enters the board at once [337.2], [359.2].
    let loc = it.play.choices.location!;
    // Baron Nashor: "As you play me, add the Baron Pit battlefield token to the board if it's not there already. If you
    // do, I enter there" [440.5], [369.3].
    for (const a of cardDef(card.def)?.abilities ?? []) {
      if (a.kind !== 'static' || a.spec.s !== 'addBfToken' || card.token) continue;
      const token = a.spec.token;
      if (s.bfs.some((b) => s.objects[b.obj]?.def === token)) continue;
      const bf = createBattlefield(s, { def: token, printing: null, owner: p });
      setField(s, s.objects[s.bfs[bf].obj], 'token', true);
      emit(s, x, { k: 'replaced', source: f.obj, event: `addBattlefield:${token}`, rule: '440.5' });
      loc = { z: 'bf', bf };
    }
    const unit = types.includes('unit');
    const origin = it.play.origin;
    const facts: PlayedRecord = { ...it.play.facts, ...(loc.z === 'bf' ? { to: loc } : {}),
      ...(origin.z === 'facedown' ? { fromFacedownAt: origin.bf } : {}) };
    const before = knowers(s, [f.obj]);
    const to = loc.z === 'base' ? Z.base(loc.p) : Z.bf(loc.bf);
    // A unit enters exhausted [359.2.c], [143.4]; gear ready [359.2.d];
    // unless something says otherwise ("I enter ready", Accelerate [805]).
    const exhausted = enteringExhausted(s, it, f.obj, unit, loc);
    const ov = overridesOf(it);
    // "It becomes a copy of that unit" [446]: a token keeps being a token [185.1.a], with the copied card's traits.
    if (ov.copyOf && card.token) setField(s, card, 'def', ov.copyOf);
    const chosenTag = it.play.choices.asPlayed.chosenTag;
    const namedCard = it.play.choices.asPlayed.namedCard;
    const obj = moveObject(s, f.obj, to, { controller: p, exhausted, carry: { played: facts, ...(ov.copyOf ? { copiedFrom: ov.copyOf } : {}),
      ...(typeof chosenTag === 'string' ? { named: { kind: 'tag' as const, value: chosenTag } } : {}),
      ...(typeof namedCard === 'string' ? { named: { kind: 'card' as const, value: namedCard } } : {}) } });
    if (ov.give && ov.give.length > 0) {
      for (const k of ov.give) addEffect(s, x, [obj], { s: 'keyword', kw: k.kw, value: k.value ?? 1 },
        { controller: p, source: obj, item: it.id, rule: '479.3', until: 'permanent' });
    }
    emitZone(s, x, { obj, prev: f.obj, from: { z: 'chain', item: it.id }, to, why: 'enter', rule: '359.2', before });
    emit(s, x, { k: 'enter', obj, at: loc, exhausted, rule: unit ? '359.2.c' : '359.2.d' });
    emit(s, x, { k: 'played', item: it.id, def: card.def, p, rule: '420.4.a' });
    const energy = card.token ? 0 : energyCostOf(card);
    append(s, s.log.played, {
      p, card: card.token ? null : card.card, def: card.def, isCard: !card.token, types, from: it.play.origin.z,
      ...(loc.z === 'bf' ? { to: loc } : {}), energySpent: facts.energySpent, powerSpent: facts.powerSpent, countered: false,
    });
    if (unit && loc.z === 'bf') applyContested(s, x, loc.bf, p);      // [190.3.a.1]
    removeItem(s, x, it.id);
    // Played [420.4.a]: its own Play Effects go on the chain after it has
    // entered [383.4.a.2], with the other "when you play" triggers.
    fire(s, x, { e: 'played', p, obj, def: card.def, isCard: !card.token, types, energy, ...(loc.z === 'bf' ? { to: loc } : {}),
      from: origin.z, spent: facts.energySpent });
    return 'done';
  },
];

defineSteps('play', STEPS);

/** An enemy unit or gear ("chosen enemy units and/or gear"). */
export const enemyThing = (s: GameState, id: ObjId, p: PlayerId) => {
  const o = s.objects[id];
  return o.controller !== null && o.controller !== p && (isType(o, 'unit') || isType(o, 'gear'));
};

/** Spends one use of a player effect (Last Caress's permission, Nami's next unit). */
function useEffect(s: GameState, id: number) {
  const e = s.effects.find((x) => x.id === id);
  if (!e) return;
  const spec = e.spec as { uses?: number };
  if (spec.uses === undefined) return;
  if (spec.uses <= 1) setField(s, s, 'effects', s.effects.filter((x) => x.id !== id));
  else setField(s, s, 'effects', s.effects.map((x) => (x.id === id ? { ...x, spec: { ...spec, uses: spec.uses! - 1 } } : x)));
}

/** Whether a permanent enters exhausted [359.2.c–d]: a unit does unless it
    enters ready by its own text ("I enter ready", conditions read now), a
    friendly static ("Other friendly units enter ready"), a player effect
    (Confront) or a paid Accelerate [805.2.b]; a gear doesn't unless "This
    enters exhausted" or the instruction says so. Uses up the effects the
    play consumed (Last Caress's permission). */
function enteringExhausted(s: GameState, it: ChainItem, obj: ObjId, unit: boolean, loc: Loc): boolean {
  const o = s.objects[obj];
  const p = it.controller;
  const ov = overridesOf(it);
  const types = typesOf(o);
  if (unit) {
    const any = playAnywhere(s, p, types);
    if (any) useEffect(s, any.id);
  }
  if (ov.exhausted) return true;
  if (ov.ready) return false;
  // "Your tokens enter ready" (Renata Glasc, Industrialist).
  if (o.token && staticsFor(s, null, 'tokensEnterReady').some(({ st }) => st.ctl === p)) return false;
  const facts = { ...it.play.facts, ...(loc.z === 'bf' ? { to: loc } : {}) };
  if (!unit) {
    return (cardDef(o.def)?.abilities ?? []).some((a) => a.kind === 'static' && a.spec.s === 'entersExhausted');
  }
  let ready = facts.paidOptional.some((k) => k.endsWith('#kw:accelerate')      // [805.2.b], or an Accelerate given to it (Rek'Sai)
    || (abilityById(k.split('@')[0]) as { accelerate?: true } | undefined)?.accelerate === true);
  for (const a of cardDef(o.def)?.abilities ?? []) {
    if (a.kind !== 'static' || a.spec.s !== 'entersReady' || a.spec.to) continue;
    if (!a.while || evalCond(s, a.while, { controller: p, source: obj, facts })) ready = true;
  }
  for (const { spec, st } of staticsFor(s, null, 'entersReady')) {   // Magma Wurm: "Other friendly units enter ready"
    if (spec.to && st.host !== obj && matchesEntering(s, spec.to, o, p, st.ctl, loc)) ready = true;
  }
  for (const e of s.effects) {                                       // Confront: "Units you play this turn enter ready"
    const spec = e.spec as { s?: string; types?: CardType[]; uses?: number } | null;
    if (spec?.s !== 'entersReady' || !('player' in e.affects) || e.affects.player !== p) continue;
    if (!(spec.types ?? []).some((t) => types.includes(t))) continue;
    ready = true;
    if (spec.uses !== undefined) useEffect(s, e.id);
  }
  return !ready;
}

/** Whether a card entering the board fits a static's selector (its kind,
    whose it is, its tags; not where it is, it isn't anywhere yet). */
function matchesEntering(s: GameState, sel: SelAst, o: GameObject, p: PlayerId, ctl: PlayerId, loc: Loc): boolean {
  if (sel.k === 'unit' && !isType(o, 'unit')) return false;
  // "Units you play to battlefields you control enter ready" (Riven, the Exile).
  if (sel.at === 'battlefield' && !(loc.z === 'bf' && s.bfs[loc.bf].controller === p)) return false;
  if (sel.rel === 'friendly' && !allied(s, p, ctl)) return false;
  if (sel.rel === 'enemy' && allied(s, p, ctl)) return false;
  return (sel.where ?? []).every((w) => w.p !== 'tag' || tagsOf(o).includes(w.tag));
}
