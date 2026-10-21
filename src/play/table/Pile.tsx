import { CardBack } from '../../card/CardBack.tsx';
import type { CardSlot } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { TableCard, type CardSize } from './TableCard.tsx';

/*
 * Piles: the Main Deck and Rune Deck face down with their counts, which
 * are public [108.4.d] (§8, A Q2); the trash and banishment face up with
 * the newest card on top, every card public [108.2.c], [108.6.d].
 */

export function Pile({ label, count, rune = false, size = 's' }: {
  label: string; count: number; rune?: boolean; size?: CardSize;
}) {
  return (
    <div className="pile" title={`${label}: ${count}`}>
      <div className={`pile__stack tcard tcard--${size}${count === 0 ? ' is-empty' : ''}`}>
        {count > 0 && <div className="tcard__back"><CardBack rune={rune} /></div>}
        <span className="pile__count">{count}</span>
      </div>
      <span className="pile__label">{label}</span>
    </div>
  );
}

export function OpenPile({ label, slots, cards, onTap, size = 's' }: {
  label: string; slots: CardSlot[]; cards: CardIndex; onTap?: (s: CardSlot) => void; size?: CardSize;
}) {
  const top = slots[slots.length - 1];
  return (
    <div className="pile" title={`${label}: ${slots.length}`}>
      {top ? (
        <div className="pile__stack">
          <TableCard slot={top} cards={cards} size={size} onTap={onTap} />
          <span className="pile__count">{slots.length}</span>
        </div>
      ) : (
        <div className={`pile__stack tcard tcard--${size} is-empty`}><span className="pile__count">0</span></div>
      )}
      <span className="pile__label">{label}</span>
    </div>
  );
}
