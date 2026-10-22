import { useCallback, useMemo, useState } from 'react';
import type { CardDb } from '../data/types.ts';
import { explainUnavailable } from '../game/index.ts';
import type { GameHost } from './host/GameHost.ts';
import { useHost } from './host/useHost.ts';
import { boardOf, type CardSlot } from './model/board.ts';
import { isRune, nameOf, type CardIndex } from './model/cards.ts';
import { affordances } from './model/affordances.ts';
import { describeAll, resultText, whereText } from './model/describe.ts';
import { setupSummary, stageOf } from './model/stage.ts';
import { Mulligan } from './prompt/Mulligan.tsx';
import { OrderChoice } from './prompt/OrderChoice.tsx';
import { PromptBar, SetupDone } from './prompt/PromptBar.tsx';
import { CardZoom } from './table/CardZoom.tsx';
import { SetupSheet } from './prompt/SetupSheet.tsx';
import { Table } from './table/Table.tsx';

/*
 * One game on screen: the table from the human's view, with the setup
 * steps over it (§12.1). Everything shown comes from the host's snapshot
 * (the human's view and the events they observed); every click sends
 * option keys back through the host.
 */

export function GameScreen({ host, cards, db, onNewGame, onChangeDecks }: {
  host: GameHost; cards: CardIndex; db: CardDb; onNewGame: () => void; onChangeDecks: () => void;
}) {
  const { view, events, error } = useHost(host);
  const board = useMemo(() => boardOf(view, isRune), [view]);
  const stage = stageOf(view);
  const summary = useMemo(() => setupSummary(events), [events]);
  const log = useMemo(() => describeAll(events, {
    me: view.me,
    nameOf: (d) => nameOf(cards, d),
    objOf: (id) => {
      const o = view.objects[id];
      return o ? { def: 'def' in o ? o.def : null, owner: o.owner } : null;
    },
    bfObj: (bf) => view.bfs[bf]?.obj,
  }), [events, view, cards]);

  const [zoom, setZoom] = useState<CardSlot | null>(null);
  const [atTable, setAtTable] = useState(false);
  const closeZoom = useCallback(() => setZoom(null), []);
  const preview = useCallback((keys: string[]) => host.preview(keys), [host]);
  const commit = useCallback((keys: string[]) => { host.commit(keys); }, [host]);
  const mine = stage.k === 'deciding' && stage.mine && view.pending !== null;
  const names = useCallback((d: string) => nameOf(cards, d), [cards]);
  const a = useMemo(() => (mine ? affordances(view, view.pending, [], view.pending, names) : null), [mine, view, names]);
  // Why a card in hand can't be played now (§12.7), for its tooltip: only
  // while the human holds priority, from their own view.
  const why = useMemo(() => {
    const out: Record<number, string> = {};
    if (!mine || view.pending?.kind !== 'priority') return out;
    const me = view.players[view.me];
    for (const id of [...me.hand, ...(me.champion === null ? [] : [me.champion])]) {
      if (a?.objects[id]) continue;
      const reasons = explainUnavailable(view, id);
      if (reasons.length > 0) out[id] = reasons.map((r) => r.text).join(' ');
    }
    return out;
  }, [mine, view, a]);
  const acts = useMemo(() => ({ a, why, send: (key: string) => { host.commit([key]); } }), [a, why, host]);
  const playing = view.turn.n > 0;
  const [dismissed, setDismissed] = useState(false);

  return (
    <section className="play">
      <header className="play__head">
        <div>
          <h1>{board.me.deckName} <span className="muted">vs</span> {board.opponent.deckName}</h1>
          <p className="muted small">
            You against the computer · 1v1 Duel · seed {host.setup.seed}
          </p>
        </div>
        <div className="play__actions">
          {(stage.k === 'ready' || playing) && atTable && !playing && (
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setAtTable(false)}>Setup summary</button>
          )}
          <button type="button" className="btn btn--small" onClick={onNewGame}>New game</button>
          <button type="button" className="btn btn--small btn--ghost" onClick={onChangeDecks}>Change decks</button>
        </div>
      </header>
      {error && <p className="play__error" role="alert">{error}</p>}

      <div className="play__stage">
        <Table board={board} cards={cards} log={log} onZoom={setZoom} acts={acts} kind={view.pending?.kind}
          prompt={<PromptBar view={view} stage={stage} a={a} onCommit={commit} />} />
        {stage.k === 'order' && (
          <OrderChoice view={view} board={board} cards={cards} onCommit={commit} onZoom={setZoom} />
        )}
        {stage.k === 'mulligan' && (
          <Mulligan key={view.pending?.batch ?? 'waiting'} view={view} board={board} summary={summary} cards={cards}
            preview={preview} onCommit={commit} />
        )}
        {(stage.k === 'ready' || (playing && view.turn.n === 1)) && !atTable && stage.k !== 'over' && (
          <SetupDone board={board} summary={summary} onClose={() => setAtTable(true)} />
        )}
        {stage.k === 'over' && !dismissed && (
          <SetupSheet step={`Turn ${view.turn.n} · game over`} title={resultText(stage.result, view.me)}>
            <p>
              Final score: you {board.me.points}, the opponent {board.opponent.points}
              <span className="muted small"> [{stage.result.rule}]</span>
            </p>
            <div className="sheet__buttons">
              <button type="button" className="btn btn--primary" onClick={onNewGame}>New game</button>
              <button type="button" className="btn" onClick={() => setDismissed(true)}>Look at the table</button>
            </div>
          </SetupSheet>
        )}
      </div>
      {zoom && <CardZoom slot={zoom} where={whereText(view, zoom.id)} cards={cards} db={db} onClose={closeZoom} />}
    </section>
  );
}
