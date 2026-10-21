import { useMemo, useState } from 'react';
import { parseKey, type PlayerView } from '../../game/index.ts';
import type { Preview } from '../host/GameHost.ts';
import { affordances } from '../model/affordances.ts';
import type { BoardModel, CardSlot } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { orderText, setAsideText, waitingText } from '../model/describe.ts';
import type { SetupSummary } from '../model/stage.ts';
import { TableCard } from '../table/TableCard.tsx';
import { Buttons, SetupSheet } from './SetupSheet.tsx';

/*
 * The mulligan (§12.1 step 3, [117]): your four cards large; tap up to two
 * to set aside, then confirm. The picks are one batch (§4.7): they are
 * drafted here, checked against the engine with the host's preview, and
 * sent together. Which cards the opponent set aside is private; only how
 * many shows [117].
 */

export function Mulligan({ view, board, summary, cards, preview, onCommit }: {
  view: PlayerView; board: BoardModel; summary: SetupSummary; cards: CardIndex;
  preview: (keys: string[]) => Preview; onCommit: (keys: string[]) => void;
}) {
  const d = view.pending?.kind === 'mulligan' ? view.pending : null;
  const [draft, setDraft] = useState<string[]>([]);
  const next = useMemo(() => {
    if (!d) return null;
    try {
      return preview(draft);
    } catch {
      return preview([]);
    }
  }, [d, draft, preview]);
  const a = d && next ? affordances(view, next.decision, draft, d) : null;

  const toggle = (slot: CardSlot) => {
    const o = a?.objects[slot.id];
    if (!o) return;
    if (o.selected) setDraft(draft.filter((k) => parseKey(k)?.obj !== slot.id));
    else if (o.keys.length > 0) setDraft([...draft, o.keys[0]]);
  };
  const commit = (keys: string[]) => {
    setDraft([]);
    onCommit(keys);
  };

  const opp = board.opponent.p, me = board.me.p;
  const notes = [orderText(summary, me), setAsideText(summary, opp, me), setAsideText(summary, me, me)]
    .filter((t): t is string => !!t);

  return (
    <SetupSheet step="Setup · mulligan" title={d ? 'Your opening hand' : 'Mulligans'}>
      {notes.length > 0 && <ul className="sheet__notes">{notes.map((t) => <li key={t}>{t}</li>)}</ul>}
      <div className="sheet__hand">
        {board.me.hand.map((c) => {
          const o = a?.objects[c.id];
          const can = !!o && (o.selected || o.keys.length > 0);
          return (
            <TableCard key={c.id} slot={c} cards={cards} size="xl" tilt selectable={!!a} selected={o?.selected}
              dimmed={!!a && !can} onTap={a ? toggle : undefined}
              label={o?.selected ? 'Set aside (tap to keep)' : can ? 'Tap to set aside' : undefined} />
          );
        })}
      </div>
      {a ? (
        <>
          <p>{a.prompt} <span className="muted small">[117]</span></p>
          <Buttons buttons={a.buttons} onCommit={commit} />
        </>
      ) : (
        <p className="sheet__waiting">{view.opponentDecision ? waitingText(view.opponentDecision) : ''}</p>
      )}
    </SetupSheet>
  );
}
