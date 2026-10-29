import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CardDb } from '../data/types.ts';
import { divisionProgress, PLACEMENT_GAMES, rankName } from '../economy/ranks.ts';
import { RankEmblem } from '../lobby/RankEmblem.tsx';
import { online } from '../net/socket.ts';
import type { RatingInfo, ServerMsg } from '../net/protocol.ts';
import { GameScreen } from './GameScreen.tsx';
import { rankMoved, RankUp } from './prompt/RankUp.tsx';
import { RemoteHost } from './host/RemoteHost.ts';
import { cardIndex, withPrintings } from './model/cards.ts';

/*
 * A game against another player: the table on a RemoteHost, once the
 * server's first view is in. The end screen adds what the game brought:
 * coins (with the day's first-win bonus) and, in ranked, the rank it moved.
 */

/** Counts up to a number once, for the coins a game brought. */
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to <= 0) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 900); setN(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

/** The rank after the game as a tile: its crest, the division bar running from where it stood, the points it moved. */
function RankMove({ before, after }: { before: RatingInfo; after: RatingInfo }) {
  const [run, setRun] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRun(true), 1500); return () => clearTimeout(t); }, []);
  if (after.placement) {
    return (
      <div className="go-tile go-rank is-placement">
        <RankEmblem tier={null} size={92} />
        <div className="go-rank__text">
          <span className="go-tile__label">Placement</span>
          <span className="go-rank__dots">{Array.from({ length: PLACEMENT_GAMES }, (_, i) => <i key={i} className={i < after.games ? 'is-done' : ''} />)}</span>
          <span className="muted small">{PLACEMENT_GAMES - after.games} more to your first rank</span>
        </div>
      </div>
    );
  }
  const moved = rankMoved(before, after);
  const up = after.points >= before.points;
  const from = moved ? (up ? 0 : 1) : divisionProgress(before.points);
  const delta = before.placement ? null : after.points - before.points;
  return (
    <div className={`go-tile go-rank${up ? ' is-up' : ' is-down'}`}>
      <RankEmblem tier={after.tier} division={after.division} size={104} />
      <div className="go-rank__text">
        <span className="go-tile__label">Ranked</span>
        <strong>{rankName(after.tier, after.division)}</strong>
        <div className="go-rank__bar"><span style={{ width: `${Math.round((run ? divisionProgress(after.points) : from) * 100)}%` }} /></div>
        <span className="go-rank__lp">
          {after.points.toLocaleString('en-US')} LP
          {delta !== null && <b className={delta >= 0 ? 'is-up' : 'is-down'}>{delta >= 0 ? '+' : ''}{delta}</b>}
        </span>
      </div>
    </div>
  );
}

function Outcome({ end, tournament, mode }: { end: Extract<ServerMsg, { t: 'end' }> | null; tournament: boolean; mode: string }) {
  // a rank change plays as a ceremony first, once
  const [seen, setSeen] = useState(false);
  if (!end) return <p className="gameover__note">Saving the result…</p>;
  // a tournament's result is in its standings; a friendly game moves nothing
  if (tournament) return <p className="gameover__note">The result is in the tournament's standings.</p>;
  if (mode === 'friendly') return <p className="gameover__note">A friendly game: no rank, no coins.</p>;
  return (
    <div className="go-outcome">
      {end.rating && rankMoved(end.rating.before, end.rating.after) && !seen && (
        <RankUp before={end.rating.before} after={end.rating.after} onDone={() => setSeen(true)} />
      )}
      {end.rating && <RankMove before={end.rating.before} after={end.rating.after} />}
      <div className="go-tile go-coins">
        <span className="go-coins__coin" aria-hidden />
        <div>
          <span className="go-tile__label">Coins</span>
          <strong>+<CountUp to={end.coins + end.bonus} /></strong>
          {end.bonus > 0 ? <em className="go-coins__bonus">incl. first win of the day +{end.bonus}</em>
            : end.coins === 0 && <span className="muted small">Too short a game</span>}
        </div>
      </div>
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
  const tm = start.tournament;
  const mode = tm ? `${tm.name} · ${tm.round} · game ${tm.game} (${tm.score[start.seat]}–${tm.score[1 - start.seat]})`
    : start.mode === 'ranked' ? 'Ranked' : start.mode === 'friendly' ? 'Friendly' : 'Casual';
  return (
    <GameScreen host={host} cards={cards} db={db} names={start.names}
      onNewGame={leave} onChangeDecks={leave}
      online={{ mode, clock: () => host.deadlines, outcome: <Outcome end={end} tournament={!!tm} mode={start.mode} /> }} />
  );
}
