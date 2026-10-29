import { useEffect, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { collection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';

const PRODUCT_ORDER = ['ogs', 'ogn', 'sfd', 'unl', 'rad'];

/** The first thing a new player does: take one of the official starter decks. */
export function Starters({ db }: { db: CardDb }) {
  const [starters, setStarters] = useState<StarterChoice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    loadStarters(db).then((s) => { if (alive) setStarters(s); }).catch(() => { if (alive) setError('Could not load the starter decks. Reload the page.'); });
    return () => { alive = false; };
  }, [db]);

  const pick = (s: StarterChoice) => {
    setBusy(s.id);
    collection.grantStarter(s.id, s.cards, { [s.booster]: 1 }, 0);
    setBusy(null);
  };

  const groups = PRODUCT_ORDER
    .map((set) => ({ set, items: (starters ?? []).filter((s) => s.set === set) }))
    .filter((g) => g.items.length > 0);

  return (
    <section className="starters">
      <h2>Choose your starter deck</h2>
      <p className="muted">
        Every official starter deck, ready to play: legend, 40 main deck cards, 12 runes and 3 battlefields (56 cards;
        the Proving Grounds decks come with 1 battlefield), plus the booster pack from its box. You pick one to
        begin; the rest you can win and collect.
      </p>
      {!starters && !error && <p className="muted">Loading the decks…</p>}
      {error && <p className="muted">{error}</p>}
      {groups.map((g) => (
        <div key={g.set} className="starters__group">
          <h3 className="starters__product">{g.items[0].product}</h3>
          <div className="starters__grid">
            {g.items.map((s) => {
              const card = db.cards.find((c) => c.id === s.legendCard);
              return (
                <article key={s.id} className="starter">
                  <div className="starter__card">
                    {card ? <HoloCard card={card} finish="none" width="100%" imageWidth={360} /> : <div className="starter__ph" />}
                  </div>
                  <h4>{s.title}</h4>
                  <p className="muted">{s.blurb}</p>
                  <p className="muted small">{s.size} cards + 1 {s.booster.toUpperCase()} booster</p>
                  <button type="button" className="btn btn--primary btn--small" disabled={busy !== null} onClick={() => pick(s)}>
                    Take this deck
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
