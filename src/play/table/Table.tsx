import type { ReactNode } from 'react';
import type { BoardModel, CardSlot } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import type { LogLine } from '../model/describe.ts';
import { Lane } from './Lane.tsx';
import { ChainBox, GameLog, PhaseBar, ScoreTrack } from './Rail.tsx';
import type { Acts } from './acts.ts';
import { Side } from './Side.tsx';

/*
 * The table on desktop and tablet landscape (§12.2): the opponent's side
 * on top, one lane per battlefield, your side at the bottom, the phase bar
 * and the prompt under it, and the rail with score, chain and log on the
 * right. Below 900 px the rail drops under the board; on a phone (≤ 700 px)
 * cards shrink, lanes keep two columns, the hand scrolls sideways and the
 * prompt sticks to the bottom of the screen (the full phone arrangement of
 * §12.3 is M2).
 */

export function Table({ board, cards, log, onZoom, prompt, acts, kind, names, rules = true, onRules }: {
  board: BoardModel; cards: CardIndex; log: LogLine[]; onZoom: (s: CardSlot) => void; prompt: ReactNode; acts?: Acts;
  kind?: string; names?: { me: string; opponent: string }; rules?: boolean; onRules?: () => void;
}) {
  return (
    <div className="table">
      <div className="table__board">
        <Side side={board.opponent} cards={cards} onZoom={onZoom} acts={acts} kind={kind} name={names?.opponent} />
        <div className="lanes" style={{ gridTemplateColumns: `repeat(${board.lanes.length}, minmax(0, 1fr))` }}>
          {board.lanes.map((l) => <Lane key={l.bf} lane={l} me={board.me.p} cards={cards} onZoom={onZoom} acts={acts} kind={kind} />)}
        </div>
        <Side side={board.me} cards={cards} onZoom={onZoom} acts={acts} kind={kind} name={names?.me} />
        <div className="table__bar">
          <PhaseBar board={board} />
          {prompt}
        </div>
      </div>
      <aside className="table__rail">
        <ScoreTrack board={board} names={names} />
        <ChainBox board={board} cards={cards} />
        <GameLog lines={log} rules={rules} onRules={onRules} />
      </aside>
    </div>
  );
}
