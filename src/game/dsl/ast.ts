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
 * M1.2 holds the part of §9.2 that the chain, the triggers and the
 * Seraphine mirror's simpler cards need. The shapes follow the design, so
 * M1.3 adds members (statics, replacements, delayed abilities, the cost
 * pipeline) rather than changing these.
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
      by their text (shown struck through; M1.3 fills them in). */
  missing?: string[];
}

export interface KeywordAst { kw: KeywordId; value?: number }

/** Where a triggered ability works when it isn't on the board [385.2]. */
export type ZoneScope = 'board' | ('trash' | 'hand')[];
/** "Once each turn" [383.3.e], [386]. */
export interface LimitAst { n: number; per: 'turn' }

export type AbilityAst = { id: string; activeIn?: ZoneScope; limit?: LimitAst } & (
  | { kind: 'triggered'; when: TriggerAst; may?: true; cost?: CostAst;
      /** Who controls it: its source's controller (owner off the board)
          [191.5.a], or the player the trigger names [190.6.c]. */
      controller?: 'source' | 'eventPlayer'; effect: ProgAst }
  | { kind: 'activated'; cost: CostAst; timing?: 'action' | 'reaction'; effect: ProgAst; isAdd?: true }
);
export type TriggeredAst = Extract<AbilityAst, { kind: 'triggered' }>;
export type ActivatedAst = Extract<AbilityAst, { kind: 'activated' }>;

/** Costs [201–206]. Energy and Power are paid from the Rune Pool; "[E]"
    exhausts the source [135.2.e.2]. */
export interface CostAst { energy?: number; power?: PowerReqAst[]; exhaustSelf?: true }
/** 'C' = one of the card's domains [135.2.e.6.c]; 'A' = any domain. */
export type PowerReqAst = 'fury' | 'calm' | 'mind' | 'body' | 'chaos' | 'order' | 'C' | 'A';

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
  k: 'unit' | 'gear' | 'permanent';
  /** Relative to the item's controller as it executes [359.3.f.4]. */
  rel?: 'friendly' | 'enemy' | 'any';
  at?: LocSelAst;
  where?: PredAst[];
}
/** 'here': where the item's source is [359.3.f.2]. */
export type LocSelAst = 'battlefield' | 'base' | 'here' | 'board';
export type Cmp = '<' | '<=' | '=' | '>=' | '>';
export type PredAst =
  | { p: 'might' | 'energyCost'; op: Cmp; n: number }
  | { p: 'exhausted' | 'ready' | 'token' | 'nonToken' }
  | { p: 'type'; any: CardType[] };

export type ValueAst = number | { v: 'count'; of: SelAst };
/** What an instruction acts on: its source, a chosen slot, a bound name,
    the object the trigger condition named. */
export type RefAst = 'self' | { slot: string } | { bound: string } | { event: 'subject' };
/** Where a token is played: "to your base", "here", or chosen as it is
    played (base or a battlefield you control [440.2.b.1]). */
export type LocAst = 'yourBase' | 'here' | 'choose';

export type InstrAst = { id?: string } & (
  | { op: 'deal'; n: ValueAst; to: RefAst }                                      // [418]
  | { op: 'draw'; n: ValueAst; from?: RefAst }                                   // [414]; from: "draw one of them" [414.1]
  | { op: 'banish' | 'kill' | 'stun' | 'buff'; what: RefAst }                    // [428], [429], [424], [427]
  | { op: 'ready'; what: RefAst | SelAst }                                       // [416]
  | { op: 'burn'; n: number }                                                    // [441]
  | { op: 'might'; n: ValueAst; sign: 1 | -1; to: RefAst | SelAst; until: 'thisTurn' }   // [479.4], locked set
  | { op: 'playToken'; token: TokenId; n: number; at: LocAst }                   // [440.2.c]
  | { op: 'predict'; n: number }                                                 // [437]
  | { op: 'look'; n: number; bind: string }                                      // [425]: the top N of your Main Deck
  | { op: 'pick'; from: string; n: number; bind: string }                        // a resolution-time choice [355.18]
  | { op: 'recycleRest'; from: string; minus: string }                           // [417]
  | { op: 'discard'; n: number }                                                 // [423]
  | { op: 'channel'; n: number; exhausted?: true }                               // [431]
  | { op: 'playSelf'; cost: CostAst }                                            // a limited play of the source [420.3]
);

export type TriggerAst =
  | { on: 'played'; who: 'self' }                                                // a Play Effect [383.4.a]
  | { on: 'cardPlayed'; by: 'you' | 'anyPlayer'; what?: { types?: CardType[]; minEnergy?: number }; to?: 'here' }   // [420.4.a]
  | { on: 'attack' | 'defend'; who: 'self' }                                     // [383.4.e–f]
  | { on: 'conquer' | 'hold'; who: 'you' | 'opponent'; at: 'here' }             // [383.4.c–d]
  | { on: 'becomesExhausted'; what: 'self' }                                     // an Exhaust action only [415]
  | { on: 'exhaustBatch'; by: 'you'; min: number }                               // friendly units in one Exhaust action
  | { on: 'unitDies'; nonToken?: true; at: 'here';
      /** "For each player, the first time each turn" [383.1.b]: counted per player of the dying unit. */
      firstPerPlayer?: true };

/** An ability's id as chain items and usage counters name it. */
export type AbilityRef = string;
export type { PlayerId };
