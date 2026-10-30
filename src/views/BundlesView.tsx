import { useEffect, useMemo, useState } from 'react';
import { collection, useCollection } from '../collection/store.ts';
import { productArt } from '../data/media.ts';
import type { CardDb } from '../data/types.ts';
import { decks } from '../decks/store.ts';
import { DECK_PRICE, DECK_PRODUCT, SPECIAL_PACKS } from '../economy/products.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';
import { showNotice } from '../net/api.ts';

/*
 * Shop → Bundles: the collections (T1, Arcane, Secret Garden, Gift of the
 * Rift), sold as packs that give single cards (economy/products.ts), and the
 * official decks, whole and ready to play.
 */

const Coin = () => <span className="lb-coin" aria-hidden />;

/** The decks' products, oldest first, by their short names. */
const DECK_GROUPS: [string, string][] = [
  ['ogs', 'Proving Grounds'], ['ogn', 'Origins'], ['sfd', 'Spiritforged'], ['unl', 'Unleashed'], ['rad', 'Radiance Showdown'],
];

function Shot({ id, alt }: { id: string; alt: string }) {
  const art = productArt(id);
  return <div className="bundle__shot">{art && <img src={art.src} alt={alt} loading="lazy" />}</div>;
}

export function BundlesView({ db }: { db: CardDb }) {
  const own = useCollection();
  const [starters, setStarters] = useState<StarterChoice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { loadStarters(db).then(setStarters).catch(() => setStarters([])); }, [db]);
  // one grid for every deck, in product order; the product is a tag on the tile
  const deckList = useMemo(() => DECK_GROUPS.flatMap(([set, label]) => (starters ?? []).filter((s) => s.set === set).map((s) => ({ s, label }))), [starters]);

  const buyPack = async (id: string, name: string) => {
    setBusy(id);
    if (await collection.buyPack(id, 1)) showNotice(`${name} bought: open it under Collection → Packs`, true);
    setBusy(null);
  };
  const buyDeck = async (s: StarterChoice) => {
    setBusy(s.id);
    if (await collection.buyDeck(s.id, s.cards, s.booster)) {
      // the list, ready to play and to change, in Decks
      const { STARTERS } = await import('../game/index.ts');
      const list = STARTERS.find((x) => x.id === s.id)?.deck;
      if (list) decks.saveCopy(list);
      showNotice(`${s.title}: its cards, a booster and the deck are yours`, true);
    }
    setBusy(null);
  };

  return (
    <section className="lb-col bundles">
      <div className="lb-head"><h1>Bundles &amp; Decks</h1></div>

      <p className="lb-label">Collections</p>
      <div className="bundle-grid">
        {SPECIAL_PACKS.map((p) => {
          return (
            <article key={p.id} className="bundle">
              <Shot id={p.product} alt={p.name} />
              <div className="bundle__body">
                <strong>{p.name}</strong>
                <p className="bundle__text">{p.blurb}</p>
                <ul className="bundle__odds">{p.odds.map((o) => <li key={o}>{o}</li>)}</ul>
                <div className="bundle__actions">
                  <button type="button" className="btn btn--cta btn--small" disabled={busy !== null || own.coins < p.price} onClick={() => { void buyPack(p.id, p.name); }}>
                    <Coin /> {p.price.toLocaleString('en-US')}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="lb-label">Decks</p>
      {starters === null ? <p className="muted">Loading…</p> : (
        <div className="bundle-grid bundle-grid--decks">
          {deckList.map(({ s: d, label }) => (
            <article key={d.id} className="bundle bundle--deck">
              <Shot id={DECK_PRODUCT[d.id] ?? ''} alt={d.title} />
              <span className="bundle__tag">{label}</span>
              <div className="bundle__body">
                <strong>{d.title.replace(/^[^:]*: /, '').replace(/ Showdown Deck$/, '')}</strong>
                <p className="bundle__text">{d.blurb.replace(/\.$/, '')}</p>
                <div className="bundle__actions">
                  <button type="button" className="btn btn--cta btn--small" disabled={busy !== null || own.coins < DECK_PRICE} onClick={() => { void buyDeck(d); }}>
                    <Coin /> {DECK_PRICE}
                  </button>
                  <span className="bundle__note" title="The deck and a booster of its set">{d.size} cards</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
