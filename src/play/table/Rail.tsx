import { useEffect, useRef } from 'react';
import type { Phase } from '../../game/index.ts';
import type { BoardModel } from '../model/board.ts';
import { nameOf, type CardIndex } from '../model/cards.ts';
import type { LogLine } from '../model/describe.ts';

/*
 * The right rail (§12.2): the score track, the chain, the log; and the
 * phase bar under the board. The chain is drawn as a stack, the newest
 * item (the next to resolve [340.1]) on top.
 */

export function ScoreTrack({ board }: { board: BoardModel }) {
  const rows = [{ label: 'You', side: board.me }, { label: 'Opponent', side: board.opponent }];
  const steps = Array.from({ length: board.victoryScore + 1 }, (_, i) => i);
  return (
    <section className="rail__box" aria-label="Score">
      <h2 className="rail__title">Score <span className="muted">· {board.victoryScore} to win</span></h2>
      {rows.map(({ label, side }) => (
        <div key={label} className={`score score--${side.me ? 'me' : 'opp'}`}>
          <span className="score__who">{label}</span>
          <span className="score__track" aria-hidden>
            {steps.map((n) => <span key={n} className={n === side.points ? 'is-at' : n < side.points ? 'is-on' : ''} />)}
          </span>
          <b className="score__n">{side.points}</b>
        </div>
      ))}
    </section>
  );
}

export function ChainBox({ board, cards }: { board: BoardModel; cards: CardIndex }) {
  const items = board.chain.slice().reverse();
  return (
    <section className="rail__box" aria-label="Chain">
      <h2 className="rail__title">Chain {items.length > 0 && <span className="muted">· {items.length}, newest on top</span>}</h2>
      {items.length === 0 ? <p className="muted small">Empty: nothing waits to resolve.</p> : (
        <ol className="chain">
          {items.map((it) => (
            <li key={it.item} className={`chain__item chain__item--${it.controller === board.me.p ? 'me' : 'opp'}`}
              data-status={it.resolving ? 'resolving' : it.status}>
              <span className="chain__name">{it.def ? nameOf(cards, it.def) : 'An ability'}</span>
              <span className="chain__meta">
                {it.what} · {it.controller === board.me.p ? 'yours' : "opponent's"}
                {it.resolving ? ' · resolving' : it.status === 'pending' ? ' · being played' : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
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
    <section className="rail__box rail__log" aria-label="Game log">
      <h2 className="rail__title">Log</h2>
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

const PHASES: { id: Phase; label: string }[] = [
  { id: 'setup', label: 'Setup' }, { id: 'awaken', label: 'Awaken' }, { id: 'beginning', label: 'Beginning' },
  { id: 'channel', label: 'Channel' }, { id: 'draw', label: 'Draw' }, { id: 'main', label: 'Main' },
  { id: 'ending', label: 'Ending' },
];

export function PhaseBar({ board }: { board: BoardModel }) {
  return (
    <ol className="phases" aria-label="Phases">
      <li className="phases__turn">{board.turn === 0 ? 'Before turn 1' : `Turn ${board.turn}`}</li>
      {PHASES.map((p) => (
        <li key={p.id} className={p.id === board.phase ? 'is-current' : ''} aria-current={p.id === board.phase ? 'step' : undefined}>
          {p.label}
        </li>
      ))}
    </ol>
  );
}
