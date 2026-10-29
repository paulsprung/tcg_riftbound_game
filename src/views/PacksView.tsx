import { useEffect, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, PACK_PRICE, useCollection } from '../collection/store.ts';
import { packArt } from '../data/media.ts';
import type { CardDb } from '../data/types.ts';
import { Lobby, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import { PackOpening } from '../pack/PackOpening.tsx';
import { heroCard, PackWrapper } from '../pack/PackWrapper.tsx';
import { readPending } from '../pack/pending.ts';
import { openPack, useBoosters } from './boosters.ts';

// What is on screen is in the address: #shop is the store, #shop/market the
// marketplace, #shop/rad the pack being opened, so the browser's and the
// phone's back gesture return to the shelf.
const subFromHash = () => /^#\/?shop\/([a-z0-9]+)/.exec(location.hash)?.[1] ?? null;

/** The window's height, so the packs can be as big as fits without a scroll bar. */
function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

const Coin = () => <span className="lb-coin" aria-hidden />;

export function PacksView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const [sub, setSub] = useState<string | null>(subFromHash);
  const own = useCollection();
  const sets = useBoosters(db);
  const vh = useViewportHeight();
  // what is left for the packs once the bar, the header and the banner have their share
  const packH = Math.max(150, Math.min(250, vh - 520));
  useEffect(() => {
    const on = () => setSub(subFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const pending = sub ? null : readPending();

  const active = sets.find((s) => s.id === sub);
  if (active) {
    return (
      <Lobby bare>
        <PackOpening key={active.id} set={active.info} cards={active.cards} pack={active.pack} style={active.style}
          onInspect={onInspect} onExit={() => { location.hash = 'shop'; }} />
      </Lobby>
    );
  }

  const market = sub === 'market';
  const featured = sets[0];
  const buy = (id: string, n: number) => { for (let i = 0; i < n; i++) collection.buyPack(id); };

  const side = (
    <>
      <SideTitle>SHOP</SideTitle>
      <SideLink href="#shop" icon="bag" active={!market}>Store</SideLink>
      <SideLink href="#shop/market" icon="scale" active={market} soon>Marketplace</SideLink>
      <div className="lb-side__gap" />
      <SideTitle>YOUR BALANCE</SideTitle>
      <div className="lb-balance">
        <span><Coin /> <b>{own.coins.toLocaleString('en-US')}</b></span>
        <span className="muted small">Coins are earned by playing and by selling cards. They can't be bought.</span>
        <a className="btn btn--ghost btn--small" href="#home">Daily coins</a>
      </div>
    </>
  );

  return (
    <Lobby side={side}>
      {market ? (
        <section className="shop-soon">
          <h1>Marketplace</h1>
          <p className="muted">Sell cards you don't need and buy the ones you're missing, for coins. It opens together with accounts and online play.</p>
          <span className="lb-soon-note">Coming soon</span>
        </section>
      ) : (
        <section className="lb-col">
          <div className="lb-head">
            <h1>Featured Packs</h1>
            <div className="lb-tools">
              {/* testing aid until coins come from the server */}
              <button type="button" className="btn btn--ghost btn--small" onClick={() => collection.addCoins(1000)}>+1000 coins (test)</button>
              <a className="btn btn--ghost btn--small" href="#collection/packs">Your packs ({Object.values(own.packs).reduce((a, b) => a + b, 0)})</a>
            </div>
          </div>
          {featured && (
            <div className="shop-banner">
              <div className="shop-banner__text">
                <span className="hero__kicker">New set</span>
                <h2>{featured.info.name} Booster Pack</h2>
                <p>{featured.pack.slots.reduce((n, s) => n + s.count, 0)} cards · {featured.style.tagline}. Every slot as in the real pack.</p>
                <div className="shop-actions">
                  <button type="button" className="btn btn--cta" disabled={own.coins < PACK_PRICE} onClick={() => buy(featured.id, 1)}>
                    <Coin /> Buy 1 · {PACK_PRICE}
                  </button>
                  <button type="button" className="btn btn--ghost" disabled={own.coins < PACK_PRICE * 5} onClick={() => buy(featured.id, 5)}>
                    Buy 5 · {PACK_PRICE * 5}
                  </button>
                </div>
              </div>
              <div className="shop-banner__pack">
                <PackWrapper set={featured.info} style={featured.style} hero={heroCard(featured.cards, featured.style)}
                  width={Math.round(150 * (packArt(featured.id)?.aspect ?? 1 / 1.72))} onClick={() => buy(featured.id, 1)} />
              </div>
            </div>
          )}

          <p className="lb-label">All packs</p>
          <div className="pack-shelf">
            {sets.map((s) => (
              <div key={s.id} className="pack-shelf__item">
                <PackWrapper set={s.info} style={s.style} hero={heroCard(s.cards, s.style)}
                  width={Math.round(packH * (packArt(s.id)?.aspect ?? 1 / 1.72))}
                  onClick={() => ((own.packs[s.id] ?? 0) > 0 ? openPack(s.id) : buy(s.id, 1))} />
                <div className="pack-shelf__label">
                  <strong>{s.info.name}</strong>
                  <span className="muted">{s.style.tagline} · {s.info.cardCount} cards{own.packsOpened[s.id] ? ` · ${own.packsOpened[s.id]} opened` : ''}</span>
                  <span className="shop-price"><Coin /> {PACK_PRICE}</span>
                  <div className="shop-actions">
                    <button type="button" className="btn btn--primary btn--small" disabled={own.coins < PACK_PRICE} onClick={() => buy(s.id, 1)}>Buy</button>
                    <button type="button" className="btn btn--ghost btn--small" disabled={(own.packs[s.id] ?? 0) < 1} onClick={() => openPack(s.id)}>
                      Open ({own.packs[s.id] ?? 0})
                    </button>
                  </div>
                  {pending?.setId === s.id && (
                    <button type="button" className="btn btn--primary btn--small" onClick={() => openPack(s.id)}>
                      Continue opening ({pending.pulls.length - pending.index} left)
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </Lobby>
  );
}
