import type { ReactNode } from 'react';
import { HoloCard } from '../../card/HoloCard.tsx';
import { defaultFinish } from '../../data/cardInfo.ts';
import type { CardSlot } from '../model/board.ts';
import { cardFor, type CardIndex } from '../model/cards.ts';

/*
 * The end of a game over the table: Victory or Defeat in large, both
 * Legends face to face (the winner's lit, the other's dimmed), the final
 * score, and below it what the game brought (an online game's rank and
 * coins) and the way on.
 */

export type GameOverTone = 'win' | 'loss' | 'draw' | 'neutral';

function Legend({ slot, cards, lit }: { slot: CardSlot | undefined; cards: CardIndex; lit: boolean }) {
  const card = slot?.def ? cardFor(cards, slot.def, slot.printing) : null;
  return (
    <div className={`gameover__legend${lit ? ' is-lit' : ''}`}>
      {card && <HoloCard card={card} finish={defaultFinish(card)} width="100%" tilt="hover" imageWidth={480} />}
    </div>
  );
}

export function GameOver({ tone, title, detail, turn, names, points, legends, cards, children, buttons }: {
  tone: GameOverTone; title: string; detail: string; turn: number;
  /** Mine first, as the table shows them. */
  names: [string, string]; points: [number, number]; legends: [CardSlot | undefined, CardSlot | undefined];
  cards: CardIndex; children?: ReactNode; buttons: ReactNode;
}) {
  return (
    <div className={`gameover is-${tone}`} role="dialog" aria-label={title}>
      <div className="gameover__panel">
        <div className="gameover__rays" aria-hidden />
        <p className="eyebrow">Turn {turn} · game over</p>
        <h2 className="gameover__title">{title}</h2>
        <p className="gameover__detail">{detail}</p>
        <div className="gameover__duel">
          <Legend slot={legends[0]} cards={cards} lit={tone === 'win' || tone === 'draw' || tone === 'neutral'} />
          <div className="gameover__score">
            <span><strong>{points[0]}</strong><em>{names[0]}</em></span>
            <i aria-hidden>:</i>
            <span><strong>{points[1]}</strong><em>{names[1]}</em></span>
          </div>
          <Legend slot={legends[1]} cards={cards} lit={tone === 'loss' || tone === 'draw' || tone === 'neutral'} />
        </div>
        {children}
        <div className="sheet__buttons gameover__buttons">{buttons}</div>
      </div>
    </div>
  );
}
