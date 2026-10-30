import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, PACK_PRICE, useCollection } from '../collection/store.ts';
import { packArt } from '../data/media.ts';
import type { CardDb } from '../data/types.ts';
import { DEMO } from '../lobby/demo.ts';
import { Lobby, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import { useViewport } from '../lobby/scale.ts';
import { PackOpening } from '../pack/PackOpening.tsx';
import { heroCard, PackWrapper } from '../pack/PackWrapper.tsx';
import { useBoosters } from './boosters.ts';
import { dealSpecial, specialCards, specialPack } from '../economy/products.ts';

const Market = lazy(() => import('./Market.tsx').then((m) => ({ default: m.Market })));
const Bundles = lazy(() => import('./BundlesView.tsx').then((m) => ({ default: m.BundlesView })));

// What is on screen is in the address: #shop is the store, #shop/bundles the
// bundles and sets, #shop/market the marketplace, #shop/rad the pack being opened, so the browser's and the
// phone's back gesture return to the shelf.
const subFromHash = () => /^#\/?shop\/([a-z0-9-]+)/.exec(location.hash)?.[1] ?? null;

const Coin = () => <span className="lb-coin" aria-hidden />;

export function PacksView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const [sub, setSub] = useState<string | null>(subFromHash);
  const own = useCollection();
  const sets = useBoosters(db);
  const { w: vw, h: vh } = useViewport();
  // the packs fill the shelf: its height as laid out, less their name and price, and five side by
  // side by the width once the sidebar and the friends rail have theirs
  const aspect = 1 / 1.72;
  const shelf = useRef<HTMLDivElement>(null);
  const [shelfH, setShelfH] = useState(0);
  useEffect(() => {
    const el = shelf.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setShelfH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [sub]);
  const LABEL_H = 84;
  // only on a desktop window does the shelf get its height from the page; narrower, it grows with the packs
  const byHeight = shelfH > 0 && vw > 900 ? shelfH - LABEL_H : vh - 440;
  const packH = Math.max(120, Math.min(byHeight, ((vw - 248 - 56 - 60 - 4 * 24) / 5) / 0.66, 340));
  useEffect(() => {
    const on = () => setSub(subFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const active = sets.find((s) => s.id === sub);
  const special = sub ? specialPack(sub) : undefined;
  if (special) {
    const cards = specialCards(special.id, db.cards);
    return (
      <Lobby bare>
        <PackOpening key={special.id} set={{ id: special.id, name: special.name, cardCount: cards.length }} cards={cards}
          deal={() => dealSpecial(special.id, db.cards)} style={special.style}
          onInspect={onInspect} onExit={() => { location.hash = 'collection/packs'; }} />
      </Lobby>
    );
  }
  if (active) {
    return (
      <Lobby bare>
        <PackOpening key={active.id} set={active.info} cards={active.cards} pack={active.pack} style={active.style}
          onInspect={onInspect} onExit={() => { location.hash = 'shop'; }} />
      </Lobby>
    );
  }

  const market = sub === 'market';
  const bundles = sub === 'bundles';
  const featured = sets[0];
  const buy = (id: string, n: number) => { void collection.buyPack(id, n); };

  const side = (
    <>
      <SideTitle>SHOP</SideTitle>
      <SideLink href="#shop" icon="bag" active={!market && !bundles}>Packs</SideLink>
      <SideLink href="#shop/bundles" icon="gift" active={bundles}>Bundles</SideLink>
      <SideLink href="#shop/market" icon="scale" active={market}>Marketplace</SideLink>
      <div className="lb-side__gap" />
      <SideTitle>YOUR BALANCE</SideTitle>
      <div className="lb-balance">
        <span><Coin /> <b>{own.coins.toLocaleString('en-US')}</b></span>
        <a className="btn btn--ghost btn--small" href="#home">Daily coins</a>
      </div>
    </>
  );

  return (
    <Lobby side={side}>
      {market ? (
        <Suspense fallback={<p className="muted">Loading…</p>}><Market db={db} onInspect={onInspect} /></Suspense>
      ) : bundles ? (
        <Suspense fallback={<p className="muted">Loading…</p>}><Bundles db={db} /></Suspense>
      ) : (
        <section className="lb-col">
          <div className="lb-head">
            <h1>Featured Packs</h1>
            <div className="lb-tools">
              {/* testing aid in the preview only: on the server, coins come from play and from an admin */}
              {DEMO && !collection.isRemote() && <button type="button" className="btn btn--ghost btn--small" onClick={() => collection.addCoins(1000)}>+1000 coins (test)</button>}
              <a className="btn btn--ghost btn--small" href="#collection/packs">Your packs ({Object.values(own.packs).reduce((a, b) => a + b, 0)})</a>
            </div>
          </div>
          {featured && (
            <div className="shop-banner" style={{ '--w1': featured.style.wrapper[0], '--w2': featured.style.wrapper[1], '--w3': featured.style.wrapper[2] } as CSSProperties}>
              <div className="shop-banner__glow" aria-hidden />
              <div className="shop-banner__text">
                <span className="hero__kicker">New set</span>
                <h2>{featured.info.name} Booster Pack</h2>
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
                  width={Math.round(230 * (packArt(featured.id)?.aspect ?? 1 / 1.72))} onClick={() => buy(featured.id, 1)} />
              </div>
            </div>
          )}

          <p className="lb-label">All packs</p>
          <div className="pack-shelf" ref={shelf}>
            {sets.map((s) => (
              <div key={s.id} className="pack-shelf__item">
                <PackWrapper set={s.info} style={s.style} hero={heroCard(s.cards, s.style)}
                  width={Math.round(packH * (packArt(s.id)?.aspect ?? aspect))} />
                <div className="pack-shelf__label">
                  <strong>{s.info.name}</strong>
                  <button type="button" className="shop-buy" disabled={own.coins < PACK_PRICE} onClick={() => buy(s.id, 1)}
                    aria-label={`Buy a ${s.info.name} pack for ${PACK_PRICE} coins`}>
                    <Coin /> {PACK_PRICE}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </Lobby>
  );
}
