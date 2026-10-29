import { useMemo, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, useCollection } from '../collection/store.ts';
import { cap } from '../data/cardInfo.ts';
import type { CardDb, Rarity } from '../data/types.ts';
import { Lobby, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import { CollectionView } from './CollectionView.tsx';
import { DecksView } from './DecksView.tsx';
import { PacksTab } from './PacksTab.tsx';
import { ShowcaseView } from './ShowcaseView.tsx';

export type CollectionTab = 'cards' | 'packs' | 'decks' | 'showcase';

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'showcase'];

/** Your cards and what hangs off them: packs to open, decks, the showcase. */
export function CollectionHub({ db, tab, onInspect }: { db: CardDb; tab: CollectionTab; onInspect: (t: InspectTarget) => void }) {
  const own = useCollection();
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set());
  const [showUnowned, setShowUnowned] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const unopened = useMemo(() => Object.values(own.packs).reduce((a, b) => a + b, 0), [own.packs]);
  const owned = useMemo(() => {
    const ids = new Set(Object.entries(own.cards).filter(([, o]) => o.normal + o.foil > 0).map(([id]) => id));
    for (const s of own.slabs) ids.add(s.cardId);
    return ids.size;
  }, [own.cards, own.slabs]);
  const pct = db.cards.length ? Math.round((owned / db.cards.length) * 100) : 0;

  const toggle = (r: Rarity) => setRarities((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });

  const side = (
    <>
      <SideTitle>INVENTORY</SideTitle>
      <SideLink href="#collection" icon="▤" active={tab === 'cards'}>Collection</SideLink>
      <SideLink href="#collection/packs" icon="▣" active={tab === 'packs'}>Packs{unopened > 0 ? ` (${unopened})` : ''}</SideLink>
      <SideLink href="#collection/decks" icon="❏" active={tab === 'decks'}>Decks</SideLink>
      <SideLink href="#collection/showcase" icon="★" active={tab === 'showcase'}>Showcase</SideLink>

      {tab === 'cards' && (
        <>
          <div className="lb-side__gap" />
          <SideTitle>FILTERS</SideTitle>
          <div className="lb-filters">
            {RARITIES.map((r) => (
              <label key={r} className={`lb-rar lb-rar--${r}`}>
                <input type="checkbox" checked={rarities.has(r)} onChange={() => toggle(r)} />
                <i aria-hidden />{cap(r)}
              </label>
            ))}
            <label className="lb-rar lb-rar--toggle">
              <input type="checkbox" checked={showUnowned} onChange={(e) => setShowUnowned(e.target.checked)} />
              <i aria-hidden />Show unowned
            </label>
          </div>
        </>
      )}

      <div className="lb-progress">
        <span className="muted small">{owned.toLocaleString('en-US')} / {db.cards.length.toLocaleString('en-US')} cards collected</span>
        <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Collection"><span style={{ width: `${pct}%` }} /></div>
        {confirming ? (
          <div className="confirm" role="group" aria-label="Confirm reset">
            <span>Delete every card?</span>
            <button type="button" className="btn btn--danger btn--small" onClick={() => { collection.reset(); setConfirming(false); }}>Delete</button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirming(false)}>Keep</button>
          </div>
        ) : (
          <button type="button" className="lb-linkbtn" onClick={() => setConfirming(true)}>Reset collection</button>
        )}
      </div>
    </>
  );

  return (
    <Lobby side={side}>
      {tab === 'cards' && <CollectionView db={db} onInspect={onInspect} rarities={rarities} showUnowned={showUnowned} />}
      {tab === 'packs' && <PacksTab db={db} />}
      {tab === 'decks' && <DecksView db={db} />}
      {tab === 'showcase' && <div className="lb-scroll"><ShowcaseView db={db} onInspect={onInspect} /></div>}
    </Lobby>
  );
}
