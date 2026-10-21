/*
 * The engine's errors. None of them is a rules outcome: a rules loop ends
 * the game with a result, a failed play rolls back. These mean the caller
 * or the engine got something wrong, and say what.
 */
import type { Choice } from './run.ts';

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** run() took more frame steps than EngineOptions.stepLimit allows: a
    procedure that never finishes, not a loop the rules know about. */
export class EngineLoopError extends EngineError {}

/** choose() was given a decision id that is not the pending one. */
export class StaleDecisionError extends EngineError {
  constructor(readonly choice: Choice, pending: number | null) {
    super(`decision ${choice.decision} is not pending (pending: ${pending ?? 'none'})`);
  }
}

/** choose() was given a key that is not among the pending options. */
export class IllegalOptionError extends EngineError {
  constructor(readonly choice: Choice) {
    super(`'${choice.key}' is not an option of decision ${choice.decision}`);
  }
}

/** A part of the engine that a later milestone (or another M0 module)
    provides. The message names what is missing and where it will live. */
export class NotImplementedError extends EngineError {
  constructor(what: string, where: string) {
    super(`${what} is not implemented yet (${where})`);
  }
}

/** assertInvariants() found a broken invariant (§3.14). */
export class InvariantError extends EngineError {
  constructor(readonly failures: string[]) {
    super(`invariants broken:\n  ${failures.join('\n  ')}`);
  }
}
