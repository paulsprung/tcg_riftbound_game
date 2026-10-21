import type { PlayerView } from '../../game/index.ts';
import { affordances } from '../model/affordances.ts';
import type { BoardModel, CardSlot } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { waitingText } from '../model/describe.ts';
import { TableCard } from '../table/TableCard.tsx';
import { Buttons, SetupSheet } from './SetupSheet.tsx';

/*
 * Choosing the turn order (§12.1 step 2, TR 407): both battlefields picked
 * at random are shown face up [487.5], and the randomly designated player,
 * who has seen them (TR 406.1.h), chooses to play first or second.
 */

export function OrderChoice({ view, board, cards, onCommit, onZoom }: {
  view: PlayerView; board: BoardModel; cards: CardIndex; onCommit: (keys: string[]) => void;
  onZoom: (s: CardSlot) => void;
}) {
  const d = view.pending?.kind === 'playOrder' ? view.pending : null;
  const a = d ? affordances(view, d) : null;
  return (
    <SetupSheet step="Setup · turn order" title={d ? 'Play first or second?' : 'Who plays first?'}>
      <div className="sheet__bfs">
        {board.lanes.map((l) => (
          <figure key={l.bf} className="sheet__bf">
            <TableCard slot={l.card} cards={cards} size="xl" landscape onTap={onZoom} />
            <figcaption className="muted small">{l.owner === board.me.p ? 'Your battlefield' : "Opponent's battlefield"}</figcaption>
          </figure>
        ))}
      </div>
      {a ? (
        <>
          <p>{a.prompt} <span className="muted small">(TR 407)</span></p>
          <Buttons buttons={a.buttons} onCommit={onCommit} />
        </>
      ) : (
        <p className="sheet__waiting">{view.opponentDecision ? waitingText(view.opponentDecision) : ''}</p>
      )}
    </SetupSheet>
  );
}
