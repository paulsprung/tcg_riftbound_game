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
      if (typeof r === 'object' && 'k' in r && typeof r.at === 'object' && !own.has(r.at.slot.replace(/^was:/, ''))) {
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
        if (i.op === 'draws' && typeof i.who === 'object') refOk(i.who.controllerOf);
        if (i.op === 'fight') { refOk(i.a); refOk(i.b); }
        if (i.op === 'dealSplit' && i.from) refOk(i.from);
        if (i.op === 'playToken' && i.copyOf) refOk(i.copyOf);
        if ((i.op === 'replay' || i.op === 'playerEffect') && typeof i.who === 'object') refOk(i.who.controllerOf);
        if (i.op === 'dealFrom') { refOk(i.from); refOk(i.to); }
        if (i.op === 'attach') refOk(i.to);
        if (i.op === 'detach') refOk(i.from);
        if (i.op === 'move' && typeof i.to === 'object' && 'dest' in i.to && !own.has(i.to.dest)) {
          throw new DefError(`${where}: no destination slot '${i.to.dest}'`);
        }
        if (i.op === 'playToken' && !TOKENS.includes(i.token)) throw new DefError(`${where}: unknown token '${i.token}'`);
        if (i.op === 'pick' && !bound.has(i.from)) throw new DefError(`${where}: '${i.from}' is not bound`);
        if (i.op === 'recycleRest' && (!bound.has(i.from) || !bound.has(i.minus))) throw new DefError(`${where}: unbound name`);
        if (i.op === 'look' || i.op === 'pick' || i.op === 'revealTop' || i.op === 'choose' || i.op === 'revealRune'
          || i.op === 'payX' || i.op === 'banishTop') bound.add(i.bind);
        if (i.op === 'revealUntil') { bound.add(i.bind); bound.add(i.rest); }
        if ((i.op === 'discard' || i.op === 'banish' || i.op === 'gainControl') && i.id !== undefined) bound.add(i.id);
        if (i.op === 'forEach') walk(i.body);
        if (i.op === 'choiceBy') for (const m of i.modes) walk(m.body);
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
    activeIn?: ('trash' | 'hand' | 'deck')[]; if?: CondAst; effectText?: true; first?: 'turn'; modesOncePerTurn?: true } = {}): Ability =>
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
  grantedOnly?: true; modesOncePerTurn?: true; limit?: { n: number; per: 'turn' }; anyPlayer?: true } = {}): Ability =>
  ({ kind: 'activated', cost, effect, ...o });

// ---- programs, slots, selectors ----

export const prog = (body: InstrAst[], choose?: SlotAst[]): ProgAst => (choose ? { choose, body } : { body });
export const modal = (pick: number, of: ModeAst[], choose?: SlotAst[], body: InstrAst[] = []): ProgAst =>
  (choose ? { choose, modes: { pick, of }, body } : { modes: { pick, of }, body });
export const mode = (label: string, body: InstrAst[], choose?: SlotAst[]): ModeAst =>
  (choose ? { label, choose, body } : { label, body });
export const slot = (id: string, sel: SelAst | SelAst[], o: { min?: number; max?: number; harm?: boolean;
  distinctFrom?: string[]; freeFromHidden?: true; if?: CondAst; sumMightMax?: number } = {}): SlotAst =>
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
export const destSlot = (id: string, of: string, to: 'base' | 'bf' | 'open' | 'any' | 'toOrFromBase' | 'withFriends' | 'controlled' | 'occupiedEnemy' = 'any',
  o: { min?: number } = {}): SlotAst =>
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
  occupied: { p: 'occupied' } as PredAst,
  notSubject: { p: 'notSubject' } as PredAst,
  attacking: { p: 'designation', d: 'attacker' } as PredAst,
  defending: { p: 'designation', d: 'defender' } as PredAst,
  attackingWithOther: { p: 'attackingWithOther' } as PredAst,
  damaged: { p: 'damaged' } as PredAst,
  inZone: (z: 'deck' | 'hand' | 'trash' | 'banish'): PredAst => ({ p: 'inZone', z }),
  friendly: { p: 'rel', rel: 'friendly' } as PredAst,
  enemy: { p: 'rel', rel: 'enemy' } as PredAst,
  moves: (n: number): PredAst => ({ p: 'moves', n }),
  name: (name: string): PredAst => ({ p: 'name', name }),
  atEventBf: { p: 'atEventBf' } as PredAst,
  choosesFriendly: { p: 'choosesFriendly' } as PredAst,
  powerCost: (op: '<' | '<=' | '=' | '>=' | '>', n: number): PredAst => ({ p: 'powerCost', op, n }),
  energyCostVsPoints: (op: '<' | '<=' | '=' | '>=' | '>'): PredAst => ({ p: 'energyCostVsPoints', op }),
  tag: (tag: string): PredAst => ({ p: 'tag', tag }),
  type: (...any: import('../state/types.ts').CardType[]): PredAst => ({ p: 'type', any }),
  keyword: (kw: KeywordId): PredAst => ({ p: 'keyword', kw }),
  not: (of: PredAst): PredAst => ({ p: 'not', of }),
  mightVsSource: (op: '<' | '<=' | '=' | '>=' | '>'): PredAst => ({ p: 'mightVsSource', op }),
  notSlot: (slot: string): PredAst => ({ p: 'notSlot', slot }),
  anyTag: (...tags: string[]): PredAst => ({ p: 'anyTag', tags }),
  enemyMightBelowSource: { p: 'enemyMightBelowSource' } as PredAst,
  costAtMostPaid: { p: 'costAtMostPaid' } as PredAst,
  unitsHere: (rel: 'friendly' | 'enemy'): PredAst => ({ p: 'unitsHere', rel }),
  mightVsSlot: (slot: string, op: '<' | '<=' | '=' | '>=' | '>'): PredAst => ({ p: 'mightVsSlot', slot, op }),
  notAtSlot: (slot: string): PredAst => ({ p: 'notAtSlot', slot }),
  choosesOnly: (slot: string): PredAst => ({ p: 'choosesOnly', slot }),
  namedTag: { p: 'namedTag' } as PredAst,
  empowered: { p: 'empowered' } as PredAst,
  minMoves: (n: number): PredAst => ({ p: 'minMoves', n }),
  champion: { p: 'champion' } as PredAst,
  ownedByYou: { p: 'ownedByYou' } as PredAst,
  mightiest: { p: 'mightiest' } as PredAst,
  damagedThisTurn: { p: 'damagedThisTurn' } as PredAst,
  inShowdown: { p: 'inShowdown' } as PredAst,
  atMoveEnds: { p: 'atMoveEnds' } as PredAst,
};
/** The four tags of Ivern's friends. */
export const PETS = ['Bird', 'Cat', 'Dog', 'Poro'];
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
  thisTurn: (what: 'discarded' | 'unitDied' | 'playedToBf' | 'finalized' | 'played', o: { types?: import('../state/types.ts').CardType[];
    op?: '<' | '<=' | '=' | '>=' | '>'; n?: number; rel?: 'friendly' | 'enemy'; tag?: string; minSpent?: number; yourBeginning?: true } = {}): CondAst =>
    ({ c: 'thisTurn', what, ...o }),
  opponentNearWin: (within = 3): CondAst => ({ c: 'opponentNearWin', within }),
  firstBeginning: { c: 'firstBeginning' } as CondAst,
  full: (instr: string): CondAst => ({ c: 'full', instr }),
  excess: (n: number): CondAst => ({ c: 'excess', n }),
  info: (key: string, eq: import('../state/types.ts').Json): CondAst => ({ c: 'info', key, eq }),
  handSize: (op: '<' | '<=' | '=' | '>=' | '>', n: number): CondAst => ({ c: 'handSize', op, n }),
  lki: (p: PredAst): CondAst => ({ c: 'lki', pred: p }),
  lkiAtBf: { c: 'lkiAtBf' } as CondAst,
  controlsSelf: { c: 'controlsSelf' } as CondAst,
  notFromHand: { c: 'notFromHand' } as CondAst,
  attachedThisTurn: { c: 'attachedThisTurn' } as CondAst,
  chosenEnemies: (n: number): CondAst => ({ c: 'chosenEnemies', n }),
  powerSpent: (n: number): CondAst => ({ c: 'powerSpent', n }),
  nearWin: (within = 3): CondAst => ({ c: 'nearWin', within }),
  boundDomain: (name: string, d: import('../state/types.ts').Domain): CondAst => ({ c: 'boundDomain', name, d }),
  val: (v: ValueAst, op: '<' | '<=' | '=' | '>=' | '>', n: number): CondAst => ({ c: 'val', v, op, n }),
  scoredThisTurn: (how: 'conquer' | 'hold'): CondAst => ({ c: 'scoredThisTurn', how }),
  tags: (tags: string[], n: number = tags.length): CondAst => ({ c: 'tags', tags, n }),
  showdown: { c: 'showdown' } as CondAst,
  yourBeginning: { c: 'phase', phase: 'beginning', yours: true } as CondAst,
  xpGained: { c: 'xpGained' } as CondAst,
  selfInShowdown: { c: 'selfInShowdown' } as CondAst,
  origin: (z: 'trash' | 'hand' | 'banish'): CondAst => ({ c: 'origin', z }),
  controlsHere: { c: 'controlsHere' } as CondAst,
  runeDeck: (op: '<' | '<=' | '=' | '>=' | '>', n: number): CondAst => ({ c: 'runeDeck', op, n }),
};
export const ref = {
  self: 'self' as RefAst,
  slot: (id: string): RefAst => ({ slot: id }),
  bound: (name: string): RefAst => ({ bound: name }),
  subject: { event: 'subject' } as RefAst,
  info: (key: string): RefAst => ({ info: key }),
  /** The card that object was, wherever it is now. */
  now: (r: RefAst): RefAst => ({ now: r }),
  /** The card whose text it is (an Equipment, not its unit). */
  this: 'this' as RefAst,
  paid: (what: 'exhaust' | 'kill'): RefAst => ({ paid: what }),
};
export const val = {
  count: (of: SelAst): ValueAst => ({ v: 'count', of }),
  info: (key: string): ValueAst => ({ v: 'info', key }),
  shownPower: { v: 'shownPower' } as ValueAst,
  might: (of: RefAst): ValueAst => ({ v: 'might', of }),
  energyOf: (of: RefAst): ValueAst => ({ v: 'energyOf', of }),
  sum: (...of: ValueAst[]): ValueAst => ({ v: 'sum', of }),
  points: { v: 'points' } as ValueAst,
  diff: (a: ValueAst, b: ValueAst): ValueAst => ({ v: 'diff', a, b }),
  maxMight: (of: SelAst): ValueAst => ({ v: 'maxMight', of }),
  countBound: (name: string): ValueAst => ({ v: 'countBound', name }),
  x: (name: string): ValueAst => ({ v: 'x', name }),
  excess: { v: 'excess' } as ValueAst,
  playedThisTurn: { v: 'playedThisTurn' } as ValueAst,
  holdPoints: { v: 'holdPoints' } as ValueAst,
  tagsAmong: (tags: string[]): ValueAst => ({ v: 'tagsAmong', tags }),
  sumMight: (of: SelAst): ValueAst => ({ v: 'sumMight', of }),
  cardDeals: { v: 'cardDeals' } as ValueAst,
  conquered: { v: 'conquered' } as ValueAst,
  kwOf: (of: RefAst, k: KeywordId): ValueAst => ({ v: 'kwOf', of, kw: k }),
  minEnergyBound: (name: string): ValueAst => ({ v: 'minEnergyBound', name }),
  shownMight: { v: 'shownMight' } as ValueAst,
  paidEnergy: { v: 'paidEnergy' } as ValueAst,
  if: (c: CondAst, then: ValueAst, otherwise: ValueAst): ValueAst => ({ v: 'if', cond: c, then, else: otherwise }),
  xCost: { v: 'xCost' } as ValueAst,
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
export const playToken = (token: TokenId, n: ValueAst, at: LocAst, o: { ready?: true; exhausted?: true; caster?: true; readyFirst?: number;
  copyOf?: RefAst; give?: KeywordAst[] } = {}):
  InstrAst => ({ op: 'playToken', token, n, at, ...o });
/** "Play a Gold gear token exhausted." */
export const gold = (n: ValueAst = 1, o: { caster?: true } = {}): InstrAst => playToken('gold', n, 'yourBase', { exhausted: true, ...o });
export const heal = (what: RefAst | SelAst): InstrAst => ({ op: 'heal', what });
/** "[Add] [R]": one Power of a domain. */
export const addDomain = (domain: import('../state/types.ts').Domain, n = 1): InstrAst => ({ op: 'add', power: n, domain });
export const predict = (n: ValueAst = 1): InstrAst => ({ op: 'predict', n });
export const baseMight = (n: ValueAst, to: RefAst | SelAst): InstrAst => ({ op: 'baseMight', n, to, until: 'thisTurn' });
export const grant = (k: KeywordAst, to: RefAst | SelAst, until: Until = 'thisTurn', n?: ValueAst): InstrAst =>
  (n === undefined ? { op: 'grant', kw: k, to, until } : { op: 'grant', kw: k, to, until, n });
export const iff = (c: CondAst, then: InstrAst[], otherwise?: InstrAst[]): InstrAst =>
  (otherwise ? { op: 'if', cond: c, then, else: otherwise } : { op: 'if', cond: c, then });
/** A delayed triggered ability for the rest of this turn, `uses` times [390–393]. */
export const delayed = (uses: number, trigger: TriggerAst, effect: ProgAst,
  o: { capture?: Record<string, RefAst | 'eventBf' | 'hereBf'>; may?: true; lasting?: true; captureN?: Record<string, ValueAst> } = {}): InstrAst =>
  ({ op: 'delayed', uses, ability: { kind: 'triggered', when: trigger, effect, ...(o.may ? { may: true as const } : {}) },
    ...(o.capture ? { capture: o.capture } : {}), ...(o.lasting ? { lasting: true as const } : {}), ...(o.captureN ? { captureN: o.captureN } : {}) });
export const draws = (n: number, controllerOf: RefAst): InstrAst => ({ op: 'draws', n, who: { controllerOf } });
/** Names an instruction ("if you do", links). */
export const named = (id: string, i: InstrAst): InstrAst => ({ ...i, id });
/** An instruction linked to an earlier one [359.3.e.14.a]. */
export const linked = (to: string, i: InstrAst): InstrAst => ({ ...i, link: to });
export const look = (n: number, bind: string): InstrAst => ({ op: 'look', n, bind });
export const pick = (from: string, n: number, bind: string): InstrAst => ({ op: 'pick', from, n, bind });
export const recycleRest = (from: string, minus: string): InstrAst => ({ op: 'recycleRest', from, minus });
export const discard = (n: number): InstrAst => ({ op: 'discard', n });
export const channel = (n: ValueAst, o: { exhausted?: true } = {}): InstrAst => ({ op: 'channel', n, ...o });
export const playSelf = (cost: CostAst, o: { leaveChain?: 'banish' } = {}): InstrAst => ({ op: 'playSelf', cost, ...o });
export const playCard = (what: RefAst, energyLess?: ValueAst): InstrAst =>
  (energyLess === undefined ? { op: 'playCard', what } : { op: 'playCard', what, energyLess });
/** "play it, ignoring its Energy cost" ('energy') or "ignoring its cost" ('all') [420.3.b]. */
export const playFree = (what: RefAst, free: 'energy' | 'all' = 'all', o: Omit<Extract<InstrAst, { op: 'playCard' }>, 'op' | 'what' | 'free'> = {}): InstrAst =>
  ({ op: 'playCard', what, free, ...o });
export const move = (what: RefAst | SelAst, to: MoveToAst): InstrAst => ({ op: 'move', what, to });
export const returnToHand = (what: RefAst | SelAst): InstrAst => ({ op: 'returnToHand', what });
export const recycle = (what: RefAst): InstrAst => ({ op: 'recycle', what });
export const counter = (what: RefAst, to?: 'hand'): InstrAst => (to ? { op: 'counter', what, to } : { op: 'counter', what });
export const fight = (a: RefAst, b: RefAst): InstrAst => ({ op: 'fight', a, b });
export const dealFrom = (from: RefAst, to: RefAst): InstrAst => ({ op: 'dealFrom', from, to });
export const double = (what: RefAst, until: Until = 'thisTurn'): InstrAst => ({ op: 'double', what, until });
export const mill = (n: number): InstrAst => ({ op: 'mill', n });
export const revealTop = (bind: string, n?: number): InstrAst => (n ? { op: 'revealTop', bind, n } : { op: 'revealTop', bind });
export const toHand = (what: RefAst): InstrAst => ({ op: 'toHand', what });
export const gainXp = (n: ValueAst): InstrAst => ({ op: 'gainXp', n });
export const addPower = (n: number): InstrAst => ({ op: 'add', power: n });
export const addEnergy = (n: number, onlyFor?: 'spells'): InstrAst => (onlyFor ? { op: 'add', energy: n, onlyFor } : { op: 'add', energy: n });
export const win: InstrAst = { op: 'win' };
export const points = (n: number, who?: 'opponent'): InstrAst => (who ? { op: 'points', n, who } : { op: 'points', n });
export const attach = (what: RefAst, to: RefAst): InstrAst => ({ op: 'attach', what, to });
export const detach = (from: RefAst): InstrAst => ({ op: 'detach', from });
export const spendBuff = (from: SelAst | RefAst): InstrAst => ({ op: 'spendBuff', from });
/** Each of a bound set spends its buff. */
export const spendBuffsOf = (from: RefAst): InstrAst => ({ op: 'spendBuff', from, all: true });
/** A resolution-time choice of objects, bound by name [355.18]. */
export const choose = (sel: SelAst | SelAst[], bind: string, o: { min?: number; max?: number; sumMightMax?: number; notSlots?: string[];
  oneEachLoc?: true; sameController?: true; count?: ValueAst; mightBelow?: ValueAst } = {}):
  InstrAst => ({ op: 'choose', sel: Array.isArray(sel) ? sel : [sel], min: o.min ?? 1, max: o.max ?? o.min ?? 1, bind,
    ...(o.count !== undefined ? { count: o.count } : {}), ...(o.mightBelow !== undefined ? { mightBelow: o.mightBelow } : {}),
    ...(o.sumMightMax !== undefined ? { sumMightMax: o.sumMightMax } : {}), ...(o.notSlots ? { notSlots: o.notSlots } : {}),
    ...(o.oneEachLoc ? { oneEachLoc: true as const } : {}), ...(o.sameController ? { sameController: true as const } : {}) });
export const exhaust = (what: RefAst | SelAst): InstrAst => ({ op: 'exhaust', what });
export const recall = (what: RefAst | SelAst): InstrAst => ({ op: 'recall', what });
export const gainControl = (what: RefAst): InstrAst => ({ op: 'gainControl', what });
export const extraTurn: InstrAst = { op: 'extraTurn' };
export const banishThis: InstrAst = { op: 'banishThis' };
export const eachPlayerKills = (n = 1, o: { who?: 'opponents'; at?: 'here'; exceptIf?: CondAst } = {}): InstrAst => ({ op: 'eachPlayerKills', n, ...o });
export const pay = (cost: CostAst): InstrAst => ({ op: 'pay', cost });
export const may = (then: InstrAst[]): InstrAst => ({ op: 'may', then });
export const playerEffect = (spec: PlayerEffectAst, who?: 'opponents' | 'all' | { controllerOf: RefAst }): InstrAst =>
  (who ? { op: 'playerEffect', spec, until: 'thisTurn', who } : { op: 'playerEffect', spec, until: 'thisTurn' });
export const replaceDeath = (what: RefAst, cost?: CostAst): InstrAst => (cost ? { op: 'replaceDeath', what, cost } : { op: 'replaceDeath', what });
export const cantMove = (what: RefAst): InstrAst => ({ op: 'cantMove', what });
export const opponentsDraw = (n: number): InstrAst => ({ op: 'draws', n, who: 'opponents' });
/** "you" (the item's controller) draw inside a "for each player" block. */
export const casterDraws = (n: number): InstrAst => ({ op: 'draws', n, who: 'caster' });
export const forEach = (who: 'each' | 'opponents', from: 'you' | 'next', body: InstrAst[]): InstrAst => ({ op: 'forEach', who, from, body });
export const choiceBy = (who: 'self' | 'opponent' | { controllerOf: RefAst }, modes: { label: string; body: InstrAst[] }[]): InstrAst =>
  ({ op: 'choiceBy', who, modes });
export const revealHand: InstrAst = { op: 'revealHand' };
export const discardCards = (what: RefAst): InstrAst => ({ op: 'discardCards', what });
export const discardHand: InstrAst = { op: 'discardHand' };
export const revealUntil = (types: import('../state/types.ts').CardType[], bind: string, rest: string): InstrAst =>
  ({ op: 'revealUntil', types, bind, rest });
export const revealRune = (bind: string): InstrAst => ({ op: 'revealRune', bind });
export const payX = (bind: string, kind?: 'energy'): InstrAst => (kind ? { op: 'payX', bind, kind } : { op: 'payX', bind });
export const dealSplit = (n: ValueAst, to: SelAst, from?: RefAst): InstrAst => (from ? { op: 'dealSplit', n, to, from } : { op: 'dealSplit', n, to });
export const replay = (cost: CostAst, who: 'self' | { controllerOf: RefAst } = 'self'): InstrAst => ({ op: 'replay', who, cost });
export const toTrash = (what: RefAst | SelAst): InstrAst => ({ op: 'toTrash', what });
export const doubleDamage = (what: RefAst): InstrAst => ({ op: 'doubleDamage', what });
export const putOnTop = (what: RefAst): InstrAst => ({ op: 'putOnTop', what });
/** "Banish the top card of your Main Deck" [428], bound by name. */
export const banishTop = (n: number, bind: string): InstrAst => ({ op: 'banishTop', n, bind });
export const empower = (what: RefAst): InstrAst => ({ op: 'empower', what });
export const killAllBut = (sel: SelAst, keep: string[]): InstrAst => ({ op: 'killAllBut', sel, keep });
export const kwFromKw = (to: RefAst, k: KeywordId, from: KeywordId): InstrAst => ({ op: 'kwFromKw', to, kw: k, from });
/** "You can look at their facedown cards" [425]. */
export const lookAt = (what: SelAst): InstrAst => ({ op: 'lookAt', what });
/** "If it would die this turn, banish it instead" [367]. */
export const banishIfDies = (what: RefAst): InstrAst => ({ op: 'banishIfDies', what });
export const recycleAllBut = (sel: SelAst[], keep: string[]): InstrAst => ({ op: 'recycleAllBut', sel, keep });
export const retarget = (what: RefAst): InstrAst => ({ op: 'retarget', what });
export const swap = (a: RefAst, b: RefAst): InstrAst => ({ op: 'swap', a, b });
export const returnChampion: InstrAst = { op: 'returnChampion' };
export const activateConquer: InstrAst = { op: 'activateConquer' };
/** "You may … a unit from among them": a pick of up to n that fit. */
export const pickWhere = (from: string, n: number, bind: string, o: { min?: number; where?: PredAst[]; mightMax?: ValueAst; energyMax?: ValueAst } = {}): InstrAst =>
  ({ op: 'pick', from, n, bind, ...o });

export const kw = {
  tank: (): KeywordAst => ({ kw: 'tank' }),
  reaction: (): KeywordAst => ({ kw: 'reaction' }),
  action: (): KeywordAst => ({ kw: 'action' }),
  deploy: (): KeywordAst => ({ kw: 'deploy' }),
  disarm: (value = 1): KeywordAst => ({ kw: 'disarm', value }),
  deflect: (value = 1): KeywordAst => ({ kw: 'deflect', value }),
  shield: (value = 1): KeywordAst => ({ kw: 'shield', value }),
  assault: (value = 1): KeywordAst => ({ kw: 'assault', value }),
  showOff: (o: { minEnergy?: number; withKeyword?: KeywordId; type?: import('../state/types.ts').CardType; tag?: string } = {}): KeywordAst => ({ kw: 'showOff', showOff: o }),
  ganking: (): KeywordAst => ({ kw: 'ganking' }),
  temporary: (): KeywordAst => ({ kw: 'temporary' }),
  vision: (): KeywordAst => ({ kw: 'vision' }),
  hidden: (): KeywordAst => ({ kw: 'hidden' }),
  backline: (): KeywordAst => ({ kw: 'backline' }),
  equip: (o: { lessBy?: ValueAst } = {}): KeywordAst => (o.lessBy ? { kw: 'equip', equipLessBy: o.lessBy } : { kw: 'equip' }),
};
