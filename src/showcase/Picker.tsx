import { useEffect, useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { collection, useCollection } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import { neededInDeck } from '../decks/ownership.ts';
import { useDecks } from '../decks/store.ts';
import type { Card, CardDb } from '../data/types.ts';
import type { Slab as SlabData } from './grading.ts';
import { rank } from './rank.ts';
import { Slab } from './Slab.tsx';

const PAGE = 60;

interface Props {
  db: CardDb;
  title: string;
  /** grade: raw copies only. display: slabs and raw copies not on show yet. */
  mode: 'grade' | 'display';
  onPickRaw: (card: Card, foil: boolean) => void;
  onPickSlab?: (slab: SlabData) => void;
  onClose: () => void;
}

/** Choose a card from the collection, rarest first. */
export function Picker({ db, title, mode, onPickRaw, onPickSlab, onClose }: Props) {
  const owned = useCollection();
  const lists = useDecks();
  const [tab, setTab] = useState<'slabs' | 'raw'>(mode === 'display' && owned.slabs.length ? 'slabs' : 'raw');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const byId = useMemo(() => new Map(db.cards.map((c) => [c.id, c])), [db]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  useEffect(() => setShown(PAGE), [tab, query]);

  const q = query.trim().toLowerCase();
  const matches = (c: Card) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);

  const raw = useMemo(() => {
    const out: { card: Card; foil: boolean; count: number }[] = [];
    for (const [id, o] of Object.entries(owned.cards)) {
      const card = byId.get(id);
      if (!card) continue;
      for (const foil of [false, true]) {
        const count = foil ? o.foil : o.normal;
        if (count < 1) continue;
        if (mode === 'display' && collection.isDisplayed({ kind: 'raw', cardId: id, foil })) continue;
        out.push({ card, foil, count });
      }
    }
    return out.sort((a, b) => rank(b.card, b.foil) - rank(a.card, a.foil) || a.card.name.localeCompare(b.card.name));
  }, [owned, byId, mode]);

  const slabs = useMemo(() => owned.slabs
    .filter((s) => byId.has(s.cardId) && !collection.isDisplayed({ kind: 'slab', cert: s.cert }))
    .sort((a, b) => b.grade - a.grade || +b.pristine - +a.pristine), [owned, byId]);

  const rawShown = raw.filter((r) => matches(r.card));
  const slabsShown = slabs.filter((s) => matches(byId.get(s.cardId)!));
  const count = tab === 'raw' ? rawShown.length : slabsShown.length;

  return (
    <div className="picker" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="picker__panel" onClick={(e) => e.stopPropagation()}>
        <div className="picker__head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="picker__tools">
          {mode === 'display' && (
            <div className="seg" role="group" aria-label="Kind">
              <button type="button" aria-pressed={tab === 'slabs'} onClick={() => setTab('slabs')}>Slabs ({slabs.length})</button>
              <button type="button" aria-pressed={tab === 'raw'} onClick={() => setTab('raw')}>Raw cards ({raw.length})</button>
            </div>
          )}
          <input className="input picker__search" type="search" placeholder="Search by name or number" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
        </div>

        {count === 0 ? (
          <div className="empty">
            {tab === 'raw' && raw.length === 0 ? (
              <>
                <p>{mode === 'grade' ? 'No raw cards to grade yet.' : 'Every raw card you own is already on show.'}</p>
                <a className="btn btn--primary" href="#shop" onClick={onClose}>Open a pack</a>
              </>
            ) : tab === 'slabs' && slabs.length === 0 ? (
              <p className="muted">No slabs to add. Grade a card first.</p>
            ) : (
              <p className="muted">No cards match.</p>
            )}
          </div>
        ) : (
          <div className={`picker__grid${tab === 'slabs' ? ' picker__grid--slabs' : ''}`}>
            {tab === 'raw' && rawShown.slice(0, shown).map(({ card, foil, count: n }) => {
              // grading the last copy a deck needs would leave it unplayable
              const locked = mode === 'grade' && neededInDeck(owned, card.id, lists);
              return (
              <div key={`${card.id}-${foil}`} className={`picker__item${locked ? ' picker__item--locked' : ''}`}
                title={locked ? 'In a deck: get a spare copy or take it out of the deck to grade it' : undefined}>
                <HoloCard card={card} finish={defaultFinish(card, foil)} width="100%" imageWidth={320}
                  onClick={locked ? undefined : () => onPickRaw(card, foil)} />
                {locked && <span className="picker__lock">In a deck</span>}
                <span className="count-badge">×{n}{foil && defaultFinish(card, false) === 'none' && <span className="count-badge__foil">✦ foil</span>}</span>
              </div>
              );
            })}
            {tab === 'slabs' && slabsShown.slice(0, shown).map((s) => (
              <div key={s.cert} className="picker__item">
                <Slab slab={s} card={byId.get(s.cardId)!} width="100%" imageWidth={320} onClick={() => onPickSlab?.(s)} />
              </div>
            ))}
          </div>
        )}
        {count > shown && (
          <div className="more">
            <button type="button" className="btn btn--ghost" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({count - shown} left)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
