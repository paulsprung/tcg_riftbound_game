import { parseKey, type Decision } from '../../game/index.ts';
import { nameOf, type CardIndex } from '../model/cards.ts';

/*
 * The mode sheet (§12.5, [355.3]): a card's modes as a list, the ones
 * already chosen ticked, the rest offered while more are to be picked.
 * Each tap answers one decision of the mode batch.
 */

const clean = (t: string) => t.replace(/\[M\]/g, 'Might').replace(/\[(\d+)\]/g, '$1');

export function ModeSheet({ d, cards, onCommit, coachKeys, allow }: {
  d: Decision; cards: CardIndex; onCommit: (keys: string[]) => void; coachKeys: ReadonlySet<string>;
  allow?: (key: string) => boolean;
}) {
  const labels = Array.isArray(d.prompt.labels) ? d.prompt.labels.map(String) : [];
  const chosen = Array.isArray(d.prompt.chosen) ? d.prompt.chosen.map(Number) : [];
  const pick = typeof d.prompt.pick === 'number' ? d.prompt.pick : 1;
  const card = typeof d.prompt.card === 'string' ? d.prompt.card : '';
  const offered = new Map(d.options.filter((o) => o.key.startsWith('mode:')).map((o) => [parseKey(o.key)!.n!, o.key]));
  const n = Math.max(labels.length, ...[...offered.keys()].map((i) => i + 1));
  const ok = (key: string) => !allow || allow(key);
  return (
    <div className="modesheet" role="dialog" aria-label="Choose modes">
      <p className="modesheet__title">
        <strong>{card ? nameOf(cards, card) : 'Choose'}</strong>
        <span className="muted small"> · choose {pick - chosen.length} more of {n} [355.3]</span>
      </p>
      <ol className="modesheet__list">
        {Array.from({ length: n }, (_, i) => {
          const key = offered.get(i);
          const done = chosen.includes(i);
          return (
            <li key={i}>
              <button type="button" className={`modesheet__mode${done ? ' is-chosen' : ''}${key && coachKeys.has(key) ? ' is-coached' : ''}`}
                disabled={!key || !ok(key)} data-key={key} aria-pressed={done} onClick={() => key && onCommit([key])}>
                <span className="modesheet__tick" aria-hidden>{done ? '✓' : i + 1}</span>
                <span>{clean(labels[i] ?? `Mode ${i + 1}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="modesheet__foot">
        {d.options.filter((o) => o.key === 'done' || o.key === 'back').filter((o) => ok(o.key)).map((o) => (
          <button key={o.key} type="button" className={`btn btn--small${o.key === 'done' ? ' btn--primary' : ''}`}
            data-key={o.key} onClick={() => onCommit([o.key])}>
            {o.key === 'done' ? 'Done' : 'Back'}
          </button>
        ))}
      </div>
    </div>
  );
}
