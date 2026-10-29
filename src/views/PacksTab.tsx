import { useCollection } from '../collection/store.ts';
import { packArt } from '../data/media.ts';
import type { CardDb } from '../data/types.ts';
import { heroCard, PackWrapper } from '../pack/PackWrapper.tsx';
import { readPending } from '../pack/pending.ts';
import { useViewport } from '../lobby/scale.ts';
import { openPack, useBoosters } from './boosters.ts';

/** Packs you own and have not opened yet. */
export function PacksTab({ db }: { db: CardDb }) {
  const own = useCollection();
  const sets = useBoosters(db);
  const mine = sets.filter((s) => (own.packs[s.id] ?? 0) > 0);
  const pending = readPending();
  const total = mine.reduce((n, s) => n + (own.packs[s.id] ?? 0), 0);
  const { w, h } = useViewport();
  const shown = sets.filter((s) => (own.packs[s.id] ?? 0) > 0 || pending?.setId === s.id);
  // as big as the window allows: by its height, and all the sets side by side by its width
  const packH = Math.max(150, Math.min(h - 380, ((w - 248 - 56 - 60 - 4 * 28) / Math.max(shown.length, 4)) / 0.66, 380));

  return (
    <section className="lb-col">
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
        <div className="pack-shelf pack-shelf--own">
          {shown.map((s) => (
            <div key={s.id} className="pack-shelf__item">
              <PackWrapper set={s.info} style={s.style} hero={heroCard(s.cards, s.style)}
                width={Math.round(packH * (packArt(s.id)?.aspect ?? 1 / 1.72))} onClick={() => openPack(s.id)} />
              <div className="pack-shelf__label">
                <strong>{s.info.name}</strong>
                <span className="muted">× {own.packs[s.id] ?? 0}</span>
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
