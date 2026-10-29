import type { CSSProperties, ReactNode } from 'react';
import { HoloCard } from '../../card/HoloCard.tsx';
import { defaultFinish } from '../../data/cardInfo.ts';
import type { CardSlot } from '../model/board.ts';
import { cardFor, type CardIndex } from '../model/cards.ts';

/*
 * The end of a game, over the table: a scene rather than a dialog. Victory
 * in gold with light breaking behind it and embers rising, Defeat in cold
 * colours with ash falling; the player's Legend in the middle (lit or
 * greyed), the opponent's small beside the score, then what the game
 * brought (an online game's rank and coins) and the way on.
 */

export type GameOverTone = 'win' | 'loss' | 'draw' | 'neutral';

const SPARKS = 26;

function Legend({ slot, cards, className }: { slot: CardSlot | undefined; cards: CardIndex; className: string }) {
  const card = slot?.def ? cardFor(cards, slot.def, slot.printing) : null;
  return <div className={className}>{card && <HoloCard card={card} finish={defaultFinish(card)} width="100%" tilt="hover" imageWidth={480} />}</div>;
}

export function GameOver({ tone, title, detail, eyebrow, names, points, legends, cards, children, buttons }: {
  tone: GameOverTone; title: string; detail: string; eyebrow: string;
  /** Mine first, as the table shows them. */
  names: [string, string]; points: [number, number]; legends: [CardSlot | undefined, CardSlot | undefined];
  cards: CardIndex; children?: ReactNode; buttons: ReactNode;
}) {
  return (
    <div className={`gameover is-${tone}`} role="dialog" aria-label={title}>
      <div className="gameover__sky" aria-hidden>
        <div className="gameover__rays" />
        {Array.from({ length: SPARKS }, (_, i) => (
          // spread by a fixed pattern: the same scene every time
          <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i * 0.53) % 6}s`, '--t': `${5 + ((i * 7) % 5)}s`, '--s': `${2 + (i % 3)}px` } as CSSProperties} />
        ))}
      </div>
      <div className="gameover__scene">
        <p className="gameover__eyebrow">{eyebrow}</p>
        <div className="gameover__crest">
          <span aria-hidden />
          <h2 className="gameover__title" data-text={title}>{title}</h2>
          <span aria-hidden />
        </div>
        <p className="gameover__detail">{detail}</p>

        <div className="gameover__stage">
          <div className="gameover__side">
            <strong>{points[0]}</strong>
            <em>{names[0]}</em>
          </div>
          <div className="gameover__hero">
            <div className="gameover__halo" aria-hidden />
            <Legend slot={legends[0]} cards={cards} className="gameover__legend" />
          </div>
          <div className="gameover__side is-them">
            <strong>{points[1]}</strong>
            <em>{names[1]}</em>
            <Legend slot={legends[1]} cards={cards} className="gameover__foe" />
          </div>
        </div>

        {children}
        <div className="gameover__buttons">{buttons}</div>
      </div>
    </div>
  );
}
