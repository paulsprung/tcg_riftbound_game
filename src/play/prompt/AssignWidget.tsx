import type { Decision, PlayerView } from '../../game/index.ts';
import { rowOf, type AssignRow } from '../model/assign.ts';
import { slotOf, type CardSlot } from '../model/board.ts';
import { isRune, type CardIndex } from '../model/cards.ts';
import { TableCard } from '../table/TableCard.tsx';

/*
 * The combat damage assignment widget (§12.5, [467.2.c]): the damage to
 * assign, the enemy units that may come next (Tanks first, Backline last:
 * the engine offers only the legal next ones), and the order drafted so
 * far with the amount each gets (lethal in full, no overkill: the engine
 * computes it). Tap units here or on the board; Suggest fills in the
 * prefilled assignment (kill what is worth most), Undo takes the last pick
 * back, Confirm sends the whole batch (§4.7).
 */

export function AssignWidget({ view, first, next, draft, rows, complete, cards, onPick, onUndo, onSuggest, onConfirm, allow }: {
  view: PlayerView; first: Decision; next: Decision | null; draft: string[]; rows: AssignRow[]; complete: boolean;
  cards: CardIndex; onPick: (key: string) => void; onUndo: () => void; onSuggest: () => void; onConfirm: () => void;
  allow?: (key: string) => boolean;
}) {
  const total = typeof first.prompt.total === 'number' ? first.prompt.total : typeof first.prompt.left === 'number' ? first.prompt.left : 0;
  const assigned = rows.reduce((n, r) => n + r.amount, 0);
  const slot = (id: number): CardSlot | null => (view.objects[id] ? slotOf(view, id, isRune) : null);
  const picks = (next?.options ?? []).filter((o) => !o.ui && (o.key.startsWith('a:') || o.key.startsWith('x:'))
    && (!allow || allow(o.key)));
  const others = (next?.options ?? []).filter((o) => !o.ui && !o.key.startsWith('a:') && !o.key.startsWith('x:'));
  const what = next?.kind === 'assignExcess' ? 'Every enemy unit has lethal damage: place the rest one point at a time.'
    : next?.kind === 'assignTier' ? 'This unit has Tank and Backline: which counts?'
      : next ? 'Choose the next enemy unit: it gets lethal damage, or all that is left.' : 'All damage is assigned.';
  return (
    <section className="assign" aria-label="Assign combat damage">
      <header className="assign__head">
        <strong>Assign {total} combat damage</strong>
        <span className="muted small">{assigned} of {total} placed · [467.2.c]</span>
      </header>
      <p className="small">{what}</p>
      <div className="assign__cols">
        <ol className="assign__order" aria-label="Your order">
          {rows.length === 0 && <li className="muted small">Nothing yet</li>}
          {rows.map((r, i) => {
            const s = slot(r.obj);
            return (
              <li key={`${r.key}-${i}`} className="assign__row">
                {s && <TableCard slot={s} cards={cards} size="xs" />}
                <b className="assign__amount">{r.amount}</b>
              </li>
            );
          })}
        </ol>
        <div className="assign__next" aria-label="Next">
          {picks.map((o) => {
            const s = slot(Number(o.key.slice(2)));
            return (
              <button key={o.key} type="button" className="assign__pick" data-key={o.key} onClick={() => onPick(o.key)}>
                {s && <TableCard slot={s} cards={cards} size="xs" />}
                <span className="small">+{o.meta?.amount ?? 1}</span>
              </button>
            );
          })}
          {others.map((o) => (
            <button key={o.key} type="button" className="btn btn--small" data-key={o.key} onClick={() => onPick(o.key)}>
              {o.key === 'done' ? 'Rest on the last one' : o.key === 'tank' ? 'As Tank' : o.key === 'backline' ? 'As Backline' : o.key}
            </button>
          ))}
        </div>
      </div>
      <div className="assign__foot">
        <button type="button" className="btn btn--small" onClick={onSuggest} disabled={complete}>Suggest</button>
        <button type="button" className="btn btn--small" onClick={onUndo} disabled={draft.length === 0}>Undo</button>
        <button type="button" className="btn btn--small btn--primary" onClick={onConfirm} disabled={!complete} autoFocus={complete}>
          Confirm
        </button>
      </div>
    </section>
  );
}

export { rowOf };
