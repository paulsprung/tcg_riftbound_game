import { useEffect, useRef, type ReactNode } from 'react';
import { HoloCard } from '../../card/HoloCard.tsx';
import { defaultFinish } from '../../data/cardInfo.ts';
import type { Phase } from '../../game/index.ts';
import type { BoardModel, CardSlot } from '../model/board.ts';
import { cardFor, nameOf, type CardIndex } from '../model/cards.ts';
import type { LogLine } from '../model/describe.ts';
import { useTableLook } from './tableContext.ts';

/*
 * The panel at the right of the table (§12.2): whose turn it is and the
 * phase, the score, the card under the pointer big enough to read, the
 * chain, the log, and under them what is being decided. The log scrolls;
 * the panel does not.
 */

const PHASES: { id: Phase; label: string }[] = [
  { id: 'setup', label: 'Setup' }, { id: 'awaken', label: 'Awaken' }, { id: 'beginning', label: 'Begin' },
  { id: 'channel', label: 'Channel' }, { id: 'draw', label: 'Draw' }, { id: 'main', label: 'Main' },
  { id: 'ending', label: 'End' },
];

export function RailHead({ board, names, menu }: { board: BoardModel; names: { me: string; opponent: string }; menu: ReactNode }) {
  const mine = board.turnPlayer === board.me.p;
  return (
    <header className="rail__head">
      <div className="rail__turn">
        <strong>{board.turn === 0 ? 'Before turn 1' : `Turn ${board.turn}`}</strong>
        {board.turnPlayer !== null && <em className={mine ? 'is-me' : 'is-opp'}>{mine ? (names.me === 'You' ? 'Your turn' : `${names.me}'s turn`) : `${names.opponent}'s turn`}</em>}
      </div>
      {menu}
      <ol className="rail__phases" aria-label="Phases">
        {PHASES.map((p) => (
          <li key={p.id} className={p.id === board.phase ? 'is-current' : ''} aria-current={p.id === board.phase ? 'step' : undefined}>{p.label}</li>
        ))}
      </ol>
    </header>
  );
}

export function Scores({ board, names }: { board: BoardModel; names: { me: string; opponent: string } }) {
  const look = useTableLook();
  const rows = [{ label: names.opponent, side: board.opponent }, { label: names.me, side: board.me }];
  const steps = Array.from({ length: board.victoryScore + 1 }, (_, i) => i);
  return (
    <section className="rail__scores" aria-label={`Score, ${board.victoryScore} to win`}>
      {rows.map(({ label, side }) => (
        <div key={label} className={`score score--${side.me ? 'me' : 'opp'}${look.fx.score.includes(side.p) ? ' fx--score' : ''}`}>
          <span className="score__who">{label}</span>
          <span className="score__track" aria-hidden>
            {steps.map((n) => <span key={n} className={n === side.points ? 'is-at' : n < side.points ? 'is-on' : ''} />)}
          </span>
          <b className="score__n">{side.points}<small>/{board.victoryScore}</small></b>
        </div>
      ))}
    </section>
  );
}

/** The card under the pointer, big. */
export function Preview({ slot, cards }: { slot: CardSlot | null; cards: CardIndex }) {
  const card = slot && slot.def !== null ? cardFor(cards, slot.def, slot.printing) : null;
  return (
    <section className="rail__preview" aria-label="Card preview">
      {card ? (
        <>
          <div className={`rail__card${card.orientation === 'landscape' ? ' is-land' : ''}`}><HoloCard card={card} finish={defaultFinish(card)} width="100%" tilt="off" upright={card.orientation === 'landscape'} imageWidth={520} /></div>
          {slot && slot.might !== null && (
            <p className="rail__might">Might {slot.might}{slot.damage > 0 ? ` · ${slot.damage} damage` : ''}{slot.exhausted ? ' · exhausted' : ''}</p>
          )}
        </>
      ) : <p className="rail__hint">Point at a card to read it.</p>}
    </section>
  );
}

export function ChainBox({ board, cards }: { board: BoardModel; cards: CardIndex }) {
  const items = board.chain.slice().reverse();
  const look = useTableLook();
  if (items.length === 0) return null;
  return (
    <section className={`rail__chain${look.fx.chain ? ' fx--chain' : ''}`} aria-label="Chain">
      <h2 className="rail__title">Chain <span>{items.length}</span></h2>
      <ol className="chain">
        {items.map((it) => (
          <li key={it.item} className={`chain__item chain__item--${it.controller === board.me.p ? 'me' : 'opp'}`}
            data-status={it.resolving ? 'resolving' : it.status}>
            <span className="chain__name">{it.def ? nameOf(cards, it.def) : 'An ability'}</span>
            <span className="chain__meta">{it.what}{it.resolving ? ' · resolving' : it.status === 'pending' ? ' · being played' : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GameLog({ lines, rules }: { lines: LogLine[]; rules: boolean }) {
  // Keep the newest line in sight, scrolling the log only, never the page.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <section className="rail__log" aria-label="Game log">
      <ol className="log" aria-live="polite" ref={list}>
        {lines.map((l) => (
          <li key={l.seq} className={`log__line log__line--${l.who}`}>
            {l.text}
            {rules && l.rule && <span className="log__rule">{/^\d/.test(l.rule) ? `[${l.rule}]` : l.rule}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
