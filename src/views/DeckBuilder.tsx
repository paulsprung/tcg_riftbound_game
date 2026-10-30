import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { useCollection } from '../collection/store.ts';
import { DOMAIN_COLOR, defaultFinish, symbolFor, VARIANT_LABEL } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { available, isBasicRune, LEGENDS, missingCards, ownedDefs, ownedPrints, ownPrintings } from '../decks/ownership.ts';
import { decks, emptyDeck, type SavedDeck } from '../decks/store.ts';
import {
  BATTLEFIELDS_PER_DECK, findCard, ORACLE, RUNES_PER_DECK, validateDeck, type DefId, type OracleCard,
} from '../game/index.ts';
import { Icon } from '../lobby/icons.tsx';
import { Select } from '../lobby/Select.tsx';
import { cardFor, cardIndex, type CardIndex } from '../play/model/cards.ts';
import './deckBuilder.css';

/*
 * The deck builder, by the 1v1 Duel rules [101–103] and the Tournament
 * Rules' constructed format (TR 601):
 *
 *   a Champion Legend, which sets the deck's two domains [103.2]
 *   a Main Deck of exactly 40 units, gear and spells of those domains
 *     (or none), the Chosen Champion's copy included (TR 402.1, TR 601.1.b)
 *   at most 3 copies of a name [103.3.b], 1 of a Unique card [825.3.a]
 *   at most 3 Signature cards, all of the legend's champion [103.3.d]
 *   a Chosen Champion: a champion unit of the legend's tag [103.3.a.2]
 *   a Rune Deck of 12 runes of the two domains [103.4]
 *   3 battlefields with different names [103.5], [487.4.a]
 *   only cards legal in Standard (bans, sets) [103.3.e], TR 601.2
 *
 * The engine's validator (decks/validate.ts) checks all of it; this page
 * only helps to get there. On top of the rules: the builder offers only the
 * cards you own, basic runes aside, which everyone has enough of.
 */

type Pool = 'main' | 'battlefields' | 'runes';
const COSTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;      // 7 is 7+
const MAIN_SIZE = 40;

const energy = (c: OracleCard) => c.cost?.energy ?? 0;
const power = (c: OracleCard) => c.cost?.power.length ?? 0;
const kindOf = (c: OracleCard) => (c.types.includes('unit') ? 'Unit' : c.types.includes('spell') ? 'Spell' : 'Gear');
const inIdentity = (c: OracleCard, identity: string[]) => c.domains.every((d) => identity.includes(d));

/** A domain as a coloured chip with its symbol. */
function Domain({ d, db }: { d: string; db: CardDb }) {
  const sym = symbolFor(db, 'domains', d);
  return (
    <span className="chip" style={{ '--chip': DOMAIN_COLOR[d.toLowerCase()] } as CSSProperties}>
      {sym && <img src={sym.icon} alt="" />}{d[0].toUpperCase() + d.slice(1)}
    </span>
  );
}

/** Step 1: the legend, among the ones you own. */
function LegendPick({ ix, db, own, onPick, onBack }: {
  ix: CardIndex; db: CardDb; own: Record<DefId, number>; onPick: (l: OracleCard) => void; onBack: () => void;
}) {
  const coll = useCollection();
  const list = useMemo(() => LEGENDS.filter((l) => (own[l.id] ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name)), [own]);
  return (
    <section className="db db--legend">
      <header className="db__bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={onBack}><Icon name="back" size={14} /> Decks</button>
        <h1>Choose a legend</h1>
      </header>
      <div className="db-legends lb-scroll">
        {list.length === 0 && <p className="muted">No legend yet.</p>}
        {list.map((l) => {
          const card = cardFor(ix, l.id, ownedPrints((ix.byDef[l.id] ?? []).map((x) => x.id), coll)[0] ?? null);
          return (
            <button key={l.id} type="button" className="db-legend" onClick={() => onPick(l)}>
              <span className="db-legend__card">{card && <HoloCard card={card} finish={defaultFinish(card)} width="100%" tilt="hover" imageWidth={320} />}</span>
              <strong>{l.championTag ?? l.name}</strong>
              <span className="chips">{l.domains.map((d) => <Domain key={d} d={d} db={db} />)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A card of the pool: click adds a copy, right-click takes one out. */
function PoolCard({ c, card, inDeck, have, cap, prints, onAdd, onRemove, onNextPrint, onInspect }: {
  c: OracleCard; card: Card | null; inDeck: number; have: number; cap: number;
  /** How many printings of it the player owns: with more than one, they pick the art. */
  prints: number;
  onAdd: () => void; onRemove: () => void; onNextPrint: () => void; onInspect: (t: InspectTarget) => void;
}) {
  const room = Math.min(cap, have) - inDeck;
  const none = have === 0;
  return (
    <div className={`db-pc${none ? ' is-unowned' : ''}${room <= 0 && !none ? ' is-full' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); onRemove(); }}>
      <button type="button" className="db-pc__card" onClick={onAdd} disabled={room <= 0} title="Click: add · right-click: remove"
        aria-label={`Add ${c.name}${none ? ' (not owned)' : ''}`}>
        {card ? <HoloCard card={card} finish="none" width="100%" tilt="off" upright={card.orientation === 'landscape'} imageWidth={260} /> : <span className="db-pc__ph">{c.name}</span>}
      </button>
      <span className="db-pc__own" title="Copies you own">{have === Infinity ? '∞' : `${have}×`}</span>
      {inDeck > 0 && <span className="db-pc__in" title="In the deck">{inDeck}</span>}
      {card && <button type="button" className="db-pc__zoom" aria-label={`Look at ${c.name}`} onClick={() => onInspect({ card, finish: defaultFinish(card) })}><Icon name="search" size={12} /></button>}
      {prints > 1 && (
        <button type="button" className="db-pc__print" onClick={onNextPrint} title="Which printing the deck shows"
          aria-label={`Next printing of ${c.name} (${prints} owned)`}>⇄ {card ? `${card.setId.toUpperCase()} ${VARIANT_LABEL[card.variant]}` : 'Art'}</button>
      )}
    </div>
  );
}

/** A row of the deck list: cost, name, copies, and the buttons to change them. */
function Row({ c, n, can, onAdd, onRemove, onHover, extra }: {
  c: OracleCard; n: number; can: boolean; onAdd: () => void; onRemove: () => void; onHover: () => void; extra?: ReactNode;
}) {
  return (
    <li className="db-row" onMouseEnter={onHover}>
      <span className="db-row__cost">{c.cost ? energy(c) : '–'}</span>
      <span className="db-row__name">{c.name}{extra}</span>
      <span className="db-row__n">{n}×</span>
      <button type="button" className="db-row__btn" onClick={onRemove} aria-label={`One ${c.name} less`}>−</button>
      <button type="button" className="db-row__btn" onClick={onAdd} disabled={!can} aria-label={`One ${c.name} more`}>+</button>
    </li>
  );
}

function Builder({ initial, db, ix, onInspect, onDone }: {
  initial: SavedDeck; db: CardDb; ix: CardIndex; onInspect: (t: InspectTarget) => void; onDone: () => void;
}) {
  const coll = useCollection();
  const own = useMemo(() => ownedDefs(coll), [coll]);
  const [d, setD] = useState<SavedDeck>(initial);
  const [dirty, setDirty] = useState(false);
  const [pool, setPool] = useState<Pool>('main');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [hover, setHover] = useState<DefId | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const legend = findCard(d.legend)!;
  const identity = legend.domains as string[];
  const tag = legend.championTag;
  const change = (next: SavedDeck) => { setD(next); setDirty(true); };

  const count = (def: DefId) => d.main.filter((e) => e.def === def).reduce((a, e) => a + e.n, 0);
  const runeN = (def: DefId) => d.runes.filter((e) => e.def === def).reduce((a, e) => a + e.n, 0);
  const capOf = (c: OracleCard) => (c.deck?.includes('anyNumber') ? 99 : c.deck?.includes('unique') ? 1 : 3);
  const mainSize = d.main.reduce((a, e) => a + e.n, 0);
  const runeSize = d.runes.reduce((a, e) => a + e.n, 0);
  const signatures = d.main.filter((e) => findCard(e.def)?.supertypes.includes('signature')).reduce((a, e) => a + e.n, 0);

  // the Chosen Champion: kept while it is in the deck, else the first champion of the legend's tag
  const champions = useMemo(() => d.main.map((e) => findCard(e.def)!).filter((c) => c && c.types.includes('unit')
    && c.supertypes.includes('champion') && (tag === undefined || c.championTag === tag)), [d.main, tag]);
  useEffect(() => {
    if (champions.some((c) => c.id === d.chosenChampion)) return;
    const next = champions[0]?.id ?? ('' as DefId);
    if (next !== d.chosenChampion) setD((x) => ({ ...x, chosenChampion: next }));
  }, [champions, d.chosenChampion]);

  const setMain = (def: DefId, by: 1 | -1) => {
    const c = findCard(def)!;
    const n = count(def) + by;
    if (n < 0 || n > Math.min(capOf(c), available(own, def))) return;
    if (by > 0 && c.supertypes.includes('signature') && signatures >= 3) return;
    const main = d.main.filter((e) => e.def !== def);
    change({ ...d, main: n > 0 ? [...main, { def, n }] : main });
  };
  const setRune = (def: DefId, by: 1 | -1) => {
    const n = runeN(def) + by;
    if (n < 0 || (by > 0 && runeSize >= RUNES_PER_DECK) || n > available(own, def)) return;
    const runes = d.runes.filter((e) => e.def !== def);
    change({ ...d, runes: n > 0 ? [...runes, { def, n }] : runes });
  };
  const toggleField = (def: DefId) => {
    if (d.battlefields.includes(def)) change({ ...d, battlefields: d.battlefields.filter((b) => b !== def) });
    else if (d.battlefields.length < BATTLEFIELDS_PER_DECK && available(own, def) > 0) change({ ...d, battlefields: [...d.battlefields, def] });
  };
  // the rune split the legend's domains suggest: 6 and 6
  const evenRunes = () => {
    const ids = identity.map((x) => `${x}-rune` as DefId).filter((id) => findCard(id));
    const each = Math.floor(RUNES_PER_DECK / ids.length);
    change({ ...d, runes: ids.map((def, i) => ({ def, n: each + (i < RUNES_PER_DECK - each * ids.length ? 1 : 0) })) });
  };

  // ---- the pool on the left ----
  const poolCards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ORACLE.cards.filter((c) => {
      if (pool === 'main' && !c.types.some((t) => t === 'unit' || t === 'gear' || t === 'spell')) return false;
      if (pool === 'battlefields' && !c.types.includes('battlefield')) return false;
      if (pool === 'runes' && !c.types.includes('rune')) return false;
      if (!inIdentity(c, identity)) return false;
      if (c.supertypes.includes('signature') && tag !== undefined && c.championTag !== tag) return false;
      if (available(own, c.id) <= 0) return false;            // only what you own
      if (pool === 'main' && kind && kindOf(c) !== kind) return false;
      if (pool === 'main' && cost !== null && (cost === 7 ? energy(c) < 7 : energy(c) !== cost)) return false;
      return !needle || c.name.toLowerCase().includes(needle) || c.rules.toLowerCase().includes(needle) || c.tags.some((t) => t.toLowerCase().includes(needle));
    }).sort((a, b) => energy(a) - energy(b) || power(a) - power(b) || a.name.localeCompare(b.name));
  }, [pool, q, kind, cost, own, identity, tag]);
  // what you own of this pool that the legend's domains keep out [133.3]
  const outside = useMemo(() => ORACLE.cards.filter((c) => (pool === 'main' ? c.types.some((t) => t === 'unit' || t === 'gear' || t === 'spell') : c.types.includes(pool === 'runes' ? 'rune' : 'battlefield'))
    && !inIdentity(c, identity) && available(own, c.id) > 0 && !isBasicRune(c.id)).length, [pool, own, identity]);
  const [shown, setShown] = useState(60);
  useEffect(() => setShown(60), [poolCards]);

  // ---- the checks ----
  const issues = useMemo(() => validateDeck(d, 'sanctioned', { format: 'standard' }).filter((i) => i.severity === 'error'), [d]);
  const missing = useMemo(() => missingCards(d, own), [d, own]);
  const ready = issues.length === 0 && missing.length === 0;

  const groups = useMemo(() => {
    const rows = d.main.map((e) => ({ c: findCard(e.def)!, n: e.n })).filter((r) => r.c)
      .sort((a, b) => energy(a.c) - energy(b.c) || a.c.name.localeCompare(b.c.name));
    return (['Unit', 'Spell', 'Gear'] as const).map((k) => ({ k, rows: rows.filter((r) => kindOf(r.c) === k) })).filter((g) => g.rows.length > 0);
  }, [d.main]);
  const curve = useMemo(() => COSTS.map((x) => d.main.filter((e) => {
    const c = findCard(e.def); return c && (x === 7 ? energy(c) >= 7 : energy(c) === x);
  }).reduce((a, e) => a + e.n, 0)), [d.main]);
  const peak = Math.max(1, ...curve);

  // the art: the printing picked for a card while it is owned, else the first owned in the index's order
  const orderOf = (def: DefId) => (ix.byDef[def] ?? []).map((x) => x.id);
  const mineOf = (def: DefId) => ownedPrints(orderOf(def), coll);
  const printOf = (def: DefId) => ownPrintings({ ...d, legend: def, main: [], battlefields: [], runes: [] }, coll, orderOf)[def]?.[0] ?? null;
  const nextPrint = (def: DefId) => {
    const mine = mineOf(def);
    if (mine.length < 2) return;
    const next = mine[(mine.indexOf(printOf(def) ?? '') + 1) % mine.length];
    change({ ...d, printings: { ...d.printings, [def]: [next] } });
  };

  const save = () => { decks.save({ ...d, printings: ownPrintings(d, coll, orderOf) }); setDirty(false); };
  const leave = () => { if (dirty) save(); onDone(); };

  const preview = hover ? cardFor(ix, hover, printOf(hover)) : null;
  const legendCard = cardFor(ix, d.legend, printOf(d.legend));

  return (
    <section className="db">
      <header className="db__bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={leave}><Icon name="back" size={14} /> Decks</button>
        <input className="input db__name" value={d.name} maxLength={40} aria-label="Deck name"
          onChange={(e) => change({ ...d, name: e.target.value })} />
        <span className="chips">{identity.map((x) => <Domain key={x} d={x} db={db} />)}</span>
        <span className="db__bar-right">
          <span className={`db-state${ready ? ' is-ready' : ''}`}>{ready ? 'Ready to play' : 'Not ready'}</span>
          <button type="button" className="btn btn--cta btn--small" onClick={save} disabled={!dirty}>{dirty ? 'Save' : 'Saved'}</button>
        </span>
      </header>

      <div className="db__body">
        {/* ---- the cards you can add ---- */}
        <section className="db-pool" aria-label="Cards">
          <div className="db-pool__tabs" role="tablist">
            {([['main', `Main deck ${mainSize}/${MAIN_SIZE}`], ['battlefields', `Battlefields ${d.battlefields.length}/${BATTLEFIELDS_PER_DECK}`], ['runes', `Runes ${runeSize}/${RUNES_PER_DECK}`]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={pool === id} onClick={() => setPool(id)}>{label}</button>
            ))}
          </div>
          <div className="db-pool__filters">
            <div className="lb-search">
              <Icon name="search" size={15} />
              <input className="input" type="search" placeholder="Name, text or tag…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
            </div>
            {pool === 'main' && (
              <>
                <Select label="Type" value={kind} onChange={setKind} options={[{ value: '', label: 'All types' }, { value: 'Unit', label: 'Units' }, { value: 'Spell', label: 'Spells' }, { value: 'Gear', label: 'Gear' }]} />
                <div className="db-costs" role="group" aria-label="Energy cost">
                  {COSTS.map((x) => (
                    <button key={x} type="button" aria-pressed={cost === x} onClick={() => setCost(cost === x ? null : x)}>{x === 7 ? '7+' : x}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className={`db-pool__grid lb-scroll${pool === 'battlefields' ? ' is-wide' : ''}`}>
            {poolCards.length === 0 && <p className="muted">No cards match.</p>}
            {poolCards.slice(0, shown).map((c) => {
              const have = available(own, c.id);
              const inDeck = pool === 'runes' ? runeN(c.id) : pool === 'battlefields' ? Number(d.battlefields.includes(c.id)) : count(c.id);
              const cap = pool === 'runes' ? RUNES_PER_DECK : pool === 'battlefields' ? 1 : capOf(c);
              return (
                <PoolCard key={c.id} c={c} card={cardFor(ix, c.id, printOf(c.id))} inDeck={inDeck} have={have} cap={cap} onInspect={onInspect}
                  prints={mineOf(c.id).length} onNextPrint={() => nextPrint(c.id)}
                  onAdd={() => (pool === 'runes' ? setRune(c.id, 1) : pool === 'battlefields' ? toggleField(c.id) : setMain(c.id, 1))}
                  onRemove={() => (pool === 'runes' ? setRune(c.id, -1) : pool === 'battlefields' ? (inDeck ? toggleField(c.id) : undefined) : setMain(c.id, -1))} />
              );
            })}
            {shown < poolCards.length && (
              <div className="more"><button type="button" className="btn btn--ghost btn--small" onClick={() => setShown((n) => n + 60)}>Show more ({poolCards.length - shown})</button></div>
            )}
            {outside > 0 && shown >= poolCards.length && (
              <p className="db-pool__note muted">{outside} more card{outside === 1 ? '' : 's'} you own {outside === 1 ? 'is' : 'are'} outside {legend.championTag ?? legend.name}’s domains ({identity.join(', ')}): a deck holds only cards of its legend’s domains.</p>
            )}
          </div>
        </section>

        {/* ---- the deck ---- */}
        {preview && (
          <div className="db-peek" aria-hidden>
            <HoloCard card={preview} finish="none" width="100%" tilt="off" upright={preview.orientation === 'landscape'} imageWidth={320} />
          </div>
        )}
        <aside className="db-deck lb-card" aria-label="Deck" onMouseLeave={() => setHover(null)}>
          <div className="db-deck__top">
            <span className="db-deck__legend">{legendCard && <HoloCard card={legendCard} finish={defaultFinish(legendCard)} width="100%" tilt="off" imageWidth={200} />}</span>
            <div className="db-deck__meta">
              <span className="lb-label">Legend</span>
              <strong>{legend.name}</strong>
              <span className="lb-label">Chosen champion</span>
              {champions.length > 1 ? (
                <Select label="Chosen champion" value={d.chosenChampion} onChange={(v) => change({ ...d, chosenChampion: v as DefId })}
                  options={[...new Map(champions.map((c) => [c.id, c])).values()].map((c) => ({ value: c.id, label: c.name }))} />
              ) : <strong className={champions.length ? '' : 'db-warn'}>{champions[0]?.name ?? `Add a ${tag ?? ''} champion unit`}</strong>}
            </div>
          </div>

          <div className="db-curve" aria-label="Energy curve">
            {curve.map((n, i) => (
              <span key={i} className="db-curve__bar" title={`${n} cards at ${i === 7 ? '7+' : i} energy`}>
                <i style={{ height: `${(n / peak) * 100}%` }} />
                <em>{i === 7 ? '7+' : i}</em>
              </span>
            ))}
          </div>

          <div className="db-deck__list lb-scroll">
            <p className="db-sec">Main deck <span className={mainSize === MAIN_SIZE ? 'is-ok' : ''}>{mainSize}/{MAIN_SIZE}</span></p>
            {groups.map((g) => (
              <div key={g.k}>
                <p className="db-sub">{g.k === 'Gear' ? 'Gear' : `${g.k}s`} <span>{g.rows.reduce((a, r) => a + r.n, 0)}</span></p>
                <ul className="db-rows">
                  {g.rows.map(({ c, n }) => (
                    <Row key={c.id} c={c} n={n} onHover={() => setHover(c.id)} can={n < Math.min(capOf(c), available(own, c.id))}
                      onAdd={() => setMain(c.id, 1)} onRemove={() => setMain(c.id, -1)}
                      extra={c.id === d.chosenChampion ? <em className="db-tag">Champion</em> : c.supertypes.includes('signature') ? <em className="db-tag db-tag--sig">Signature</em> : null} />
                  ))}
                </ul>
              </div>
            ))}

            <p className="db-sec">Battlefields <span className={d.battlefields.length === BATTLEFIELDS_PER_DECK ? 'is-ok' : ''}>{d.battlefields.length}/{BATTLEFIELDS_PER_DECK}</span></p>
            <ul className="db-rows">
              {d.battlefields.map((b) => findCard(b)).filter((c): c is OracleCard => !!c).map((c) => (
                <li key={c.id} className="db-row" onMouseEnter={() => setHover(c.id)}>
                  <span className="db-row__cost">◇</span><span className="db-row__name">{c.name}</span>
                  <button type="button" className="db-row__btn" onClick={() => toggleField(c.id)} aria-label={`Take out ${c.name}`}>−</button>
                </li>
              ))}
              {d.battlefields.length < BATTLEFIELDS_PER_DECK && <li><button type="button" className="db-add" onClick={() => setPool('battlefields')}>+ Add a battlefield</button></li>}
            </ul>

            <p className="db-sec">Runes <span className={runeSize === RUNES_PER_DECK ? 'is-ok' : ''}>{runeSize}/{RUNES_PER_DECK}</span></p>
            <ul className="db-rows">
              {identity.map((x) => `${x}-rune` as DefId).filter((id) => findCard(id)).map((id) => (
                <Row key={id} c={findCard(id)!} n={runeN(id)} can={runeSize < RUNES_PER_DECK} onHover={() => setHover(id)}
                  onAdd={() => setRune(id, 1)} onRemove={() => setRune(id, -1)} />
              ))}
              {d.runes.filter((e) => !isBasicRune(e.def)).map((e) => findCard(e.def)).filter((c): c is OracleCard => !!c).map((c) => (
                <Row key={c.id} c={c} n={runeN(c.id)} can={runeSize < RUNES_PER_DECK} onHover={() => setHover(c.id)}
                  onAdd={() => setRune(c.id, 1)} onRemove={() => setRune(c.id, -1)} />
              ))}
              {runeSize === 0 && <li><button type="button" className="db-add" onClick={evenRunes}>+ Split 6 / 6</button></li>}
            </ul>
          </div>


          <footer className="db-deck__foot">
            {(issues.length > 0 || missing.length > 0) && (
              <button type="button" className="db-issues" aria-expanded={showIssues} onClick={() => setShowIssues(!showIssues)}>
                {issues.length + (missing.length > 0 ? 1 : 0)} thing{issues.length + (missing.length > 0 ? 1 : 0) === 1 ? '' : 's'} to fix
              </button>
            )}
            {showIssues && (
              <ul className="db-issues__list">
                {missing.length > 0 && <li>Cards you don't own: {missing.map((m) => `${m.n}× ${findCard(m.def)?.name ?? m.def}`).join(', ')}</li>}
                {issues.map((i, k) => <li key={k}>{i.message} <span className="muted">[{i.rule}]</span></li>)}
              </ul>
            )}
            <div className="db-deck__actions">
              {confirmDelete ? (
                <>
                  <span className="small">Delete this deck?</span>
                  <button type="button" className="btn btn--danger btn--small" onClick={() => { decks.remove(d.id); onDone(); }}>Delete</button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              ) : (
                <button type="button" className="lb-linkbtn" onClick={() => setConfirmDelete(true)}>Delete deck</button>
              )}
            </div>
          </footer>
        </aside>
      </div>
    </section>
  );
}

/** '#collection/decks/new' (a legend first) and '#collection/decks/edit/<id>'. */
export function DeckBuilder({ db, onInspect, editing }: { db: CardDb; onInspect: (t: InspectTarget) => void; editing: string | 'new' }) {
  const coll = useCollection();
  const own = useMemo(() => ownedDefs(coll), [coll]);
  const ix = useMemo(() => cardIndex(db), [db]);
  const back = () => { location.hash = 'collection/decks'; };
  const existing = editing === 'new' ? undefined : decks.byId(editing);

  if (editing === 'new') {
    return (
      <LegendPick ix={ix} db={db} own={own} onBack={back} onPick={(l) => {
        const d = emptyDeck(l.id, `${l.championTag ?? l.name} deck`);
        // the legend's own champion, when owned, goes in at once: the deck needs it
        const champ = ORACLE.cards.find((c) => c.types.includes('unit') && c.supertypes.includes('champion') && c.championTag === l.championTag && (own[c.id] ?? 0) > 0);
        if (champ) { d.main = [{ def: champ.id, n: 1 }]; d.chosenChampion = champ.id; }
        decks.save(d);
        location.hash = `collection/decks/edit/${d.id}`;
      }} />
    );
  }
  if (!existing) {
    return (
      <section className="db"><p className="muted">This deck no longer exists.</p><button type="button" className="btn btn--small" onClick={back}>Back to your decks</button></section>
    );
  }
  return <Builder key={existing.id} initial={existing} db={db} ix={ix} onInspect={onInspect} onDone={back} />;
}
