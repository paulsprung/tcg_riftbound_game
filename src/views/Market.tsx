import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, useCollection, type CollectionState } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { LISTING_DAYS, MARKET_FEE } from '../economy/rules.ts';
import { Icon } from '../lobby/icons.tsx';
import { Select } from '../lobby/Select.tsx';
import { api, showNotice } from '../net/api.ts';
import { useSession } from '../net/session.ts';
import './market.css';

/*
 * Shop → Marketplace (server/market.ts): what other players sell, selling
 * your own copies, and your listings. Prices are coins per copy; the market
 * keeps 5 % of a sale. Listed copies are held until sold, cancelled or
 * 14 days are up.
 */

interface Offer { cardId: string; foil: boolean; cheapest: number; copies: number; listings: number }
interface Listing { id: string; cardId: string; foil: boolean; qty: number; price: number; mine: boolean; seller: string; expiresAt: number }
interface Sale { cardId?: string; foil?: boolean; qty: number; price: number; fee?: number; at: number }

const Coin = () => <span className="lb-coin" aria-hidden />;
const fmt = (n: number) => n.toLocaleString('en-US');
const take = (r: { account: CollectionState }) => collection.useServer(r.account);
const fail = (e: Error) => showNotice(e.message);

function CardModal({ card, foil, onClose, onInspect }: { card: Card; foil: boolean; onClose: () => void; onInspect: (t: InspectTarget) => void }) {
  const [data, setData] = useState<{ listings: Listing[]; sales: Sale[] } | null>(null);
  const own = useCollection();
  const load = useCallback(() => api<{ listings: Listing[]; sales: Sale[] }>('GET', `/api/market/card?id=${encodeURIComponent(card.id)}&foil=${foil ? 1 : 0}`).then(setData).catch(() => undefined), [card.id, foil]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const buy = (l: Listing, qty: number) => api<{ account: CollectionState }>('POST', '/api/market/buy', { listingId: l.id, qty })
    .then((r) => { take(r); showNotice(`Bought ${qty}× ${card.name}.`, true); void load(); }).catch(fail);
  const avg = data && data.sales.length ? Math.round(data.sales.reduce((a, s) => a + s.price * s.qty, 0) / data.sales.reduce((a, s) => a + s.qty, 0)) : null;
  const finish = defaultFinish(card, foil);
  return (
    <div className="ds-modal" role="dialog" aria-modal="true" aria-label={card.name} onClick={onClose}>
      <div className="ds-modal__panel lb-card mk-modal" onClick={(e) => e.stopPropagation()}>
        <header className="ds-modal__head">
          <h2>{card.name}{foil && <em className="mk-foil">Foil</em>}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="mk-modal__body">
          <div className="mk-modal__card"><HoloCard card={card} finish={finish} width="100%" imageWidth={420} onClick={() => onInspect({ card, finish })} /></div>
          <div className="mk-modal__side">
            <p className="muted small">{card.setName} · {card.code} · {avg ? <>last sales average <Coin /> {fmt(avg)}</> : 'no sales yet'}</p>
            <table className="mk-table">
              <thead><tr><th>Seller</th><th>Copies</th><th>Price</th><th /></tr></thead>
              <tbody>
                {data?.listings.map((l) => (
                  <tr key={l.id} className={l.mine ? 'is-mine' : ''}>
                    <td>{l.mine ? 'You' : l.seller}</td><td>{l.qty}</td><td><Coin /> {fmt(l.price)}</td>
                    <td className="mk-table__buy">
                      {!l.mine && <button type="button" className="btn btn--cta btn--small" disabled={own.coins < l.price} onClick={() => buy(l, 1)}>Buy 1</button>}
                      {!l.mine && l.qty > 1 && <button type="button" className="btn btn--ghost btn--small" disabled={own.coins < l.price * l.qty} onClick={() => buy(l, l.qty)}>All {l.qty}</button>}
                    </td>
                  </tr>
                ))}
                {data && data.listings.length === 0 && <tr><td colSpan={4} className="muted">Sold out.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SellForm({ card, foil, have, onDone }: { card: Card; foil: boolean; have: number; onDone: () => void }) {
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [cheapest, setCheapest] = useState<number | null>(null);
  useEffect(() => {
    api<{ listings: Listing[]; sales: Sale[] }>('GET', `/api/market/card?id=${encodeURIComponent(card.id)}&foil=${foil ? 1 : 0}`).then((d) => {
      const c = d.listings.find((l) => !l.mine)?.price ?? null;
      setCheapest(c);
      const last = d.sales[0]?.price ?? null;
      setPrice((p) => p || c || last || ({ common: 10, uncommon: 25, rare: 80, epic: 250, showcase: 800 } as Record<string, number>)[card.rarity] || 20);
    }).catch(() => undefined);
  }, [card, foil]);
  const get = Math.max(0, price * qty - Math.ceil(price * qty * MARKET_FEE));
  const list = () => api<{ account: CollectionState }>('POST', '/api/market/list', { cardId: card.id, foil, qty, price })
    .then((r) => { take(r); showNotice(`${qty}× ${card.name} listed.`, true); onDone(); }).catch(fail);
  return (
    <div className="mk-sell lb-card">
      <strong>{card.name}{foil && <em className="mk-foil">Foil</em>}</strong>
      <span className="muted small">You have {have} {foil ? 'foil ' : ''}cop{have === 1 ? 'y' : 'ies'}{cheapest !== null ? <> · cheapest now <Coin /> {fmt(cheapest)}</> : ''}</span>
      <div className="mk-sell__row">
        <label>Copies<input className="input" type="number" min={1} max={have} value={qty} onChange={(e) => setQty(Math.min(have, Math.max(1, Math.floor(Number(e.target.value) || 1))))} /></label>
        <label>Price per copy<input className="input" type="number" min={1} value={price} onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
      </div>
      <span className="small">You get <Coin /> {fmt(get)} when all sell ({Math.round(MARKET_FEE * 100)} % to the market). Up for {LISTING_DAYS} days.</span>
      <div className="mk-sell__row">
        <button type="button" className="btn btn--cta" onClick={list}>List for sale</button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

type Tab = 'browse' | 'sell' | 'mine';

export function Market({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const session = useSession();
  const signedIn = session.status === 'online' && !!session.user;
  const own = useCollection();
  const byId = useMemo(() => new Map(db.cards.map((c) => [c.id, c])), [db]);
  const [tab, setTab] = useState<Tab>('browse');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'price' | 'new' | 'name'>('price');
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [open, setOpen] = useState<{ card: Card; foil: boolean } | null>(null);
  const [selling, setSelling] = useState<{ card: Card; foil: boolean; have: number } | null>(null);
  const [mine, setMine] = useState<{ listings: Listing[]; sold: Sale[]; bought: Sale[] } | null>(null);

  useEffect(() => {
    if (!signedIn || tab !== 'browse') return;
    const t = setTimeout(() => { api<{ offers: Offer[] }>('GET', `/api/market?q=${encodeURIComponent(q)}&sort=${sort}`).then((r) => setOffers(r.offers)).catch(() => setOffers([])); }, 250);
    return () => clearTimeout(t);
  }, [signedIn, tab, q, sort, open]);
  const loadMine = useCallback(() => api<{ listings: Listing[]; sold: Sale[]; bought: Sale[] }>('GET', '/api/market/mine').then(setMine).catch(() => undefined), []);
  useEffect(() => { if (signedIn && tab === 'mine') void loadMine(); }, [signedIn, tab, loadMine]);

  // your raw copies, to sell: one entry per printing and finish
  const sellable = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.entries(own.cards).flatMap(([id, o]) => {
      const card = byId.get(id);
      if (!card || (needle && !card.name.toLowerCase().includes(needle))) return [];
      return [...(o.normal > 0 ? [{ card, foil: false, have: o.normal }] : []), ...(o.foil > 0 ? [{ card, foil: true, have: o.foil }] : [])];
    }).sort((a, b) => a.card.name.localeCompare(b.card.name)).slice(0, 120);
  }, [own.cards, byId, q]);

  if (!signedIn) {
    return (
      <section className="shop-soon">
        <h1>Marketplace</h1>
        <p className="muted">{session.status === 'offline' ? 'The marketplace needs the server: not in this preview.' : 'Sign in with Discord to buy and sell cards.'}</p>
      </section>
    );
  }

  return (
    <section className="mk lb-col">
      <div className="lb-head">
        <h1>Marketplace</h1>
        <div className="lb-tools">
          <div className="lb-search">
            <Icon name="search" size={16} />
            <input className="input" type="search" placeholder={tab === 'sell' ? 'Your cards…' : 'Search cards…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          {tab === 'browse' && <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[
            { value: 'price', label: 'Sort: Cheapest' }, { value: 'new', label: 'Sort: Newest' }, { value: 'name', label: 'Sort: Name' }]} />}
        </div>
      </div>
      <div className="tn-tabs" role="tablist">
        {([['browse', 'Buy'], ['sell', 'Sell'], ['mine', 'My listings']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSelling(null); }}>{label}</button>
        ))}
      </div>

      {tab === 'browse' && (
        <div className="mk-grid lb-scroll">
          {offers === null && <p className="muted">Loading…</p>}
          {offers?.length === 0 && <p className="muted">Nothing for sale{q ? ' that matches' : ' yet'}.</p>}
          {offers?.map((o) => {
            const card = byId.get(o.cardId);
            if (!card) return null;
            return (
              <button key={`${o.cardId}:${o.foil}`} type="button" className="mk-offer" onClick={() => setOpen({ card, foil: o.foil })}>
                <HoloCard card={card} finish={defaultFinish(card, o.foil)} width="100%" tilt="off" imageWidth={260} />
                <span className="mk-offer__price"><Coin /> {fmt(o.cheapest)}{o.foil && <em className="mk-foil">Foil</em>}</span>
                <span className="muted small">{o.copies} for sale</span>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'sell' && (
        selling ? <SellForm card={selling.card} foil={selling.foil} have={selling.have} onDone={() => setSelling(null)} /> : (
          <div className="mk-grid lb-scroll">
            {sellable.length === 0 && <p className="muted">No cards to sell{q ? ' that match' : ''}.</p>}
            {sellable.map((s) => (
              <button key={`${s.card.id}:${s.foil}`} type="button" className="mk-offer" onClick={() => setSelling(s)}>
                <HoloCard card={s.card} finish={defaultFinish(s.card, s.foil)} width="100%" tilt="off" imageWidth={260} />
                <span className="mk-offer__price">{s.have}×{s.foil && <em className="mk-foil">Foil</em>}</span>
              </button>
            ))}
          </div>
        )
      )}

      {tab === 'mine' && (
        <div className="mk-mine lb-scroll">
          <p className="lb-label">Up for sale</p>
          {mine?.listings.length === 0 && <p className="muted small">Nothing listed.</p>}
          {mine?.listings.map((l) => (
            <div key={l.id} className="adm-row">
              <span>{byId.get(l.cardId)?.name ?? l.cardId}{l.foil && <em className="mk-foil">Foil</em>} · {l.qty}× <Coin /> {fmt(l.price)}</span>
              <span className="muted small">until {new Date(l.expiresAt).toLocaleDateString()}</span>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => api<{ account: CollectionState }>('POST', '/api/market/cancel', { listingId: l.id })
                .then((r) => { take(r); void loadMine(); }).catch(fail)}>Take down</button>
            </div>
          ))}
          <p className="lb-label">Sold</p>
          {mine?.sold.length === 0 && <p className="muted small">No sales yet.</p>}
          {mine?.sold.map((s, i) => (
            <div key={i} className="adm-row"><span>{byId.get(s.cardId!)?.name ?? s.cardId} · {s.qty}× <Coin /> {fmt(s.price)}</span><span className="is-plus">+{fmt(s.price * s.qty - (s.fee ?? 0))}</span><span className="muted small">{new Date(s.at).toLocaleDateString()}</span></div>
          ))}
          <p className="lb-label">Bought</p>
          {mine?.bought.length === 0 && <p className="muted small">Nothing bought yet.</p>}
          {mine?.bought.map((s, i) => (
            <div key={i} className="adm-row"><span>{byId.get(s.cardId!)?.name ?? s.cardId} · {s.qty}× <Coin /> {fmt(s.price)}</span><span className="is-minus">−{fmt(s.price * s.qty)}</span><span className="muted small">{new Date(s.at).toLocaleDateString()}</span></div>
          ))}
        </div>
      )}

      {open && <CardModal card={open.card} foil={open.foil} onClose={() => setOpen(null)} onInspect={onInspect} />}
    </section>
  );
}
