/*
 * Decisions and options (§4.2), and the option-key grammar (Appendix A).
 *
 * The engine always has at most one open question, a Decision, and its
 * option list is complete, finite and legal: it *is* the move generator for
 * the UI, the AI, the fuzzer and the tests (P2). Each option is named by a
 * short key ('play:41', 't:33', 'pass'). Records store keys, never indices,
 * so a replay survives a change in the order options are listed.
 *
 * A key names objects by ObjId, or by the alias the deciding player sees
 * for an object they don't know, so a key means the same thing in every
 * determinization of that player's view (§11.6).
 */
import { EngineError } from './errors.ts';
import type {
  DefId, ItemId, Json, Loc, ObjId, PaymentPlan, PlayerId, PowerReq, Zone,
} from '../state/types.ts';
import { copyJson } from '../state/clone.ts';

/** What a decision is about (§4.3). The kind, its ctx and how long the
    answer takes are visible to every player; the options are not. */
export type DecisionKind =
  | 'chosenChampion' | 'playOrder' | 'mulligan' | 'priority' | 'moveUnits' | 'moveDest' | 'hideWhere' | 'location'
  | 'optionalCost' | 'altCost' | 'showOff' | 'mode' | 'target' | 'requirementSet' | 'costOrder' | 'payment'
  | 'addAbility' | 'costObject' | 'may' | 'pickCard' | 'number' | 'split' | 'orderTriggers' | 'applyReplacement'
  | 'orderReplacements' | 'chooseBattlefield' | 'assignNext' | 'assignTier' | 'assignExcess'
  | 'damageReplacementOrder' | 'detachOrder' | 'recycleOrder' | 'predict' | 'name' | 'nthInstance'
  | 'chooseOpponent' | 'custom';

/** Structured prompt text, rendered by the UI: { t: 'chooseTarget',
    card: 'void-seeker', slot: 'a unit at a battlefield' }. */
export type Prompt = { t: string } & { [k: string]: Json };

export type Ref = { obj: ObjId } | { player: PlayerId } | { loc: Loc } | { item: ItemId } | { zone: Zone };

export interface OptionMeta {
  cost?: { energy: number; power: PowerReq[]; other: string[] };    // what a priority option would cost
  plan?: PaymentPlan;                                                // 'pay:*' options (§4.5)
  deflect?: number;                                                  // extra [A] this target adds [809]
  amount?: number;                                                   // damage this assignment step puts here
  timing?: 'default' | 'action' | 'reaction' | 'fromFacedown';      // why it is playable now (UI chip)
}

export interface Option {
  key: string;                    // grammar in Appendix A
  refs?: Ref[];                   // objects / players / zones / lanes the option is about (highlights, AI features)
  meta?: OptionMeta;
  ui?: true;                      // UI-only option ('back', 'manualPay'): agents and the fuzzer skip it
}

export interface Decision {
  id: number;                     // +1 per decision; a choice must name it
  player: PlayerId;               // who answers (a non-priority player for Limited choices [312.1.b.1])
  kind: DecisionKind;
  prompt: Prompt;
  options: Option[];              // complete, finite, legal and feasible (§4.6); canonical order
  ctx: { item?: ItemId; source?: ObjId; slot?: string; rule: string };   // rule: what the decision implements (P12)
  batch?: string;                 // consecutive decisions with the same batch id form one UI widget (§4.7)
  back?: boolean;                 // a 'back' option is present (UI only; undoes the play in progress)
  privateOptions: boolean;        // the option list depends on the decider's private information
  mustAsk?: boolean;              // never auto-applied (priority, may, yes/no …)
}

/** What every other player sees of a decision: that it exists, whose it
    is, its kind and ctx (§7.3). Never its options. */
export interface DecisionStub { player: PlayerId; kind: DecisionKind; ctx: Decision['ctx'] }

/** Why something can't be done right now, for UI tooltips (§12.7). */
export interface Reason { text: string; rule: string; refs?: Ref[] }

/** What a procedure asks: a Decision without its id, before the options
    are put in canonical order (core/frames.ts ask()). */
export interface AskSpec {
  player: PlayerId;
  kind: DecisionKind;
  prompt: Prompt;
  options: Option[];
  ctx: Decision['ctx'];
  batch?: string;
  /** Adds the UI-only 'back' option. */
  back?: boolean;
  privateOptions: boolean;
  mustAsk?: boolean;
}

// ---- the key grammar (Appendix A) ----
//
//   meta      pass | end | done | back | yes | no | decline | manualPay | first | second
//   priority  play:<obj> | act:<obj>#<n|kw> | move | hide:<obj>
//   choices   u:<obj> | loc:base | loc:bf<i> | bf<i> | t:<obj> | t:item<id> | t:p<pid> | mode:<n> | alt:<n>
//             req:<n> | ord:<n> | pay:<n> | pick:<obj|def> | keep:<obj> | set:<obj> | recycle:<obj> | n:<int> | p<pid>
//   combat    a:<obj> | x:<obj> | tank | backline
//   other     dmg:<obj> | next:<idx|obj> | inst:<n> | name:<value> | <handler>:<...>

/** Key builders, so no call site spells a key by hand. */
export const K = {
  pass: 'pass', end: 'end', done: 'done', back: 'back', yes: 'yes', no: 'no', decline: 'decline',
  manualPay: 'manualPay', first: 'first', second: 'second', move: 'move', tank: 'tank', backline: 'backline',
  locBase: 'loc:base',
  play: (obj: ObjId) => `play:${obj}`,
  act: (obj: ObjId, n: number | string) => `act:${obj}#${n}`,
  hide: (obj: ObjId) => `hide:${obj}`,
  u: (obj: ObjId) => `u:${obj}`,
  locBf: (bf: number) => `loc:bf${bf}`,
  bf: (bf: number) => `bf${bf}`,
  t: (obj: ObjId) => `t:${obj}`,
  tItem: (item: ItemId) => `t:item${item}`,
  tPlayer: (p: PlayerId) => `t:p${p}`,
  mode: (n: number) => `mode:${n}`,
  alt: (n: number) => `alt:${n}`,
  req: (n: number) => `req:${n}`,
  ord: (n: number) => `ord:${n}`,
  pay: (n: number) => `pay:${n}`,
  pick: (what: ObjId | DefId) => `pick:${what}`,
  keep: (obj: ObjId) => `keep:${obj}`,
  set: (obj: ObjId) => `set:${obj}`,
  recycle: (obj: ObjId) => `recycle:${obj}`,
  n: (n: number) => `n:${n}`,
  p: (p: PlayerId) => `p${p}`,
  a: (obj: ObjId) => `a:${obj}`,
  x: (obj: ObjId) => `x:${obj}`,
  dmg: (obj: ObjId) => `dmg:${obj}`,
  next: (idxOrObj: number) => `next:${idxOrObj}`,
  inst: (n: number) => `inst:${n}`,
  name: (value: string) => `name:${value}`,
} as const;

/**
 * A key taken apart. `head` is the part before the first ':' (or the bare
 * word, or 'bf' / 'p' for bf<i> / p<pid>); exactly one of the reference
 * fields is set when the key names something.
 */
export interface ParsedKey {
  head: string;
  obj?: ObjId;          // an object (or a negative alias)
  n?: number;           // a number: mode, plan, amount, battlefield index, player, order index
  item?: ItemId;        // t:item<id>
  player?: PlayerId;    // t:p<pid>
  loc?: 'base' | { bf: number };   // loc:base (the deciding player's base) / loc:bf<i>
  def?: DefId;          // pick:<def>
  sub?: string;         // act:<obj>#<sub>
  arg?: string;         // name:<value>, <handler>:<...>
}

const META = ['pass', 'end', 'done', 'back', 'yes', 'no', 'decline', 'manualPay', 'first', 'second', 'move', 'tank',
  'backline'];
const OBJ_HEADS = ['play', 'hide', 'u', 't', 'keep', 'set', 'recycle', 'a', 'x', 'dmg'];
const NUM_HEADS = ['mode', 'alt', 'req', 'ord', 'pay', 'n', 'inst', 'next'];
const INT = /^-?\d+$/;

/** Parses a key of the grammar, or returns null for a malformed one. */
export function parseKey(key: string): ParsedKey | null {
  if (META.includes(key)) return { head: key };
  let m = /^bf(\d+)$/.exec(key);
  if (m) return { head: 'bf', n: Number(m[1]) };
  m = /^p(\d+)$/.exec(key);
  if (m) return { head: 'p', n: Number(m[1]) };
  const colon = key.indexOf(':');
  if (colon <= 0) return null;
  const head = key.slice(0, colon), rest = key.slice(colon + 1);
  if (rest === '') return null;
  if (head === 'act') {
    m = /^(-?\d+)#(\w+)$/.exec(rest);
    return m ? { head, obj: Number(m[1]), sub: m[2] } : null;
  }
  if (head === 'loc') {
    if (rest === 'base') return { head, loc: 'base' };
    m = /^bf(\d+)$/.exec(rest);
    return m ? { head, loc: { bf: Number(m[1]) } } : null;
  }
  if (head === 't') {
    m = /^item(\d+)$/.exec(rest);
    if (m) return { head, item: Number(m[1]) };
    m = /^p(\d+)$/.exec(rest);
    if (m) return { head, player: Number(m[1]) as PlayerId };
  }
  if (head === 'pick') {
    if (INT.test(rest)) return { head, obj: Number(rest) };
    return /^[a-z0-9][a-z0-9-]*$/.test(rest) ? { head, def: rest } : null;
  }
  if (OBJ_HEADS.includes(head)) return INT.test(rest) ? { head, obj: Number(rest) } : null;
  if (NUM_HEADS.includes(head)) return INT.test(rest) ? { head, n: Number(rest) } : null;
  if (head === 'name') return { head, arg: rest };
  return /^[a-zA-Z]\w*$/.test(head) ? { head, arg: rest } : null;   // a tier-3 handler's own keys (§9.6)
}

export const isValidKey = (key: string) => parseKey(key) !== null;

// ---- canonical order ----

/** Kinds of option in the order they are listed: actions first, then
    choices, then the answers that close or leave a decision. */
const HEAD_ORDER = ['play', 'act', 'move', 'hide', 'u', 'loc', 'bf', 't', 'mode', 'alt', 'req', 'ord', 'pay', 'pick',
  'keep', 'set', 'recycle', 'n', 'p', 'a', 'x', 'tank', 'backline', 'dmg', 'next', 'inst', 'name', '*', 'first',
  'second', 'yes', 'no', 'done', 'decline', 'pass', 'end', 'manualPay', 'back'];

function rank(head: string) {
  const i = HEAD_ORDER.indexOf(head);
  return i >= 0 ? i : HEAD_ORDER.indexOf('*');
}

function sortKey(p: ParsedKey): [number, number] {
  if (p.obj !== undefined) return [0, p.obj];
  if (p.item !== undefined) return [1, p.item];
  if (p.player !== undefined) return [2, p.player];
  if (p.loc !== undefined) return [3, p.loc === 'base' ? -1 : p.loc.bf];
  if (p.n !== undefined) return [4, p.n];
  return [5, 0];
}

/** The fixed comparator of §4.2: kind, then the id or number, then the key
    itself (plain code-unit order, never locale order). */
export function compareKeys(a: string, b: string): number {
  const pa = parseKey(a), pb = parseKey(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  const r = rank(pa.head) - rank(pb.head);
  if (r !== 0) return r;
  const [ka, na] = sortKey(pa), [kb, nb] = sortKey(pb);
  if (ka !== kb) return ka - kb;
  if (na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The options in canonical order (a sorted copy). */
export function canonical(options: readonly Option[]): Option[] {
  return options.slice().sort((x, y) => compareKeys(x.key, y.key));
}

/** Throws unless the list is a valid option list: at least one option,
    every key well formed, no key twice. */
export function checkOptions(options: readonly Option[], what: string) {
  if (options.length === 0) throw new EngineError(`${what}: a decision needs at least one option`);
  const seen: string[] = [];
  for (const o of options) {
    if (!isValidKey(o.key)) throw new EngineError(`${what}: malformed option key '${o.key}'`);
    if (seen.includes(o.key)) throw new EngineError(`${what}: option '${o.key}' listed twice`);
    seen.push(o.key);
  }
}

/** Decisions that are asked even with a single option. */
const ALWAYS_ASK: readonly DecisionKind[] = ['priority', 'may', 'applyReplacement', 'optionalCost'];

/**
 * The key the engine answers on its own, or null when the player must be
 * asked (§4.2). Only a public decision with exactly one real option is
 * answered automatically: if a private one were, the other player would
 * learn something from it not being asked.
 */
export function autoKey(spec: AskSpec, options: readonly Option[]): string | null {
  if (spec.mustAsk || spec.privateOptions || ALWAYS_ASK.includes(spec.kind)) return null;
  const real = options.filter((o) => !o.ui);
  return real.length === 1 ? real[0].key : null;
}

export function stubOf(d: Decision): DecisionStub {
  return { player: d.player, kind: d.kind, ctx: copyJson(d.ctx) };
}
