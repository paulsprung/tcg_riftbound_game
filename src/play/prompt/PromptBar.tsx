import type { PlayerView } from '../../game/index.ts';
import type { Affordances } from '../model/affordances.ts';
import type { BoardModel } from '../model/board.ts';
import { orderText, resultText, setAsideText, waitingText } from '../model/describe.ts';
import type { SetupSummary, Stage } from '../model/stage.ts';
import { SetupSheet } from './SetupSheet.tsx';

/*
 * The prompt under the board (§12.2): what is being decided, or what
 * happens next. While a setup step is open its sheet asks the question;
 * once setup is done the board rests at the start of the first turn.
 */

export function PromptBar({ view, stage, a, onCommit, thinking, coachKeys, opponent = 'The opponent' }: {
  view: PlayerView; stage: Stage; a?: Affordances | null; onCommit?: (keys: string[]) => void; thinking?: boolean;
  coachKeys?: ReadonlySet<string>; opponent?: string;
}) {
  if (stage.k === 'deciding' && stage.mine && a && onCommit) {
    return (
      <div className="act-bar">
        <p className="prompt" aria-live="assertive">
          {a.prompt} {a.rule && <span className="muted small">{/^\d/.test(a.rule) ? `[${a.rule}]` : a.rule}</span>}
        </p>
        {a.buttons.map((b) => (
          <button key={b.key ?? 'commit'} type="button" data-key={b.key ?? undefined}
            className={`btn btn--small${b.primary ? ' btn--primary' : ''}${b.key && coachKeys?.has(b.key) ? ' is-coached' : ''}`}
            disabled={b.disabled} onClick={() => onCommit(b.commit)}>
            {b.label}
          </button>
        ))}
      </div>
    );
  }
  let text: string;
  switch (stage.k) {
    case 'order': text = stage.mine ? 'Choose to play first or second.' : waitingText(view.opponentDecision!); break;
    case 'mulligan': text = stage.mine ? 'Choose cards to set aside.' : waitingText(view.opponentDecision!); break;
    case 'ready': text = 'Setup is done. The first turn begins with its Awaken Phase [118].'; break;
    case 'deciding': text = stage.mine ? `Your decision: ${stage.kind}.`
      : view.opponentDecision ? waitingText(view.opponentDecision).replace(/^The opponent/, opponent) : `${opponent} is deciding…`; break;
    case 'over': text = `The game is over. ${resultText(stage.result, view.me)}`; break;
  }
  return <p className={`prompt${thinking ? ' prompt--thinking' : ''}`} aria-live="assertive">{text}</p>;
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
      <p className="muted small">
        On your turn, click a glowing card in your hand to play it, use Move units to send units to a battlefield,
        and End turn when done. Spells wait on the chain (right) until both players pass; when you hold priority on
        a chain or Focus in a showdown, glowing Reactions can answer. Every card of the Seraphine deck plays as
        printed; hover a card in hand to see why it can't be played now. Right-click a card to read it.
      </p>
      <div className="sheet__buttons">
        <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>To the table</button>
      </div>
    </SetupSheet>
  );
}
