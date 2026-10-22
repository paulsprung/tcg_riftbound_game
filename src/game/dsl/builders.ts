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
  AbilityAst, ActivatedAst, CardDef, CondAst, CostAbilityAst, CostAst, InstrAst, KeywordAst, LocAst, ModeAst, PredAst,
  ProgAst, RefAst, ReplacementAst, SelAst, SlotAst, StaticAbilityAst, TokenId, TriggerAst, TriggeredAst, ValueAst,
} from './ast.ts';

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
      if (typeof v === 'object' && v.v === 'might') refOk(v.of);
    };
    const condOk = (c: CondAst) => {
      if (c.c === 'did' && !ids.has(c.instr)) throw new DefError(`${where}: no earlier instruction '${c.instr}'`);
      if (c.c === 'not') condOk(c.of);
      if (c.c === 'and') c.of.forEach(condOk);
    };
    const walk = (body: InstrAst[]) => {
      for (const i of body) {
        if (i.link !== undefined && !ids.has(i.link)) throw new DefError(`${where}: no earlier instruction '${i.link}'`);
        if (i.op === 'deal' || i.op === 'might' || i.op === 'baseMight' || i.op === 'grant') refOk(i.to);
        if ('n' in i && typeof i.n === 'object') valOk(i.n);
        if ('what' in i) refOk(i.what);
        if (i.op === 'draw' && i.from) refOk(i.from);
        if (i.op === 'draws') refOk(i.who.controllerOf);
        if (i.op === 'playToken' && !TOKENS.includes(i.token)) throw new DefError(`${where}: unknown token '${i.token}'`);
        if (i.op === 'pick' && !bound.has(i.from)) throw new DefError(`${where}: '${i.from}' is not bound`);
        if (i.op === 'recycleRest' && (!bound.has(i.from) || !bound.has(i.minus))) throw new DefError(`${where}: unbound name`);
        if (i.op === 'look' || i.op === 'pick') bound.add(i.bind);
        if (i.op === 'if') {
          condOk(i.cond);
          walk(i.then);
          walk(i.else ?? []);
        }
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
    activeIn?: ('trash' | 'hand')[]; if?: CondAst } = {}): Ability =>
  ({ kind: 'triggered', when: trigger, effect, ...o });
/** "[Deathknell][>] …": "When I die, …" with self-leave timing [808.1.c]. */
export const deathknell = (effect: ProgAst): Ability => ({ kind: 'triggered', when: { on: 'dies', who: 'self' }, effect });
/** A static ability on its source [365]: "I have +N [M]" (layer 4). */
export const statik = (n: ValueAst, o: { while?: CondAst } = {}): Ability => ({ kind: 'static', spec: { s: 'might', n }, ...o });
export const replacement = (r: Omit<ReplacementAst, 'id' | 'kind'>): Ability => ({ kind: 'replacement', ...r });
export const costAbility = (c: Omit<CostAbilityAst, 'id' | 'kind'>): Ability => ({ kind: 'cost', ...c });
export const activated = (cost: CostAst, effect: ProgAst, o: { timing?: 'action' | 'reaction' } = {}): Ability =>
  ({ kind: 'activated', cost, effect, ...o });

// ---- programs, slots, selectors ----

export const prog = (body: InstrAst[], choose?: SlotAst[]): ProgAst => (choose ? { choose, body } : { body });
export const mode = (label: string, body: InstrAst[], choose?: SlotAst[]): ModeAst =>
  (choose ? { label, choose, body } : { label, body });
export const slot = (id: string, sel: SelAst | SelAst[], o: { min?: number; max?: number; harm?: boolean;
  distinctFrom?: string[] } = {}): SlotAst =>
  ({ id, sel: Array.isArray(sel) ? sel : [sel], ...o });
export const unitSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'unit', ...o });
export const gearSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'gear', ...o });
export const permanentSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'permanent', ...o });
export const bfSel = (): SelAst => ({ k: 'battlefield' });
export const runeSel = (o: Omit<SelAst, 'k'> = {}): SelAst => ({ k: 'rune', ...o });
export const pred = {
  might: (op: '<' | '<=' | '=' | '>=' | '>', n: number): PredAst => ({ p: 'might', op, n }),
  exhausted: { p: 'exhausted' } as PredAst,
  nonToken: { p: 'nonToken' } as PredAst,
};
export const cond = {
  showedOff: { c: 'showedOff' } as CondAst,
  did: (instr: string): CondAst => ({ c: 'did', instr }),
  not: (of: CondAst): CondAst => ({ c: 'not', of }),
  and: (...of: CondAst[]): CondAst => ({ c: 'and', of }),
  yourTurn: { c: 'yourTurn' } as CondAst,
  selfAt: (at: 'battlefield' | 'base'): CondAst => ({ c: 'selfAt', at }),
  count: (of: SelAst, op: '<' | '<=' | '=' | '>=' | '>', n: number): CondAst => ({ c: 'count', of, op, n }),
};
export const ref = {
  self: 'self' as RefAst,
  slot: (id: string): RefAst => ({ slot: id }),
  bound: (name: string): RefAst => ({ bound: name }),
  subject: { event: 'subject' } as RefAst,
};
export const val = {
  count: (of: SelAst): ValueAst => ({ v: 'count', of }),
  info: (key: string): ValueAst => ({ v: 'info', key }),
  shownPower: { v: 'shownPower' } as ValueAst,
  might: (of: RefAst): ValueAst => ({ v: 'might', of }),
};

// ---- instructions ----

export const deal = (n: ValueAst, to: RefAst): InstrAst => ({ op: 'deal', n, to });
export const draw = (n: ValueAst, from?: RefAst): InstrAst => (from ? { op: 'draw', n, from } : { op: 'draw', n });
export const banish = (what: RefAst): InstrAst => ({ op: 'banish', what });
export const kill = (what: RefAst): InstrAst => ({ op: 'kill', what });
export const stun = (what: RefAst): InstrAst => ({ op: 'stun', what });
export const buff = (what: RefAst): InstrAst => ({ op: 'buff', what });
export const ready = (what: RefAst | SelAst): InstrAst => ({ op: 'ready', what });
export const burn = (n: number): InstrAst => ({ op: 'burn', n });
export const might = (n: ValueAst, to: RefAst | SelAst, sign: 1 | -1 = 1): InstrAst =>
  ({ op: 'might', n, sign, to, until: 'thisTurn' });
export const playToken = (token: TokenId, n: number, at: LocAst): InstrAst => ({ op: 'playToken', token, n, at });
export const predict = (n: ValueAst = 1): InstrAst => ({ op: 'predict', n });
export const baseMight = (n: ValueAst, to: RefAst | SelAst): InstrAst => ({ op: 'baseMight', n, to, until: 'thisTurn' });
export const grant = (k: KeywordAst, to: RefAst | SelAst): InstrAst => ({ op: 'grant', kw: k, to, until: 'thisTurn' });
export const iff = (c: CondAst, then: InstrAst[], otherwise?: InstrAst[]): InstrAst =>
  (otherwise ? { op: 'if', cond: c, then, else: otherwise } : { op: 'if', cond: c, then });
/** A delayed triggered ability for the rest of this turn, `uses` times [390–393]. */
export const delayed = (uses: number, trigger: TriggerAst, effect: ProgAst): InstrAst =>
  ({ op: 'delayed', uses, ability: { kind: 'triggered', when: trigger, effect } });
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

export const kw = {
  tank: (): KeywordAst => ({ kw: 'tank' }),
  reaction: (): KeywordAst => ({ kw: 'reaction' }),
  action: (): KeywordAst => ({ kw: 'action' }),
  deploy: (): KeywordAst => ({ kw: 'deploy' }),
  disarm: (value = 1): KeywordAst => ({ kw: 'disarm', value }),
  deflect: (value = 1): KeywordAst => ({ kw: 'deflect', value }),
  shield: (value = 1): KeywordAst => ({ kw: 'shield', value }),
  assault: (value = 1): KeywordAst => ({ kw: 'assault', value }),
  showOff: (o: { minEnergy?: number } = {}): KeywordAst => ({ kw: 'showOff', showOff: o }),
};
