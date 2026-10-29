import { useEffect, useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { Slab } from '../showcase/Slab.tsx';
import { collection, DAILY_COINS, useCollection } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { CardDb } from '../data/types.ts';
import { Lobby } from '../lobby/Lobby.tsx';
import { NewsCarousel } from '../lobby/NewsCarousel.tsx';
import { HeroBanner } from './HeroBanner.tsx';
import { useShowcase } from './showcasePieces.ts';
import { Starters } from './Starters.tsx';

const hhmm = (ms: number) => `${Math.floor(ms / 3_600_000)} h ${Math.ceil((ms % 3_600_000) / 60_000)} min`;

/** Left of the banner: your featured card (the first one in your showcase), and the news pinned to the bottom. */
function Side({ db }: { db: CardDb }) {
  const pick = useShowcase(db)[0];
  return (
    <>
      <p className="lb-label">Your showcase</p>
      <a className="home-feat" href="#profile" aria-label={pick ? `${pick.card.name}, your featured card. Open your profile` : 'Pick a featured card in your profile'}>
        {pick ? (
          <div className={`home-feat__card${pick.slab ? ' is-slab' : ''}`}>
            {pick.slab ? (
              <Slab slab={pick.slab} card={pick.card} width="100%" imageWidth={520} tilt="hover" />
            ) : (
              <HoloCard card={pick.card} finish={defaultFinish(pick.card, pick.foil)} width="100%" imageWidth={520} />
            )}
          </div>
        ) : (
          <span className="home-feat__empty">Put a card in your showcase</span>
        )}
      </a>

      <div className="home-news-dock">
        <p className="lb-label home-news__label">Latest news</p>
        <NewsCarousel />
      </div>
    </>
  );
}

export function HomeView({ db }: { db: CardDb }) {
  const own = useCollection();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const wait = collection.dailyIn(now);
  const unopened = useMemo(() => Object.values(own.packs).reduce((a, b) => a + b, 0), [own.packs]);
  const cards = Object.values(own.cards).reduce((a, o) => a + o.normal + o.foil, 0) + own.slabs.length;

  const tiles = own.starter && (
    <div className="home-tiles">
      <div className="lb-card home-tile"><b>{own.coins.toLocaleString('en-US')}</b><span className="muted">Coins</span></div>
      <div className="lb-card home-tile"><b>{unopened}</b><span className="muted">Unopened {unopened === 1 ? 'pack' : 'packs'}</span></div>
      <div className="lb-card home-tile"><b>{cards}</b><span className="muted">Cards owned</span></div>
      <div className="lb-card home-tile home-tile--daily">
        <div>
          <b>Daily coins</b>
          <span className="muted small">{wait === 0 ? 'Ready' : `Next in ${hhmm(wait)}`}</span>
        </div>
        <button type="button" className="btn btn--primary btn--small" disabled={wait > 0}
          onClick={() => { collection.claimDaily(); setNow(Date.now()); }}>Claim {DAILY_COINS}</button>
      </div>
    </div>
  );

  return (
    <Lobby side={<Side db={db} />} className="wide-side home-page">
      <HeroBanner db={db} bleed={Boolean(own.starter)} footer={tiles || undefined}>
        {!own.starter ? (
          <p className="hero__cta-note">Choose your starter deck below to begin.</p>
        ) : !own.tutorialDone ? (
          <div className="lb-card hero__next">
            <span className="hero__kicker">Next step</span>
            <strong>Play the tutorial</strong>
            <span className="muted">A short guided match. Finish it for 5 free booster packs, one from each set.</span>
            <a className="btn btn--cta" href="#play/tutorial">Play the tutorial</a>
          </div>
        ) : (
          <div className="hero__buttons">
            <a className="btn btn--cta" href="#play">Play</a>
            <a className="btn btn--primary" href={unopened > 0 ? '#collection/packs' : '#shop'}>{unopened > 0 ? `Open packs (${unopened})` : 'Shop'}</a>
            <a className="btn btn--ghost" href="#collection">Collection</a>
          </div>
        )}
      </HeroBanner>
      {!own.starter && <div className="home-starters"><Starters db={db} /></div>}
    </Lobby>
  );
}
