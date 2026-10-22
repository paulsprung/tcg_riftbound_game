/*
 * The effect language (§9.2): how a card's rules text is written down as
 * data the engine executes. A card definition (CardDef) lists the card's
 * printed keywords, its abilities (triggered, activated) and, for a spell,
 * its program: the targets chosen while it is played, its modes, and the
 * instructions it executes as it resolves.
 *
 * Everything here is plain JSON, so a definition can be hashed (defsHash)
 * and a chain item can name its ability by id ('encore', 'strigian-oracle#0',
 * 'seraphine-inspiring#kw:disarm').
 *
 * M1.2 held the part of §9.2 that the chain and the triggers need; M1.3
 * adds static abilities (layers), replacement abilities, cost abilities
 * (the cost pipeline: optional additional costs, granted costs, discounts),
 * conditions (`if`, intervening "if", "while"), links between instructions,
 * delayed abilities and the instructions the rest of the Seraphine deck
 * needs. The shapes follow the design.
 */
import type { CardType, DefId, KeywordId, PlayerId, TokenId } from '../state/types.ts';

export type { KeywordId, TokenId };

export interface CardDef {
  id: DefId;
  /** The oracle rules text this definition implements (registry checks it). */
  text: string;
  /** Printed keywords with their parameters [803]; Tank, Backline, Deploy,
      Disarm, Reaction … The registry adds keyword abilities (Deploy's hold
      trigger, Disarm's attack trigger) from these. */
  keywords: KeywordAst[];
  /** Printed abilities, in printed order; ids are `${id}#${n}`. */
  abilities: AbilityAst[];
  /** A spell's own text: targets, modes, instructions [359.3]. */
  spell?: ProgAst;
  /** Abilities of the printed text this definition doesn't implement yet,
      by their text (shown struck through). */
  missing?: string[];
}

export interface KeywordAst { kw: KeywordId; value?: number;
  /** Show Off's object [832.1.b]: what may be revealed or picked. */
  showOff?: ShowOffAst }

/** "[Show Off] a card with Energy cost [7] or more" [832.1.b]. */
export interface ShowOffAst { minEnergy?: number }

/** Where a triggered ability works when it isn't on the board [385.2]. */
export type ZoneScope = 'board' | ('trash' | 'hand')[];
/** "Once each turn" [383.3.e], [386]. */
export interface LimitAst { n: number; per: 'turn' }

export type AbilityAst = { id: string; activeIn?: ZoneScope; limit?: LimitAst } & (
  | { kind: 'triggered'; when: TriggerAst; may?: true; cost?: CostAst;
      /** Who controls it: its source's controller (owner off the board)
          [191.5.a], or the player the trigger names [190.6.c]. */
      controller?: 'source' | 'eventPlayer'; effect: ProgAst;
      /** An intervening "if" right after the condition: checked as it
          triggers, never again [383.2.a.1]. */
      if?: CondAst }
  | { kind: 'activated'; cost: CostAst; timing?: 'action' | 'reaction'; effect: ProgAst; isAdd?: true }
  /** A static ability [365]: a continuous effect while its source is on
      the board, re-evaluated all the time (layers, §6.7). */
  | { kind: 'static'; spec: StaticAst; while?: CondAst }
  /** A replacement ability [367–375]: "If … would …, … instead". */
  | { kind: 'replacement'; ev: ReplaceEventAst; instead: ReplaceWithAst; while?: CondAst; may?: true }
  /** A cost ability [356]: an additional cost, optional or not, and what
      paying it changes; or a discount. On a card it applies as that card is
      played [366.2.a]; `grant` gives it to other cards you play [356.2]. */
  | { kind: 'cost'; grant?: { types: CardType[] }; optional?: true; pay?: NonStdCostAst; discount?: DiscountAst }
);
export type TriggeredAst = Extract<AbilityAst, { kind: 'triggered' }>;
export type ActivatedAst = Extract<AbilityAst, { kind: 'activated' }>;
export type StaticAbilityAst = Extract<AbilityAst, { kind: 'static' }>;
export type ReplacementAst = Extract<AbilityAst, { kind: 'replacement' }>;
export type CostAbilityAst = Extract<AbilityAst, { kind: 'cost' }>;

/** What a static ability does (§9.2 StaticSpecAst). Layer 4 [479.4]:
    "I have +N [M]", on its source. */
export type StaticAst = { s: 'might'; n: ValueAst };

/** The events replacements of the deck change: playing a token [440.2.c]. */
export interface ReplaceEventAst { ev: 'playToken'; by: 'you'; type: CardType }
/** "… play a 3 [M] Mech unit token to that same location instead". */
export interface ReplaceWithAst { playToken: TokenId }

/** A non-standard cost [356.7]: "exhaust me and three friendly units",
    "kill a friendly unit". */
export interface NonStdCostAst { exhaustSelf?: true; exhaust?: { sel: SelAst; n: number }; kill?: { sel: SelAst; n: number } }
/** "I cost [2] less" [356.4]: a fixed amount, or one per object a selector
    picks as the cost is determined (locked [356.4.g]). Energy only. */
export interface DiscountAst { energy: ValueAst }

/** Costs [201–206]. Energy and Power are paid from the Rune Pool; "[E]"
    exhausts the source [135.2.e.2]. */
export interface CostAst { energy?: number; power?: PowerReqAst[]; exhaustSelf?: true }
/** 'C' = one of the card's domains [135.2.e.6.c]; 'A' = any domain. */
export type PowerReqAst = 'fury' | 'calm' | 'mind' | 'body' | 'chaos' | 'order' | 'C' | 'A';

/** Conditions [383.2.a], "if", "while". */
export type CondAst =
  | { c: 'showedOff' }                                                         // [832.1.c.1]
  | { c: 'did'; instr: string }                                                // "if you do" [359.3.e.14.b]
  | { c: 'not'; of: CondAst } | { c: 'and'; of: CondAst[] }
  | { c: 'yourTurn' }
  | { c: 'selfAt'; at: LocSelAst }                                             // "while I'm at a battlefield"
  | { c: 'count'; of: SelAst; op: Cmp; n: number };                            // "while there are 2 or more …"

export interface ProgAst {
  /** Targets chosen as it is played (step 2) or as the ability finalizes [355.5], [403.2]. */
  choose?: SlotAst[];
  /** "Choose two —" [355.3]: each mode's own targets and instructions;
      chosen modes execute in printed order. */
  modes?: { pick: number; of: ModeAst[] };
  body: InstrAst[];
}
export interface ModeAst { label: string; choose?: SlotAst[]; body: InstrAst[] }

export interface SlotAst {
  id: string;
  /** Any of these selectors [355.8]. */
  sel: SelAst[];
  /** "up to two": min 0 [355.13]; default exactly 1. */
  min?: number;
  max?: number;
  /** A hint for agents and the UI: choosing an enemy here helps. */
  harm?: boolean;
}

export interface SelAst {
  /** 'battlefield': a battlefield object ("choose a battlefield"); 'rune': a rune on the board. */
  k: 'unit' | 'gear' | 'permanent' | 'battlefield' | 'rune';
  /** Relative to the item's controller as it executes [359.3.f.4]. */
  rel?: 'friendly' | 'enemy' | 'any';
  at?: LocSelAst;
  where?: PredAst[];
  /** "other": not the source itself [355.9.c]. */
  other?: true;
}
/** 'here': where the item's source is [359.3.f.2]; { slot }: the
    battlefield a slot chose ("friendly units there"). */
export type LocSelAst = 'battlefield' | 'base' | 'here' | 'board' | { slot: string };
export type Cmp = '<' | '<=' | '=' | '>=' | '>';
export type PredAst =
  | { p: 'might' | 'energyCost'; op: Cmp; n: number }
  | { p: 'exhausted' | 'ready' | 'token' | 'nonToken' }
  | { p: 'type'; any: CardType[] };

export type ValueAst = number
  | { v: 'count'; of: SelAst }
  /** A referent the trigger condition captured ("that card's Energy cost") [359.3.f.3]. */
  | { v: 'info'; key: string }
  /** The Power cost of the card shown off [832.1.d] (its snapshot). */
  | { v: 'shownPower' }
  /** Might of an object, look-back if it left the board [359.3.e.13]. */
  | { v: 'might'; of: RefAst };
/** What an instruction acts on: its source, a chosen slot, a bound name,
    the object the trigger condition named. */
export type RefAst = 'self' | { slot: string } | { bound: string } | { event: 'subject' };
/** Where a token is played: "to your base", "here", or chosen as it is
    played (base or a battlefield you control [440.2.b.1]). */
export type LocAst = 'yourBase' | 'here' | 'choose';

/** `id` names an instruction for "if you do" (CondAst 'did'); `link` makes
    it linked to another, ignored if that one was [359.3.e.14.a]. */
export type InstrAst = { id?: string; link?: string } & (
  | { op: 'deal'; n: ValueAst; to: RefAst }                                      // [418]
  | { op: 'draw'; n: ValueAst; from?: RefAst }                                   // [414]; from: "draw one of them" [414.1]
  | { op: 'banish' | 'kill' | 'stun' | 'buff'; what: RefAst }                    // [428], [429], [424], [427]
  | { op: 'ready'; what: RefAst | SelAst }                                       // [416]
  | { op: 'burn'; n: number }                                                    // [441]
  | { op: 'might'; n: ValueAst; sign: 1 | -1; to: RefAst | SelAst; until: 'thisTurn' }   // [479.4], locked set
  | { op: 'playToken'; token: TokenId; n: number; at: LocAst }                   // [440.2.c]
  | { op: 'predict'; n: ValueAst }                                               // [437]
  | { op: 'look'; n: number; bind: string }                                      // [425]: the top N of your Main Deck
  | { op: 'pick'; from: string; n: number; bind: string }                        // a resolution-time choice [355.18]
  | { op: 'recycleRest'; from: string; minus: string }                           // [417]
  | { op: 'discard'; n: number }                                                 // [423]
  | { op: 'channel'; n: number; exhausted?: true }                               // [431]
  | { op: 'playSelf'; cost: CostAst }                                            // a limited play of the source [420.3]
  | { op: 'baseMight'; n: ValueAst; to: RefAst | SelAst; until: 'thisTurn' }     // layer 2 [479.2]
  | { op: 'grant'; kw: KeywordAst; to: RefAst | SelAst; until: 'thisTurn' }      // layer 3 [479.3]
  | { op: 'if'; cond: CondAst; then: InstrAst[]; else?: InstrAst[] }             // [359.3.e]
  | { op: 'delayed'; uses: number; ability: Omit<TriggeredAst, 'id'> }           // [390–393], "this turn"
  | { op: 'draws'; n: number; who: { controllerOf: RefAst } }                    // "Its controller draws 2"
);

export type TriggerAst =
  | { on: 'played'; who: 'self' }                                                // a Play Effect [383.4.a]
  | { on: 'cardPlayed'; by: 'you' | 'anyPlayer'; what?: { types?: CardType[]; minEnergy?: number; card?: true };
      to?: 'here' }                                                              // [420.4.a]; card: not a token [052]
  | { on: 'attack' | 'defend'; who: 'self' }                                     // [383.4.e–f]
  | { on: 'conquer' | 'hold'; who: 'you' | 'opponent'; at: 'here' }             // [383.4.c–d]
  | { on: 'becomesExhausted'; what: 'self' }                                     // an Exhaust action only [415]
  | { on: 'exhaustBatch'; by: 'you'; min: number }                               // friendly units in one Exhaust action
  | { on: 'unitDies'; nonToken?: true; at: 'here';
      /** "For each player, the first time each turn" [383.1.b]: counted per player of the dying unit. */
      firstPerPlayer?: true }
  | { on: 'dies'; who: 'self' }                                                  // Deathknell [808]: self-leave, LKI
  | { on: 'phase'; at: 'beginning' | 'mainStart' | 'endOfTurn'; whose: 'your' };   // [315.2.a], [316.4], [317.1.a]

/** An ability's id as chain items and usage counters name it. */
export type AbilityRef = string;
export type { PlayerId };
