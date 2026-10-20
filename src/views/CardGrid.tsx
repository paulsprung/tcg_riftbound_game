import { useEffect, useState, type ReactNode } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card } from '../data/types.ts';

const PAGE = 96;

interface Props {
  cards: Card[];
  onInspect: (t: InspectTarget) => void;
  /** Extra overlay per card (counts, badges). */
  badge?: (c: Card) => ReactNode;
  /** Cards shown dimmed and inert (e.g. not yet collected). */
  dim?: (c: Card) => boolean;
  /** Show cards as foil when the collection has a foil copy. */
  foil?: (c: Card) => boolean;
}

/** A paged grid of cards; tilt only runs on the card under the pointer. */
export function CardGrid({ cards, onInspect, badge, dim, foil }: Props) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [cards]);

  if (cards.length === 0) return <p className="muted empty">No cards match.</p>;

  return (
    <>
      <div className="card-grid">
        {cards.slice(0, shown).map((c) => {
          const off = dim?.(c) ?? false;
          const finish = defaultFinish(c, foil?.(c) ?? false);
          return (
            <div key={c.id} className={`card-grid__item${off ? ' is-dim' : ''}`}>
              <HoloCard card={c} finish={off ? 'none' : finish} width="100%" imageWidth={320}
                tilt={off ? 'off' : 'hover'} onClick={() => onInspect({ card: c, finish })} />
              {badge?.(c)}
            </div>
          );
        })}
      </div>
      {shown < cards.length && (
        <div className="more">
          <button type="button" className="btn btn--ghost" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({cards.length - shown} left)
          </button>
        </div>
      )}
    </>
  );
}
