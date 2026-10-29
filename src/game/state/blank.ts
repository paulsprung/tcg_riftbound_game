/*
 * An empty game: the players with empty zones, no battlefields, the turn
 * before turn 1, the generator seeded. createGame() starts from this and the
 * setup procedure fills it in [110–118]. The AI never imports this module
 * (it only ever gets states by determinizing its view, §11.3).
 */
import type { ModeConfig, RulesConfig } from '../config.ts';
import { ENGINE_VERSION } from '../version.ts';
import { firstIds } from './ids.ts';
import { seedState } from './rng.ts';
import type { GameHistory, GameState, PlayerId, PlayerState, RunePool, TurnLog, TurnState } from './types.ts';
import { copyJson } from './clone.ts';

export function emptyPool(): RunePool {
  return { energy: 0, power: { fury: 0, calm: 0, mind: 0, body: 0, chaos: 0, order: 0 }, universal: 0, restricted: [] };
}

function emptyPlayer(id: PlayerId): PlayerState {
  return {
    id, deckName: '', legend: [], champion: null, hand: [], deck: [], runeDeck: [], trash: [], banish: [], base: [],
    pool: emptyPool(), points: 0, xp: 0, identity: [], championTag: '', chosenChampionName: '', limitedDraw: false, extra: {},
  };
}

/** The per-turn log, empty, for turn n of an n-player game. */
export function emptyTurnLog(turn: number, players: number): TurnLog {
  const zeros = () => new Array<number>(players).fill(0);
  return {
    turn, playActions: [], finalized: [], played: [], abilitiesResolved: [], deaths: [], moves: [], exhausted: [],
    scored: [], points: [], targeted: [], combatsWon: [], hidden: [],
    draws: zeros(), discards: zeros(), xpGained: zeros(), powerSpent: zeros(),
  };
}

function setupTurn(): TurnState {
  return {
    n: 0, player: 0, additional: false, queue: [], firstPlayer: 0, phase: 'setup', step: 'none',
    priority: null, focus: null, passes: 0, focusPasses: 0, chainOrigin: null, tasks: [], inCleanup: false,
    resolving: null, cleanupRequested: false, expiration: { loops: 0, feprHappened: false }, decisionsThisTurn: 0,
  };
}

export function blankState(o: { seed: number; mode: ModeConfig; rules: RulesConfig; defsHash?: string }): GameState {
  const n = o.mode.players;
  const history: GameHistory = {
    turnsTaken: new Array<number>(n).fill(0),
    beginningPhasesStarted: new Array<number>(n).fill(0),
    channelPhasesTaken: new Array<number>(n).fill(0),
  };
  return {
    schema: 1, engine: ENGINE_VERSION, defsHash: o.defsHash ?? '', mode: copyJson(o.mode),
    rules: copyJson(o.rules), rng: seedState(o.seed), next: firstIds(),
    players: Array.from({ length: n }, (_, p) => emptyPlayer(p as PlayerId)),
    bfs: [], objects: {}, chain: [], turn: setupTurn(), showdown: null, combat: null, effects: [], delayed: [],
    usage: {}, log: emptyTurnLog(0, n), history, frames: [], pending: null, result: null, epoch: 0, out: [],
  };
}
