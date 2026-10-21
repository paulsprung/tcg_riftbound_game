import { useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, SHOWCASE_SIZE, useCollection, type ShowcaseItem } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { descriptor, GRADER, type Slab as SlabData } from '../showcase/grading.ts';
import { GradingRun } from '../showcase/GradingRun.tsx';
import { LABEL_STYLES, setLabelStyle, useLabelStyle } from '../showcase/labelStyle.ts';
import { Picker } from '../showcase/Picker.tsx';
import { Slab } from '../showcase/Slab.tsx';
import '../showcase/showcase.css';

type Sort = 'new' | 'grade';

interface Piece { item: ShowcaseItem; card: Card; slab: SlabData | null; foil: boolean }

export function ShowcaseView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const owned = useCollection();
  const byId = useMemo(() => new Map(db.cards.map((c) => [c.id, c])), [db]);
  const slabByCert = useMemo(() => new Map(owned.slabs.map((s) => [s.cert, s])), [owned.slabs]);
  const labelStyle = useLabelStyle();
  const [picking, setPicking] = useState<null | 'grade' | 'display'>(null);
  const [run, setRun] = useState<{ card: Card; slab: SlabData } | null>(null);
  const [sort, setSort] = useState<Sort>('new');

  const items = owned.showcase.flatMap((item): Piece[] => {
    if (item.kind === 'slab') {
      const slab = slabByCert.get(item.cert);
      const card = slab && byId.get(slab.cardId);
      return slab && card ? [{ item, card, slab, foil: slab.foil }] : [];
    }
    const card = byId.get(item.cardId);
    const o = owned.cards[item.cardId];
    return card && o && (item.foil ? o.foil : o.normal) > 0 ? [{ item, card, slab: null, foil: item.foil }] : [];
  });

  const slabs = useMemo(() => {
    const list = owned.slabs.filter((s) => byId.has(s.cardId));
    return sort === 'grade'
      ? [...list].sort((a, b) => b.grade - a.grade || +b.pristine - +a.pristine || b.gradedAt - a.gradedAt)
      : list;
  }, [owned.slabs, byId, sort]);

  const gems = owned.slabs.filter((s) => s.grade === 10).length;
  const startGrade = (card: Card, foil: boolean) => {
    const slab = collection.grade(card.id, foil);
    setPicking(null);
    if (slab) setRun({ card, slab });
  };
  const inspect = (card: Card, slab: SlabData | null, foil = false) =>
    onInspect({ card, finish: defaultFinish(card, slab ? slab.foil : foil), slab: slab ?? undefined });

  return (
    <section className="showcase">
      <div className="page-head showcase__head">
        <div>
          <h1>Showcase</h1>
          <p className="muted">
            Your best pulls on display. Send a card to {GRADER.name} and it comes back sealed in a slab, graded 1 to 10.
          </p>
        </div>
        <div className="showcase__head-actions">
          <button type="button" className="btn btn--primary" onClick={() => setPicking('grade')}>Grade a card</button>
        </div>
      </div>

      <div className="vitrine" aria-label="Display case">
        <div className="vitrine__grid">
          {items.map(({ item, card, slab, foil }, i) => (
            <div key={item.kind === 'slab' ? item.cert : `${item.cardId}-${item.foil}`} className="vitrine__spot is-filled">
              <div className="vitrine__piece">
                {slab ? (
                  <Slab slab={slab} card={card} width="100%" imageWidth={360} onClick={() => inspect(card, slab)} />
                ) : (
                  <div className="stand">
                    <HoloCard card={card} finish={defaultFinish(card, foil)} width="100%" imageWidth={360}
                      onClick={() => inspect(card, null, foil)} />
                  </div>
                )}
              </div>
              <div className="vitrine__tools">
                <button type="button" className="icon-btn" aria-label="Move left" disabled={i === 0}
                  onClick={() => collection.shift(item, -1)}>‹</button>
                <button type="button" className="icon-btn" aria-label="Take out of the showcase"
                  onClick={() => collection.undisplay(item)}>✕</button>
                <button type="button" className="icon-btn" aria-label="Move right" disabled={i === items.length - 1}
                  onClick={() => collection.shift(item, 1)}>›</button>
              </div>
            </div>
          ))}
          {Array.from({ length: Math.max(0, SHOWCASE_SIZE - items.length) }, (_, i) => (
            <div key={`empty-${i}`} className="vitrine__spot is-empty">
              <button type="button" className="vitrine__add" onClick={() => setPicking('display')}
                aria-label="Add a card to the showcase">
                <span aria-hidden>+</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="showcase__bar">
        <h2 className="showcase__h2">Your slabs <span className="muted">{owned.slabs.length}{gems > 0 && <> · {gems} gem mint</>}</span></h2>
        <div className="showcase__bar-tools">
          <div className="seg" role="group" aria-label="Label style">
            {LABEL_STYLES.map((s) => (
              <button key={s.id} type="button" aria-pressed={labelStyle === s.id} onClick={() => setLabelStyle(s.id)}>{s.label}</button>
            ))}
          </div>
          {slabs.length > 1 && (
            <div className="seg" role="group" aria-label="Sort">
              <button type="button" aria-pressed={sort === 'new'} onClick={() => setSort('new')}>Newest</button>
              <button type="button" aria-pressed={sort === 'grade'} onClick={() => setSort('grade')}>Grade</button>
            </div>
          )}
        </div>
      </div>

      {slabs.length === 0 ? (
        <div className="empty">
          <p className="muted">No graded cards yet. Pick a card from your collection and see what it gets.</p>
          <button type="button" className="btn btn--primary" onClick={() => setPicking('grade')}>Grade a card</button>
        </div>
      ) : (
        <div className="slab-grid">
          {slabs.map((s) => {
            const card = byId.get(s.cardId)!;
            const item: ShowcaseItem = { kind: 'slab', cert: s.cert };
            const on = collection.isDisplayed(item);
            return (
              <div key={s.cert} className="slab-grid__item">
                <Slab slab={s} card={card} width="100%" imageWidth={320} onClick={() => inspect(card, s)} />
                <div className="slab-grid__meta">
                  <span className="muted small">{descriptor(s)} {s.grade}</span>
                  <button type="button" className="btn btn--ghost btn--small"
                    aria-pressed={on}
                    disabled={!on && owned.showcase.length >= SHOWCASE_SIZE}
                    onClick={() => (on ? collection.undisplay(item) : collection.display(item))}>
                    {on ? 'On show ✓' : 'Show'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {picking === 'grade' && (
        <Picker db={db} mode="grade" title="Pick a card to grade" onClose={() => setPicking(null)} onPickRaw={startGrade} />
      )}
      {picking === 'display' && (
        <Picker db={db} mode="display" title="Add to the showcase" onClose={() => setPicking(null)}
          onPickRaw={(card, foil) => { collection.display({ kind: 'raw', cardId: card.id, foil }); setPicking(null); }}
          onPickSlab={(s) => { collection.display({ kind: 'slab', cert: s.cert }); setPicking(null); }} />
      )}
      {run && (
        <GradingRun key={run.slab.cert} card={run.card} slab={run.slab} onClose={() => setRun(null)}
          onAnother={() => { setRun(null); setPicking('grade'); }} />
      )}
    </section>
  );
}
