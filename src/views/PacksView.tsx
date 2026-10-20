import { useMemo, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { BOOSTER_SETS } from '../pack/packConfig.ts';
import { PackOpening } from '../pack/PackOpening.tsx';
import { packArt } from '../data/media.ts';
import { heroCard, PackWrapper } from '../pack/PackWrapper.tsx';

export function PacksView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const [openSet, setOpenSet] = useState<string | null>(null);
  const opened = useCollection().packsOpened;

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
        onInspect={onInspect} onExit={() => setOpenSet(null)} />
    );
  }

  return (
    <section>
      <div className="page-head">
        <h1>Open booster packs</h1>
        <p className="muted">
          Pick a set. Packs follow each set's real slot layout; the odds for chase cards are community estimates.
        </p>
      </div>
      <div className="pack-shelf">
        {sets.map((s) => (
          <div key={s.id} className="pack-shelf__item">
            {/* Same height for every pack; the real wrappers differ a little in width. */}
            <PackWrapper set={s.info!} style={s.style} hero={heroCard(s.cards, s.style)}
              width={Math.round(312 * (packArt(s.id)?.aspect ?? 1 / 1.72))}
              onClick={() => setOpenSet(s.id)} />
            <div className="pack-shelf__label">
              <strong>{s.info!.name}</strong>
              <span className="muted">
                {s.style.tagline} · {s.info!.cardCount} cards{opened[s.id] ? ` · ${opened[s.id]} opened` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
