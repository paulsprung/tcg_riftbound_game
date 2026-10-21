import { useEffect } from 'react';
import { HoloCard } from '../../card/HoloCard.tsx';
import { RulesText } from '../../card/RulesText.tsx';
import { defaultFinish, symbolFor } from '../../data/cardInfo.ts';
import type { CardDb } from '../../data/types.ts';
import type { CardSlot } from '../model/board.ts';
import { cardFor, nameOf, textOf, type CardIndex } from '../model/cards.ts';

/*
 * A table card up close (§12.4): the card with its finish, its oracle
 * name and current wording (Riot's errata where there is one), and what
 * the table says about it now. The derived "now" panel (Might and its
 * causes) arrives with the layers in M1.
 */

export function CardZoom({ slot, where, cards, db, onClose }: {
  slot: CardSlot; where: string; cards: CardIndex; db: CardDb; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const card = slot.def !== null ? cardFor(cards, slot.def, slot.printing) : null;
  if (!card || slot.def === null) return null;
  const text = textOf(slot.def);
  const landscape = card.orientation === 'landscape';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const width = Math.round(Math.min(window.innerWidth * 0.8, landscape ? 460 : 320));

  return (
    <div className="inspector zoom" role="dialog" aria-modal="true" aria-label={nameOf(cards, slot.def)} onClick={onClose}>
      <div className="inspector__body" onClick={(e) => e.stopPropagation()}>
        <div className="inspector__stage">
          <HoloCard card={card} finish={defaultFinish(card)} width={width} tilt="hover" upright={landscape}
            imageWidth={744} gl={!coarse} />
        </div>
        <aside className="inspector__info">
          <button className="icon-btn inspector__close" type="button" onClick={onClose} aria-label="Close">✕</button>
          <p className="eyebrow">{where}</p>
          <h2 className="inspector__name">{nameOf(cards, slot.def)}</h2>
          <div className="chips">
            {card.type && <span className="chip">{card.type}</span>}
            {card.supertype && <span className="chip">{card.supertype}</span>}
            {card.domains.map((d) => {
              const sym = symbolFor(db, 'domains', d);
              return <span key={d} className="chip">{sym && <img src={sym.icon} alt="" />}{d}</span>;
            })}
          </div>
          {text && <RulesText text={text} db={db} />}
          {slot.exhausted && <p className="muted small">Exhausted</p>}
        </aside>
      </div>
    </div>
  );
}
