import type { ReactNode } from 'react';
import type { BoardModel, CardSlot } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import type { LogLine } from '../model/describe.ts';
import { Lane } from './Lane.tsx';
import { ChainBox, GameLog, PhaseBar, ScoreTrack } from './Rail.tsx';
import { Side } from './Side.tsx';

/*
 * The table on desktop and tablet landscape (§12.2): the opponent's side
 * on top, one lane per battlefield, your side at the bottom, the phase bar
 * and the prompt under it, and the rail with score, chain and log on the
 * right. The phone arrangement is M2 (§12.3).
 */

export function Table({ board, cards, log, onZoom, prompt }: {
  board: BoardModel; cards: CardIndex; log: LogLine[]; onZoom: (s: CardSlot) => void; prompt: ReactNode;
}) {
  return (
    <div className="table">
      <div className="table__board">
        <Side side={board.opponent} cards={cards} onZoom={onZoom} />
        <div className="lanes" style={{ gridTemplateColumns: `repeat(${board.lanes.length}, minmax(0, 1fr))` }}>
          {board.lanes.map((l) => <Lane key={l.bf} lane={l} me={board.me.p} cards={cards} onZoom={onZoom} />)}
        </div>
        <Side side={board.me} cards={cards} onZoom={onZoom} />
        <div className="table__bar">
          <PhaseBar board={board} />
          {prompt}
        </div>
      </div>
      <aside className="table__rail">
        <ScoreTrack board={board} />
        <ChainBox board={board} />
        <GameLog lines={log} rules />
      </aside>
    </div>
  );
}
