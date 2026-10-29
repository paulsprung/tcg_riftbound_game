import { useMemo, useState, type CSSProperties } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { defOfPrinting, findCard, isChampionUnit, isMainDeckCard, isType } from '../game/cards/oracle.ts';
import type { DeckList } from '../game/decks/decklist.ts';
import type { Domain } from '../game/state/types.ts';
import { rng } from '../pack/generate.ts';
import { BOOSTER_SETS } from '../pack/packConfig.ts';
import { PackWrapper } from '../pack/PackWrapper.tsx';
import { heroCard } from '../pack/hero.ts';
import {
  autoBuild, BATTLEFIELDS, BLANK_BATTLEFIELD, botPick, draftDone, limitedIssues, MAX_DOMAINS, MIN_DECK, newDraft, pick, poolDefs,
  runesFor, sealedPool, type Draft, type LimitedFormat,
} from './limited.ts';
import './limited.css';

/*
 * A Limited game against the computer (Custom game): the set, then six
 * boosters opened (Sealed) or a draft with seven computer seats (Draft),
 * then a deck built from what you have, then the game. The computer builds
 * its deck from a pool of its own (Sealed) or from the next seat's picks.
 */

const DOMAINS: Domain[] = ['fury', 'calm', 'mind', 'body', 'chaos', 'order'];
const DOMAIN_COLOR: Record<Domain, string> = { fury: '#e0475f', calm: '#3fbf7f', mind: '#4f8fe0', body: '#e08a3a', chaos: '#9d6be0', order: '#e0c04f' };
const seed = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

type Step = { k: 'set' } | { k: 'pool' } | { k: 'draft'; d: Draft } | { k: 'build' };

function Thumb({ card, onClick, badge, dim, title }: { card: Card | undefined; onClick?: () => void; badge?: string; dim?: boolean; title?: string }) {
  if (!card) return null;
  return (
    <button type="button" className={`lm-card${dim ? ' is-dim' : ''}`} onClick={onClick} title={title ?? card.name}>
      <HoloCard card={card} finish={dim ? 'none' : defaultFinish(card)} width="100%" tilt={dim ? 'off' : 'hover'} imageWidth={260}
        upright={card.orientation === 'landscape'} />
      {badge && <span className="lm-card__badge">{badge}</span>}
    </button>
  );
}

export function LimitedFlow({ db, format, onPlay, onBack, error }: {
  db: CardDb; format: LimitedFormat; error?: string | null;
  onPlay: (mine: DeckList, theirs: DeckList) => void;
  onBack: () => void;
}) {
  const cards = useMemo(() => new Map(db.cards.map((c) => [c.id, c])), [db]);
  const [step, setStep] = useState<Step>({ k: 'set' });
  const [setId, setSetId] = useState(BOOSTER_SETS[0].id);
  const [pool, setPool] = useState<string[]>([]);
  const [rival, setRival] = useState<string[]>([]);
  const [deck, setDeck] = useState<DeckList | null>(null);
  const random = useMemo(() => rng(seed()), []);

  const begin = () => {
    if (format === 'sealed') {
      const mine = sealedPool(db, setId, random);
      setPool(mine);
      setRival(sealedPool(db, setId, random));
      setStep({ k: 'pool' });
    } else {
      setStep({ k: 'draft', d: newDraft(db, setId, random) });
    }
  };
  // you pick; the seven computer seats pick at once
  const take = (d: Draft, card: string) => {
    let next = pick(d, 0, card);
    for (let s = 1; s < next.packs.length; s++) next = pick(next, s, botPick(cards, next.packs[s], next.picks[s]));
    if (draftDone(next)) {
      setPool(next.picks[0]);
      setRival(next.picks[1]);
      setDeck(autoBuild(next.picks[0], format, cards));
      setStep({ k: 'build' });
    } else setStep({ k: 'draft', d: next });
  };
  const build = () => { setDeck(autoBuild(pool, format, cards)); setStep({ k: 'build' }); };

  const label = format === 'sealed' ? 'Sealed' : 'Draft';
  return (
    <section className="play-setup ds lm">
      <header className="ds__bar">
        <h1>{label} <em className="lobby-tag">vs Computer</em></h1>
        <span className="ds__bar-right">
          <button type="button" className="btn btn--ghost btn--small" onClick={onBack}>Back</button>
        </span>
      </header>

      {error && <p className="play__error">{error}</p>}
      {step.k === 'set' && (
        <div className="lm-sets">
          <p className="muted">{format === 'sealed'
            ? `Six boosters of one set; build a deck of at least ${MIN_DECK.sealed} cards from them.`
            : `Three boosters, drafted with seven computer players: pick one card, pass the rest. Build a deck of at least ${MIN_DECK.draft} from your 39 picks.`}</p>
          <div className="lm-sets__row">
            {BOOSTER_SETS.map((s) => {
              const info = db.sets.find((x) => x.id === s.id);
              if (!info) return null;
              const setCards = db.cards.filter((c) => c.setId === s.id);
              return (
                <button key={s.id} type="button" className={`lm-set${setId === s.id ? ' is-on' : ''}`} onClick={() => setSetId(s.id)}>
                  <PackWrapper set={info} style={s.style} hero={heroCard(setCards, s.style)} width={120} />
                  <strong>{info.name}</strong>
                </button>
              );
            })}
          </div>
          <div className="ds__start"><button type="button" className="btn btn--cta" onClick={begin}>{format === 'sealed' ? 'Open six boosters' : 'Start the draft'}</button></div>
        </div>
      )}

      {step.k === 'pool' && (
        <div className="lm-pool">
          <p className="lm-sub">Your pool · {pool.length} cards</p>
          <div className="lm-grid lm-grid--reveal">
            {[...pool].sort((a, b) => rankOf(cards.get(b)) - rankOf(cards.get(a))).map((id, i) => (
              <div key={`${id}-${i}`} className="lm-reveal" style={{ '--i': i } as CSSProperties}><Thumb card={cards.get(id)} /></div>
            ))}
          </div>
          <div className="ds__start"><button type="button" className="btn btn--cta" onClick={build}>Build your deck</button></div>
        </div>
      )}

      {step.k === 'draft' && (
        <div className="lm-draft">
          <p className="lm-sub">Booster {step.d.round + 1} of 3 · pick {step.d.picks[0].length % 13 + 1} · passing {step.d.round === 1 ? 'right' : 'left'}</p>
          <div className="lm-grid">
            {step.d.packs[0].map((id, i) => <Thumb key={`${step.d.round}-${step.d.picks[0].length}-${i}`} card={cards.get(id)} onClick={() => take(step.d, id)} title={`Pick ${cards.get(id)?.name}`} />)}
          </div>
          <p className="lm-sub">Your picks · {step.d.picks[0].length}</p>
          <div className="lm-strip">{step.d.picks[0].map((id, i) => <Thumb key={`${id}-${i}`} card={cards.get(id)} />)}</div>
        </div>
      )}

      {step.k === 'build' && deck && (
        <Builder cards={cards} pool={pool} format={format} deck={deck} onChange={setDeck}
          onAuto={() => setDeck(autoBuild(pool, format, cards))}
          onPlay={() => onPlay(deck, autoBuild(rival, format, cards))} />
      )}
    </section>
  );
}

const RANK: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, showcase: 5, ultimate: 6 };
const rankOf = (c: Card | undefined) => RANK[c?.rarity ?? 'common'] ?? 1;

function Builder({ cards, pool, format, deck, onChange, onAuto, onPlay }: {
  cards: Map<string, Card>; pool: string[]; format: LimitedFormat; deck: DeckList;
  onChange: (d: DeckList) => void; onAuto: () => void; onPlay: () => void;
}) {
  const have = poolDefs(pool);
  const domains = deck.domains ?? [];
  const issues = limitedIssues(deck, pool, format);
  const inDeck = (def: string) => deck.main.find((e) => e.def === def)?.n ?? 0;
  const printOf = (def: string) => pool.find((id) => defOfPrinting(id) === def);
  const size = deck.main.reduce((t, e) => t + e.n, 0);
  const setDomains = (next: Domain[]) => onChange({ ...deck, domains: next, runes: runesFor(next) });
  const toggle = (d: Domain) => setDomains(domains.includes(d) ? domains.filter((x) => x !== d) : domains.length < MAX_DOMAINS ? [...domains, d] : domains);
  const add = (def: string) => {
    if (inDeck(def) >= (have.get(def) ?? 0)) return;
    const main = deck.main.some((e) => e.def === def) ? deck.main.map((e) => (e.def === def ? { ...e, n: e.n + 1 } : e)) : [...deck.main, { def, n: 1 }];
    onChange({ ...deck, main });
  };
  const remove = (def: string) => {
    const main = deck.main.map((e) => (e.def === def ? { ...e, n: e.n - 1 } : e)).filter((e) => e.n > 0);
    onChange({ ...deck, main, chosenChampion: main.some((e) => e.def === deck.chosenChampion) ? deck.chosenChampion : '' });
  };
  const defs = [...have.keys()];
  const mainDefs = defs.filter((d) => { const c = findCard(d); return c && isMainDeckCard(c); })
    .sort((a, b) => (findCard(a)!.cost?.energy ?? 0) - (findCard(b)!.cost?.energy ?? 0) || a.localeCompare(b));
  const legends = defs.filter((d) => isType(findCard(d)!, 'legend'));
  const fields = defs.filter((d) => isType(findCard(d)!, 'battlefield'));
  const champions = deck.main.map((e) => e.def).filter((d) => isChampionUnit(findCard(d)!));
  const fits = (def: string) => (findCard(def)?.domains ?? []).every((x) => domains.includes(x));
  return (
    <div className="lm-build">
      <div className="lm-build__pool">
        <div className="lm-domains" role="group" aria-label={`Domains, up to ${MAX_DOMAINS}`}>
          {DOMAINS.map((d) => (
            <button key={d} type="button" aria-pressed={domains.includes(d)} style={{ '--dc': DOMAIN_COLOR[d] } as CSSProperties} onClick={() => toggle(d)}>{cap(d)}</button>
          ))}
          <button type="button" className="btn btn--ghost btn--small" onClick={onAuto}>Auto build</button>
        </div>
        <div className="lm-grid lm-grid--pool">
          {mainDefs.map((def) => {
            const n = inDeck(def), max = have.get(def) ?? 0;
            return <Thumb key={def} card={cards.get(printOf(def) ?? '')} dim={!fits(def)} badge={`${n}/${max}`}
              onClick={() => add(def)} title={`${findCard(def)?.name}: add (${n} of ${max} in the deck)`} />;
          })}
        </div>
      </div>
      <aside className="lm-build__deck">
        <p className="lm-sub">Deck · {size} cards <span className="muted">(at least {MIN_DECK[format]})</span></p>
        <label>Legend
          <select value={deck.legend} onChange={(e) => onChange({ ...deck, legend: e.target.value })}>
            <option value="">None (draw 1 more without a Chosen Champion)</option>
            {legends.map((d) => <option key={d} value={d}>{findCard(d)!.name}</option>)}
          </select>
        </label>
        <label>Chosen Champion
          <select value={deck.chosenChampion} onChange={(e) => onChange({ ...deck, chosenChampion: e.target.value })}>
            <option value="">None</option>
            {[...new Set(champions)].map((d) => <option key={d} value={d}>{findCard(d)!.name}</option>)}
          </select>
        </label>
        {Array.from({ length: BATTLEFIELDS }, (_, i) => (
          <label key={i}>Battlefield {i + 1}
            <select value={deck.battlefields[i] ?? BLANK_BATTLEFIELD}
              onChange={(e) => onChange({ ...deck, battlefields: Array.from({ length: BATTLEFIELDS }, (_, j) => (j === i ? e.target.value : deck.battlefields[j] ?? BLANK_BATTLEFIELD)) })}>
              <option value={BLANK_BATTLEFIELD}>Blank battlefield</option>
              {fields.map((d) => <option key={d} value={d}>{findCard(d)!.name}</option>)}
            </select>
          </label>
        ))}
        <p className="lm-runes">Runes: {deck.runes.map((r) => `${r.n} ${findCard(r.def)?.name ?? r.def}`).join(', ') || 'pick your domains'}</p>
        <ul className="lm-list">
          {deck.main.map((e) => (
            <li key={e.def}><button type="button" onClick={() => remove(e.def)} title="Take one out">
              <span>{e.n}×</span> {findCard(e.def)?.name}<em>{findCard(e.def)?.cost?.energy ?? ''}</em>
            </button></li>
          ))}
        </ul>
        {issues.length > 0 && <ul className="lm-issues">{issues.map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
        <button type="button" className="btn btn--cta" disabled={issues.length > 0} onClick={onPlay}>Play</button>
      </aside>
    </div>
  );
}
