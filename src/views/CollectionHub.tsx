import type { InspectTarget } from '../card/Inspector.tsx';
import type { CardDb } from '../data/types.ts';
import { CardsView } from './CardsView.tsx';
import { CollectionView } from './CollectionView.tsx';
import { ShowcaseView } from './ShowcaseView.tsx';

export type CollectionTab = 'cards' | 'showcase' | 'all';

const TABS: { id: CollectionTab; label: string; href: string }[] = [
  { id: 'cards', label: 'My cards', href: '#collection' },
  { id: 'showcase', label: 'Showcase', href: '#collection/showcase' },
  { id: 'all', label: 'All cards', href: '#collection/all' },
];

/** The collection and what hangs off it: the showcase and the card database. */
export function CollectionHub({ db, tab, onInspect }: { db: CardDb; tab: CollectionTab; onInspect: (t: InspectTarget) => void }) {
  return (
    <>
      <nav className="subnav" aria-label="Collection">
        {TABS.map((t) => (
          <a key={t.id} href={t.href} className="subnav__link" aria-current={tab === t.id ? 'page' : undefined}>{t.label}</a>
        ))}
      </nav>
      {tab === 'cards' && <CollectionView db={db} onInspect={onInspect} />}
      {tab === 'showcase' && <ShowcaseView db={db} onInspect={onInspect} />}
      {tab === 'all' && <CardsView db={db} onInspect={onInspect} />}
    </>
  );
}
