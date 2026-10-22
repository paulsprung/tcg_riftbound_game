import { useEffect, useMemo, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, PACK_PRICE, useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { BOOSTER_SETS } from '../pack/packConfig.ts';
import { PackOpening } from '../pack/PackOpening.tsx';
import { packArt } from '../data/media.ts';
import { heroCard, PackWrapper } from '../pack/PackWrapper.tsx';
import { readPending } from '../pack/pending.ts';

// The pack being opened is in the address (#shop/rad), so the browser's
// and the phone's back gesture return to the shelf.
const setFromHash = () => /^#\/?shop\/([a-z0-9]+)/.exec(location.hash)?.[1] ?? null;

export function PacksView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const [openSet, setOpenSet] = useState<string | null>(setFromHash);
  const own = useCollection();
  const opened = own.packsOpened;
  useEffect(() => {
    const on = () => setOpenSet(setFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const open = (id: string | null) => { location.hash = id ? `shop/${id}` : 'shop'; };
  const pending = openSet ? null : readPending();

  const sets = useMemo(
    () => BOOSTER_SETS
      .map((b) => ({ ...b, info: db.sets.find((s) => s.id === b.id), cards: db.cards.filter((c) => c.setId === b.id) }))
      .filter((b) => b.info && b.cards.length > 0),
    [db],
  );

  const active = sets.find((s) => s.id === openSet);
  if (active?.info) {
    return (
      <PackOpening key={active.id} set={active.info} cards={active.cards} pack={active.pack} style={active.style}
        onInspect={onInspect} onExit={() => open(null)} />
    );
  }

  return (
    <section>
      <div className="page-head">
        <h1>Shop</h1>
        <p className="muted">
          Buy booster packs with coins, then open them. Packs follow each set's real slot layout. Riot publishes only
          some of the odds; the rest are community estimates from box openings.
        </p>
      </div>
      <div className="shop-bar">
        <span><b>{own.coins}</b> <span className="muted">coins</span></span>
        <a className="btn btn--ghost btn--small" href="#home">Daily coins</a>
      </div>
      <div className="pack-shelf">
        {sets.map((s) => (
          <div key={s.id} className="pack-shelf__item">
            {/* Same height for every pack; the real wrappers differ a little in width. */}
            <PackWrapper set={s.info!} style={s.style} hero={heroCard(s.cards, s.style)}
              width={Math.round(312 * (packArt(s.id)?.aspect ?? 1 / 1.72))}
              onClick={() => ((own.packs[s.id] ?? 0) > 0 ? open(s.id) : collection.buyPack(s.id))} />
            <div className="pack-shelf__label">
              <strong>{s.info!.name}</strong>
              <span className="muted">
                {s.style.tagline} · {s.info!.cardCount} cards{opened[s.id] ? ` · ${opened[s.id]} opened` : ''}
              </span>
              <div className="shop-actions">
                <button type="button" className="btn btn--primary btn--small" disabled={(own.packs[s.id] ?? 0) < 1} onClick={() => open(s.id)}>
                  Open ({own.packs[s.id] ?? 0})
                </button>
                <button type="button" className="btn btn--ghost btn--small" disabled={own.coins < PACK_PRICE} onClick={() => collection.buyPack(s.id)}>
                  Buy · {PACK_PRICE} coins
                </button>
              </div>
              {pending?.setId === s.id && (
                <button type="button" className="btn btn--primary btn--small" onClick={() => open(s.id)}>
                  Continue opening ({pending.pulls.length - pending.index} left)
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
