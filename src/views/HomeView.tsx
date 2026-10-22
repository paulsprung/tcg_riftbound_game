import { useEffect, useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { collection, DAILY_COINS, useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';
import { useSession } from '../net/session.ts';

const hhmm = (ms: number) => `${Math.floor(ms / 3_600_000)} h ${Math.ceil((ms % 3_600_000) / 60_000)} min`;

const PRODUCT_ORDER = ['ogs', 'ogn', 'sfd', 'unl', 'rad'];

function Starters({ db }: { db: CardDb }) {
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
        Every official starter deck: 56 cards (legend, 40 main deck cards, 12 runes, 3 battlefields), ready to play,
        and the booster pack that comes in its box. You pick one to begin; the rest you can win and collect.
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

export function HomeView({ db }: { db: CardDb }) {
  const own = useCollection();
  const session = useSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const wait = collection.dailyIn(now);
  const unopened = useMemo(() => Object.values(own.packs).reduce((a, b) => a + b, 0), [own.packs]);
  const name = session.status === 'online' && session.user ? session.user.name : null;
  const cards = Object.values(own.cards).reduce((a, o) => a + o.normal + o.foil, 0) + own.slabs.length;

  return (
    <section className="home">
      <div className="page-head">
        <h1>{name ? `Welcome, ${name}` : 'Riftbound Simulator'}</h1>
        <p className="muted">Open packs, build your collection, play.</p>
      </div>

      {!own.starter && <Starters db={db} />}

      {own.starter && (
        <>
          <div className="home__stats">
            <div><b>{own.coins}</b><span className="muted"> coins</span></div>
            <div><b>{unopened}</b><span className="muted"> unopened {unopened === 1 ? 'pack' : 'packs'}</span></div>
            <div><b>{cards}</b><span className="muted"> cards</span></div>
          </div>
          <div className="home__actions">
            <a className="btn btn--primary" href="#shop">{unopened > 0 ? 'Open packs' : 'Shop'}</a>
            <a className="btn btn--ghost" href="#play">Play</a>
            <a className="btn btn--ghost" href="#collection">Collection</a>
          </div>
        </>
      )}

      <div className="daily">
        <div>
          <strong>Daily coins</strong>
          <span className="muted"> {wait === 0 ? `${DAILY_COINS} coins are waiting.` : `Next in ${hhmm(wait)}.`}</span>
        </div>
        <button type="button" className="btn btn--ghost btn--small" disabled={wait > 0} onClick={() => { collection.claimDaily(); setNow(Date.now()); }}>
          Claim {DAILY_COINS}
        </button>
      </div>
    </section>
  );
}
