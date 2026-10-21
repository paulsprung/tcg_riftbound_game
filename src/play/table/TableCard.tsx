import { memo, type KeyboardEvent } from 'react';
import { CardBack } from '../../card/CardBack.tsx';
import { HoloCard } from '../../card/HoloCard.tsx';
import { defaultFinish } from '../../data/cardInfo.ts';
import type { CardSlot } from '../model/board.ts';
import { cardFor, nameOf, type CardIndex } from '../model/cards.ts';

/*
 * One card on the table (§12.4): its art when the viewer knows it, a card
 * back when they don't (the rune back for runes [129.2]). The board never
 * mounts WebGL; HoloCard draws the CSS finish only.
 */

export type CardSize = 'xs' | 's' | 'm' | 'l' | 'xl';

/** Rendered widths in px (portrait); the image server is asked for about
    twice that. */
export const CARD_PX: Record<CardSize, number> = { xs: 46, s: 64, m: 84, l: 112, xl: 168 };

export interface TableCardProps {
  slot: CardSlot;
  cards: CardIndex;
  size: CardSize;
  /** Landscape cards (battlefields) are drawn the readable way round. */
  landscape?: boolean;
  selectable?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  tilt?: boolean;
  onTap?: (slot: CardSlot) => void;
  /** What tapping does, after the card's name in its tooltip and label. */
  label?: string;
}

export const TableCard = memo(function TableCard({
  slot, cards, size, landscape = false, selectable, selected, dimmed, tilt = false, onTap, label,
}: TableCardProps) {
  const card = slot.def !== null ? cardFor(cards, slot.def, slot.printing) : null;
  const px = CARD_PX[size] * (landscape ? 1039 / 744 : 1);
  const cls = ['tcard', `tcard--${size}`, landscape && 'tcard--land', selectable && 'is-selectable',
    selected && 'is-selected', dimmed && 'is-dim', slot.exhausted && 'is-exhausted'].filter(Boolean).join(' ');
  const tap = onTap ? () => onTap(slot) : undefined;
  const name = slot.def !== null ? nameOf(cards, slot.def) : 'Face-down card';
  const title = label ? `${name}: ${label}` : name;

  // A tappable card is one control: a toggle when it is selectable (a
  // mulligan pick), else a button that zooms.
  const control = tap ? {
    role: 'button', tabIndex: 0, 'aria-pressed': selectable ? !!selected : undefined, 'aria-label': title,
    onClick: tap,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); }
    },
  } : {};

  return (
    <div className={cls} title={title} {...control}>
      {card ? (
        <HoloCard card={card} finish={defaultFinish(card)} width="100%" tilt={tilt ? 'hover' : 'off'} upright={landscape}
          imageWidth={Math.min(744, Math.ceil((px * 2) / 50) * 50)} />
      ) : slot.def !== null ? (
        <div className="tcard__missing">{name}</div>
      ) : (
        <div className="tcard__back" aria-label={slot.rune ? 'Face-down rune' : 'Face-down card'}>
          <CardBack rune={slot.rune} />
        </div>
      )}
      {slot.exhausted && <span className="tcard__badge">Exhausted</span>}
    </div>
  );
});
