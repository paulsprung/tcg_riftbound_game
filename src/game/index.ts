/*
 * The engine's public API (§4.1). The UI and its host use the engine through
 * this module only (src/play imports nothing else from src/game): they read
 * views, send option keys and animate the events that come back. The engine
 * never runs on its own; every call returns once it has run to the next
 * decision or the end of the game.
 *
 *   const { state } = createGame(setup);
 *   const view = viewFor(state, me);            // what `me` may know
 *   const d = state.pending;                    // the one open question
 *   const next = choose(state, { decision: d.id, key: d.options[0].key });
 */
import { NotImplementedError } from './core/errors.ts';
import type { Reason } from './core/decisions.ts';
import type { PlayerView } from './core/view.ts';
import type { ObjId } from './state/types.ts';

export { createGame } from './core/create.ts';
export { choose, concede } from './core/run.ts';
export { knows, observe, viewFor } from './core/view.ts';
export { cloneState, hashState } from './state/clone.ts';
export { replay, RecordMismatchError } from './record.ts';

/** Why an object can't be used right now, for UI tooltips; runs on the
    viewer's own information (§12.7). Not in M0: arrives with M1. */
export function explainUnavailable(_v: PlayerView, _obj: ObjId): Reason[] {
  throw new NotImplementedError('explainUnavailable', 'not in M0; arrives with M1 (§12.7)');
}

export { ENGINE_VERSION } from './version.ts';
export { DEFAULT_ENGINE, DEFAULT_RULES, DUEL, rulesFor } from './config.ts';
export { K, compareKeys, isValidKey, parseKey } from './core/decisions.ts';
export {
  EngineError, EngineLoopError, IllegalOptionError, InvariantError, NotImplementedError, StaleDecisionError,
} from './core/errors.ts';
export { SetupError } from './rules/setup.ts';

// The cards and the decks (§9.1, §13): what the setup screen, the table
// and later the deck builder read. Card names, wording and printings come
// from the oracle, never from cards.json directly.
export { ORACLE, defOfPrinting, findCard, oracleCard, printedKeywords } from './cards/oracle.ts';
export { TOKENS } from './cards/tokens.ts';
export { FORMATS, SET_RELEASES } from './cards/legality.ts';
export { copiesOf, deckDefs, mainCount, runeCount } from './decks/decklist.ts';
export {
  BATTLEFIELDS_PER_DECK, isLegalDeck, isUnmodifiedPrecon, RUNES_PER_DECK, validateDeck,
} from './decks/validate.ts';
export { EVELYNN_PRECON, PRECONS, SERAPHINE_PRECON } from './decks/precons.ts';

export type { EngineOptions, GameSetup, ModeConfig, RulesConfig } from './config.ts';
export type { DeckEntry, DeckList } from './decks/decklist.ts';
export type {
  DeckRule, KeywordLine, OracleCard, OracleCost, OracleFile, OracleKeyword, Supertype,
} from './cards/oracle.ts';
export type { TokenTemplate } from './cards/tokens.ts';
export type { Ban, Format, FormatInfo } from './cards/legality.ts';
export type { DeckMode, Issue, IssueCode, ValidateOptions } from './decks/validate.ts';
export type { Precon } from './decks/precons.ts';
export type { GameRecord } from './record.ts';
export type { Choice, StepOptions, StepResult } from './core/run.ts';
export type {
  AskSpec, Decision, DecisionKind, DecisionStub, Option, OptionMeta, ParsedKey, Prompt, Reason, Ref,
} from './core/decisions.ts';
export type { EventBody, EventKind, GameEvent } from './core/events.ts';
export type { Alias, ObservedEvent, PlayerView, Stub } from './core/view.ts';
export type * from './state/types.ts';
