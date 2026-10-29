import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CardDb } from '../data/types.ts';
import { online } from '../net/socket.ts';
import type { RatingInfo, ServerMsg } from '../net/protocol.ts';
import { GameScreen } from './GameScreen.tsx';
import { RemoteHost } from './host/RemoteHost.ts';
import { cardIndex, withPrintings } from './model/cards.ts';

/*
 * A game against another player: the table on a RemoteHost, once the
 * server's first view is in. The end screen adds what the game brought:
 * coins and, in ranked, the rating before and after.
 */

const tierText = (r: RatingInfo) => (r.placement ? `Placement ${r.games}/5` : `${r.tier}${r.division ? ` ${'IV III II I'.split(' ')[4 - r.division]}` : ''} · ${r.points} LP`);

function Outcome({ end }: { end: Extract<ServerMsg, { t: 'end' }> | null }) {
  if (!end) return <p className="muted small">Saving the result…</p>;
  const r = end.rating;
  // in placement the points are not shown yet: only how many games are played
  const delta = r && !r.after.placement ? r.after.points - r.before.points : null;
  return (
    <div className="online-outcome">
      {r && (
        <p className="online-outcome__rating">
          {tierText(r.before)} → <strong>{tierText(r.after)}</strong>
          {delta !== null && <span className={delta >= 0 ? 'is-up' : 'is-down'}> ({delta >= 0 ? '+' : ''}{delta} LP)</span>}
        </p>
      )}
      <p className="online-outcome__coins"><span className="lb-coin" aria-hidden /> +{end.coins} coins
        {end.coins === 0 && <span className="muted small"> (short games and the daily limit pay nothing)</span>}</p>
    </div>
  );
}

export function OnlineGame({ db, start, end }: { db: CardDb; start: Extract<ServerMsg, { t: 'start' }>; end: Extract<ServerMsg, { t: 'end' }> | null }) {
  const cards = useMemo(() => cardIndex(db), [db]);
  // both lists with their art, as the table shows them
  const host = useMemo(() => new RemoteHost({ ...start, decks: [withPrintings(start.decks[0], cards), withPrintings(start.decks[1], cards)] }), [start, cards]);
  useEffect(() => { host.start(); }, [host]);
  const ready = useSyncExternalStore(host.subscribe, () => host.ready, () => host.ready);
  const leave = () => online.dismissEnd();

  if (!ready) return <p className="status">Waiting for the table…</p>;
  const mode = start.mode === 'ranked' ? 'Ranked' : 'Casual';
  return (
    <GameScreen host={host} cards={cards} db={db} names={start.names}
      onNewGame={leave} onChangeDecks={leave}
      online={{ mode, clock: () => host.deadlines, outcome: <Outcome end={end} /> }} />
  );
}
