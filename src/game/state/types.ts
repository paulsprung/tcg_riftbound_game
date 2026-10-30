/*
 * The game state (§3 of the engine design), and nothing else: no logic
 * lives here. All of it is plain JSON (numbers, strings, booleans, arrays
 * and records, never Map, Set, Date or functions), so a state can be
 * cloned, hashed, saved and replayed at any decision. Derived values
 * (Might, keywords, legality, the state of the turn) are never stored.
 *
 * Only state/mut.ts writes these structures (P15); everything else reads.
 * Rule numbers in brackets are Core Rules numbers.
 *
 * M0 uses the players, zones, objects, battlefields, the turn and the
 * frames. The chain, showdowns, combat, effects and the history are
 * declared now so M1 builds on settled shapes, but nothing writes them yet.
 */
import type { ModeConfig, RulesConfig } from '../config.ts';
import type { Decision } from '../core/decisions.ts';
import type { GameEvent } from '../core/events.ts';

// ---- 3.1 Identifiers and primitives ----

export type PlayerId = 0 | 1 | 2 | 3;  // up to four players (2v2 [491]); code loops over state.players, never assumes 2
export type ObjId = number;            // game-object identity: a NEW id on every move to or from a non-board zone
                                       // [124], and for every card in a shuffle or random placement (§7.2)
export type CardRef = number;          // the physical card or token for the whole game (ownership, records); never
                                       // appears in a view for an object the viewer doesn't know (§7)
export type ItemId = number;           // chain item
export type EffId = number;            // continuous effect, delayed ability, prevent tracker
export type DefId = string;            // oracle id = slug of the canonical name: 'riptide-rex'
export type AbilityId = string;        // `${DefId}#${n}` printed, `${DefId}#kw:deflect` keyword, `eff:${EffId}#${n}` granted
export type Domain = 'fury' | 'calm' | 'mind' | 'body' | 'chaos' | 'order';
export type CardType = 'unit' | 'gear' | 'spell' | 'rune' | 'battlefield' | 'legend';
export type Mask = number;             // bit p set = player p
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Zone =
  | { z: 'base'; p: PlayerId }                     // location [107.1]
  | { z: 'bf'; bf: number }                        // location; stable index into state.bfs [107.2]
  | { z: 'facedown'; bf: number }                  // board, not a location [107.3.e]
  | { z: 'legend'; p: PlayerId }                   // board, not a location [107.4]
  | { z: 'champion'; p: PlayerId }                 // non-board [108.3]
  | { z: 'hand' | 'deck' | 'runeDeck' | 'trash' | 'banish'; p: PlayerId }
  | { z: 'chain'; item: ItemId }
  | { z: 'gone' };                                 // token that ceased to exist [186.1]; deleted after the action
export type ZoneKind = Zone['z'];
export type Loc = { z: 'base'; p: PlayerId } | { z: 'bf'; bf: number };   // locations [198.1]

// ---- Effect-language placeholders ----
// The real shapes arrive with dsl/ast.ts in M1 (§9.2), which then replaces
// these aliases. Until then they are opaque JSON: state stays serializable
// and nothing in M0 reads them.

export type SelAst = Json;
export type StaticSpecAst = Json;
export type AbilityAst = Json;
export type EventPatternAst = Json;
export type CostAst = Json;
export type KeywordAst = Json;
export type EventModifier = Json;     // [375] modifiers a replacing event inherits
export type CostComponent = Json;     // a component of the total cost and its discounts [356]
export type PreventSpec = Json;       // [438]
export type PlayOverrides = Json;     // what a limited play's instruction changes [420.3.b]
export type Duration = 'thisTurn' | 'thisCombat' | 'permanent' | 'whileAttached' | { [k: string]: Json };
export type TokenId = 'recruit' | 'sprite' | 'sandSoldier' | 'mech' | 'gold' | 'reflection' | 'bird' | 'brush'
  | 'baronPit' | 'tentacle' | 'shadowClone' | 'bomb';                                             // [187]
export type KeywordId = 'accelerate' | 'action' | 'assault' | 'deathknell' | 'deflect' | 'ganking' | 'hidden' | 'legion'
  | 'reaction' | 'shield' | 'tank' | 'temporary' | 'vision' | 'equip' | 'quickDraw' | 'repeat' | 'weaponmaster' | 'ambush'
  | 'hunt' | 'level' | 'unique' | 'backline' | 'empower' | 'empowered' | 'flow' | 'deploy' | 'disarm' | 'showOff';

// ---- 3.2 The root ----

export interface GameState {
  schema: 1;
  engine: string;                     // ENGINE_VERSION at creation
  defsHash: string;                   // hash of the card definitions in effect
  mode: ModeConfig;                   // §3.13 (DUEL)
  rules: RulesConfig;                 // §8
  rng: number;                        // mulberry32 state (uint32). HIDDEN: views carry 0
  next: IdCounters;
  players: PlayerState[];
  bfs: BattlefieldState[];            // left to right; 2 in a Duel, may grow (Baron Pit token [187.9])
  objects: Record<ObjId, GameObject>; // every object in every zone, hidden ones included
  chain: ChainItem[];                 // [0] = oldest [337.1.b]; Closed state iff non-empty [309.1]
  turn: TurnState;
  showdown: ShowdownState | null;
  combat: CombatState | null;
  effects: ContinuousEffect[];        // created by resolved instructions ("this turn", prevents, grants)
  delayed: DelayedAbility[];          // [390–393]
  usage: Record<string, number>;
  /** Thresholds objects are at or above ("When my Might becomes 10 or more"): `${ObjId}|${n}` → 1. */
  marks?: Record<string, number>;      // `${ObjId}|${AbilityId}|${PlayerId|'*'}` → times this turn [383.3.e], [386]
  log: TurnLog;                       // per-turn history (§3.9)
  history: GameHistory;               // whole-game history (§3.9)
  frames: Frame[];                    // suspended procedures, top = last (§3.10)
  pending: Decision | null;           // the one open question (§4.2)
  result: GameResult | null;
  epoch: number;                      // bumped by every real mutation (P15)
  out: GameEvent[];                   // events since the last choice; drained by choose()
}

/** The next id of each kind. Ids start at 1 and are never reused, not even
    after a rollback, so an id names one thing for the whole game. */
export interface IdCounters {
  obj: number; card: number; item: number; eff: number; decision: number; ts: number; group: number;
  event: number;                      // GameEvent.seq
}

export interface GameResult {
  winner: PlayerId | null;            // null: a draw (rules loop, turn limit)
  reason: 'score' | 'burnout' | 'concede' | 'effect' | 'loop';
  rule: string;
  turn: number;
}

// ---- 3.3 Players, zones and the Rune Pool ----

export interface PlayerState {
  id: PlayerId;
  deckName: string;
  legend: ObjId[];                    // [0] = Champion Legend, pinned [107.4.d]; created legends after it (Neeko)
  champion: ObjId | null;             // Champion Zone, capacity 1, refilled only when empty [108.3.c.1]
  hand: ObjId[];                      // unordered for rules [108.7.d]; arrival order only for the owner's UI
  deck: ObjId[];                      // Main Deck, [0] = top [108.4]; order secret, count public [108.4.d]
  runeDeck: ObjId[];                  // [0] = top [108.5]; count public (§8, A Q2)
  trash: ObjId[];                     // unordered, public [108.2.c]
  banish: ObjId[];                    // unordered, public [108.6.d]
  base: ObjId[];                      // permanents and runes this player controls in base, arrival order [107.1.c]
  pool: RunePool;                     // [165–168]
  points: number;                     // ≥ 0 [194.4]
  xp: number;                         // ≥ 0, public [728–733]
  identity: Domain[];                 // from the legend [103.2.b] (informational in play)
  championTag: string;                // [133.8.b]
  chosenChampionName: string;         // [103.3.a.3]
  limitedDraw: boolean;               // a Limited deck without Legend and Chosen Champion draws 1 more (TR 602.4.a.5.b)
  extra: Record<string, string[]>;    // deck-building choices, e.g. Neeko's 3 legends [103.1]
}

export interface RunePool {
  energy: number;                     // [163.1]
  power: Record<Domain, number>;      // [163.2]
  universal: number;                  // [A] added (Gold, Gutter Guardian) [135.2.e.5.b]
  restricted: { amount: number; kind: 'energy' | Domain | 'universal'; onlyFor: SpendRestriction; source: DefId }[];
}
export type SpendRestriction = 'spells' | 'gear' | 'permanents' | 'units' | 'showdown' | { cardsWithTag: string };   // Kai'Sa, Ornn, Diana …

// ---- 3.4 Game objects ----
// One shape for cards, tokens, runes, legends and battlefields. Board-only
// fields are reset when an object moves to or from a non-board zone, because
// that creates a new object [124], [124.1].

export interface GameObject {
  id: ObjId;
  card: CardRef;                      // stable physical identity
  def: DefId;                         // what it is (views replace unknown objects by stubs, §7)
  printing: string | null;            // Card.id for art (the deck's chosen printing); null for tokens without one
  token: boolean;                     // [185]
  owner: PlayerId;                    // immutable [127]
  controller: PlayerId | null;        // null only for uncontrolled battlefields [190.2.b]
  zone: Zone;
  knownBy: Mask;                      // who knows `def` while it is in a hidden zone (§7.2); all bits in public zones
  ts: number;                         // timestamp of entering the current zone (static-ability timestamps [482])
  enteredTurn: number;

  // ---- board status [124.2] ----
  exhausted: boolean;                 // [415], [416]
  damage: DamageMark[];               // [142]; sum = damage marked
  buffs: number;                      // buff counters [701–705]; maximum from maxBuffs() (1 by default [702.3])
  stunned: boolean;                   // until ending-cleanup step 3d of this turn [424.1.a.2]
  empowered: number;                  // binary unless permitted [442.1.c.1]
  attachedTo: ObjId | null;           // non-units only [143.5], [718.6]
  designation: 'attacker' | 'defender' | null;   // [466.2.c.3], cleanup step 2 [323.2]
  facedown: { hiddenOnTurn: number; bf: number; by: PlayerId } | null;   // [811.1.b]
  revealedUntil: RevealWindow | null; // a reveal is a state, not a zone [425.1.a]
  moves: number;                      // moves this turn (Kayn, Yasuo, Windrider); reset at turn start
  mighty?: boolean;                   // Might ≥ 5 at the last cleanup, for "becomes Mighty" [709]; unset until then
  attachedTurn?: number;              // the turn it was last attached (Brutalizer)
  lastDamage: { item: ItemId | null; sources: ObjId[]; by: PlayerId | null; combat: boolean; spell?: boolean } | null;
                                      // kill attribution for cleanup kills [429.5.c]; cleared after the next cleanup
  // ---- memory that survives the zone change that created it ----
  played: PlayedRecord | null;        // finalization facts copied from the chain item at step 6 [135.2.b.7]
  links: { group: string; source: ObjId; zone: ZoneKind }[];   // "banished with this" [395–398], [428.3]
  named?: { kind: 'card' | 'tag' | 'type'; value: string };    // [759–763]
  copiedFrom?: DefId;                 // token created as a copy [446.3]
  /** A copy effect on this object [479.1] (Shady Spectacles): `def` holds the copied traits while the Equipment `via`
      stays attached; `orig` is what it is without the effect (restored as it ends, and when it leaves the board). */
  copyFx?: { orig: DefId; via: ObjId };
  /** A gear that is also a unit [137.3.b], [143.5] (Orianna, Lady of Clockwork): its base Might, and the legend whose
      effect made it one ("until you choose another gear with me"). */
  asUnit?: { might: number; by: ObjId };
  /** Created for a duration [440.3.b] (Neeko, Blending In's legend "while I'm on the board"): it ceases to exist as
      that object leaves the board. */
  existsWhile?: ObjId;
  aliasOf?: ObjId;                    // Replace keeps identity for references [439.1.a]
}

export interface DamageMark {
  amount: number;                     // ≥ 1 [418.1.e]
  by: PlayerId | null;                // player responsible for the Deal [142.3.a] ("your damage", Elder Dragon)
  sources: ObjId[];                   // units / spell / ability source objects [418.6]
  combat: boolean;
  group: number;                      // the Deal action that marked it
}

export interface PlayedRecord {       // what "was performed" while playing, read later as facts [135.2.b.7]
  item: ItemId; turn: number; by: PlayerId; turnPlayer: PlayerId;
  mode: 'discretionary' | 'limited';  // [420.2] / [420.3]
  from: ZoneKind; fromFacedownAt?: number;           // "played from face down" (Elnuk Herd, Evelynn legend) [811.1.d.3]
  to?: Loc;                                          // "played … to a battlefield" (Hold 'Em, Rakelstake)
  paidOptional: string[];                            // 'accelerate', 'repeat#1', 'add:<id>' — decided, not amount [356.4.f.1]
  showOff: ShownOffRecord[];                         // snapshots [832.1.d]
  energySpent: number; powerSpent: number;           // "if you spent [4] or more"
  costObjects: Record<string, Snapshot[]>;           // objects killed / discarded / exhausted as a cost
}
export interface ShownOffRecord { source: AbilityId; picks: Snapshot[]; fromHand: boolean[] }

export interface Snapshot {           // last-known information [383.2.c.3.b], look-back [359.3.e.13]
  id: ObjId; card: CardRef; def: DefId; owner: PlayerId; controller: PlayerId | null;
  zone: Zone; loc: Loc | null; chars: Chars; damage: number; buffs: number;
  exhausted: boolean; stunned: boolean; attached: ObjId[]; knownBy: Mask; epoch: number;
  /** [Empowered] as it was [442]. */
  empowered?: number;
}
export type RevealWindow = { until: 'itemLeavesChain'; item: ItemId } | { until: 'endOfInstruction'; item: ItemId }
                         | { until: 'moved' };

/** Derived characteristics after layers 1–4 (§6.7). Never stored on an
    object; only inside snapshots, which freeze them [383.2.c.3.b]. */
export interface Chars {
  name: string; types: CardType[]; supertypes: string[]; tags: string[]; domains: Domain[];
  cost: { energy: number; power: PowerReq[] } | null;   // printed or copied [206]
  might: number | null;           // effective, may be negative [143.2.c]; mightRef() clamps at 0
  baseMight: number | null;       // layer 2 [479.2]
  mightBonus: number | null;      // Equipment [137]
  keywords: Partial<Record<KeywordId, { value?: number; instances: number; active: boolean }>>;   // summed [807.2]
  abilities: ActiveAbility[];     // printed (active?), appended effect text, granted, keyword expansions; with ts
  controller: PlayerId | null;    // layer 2 [479.2.a]
}
/** Provisional; M1 (layers/derive.ts) settles the shape. */
export interface ActiveAbility { id: AbilityId; ts: number; active: boolean }

// ---- 3.5 Battlefields ----

export interface BattlefieldState {
  obj: ObjId;                         // the battlefield object itself (zone { z: 'bf', bf: i }) [199.1]
  controller: PlayerId | null;        // [190.2]
  contested: PlayerId | null;         // who applied Contested [190.3]; cards can't reference it [190.3.d]
  staged: { showdown: boolean; combat: boolean };   // cleanup steps 6–7a [323.7–323.9]
  here: ObjId[];                      // permanents at this battlefield (units, gear, attachments), arrival order
  facedown: ObjId[];                  // Facedown Zone; capacity from facedownCapacity() [107.3.b]
  scoredBy: Mask;                     // who scored it this turn [472]; inherited by Replace [439.1.a]
  replacedChain: ObjId[];             // objects this slot replaced, newest last (Brush swap back) [439.7]
}

// ---- 3.6 Turn, phases, state of the turn, priority and focus ----

export type Phase = 'setup' | 'awaken' | 'beginning' | 'channel' | 'draw' | 'main' | 'ending';   // [314–317]
export type Step = 'none' | 'beginningStep' | 'scoring' | 'endingStep' | 'expiration';
export type TurnStateName = 'NeutralOpen' | 'NeutralClosed' | 'ShowdownOpen' | 'ShowdownClosed';  // derived [310]

export interface TurnState {
  n: number;                          // global turn counter, 1-based; 0 during setup
  player: PlayerId;                   // Turn Player [304]
  additional: boolean;                // [734–738]
  queue: { player: PlayerId; additional: boolean }[];   // upcoming turns; additional turns unshift [738] example
  firstPlayer: PlayerId;
  phase: Phase; step: Step;
  priority: PlayerId | null;          // [312]
  focus: PlayerId | null;             // [313]; null whenever Neutral [313.5]
  passes: number;                     // consecutive priority passes on this chain. Reset to 0 when any item other
                                      // than an Add ability is added, and after each resolution [339.1], Spec C Q4
  focusPasses: number;                // consecutive focus passes in this showdown. Reset to 0 ONLY when a player plays
                                      // a card or activates a non-Add ability during the showdown [348], Spec C Q4;
                                      // triggered items and Add abilities never reset it
  chainOrigin: 'card' | 'activated' | 'triggered' | 'add' | null;   // what opened the chain [346.1]
  tasks: Task[];                      // Outstanding Tasks, FIFO [333]
  inCleanup: boolean;                 // [320]  (procedural: written without bumping epoch)
  resolving: ItemId | null;           // [321], [158.3]
  cleanupRequested: boolean;          // [321.1], [322]
  expiration: { loops: number; feprHappened: boolean };   // [317.2.e–f], capped (§8)
  decisionsThisTurn: number;          // loop guard (§8 turnDecisionCap); procedural
}
export type Task =
  | { t: 'cleanup'; v: 'normal' | 'combat' | 'ending' }
  | { t: 'phase'; id: PhaseTaskId }
  | { t: 'combat'; id: CombatTaskId }
  | { t: 'placeTriggers'; batch: PendingTrigger[]; order: 'turnOrder' | 'combat' }
  | { t: 'expirationCheck' };
export type PhaseTaskId = 'awaken.readyAll' | 'beginning.startEffects' | 'scoring.holdAll' | 'channel.channel'
  | 'draw.draw' | 'main.emptyPools' | 'main.startEffects' | 'ending.endOfTurnEffects' | 'ending.expire';
export type CombatTaskId = 'startOfCombat' | 'designations' | 'placeCombatTriggers' | 'damage' | 'combatCleanup'
  | 'result' | 'establishControl' | 'end';

// ---- 3.7 The chain ----

export interface ChainItem {
  id: ItemId;
  seq: number;                        // append order; pending items finalize oldest first [337.1.b]
  kind: 'card' | 'token' | 'activated' | 'triggered';
  sub: 'normal' | 'reflexive' | 'delayed';          // Spec E Q13 naming
  status: 'pending' | 'finalized';    // [329]
  controller: PlayerId;               // [191.3], [191.5]
  owner: PlayerId;                    // cards go to the owner's trash [359.3.d], [056]
  obj?: ObjId;                        // the card or token object while on the chain
  source?: ObjId;                     // ability source (an ability may target its source [355.9.c])
  sourceLki?: Snapshot;               // source info when the item was created (self-leave triggers [383.2.c.3.b])
  ability?: AbilityId;
  isAdd: boolean;                     // Add abilities finalize and resolve at once [430.2]
  play: PlayContext;
  trigger?: Record<string, Json>;     // referents captured when the trigger condition was met [359.3.f.3]
  outcomes: Record<string, Outcome>;  // per instruction id and execution [359.3.e.14]
  onLeaveChain?: 'banish' | 'recycle' | 'hand';    // Flow / "Banish this" delayed replacement [391.3.a], [829.1.b.1]
  /** "… may play this spell again for [A]": who plays it from the trash as it leaves the chain, for what. */
  replay?: { who: PlayerId; cost: Json };
  countered?: boolean;
}
export type Outcome = { o: 'executed' } | { o: 'partial' } | { o: 'negated'; why: 'replaced' | 'skipped' | 'impossible'
  | 'prevented' | 'noop' | 'declined' } | { o: 'ignored'; why: 'targets' | 'nullInfo' | 'linked' };   // [359.3.e.6]

export interface PlayContext {
  mode: 'discretionary' | 'limited';  // [420.2] vs [420.3]
  instructedBy?: { item: ItemId; instr: string; overrides: PlayOverrides };   // limited plays [420.3.b]
  step: 1 | 2 | 3 | 4 | 5 | 6;
  origin: Zone;                       // where it came from (failed plays return there [806.4.b])
  closedTheState: boolean;            // [354.1], [358.4]
  atStart: { showdown: boolean; turnPlayer: PlayerId; phase: Phase };
  choices: PlayChoices;               // step 2
  cost?: TotalCost;                   // step 3
  paid: PaidRecord[];                 // step 4, replaced payments included [357.2.a]
  facts: PlayedRecord;                // built during steps 2–6; copied to the permanent at step 6 [135.2.b.7]
  lookBack: Record<ObjId, Snapshot>;  // objects this item moved as cost or effect [359.3.e.13]
  restrictions: TargetRestriction[];  // added restrictions (Hidden battlefield) that also bind new choices [753.3]
  snap2?: GameState | null;           // limited plays only: rollback snapshot taken at step 2 (Spec D §8.5); views null it
}

export interface PlayChoices {
  asPlayed: Record<string, Json>;     // Show Off picks, "pick a domain", named tag [355.1], [832]
  optionalCosts: Record<string, boolean>;          // 'accelerate', 'repeat#1', 'add:<id>' [355.1.a]
  baseCostOption?: number;            // alternative base costs [204.1.b], Flow choices [829.1.c.3]
  location?: Loc;                     // units, Deploy gear [355.2]
  executions: { modes: number[]; dests: Record<string, Loc>; targets: Record<string, TargetRef[]> }[];
                                      // [0] normal; [1..] one per paid Repeat [820.2]
}
export type TargetRef =
  | { k: 'obj'; id: ObjId; zone: ZoneKind; loc?: Loc }    // zone/location at choice time [359.3.e.2]
  | { k: 'item'; id: ItemId }                             // finalized chain items only [355.9.a.2]
  | { k: 'player'; p: PlayerId }
  | { k: 'zone'; zone: Zone };
export interface TargetRestriction { slot: string | '*'; at?: { bf: number }; rule: string; unlessImpossible: boolean }
export interface TotalCost { energy: number; power: PowerReq[]; other: CostAst[]; components: CostComponent[] }
export type PowerReq = { k: 'domain'; d: Domain } | { k: 'anyOf'; ds: Domain[] } | { k: 'any' };   // [A] = any
export interface PaidRecord { what: string; replaced: boolean; objs: Snapshot[]; energy: number; power: number }

// ---- Payment plans (§4.5); rules/resources.ts builds them in M1 ----

export interface PaymentPlan {
  key: string;                                  // 'pay:0' … in rank order
  fromPool: PoolSpend;                          // what is taken from the existing pool first
  steps: { obj: ObjId; ability: 'exhaust' | 'recycle' | AbilityId }[];   // Add activations, in order [430.2]
  attrition: number;                            // runes recycled + tokens killed (Gold)
  leaves: { readyRunes: number; runesOnBoard: number; byDomain: Record<Domain, number>; pool: RunePool };
}
/** Provisional; M1 settles it with rules/resources.ts. */
export interface PoolSpend { energy: number; power: Partial<Record<Domain, number>>; universal: number; restricted: number[] }

// ---- 3.8 Showdowns and combat ----

export interface ShowdownState { bf: number; kind: 'nonCombat' | 'combat' }      // [341–348]

export interface CombatState {                                                     // Spec G §1.3
  bf: number;
  step: 'showdown' | 'damage' | 'resolution';
  openedNewShowdown: boolean;          // way 1 vs way 2 [466.1]
  attacker: PlayerId; defender: PlayerId;
  everAttacker: ObjId[]; everDefender: ObjId[];    // once-per-combat attack/defend triggers [383.4.e.2.a]
  assigned: { by: PlayerId; to: ObjId; raw: number; applied: number; used: EffId[] }[];   // [467.2.c.5]
  excess: number[];                    // excess per player (Tryndamere, Vi, Sivir, Yeti Brawler)
  recalled: boolean; tie: boolean;     // [468.1.a.2], [740.3.a]
  result?: ('won' | 'lost' | 'noResult')[];       // [468.3]
  next: CombatTaskId | null;           // the combat step the master loop enqueues once nothing else is left
                                       // (§5.10.3 item 2); an addition to the design
}

// ---- 3.9 Continuous effects, delayed abilities, history ----

export interface ContinuousEffect {
  id: EffId; ts: number;               // timestamp when it began applying [482.1]
  controller: PlayerId;
  source: ObjId | null; item: ItemId | null; rule?: string;
  layer: 1 | 2 | 3 | 4; sub?: 'inc' | 'dec';      // [479], [479.4.e]
  affects: { objs: ObjId[] } | { sel: SelAst } | { player: PlayerId };   // locked set vs re-evaluated selector
  spec: StaticSpecAst;                 // §9.2
  frozen?: number;                     // snapshotted delta for non-passive limits [479.4.b], Double [433.1.a]
  until: Duration;
}

export interface DelayedAbility {
  id: EffId; controller: PlayerId;     // the creating item's controller at creation (Spec E Q10)
  createdBy: ItemId | null; createdTurn: number;
  ability: AbilityAst;                 // any kind [391.1]
  window:
    | { at: 'endOfTurn' | 'startOfNextMain' | 'nextBeginning'; player?: PlayerId }   // fires once at that time point
    | { during: 'thisTurn' | 'game' | { whileObj: ObjId; zone: ZoneKind } | { whileOnChain: ItemId };
        uses?: number;                 // Fanfare: 3 triggers; Last Caress: 1
        consumedBy?: EventPatternAst };   // a permission used up by an event (Last Caress: the Play action [420.5])
  link?: string;                       // linked abilities ("When you play it, [Buff] it") [395–398]
  info: Record<string, Json>;          // referents captured at creation [359.3.f.3.a]
}

export interface TurnLog {             // reset at turn start; the per-turn memory cards ask about
  turn: number;
  playActions: { p: PlayerId; item: ItemId; card: CardRef | null; isCard: boolean }[];          // [420.5]
  finalized:   { p: PlayerId; card: CardRef; isCard: boolean; types: CardType[] }[];          // Legion [812.1.c], [420.4.b]
  played:      { p: PlayerId; card: CardRef | null; def: DefId; isCard: boolean; types: CardType[];
                 from: ZoneKind; to?: Loc; energySpent: number; powerSpent: number; countered: boolean }[];   // [420.4.a]
  abilitiesResolved: { p: PlayerId; source: ObjId; ability: AbilityId }[];
  deaths: { snap: Snapshot; group: number; inCombat: boolean; at: Loc | null;
    /** The phase it died in ("during your Beginning Phase"). */
    phase?: Phase }[];
  moves:  { obj: ObjId; from: Loc; to: Loc; by: PlayerId | null; standard: boolean; group: number }[];
  exhausted: { p: PlayerId; objs: ObjId[]; group: number; byCost: boolean }[];   // one row per exhaust action
  scored: { p: PlayerId; bf: number; how: 'conquer' | 'hold'; point: boolean; units?: ObjId[] }[];
  points: { p: PlayerId; n: number; why: 'conquer' | 'hold' | 'effect' | 'burnOut' }[];
  targeted: { item: ItemId; by: PlayerId; obj: ObjId; spell: boolean; enemy?: boolean }[];         // "chose an enemy unit this turn"
  combatsWon: { p: PlayerId; bf: number; units: ObjId[] }[];
  hidden: { p: PlayerId; bf: number }[];
  /** 2v2: the battlefields the Turn Player's teammate controlled at this turn's Scoring Step; the team
      can't score them this turn [491] (null until that step). */
  allyHeld: number[] | null;
  draws: number[]; discards: number[]; xpGained: number[]; powerSpent: number[];   // per player
  /** Cards (by CardRef) whose spell or ability dealt damage this turn, one entry per Deal (Dancing Grenade). */
  cardDeals?: CardRef[];
  /** Objects dealt damage this turn ("if I haven't been dealt damage this turn"). */
  damaged?: ObjId[];
}
export interface GameHistory {
  turnsTaken: number[];                // per player: "first turn" (Otterpus, Ol' Poro)
  beginningPhasesStarted: number[];    // "first Beginning Phase" (Obelisk, The Arena's Greatest) [190.6.b]
  channelPhasesTaken: number[];        // 1v1 extra rune [487.7]
}

// ---- 3.10 Frames and the pending decision ----
// Every procedure that can pause for a decision is a frame: a tag, a
// program counter and plain locals. The step functions live in code tables
// keyed by the tag (core/frames.ts); the frame holds only data, which is
// what makes cloning a state mid-combat or mid-payment just cloning JSON.

export type Frame = FrameBody & {
  answer?: string;                     // the key chosen for the decision this frame asked; read once
  await?: 'tasks';                     // run every outstanding task above this frame first (§5.1, fix F2)
  ret?: Json;                          // what the child frame that just finished handed back (call/ret)
};
export type FrameBody =
  | { f: 'setup'; pc: number; p?: PlayerId; locals: Json }   // [110–118]; locals: setup's own bookkeeping
  | { f: 'priority'; pc: number; window: 'main' | 'chain' | 'showdown' }   // the master loop's question (§5.2)
  | { f: 'task'; task: Task; pc: number; locals: Json }               // one outstanding task (phase, combat step,
                                                                      // expiration check) being handled
  | { f: 'cleanup'; v: 'normal' | 'combat' | 'ending'; pc: number; epoch0: number }   // [322] via epoch (§5.9)
  | { f: 'play'; item: ItemId | null; obj: ObjId; pc: number; snap: GameState | null; revealed: boolean;
      rngUsed: boolean }                                              // [354–359]; snap = S0 (§4.4)
  | { f: 'ability'; item: ItemId; pc: number; snap: GameState | null;     // [402–407]
      src: ObjId | null; ability: AbilityId | null }                  // an activation's source and ability (additions)
  | { f: 'resolve'; item: ItemId; ip: number[]; env: Env }            // interpreter: instruction path + bindings
  | { f: 'instr'; op: string; pc: number; locals: Json }               // an instruction waiting for an answer
  | { f: 'perform'; spec: GameAction; ctx: ActionCtx; pc: number; ev: ProposedEvent[]; used: string[] }   // §6.3
  | { f: 'triggers'; batch: PendingTrigger[]; placed: number[]; pc: number; order: 'turnOrder' | 'combat' }
  | { f: 'move'; by: PlayerId; units: ObjId[]; dest: Loc | null; pc: number; snap: GameState | null }
  | { f: 'hide'; by: PlayerId; obj: ObjId; bf: number | null; pc: number; snap: GameState | null; alt?: number }
  | { f: 'pay'; who: PlayerId; cost: TotalCost; purpose: 'play' | 'applied' | 'instruction'; pc: number }
  | { f: 'assign'; by: PlayerId; order: ObjId[]; tier: Record<ObjId, 'tank' | 'backline'>; pc: number;
      total: number; excess: ObjId[] }                                // [467.2.c]; total and excess: additions
  | { f: 'custom'; handler: string; pc: number; locals: Json };      // tier-3 cards (§9.6)
export type FrameTag = FrameBody['f'];

export interface Env {
  self: ObjId | null; thisObj: ObjId | null;       // "I/me" vs "this" (Effect Text [136.2.d])
  controller: PlayerId;
  bound: Record<string, Json>;                     // 'it', 'that unit', looked-at cards, chosen counts, X
  execution: number;                               // Repeat execution index [820]
  as?: PlayerId;                                   // the player a "for each player" step is executed as
}

// ---- Game actions, the pipeline and triggers (§6), declared for M1 ----

export type GameAction =
  | { v: 'draw'; p: PlayerId; n: number; from?: ObjId[] }                 // [414]; from: "draw one of them" (Encore)
  | { v: 'exhaust' | 'ready'; objs: ObjId[] }                              // [415], [416]; ONE event group per action
  | { v: 'recycle'; objs: ObjId[]; order?: ObjId[] }                       // [417]; bottom of deck; random order if several [417.5]
  | { v: 'deal'; to: ObjId[]; n: number | number[]; sources: ObjId[]; combat?: true; split?: true }   // [418], [712–715]
  | { v: 'heal'; objs: ObjId[]; n?: number }                               // [419]
  | { v: 'move'; units: ObjId[]; to: Loc | Loc[]; standard: boolean }      // [421], [447–455]
  | { v: 'recall'; objs: ObjId[]; exhausted?: true }                       // [456–460]
  | { v: 'hide'; card: ObjId; bf: number }                                 // [422]
  | { v: 'discard'; p: PlayerId; objs: ObjId[] }                           // [423]
  | { v: 'stun' | 'buff' | 'spendBuff' | 'empower' | 'disempower'; objs: ObjId[] }   // [424], [427], [442], [443]
  | { v: 'reveal' | 'look'; objs: ObjId[]; to: Mask; until: RevealWindow }  // [425]; look = reveal to one player
  | { v: 'counter'; item: ItemId }                                         // [426]
  | { v: 'banish'; objs: ObjId[]; link?: string }                          // [428]
  | { v: 'kill'; objs: ObjId[]; passive?: true }                           // [429]; passive = cleanup kill [429.1.a.2]
  | { v: 'add'; p: PlayerId; energy: number; power: (Domain | 'universal')[]; restriction?: SpendRestriction }   // [430]
  | { v: 'channel'; p: PlayerId; n: number; exhausted?: boolean }          // [431]
  | { v: 'double' | 'swap'; objs: ObjId[]; what: 'might' | KeywordId }     // [433], [434]
  | { v: 'attach'; obj: ObjId; to: ObjId; viaEquip?: true } | { v: 'detach'; obj: ObjId }   // [435], [436]
  | { v: 'predict'; p: PlayerId; n: number }                               // [437]
  | { v: 'prevent'; spec: PreventSpec }                                    // [438] creates a tracker effect
  | { v: 'replace'; bf: number; with: TokenId } | { v: 'swapBack'; bf: number }   // [439]
  | { v: 'create'; token: TokenId; at: Loc | 'bfZone'; controller: PlayerId }      // [440.5] "add … to the board"
  | { v: 'playToken'; token: TokenId; p: PlayerId; at?: Loc; ready?: true; exhausted?: true; give?: KeywordAst[] }   // [440.2.c]
  | { v: 'burn'; p: PlayerId; n: number }                                  // [441]
  | { v: 'skip'; what: EventPatternAst; until: Duration }                  // [444]
  | { v: 'pay'; p: PlayerId; plan: PaymentPlan; cost: TotalCost }          // [445]
  | { v: 'copy'; obj: ObjId; of: ObjId; until: Duration }                  // [446]
  | { v: 'gainPoints' | 'losePoints'; p: PlayerId; n: number; why: 'conquer' | 'hold' | 'effect' | 'burnOut' }
  | { v: 'gainXp' | 'spendXp'; p: PlayerId; n: number }                    // [728–733]
  | { v: 'gainControl'; obj: ObjId; p: PlayerId; until: Duration }         // layer-2 effect + recall check
  | { v: 'zone'; obj: ObjId; to: Zone; why: 'returnToHand' | 'putOnDeck' | 'putInTrash' | 'toChain' | 'facedown' }
  | { v: 'shuffle'; p: PlayerId; zone: 'deck' | 'runeDeck'; add?: ObjId[] }
  | { v: 'extraTurn'; p: PlayerId };                                       // [734–738]

export interface ActionCtx {
  mode: 'cost' | 'effect' | 'procedure';   // cost: complete in full or unpayable [203.3]; effect: as much as possible [055]
  responsible: PlayerId | null;            // [412.1–412.3]; Turn Player for "The Turn Player Xs" tasks (Spec E Q11)
  attribution: ObjId[];                    // spell/ability + parent object [412.5], [429.5.d]
  item: ItemId | null; instr?: string; rule: string;
  inherited?: EventModifier[];             // [375]
  lineage?: string[];                      // replacements already applied to this event's ancestors [370.2]
}

/** One proposed change inside a perform group, before replacements apply
    (§6.3). Provisional; actions/perform.ts settles it in M1. */
export interface ProposedEvent {
  v: GameAction['v'];
  group: number;
  subject: { obj: ObjId } | { player: PlayerId } | { item: ItemId } | null;
  data: Record<string, Json>;
  replaced: boolean;
}

export interface PendingTrigger {
  ability: AbilityId;
  source: ObjId | null;               // null: a delayed ability's, which has no source object [391]
  controller: PlayerId;
  info: Record<string, Json>;         // trigger-condition referents (where I moved from, the dying unit's LKI) [359.3.f.3]
  named?: 'play' | 'targeting' | 'conquer' | 'hold' | 'attack' | 'defend';   // [383.4]
  synthetic?: boolean;                // "activate the conquer effects" [383.4.g] (multipliers ignore it)
  group: number;
  delayed?: EffId;                    // the delayed ability that triggered (one of its uses) [391.4]
  lki?: Snapshot;                     // a self-leave trigger's source as it left the board [383.2.c.3.b]
}
