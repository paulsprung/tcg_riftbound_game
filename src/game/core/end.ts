/*
 * The end of a game. Most wins are found in a cleanup [323.1]; a few end the
 * game at once: a concession [650], an effect that says a player wins or
 * loses [195], repeated burn-out points [432.3.c.1], and the engine's loop
 * caps (§8). All of them come here.
 */
import { clearFrames, setPending, setResult } from '../state/mut.ts';
import type { GameResult, GameState } from '../state/types.ts';
import { emit } from './events.ts';

/** Ends the game with a result; nothing runs after it. A game that is
    already over keeps its first result. */
export function endGame(s: GameState, x: { present: boolean }, r: GameResult) {
  if (s.result) return;
  setResult(s, r);
  setPending(s, null);
  clearFrames(s);
  // M2: reveal every facedown card as the game ends [196], [422.4].
  emit(s, x, { k: 'gameOver', result: r, rule: r.rule });
}
