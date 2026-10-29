import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CardDb } from '../data/types.ts';
import { divisionProgress, PLACEMENT_GAMES, rankName, rankStep } from '../economy/ranks.ts';
import { RankEmblem } from '../lobby/RankEmblem.tsx';
import { online } from '../net/socket.ts';
import type { RatingInfo, ServerMsg } from '../net/protocol.ts';
import { GameScreen } from './GameScreen.tsx';
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

/*
 * The rank the game moved, played out: the division bar runs from where it
 * stood; a promotion fills it, the old emblem bursts and the new one lands
 * (bigger for a new tier), then the bar runs on in the new division. A
 * demotion empties it and the old emblem falls. The fifth placement game
 * reveals the first rank.
 */
type Phase = 'start' | 'run' | 'swap' | 'settle';

function RankMove({ before, after }: { before: RatingInfo; after: RatingInfo }) {
  const placed = before.placement && !after.placement;
  const moved = placed || (!before.placement && rankStep(after.tier, after.division) !== rankStep(before.tier, before.division));
  const up = placed || (moved ? rankStep(after.tier, after.division) > rankStep(before.tier, before.division) : after.points >= before.points);
  const newTier = placed || (moved && before.tier !== after.tier);
  const [phase, setPhase] = useState<Phase>('start');
  useEffect(() => {
    const at = (ms: number, p: Phase) => setTimeout(() => setPhase(p), ms);
    // after the tile has come in (the scene's own entrance): the bar runs, then the emblem changes
    const t = moved ? [at(1600, 'run'), at(3100, 'swap'), at(3300, 'settle')] : [at(1600, 'run')];
    return () => t.forEach(clearTimeout);
  }, [moved]);

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
  const swapped = phase === 'swap' || phase === 'settle';
  const shown = swapped || !moved ? after : before;
  const bar = phase === 'start' ? (before.placement ? 0 : divisionProgress(before.points))
    : phase === 'run' ? (moved ? (up ? 1 : 0) : divisionProgress(after.points))
    : phase === 'swap' ? (up ? 0 : 1) : divisionProgress(after.points);
  const delta = before.placement ? null : after.points - before.points;
  const verdict = placed ? `Placed in ${rankName(after.tier, after.division)}` : moved ? (up ? (newTier ? 'Tier up' : 'Promoted') : 'Demoted') : null;
  return (
    <div className={`go-tile go-rank${moved ? (up ? ' is-up' : ' is-down') : ''}${newTier ? ' is-tier' : ''} is-${phase}`}>
      <div className="go-rank__emblem">
        {moved && swapped && <span className="go-rank__flash" aria-hidden />}
        {moved && swapped && <RankEmblem key="old" tier={before.placement ? null : before.tier} division={before.division} size={104} className="go-rank__old" />}
        <RankEmblem key={swapped ? 'new' : 'cur'} tier={shown.placement ? null : shown.tier} division={shown.division} size={104}
          className={moved && swapped ? 'go-rank__new' : ''} />
      </div>
      <div className="go-rank__text">
        <span className="go-tile__label">{verdict && swapped ? verdict : 'Ranked'}</span>
        <strong>{shown.placement ? 'Unranked' : rankName(shown.tier, shown.division)}</strong>
        <div className={`go-rank__bar${phase === 'swap' ? ' is-reset' : ''}`}><span style={{ width: `${Math.round(bar * 100)}%` }} /></div>
        <span className="go-rank__lp">
          {after.points.toLocaleString('en-US')} LP
          {delta !== null && <b className={delta >= 0 ? 'is-up' : 'is-down'}>{delta >= 0 ? '+' : ''}{delta}</b>}
        </span>
      </div>
    </div>
  );
}

function Outcome({ end, tournament, mode }: { end: Extract<ServerMsg, { t: 'end' }> | null; tournament: boolean; mode: string }) {
  if (!end) return <p className="gameover__note">Saving the result…</p>;
  // a tournament's result is in its standings; a friendly game moves nothing
  if (tournament) return <p className="gameover__note">The result is in the tournament's standings.</p>;
  if (mode === 'friendly') return <p className="gameover__note">A friendly game: no rank, no coins.</p>;
  return (
    <div className="go-outcome">
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
