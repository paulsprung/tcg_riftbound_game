import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { useDecks } from '../decks/store.ts';
import { api, showNotice } from '../net/api.ts';
import { useSession } from '../net/session.ts';
import { playerDecks } from '../play/host/decks.ts';
import { cardIndex } from '../play/model/cards.ts';
import { DeckPicker } from '../play/setup/DeckSetup.tsx';
import './tournaments.css';

/*
 * Tournaments (server/tournament/director.ts): the list, and one
 * tournament's page with sign-up (a deck that is locked from then on),
 * the standings and the pairings. A running round's games start by
 * themselves: the table opens when your match is on.
 */

interface Prize { coins: number; packs?: Record<string, number> }
interface Settings { bestOf: 1 | 3; maxPlayers: number; entryFee: number; topCut: 0 | 4 | 8; rounds: number | null; prizes: Prize[]; noShowMinutes: number }
interface Summary { id: string; name: string; status: string; settings: Settings; startsAt: number; round: number; stage: string; players: number; joined: boolean }
interface Who { name: string; me: boolean }
interface Detail extends Omit<Summary, 'players'> {
  players: (Who & { dropped: boolean; rank: number | null })[];
  standings: (Who & { rank: number; points: number; record: string; omw: number; gw: number; ogw: number })[];
  matches: { round: number; stage: string; table: number; a: Who; b: Who | null; wins: [number, number]; games: number; status: string }[];
}

const STATUS: Record<string, string> = { open: 'Sign-up open', running: 'Running', done: 'Finished', cancelled: 'Cancelled' };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const prizeText = (p: Prize | undefined) => (!p ? '—' : [p.coins ? `${p.coins.toLocaleString('en-US')} coins` : '', ...Object.entries(p.packs ?? {}).map(([s, n]) => `${n}× ${s.toUpperCase()} pack`)].filter(Boolean).join(' + ') || '—');
const formatText = (s: Settings) => `Best of ${s.bestOf}${s.topCut ? ` · Top ${s.topCut}` : ''} · ${s.rounds ? `${s.rounds} rounds` : 'Swiss'}`;

function TournamentPage({ id, db, onBack }: { id: string; db: CardDb; onBack: () => void }) {
  const [t, setT] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'standings' | 'pairings' | 'players' | 'prizes'>('standings');
  const [picking, setPicking] = useState(false);
  const [round, setRound] = useState<string | null>(null);
  const own = useCollection();
  const built = useDecks();
  const decks = useMemo(() => playerDecks(own, true), [own, built]);
  const cards = useMemo(() => cardIndex(db), [db]);
  const load = useCallback(() => api<{ tournament: Detail }>('GET', `/api/tournaments/${id}`).then((r) => setT(r.tournament)).catch(() => undefined), [id]);
  useEffect(() => { void load(); const i = setInterval(() => { void load(); }, 5000); return () => clearInterval(i); }, [load]);
  const act = (path: string, body?: unknown) => api('POST', path, body).then(load).catch((e: Error) => showNotice(e.message));

  if (!t) return <p className="muted">Loading…</p>;
  const rounds = [...new Set(t.matches.map((m) => `${m.stage}:${m.round}`))];
  const shownRound = round && rounds.includes(round) ? round : rounds.at(-1) ?? null;
  const roundLabel = (key: string) => {
    const [stage, r] = key.split(':');
    if (stage === 'swiss') return `Round ${r}`;
    const n = t.matches.filter((m) => `${m.stage}:${m.round}` === key).length;
    return n === 1 ? 'Final' : n === 2 ? 'Semifinals' : 'Quarterfinals';
  };
  const me = t.players.find((p) => p.me);
  const myMatch = t.matches.filter((m) => m.status !== 'done' && (m.a.me || m.b?.me)).at(-1);

  return (
    <section className="tn lb-col">
      <div className="lb-head">
        <button type="button" className="btn btn--ghost btn--small" onClick={onBack}>← Tournaments</button>
        <h1>{t.name}</h1>
        <span className={`tn-status tn-status--${t.status}`}>{STATUS[t.status] ?? t.status}</span>
      </div>
      <div className="tn-top">
        <div className="tn-facts lb-card">
          <span><b>{t.status === 'open' ? 'Starts' : 'Started'}</b>{when(t.startsAt)}</span>
          <span><b>Format</b>{formatText(t.settings)}</span>
          <span><b>Players</b>{t.players.length} / {t.settings.maxPlayers}</span>
          <span><b>Entry</b>{t.settings.entryFee ? `${t.settings.entryFee} coins` : 'Free'}</span>
          <span><b>First prize</b>{prizeText(t.settings.prizes[0])}</span>
        </div>
        <div className="tn-me lb-card">
          {t.status === 'open' && !t.joined && (
            <>
              <p className="muted small">Your deck is locked when you sign up, as a decklist.</p>
              <button type="button" className="btn btn--cta" disabled={decks.length === 0} onClick={() => setPicking(true)}>Sign up</button>
              {decks.length === 0 && <p className="muted small">You need a legal deck of your own cards.</p>}
            </>
          )}
          {t.status === 'open' && t.joined && (
            <>
              <p><b>You are in.</b> The first round starts at {when(t.startsAt)}. Be online then: a no-show loses after {t.settings.noShowMinutes} minutes.</p>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => act(`/api/tournaments/${id}/leave`)}>Leave{t.settings.entryFee ? ' (fee back)' : ''}</button>
            </>
          )}
          {t.status === 'running' && me && (
            <>
              <p>{me.dropped ? 'You dropped out.' : myMatch ? <>Your match: <b>{myMatch.a.me ? myMatch.b?.name ?? 'Bye' : myMatch.a.name}</b> · {myMatch.wins[myMatch.a.me ? 0 : 1]}–{myMatch.wins[myMatch.a.me ? 1 : 0]}. The table opens by itself.</> : 'Waiting for the round to finish.'}</p>
              {!me.dropped && <button type="button" className="btn btn--ghost btn--small" onClick={() => act(`/api/tournaments/${id}/leave`)}>Drop</button>}
            </>
          )}
          {t.status === 'done' && me && <p>You finished <b>#{me.rank}</b>.</p>}
          {!me && t.status !== 'open' && <p className="muted">You are watching.</p>}
        </div>
      </div>

      <div className="tn-tabs" role="tablist">
        {(['standings', 'pairings', 'players', 'prizes'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      <div className="tn-body lb-scroll">
        {tab === 'standings' && (
          t.standings.length === 0 || t.round === 0 ? <p className="muted">Standings appear after the first round.</p> : (
            <table className="tn-table">
              <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Record</th><th title="Opponents' match-win %">OMW%</th><th title="Game-win %">GW%</th><th title="Opponents' game-win %">OGW%</th></tr></thead>
              <tbody>{t.standings.map((s) => (
                <tr key={s.rank} className={s.me ? 'is-me' : ''}><td>{s.rank}</td><td>{s.name}</td><td>{s.points}</td><td>{s.record}</td><td>{s.omw}</td><td>{s.gw}</td><td>{s.ogw}</td></tr>
              ))}</tbody>
            </table>
          )
        )}
        {tab === 'pairings' && (
          rounds.length === 0 ? <p className="muted">No pairings yet.</p> : (
            <>
              <div className="tn-rounds">{rounds.map((k) => <button key={k} type="button" aria-pressed={k === shownRound} onClick={() => setRound(k)}>{roundLabel(k)}</button>)}</div>
              <table className="tn-table">
                <thead><tr><th>Table</th><th>Player</th><th>Score</th><th>Player</th><th /></tr></thead>
                <tbody>{t.matches.filter((m) => `${m.stage}:${m.round}` === shownRound).map((m) => (
                  <tr key={m.table} className={m.a.me || m.b?.me ? 'is-me' : ''}>
                    <td>{m.table}</td><td className={m.wins[0] > m.wins[1] ? 'is-win' : ''}>{m.a.name}</td>
                    <td>{m.b ? `${m.wins[0]}–${m.wins[1]}` : '—'}</td>
                    <td className={m.wins[1] > m.wins[0] ? 'is-win' : ''}>{m.b?.name ?? 'Bye'}</td>
                    <td className="muted small">{m.status === 'done' ? 'Done' : `Game ${m.games + 1}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          )
        )}
        {tab === 'players' && (
          <ul className="tn-players">{t.players.map((p, i) => <li key={i} className={p.me ? 'is-me' : ''}>{p.rank ? `#${p.rank} ` : ''}{p.name}{p.dropped ? <em> · dropped</em> : null}</li>)}</ul>
        )}
        {tab === 'prizes' && (
          t.settings.prizes.length === 0 ? <p className="muted">No prizes: for the glory.</p> : (
            <table className="tn-table"><tbody>{t.settings.prizes.map((p, i) => <tr key={i}><td>#{i + 1}</td><td>{prizeText(p)}</td></tr>)}</tbody></table>
          )
        )}
      </div>
      {picking && (
        <DeckPicker cards={cards} db={db} title="Your deck for the tournament" only={decks} current={decks[0]?.id ?? ''} owned={own.starter}
          onClose={() => setPicking(false)} onPick={(b) => { setPicking(false); void act(`/api/tournaments/${id}/join`, { deck: b.id }); }} />
      )}
    </section>
  );
}

/** Play → Tournament: what is open, running and lately finished. */
export function Tournaments({ db }: { db: CardDb }) {
  const session = useSession();
  const signedIn = session.status === 'online' && !!session.user;
  const [list, setList] = useState<Summary[] | null>(null);
  const [open, setOpen] = useState<string | null>(() => /^#\/?play\/tournament\/([0-9a-f-]{36})/.exec(location.hash)?.[1] ?? null);
  useEffect(() => {
    if (!signedIn) return;
    const load = () => api<{ tournaments: Summary[] }>('GET', '/api/tournaments').then((r) => setList(r.tournaments)).catch(() => setList([]));
    void load();
    const i = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(i);
  }, [signedIn]);
  const go = (id: string | null) => { setOpen(id); history.replaceState(null, '', id ? `#play/tournament/${id}` : '#play/tournament'); };

  if (!signedIn) {
    return (
      <section className="tn lb-col">
        <div className="lb-head"><h1>Tournaments</h1></div>
        <p className="muted">{session.status === 'offline' ? 'Tournaments need the server: not in this preview.' : 'Sign in with Discord to enter tournaments.'}</p>
      </section>
    );
  }
  if (open) return <TournamentPage id={open} db={db} onBack={() => go(null)} />;
  return (
    <section className="tn lb-col">
      <div className="lb-head"><h1>Tournaments</h1></div>
      <div className="tn-list lb-scroll">
        {list === null && <p className="muted">Loading…</p>}
        {list?.length === 0 && <p className="muted">No tournaments right now. Watch this space.</p>}
        {list?.map((t) => (
          <button key={t.id} type="button" className={`tn-item lb-card${t.joined ? ' is-joined' : ''}`} onClick={() => go(t.id)}>
            <span className={`tn-status tn-status--${t.status}`}>{STATUS[t.status] ?? t.status}</span>
            <strong>{t.name}</strong>
            <span className="muted small">{when(t.startsAt)} · {formatText(t.settings)}</span>
            <span className="tn-item__meta">
              <span>{t.players} / {t.settings.maxPlayers} players</span>
              <span>{t.settings.entryFee ? `${t.settings.entryFee} coins entry` : 'Free entry'}</span>
              <span>1st: {prizeText(t.settings.prizes[0])}</span>
            </span>
            {t.joined && <em className="tn-item__in">You're in</em>}
          </button>
        ))}
      </div>
    </section>
  );
}
