import type { DeckList, ObservedEvent, PlayerId, PlayerView } from '../game/index.ts';

/*
 * The messages of online play over the socket (/ws), both ways. The server
 * (server/games/online.ts) runs the game; the app sends answers and gets
 * its own seat's view back after every change.
 */

/** What a game is: a queue's (ranked, casual) or a tournament round's. */
export type Mode = 'ranked' | 'casual' | 'tournament';
export type QueueMode = Exclude<Mode, 'tournament'>;

export type ClientMsg =
  | { t: 'hello' }
  /** `deck`: the starter's id, or 'my:<id>' for a deck you built. */
  | { t: 'queue'; mode: QueueMode; deck: string }
  | { t: 'leave' }
  | { t: 'choose'; gameId: string; keys: string[] }
  | { t: 'concede'; gameId: string };

export interface RatingInfo { points: number; tier: string; division: number | null; games: number; placement: boolean }

export type ServerMsg =
  /** Where you are, on every (re)connect. */
  | { t: 'state'; queue: { mode: QueueMode; since: number } | null; game: string | null }
  | { t: 'queued'; mode: QueueMode; since: number }
  | { t: 'left' }
  /** A game: your seat, both names and both lists (open decklists, TR 401.5). */
  | { t: 'start'; gameId: string; seat: PlayerId; mode: Mode; names: [string, string]; decks: [DeckList, DeckList];
      /** A tournament's game: its name, round and the match score so far. */
      tournament?: { id: string; name: string; round: string; game: number; score: [number, number] } }
  /** Your view after a change, with what you observed in it; `full` replaces the log (after a reconnect). Deadlines are ms since the epoch. */
  | { t: 'update'; gameId: string; view: PlayerView; events: ObservedEvent[]; full: boolean; deadline: number | null; theirDeadline: number | null }
  | { t: 'end'; gameId: string; winner: PlayerId | null; reason: string; coins: number; rating: { before: RatingInfo; after: RatingInfo } | null }
  /** Your account changed from elsewhere (a sale, a gift, a prize): fetch it again. */
  | { t: 'account'; why: string }
  | { t: 'error'; message: string };
