import { useMemo, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { Icon } from '../lobby/icons.tsx';
import { Select } from '../lobby/Select.tsx';
import { gradedCounts, useCollection } from '../collection/store.ts';
import { VARIANT_LABEL } from '../data/cardInfo.ts';
import type { Card, CardDb, Rarity } from '../data/types.ts';
import { rank } from '../showcase/rank.ts';
import { CardGrid } from './CardGrid.tsx';

type Sort = 'rarity' | 'name' | 'set' | 'copies';
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();

/** Every card you own, with the filters of the sidebar; the rest greyed out on request. */
export function CollectionView({ db, onInspect, rarities, showUnowned }: {
  db: CardDb; onInspect: (t: InspectTarget) => void; rarities: Set<Rarity>; showUnowned: boolean;
}) {
  const owned = useCollection();
  const graded = useMemo(() => gradedCounts(owned), [owned]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('rarity');
  const [set, setSet] = useState('');
  const [type, setType] = useState('');
  const [domain, setDomain] = useState('');
  const [variant, setVariant] = useState('');

  const types = useMemo(() => uniq(db.cards.map((c) => c.type)), [db]);
  const domains = useMemo(() => uniq(db.cards.flatMap((c) => c.domains)), [db]);
  const rawCount = (id: string) => (owned.cards[id]?.normal ?? 0) + (owned.cards[id]?.foil ?? 0);
  const copies = (id: string) => rawCount(id) + (graded[id] ?? 0);

  const cards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = db.cards.filter((c) =>
      (showUnowned || copies(c.id) > 0) &&
      (rarities.size === 0 || rarities.has(c.rarity)) &&
      (!set || c.setId === set) && (!type || c.type === type) && (!domain || c.domains.includes(domain)) &&
      (!variant || c.variant === variant) &&
      (!needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle) ||
        c.text.toLowerCase().includes(needle) || c.tags.some((t) => t.toLowerCase().includes(needle))));
    const by: Record<Sort, (a: Card, b: Card) => number> = {
      rarity: (a, b) => rank(b, false) - rank(a, false) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      set: (a, b) => a.setId.localeCompare(b.setId) || (a.number ?? 0) - (b.number ?? 0),
      copies: (a, b) => copies(b.id) - copies(a.id) || a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, owned, graded, q, sort, set, type, domain, variant, rarities, showUnowned]);

  const total = Object.values(owned.cards).reduce((n, o) => n + o.normal + o.foil, 0) + owned.slabs.length;
  const anyFilter = q || set || type || domain || variant;

  return (
    <section className="lb-col">
      <div className="lb-head">
        <h1>Your Collection <span className="muted small">{total.toLocaleString('en-US')} cards</span></h1>
        <div className="lb-tools">
          <div className="lb-search">
            <Icon name="search" size={16} />
            <input className="input" type="search" placeholder="Search cards…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
          </div>
          <Select label="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={[
            { value: 'rarity', label: 'Sort: Rarest' }, { value: 'name', label: 'Sort: Name' },
            { value: 'set', label: 'Sort: Set' }, { value: 'copies', label: 'Sort: Copies' }]} />
        </div>
      </div>
      <div className="filters">
        <Select label="Set" value={set} onChange={setSet} className="sel--wide"
          options={[{ value: '', label: 'All sets' }, ...db.sets.map((x) => ({ value: x.id, label: x.name }))]} />
        <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))]} />
        <Select label="Domain" value={domain} onChange={setDomain} options={[{ value: '', label: 'All domains' }, ...domains.map((d) => ({ value: d, label: d }))]} />
        <Select label="Printing" value={variant} onChange={setVariant}
          options={[{ value: '', label: 'All printings' }, ...Object.entries(VARIANT_LABEL).map(([k, v]) => ({ value: k, label: v }))]} />
        {anyFilter && <button type="button" className="btn btn--ghost" onClick={() => { setQ(''); setSet(''); setType(''); setDomain(''); setVariant(''); }}>Clear</button>}
      </div>

      {total === 0 && !showUnowned ? (
        <div className="empty">
          <p>No cards yet.</p>
          <a className="btn btn--primary" href="#shop">Open a pack</a>
        </div>
      ) : (
        <>
          <div className="lb-scroll">
          <CardGrid
            cards={cards}
            onInspect={onInspect}
            dim={(c) => copies(c.id) === 0}
            foil={(c) => (owned.cards[c.id]?.foil ?? 0) > 0}
            badge={(c) => {
              const o = owned.cards[c.id];
              const g = graded[c.id] ?? 0;
              if (copies(c.id) === 0) return null;
              return (
                <span className="count-badge">
                  ×{copies(c.id)}
                  {(o?.foil ?? 0) > 0 && <span className="count-badge__foil" title={`${o!.foil} foil`}>✦{o!.foil}</span>}
                  {g > 0 && <span className="count-badge__foil" title={`${g} graded`}>▣{g}</span>}
                </span>
              );
            }}
          />
          </div>
        </>
      )}
    </section>
  );
}
