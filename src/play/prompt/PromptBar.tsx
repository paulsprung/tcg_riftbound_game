import type { PlayerView } from '../../game/index.ts';
import type { BoardModel } from '../model/board.ts';
import { orderText, setAsideText, waitingText } from '../model/describe.ts';
import type { SetupSummary, Stage } from '../model/stage.ts';
import { SetupSheet } from './SetupSheet.tsx';

/*
 * The prompt under the board (§12.2): what is being decided, or what
 * happens next. While a setup step is open its sheet asks the question;
 * once setup is done the board rests at the start of the first turn.
 */

export function PromptBar({ view, stage }: { view: PlayerView; stage: Stage }) {
  let text: string;
  switch (stage.k) {
    case 'order': text = stage.mine ? 'Choose to play first or second.' : waitingText(view.opponentDecision!); break;
    case 'mulligan': text = stage.mine ? 'Choose cards to set aside.' : waitingText(view.opponentDecision!); break;
    case 'ready':
      text = 'Setup is done. The first turn begins with its Awaken Phase [118]; taking turns comes with the next milestone.';
      break;
    case 'deciding': text = stage.mine ? `Your decision: ${stage.kind}.` : 'The opponent is deciding…'; break;
    case 'over': text = 'The game is over.'; break;
  }
  return <p className="prompt" aria-live="assertive">{text}</p>;
}

/** The end of setup, once (§12.1): how it went, then to the table. */
export function SetupDone({ board, summary, onClose }: { board: BoardModel; summary: SetupSummary; onClose: () => void }) {
  const me = board.me.p;
  const notes = [orderText(summary, me), setAsideText(summary, board.opponent.p, me), setAsideText(summary, me, me)]
    .filter((t): t is string => !!t);
  return (
    <SetupSheet step="Setup · done" title="Ready to play">
      <ul className="sheet__notes">{notes.map((t) => <li key={t}>{t}</li>)}</ul>
      <p>
        Legends, Chosen Champions and battlefields are in place, both decks are shuffled and both players hold four
        cards. The First Player's turn begins with the Awaken Phase <span className="muted small">[118]</span>.
      </p>
      <p className="muted small">Taking turns comes with the next milestone. For now the table shows where everything starts.</p>
      <div className="sheet__buttons">
        <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>To the table</button>
      </div>
    </SetupSheet>
  );
}
