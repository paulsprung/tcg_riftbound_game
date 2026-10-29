import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardDb } from '../data/types.ts';
import type { DeckList } from '../game/decks/decklist.ts';
import { api, showNotice } from '../net/api.ts';
import { online as socket, useOnline } from '../net/socket.ts';
import { BOOSTER_SETS } from '../pack/packConfig.ts';
import { PackWrapper } from '../pack/PackWrapper.tsx';
import { heroCard } from '../pack/hero.ts';
import { Builder, Countdown, DraftPicks } from './LimitedFlow.tsx';
import { autoBuild, MIN_DECK, type LimitedFormat } from './limited.ts';
import './limited.css';

/*
 * Limited online. Casual (Play → Casual → Sealed or Draft): a pool of your
 * own from the server (six boosters, or a draft with seven computer seats),
 * a deck from it, then the sealed or draft queue against other players with
 * their own pools. In a Limited tournament: the tournament's draft at your
 * seat on its pick clock, then your deck from your pool until the build
 * time is up (Ready ends it sooner when everyone is).
 */

interface PoolView {
  id: string; format: LimitedFormat; setId: string; cards: string[]; deck: DeckList | null; tournament: string | null;
  draft: { round: number; pack: string[]; picks: string[]; deadline?: number } | null;
  status?: string; buildUntil?: number | null;
}

function useCards(db: CardDb) {
  return useMemo(() => new Map(db.cards.map((c) => [c.id, c])), [db]);
}

/** The pool's deck being built: kept here, saved to the server on Save, Ready or Find match. */
function PoolBuilder({ db, pool, label, onGo }: { db: CardDb; pool: PoolView; label: string; onGo: (deck: DeckList) => void }) {
  const cards = useCards(db);
  const [deck, setDeck] = useState<DeckList>(() => pool.deck ?? autoBuild(pool.cards, pool.format, cards));
  return <Builder cards={cards} pool={pool.cards} format={pool.format} deck={deck} onChange={setDeck}
    onAuto={() => setDeck(autoBuild(pool.cards, pool.format, cards))} playLabel={label} onPlay={() => onGo(deck)} />;
}

/** Play → Casual → Sealed or Draft. */
export function CasualLimited({ db, format }: { db: CardDb; format: LimitedFormat }) {
  const cards = useCards(db);
  const ol = useOnline();
  const [pool, setPool] = useState<PoolView | null | undefined>(undefined);
  const [setId, setSetId] = useState(BOOSTER_SETS[0].id);
  useEffect(() => { api<{ pool: PoolView | null }>('GET', '/api/limited').then((r) => setPool(r.pool)).catch(() => setPool(null)); }, []);
  const start = () => api<{ pool: PoolView }>('POST', '/api/limited', { format, setId }).then((r) => setPool(r.pool)).catch((e: Error) => showNotice(e.message));
  const take = (card: string) => pool && api<{ pool: PoolView }>('POST', `/api/limited/${pool.id}/pick`, { card }).then((r) => setPool(r.pool)).catch((e: Error) => showNotice(e.message));
  const play = (deck: DeckList) => pool && api<{ pool: PoolView }>('PUT', `/api/limited/${pool.id}/deck`, { deck })
    .then((r) => { setPool(r.pool); socket.clearError(); socket.send({ t: 'queue', mode: format, deck: `limited:${r.pool.id}` }); })
    .catch((e: Error) => showNotice(e.message));
  const queued = ol.queue?.mode === format;

  if (pool === undefined) return <p className="muted">Loading…</p>;
  if (!pool || pool.format !== format) {
    return (
      <div className="lm-sets">
        <p className="muted">{format === 'sealed'
          ? `Six boosters, just for this: build a deck of at least ${MIN_DECK.sealed} cards and play others with their own pools. Your collection stays as it is.`
          : `Draft three boosters with seven computer players, build a deck of at least ${MIN_DECK.draft} from your 39 picks and play others who drafted too.`}</p>
        <div className="lm-sets__row">
          {BOOSTER_SETS.map((s) => {
            const info = db.sets.find((x) => x.id === s.id);
            return info && (
              <button key={s.id} type="button" className={`lm-set${setId === s.id ? ' is-on' : ''}`} onClick={() => setSetId(s.id)}>
                <PackWrapper set={info} style={s.style} hero={heroCard(db.cards.filter((c) => c.setId === s.id), s.style)} width={110} />
                <strong>{info.name}</strong>
              </button>
            );
          })}
        </div>
        <div className="ds__start"><button type="button" className="btn btn--cta" onClick={() => { void start(); }}>{format === 'sealed' ? 'Open six boosters' : 'Start the draft'}</button></div>
      </div>
    );
  }
  if (pool.draft) return <DraftPicks cards={cards} round={pool.draft.round} pack={pool.draft.pack} picks={pool.draft.picks} onPick={(id) => { void take(id); }} />;
  return (
    <div className="lm-online">
      <div className="lm-online__bar">
        <span className="lm-sub">{format === 'sealed' ? 'Sealed' : 'Draft'} pool · {db.sets.find((s) => s.id === pool.setId)?.name}</span>
        {queued ? <button type="button" className="btn btn--ghost btn--small" onClick={() => socket.send({ t: 'leave' })}>Cancel search</button>
          : <button type="button" className="btn btn--ghost btn--small" onClick={() => setPool(null)}>New pool</button>}
      </div>
      <PoolBuilder key={pool.id} db={db} pool={pool} label={queued ? 'Searching…' : 'Find match'} onGo={(d) => { if (!queued) void play(d); }} />
    </div>
  );
}

/** A Limited tournament before its rounds: the draft at your seat, then your deck. */
export function TournamentLimited({ db, id, onChange }: { db: CardDb; id: string; onChange: () => void }) {
  const cards = useCards(db);
  const [pool, setPool] = useState<PoolView | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(() => api<{ pool: PoolView }>('GET', `/api/tournaments/${id}/pool`).then((r) => setPool(r.pool)).catch(() => undefined), [id]);
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 2000); return () => clearInterval(t); }, [load]);
  if (!pool) return <p className="muted">Loading your pool…</p>;
  if (pool.status === 'drafting' && pool.draft) {
    return <DraftPicks cards={cards} round={pool.draft.round} pack={pool.draft.pack} picks={pool.draft.picks} deadline={pool.draft.deadline}
      onPick={(card) => { api<{ pool: PoolView }>('POST', `/api/tournaments/${id}/pick`, { card }).then((r) => setPool(r.pool)).catch((e: Error) => showNotice(e.message)); }} />;
  }
  if (pool.status !== 'building') return <p className="muted">Waiting for the draft to end…</p>;
  const save = (deck: DeckList) => api<{ pool: PoolView }>('PUT', `/api/tournaments/${id}/deck`, { deck })
    .then(() => api('POST', `/api/tournaments/${id}/ready`)).then(() => { setReady(true); onChange(); showNotice('Deck saved: ready for the rounds', true); })
    .catch((e: Error) => showNotice(e.message));
  return (
    <div className="lm-online">
      <div className="lm-online__bar">
        <span className="lm-sub">Build your deck{pool.buildUntil ? <> · <Countdown to={pool.buildUntil} /></> : null}</span>
        {ready && <span className="muted small">Ready: you can still change it until the time is up</span>}
      </div>
      <PoolBuilder key={pool.id} db={db} pool={pool} label={ready ? 'Save again' : 'Save and ready'} onGo={(d) => { void save(d); }} />
    </div>
  );
}
