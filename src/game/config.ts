/*
 * What a game is set up with: the mode of play, the positions taken on the
 * rules' open questions, and the engine's own knobs. All of it is plain
 * data that a game record stores, so a replay runs under the same rules.
 *
 * Changing a default here changes how games play: bump ENGINE_VERSION.
 */
import type { DeckList } from './decks/decklist.ts';
import type { DefId, PlayerId } from './state/types.ts';

/** A mode of play [487]–[491]. Only the 1v1 Duel is played today; the
    others exist so the multiplayer hooks have something to switch on. */
export interface ModeConfig {
  id: 'duel' | 'match' | 'skirmish' | 'war' | 'magmaChamber';
  players: number;
  teams: PlayerId[][] | null;
  victoryScore: number;
  battlefieldsPerPlayer: number;
  /** Duel: one of each player's three, at random [487.5]. */
  battlefieldSelection: 'random' | 'choose';
  /** false in free-for-all 4 and 2v2. */
  firstPlayerContributesBattlefield: boolean;
  /** Duel: the second player channels one extra rune on their first turn,
      and nobody skips a draw [487.7]. */
  firstTurn: { extraRuneFor: 'second' | 'last'; firstPlayerSkipsFirstDraw: boolean };
  bestOf: 1 | 3 | 5;
}

export const DUEL: ModeConfig = {
  id: 'duel',
  players: 2,
  teams: null,
  victoryScore: 8,
  battlefieldsPerPlayer: 1,
  battlefieldSelection: 'random',
  firstPlayerContributesBattlefield: true,
  firstTurn: { extraRuneFor: 'second', firstPlayerSkipsFirstDraw: false },
  bestOf: 1,
};

/**
 * One position for each open question of the rules specs that has more
 * than one defensible answer (§8). Each value is recorded with the game and
 * has its own test. Questions with a single fixed answer are not flags;
 * they are listed in §8 and tested where they are implemented.
 */
export interface RulesConfig {
  /** The Champion Legend starts the game ready (Spec A Q1). */
  legendStartsReady: boolean;
  /** Built-in decks and games against the computer: exactly 40 (Spec A Q4). */
  deckSize: 'exactly40' | 'atLeast40';
  /** TR 407: a random designated player chooses, after seeing both
      battlefields; or plain random. */
  firstPlayer: 'random-designee-chooses' | 'random';
  hideInShowdownOpen: boolean;
  limitedPlaysBypassTiming: boolean;
  startOfCombatTriggersFirst: boolean;
  weaponmasterReduction: 'anyPower' | 'literalA';
  huntSingleTrigger: boolean;
  visionOnlyWhenPlayed: boolean;
  mightyCrossingReplaceable: boolean;
  accelerateMultiDomain: 'oneOfUnitDomains' | 'universal';
  clearContestedAfterNonCombatConquer: boolean;
  uncontrolledBattlefieldActivation: 'none' | 'turnPlayer';
  /** Engine safety: a game that hits one of these ends as a rules loop. */
  expirationLoopCap: number;
  turnDecisionCap: number;
  turnLimit: number;
  /** Fairness setting, shown on the game-over screen (§11.7). */
  aiKnowsHumanList: 'builtInOnly' | 'always' | 'never';
}

export const DEFAULT_RULES: RulesConfig = {
  legendStartsReady: true,
  deckSize: 'exactly40',
  firstPlayer: 'random-designee-chooses',
  hideInShowdownOpen: false,
  limitedPlaysBypassTiming: true,
  startOfCombatTriggersFirst: false,
  weaponmasterReduction: 'anyPower',
  huntSingleTrigger: true,
  visionOnlyWhenPlayed: true,
  mightyCrossingReplaceable: true,
  accelerateMultiDomain: 'oneOfUnitDomains',
  clearContestedAfterNonCombatConquer: true,
  uncontrolledBattlefieldActivation: 'none',
  expirationLoopCap: 50,
  turnDecisionCap: 2000,
  turnLimit: 200,
  aiKnowsHumanList: 'builtInOnly',
};

/** Knobs that change how fast the engine works, never what it decides. */
export interface EngineOptions {
  /** Search nodes per decision for the feasibility check (§4.6): 200 on
      desktop, 60 on phones. */
  feasibilityBudget: number;
  /** Frame steps one call to run() may take before it is treated as an
      engine bug (distinct from a rules loop). */
  stepLimit: number;
}

export const DEFAULT_ENGINE: EngineOptions = { feasibilityBudget: 200, stepLimit: 100_000 };

/** Everything a game is made from: with the answers, this is the game. */
export interface GameSetup {
  seed: number;
  /** Validated deck lists (§13.4); index = PlayerId. */
  decks: [DeckList, DeckList];
  /** Default: each deck's own chosen champion. */
  chosenChampion?: [DefId?, DefId?];
  /** Default DUEL. */
  mode?: ModeConfig;
  rules?: Partial<RulesConfig>;
  /** A fixed player is for tests and the Card Lab; default TR 407. `{ designee }`
      names the player who chooses: the loser of a match's last game (TR 407.4)
      or the higher seed in a playoff (TR 407.2.a). */
  firstPlayer?: 'random-designee-chooses' | 'random' | PlayerId | { designee: PlayerId };
  /** Tutorials and tests: cards put on top of each deck after the shuffle
      [114], top first (a scripted lesson needs a known draw order). */
  stack?: [DeckStack?, DeckStack?];
}

/** The cards on top of a player's decks, top first, by definition. */
export interface DeckStack { main?: DefId[]; runes?: DefId[] }

/** The rules a game runs under: the defaults with the setup's overrides. */
export function rulesFor(setup: Pick<GameSetup, 'rules'>): RulesConfig {
  return { ...DEFAULT_RULES, ...setup.rules };
}
