import type {
  DecisionKind, GameResult, ObservedEvent, PlayerId, PlayerView,
} from '../../game/index.ts';

/*
 * Where a game is, for the screens of §12.1: choosing the turn order,
 * mulligans, the table, the end. Read from the viewer's own view and the
 * events they observed, so it shows nothing they couldn't know.
 */

export type Stage =
  /** The randomly designated player chooses to play first or second (TR 407). */
  | { k: 'order'; decider: PlayerId; mine: boolean }
  /** Each player in turn order sets aside up to 2 cards [117]. */
  | { k: 'mulligan'; decider: PlayerId; mine: boolean }
  /** Setup is done; the board rests at the start of the first turn [118]
      until the turn structure arrives (M1). */
  | { k: 'ready' }
  /** Any other decision: the table's prompt bar (M1). */
  | { k: 'deciding'; kind: DecisionKind; decider: PlayerId; mine: boolean }
  | { k: 'over'; result: GameResult };

export function stageOf(v: PlayerView): Stage {
  if (v.result) return { k: 'over', result: v.result };
  const d = v.pending ?? v.opponentDecision;
  if (!d) return { k: 'ready' };
  const mine = d.player === v.me;
  if (d.kind === 'playOrder') return { k: 'order', decider: d.player, mine };
  if (d.kind === 'mulligan') return { k: 'mulligan', decider: d.player, mine };
  return { k: 'deciding', kind: d.kind, decider: d.player, mine };
}

/** What setup has shown so far: who was designated to choose the turn
    order (null when the setup fixed it), who plays first, and how many
    cards each player set aside, which everyone sees [117]. */
export interface SetupSummary {
  designee: PlayerId | null;
  first: PlayerId | null;
  setAside: Partial<Record<PlayerId, number>>;
}

export function setupSummary(events: readonly ObservedEvent[]): SetupSummary {
  const out: SetupSummary = { designee: null, first: null, setAside: {} };
  for (const e of events) {
    if (e.k === 'deciding' && e.stub.kind === 'playOrder') out.designee = e.stub.player;
    if (e.k === 'playOrder') out.first = e.first;
    if (e.k === 'mulligan') out.setAside[e.p] = e.n;
  }
  return out;
}
