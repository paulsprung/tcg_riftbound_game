import { useCollection } from '../collection/store.ts';
import { packArt } from '../data/media.ts';
import type { CardDb } from '../data/types.ts';
import { heroCard, PackWrapper } from '../pack/PackWrapper.tsx';
import { readPending } from '../pack/pending.ts';
import { openPack, useBoosters } from './boosters.ts';

/** Packs you own and have not opened yet. */
export function PacksTab({ db }: { db: CardDb }) {
  const own = useCollection();
  const sets = useBoosters(db);
  const mine = sets.filter((s) => (own.packs[s.id] ?? 0) > 0);
  const pending = readPending();
  const total = mine.reduce((n, s) => n + (own.packs[s.id] ?? 0), 0);

  return (
    <section>
      <div className="lb-head">
        <h1>Packs to open <span className="muted small">{total} unopened</span></h1>
        <a className="btn btn--ghost btn--small" href="#shop">Buy packs</a>
      </div>
      {mine.length === 0 && !pending ? (
        <div className="empty">
          <p>No unopened packs.</p>
          <p className="muted small">Packs come from starter decks, the tutorial and the shop.</p>
          <a className="btn btn--primary" href="#shop">Go to the shop</a>
        </div>
      ) : (
        <div className="pack-shelf">
          {sets.filter((s) => (own.packs[s.id] ?? 0) > 0 || pending?.setId === s.id).map((s) => (
            <div key={s.id} className="pack-shelf__item">
              <PackWrapper set={s.info} style={s.style} hero={heroCard(s.cards, s.style)}
                width={Math.round(240 * (packArt(s.id)?.aspect ?? 1 / 1.72))} onClick={() => openPack(s.id)} />
              <div className="pack-shelf__label">
                <strong>{s.info.name}</strong>
                <span className="muted">{s.info.cardCount} cards · × {own.packs[s.id] ?? 0}</span>
                <div className="shop-actions">
                  {(own.packs[s.id] ?? 0) > 0 && <button type="button" className="btn btn--primary btn--small" onClick={() => openPack(s.id)}>Open pack</button>}
                  {pending?.setId === s.id && (
                    <button type="button" className="btn btn--primary btn--small" onClick={() => openPack(s.id)}>Continue ({pending.pulls.length - pending.index} left)</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
