import { useEffect, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';

/** Your decks. The starter you took is the first; the builder adds the rest. */
export function DecksView({ db }: { db: CardDb }) {
  const own = useCollection();
  const [deck, setDeck] = useState<StarterChoice | null>(null);
  useEffect(() => {
    let alive = true;
    if (own.starter) loadStarters(db).then((all) => { if (alive) setDeck(all.find((s) => s.id === own.starter) ?? null); }).catch(() => undefined);
    return () => { alive = false; };
  }, [db, own.starter]);
  const legend = deck?.legendCard ? db.cards.find((c) => c.id === deck.legendCard) : undefined;

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
              <span className="muted small">{deck ? `${deck.size} cards · ${deck.product}` : 'Loading…'}</span>
              <a className="btn btn--cta btn--small" href="#play/computer">Play with this deck</a>
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
    </section>
  );
}
