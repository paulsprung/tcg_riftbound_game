import { useMemo, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { BOOSTER_SETS } from '../pack/packConfig.ts';
import { CardGrid } from './CardGrid.tsx';

type Show = 'owned' | 'missing' | 'all';

export function CollectionView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const owned = useCollection();
  const boosterIds = BOOSTER_SETS.map((b) => b.id);
  const sets = db.sets.filter((s) => boosterIds.includes(s.id))
    .sort((a, b) => boosterIds.indexOf(a.id) - boosterIds.indexOf(b.id));
  const [setId, setSetId] = useState(() => sets.find((s) => owned.packsOpened[s.id])?.id ?? sets[0]?.id ?? '');
  const [show, setShow] = useState<Show>('owned');
  const [confirming, setConfirming] = useState(false);

  const setCards = useMemo(() => db.cards.filter((c) => c.setId === setId), [db, setId]);
  const has = (id: string) => {
    const o = owned.cards[id];
    return !!o && o.normal + o.foil > 0;
  };

  const stats = useMemo(() => {
    const unique = setCards.filter((c) => has(c.id)).length;
    let copies = 0;
    let foils = 0;
    for (const c of setCards) {
      const o = owned.cards[c.id];
      if (o) { copies += o.normal + o.foil; foils += o.foil; }
    }
    return { unique, copies, foils, total: setCards.length };
  }, [setCards, owned]);

  const cards = setCards.filter((c) => show === 'all' || (show === 'owned') === has(c.id));
  const pct = stats.total ? Math.round((stats.unique / stats.total) * 100) : 0;

  return (
    <section>
      <div className="page-head">
        <h1>Your collection</h1>
        <p className="muted">Everything you pull is saved in this browser.</p>
      </div>

      <div className="set-tabs" role="tablist" aria-label="Set">
        {sets.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === setId} className="set-tab" onClick={() => setSetId(s.id)}>
            {s.name}
            <span className="muted small">{owned.packsOpened[s.id] ?? 0} {owned.packsOpened[s.id] === 1 ? 'pack' : 'packs'}</span>
          </button>
        ))}
      </div>

      <div className="progress-card">
        <div className="progress-card__nums">
          <div><b>{stats.unique}</b><span className="muted"> / {stats.total} cards</span></div>
          <div><b>{stats.copies}</b><span className="muted"> copies</span></div>
          <div><b>{stats.foils}</b><span className="muted"> foils</span></div>
          <div><b>{owned.packsOpened[setId] ?? 0}</b><span className="muted"> {owned.packsOpened[setId] === 1 ? 'pack' : 'packs'} opened</span></div>
        </div>
        <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Set completion">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-card__row">
          <div className="seg" role="group" aria-label="Show">
            {(['owned', 'missing', 'all'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
          {confirming ? (
            <div className="confirm" role="group" aria-label="Confirm reset">
              <span>Delete every card in this browser?</span>
              <button type="button" className="btn btn--danger btn--small" onClick={() => { collection.reset(); setConfirming(false); }}>
                Delete all
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirming(false)}>Keep</button>
            </div>
          ) : (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirming(true)}>Reset collection</button>
          )}
        </div>
      </div>

      {show === 'owned' && stats.unique === 0 ? (
        <div className="empty">
          <p>No cards from this set yet.</p>
          <a className="btn btn--primary" href="#packs">Open a pack</a>
        </div>
      ) : (
        <CardGrid
          cards={cards}
          onInspect={onInspect}
          dim={(c) => !has(c.id)}
          foil={(c) => (owned.cards[c.id]?.foil ?? 0) > 0}
          badge={(c) => {
            const o = owned.cards[c.id];
            if (!o || o.normal + o.foil === 0) return null;
            return (
              <span className="count-badge">
                ×{o.normal + o.foil}{o.foil > 0 && <span className="count-badge__foil" title={`${o.foil} foil`}>✦{o.foil}</span>}
              </span>
            );
          }}
        />
      )}
    </section>
  );
}
