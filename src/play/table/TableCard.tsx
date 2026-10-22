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
  /** Tapping answers the pending decision with this card (§12.5); the
      zoom is then on right-click. */
  onAct?: (slot: CardSlot) => void;
}

/** The board keywords worth a chip: Tank, Shield X, Assault X, Deflect X. */
const KW_LABEL: Record<string, string> = { tank: 'Tank', shield: 'Shield', assault: 'Assault', deflect: 'Deflect' };
function kwText(slot: CardSlot): string {
  const k = slot.keywords ?? {};
  return Object.keys(KW_LABEL).filter((kw) => (k[kw] ?? 0) > 0)
    .map((kw) => (kw === 'tank' ? KW_LABEL[kw] : `${KW_LABEL[kw]} ${k[kw]}`)).join(' · ');
}

export const TableCard = memo(function TableCard({
  slot, cards, size, landscape = false, selectable, selected, dimmed, tilt = false, onTap, label, onAct,
}: TableCardProps) {
  const card = slot.def !== null ? cardFor(cards, slot.def, slot.printing) : null;
  const px = CARD_PX[size] * (landscape ? 1039 / 744 : 1);
  const cls = ['tcard', `tcard--${size}`, landscape && 'tcard--land', selectable && 'is-selectable',
    selected && 'is-selected', dimmed && 'is-dim', slot.exhausted && 'is-exhausted', onAct && 'is-actionable']
    .filter(Boolean).join(' ');
  const tap = onAct ? () => onAct(slot) : onTap ? () => onTap(slot) : undefined;
  const name = slot.def !== null ? nameOf(cards, slot.def) : 'Face-down card';
  const title = label ? `${name}: ${label}` : name;

  // A tappable card is one control: a toggle when it is selectable (a
  // mulligan pick), else a button that zooms.
  const control = tap ? {
    role: 'button', tabIndex: 0, 'aria-pressed': selectable ? !!selected : undefined, 'aria-label': title,
    onClick: tap,
    onContextMenu: onAct && onTap ? (e: { preventDefault: () => void }) => { e.preventDefault(); onTap(slot); } : undefined,
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
      {slot.might !== null && (
        <span className={`tcard__might${slot.damage > 0 ? ' is-hurt' : ''}`} title={`Might ${slot.might}, damage ${slot.damage}`}>
          {slot.damage > 0 ? `${slot.might - slot.damage}/${slot.might}` : slot.might}
        </span>
      )}
      {slot.stunned && <span className="tcard__stun">Stunned</span>}
      {kwText(slot) && <span className="tcard__kw" title="Keywords now (printed or given)">{kwText(slot)}</span>}
      {slot.designation && <span className={`tcard__role tcard__role--${slot.designation}`}>{slot.designation}</span>}
    </div>
  );
});
