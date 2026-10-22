import { useEffect, useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { collection, DAILY_COINS, useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { STARTER_COINS, STARTER_PACKS, STARTERS, starterContents, type StarterInfo } from '../economy/starter.ts';
import { useSession } from '../net/session.ts';

const hhmm = (ms: number) => `${Math.floor(ms / 3_600_000)} h ${Math.ceil((ms % 3_600_000) / 60_000)} min`;

function Starters({ db }: { db: CardDb }) {
  const [art, setArt] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string | null> = {};
      for (const s of STARTERS) out[s.id] = (await starterContents(s.id, db)).legendCard;
      if (alive) setArt(out);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [db]);

  const pick = async (id: StarterInfo['id']) => {
    setBusy(id); setError('');
    try {
      const { cards } = await starterContents(id, db);
      collection.grantStarter(id, cards, STARTER_PACKS, STARTER_COINS);
    } catch {
      setError('Could not load the starter set. Try again.');
    }
    setBusy(null);
  };

  return (
    <section className="starters">
      <h2>Choose your starter set</h2>
      <p className="muted">
        A ready-to-play deck with its legend, runes and battlefields, plus {Object.values(STARTER_PACKS).reduce((a, b) => a + b, 0)} Radiance
        booster packs and {STARTER_COINS} coins to start your collection.
      </p>
      <div className="starters__grid">
        {STARTERS.map((s) => {
          const card = db.cards.find((c) => c.id === art[s.id]);
          return (
            <article key={s.id} className="starter">
              <div className="starter__card">
                {card ? <HoloCard card={card} finish="none" width="100%" imageWidth={360} /> : <div className="starter__ph" />}
              </div>
              <h3>{s.title}</h3>
              <p className="muted">{s.blurb}</p>
              <ul className="starter__list">
                <li>40-card deck, 12 runes, 3 battlefields</li>
                <li>{Object.values(STARTER_PACKS).reduce((a, b) => a + b, 0)} Radiance booster packs</li>
                <li>{STARTER_COINS} coins</li>
              </ul>
              <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => { void pick(s.id); }}>
                {busy === s.id ? 'Opening the box…' : `Take the ${s.title}`}
              </button>
            </article>
          );
        })}
      </div>
      {error && <p className="muted">{error}</p>}
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
