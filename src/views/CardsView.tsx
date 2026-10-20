import { useMemo, useState } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { cap, RARITY_ORDER, VARIANT_LABEL } from '../data/cardInfo.ts';
import type { CardDb } from '../data/types.ts';
import { CardGrid } from './CardGrid.tsx';

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();

export function CardsView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const [q, setQ] = useState('');
  const [set, setSet] = useState('');
  const [rarity, setRarity] = useState('');
  const [type, setType] = useState('');
  const [domain, setDomain] = useState('');
  const [variant, setVariant] = useState('');

  const types = useMemo(() => uniq(db.cards.map((c) => c.type)), [db]);
  const domains = useMemo(() => uniq(db.cards.flatMap((c) => c.domains)), [db]);

  const cards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return db.cards.filter((c) =>
      (!set || c.setId === set) &&
      (!rarity || c.rarity === rarity) &&
      (!type || c.type === type) &&
      (!domain || c.domains.includes(domain)) &&
      (!variant || c.variant === variant) &&
      (!needle || c.name.toLowerCase().includes(needle) || c.text.toLowerCase().includes(needle) ||
        c.tags.some((t) => t.toLowerCase().includes(needle)) || c.code.toLowerCase().includes(needle)));
  }, [db, q, set, rarity, type, domain, variant]);

  const anyFilter = q || set || rarity || type || domain || variant;

  return (
    <section>
      <div className="page-head">
        <h1>Card database</h1>
        <p className="muted">{db.cards.length} cards across {db.sets.length} sets. Click a card to inspect it.</p>
      </div>

      <div className="filters">
        <input className="input input--search" type="search" placeholder="Search name, text, tag, code…"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
        <select className="input" value={set} onChange={(e) => setSet(e.target.value)} aria-label="Set">
          <option value="">All sets</option>
          {db.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="input" value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity">
          <option value="">All rarities</option>
          {RARITY_ORDER.filter((r) => db.cards.some((c) => c.rarity === r)).map((r) => <option key={r} value={r}>{cap(r)}</option>)}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain">
          <option value="">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" value={variant} onChange={(e) => setVariant(e.target.value)} aria-label="Printing">
          <option value="">All printings</option>
          {Object.entries(VARIANT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {anyFilter && (
          <button type="button" className="btn btn--ghost" onClick={() => { setQ(''); setSet(''); setRarity(''); setType(''); setDomain(''); setVariant(''); }}>
            Clear
          </button>
        )}
      </div>
      <p className="muted small">{cards.length} shown</p>

      <CardGrid cards={cards} onInspect={onInspect} />
    </section>
  );
}
