import { useEffect, useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { useCollection } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';

const SECTIONS: { id: string; label: string; types: string[] }[] = [
  { id: 'legend', label: 'Legend', types: ['Legend'] },
  { id: 'units', label: 'Units', types: ['Unit'] },
  { id: 'spells', label: 'Spells', types: ['Spell'] },
  { id: 'gear', label: 'Gear', types: ['Gear'] },
  { id: 'battlefields', label: 'Battlefields', types: ['Battlefield'] },
  { id: 'runes', label: 'Runes', types: ['Rune'] },
];

/** A deck's cards, by kind, with how many of each. Click a card to look at it. */
function DeckView({ deck, db, onInspect, onClose }: { deck: StarterChoice; db: CardDb; onInspect: (t: InspectTarget) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const groups = useMemo(() => {
    const byId = new Map(db.cards.map((c) => [c.id, c]));
    const rows = Object.entries(deck.cards).flatMap(([id, n]) => { const c = byId.get(id); return c ? [{ card: c, n }] : []; });
    return SECTIONS.map((s) => ({ ...s, rows: rows.filter((r) => s.types.includes(r.card.type)).sort((a, b) => (a.card.energy ?? 0) - (b.card.energy ?? 0) || a.card.name.localeCompare(b.card.name)) }))
      .filter((g) => g.rows.length > 0);
  }, [deck, db]);
  return (
    <div className="ds-modal" role="dialog" aria-modal="true" aria-label={deck.title} onClick={onClose}>
      <div className="ds-modal__panel lb-card dv" onClick={(e) => e.stopPropagation()}>
        <header className="ds-modal__head">
          <h2>{deck.title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="dv__body">
          {groups.map((g) => (
            <section key={g.id} className="dv__group">
              <p className="lb-label">{g.label} <span className="stage__count">{g.rows.reduce((a, r) => a + r.n, 0)}</span></p>
              <div className="dv__cards">
                {g.rows.map(({ card, n }) => (
                  <div key={card.id} className="dv__card">
                    <HoloCard card={card} finish={defaultFinish(card, false)} width="100%" imageWidth={300}
                      onClick={() => onInspect({ card, finish: defaultFinish(card, false) })} />
                    {n > 1 && <span className="count-badge">×{n}</span>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Your decks. The starter you took is the first; the builder adds the rest. */
export function DecksView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const own = useCollection();
  const [deck, setDeck] = useState<StarterChoice | null>(null);
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    let alive = true;
    if (own.starter) loadStarters(db).then((all) => { if (alive) setDeck(all.find((s) => s.id === own.starter) ?? null); }).catch(() => undefined);
    return () => { alive = false; };
  }, [db, own.starter]);
  const legend: Card | undefined = deck?.legendCard ? db.cards.find((c) => c.id === deck.legendCard) : undefined;

  return (
    <section className="lb-col">
      <div className="lb-head">
        <h1>Your Decks</h1>
        <span className="lb-soon-note">Deck builder coming soon</span>
      </div>
      <div className="dk-grid lb-scroll">
        {own.starter ? (
          <article className="lb-card dk-tile">
            <div className="dk-tile__art">{legend ? <HoloCard card={legend} finish="none" width="100%" imageWidth={360} /> : <div className="starter__ph" />}</div>
            <div className="dk-tile__info">
              <strong>{deck?.title ?? 'Starter deck'}</strong>
              <span className="muted small">{deck ? `${deck.size} cards` : '…'}</span>
              <button type="button" className="btn btn--cta btn--small" disabled={!deck} onClick={() => setShowing(true)}>Show me this deck</button>
            </div>
          </article>
        ) : (
          <article className="lb-card dk-tile dk-tile--empty">
            <p>You have no deck yet.</p>
            <a className="btn btn--primary btn--small" href="#home">Choose a starter deck</a>
          </article>
        )}
        <article className="dk-tile dk-tile--new" aria-disabled>
          <span aria-hidden>+</span>
          <strong>New deck</strong>
          <span className="muted small">Build one from your collection</span>
        </article>
      </div>
      {showing && deck && <DeckView deck={deck} db={db} onInspect={onInspect} onClose={() => setShowing(false)} />}
    </section>
  );
}
