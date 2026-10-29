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
import type { CardType, DefId, Domain, Json, KeywordId, PlayerId, TokenId } from '../state/types.ts';

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
export interface ShowOffAst { minEnergy?: number; withKeyword?: KeywordId;
  /** "[Show Off] a gear": a card of this type; "a Mech": with this tag. */
  type?: CardType; tag?: string }

/** Where a triggered ability works when it isn't on the board [385.2]. */
export type ZoneScope = 'board' | ('trash' | 'hand' | 'deck')[];
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
      if?: CondAst;
      /** "choose one that hasn't been chosen this turn" (Aphelios): its source's modes, once each per turn. */
      modesOncePerTurn?: true }
  | { kind: 'activated'; cost: CostAst; timing?: 'action' | 'reaction'; effect: ProgAst; isAdd?: true;
      /** "Use this ability only while …" [381]. */
      while?: CondAst;
      /** The modes of "Choose one you've not chosen this turn" (Udyr). */
      modesOncePerTurn?: true;
      /** Black Market: "Each player may use this ability once on their turn (even if they don't control this
          battlefield)": any player, on their own turn, `limit` counted per player. */
      anyPlayer?: true }
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
      tag?: string;
      /** Only cards printing this keyword ("cards with [Reaction]"). */
      keyword?: KeywordId }; optional?: true; pay?: NonStdCostAst;
      /** An additional cost in resources ("You may pay [G] as an additional cost", Accelerate's [1][C]) [356.2]. */
      add?: CostAst;
      discount?: DiscountAst;
      /** "Enemy spells cost [1][A] more" [356.3]. */
      increase?: CostAst;
      /** Applies only while this holds, read with the cost [356.4.g]. */
      while?: CondAst;
      /** Repeat [820]: paying it executes the item's instructions once more. */
      repeat?: true;
      /** "You may kill any number of friendly units / spend any number of buffs as an additional cost. Reduce my
          cost by [Y] for each": a number chosen as it is played. */
      x?: { kill?: SelAst; spendBuff?: SelAst; lessPower: PowerReqAst };
      /** Accelerate given to other cards: paid, the unit enters ready [805.2.b]. */
      accelerate?: true;
      /** Atakhan: "I cost [1] less for each Energy it costs and [Y] less for each Power it costs" (the objects this
          cost kills, read as they are chosen). */
      lessByPaid?: { power: PowerReqAst };
      /** "you may play me for [B]": an alternative cost replacing the base cost [204.1.b]. */
      alt?: CostAst;
      /** Chronobreak: "As an additional cost to play this, pay any amount of Power": a number chosen as it is played,
          that many [A] more (ValueAst 'xCost' reads it). */
      xPower?: true;
      /** "Ignore [Deflect] while paying this spell's cost". */
      ignoreDeflect?: true;
      /** Dragon Roost: "If they do, they play it to this battlefield" (the granting battlefield). */
      playHere?: true }
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
  | { s: 'might'; n: ValueAst; to?: SelAst;
      /** A decrease ("Stunned enemy units here have -8 [M]"), stopping at `floor` ("to a minimum of 1 [M]"). */
      dec?: true; floor?: number }                                             // layer 4 [479.4]
  | { s: 'keyword'; kw: KeywordAst; to?: SelAst;
      /** The value read now ("[Assault] equal to the number of enemy units here"). */
      n?: ValueAst;
      /** "if they didn't already": only to objects without the keyword otherwise. */
      ifNot?: true }                                                           // layer 3 [479.3]
  /** "I enter ready" [359.2.c]; with `to`, other units entering (Magma Wurm). */
  | { s: 'entersReady'; to?: SelAst }
  /** Bandle Tree, Bushwhack Trap: hide N more cards here [107.3.b]; `for`:
      every player, or this battlefield's controller only. */
  | { s: 'facedownCapacity'; n: number; for: 'any' | 'controller' }
  /** Annie, Fiery ("Your spells and abilities"), Void Gate ("to units here") [712–715]. */
  | { s: 'bonusDamage'; n: number; by?: 'you'; to?: 'here';
      /** "Abilities of friendly gear deal 1 Bonus Damage". */
      from?: 'friendlyGear' }
  /** Gives an ability this definition holds (grantedOnly) to other objects. */
  | { s: 'grantAbility'; ability: string; to: SelAst }
  /** Heimerdinger, Inventor: "I have all [E] abilities of …". */
  | { s: 'copyAbilities'; of: SelAst[] }
  /** Where it may be played besides the usual [355.2]: an open battlefield,
      an occupied enemy battlefield. */
  | { s: 'playTo'; where: 'open' | 'occupiedEnemy' | 'attacking' | 'enemyAlone' }
  /** Mageseeker Investigator: moving more than one unit here at once costs [A] each beyond the first; `cost`: "Opponents must
      pay [1][A] to move one or more units to this battlefield" (once per Standard Move). */
  | { s: 'moveTax'; cost?: { energy: number; power: number } }
  /** "Your gear with [Deploy] have [Action]", "your spells have [Reaction]": a timing for the controller's cards. */
  | { s: 'giveTiming'; timing: 'action' | 'reaction'; types: CardType[]; keyword?: KeywordId }
  /** "I don't take damage" (while the ability's condition holds); `from: 'enemyEffects'`: "prevent all damage that enemy
      spells and abilities would deal to me". */
  | { s: 'noDamage'; from?: 'enemyEffects' }
  /** "This enters exhausted" (gear) [359.2.d]. */
  | { s: 'entersExhausted' }
  /** "Increase the points needed to win the game by 1" (Aspirant's Climb) [194.3]. */
  | { s: 'victoryScore'; n: number }
  /** "I can have any number of buffs" [702.3]. */
  | { s: 'maxBuffs' }
  /** "Your [Deathknell] effects trigger an additional time" (Karthus); `here`: "Friendly [Deathknell] effects here". */
  | { s: 'deathknellTwice'; here?: true }
  /** Firebrand Raider: "Units don't ready during the Awaken Phase." */
  | { s: 'noAwakenReady' }
  /** "If a combat where you are the attacker ends in a tie, recall ALL units instead." */
  | { s: 'tieRecallAll' }
  /** "Units can't move from here to base"; `anywhere`: "Units can't move to base". */
  | { s: 'noMoveToBase'; anywhere?: true;
      /** "I can't move to base": only its source. */
      self?: true }
  /** Mordekaiser, Twice-Slain: "Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me
      instead" (applied whenever another friendly unit can be killed: the one with the least Might). */
  | { s: 'saveSelfByKill' }
  /** Seraphic Wyvern: "If you would channel runes, channel that many runes plus 1 exhausted rune instead." */
  | { s: 'channelExtra' }
  /** "This can't be countered" (on the card itself); with `to`, "Your spells and abilities can't be countered" (its controller's). */
  | { s: 'cantBeCountered'; yours?: true }
  /** Rengar: "I can [Ambush] to a battlefield where there are enemy units, even if you don't have units there." */
  | { s: 'ambushEnemy' }
  /** Risen Altar: "[Empower] costs of your units here cost [1] or [A] less." */
  | { s: 'empowerLessHere' }
  /** Sandstone Chimera: "players only channel 1 rune at the start of their Channel Phase" (while the ability's condition holds). */
  | { s: 'channelPhaseOne' }
  /** Otterpus: "If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead." */
  | { s: 'earlyPointsToDraw' }
  /** "I can't be played …" while the ability's condition holds (read for the card in hand). */
  | { s: 'cantBePlayed' }
  /** Piltovan Forge: "the first friendly gear activated ability played each turn costs [1] less" (while the ability's condition holds). */
  | { s: 'gearAbilityLess'; n: number }
  /** Heisho: "Players ignore [Deflect] while paying for spells and abilities choosing something here." */
  | { s: 'ignoreDeflectHere' }
  /** "I can't be moved by enemy spells and abilities." */
  | { s: 'noEnemyMove' }
  /** Gangplank: "If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] this
      turn instead." */
  | { s: 'chosenImmune'; n: number }
  /** Mel: "If a spell or ability you control would give -[M] to a unit it chooses, it gives an additional -1 [M]." */
  | { s: 'extraDecrease'; n: number }
  /** "I can be [Empowered] up to three times." */
  | { s: 'maxEmpower'; n: number }
  /** Dune Surfer: "You ignore [Tank] while assigning combat damage here." */
  | { s: 'ignoreTank' }
  /** Endless Riches: "Skip your Draw Phase." */
  | { s: 'skipDraw' }
  /** Endless Riches: "You may play cards from your trash." */
  | { s: 'playAllFromTrash' }
  /** Endless Riches: "If a card would go to your trash from anywhere other than your Main Deck, banish it instead." */
  | { s: 'trashToBanish' }
  /** Ezreal, Prodigy: "Optional additional costs you pay cost [1] or [A] less." */
  | { s: 'optionalLess' }
  /** Fallen Feline: "When you play me, name a spell" (as it is played; kept as GameObject.named). */
  | { s: 'nameCard'; types: CardType[] }
  /** "opponents can't play spells with that name" (the source's named card). */
  | { s: 'opponentsCantPlayNamed' }
  /** "Units can't be played here." */
  | { s: 'noPlayHere' }
  /** "While I'm at a battlefield, opponents can't gain points." */
  | { s: 'noPointsForOpponents' }
  /** "Players can't score here until their third turn." */
  | { s: 'noScoreBefore'; turn: number }
  /** "Play me only to a battlefield you conquered this turn." */
  | { s: 'playOnlyToConquered' }
  /** "Each Equipment attached to me gives double its base Might bonus." */
  | { s: 'doubleMightBonus' }
  /** Guardian Angel: "If I would die, kill this instead. Heal me, exhaust me, and recall me." */
  | { s: 'saveHost' }
  /** Soraka: "If another unit you control here would die, if it has less Might than me, … instead." */
  | { s: 'saveWeakerHere' }
  /** "My hold effects are also conquer effects, and vice versa." */
  | { s: 'holdIsConquer' }
  /** "I can't be chosen by enemy spells and abilities." */
  | { s: 'noEnemyChoose'; to?: SelAst }
  /** "Your Gold [Add] an additional [1]." */
  | { s: 'goldBonus' }
  /** "Your tokens enter ready." */
  | { s: 'tokensEnterReady' }
  /** "Friendly [Repeat] costs cost [1] less." */
  | { s: 'repeatLess' }
  /** "Your Equipment everywhere have [Quick-Draw]": its Reaction timing in hand. */
  | { s: 'equipmentQuickDraw' }
  /** Svellsongur: the unit it is attached to has its own text once more. */
  | { s: 'copyHostText' }
  /** Void Hatchling: "If you would reveal cards from a deck, look at the top card first. You may recycle it." */
  | { s: 'peekBeforeReveal' }
  /** "I am a Mech." */
  | { s: 'tag'; tag: string; to?: SelAst }
  /** "Opponents can only play units to their base" (while the condition holds). */
  | { s: 'opponentsPlayToBase' }
  /** "Spells and abilities can't ready enemy units and gear." */
  | { s: 'noReadyByEffects'; to: SelAst }
  /** "Your opponents' [Hidden] cards can't be revealed here." */
  | { s: 'noFacedownPlayHere' }
  /** "Friendly units may be played to open battlefields" (other cards you play). */
  | { s: 'othersPlayTo'; where: 'open' | 'enemyAlone'; types: CardType[] }
  /** Zhonya's Hourglass: "If a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it." */
  | { s: 'saveFriendly' }
  /** Teemo, Swift Scout: "You may pay [1] to hide a card with [Hidden] instead of [A]." */
  | { s: 'hideFor'; cost: CostAst }
  /** Sett: "If a buffed unit you control would die, you may pay …, spend its buff to heal it, exhaust it, and recall it instead." */
  | { s: 'saveBuffed'; cost: CostAst }
  /** Altar of Blood: "If a unit here would die during combat, its controller may pay … to heal it, exhaust it, and recall it instead." */
  | { s: 'saveHere'; cost: CostAst; combat?: true }
  /** Baron Nashor: "As you play me, add the … battlefield token to the board if it's not there already. If you do, I enter there." */
  | { s: 'addBfToken'; token: TokenId }
  /** Baron Pit: "Units can move here from anywhere." */
  | { s: 'moveHereFromAnywhere' }
  /** "Your hold effects for holding here trigger an additional time" (conquer: "Your conquer effects …"). */
  | { s: 'extraScoreTriggers'; how: 'hold' | 'conquer' }
  /** Elder Dragon: "Any amount of your damage is enough to kill enemy units." */
  | { s: 'anyDamageKills' }
  /** "I don't deal combat damage"; with `to`: "Enemy units here with less Might than me don't deal combat damage." */
  | { s: 'noCombatDamage'; to?: SelAst }
  /** LeBlanc: "Your [Temporary] effects at my battlefield don't trigger." */
  | { s: 'noTemporaryTrigger'; to: SelAst }
  /** "I can't be readied." */
  | { s: 'cantBeReadied' }
  /** Ivern: "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag." */
  | { s: 'chooseTag'; tags: string[] | 'any';
      /** The List: "As you play this, name a tag": the tag is named, the card doesn't gain it. */
      gain?: false }
  /** Undying Legion: "You may play me from your trash" (a play action from the trash while the ability's `while` holds,
      read for the card in the trash). */
  | { s: 'playFromTrash' };

/** The events replacements of the deck change: playing a token [440.2.c]. */
export interface ReplaceEventAst { ev: 'playToken'; by: 'you'; type: CardType }
/** "… play a 3 [M] Mech unit token to that same location instead". */
export type ReplaceWithAst = { playToken: TokenId }
  /** Zilean: "you may play that token and an additional copy of it instead". */
  | { extraCopy: true };

/** A non-standard cost [356.7]: "exhaust me and three friendly units",
    "kill a friendly unit", "discard 1", "recycle a unit from your trash",
    "kill this", "spend my buff", "spend 3 XP". */
export interface NonStdCostAst {
  exhaustSelf?: true; exhaust?: { sel: SelAst; n: number }; kill?: { sel: SelAst; n: number };
  killSelf?: true; discard?: number; recycleTrash?: { types?: CardType[]; n: number }; spendBuffSelf?: true; xp?: number;
  /** "spend a buff" of one of these units. */
  spendBuff?: { sel: SelAst; n: number };
  /** "return a friendly gear to its owner's hand". */
  bounce?: { sel: SelAst; n: number };
  /** "Banish this". */
  banishSelf?: true;
  /** "Disempower me" [443]. */
  disempowerSelf?: true;
  /** "Banish a unit or gear from your trash". */
  banishTrash?: { types?: CardType[]; n: number };
  /** "Discard a spell": the discarded cards must be of these types. */
  discardTypes?: CardType[];
}
/** "I cost [2] less" [356.4]: a fixed amount, or one per object a selector
    picks as the cost is determined (locked [356.4.g]); `min`: "to a minimum
    of [1]"; `power`: Power symbols taken off ("[1][A] less"). */
export interface DiscountAst { energy: ValueAst; min?: number; power?: number;
  /** "ignore this spell's cost": no Energy and no Power. */
  all?: true;
  /** Energy and Power taken off this many times ("for each point you scored from holding this turn"). */
  times?: ValueAst;
  /** Only when the spell chooses the discount's source ("Your spells that choose me"). */
  ifChoosesSource?: true;
  /** Only when one of its targets fits these ("This costs [2] less if you choose a Bird, Cat, Dog, or Poro"). */
  ifTarget?: PredAst[];
  /** Hunters' Circle: "For each player, the first unit or gear they play here on their turn costs [1] less". */
  firstHere?: true }

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
      rel?: 'friendly' | 'enemy';
      /** played: only cards with this tag ("if you've played an Equipment this turn"). */
      tag?: string;
      /** played: only plays that spent this much Energy or more ("If you've spent [4] or more to play a spell this turn"). */
      minSpent?: number;
      /** unitDied: only deaths during the controller's own Beginning Phase this turn. */
      yourBeginning?: true;
      /** played: by an opponent ("if an opponent has played another spell this turn"). */
      who?: 'opponent' }
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
  | { c: 'lki'; pred: PredAst }
  /** The source was at a battlefield as it left the board ("my battlefield" in a Deathknell). */
  | { c: 'lkiAtBf' }
  /** "to play from anywhere other than your hand". */
  | { c: 'notFromHand' }
  /** The Equipment whose effect text this is was attached this turn. */
  | { c: 'attachedThisTurn' }
  /** You chose enemy units and/or gear twice this turn with spells or unit abilities. */
  | { c: 'chosenEnemies'; n: number }
  /** The source is controlled by the controller ("While you control this battlefield"). */
  | { c: 'controlsSelf' }
  /** Power spent this turn [A][A] or more. */
  | { c: 'powerSpent'; n: number }
  /** Your own score is within N of the Victory Score. */
  | { c: 'nearWin'; within: number }
  /** A rune revealed by revealRune has this domain. */
  | { c: 'boundDomain'; name: string; d: Domain }
  /** A number compared ("if it had 3 [M] or less": the look-back Might of a chosen unit). */
  | { c: 'val'; v: ValueAst; op: Cmp; n: number }
  /** The source (an Equipment's host: "I") conquered or held this turn. */
  | { c: 'scoredThisTurn'; how: 'conquer' | 'hold' }
  /** "your units have all of the following tags among them": at least n of these tags. */
  | { c: 'tags'; tags: string[]; n: number }
  /** A showdown is going on [341]. */
  | { c: 'showdown' }
  /** "If it's your Beginning Phase". */
  | { c: 'phase'; phase: 'beginning' | 'main'; yours?: true }
  /** "If you've gained XP this turn". */
  | { c: 'xpGained' }
  /** "if you control this battlefield" (the source's battlefield). */
  | { c: 'controlsHere' }
  /** "If you control fewer runes than an opponent". */
  | { c: 'fewerRunes' }
  /** The controller's turns taken so far (this one included) compared ("on your first, second, or third turns"). */
  | { c: 'ownTurns'; op: Cmp; n: number }
  /** "While I'm in a showdown": a showdown is going on at the source's battlefield. */
  | { c: 'selfInShowdown' }
  /** The card being played comes from this zone ("play me from your trash for …"). */
  | { c: 'origin'; z: 'trash' | 'hand' | 'banish' }
  /** The controller's Rune Deck holds this many cards ("if your Rune Deck is empty"). */
  | { c: 'runeDeck'; op: Cmp; n: number };

export interface ProgAst {
  /** Targets chosen as it is played (step 2) or as the ability finalizes [355.5], [403.2]. */
  choose?: SlotAst[];
  /** "Choose two —" [355.3]: each mode's own targets and instructions;
      chosen modes execute in printed order. `distinct`: "Choose one you haven't already chosen" (each Repeat
      execution a mode no earlier execution chose). */
  modes?: { pick: number; of: ModeAst[]; distinct?: true };
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
  dest?: { of: string; to?: 'base' | 'bf' | 'open' | 'any' | 'toOrFromBase' | 'withFriends' | 'controlled' | 'occupiedEnemy'
    /** "a battlefield where you have units" (the item's controller). */
    | 'yourUnits' };
  /** Played from face down, targets must be at its battlefield [811.1.d.2–3]
      unless the slot's own restriction makes that impossible: this one. */
  freeFromHidden?: true;
  /** Chosen only while this holds as choices are made (a [Level] part's target). */
  if?: CondAst;
  /** "with total Might N or less". */
  sumMightMax?: number;
}

export interface SelAst {
  /** 'battlefield': a battlefield object ("choose a battlefield"); 'rune': a rune on the board;
      'card': a card in a non-board zone (`in`); 'spell': a spell on the chain;
      'legend': a legend; 'facedown': a facedown card at a battlefield. */
  k: 'unit' | 'gear' | 'permanent' | 'battlefield' | 'rune' | 'card' | 'spell' | 'legend' | 'facedown';
  /** For k:'card': the zone, its owner's by `rel` (friendly: yours). */
  in?: 'trash' | 'hand' | 'champion' | 'banish';
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
  /** Friendly or enemy to the item's controller ("If it was an enemy unit"). */
  | { p: 'rel'; rel: 'friendly' | 'enemy' }
  /** A spell on the chain that chose a friendly unit or gear. */
  | { p: 'choosesFriendly' }
  /** Banished with a link group. */
  | { p: 'linked'; group: string }
  /** Its name ("Your Sand Soldiers"), a token's included. */
  | { p: 'name'; name: string }
  /** Moved exactly N times this turn ("The third time I move in a turn"). */
  | { p: 'moves'; n: number }
  /** At the battlefield the trigger named. */
  | { p: 'atEventBf' }
  /** In a zone of this kind ("still on top of your deck"). */
  | { p: 'inZone'; z: 'deck' | 'hand' | 'trash' | 'banish' }
  | { p: 'type'; any: CardType[] }
  | { p: 'tag'; tag: string }
  | { p: 'designation'; d: 'attacker' | 'defender' }
  | { p: 'keyword'; kw: KeywordId }
  | { p: 'not'; of: PredAst }
  /** Might compared with the source's ("with less Might than me"). */
  | { p: 'mightVsSource'; op: Cmp }
  /** Not what a slot chose ("each other enemy unit there"). */
  | { p: 'notSlot'; slot: string }
  /** One of these tags ("a Bird, Cat, Dog, or Poro"). */
  | { p: 'anyTag'; tags: string[] }
  /** A battlefield whose units not controlled by the item's controller have less total Might than the source. */
  | { p: 'enemyMightBelowSource' }
  /** A card that costs no more Energy and no more Power than the object a cost killed. */
  | { p: 'costAtMostPaid' }
  /** A battlefield where units of this relation to the item's controller are ("a battlefield where you have units"). */
  | { p: 'unitsHere'; rel: 'friendly' | 'enemy' }
  /** Might compared with the Might of what a slot chose ("with less Might than the chosen unit"). */
  | { p: 'mightVsSlot'; slot: string; op: Cmp }
  /** Not at the location of what a slot chose ("another unit you control at a different location"). */
  | { p: 'notAtSlot'; slot: string }
  /** A spell on the chain that chooses what a slot chose and no other friendly unit (Repulse). */
  | { p: 'choosesOnly'; slot: string }
  /** Has the tag the source named as it was played (The List). */
  | { p: 'namedTag' }
  /** [Empowered] [442]. */
  | { p: 'empowered' }
  /** Moved at least N times this turn ("If I have moved twice this turn"). */
  | { p: 'minMoves'; n: number }
  /** A champion card [133]. */
  | { p: 'champion' }
  /** Owned by the item's controller (cards in decks have no controller). */
  | { p: 'ownedByYou' }
  /** "with Might greater than each other unit on the board". */
  | { p: 'mightiest' }
  /** Dealt damage this turn. */
  | { p: 'damagedThisTurn' }
  /** At the battlefield where a showdown is going on ("a friendly unit in a showdown"). */
  | { p: 'inShowdown' }
  /** At the battlefield the trigger's unit moved to or from ("a battlefield I moved to or from"). */
  | { p: 'atMoveEnds' }
  /** An Equipment attached to the source ("for each Equipment attached to me"). */
  | { p: 'attachedToSource' }
  /** At the source's location (a battlefield's "here" for a cost ability it grants). */
  | { p: 'atSource' }
  /** Energy cost no more than the source's Might ("with Energy cost no more than my Might"). */
  | { p: 'energyAtMostSourceMight' }
  /** [Empowered] at least N times. */
  | { p: 'empoweredAtLeast'; n: number }
  /** Can be empowered (not Empowered, or below its "up to N times"). */
  | { p: 'canEmpower' }
  /** A battlefield with exactly N units there. */
  | { p: 'unitCount'; n: number }
  /** A card of this domain ("an enemy Order unit"). */
  | { p: 'domain'; d: Domain }
  /** "in combat with an enemy Fury unit": in combat, an enemy unit of the domain in it too. */
  | { p: 'inCombatWithDomain'; d: Domain }
  /** "being chosen by an enemy Fury spell": an enemy spell of the domain on the chain chose it. */
  | { p: 'chosenBySpellOfDomain'; d: Domain };

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
  | { v: 'sum'; of: ValueAst[] }
  /** The controller's points. */
  | { v: 'points' }
  /** a − b, never below 0 ("increase its Might to the Might of another"). */
  | { v: 'diff'; a: ValueAst; b: ValueAst }
  /** "the highest Might among units you control". */
  | { v: 'maxMight'; of: SelAst }
  /** How many objects a name is bound to ("for each buff spent"). */
  | { v: 'countBound'; name: string; where?: PredAst[] }
  /** The amount a payX bound. */
  | { v: 'x'; name: string }
  /** Excess damage the controller assigned in this combat. */
  | { v: 'excess' }
  /** Cards the controller has played this turn. */
  | { v: 'playedThisTurn' }
  /** Points the controller scored from holding this turn. */
  | { v: 'holdPoints' }
  /** How many of these tags the controller's units have among them. */
  | { v: 'tagsAmong'; tags: string[] }
  /** The total Might of the objects a selector picks. */
  | { v: 'sumMight'; of: SelAst }
  /** How many times this card dealt damage this turn (Dancing Grenade). */
  | { v: 'cardDeals' }
  /** How many battlefields the controller conquered this turn. */
  | { v: 'conquered' }
  /** The damage marked on a referenced unit ("equal to the damage marked on it"). */
  | { v: 'damageOn'; of: RefAst }
  /** How many times the source is [Empowered] (Kayle). */
  | { v: 'empowerCount' }
  /** A number under a condition ("costs [3] less if you control 4 or fewer runes"). */
  | { v: 'if'; cond: CondAst; then: ValueAst; else: ValueAst }
  /** The least Energy cost among the cards a name is bound to ("a card with the lowest Energy cost"). */
  | { v: 'minEnergyBound'; name: string }
  /** The Might of the unit shown off ("deal damage equal to that unit's Might") [832.1.d]. */
  | { v: 'shownMight' }
  /** The Energy cost of what the play's non-standard costs took ("equal to the Energy cost of the gear you returned"). */
  | { v: 'paidEnergy' }
  /** A keyword's value on a referenced object ("double the [Shield] of a unit"). */
  | { v: 'kwOf'; of: RefAst; kw: KeywordId }
  /** The number chosen for the item's "pay any amount of Power" cost (CostAbilityAst.xPower). */
  | { v: 'xCost' }
/** What an instruction acts on: its source, a chosen slot, a bound name,
    the object the trigger condition named. */
export type RefAst = 'self' | { slot: string } | { bound: string } | { event: 'subject' } | { info: string }
  /** The card that object was, wherever it is now ("Recycle me" in a Deathknell, "play it" after a banish) [124]. */
  | { now: RefAst }
  /** "this": the card whose text it is (an Equipment's effect text: the Equipment, not the unit). */
  | 'this'
  /** The objects a cost of this item exhausted or killed ("the unit you exhausted to pay for this ability"). */
  | { paid: 'exhaust' | 'kill' };
/** Where a token is played: "to your base", "here", or chosen as it is
    played (base or a battlefield you control [440.2.b.1]). */
export type LocAst = 'yourBase' | 'here' | 'choose' | { info: string }
  /** The battlefield a slot chose ("to a single battlefield"). */
  | { slot: string }
  /** Where the trigger's unit moved from ("When I move from a location, … there"). */
  | 'eventFrom';
/** Where a move instruction takes units: their base, here (the source's
    battlefield), a destination slot, the battlefield a trigger named. */
export type MoveToAst = 'base' | 'here' | { dest: string } | { info: string }
  /** The battlefield a slot chose ("then move your unit there"). */
  | { slotBf: string }
  /** Where the trigger's unit moved to (Stealthy Pursuer). */
  | 'eventTo'
  /** Where a referenced object is now (Zenith Blade: "to that enemy unit's battlefield"). */
  | { locOf: RefAst };
/** Effects on a player for a while (Confront, Stand United, Last Caress). */
export type PlayerEffectAst =
  | { s: 'entersReady'; types: CardType[]; uses?: number }
  | { s: 'buffValue'; n: number }
  | { s: 'playAnywhere'; types: CardType[]; uses: number }
  /** "Opponents can't play cards this turn." */
  | { s: 'cantPlay' }
  /** "The next spell you play this turn costs [5] less." */
  | { s: 'costLess'; types: CardType[]; energy: number; uses: number;
      /** Power symbols taken off too ("by [2][A]"). */
      power?: number;
      /** Only cards with Energy cost up to this ("a gear with Energy cost no more than [7]"). */
      maxEnergy?: number }
  /** Firelights Hideout: "the next unit you play this turn has [Accelerate]". */
  | { s: 'grantAccelerate'; uses: number }
  /** "The next spell you play this turn deals 1 Bonus Damage." */
  | { s: 'nextSpellBonus'; n: number; uses: number }
  /** "Prevent all spell and ability damage this turn." */
  | { s: 'preventNonCombat' }
  /** "You can hide cards ignoring costs this turn." */
  | { s: 'hideFree' }
  /** "Give the next spell you play this turn [Repeat] equal to its cost." */
  | { s: 'grantRepeat'; uses: number }
  /** "Its controller can't play spells this turn." */
  | { s: 'cantPlayTypes'; types: CardType[] }
  /** "Your non-token units cost [1] more to play this turn." */
  | { s: 'costMore'; types: CardType[]; energy: number; nonToken?: true };

/** `id` names an instruction for "if you do" (CondAst 'did'); `link` makes
    it linked to another, ignored if that one was [359.3.e.14.a]. */
export type InstrAst = { id?: string; link?: string } & (
  | { op: 'deal'; n: ValueAst; to: RefAst | SelAst }                             // [418]
  | { op: 'draw'; n: ValueAst; from?: RefAst }                                   // [414]; from: "draw one of them" [414.1]
  | { op: 'banish' | 'kill' | 'stun' | 'buff'; what: RefAst | SelAst;           // [428], [429], [424], [427]
      /** banish: "banished with this" [395–398], a link group. */
      linkGroup?: string }
  | { op: 'ready'; what: RefAst | SelAst }                                       // [416]
  | { op: 'burn'; n: number;                                                     // [441]
      /** The burned cards, bound ("When you burn a unit this way"). */
      bind?: string }
  | { op: 'might'; n: ValueAst; sign: 1 | -1; to: RefAst | SelAst; until: Until; floor?: number }   // [479.4], locked set
  | { op: 'playToken'; token: TokenId; n: ValueAst; at: LocAst; ready?: true; exhausted?: true;   // [440.2.c]
      /** "Its controller plays a Gold gear token": played by that object's controller (look-back if it left). */
      who?: { controllerOf: RefAst };
      /** For the item's controller inside a "for each player" block. */
      caster?: true;
      /** "Then ready up to N of them": the first N are played ready. */
      readyFirst?: number;
      /** "They become copies of …" [446]: each enters as a copy of that object (its copyable traits now). */
      copyOf?: RefAst;
      /** "Give it [Temporary]": keywords it has for good once it is on the board. */
      give?: KeywordAst[] }
  | { op: 'predict'; n: ValueAst }                                               // [437]
  | { op: 'look'; n: number; bind: string }                                      // [425]: the top N of your Main Deck
  | { op: 'pick'; from: string; n: number; bind: string;                       // a resolution-time choice [355.18]
      /** "You may …": none at all is an answer; only cards that fit `where` and Might up to `mightMax`. */
      min?: number; where?: PredAst[]; mightMax?: ValueAst;
      /** Only cards with Energy cost up to this ("If you revealed a card with the lowest Energy cost"). */
      energyMax?: ValueAst }
  | { op: 'recycleRest'; from: string; minus: string }                           // [417]
  | { op: 'discard'; n: number }                                                 // [423]
  | { op: 'channel'; n: ValueAst; exhausted?: true; caster?: true }              // [431]; caster: the item's controller
  | { op: 'playSelf'; cost: CostAst;                                            // a limited play of the source [420.3]
      /** "Then banish this": where it goes as it leaves the chain. */
      leaveChain?: 'banish' }
  /** Plays a card an instruction names [420.3]: from a trash, its Energy cost
      reduced ("Reduce its Energy cost by …"). */
  | { op: 'playCard'; what: RefAst; energyLess?: ValueAst;
      /** At the battlefield a referenced object is. */
      atRef?: RefAst;
      /** "ignoring its Energy cost" / "ignoring its cost" [420.3.b]. */
      free?: 'energy' | 'all';
      /** "for [A]": the cost instead of the printed one. */
      cost?: CostAst;
      /** A unit's location: "here" (the source's battlefield), its controller's base. */
      at?: 'here' | 'base';
      /** "its owner plays it". */
      by?: 'owner';
      /** "Then recycle it": where the spell goes as it leaves the chain. */
      leaveChain?: 'recycle';
      /** "plays it to any battlefield": any battlefield is a legal location (and only battlefields). */
      anyBf?: true;
      /** Every card the reference names, one play each, in order ("for each, its owner plays that unit"). */
      each?: true;
      /** "back to the same location or to their base": where it was before it left the board, or its base. */
      sameOrBase?: true;
      /** "its owner plays it to the same location": where it was before it left the board (its owner's base if that is gone). */
      sameLoc?: true }
  | { op: 'baseMight'; n: ValueAst; to: RefAst | SelAst; until: Until }          // layer 2 [479.2]
  | { op: 'grant'; kw: KeywordAst; to: RefAst | SelAst; until: Until;          // layer 3 [479.3]
      /** The keyword's value read now ("[Assault] equal to its Might"). */
      n?: ValueAst }
  | { op: 'if'; cond: CondAst; then: InstrAst[]; else?: InstrAst[] }             // [359.3.e]
  /** "You may …" inside a resolution: asked as it executes. */
  | { op: 'may'; then: InstrAst[] }
  | { op: 'delayed'; uses: number; ability: Omit<TriggeredAst, 'id'>;          // [390–393], "this turn"
      /** Referents captured now for the delayed ability ("that unit", "this battlefield") [391.5]. */
      capture?: Record<string, RefAst | 'eventBf' | 'hereBf'>;
      /** Not only this turn: until it has triggered its uses ("When they hold, return it to their hand"). */
      lasting?: true;
      /** Numbers captured now ("play that many Bomb tokens"), read by ValueAst info. */
      captureN?: Record<string, ValueAst> }
  | { op: 'draws'; n: number; who: { controllerOf: RefAst } | 'opponents' | 'caster' }   // "Its controller draws 2"
  | { op: 'move'; what: RefAst | SelAst; to: MoveToAst }                         // [421]
  | { op: 'returnToHand'; what: RefAst | SelAst }                                // to its owner's hand
  | { op: 'recycle'; what: RefAst }                                              // [417] a permanent or a card
  | { op: 'counter'; what: RefAst;                                               // [426]
      /** "Return it to its owner's hand instead of putting it in their trash." */
      to?: 'hand' }
  /** "They deal damage equal to their Mights to each other" [418.6.b.3]. */
  | { op: 'fight'; a: RefAst; b: RefAst }
  /** "It deals damage equal to its Might to …": the unit is the source. */
  | { op: 'dealFrom'; from: RefAst; to: RefAst }
  | { op: 'double'; what: RefAst; until: Until }                                 // [433] Might
  | { op: 'mill'; n: number }                                                    // top N of your Main Deck to your trash
  | { op: 'revealTop'; bind: string; n?: number }                               // [425]
  | { op: 'toHand'; what: RefAst }                                               // a revealed card to your hand
  | { op: 'gainXp'; n: ValueAst }                                                // [730.1]
  | { op: 'add'; energy?: number; power?: number; onlyFor?: 'spells' | 'gear' | 'permanents' | 'units';    // [430] (power: [A])
      /** Power of one domain ("[Add] [R]") instead of [A]. */
      domain?: Domain }
  | { op: 'win' }                                                                // [194.5]
  | { op: 'points'; n: number; who?: 'opponent' }
  /** Heals units: all damage removed [419]. */
  | { op: 'heal'; what: RefAst | SelAst }
  | { op: 'attach'; what: RefAst; to: RefAst }                                   // [435]
  | { op: 'detach'; from: RefAst }                                               // [436] an Equipment of that unit
  /** "Spend a buff": from one of these units, chosen as it executes [702.2.b]. */
  | { op: 'spendBuff'; from: SelAst | RefAst;
      /** Spend the buff of each of them (a bound set), not one. */
      all?: true }
  | { op: 'eachPlayerKills'; n: number;                                          // Cull the Weak
      /** "each opponent must kill one of their units" / "the defender must kill one of their units here". */
      who?: 'opponents'; at?: 'here';
      /** "If you paid my additional cost, you don't kill a unit this way." */
      exceptIf?: CondAst }
  /** A cost within an instruction, paid as it executes or declined [740.4.a]. */
  | { op: 'pay'; cost: CostAst;
      /** Paid by a referenced object's controller ("unless its controller pays [2]"). */
      who?: { controllerOf: RefAst } }
  /** Weaponmaster [821.1.c]: pay that Equipment's Equip cost less [A] to attach it to me. */
  | { op: 'equipToSelf'; what: RefAst }
  | { op: 'playerEffect'; spec: PlayerEffectAst; until: 'thisTurn';
      /** Whom it is on: you (default), each opponent, every player, a referenced object's controller. */
      who?: 'opponents' | 'all' | { controllerOf: RefAst } }
  /** A resolution-time choice of objects [355.18] ("spend any number of buffs", "choose 2 units"), bound by name;
      chosen by the instruction's player; `sumMightMax`: their total Might may not exceed it. */
  | { op: 'choose'; sel: SelAst[]; min: number; max: number; bind: string; sumMightMax?: number;
      /** Not what these slots chose ("another enemy unit"). */
      notSlots?: string[];
      /** "up to one … at each location". */
      oneEachLoc?: true;
      /** "with the same controller". */
      sameController?: true;
      /** Exactly this many, read now ("Banish that many units you control"). */
      count?: ValueAst;
      /** Only objects with less Might than this ("a unit with less Might than that unit had"). */
      mightBelow?: ValueAst }
  /** Each player in turn (from the controller, or from the next player), the body executed as that player:
      "you", "your", "friendly" are theirs [MP]; names bound inside are theirs (`name#p<id>`). */
  | { op: 'forEach'; who: 'each' | 'opponents'; from: 'you' | 'next'; body: InstrAst[] }
  /** A player picks one of the modes: the instruction's player, or a referenced object's controller. */
  | { op: 'choiceBy'; who: 'self' | 'opponent' | { controllerOf: RefAst }; modes: { label: string; body: InstrAst[] }[] }
  /** Each opponent reveals their hand [425]. */
  | { op: 'revealHand' }
  /** Their owners discard these cards [423]. */
  | { op: 'discardCards'; what: RefAst }
  /** The instruction's player discards their hand [423]. */
  | { op: 'discardHand' }
  /** Reveal from the top of your Main Deck until a card of these types [425]; `bind` it, `rest` the others. */
  | { op: 'revealUntil'; types: CardType[]; bind: string; rest: string }
  /** Reveal the top rune of your Rune Deck, then recycle it; its domains are bound [425], [417]. */
  | { op: 'revealRune'; bind: string }
  /** "Pay any amount of [A]": a number, then the payment; the amount is bound [740.4.a]. */
  | { op: 'payX'; bind: string; kind?: 'energy' }
  /** "Deal N damage split among any number of …": one point at a time [418]. */
  | { op: 'dealSplit'; n: ValueAst; to: SelAst;
      /** "It deals damage equal to its Might split among …": that unit is the source. */
      from?: RefAst }
  /** Recycle every object of these selectors but the kept ones (Divine Judgment). */
  | { op: 'recycleAllBut'; sel: SelAst[]; keep: string[] }
  /** "Gain control of a spell. You may make new choices for it." */
  | { op: 'retarget'; what: RefAst }
  /** "Move me to its location and it to my original location." */
  | { op: 'swap'; a: RefAst; b: RefAst }
  /** "Return your Chosen Champion from your trash to your Champion Zone if it is empty." */
  | { op: 'returnChampion' }
  /** "Activate the conquer effects of units here" [383.4.g]. */
  | { op: 'activateConquer' }
  /** "The next time that unit would be dealt damage this turn, prevent it." */
  | { op: 'preventNext'; what: RefAst }
  /** "Give another friendly unit my keywords" (layer 3, this turn). */
  | { op: 'grantKeywordsOf'; from: RefAst; to: RefAst }
  /** "Swap the Might of two units this turn." */
  | { op: 'swapMight'; a: RefAst; b: RefAst }
  /** "Put a card from your hand on the top of your Main Deck". */
  | { op: 'putOnTop'; what: RefAst }
  /** [Add] the amount a payX bound: Energy or [A]. */
  | { op: 'addX'; name: string; as: 'energy' | 'power' }
  /** Play every card in your banishment of a link group, ignoring costs (The Zero Drive); `anyOwner`: in any player's
      banishment ("play the banished card", Dockside Lock-Up). */
  | { op: 'playLinked'; group: string; anyOwner?: true }
  | { op: 'exhaust'; what: RefAst | SelAst }                                    // [415]
  /** "Take control of it" [479.2.a] (for the rest of the game). */
  | { op: 'gainControl'; what: RefAst;
      /** "Lose control of that unit": back to its owner. */
      toOwner?: true }
  | { op: 'recall'; what: RefAst | SelAst }                                     // [457]
  /** "Take a turn after this one" [734]. */
  | { op: 'extraTurn' }
  /** "Banish this": the spell is banished instead of going to the trash as it resolves. */
  | { op: 'banishThis' }
  /** "The next time it would die this turn, heal it, exhaust it, and recall it instead". */
  | { op: 'replaceDeath'; what: RefAst;
      /** "you may pay [R] to …": paid as it would die, if it can be (see PROGRESS rulings). */
      cost?: CostAst }
  /** "They can't move it this turn." */
  | { op: 'cantMove'; what: RefAst }
  /** "Its controller may play this spell again for [A]" / "You may play this from your trash for [A]": as the
      spell leaves the chain, that player plays it from the trash for the cost (declining at the payment). */
  | { op: 'replay'; who: 'self' | { controllerOf: RefAst }; cost: CostAst }
  /** "Put each in its trash": cards from a banishment or a hand to their owners' trashes. */
  | { op: 'toTrash'; what: RefAst | SelAst }
  /** "Double all damage that would be dealt to it this turn" [433]. */
  | { op: 'doubleDamage'; what: RefAst }
  /** Replace a battlefield with a battlefield token [439]; `back`: swap the token back [439.7]. */
  | { op: 'replaceBf'; token?: TokenId; at: 'eventBf' | 'here'; back?: true }
  /** "You can look at their facedown cards": the instruction's player looks at these [425]. */
  | { op: 'lookAt'; what: SelAst }
  /** "If it would die this turn, banish it instead" [367]. */
  | { op: 'banishIfDies'; what: RefAst }
  /** "Banish the top card of your Main Deck" [428]: the banished cards are bound. */
  | { op: 'banishTop'; n: number; bind: string }
  /** K'Sante: "Give a friendly unit 'I have [Assault] equal to my [Shield]' this turn" (layer 3, read all the time). */
  | { op: 'kwFromKw'; to: RefAst; kw: KeywordId; from: KeywordId }
  /** Dominus: "give it '[A][A]: Ready me.'" this turn: an ability this definition holds (grantedOnly) given to an object. */
  | { op: 'grantAbility'; ability: string; to: RefAst; until: Until }
  /** "Prevent the next 7 damage that would be dealt to it this turn" [438]. */
  | { op: 'preventAmount'; what: RefAst; n: number }
  /** Kennen: "give a spell in your trash [Flow] equal to its cost this turn". */
  | { op: 'grantFlow'; what: RefAst }
  /** Twilight Shroud: "It can't be chosen by enemy spells and abilities this turn." */
  | { op: 'protect'; what: RefAst }
  /** "Kill the rest": every object of a selector but the kept ones. */
  | { op: 'killAllBut'; sel: SelAst; keep: string[] }
  /** "Empower me" [442], "Disempower" [443]. */
  | { op: 'empower' | 'disempower'; what: RefAst }
  /** "Until your next Ending Phase, you may play that card" (Akali, Brash; Runeblade Anvil): the instruction's player may
      play these banished cards (paying their costs) until the next of their Ending Phases begins (Radiance FAQ). */
  | { op: 'allowPlay'; what: RefAst; until: 'nextEnding' }
);
/** How long an effect lasts [479]. */
export type Until = 'thisTurn' | 'thisCombat' | 'permanent';

export type TriggerAst =
  | { on: 'played'; who: 'self' }                                                // a Play Effect [383.4.a]
  | { on: 'cardPlayed'; by: 'you' | 'anyPlayer' | 'opponent';
      what?: { types?: CardType[]; minEnergy?: number; card?: true; fromFacedown?: true; minPower?: number;
        /** "another unit": not the source itself. */
        other?: true;
        /** "if you spent [4] or more" (Energy spent on it). */
        minSpent?: number;
        /** "another Dragon": with this tag. */
        tag?: string;
        /** "a token unit". */
        token?: true;
        /** "a gear with [Deploy]": printing this keyword. */
        keyword?: KeywordId;
        /** "a card from anywhere other than your hand". */
        notFromHand?: true };
      to?: 'here';                                                               // [420.4.a]; card: not a token [052]
      /** "For each player, the first time they …" [383.1.b]. */
      firstPerPlayer?: true }
  /** [383.4.e–f]: 'self'; 'friendly': any friendly unit; 'you' at 'here': a
      battlefield's "when you defend here". */
  | { on: 'attack' | 'defend'; who: 'self' | 'friendly' | 'you' | 'enemy'; at?: 'here' | 'yours' }
  /** [383.4.c–d]; 'any': wherever ("When you conquer"); 'score': either. */
  | { on: 'conquer' | 'hold' | 'score'; who: 'you' | 'opponent'; at: 'here' | 'any' }
  | { on: 'becomesExhausted'; what: 'self' | 'friendlyOther' }                    // an Exhaust action only [415]
  /** "When you draw 1 or more cards with 9 or more other cards in your hand". */
  | { on: 'drewWithHand'; others: number }
  /** "When my Might becomes 10 or more" (crossing it). */
  | { on: 'mightReaches'; n: number }
  /** "When you play … an activated ability with Energy cost [7] or more". */
  | { on: 'abilityPlayed'; minEnergy: number }
  /** "When I become ready" (by anything). */
  | { on: 'becomesReady'; who: 'self' }
  /** "When a combat that I was in ends". */
  | { on: 'combatEnded'; who: 'self' }
  /** "When I become [Empowered]" (self); "When you empower something else" (other) [442]. */
  | { on: 'empowered'; who: 'self' | 'other' }
  | { on: 'exhaustBatch'; by: 'you'; min: number }                               // friendly units in one Exhaust action
  | { on: 'unitDies'; nonToken?: true; at: 'here' | 'any' | 'battlefield'; who?: 'friendlyOther' | 'friendly' | 'enemy';
      /** Other permanents than units ("When a friendly gear … dies"). */
      types?: CardType[];
      /** One instance per dying unit (its LKI as `subject`), not one per player. */
      each?: true;
      /** The dying unit as it died: buffed, stunned, without a tag. */
      buffed?: true; stunned?: true; notTag?: string;
      /** "When you kill a unit (with a spell)": the kill's responsible player is you. */
      killedBy?: 'you' | 'yourSpell';
      /** "For each player, the first time each turn" [383.1.b]: counted per player of the dying unit. */
      firstPerPlayer?: true }
  | { on: 'dies'; who: 'self' }                                                  // Deathknell [808]: self-leave, LKI
  /** A delayed ability's "if this kills it": the unit it captured dies [388]. */
  | { on: 'objDies'; info?: string;
      /** "When it dies this turn": by any cause, not only this item. Without `info`: each unit the item's damage kills. */
      any?: true }
  | { on: 'phase'; at: 'beginning' | 'mainStart' | 'endOfTurn'; whose: 'your' | 'any' }   // [315.2.a], [316.4], [317.1.a]
  /** "When I move [to a battlefield]" (self); "When you move an enemy unit" (enemy, by you) [448]. */
  | { on: 'moved'; who: 'self' | 'enemy' | 'any' | 'friendlyOther' | 'opponent'; to?: 'bf' | 'otherBf';
      /** "moves from here" / "from my location"; "When I move from a battlefield". */
      from?: 'here' | 'bf' }
  | { on: 'discarded'; who: 'self' | 'you' }                                     // [423]: me (from the trash), or one or more of yours
  /** "When you ready a friendly unit" (by a spell or ability) [416]. */
  | { on: 'readied'; who: 'friendly' | 'self' }
  /** "When any unit takes damage" [418]; with `info`: the unit a delayed ability captured. */
  | { on: 'damaged'; info?: string }
  /** "When this leaves the board" [383.2.c.3]: self-leave, placed by the zone change itself. */
  | { on: 'leaves'; who: 'self' }
  /** "When you banish a card you own": by your spell, ability or cost, or a [Flow] card you played (owned: cards you own). */
  | { on: 'banished'; who: 'you'; owned?: true }
  /** The Dreaming Tree: "When a player chooses a friendly unit here with a spell for the first time each turn". */
  | { on: 'chosenBySpell'; at: 'here' }
  /** Nocturne: "As you look at or reveal me from the top of your deck". */
  | { on: 'seenOnTop'; reveal?: true }
  /** "When I win a combat" / "When you win a combat" [468.3]. */
  | { on: 'winCombat'; who: 'self' | 'you';
      /** "When you win a combat here". */
      at?: 'here';
      /** A delayed ability's "When it wins a combat this turn": the unit it captured. */
      info?: string }
  /** "When you choose a friendly unit", "When you choose me with a spell" [355.5]. */
  | { on: 'chosen'; who: 'self' | 'friendly'; spell?: true }
  /** "When you attach an Equipment to me" [435]. */
  | { on: 'attached'; who: 'self' }
  /** "When you recycle one or more cards to your Main Deck" [417]. */
  | { on: 'recycled' }
  /** "When you recycle a rune" [417.1.b]. */
  | { on: 'runeRecycled' }
  /** "When you spend a buff" [702.2.b]. */
  | { on: 'buffSpent' }
  /** "When you use an activated ability of a gear" [376]. */
  | { on: 'gearAbility' }
  | { on: 'returnedToHand'; at: 'here' }                                         // a unit here returned to a hand
  | { on: 'buffed'; who: 'friendly' | 'self' }                                   // you buff a friendly unit [427]
  | { on: 'stunned'; who: 'enemy'; at: 'battlefield' | 'any';
      /** "one or more": one instance per Stun action. */
      once?: true }                                                              // you stun an enemy unit [424]
  | { on: 'becomesMighty'; who: 'friendly' }                                     // [709]
  | { on: 'hid'; at: 'here' | 'any' }                                            // you hide a card here [422]
  /** "When a showdown begins here" [341]. */
  | { on: 'showdownStart'; at: 'here' }
  /** "When you draw your second card each turn". */
  | { on: 'drew'; nth: number }
  /** "When you reduce the Might of an enemy unit here by 1 or more" (an effect of yours lowering its Might). */
  | { on: 'mightReduced'; at: 'here' };

/** An ability's id as chain items and usage counters name it. */
export type AbilityRef = string;
export type { PlayerId };
