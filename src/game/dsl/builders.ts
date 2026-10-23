/*
 * Builders for card definitions (§9.4): thin functions that return AST
 * nodes, so a definition reads close to its card text:
 *
 *   spell('supernova', text, { choose: [slot('a', unitSel())], body: [deal(10, ref.slot('a')), draw(2)] })
 *
 * They check shapes as the module loads (a slot an instruction names but
 * the program doesn't choose, a bound name never bound, an unknown token):
 * a typo fails the test run, not a game.
 */
import type {
  AbilityAst, ActivatedAst, CardDef, CondAst, CostAbilityAst, CostAst, InstrAst, KeywordAst, LocAst, ModeAst, MoveToAst,
  PlayerEffectAst, PredAst, ProgAst, RefAst, ReplacementAst, SelAst, SlotAst, StaticAbilityAst, StaticAst, TokenId, TriggerAst,
  TriggeredAst, Until, ValueAst,
} from './ast.ts';
import type { KeywordId } from '../state/types.ts';

const TOKENS: readonly TokenId[] = ['recruit', 'sprite', 'sandSoldier', 'mech', 'gold', 'reflection', 'bird', 'brush',
  'baronPit', 'tentacle', 'shadowClone', 'bomb'];

class DefError extends Error {}

type Ability = Omit<TriggeredAst, 'id'> | Omit<ActivatedAst, 'id'> | Omit<StaticAbilityAst, 'id'>
  | Omit<ReplacementAst, 'id'> | Omit<CostAbilityAst, 'id'>;

/** The names a program's instructions refer to are all defined in it. */
function checkProg(where: string, p: ProgAst) {
  const slots = new Set<string>();
  for (const s of p.choose ?? []) slots.add(s.id);
  const check = (top: InstrAst[], own: Set<string>) => {
    const bound = new Set<string>();
    const ids = new Set<string>();
    const refOk = (r: RefAst | SelAst) => {
      if (typeof r === 'object' && 'slot' in r && !own.has(r.slot)) throw new DefError(`${where}: no slot '${r.slot}'`);
      if (typeof r === 'object' && 'bound' in r && !bound.has(r.bound)) throw new DefError(`${where}: '${r.bound}' is not bound`);
      if (typeof r === 'object' && 'k' in r && typeof r.at === 'object' && !own.has(r.at.slot)) {
        throw new DefError(`${where}: no slot '${r.at.slot}'`);
      }
    };
    const valOk = (v: ValueAst) => {
      if (typeof v === 'object' && (v.v === 'might' || v.v === 'energyOf')) refOk(v.of);
    };
    const condOk = (c: CondAst) => {
      if (c.c === 'did' && !ids.has(c.instr)) throw new DefError(`${where}: no earlier instruction '${c.instr}'`);
      if (c.c === 'not') condOk(c.of);
      if (c.c === 'and' || c.c === 'or') c.of.forEach(condOk);
      if (c.c === 'is') refOk(c.ref);
    };
    const walk = (body: InstrAst[]) => {
      for (const i of body) {
        if (i.link !== undefined && !ids.has(i.link)) throw new DefError(`${where}: no earlier instruction '${i.link}'`);
        if (i.op === 'deal' || i.op === 'might' || i.op === 'baseMight' || i.op === 'grant') refOk(i.to);
        if ('n' in i && typeof i.n === 'object') valOk(i.n);
        if ('what' in i) refOk(i.what);
        if (i.op === 'draw' && i.from) refOk(i.from);
        if (i.op === 'draws' && i.who !== 'opponents') refOk(i.who.controllerOf);
        if (i.op === 'fight') { refOk(i.a); refOk(i.b); }
        if (i.op === 'dealFrom') { refOk(i.from); refOk(i.to); }
        if (i.op === 'attach') refOk(i.to);
        if (i.op === 'detach') refOk(i.from);
        if (i.op === 'move' && typeof i.to === 'object' && 'dest' in i.to && !own.has(i.to.dest)) {
          throw new DefError(`${where}: no destination slot '${i.to.dest}'`);
        }
        if (i.op === 'playToken' && !TOKENS.includes(i.token)) throw new DefError(`${where}: unknown token '${i.token}'`);
        if (i.op === 'pick' && !bound.has(i.from)) throw new DefError(`${where}: '${i.from}' is not bound`);
        if (i.op === 'recycleRest' && (!bound.has(i.from) || !bound.has(i.minus))) throw new DefError(`${where}: unbound name`);
        if (i.op === 'look' || i.op === 'pick' || i.op === 'revealTop') bound.add(i.bind);
        if (i.op === 'discard' && i.id !== undefined) bound.add(i.id);
        if (i.op === 'if') {
          condOk(i.cond);
          walk(i.then);
          walk(i.else ?? []);
        }
        if (i.op === 'may') walk(i.then);
        if (i.op === 'delayed') checkProg(`${where} (delayed)`, i.ability.effect);
        if (i.id !== undefined) ids.add(i.id);
      }
    };
    walk(top);
  };
  check(p.body, slots);
  for (const m of p.modes?.of ?? []) {
    const own = new Set(slots);
    for (const s of m.choose ?? []) own.add(s.id);
    check(m.body, own);
  }
}

function card(id: string, text: string, o: { kw?: KeywordAst[]; abilities?: Ability[]; spell?: ProgAst; missing?: string[] }):
  CardDef {
  for (const a of o.abilities ?? []) {
    if (a.kind !== 'triggered' && a.kind !== 'activated') continue;
    for (const sl of [...(a.effect.choose ?? []), ...(a.effect.modes?.of ?? []).flatMap((m) => m.choose ?? [])]) {
      if (sl.dest && ![...(a.effect.choose ?? []), ...(a.effect.modes?.of ?? []).flatMap((m) => m.choose ?? [])].some((x) => x.id === sl.dest!.of)) {
        throw new DefError(`${id}: destination slot '${sl.id}' moves an unknown slot`);
      }
    }
  }
  const abilities: AbilityAst[] = (o.abilities ?? []).map((a, n) => ({ ...a, id: `${id}#${n}` }) as AbilityAst);
  for (const a of abilities) if (a.kind === 'triggered' || a.kind === 'activated') checkProg(a.id, a.effect);
  if (o.spell) checkProg(id, o.spell);
  const def: CardDef = { id, text, keywords: o.kw ?? [], abilities };
  if (o.spell) def.spell = o.spell;
  if (o.missing && o.missing.length > 0) def.missing = o.missing;
  return def;
}

export const unit = (id: string, text: string, o: { kw?: KeywordAst[]; abilities?: Ability[]; missing?: string[] } = {}) =>
  card(id, text, o);
export const gear = unit;
export const legend = (id: string, text: string, abilities: Ability[]) => card(id, text, { abilities });
export const battlefield = (id: string, text: string, abilities: Ability[]) => card(id, text, { abilities });
export const spell = (id: string, text: string, o: ProgAst & { kw?: KeywordAst[]; abilities?: Ability[]; missing?: string[] }) => {
  const { kw, abilities, missing, ...prog } = o;
  return card(id, text, { kw, spell: prog, abilities, missing });
};

// ---- abilities ----

export const onPlay = (effect: ProgAst, o: { may?: true; cost?: CostAst; if?: CondAst } = {}): Ability =>
  ({ kind: 'triggered', when: { on: 'played', who: 'self' }, effect, ...o });
export const when = (trigger: TriggerAst, effect: ProgAst,
  o: { may?: true; cost?: CostAst; controller?: 'source' | 'eventPlayer'; limit?: { n: number; per: 'turn' };
    activeIn?: ('trash' | 'hand')[]; if?: CondAst; effectText?: true; first?: 'turn' } = {}): Ability =>
  ({ kind: 'triggered', when: trigger, effect, ...o });
/** "[Deathknell][>] …": "When I die, …" with self-leave timing [808.1.c]. */
export const deathknell = (effect: ProgAst, o: { effectText?: true } = {}): Ability =>
  ({ kind: 'triggered', when: { on: 'dies', who: 'self' }, effect, ...o });
/** A static ability on its source [365]: "I have +N [M]" (layer 4). */
export const statik = (n: ValueAst, o: { while?: CondAst; effectText?: true } = {}): Ability =>
  ({ kind: 'static', spec: { s: 'might', n }, ...o });
/** Any static ability [365]: `o.effectText` for an Equipment's effect text [718.3]. */
export const always = (spec: StaticAst, o: { while?: CondAst; effectText?: true; grantedOnly?: true } = {}): Ability =>
  ({ kind: 'static', spec, ...o });
/** "Other friendly units have +1 [M] here", "Units here have +1 [M]". */
export const mightTo = (n: ValueAst, to: SelAst, o: { while?: CondAst } = {}): Ability =>
  ({ kind: 'static', spec: { s: 'might', n, to }, ...o });
/** "Your Mechs have [Shield]"; without `to`, "I have [Ganking]". */
export const keywordTo = (k: KeywordAst, to?: SelAst, o: { while?: CondAst; effectText?: true } = {}): Ability =>
  ({ kind: 'static', spec: to ? { s: 'keyword', kw: k, to } : { s: 'keyword', kw: k }, ...o });
/** "I enter ready" [359.2.c], under a condition if given. */
export const entersReady = (o: { while?: CondAst } = {}): Ability => ({ kind: 'static', spec: { s: 'entersReady' }, ...o });
export const replacement = (r: Omit<ReplacementAst, 'id' | 'kind'>): Ability => ({ kind: 'replacement', ...r });
export const costAbility = (c: Omit<CostAbilityAst, 'id' | 'kind'>): Ability => ({ kind: 'cost', ...c });
export const activated = (cost: CostAst, effect: ProgAst, o: { timing?: 'action' | 'reaction'; while?: CondAst; isAdd?: true;
  grantedOnly?: true; modesOncePerTurn?: true } = {}): Ability =>
  ({ kind: 'activated', cost, effect, ...o });

// ---- programs, slots, selectors ----

export const prog = (body: InstrAst[], choose?: SlotAst[]): ProgAst => (choose ? { choose, body } : { body });
export const modal = (pick: number, of: ModeAst[], choose?: SlotAst[], body: InstrAst[] = []): ProgAst =>
  (choose ? { choose, modes: { pick, of }, body } : { modes: { pick, of }, body });
export const mode = (label: string, body: InstrAst[], choose?: SlotAst[]): ModeAst =>
  (choose ? { label, choose, body } : { label, body });
export const slot = (id: string, sel: SelAst | SelAst[], o: { min?: number; max?: number; harm?: boolean;
  distinctFrom?: string[]; freeFromHidden?: true; if?: CondAst } = {}): SlotAst =>
  ({ id, sel: Array.isArray(sel) ? sel : [sel], ...o });
export const unitSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'unit', ...o });
export const cardSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'card', in: 'trash', ...o });
export const spellSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'spell', ...o });
export const facedownSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'facedown', ...o });
export const legendSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'legend', ...o });
export const gearSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'gear', ...o });
export const permanentSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'permanent', ...o });
export const bfSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'battlefield', ...o });
/** A destination slot for the units another slot chose [355.4]. */
export const destSlot = (id: string, of: string, to: 'base' | 'bf' | 'open' | 'any' = 'any', o: { min?: number } = {}): SlotAst =>
  ({ id, sel: [], dest: { of, to }, ...o });
export const runeSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'rune', ...o });
export const pred = {
  might: (op: '<' | '<=' | '=' | '>=' | '>', n: number): PredAst => ({ p: 'might', op, n }),
  energyCost: (op: '<' | '<=' | '=' | '>=' | '>', n: number): PredAst => ({ p: 'energyCost', op, n }),
  exhausted: { p: 'exhausted' } as PredAst,
  ready: { p: 'ready' } as PredAst,
  nonToken: { p: 'nonToken' } as PredAst,
  token: { p: 'token' } as PredAst,
  buffed: { p: 'buffed' } as PredAst,
  stunned: { p: 'stunned' } as PredAst,
  mighty: { p: 'mighty' } as PredAst,
  equipped: { p: 'equipped' } as PredAst,
  attached: { p: 'attached' } as PredAst,
  moved: { p: 'movedThisTurn' } as PredAst,
  alone: { p: 'alone' } as PredAst,
  oneOnOne: { p: 'oneOnOne' } as PredAst,
  inCombat: { p: 'inCombat' } as PredAst,
  open: { p: 'open' } as PredAst,
  notSubject: { p: 'notSubject' } as PredAst,
  attacking: { p: 'designation', d: 'attacker' } as PredAst,
  defending: { p: 'designation', d: 'defender' } as PredAst,
  attackingWithOther: { p: 'attackingWithOther' } as PredAst,
  tag: (tag: string): PredAst => ({ p: 'tag', tag }),
  type: (...any: import('../state/types.ts').CardType[]): PredAst => ({ p: 'type', any }),
  keyword: (kw: KeywordId): PredAst => ({ p: 'keyword', kw }),
  not: (of: PredAst): PredAst => ({ p: 'not', of }),
};
export const cond = {
  showedOff: { c: 'showedOff' } as CondAst,
  did: (instr: string): CondAst => ({ c: 'did', instr }),
  not: (of: CondAst): CondAst => ({ c: 'not', of }),
  and: (...of: CondAst[]): CondAst => ({ c: 'and', of }),
  yourTurn: { c: 'yourTurn' } as CondAst,
  selfAt: (at: 'battlefield' | 'base'): CondAst => ({ c: 'selfAt', at }),
  count: (of: SelAst, op: '<' | '<=' | '=' | '>=' | '>', n: number): CondAst => ({ c: 'count', of, op, n }),
  or: (...of: CondAst[]): CondAst => ({ c: 'or', of }),
  legion: { c: 'legion' } as CondAst,
  level: (n: number): CondAst => ({ c: 'xp', n }),
  playedFrom: (z: 'hand' | 'facedown'): CondAst => ({ c: 'playedFrom', z }),
  playedToBf: { c: 'playedTo', z: 'bf' } as CondAst,
  paid: (ability: string): CondAst => ({ c: 'paid', ability }),
  is: (r: RefAst, p: PredAst): CondAst => ({ c: 'is', ref: r, pred: p }),
  self: (p: PredAst): CondAst => ({ c: 'is', ref: 'self', pred: p }),
  thisTurn: (what: 'discarded' | 'unitDied' | 'playedToBf' | 'finalized', o: { types?: import('../state/types.ts').CardType[];
    op?: '<' | '<=' | '=' | '>=' | '>'; n?: number } = {}): CondAst => ({ c: 'thisTurn', what, ...o }),
  excess: (n: number): CondAst => ({ c: 'excess', n }),
  info: (key: string, eq: import('../state/types.ts').Json): CondAst => ({ c: 'info', key, eq }),
  handSize: (op: '<' | '<=' | '=' | '>=' | '>', n: number): CondAst => ({ c: 'handSize', op, n }),
  lki: (p: PredAst): CondAst => ({ c: 'lki', pred: p }),
};
export const ref = {
  self: 'self' as RefAst,
  slot: (id: string): RefAst => ({ slot: id }),
  bound: (name: string): RefAst => ({ bound: name }),
  subject: { event: 'subject' } as RefAst,
  info: (key: string): RefAst => ({ info: key }),
};
export const val = {
  count: (of: SelAst): ValueAst => ({ v: 'count', of }),
  info: (key: string): ValueAst => ({ v: 'info', key }),
  shownPower: { v: 'shownPower' } as ValueAst,
  might: (of: RefAst): ValueAst => ({ v: 'might', of }),
  energyOf: (of: RefAst): ValueAst => ({ v: 'energyOf', of }),
  sum: (...of: ValueAst[]): ValueAst => ({ v: 'sum', of }),
};

// ---- instructions ----

export const deal = (n: ValueAst, to: RefAst | SelAst): InstrAst => ({ op: 'deal', n, to });
export const draw = (n: ValueAst, from?: RefAst): InstrAst => (from ? { op: 'draw', n, from } : { op: 'draw', n });
export const banish = (what: RefAst | SelAst): InstrAst => ({ op: 'banish', what });
export const kill = (what: RefAst | SelAst): InstrAst => ({ op: 'kill', what });
export const stun = (what: RefAst | SelAst): InstrAst => ({ op: 'stun', what });
export const buff = (what: RefAst | SelAst): InstrAst => ({ op: 'buff', what });
export const ready = (what: RefAst | SelAst): InstrAst => ({ op: 'ready', what });
export const burn = (n: number): InstrAst => ({ op: 'burn', n });
export const might = (n: ValueAst, to: RefAst | SelAst, sign: 1 | -1 = 1, o: { until?: Until; floor?: number } = {}): InstrAst =>
  ({ op: 'might', n, sign, to, until: o.until ?? 'thisTurn', ...(o.floor !== undefined ? { floor: o.floor } : {}) });
export const playToken = (token: TokenId, n: number, at: LocAst, o: { ready?: true; exhausted?: true } = {}): InstrAst =>
  ({ op: 'playToken', token, n, at, ...o });
export const predict = (n: ValueAst = 1): InstrAst => ({ op: 'predict', n });
export const baseMight = (n: ValueAst, to: RefAst | SelAst): InstrAst => ({ op: 'baseMight', n, to, until: 'thisTurn' });
export const grant = (k: KeywordAst, to: RefAst | SelAst, until: Until = 'thisTurn'): InstrAst => ({ op: 'grant', kw: k, to, until });
export const iff = (c: CondAst, then: InstrAst[], otherwise?: InstrAst[]): InstrAst =>
  (otherwise ? { op: 'if', cond: c, then, else: otherwise } : { op: 'if', cond: c, then });
/** A delayed triggered ability for the rest of this turn, `uses` times [390–393]. */
export const delayed = (uses: number, trigger: TriggerAst, effect: ProgAst,
  o: { capture?: Record<string, RefAst | 'eventBf' | 'hereBf'>; may?: true } = {}): InstrAst =>
  ({ op: 'delayed', uses, ability: { kind: 'triggered', when: trigger, effect, ...(o.may ? { may: true as const } : {}) },
    ...(o.capture ? { capture: o.capture } : {}) });
export const draws = (n: number, controllerOf: RefAst): InstrAst => ({ op: 'draws', n, who: { controllerOf } });
/** Names an instruction ("if you do", links). */
export const named = (id: string, i: InstrAst): InstrAst => ({ ...i, id });
/** An instruction linked to an earlier one [359.3.e.14.a]. */
export const linked = (to: string, i: InstrAst): InstrAst => ({ ...i, link: to });
export const look = (n: number, bind: string): InstrAst => ({ op: 'look', n, bind });
export const pick = (from: string, n: number, bind: string): InstrAst => ({ op: 'pick', from, n, bind });
export const recycleRest = (from: string, minus: string): InstrAst => ({ op: 'recycleRest', from, minus });
export const discard = (n: number): InstrAst => ({ op: 'discard', n });
export const channel = (n: number, o: { exhausted?: true } = {}): InstrAst => ({ op: 'channel', n, ...o });
export const playSelf = (cost: CostAst): InstrAst => ({ op: 'playSelf', cost });
export const playCard = (what: RefAst, energyLess?: ValueAst): InstrAst =>
  (energyLess === undefined ? { op: 'playCard', what } : { op: 'playCard', what, energyLess });
export const move = (what: RefAst | SelAst, to: MoveToAst): InstrAst => ({ op: 'move', what, to });
export const returnToHand = (what: RefAst): InstrAst => ({ op: 'returnToHand', what });
export const recycle = (what: RefAst): InstrAst => ({ op: 'recycle', what });
export const counter = (what: RefAst): InstrAst => ({ op: 'counter', what });
export const fight = (a: RefAst, b: RefAst): InstrAst => ({ op: 'fight', a, b });
export const dealFrom = (from: RefAst, to: RefAst): InstrAst => ({ op: 'dealFrom', from, to });
export const double = (what: RefAst, until: Until = 'thisTurn'): InstrAst => ({ op: 'double', what, until });
export const mill = (n: number): InstrAst => ({ op: 'mill', n });
export const revealTop = (bind: string): InstrAst => ({ op: 'revealTop', bind });
export const toHand = (what: RefAst): InstrAst => ({ op: 'toHand', what });
export const gainXp = (n: ValueAst): InstrAst => ({ op: 'gainXp', n });
export const addPower = (n: number): InstrAst => ({ op: 'add', power: n });
export const addEnergy = (n: number, onlyFor?: 'spells'): InstrAst => (onlyFor ? { op: 'add', energy: n, onlyFor } : { op: 'add', energy: n });
export const win: InstrAst = { op: 'win' };
export const points = (n: number): InstrAst => ({ op: 'points', n });
export const attach = (what: RefAst, to: RefAst): InstrAst => ({ op: 'attach', what, to });
export const detach = (from: RefAst): InstrAst => ({ op: 'detach', from });
export const spendBuff = (from: SelAst): InstrAst => ({ op: 'spendBuff', from });
export const eachPlayerKills = (n = 1): InstrAst => ({ op: 'eachPlayerKills', n });
export const pay = (cost: CostAst): InstrAst => ({ op: 'pay', cost });
export const may = (then: InstrAst[]): InstrAst => ({ op: 'may', then });
export const playerEffect = (spec: PlayerEffectAst): InstrAst => ({ op: 'playerEffect', spec, until: 'thisTurn' });
export const replaceDeath = (what: RefAst): InstrAst => ({ op: 'replaceDeath', what });
export const cantMove = (what: RefAst): InstrAst => ({ op: 'cantMove', what });
export const opponentsDraw = (n: number): InstrAst => ({ op: 'draws', n, who: 'opponents' });

export const kw = {
  tank: (): KeywordAst => ({ kw: 'tank' }),
  reaction: (): KeywordAst => ({ kw: 'reaction' }),
  action: (): KeywordAst => ({ kw: 'action' }),
  deploy: (): KeywordAst => ({ kw: 'deploy' }),
  disarm: (value = 1): KeywordAst => ({ kw: 'disarm', value }),
  deflect: (value = 1): KeywordAst => ({ kw: 'deflect', value }),
  shield: (value = 1): KeywordAst => ({ kw: 'shield', value }),
  assault: (value = 1): KeywordAst => ({ kw: 'assault', value }),
  showOff: (o: { minEnergy?: number; withKeyword?: KeywordId } = {}): KeywordAst => ({ kw: 'showOff', showOff: o }),
  ganking: (): KeywordAst => ({ kw: 'ganking' }),
  temporary: (): KeywordAst => ({ kw: 'temporary' }),
  vision: (): KeywordAst => ({ kw: 'vision' }),
  hidden: (): KeywordAst => ({ kw: 'hidden' }),
  backline: (): KeywordAst => ({ kw: 'backline' }),
  equip: (o: { lessBy?: ValueAst } = {}): KeywordAst => (o.lessBy ? { kw: 'equip', equipLessBy: o.lessBy } : { kw: 'equip' }),
};
