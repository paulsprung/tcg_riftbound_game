import type { DeckList, ObservedEvent, PlayerId, PlayerView } from '../game/index.ts';

/*
 * The messages of online play over the socket (/ws), both ways. The server
 * (server/games/online.ts) runs the game; the app sends answers and gets
 * its own seat's view back after every change.
 */

/** What a game is: a queue's (ranked, casual), a tournament round's, or one between friends. */
export type Mode = 'ranked' | 'casual' | 'tournament' | 'friendly';
export type QueueMode = 'ranked' | 'casual';
/** What friends see of each other. */
export type Presence = 'online' | 'queue' | 'game' | 'offline';

export type ClientMsg =
  | { t: 'hello' }
  /** `deck`: the starter's id, or 'my:<id>' for a deck you built. */
  | { t: 'queue'; mode: QueueMode; deck: string }
  | { t: 'leave' }
  | { t: 'choose'; gameId: string; keys: string[] }
  | { t: 'concede'; gameId: string }
  /** A friendly game: ask a friend, who answers with their deck (or no). */
  | { t: 'challenge'; to: string; deck: string }
  | { t: 'challenge-answer'; from: string; accept: boolean; deck?: string }
  | { t: 'challenge-cancel'; to: string };

export interface RatingInfo { points: number; tier: string; division: number | null; games: number; placement: boolean }

export type ServerMsg =
  /** Where you are, on every (re)connect. */
  | { t: 'state'; queue: { mode: QueueMode; since: number } | null; game: string | null }
  | { t: 'queued'; mode: QueueMode; since: number }
  | { t: 'left' }
  /** A game: your seat, both names, your list and of theirs only the name and legend (decklists are private, TR 401.5). */
  | { t: 'start'; gameId: string; seat: PlayerId; mode: Mode; names: [string, string]; decks: [DeckList, DeckList];
      /** A tournament's game: its name, round and the match score so far. */
      tournament?: { id: string; name: string; round: string; game: number; score: [number, number] } }
  /** Your view after a change, with what you observed in it; `full` replaces the log (after a reconnect). Deadlines are ms since the epoch. */
  | { t: 'update'; gameId: string; view: PlayerView; events: ObservedEvent[]; full: boolean; deadline: number | null; theirDeadline: number | null }
  | { t: 'end'; gameId: string; winner: PlayerId | null; reason: string; coins: number; rating: { before: RatingInfo; after: RatingInfo } | null }
  /** A friend asks you for a game; it lapses after a minute. */
  | { t: 'challenge'; from: { id: string; name: string } }
  /** A challenge you sent or got is over (declined, cancelled, lapsed). */
  | { t: 'challenge-gone'; with: string; why: string }
  /** A friend's presence or your friend requests changed: fetch the list again. */
  | { t: 'friends' }
  /** Your account changed from elsewhere (a sale, a gift, a prize): fetch it again. */
  | { t: 'account'; why: string }
  | { t: 'error'; message: string };
