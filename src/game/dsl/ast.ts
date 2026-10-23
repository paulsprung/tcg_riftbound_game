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
import type { CardType, DefId, Json, KeywordId, PlayerId, TokenId } from '../state/types.ts';

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
  showOff?: ShowOffAst;
  /** Equip: "This ability's Energy cost is reduced by …" (Hextech Gauntlets). */
  equipLessBy?: ValueAst }

/** "[Show Off] a card with Energy cost [7] or more" [832.1.b]. */
export interface ShowOffAst { minEnergy?: number; withKeyword?: KeywordId }

/** Where a triggered ability works when it isn't on the board [385.2]. */
export type ZoneScope = 'board' | ('trash' | 'hand')[];
/** "Once each turn" [383.3.e], [386]. */
export interface LimitAst { n: number; per: 'turn' }

export type AbilityAst = { id: string; activeIn?: ZoneScope; limit?: LimitAst;
  /** Effect text of an Equipment [136], [718.3]: inactive on the gear itself, an
      ability of the unit it is attached to ("I/me" is that unit). */
  effectText?: true;
  /** Only given to other objects by a static ability (Gardens of Becoming's
      "Units here have '[E]: Gain 1 XP.'"); its own object doesn't have it. */
  grantedOnly?: true;
  /** "The first time … each turn": counted per source as the event happens,
      whatever becomes of the trigger [383.1.b]. */
  first?: 'turn' } & (
  | { kind: 'triggered'; when: TriggerAst; may?: true; cost?: CostAst;
      /** Who controls it: its source's controller (owner off the board)
          [191.5.a], or the player the trigger names [190.6.c]. */
      controller?: 'source' | 'eventPlayer'; effect: ProgAst;
      /** An intervening "if" right after the condition: checked as it
          triggers, never again [383.2.a.1]. */
      if?: CondAst }
  | { kind: 'activated'; cost: CostAst; timing?: 'action' | 'reaction'; effect: ProgAst; isAdd?: true;
      /** "Use this ability only while …" [381]. */
      while?: CondAst;
      /** The modes of "Choose one you've not chosen this turn" (Udyr). */
      modesOncePerTurn?: true }
  /** A static ability [365]: a continuous effect while its source is on
      the board, re-evaluated all the time (layers, §6.7). */
  | { kind: 'static'; spec: StaticAst; while?: CondAst }
  /** A replacement ability [367–375]: "If … would …, … instead". */
  | { kind: 'replacement'; ev: ReplaceEventAst; instead: ReplaceWithAst; while?: CondAst; may?: true }
  /** A cost ability [356]: an additional cost, optional or not, and what
      paying it changes; or a discount. On a card it applies as that card is
      played [366.2.a]; `grant` gives it to other cards you play [356.2]. */
  | { kind: 'cost'; grant?: { types: CardType[]; whose?: 'you' | 'enemy' | 'any';
      /** Only cards with this tag ("Your Dragons"). */
      tag?: string }; optional?: true; pay?: NonStdCostAst;
      /** An additional cost in resources ("You may pay [G] as an additional cost", Accelerate's [1][C]) [356.2]. */
      add?: CostAst;
      discount?: DiscountAst;
      /** "Enemy spells cost [1][A] more" [356.3]. */
      increase?: CostAst;
      /** Applies only while this holds, read with the cost [356.4.g]. */
      while?: CondAst;
      /** Repeat [820]: paying it executes the item's instructions once more. */
      repeat?: true }
);
export type TriggeredAst = Extract<AbilityAst, { kind: 'triggered' }>;
export type ActivatedAst = Extract<AbilityAst, { kind: 'activated' }>;
export type StaticAbilityAst = Extract<AbilityAst, { kind: 'static' }>;
export type ReplacementAst = Extract<AbilityAst, { kind: 'replacement' }>;
export type CostAbilityAst = Extract<AbilityAst, { kind: 'cost' }>;

/** What a static ability does (§9.2 StaticSpecAst). Without `to` it is
    about its source ("I have …"); with `to`, every object the selector
    picks now ("Other friendly units have +1 [M] here", "Your Mechs have
    [Shield]"), re-evaluated all the time [365]. */
export type StaticAst =
  | { s: 'might'; n: ValueAst; to?: SelAst }                                   // layer 4 [479.4]
  | { s: 'keyword'; kw: KeywordAst; to?: SelAst }                              // layer 3 [479.3]
  /** "I enter ready" [359.2.c]; with `to`, other units entering (Magma Wurm). */
  | { s: 'entersReady'; to?: SelAst }
  /** Bandle Tree, Bushwhack Trap: hide N more cards here [107.3.b]; `for`:
      every player, or this battlefield's controller only. */
  | { s: 'facedownCapacity'; n: number; for: 'any' | 'controller' }
  /** Annie, Fiery ("Your spells and abilities"), Void Gate ("to units here") [712–715]. */
  | { s: 'bonusDamage'; n: number; by?: 'you'; to?: 'here' }
  /** Gives an ability this definition holds (grantedOnly) to other objects. */
  | { s: 'grantAbility'; ability: string; to: SelAst }
  /** Heimerdinger, Inventor: "I have all [E] abilities of …". */
  | { s: 'copyAbilities'; of: SelAst[] }
  /** Where it may be played besides the usual [355.2]: an open battlefield,
      an occupied enemy battlefield. */
  | { s: 'playTo'; where: 'open' | 'occupiedEnemy' }
  /** Mageseeker Investigator: moving more than one unit here at once costs [A] each beyond the first. */
  | { s: 'moveTax' }
  /** "This enters exhausted" (gear) [359.2.d]. */
  | { s: 'entersExhausted' }
  /** "Increase the points needed to win the game by 1" (Aspirant's Climb) [194.3]. */
  | { s: 'victoryScore'; n: number };

/** The events replacements of the deck change: playing a token [440.2.c]. */
export interface ReplaceEventAst { ev: 'playToken'; by: 'you'; type: CardType }
/** "… play a 3 [M] Mech unit token to that same location instead". */
export interface ReplaceWithAst { playToken: TokenId }

/** A non-standard cost [356.7]: "exhaust me and three friendly units",
    "kill a friendly unit", "discard 1", "recycle a unit from your trash",
    "kill this", "spend my buff", "spend 3 XP". */
export interface NonStdCostAst {
  exhaustSelf?: true; exhaust?: { sel: SelAst; n: number }; kill?: { sel: SelAst; n: number };
  killSelf?: true; discard?: number; recycleTrash?: { types?: CardType[]; n: number }; spendBuffSelf?: true; xp?: number;
}
/** "I cost [2] less" [356.4]: a fixed amount, or one per object a selector
    picks as the cost is determined (locked [356.4.g]); `min`: "to a minimum
    of [1]"; `power`: Power symbols taken off ("[1][A] less"). */
export interface DiscountAst { energy: ValueAst; min?: number; power?: number }

/** Costs [201–206]. Energy and Power are paid from the Rune Pool; "[E]"
    exhausts the source [135.2.e.2]; the other parts are non-standard. */
export interface CostAst extends NonStdCostAst { energy?: number; power?: PowerReqAst[];
  /** Hextech Gauntlets: "This ability's Energy cost is reduced by the Might of the unit you choose." */
  energyLessBy?: ValueAst }
/** 'C' = one of the card's domains [135.2.e.6.c]; 'A' = any domain. */
export type PowerReqAst = 'fury' | 'calm' | 'mind' | 'body' | 'chaos' | 'order' | 'C' | 'A';

/** Conditions [383.2.a], "if", "while". */
export type CondAst =
  | { c: 'showedOff' }                                                         // [832.1.c.1]
  | { c: 'did'; instr: string }                                                // "if you do" [359.3.e.14.b]
  | { c: 'not'; of: CondAst } | { c: 'and'; of: CondAst[] } | { c: 'or'; of: CondAst[] }
  | { c: 'yourTurn' }
  | { c: 'selfAt'; at: LocSelAst }                                             // "while I'm at a battlefield"
  | { c: 'count'; of: SelAst; op: Cmp; n: number }                             // "while there are 2 or more …"
  | { c: 'legion' }                                                            // [812.1.c]
  | { c: 'xp'; n: number }                                                     // [Level N] [824.1.c]
  | { c: 'playedFrom'; z: 'hand' | 'facedown' }                                // "if you played this from …"
  | { c: 'playedTo'; z: 'bf' }                                                 // "if you play me to a battlefield"
  | { c: 'paid'; ability: string }                                             // "if you paid the additional cost"
  /** A property of an object now: "I", a chosen target, the trigger's subject. */
  | { c: 'is'; ref: RefAst; pred: PredAst }
  /** The turn so far [TurnLog]: you discarded, a unit died, you played a
      unit or gear to a battlefield, you finalized a card of these types. */
  | { c: 'thisTurn'; what: 'discarded' | 'unitDied' | 'playedToBf' | 'finalized' | 'played'; types?: CardType[]; op?: Cmp; n?: number;
      /** unitDied: only units of this relation to the controller ("an enemy unit has died"). */
      rel?: 'friendly' | 'enemy' }
  /** "If an opponent's score is within N points of the Victory Score". */
  | { c: 'opponentNearWin'; within: number }
  /** The trigger's player ('p' of the info) is in their first Beginning Phase [190.6.b]. */
  | { c: 'firstBeginning' }
  /** An earlier instruction did all it said (Catalyst of Aeons: "if you couldn't channel 2"). */
  | { c: 'full'; instr: string }
  | { c: 'excess'; n: number }                                                 // "if you assigned N or more excess damage"
  /** A fact the trigger condition captured (info), compared [359.3.f.3]. */
  | { c: 'info'; key: string; eq: Json }
  | { c: 'handSize'; op: Cmp; n: number }
  /** The last-known information of the ability's source (Deathknell): "If I was Mighty". */
  | { c: 'lki'; pred: PredAst };

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
  /** "another": not an object these slots chose. */
  distinctFrom?: string[];
  /** A destination slot: where the units another slot chose move to [355.4]
      (a location, not a target); `to` limits it. */
  dest?: { of: string; to?: 'base' | 'bf' | 'open' | 'any' };
  /** Played from face down, targets must be at its battlefield [811.1.d.2–3]
      unless the slot's own restriction makes that impossible: this one. */
  freeFromHidden?: true;
  /** Chosen only while this holds as choices are made (a [Level] part's target). */
  if?: CondAst;
}

export interface SelAst {
  /** 'battlefield': a battlefield object ("choose a battlefield"); 'rune': a rune on the board;
      'card': a card in a non-board zone (`in`); 'spell': a spell on the chain;
      'legend': a legend; 'facedown': a facedown card at a battlefield. */
  k: 'unit' | 'gear' | 'permanent' | 'battlefield' | 'rune' | 'card' | 'spell' | 'legend' | 'facedown';
  /** For k:'card': the zone, its owner's by `rel` (friendly: yours). */
  in?: 'trash' | 'hand';
  /** Relative to the item's controller as it executes [359.3.f.4]. */
  rel?: 'friendly' | 'enemy' | 'any';
  at?: LocSelAst;
  where?: PredAst[];
  /** "other": not the source itself [355.9.c]. */
  other?: true;
}
/** 'here': where the item's source is [359.3.f.2]; { slot }: the
    battlefield a slot chose ("friendly units there"); 'eventBf': the
    battlefield the trigger condition named ("at that battlefield"); 'elsewhere':
    a location other than here ("at a different location"). */
export type LocSelAst = 'battlefield' | 'base' | 'here' | 'board' | 'eventBf' | 'elsewhere' | { slot: string };
export type Cmp = '<' | '<=' | '=' | '>=' | '>';
export type PredAst =
  | { p: 'might' | 'energyCost'; op: Cmp; n: number }
  | { p: 'exhausted' | 'ready' | 'token' | 'nonToken' | 'buffed' | 'stunned' | 'mighty' | 'equipped' | 'attached'
      | 'movedThisTurn' | 'alone' | 'oneOnOne' | 'inCombat' | 'open' | 'occupied' | 'notSubject' | 'attackingWithOther'
      /** Has damage marked [142]. */
      | 'damaged' }
  /** The Power symbols of a card's cost (Defy: "no more than [A]"). */
  | { p: 'powerCost'; op: Cmp; n: number }
  /** Energy cost compared with the controller's points (Kai'Sa, Evolutionary). */
  | { p: 'energyCostVsPoints'; op: Cmp }
  | { p: 'type'; any: CardType[] }
  | { p: 'tag'; tag: string }
  | { p: 'designation'; d: 'attacker' | 'defender' }
  | { p: 'keyword'; kw: KeywordId }
  | { p: 'not'; of: PredAst };

export type ValueAst = number
  | { v: 'count'; of: SelAst }
  /** A referent the trigger condition captured ("that card's Energy cost") [359.3.f.3]. */
  | { v: 'info'; key: string }
  /** The Power cost of the card shown off [832.1.d] (its snapshot). */
  | { v: 'shownPower' }
  /** Might of an object, look-back if it left the board [359.3.e.13]. */
  | { v: 'might'; of: RefAst }
  /** The Energy cost of a card: a bound one (discarded), a chosen spell. */
  | { v: 'energyOf'; of: RefAst }
  /** A keyword's value on the source (Hunt 2, Disarm 2), last-known if it left. */
  | { v: 'kw'; kw: KeywordId }
  | { v: 'sum'; of: ValueAst[] };
/** What an instruction acts on: its source, a chosen slot, a bound name,
    the object the trigger condition named. */
export type RefAst = 'self' | { slot: string } | { bound: string } | { event: 'subject' } | { info: string };
/** Where a token is played: "to your base", "here", or chosen as it is
    played (base or a battlefield you control [440.2.b.1]). */
export type LocAst = 'yourBase' | 'here' | 'choose' | { info: string };
/** Where a move instruction takes units: their base, here (the source's
    battlefield), a destination slot, the battlefield a trigger named. */
export type MoveToAst = 'base' | 'here' | { dest: string } | { info: string };
/** Effects on a player for a while (Confront, Stand United, Last Caress). */
export type PlayerEffectAst =
  | { s: 'entersReady'; types: CardType[]; uses?: number }
  | { s: 'buffValue'; n: number }
  | { s: 'playAnywhere'; types: CardType[]; uses: number };

/** `id` names an instruction for "if you do" (CondAst 'did'); `link` makes
    it linked to another, ignored if that one was [359.3.e.14.a]. */
export type InstrAst = { id?: string; link?: string } & (
  | { op: 'deal'; n: ValueAst; to: RefAst | SelAst }                             // [418]
  | { op: 'draw'; n: ValueAst; from?: RefAst }                                   // [414]; from: "draw one of them" [414.1]
  | { op: 'banish' | 'kill' | 'stun' | 'buff'; what: RefAst | SelAst }           // [428], [429], [424], [427]
  | { op: 'ready'; what: RefAst | SelAst }                                       // [416]
  | { op: 'burn'; n: number }                                                    // [441]
  | { op: 'might'; n: ValueAst; sign: 1 | -1; to: RefAst | SelAst; until: Until; floor?: number }   // [479.4], locked set
  | { op: 'playToken'; token: TokenId; n: number; at: LocAst; ready?: true; exhausted?: true }   // [440.2.c]
  | { op: 'predict'; n: ValueAst }                                               // [437]
  | { op: 'look'; n: number; bind: string }                                      // [425]: the top N of your Main Deck
  | { op: 'pick'; from: string; n: number; bind: string }                        // a resolution-time choice [355.18]
  | { op: 'recycleRest'; from: string; minus: string }                           // [417]
  | { op: 'discard'; n: number }                                                 // [423]
  | { op: 'channel'; n: number; exhausted?: true }                               // [431]
  | { op: 'playSelf'; cost: CostAst }                                            // a limited play of the source [420.3]
  /** Plays a card an instruction names [420.3]: from a trash, its Energy cost
      reduced ("Reduce its Energy cost by …"). */
  | { op: 'playCard'; what: RefAst; energyLess?: ValueAst;
      /** "ignoring its Energy cost" / "ignoring its cost" [420.3.b]. */
      free?: 'energy' | 'all' }
  | { op: 'baseMight'; n: ValueAst; to: RefAst | SelAst; until: Until }          // layer 2 [479.2]
  | { op: 'grant'; kw: KeywordAst; to: RefAst | SelAst; until: Until }           // layer 3 [479.3]
  | { op: 'if'; cond: CondAst; then: InstrAst[]; else?: InstrAst[] }             // [359.3.e]
  /** "You may …" inside a resolution: asked as it executes. */
  | { op: 'may'; then: InstrAst[] }
  | { op: 'delayed'; uses: number; ability: Omit<TriggeredAst, 'id'>;          // [390–393], "this turn"
      /** Referents captured now for the delayed ability ("that unit", "this battlefield") [391.5]. */
      capture?: Record<string, RefAst | 'eventBf' | 'hereBf'> }
  | { op: 'draws'; n: number; who: { controllerOf: RefAst } | 'opponents' }     // "Its controller draws 2"
  | { op: 'move'; what: RefAst | SelAst; to: MoveToAst }                         // [421]
  | { op: 'returnToHand'; what: RefAst }                                         // to its owner's hand
  | { op: 'recycle'; what: RefAst }                                              // [417] a permanent or a card
  | { op: 'counter'; what: RefAst }                                              // [426]
  /** "They deal damage equal to their Mights to each other" [418.6.b.3]. */
  | { op: 'fight'; a: RefAst; b: RefAst }
  /** "It deals damage equal to its Might to …": the unit is the source. */
  | { op: 'dealFrom'; from: RefAst; to: RefAst }
  | { op: 'double'; what: RefAst; until: Until }                                 // [433] Might
  | { op: 'mill'; n: number }                                                    // top N of your Main Deck to your trash
  | { op: 'revealTop'; bind: string }                                            // [425]
  | { op: 'toHand'; what: RefAst }                                               // a revealed card to your hand
  | { op: 'gainXp'; n: ValueAst }                                                // [730.1]
  | { op: 'add'; energy?: number; power?: number; onlyFor?: 'spells' }           // [430] (power: [A])
  | { op: 'win' }                                                                // [194.5]
  | { op: 'points'; n: number }
  | { op: 'attach'; what: RefAst; to: RefAst }                                   // [435]
  | { op: 'detach'; from: RefAst }                                               // [436] an Equipment of that unit
  /** "Spend a buff": from one of these units, chosen as it executes [702.2.b]. */
  | { op: 'spendBuff'; from: SelAst }
  | { op: 'eachPlayerKills'; n: number }                                         // Cull the Weak
  /** A cost within an instruction, paid as it executes or declined [740.4.a]. */
  | { op: 'pay'; cost: CostAst }
  /** Weaponmaster [821.1.c]: pay that Equipment's Equip cost less [A] to attach it to me. */
  | { op: 'equipToSelf'; what: RefAst }
  | { op: 'playerEffect'; spec: PlayerEffectAst; until: 'thisTurn' }
  /** "The next time it would die this turn, heal it, exhaust it, and recall it instead". */
  | { op: 'replaceDeath'; what: RefAst }
  /** "They can't move it this turn." */
  | { op: 'cantMove'; what: RefAst }
);
/** How long an effect lasts [479]. */
export type Until = 'thisTurn' | 'thisCombat' | 'permanent';

export type TriggerAst =
  | { on: 'played'; who: 'self' }                                                // a Play Effect [383.4.a]
  | { on: 'cardPlayed'; by: 'you' | 'anyPlayer' | 'opponent';
      what?: { types?: CardType[]; minEnergy?: number; card?: true; fromFacedown?: true;
        /** "another unit": not the source itself. */
        other?: true };
      to?: 'here';                                                               // [420.4.a]; card: not a token [052]
      /** "For each player, the first time they …" [383.1.b]. */
      firstPerPlayer?: true }
  /** [383.4.e–f]: 'self'; 'friendly': any friendly unit; 'you' at 'here': a
      battlefield's "when you defend here". */
  | { on: 'attack' | 'defend'; who: 'self' | 'friendly' | 'you'; at?: 'here' }
  /** [383.4.c–d]; 'any': wherever ("When you conquer"); 'score': either. */
  | { on: 'conquer' | 'hold' | 'score'; who: 'you' | 'opponent'; at: 'here' | 'any' }
  | { on: 'becomesExhausted'; what: 'self' }                                     // an Exhaust action only [415]
  | { on: 'exhaustBatch'; by: 'you'; min: number }                               // friendly units in one Exhaust action
  | { on: 'unitDies'; nonToken?: true; at: 'here' | 'any'; who?: 'friendlyOther';
      /** "For each player, the first time each turn" [383.1.b]: counted per player of the dying unit. */
      firstPerPlayer?: true }
  | { on: 'dies'; who: 'self' }                                                  // Deathknell [808]: self-leave, LKI
  /** A delayed ability's "if this kills it": the unit it captured dies [388]. */
  | { on: 'objDies'; info: string }
  | { on: 'phase'; at: 'beginning' | 'mainStart' | 'endOfTurn'; whose: 'your' | 'any' }   // [315.2.a], [316.4], [317.1.a]
  /** "When I move [to a battlefield]" (self); "When you move an enemy unit" (enemy, by you) [448]. */
  | { on: 'moved'; who: 'self' | 'enemy'; to?: 'bf' }
  | { on: 'discarded'; who: 'self' }                                             // [423]: from the trash
  | { on: 'returnedToHand'; at: 'here' }                                         // a unit here returned to a hand
  | { on: 'buffed'; who: 'friendly' }                                            // you buff a friendly unit [427]
  | { on: 'stunned'; who: 'enemy'; at: 'battlefield' | 'any';
      /** "one or more": one instance per Stun action. */
      once?: true }                                                              // you stun an enemy unit [424]
  | { on: 'becomesMighty'; who: 'friendly' }                                     // [709]
  | { on: 'hid'; at: 'here' };                                                   // you hide a card here [422]

/** An ability's id as chain items and usage counters name it. */
export type AbilityRef = string;
export type { PlayerId };
