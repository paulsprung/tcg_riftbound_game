import type { DeckList, ObservedEvent, PlayerId, PlayerView } from '../game/index.ts';

/*
 * The messages of online play over the socket (/ws), both ways. The server
 * (server/games/online.ts) runs the game; the app sends answers and gets
 * its own seat's view back after every change.
 */

/** What a game is: a queue's (ranked, casual), a tournament round's, or one between friends. */
export type Mode = 'ranked' | 'casual' | 'sealed' | 'draft' | 'tournament' | 'friendly';
/** sealed and draft: casual games with a deck built from a Limited pool (deck 'limited:<pool id>'). */
export type QueueMode = 'ranked' | 'casual' | 'sealed' | 'draft';
/** What friends see of each other. */
export type Presence = 'online' | 'queue' | 'game' | 'offline';

export type ClientMsg =
  | { t: 'hello' }
  /** `deck`: the starter's id, or 'my:<id>' for a deck you built. */
  | { t: 'queue'; mode: QueueMode; deck: string }
  | { t: 'leave' }
  | { t: 'choose'; gameId: string; keys: string[] }
  | { t: 'concede'; gameId: string }
  /** A lobby, as in the League client: invite friends from the custom game (or casual 2v2), they join,
      pick a deck and ready up; the host starts when everyone is ready. */
  | { t: 'lobby-invite'; to: string; mode: LobbyMode }
  | { t: 'lobby-answer'; lobby: string; accept: boolean }
  | { t: 'lobby-deck'; deck: string }
  | { t: 'lobby-ready'; ready: boolean }
  | { t: 'lobby-start' }
  | { t: 'lobby-leave' }
  | { t: 'lobby-kick'; who: string };

/** Where a lobby plays: the custom game (1v1 between friends), or casual 2v2 (with a teammate, soon). */
export type LobbyMode = 'custom' | 'casual';
export interface LobbyMember { id: string; name: string; host: boolean; ready: boolean; deck: { ref: string; name: string; legend: string } | null }
export interface LobbyView { id: string; mode: LobbyMode; members: LobbyMember[]; max: number; inGame: boolean; invited: { id: string; name: string }[] }

export interface RatingInfo { points: number; tier: string; division: number | null; games: number; placement: boolean }

export type ServerMsg =
  /** Where you are, on every (re)connect. */
  | { t: 'state'; queue: { mode: QueueMode; since: number } | null; game: string | null }
  | { t: 'queued'; mode: QueueMode; since: number }
  | { t: 'left' }
  /** A game: your seat, both names, your list and of theirs only the name and legend (decklists are private, TR 401.5). */
  | { t: 'start'; gameId: string; seat: PlayerId; mode: Mode; names: string[]; decks: DeckList[];
      /** A tournament's game: its name, round and the match score so far. */
      tournament?: { id: string; name: string; round: string; game: number; score: number[] } }
  /** Your view after a change, with what you observed in it; `full` replaces the log (after a reconnect). Deadlines are ms since the epoch. */
  /** A change in a game: your view; when the pending decision times out (yours or theirs), when its free
      grace time ends and both time banks (yours first) as they stood when it was asked. */
  | { t: 'update'; gameId: string; view: PlayerView; events: ObservedEvent[]; full: boolean; deadline: number | null; theirDeadline: number | null;
    clock: { grace: number | null; banks: number[] } }
  | { t: 'end'; gameId: string; winner: PlayerId | null; reason: string; coins: number; bonus: number; rating: { before: RatingInfo; after: RatingInfo } | null }
  /** Your lobby as it is now (after every change); null: you are in none. */
  | { t: 'lobby'; lobby: LobbyView | null }
  /** A friend invites you to their lobby; it lapses after a minute. */
  | { t: 'lobby-invite'; lobby: string; mode: LobbyMode; from: { id: string; name: string } }
  | { t: 'lobby-invite-gone'; lobby: string; why: string }
  /** A friend's presence or your friend requests changed: fetch the list again. */
  | { t: 'friends' }
  /** Your account changed from elsewhere (a sale, a gift, a prize): fetch it again. */
  | { t: 'account'; why: string }
  | { t: 'error'; message: string };
