import { useViewport } from '../lobby/scale.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CardBack } from '../card/CardBack.tsx';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, gradedCounts, useCollection } from '../collection/store.ts';
import { RARITY_COLOR, RARITY_ORDER, VARIANT_LABEL } from '../data/cardInfo.ts';
import type { Card, SetInfo } from '../data/types.ts';
import { cardImageReady } from '../data/images.ts';
import { openPack, type Pull } from './generate.ts';
import type { PackConfig, SetStyle } from './packConfig.ts';
import { heroCard, PackWrapper } from './PackWrapper.tsx';
import { fromPending, readPending, savePending, toPending } from './pending.ts';
import './pack.css';

type Phase = 'sealed' | 'tearing' | 'reveal' | 'done';

// One image width for the stage, the strip and the summary, so each card
// downloads once.
const ART_W = 600;
// A flipped card can't be skipped by a quick second tap until it has
// turned (and a hit has had a moment on screen).
const FLIP_LOCK = 650;
const HIT_LOCK = 950;
// Never wait longer than this for the art before flipping anyway.
const ART_WAIT = 6000;

function pullLabel(p: Pull): string {
  switch (p.hype) {
    case 5: return 'Ultimate rare';
    case 4: return 'Signature';
    case 3: return VARIANT_LABEL[p.card.variant];
    case 2: return 'Epic';
    case 1: return 'Rare';
  }
  if (/rune/i.test(p.card.type)) return p.foil ? 'Foil rune' : 'Rune';
  if (/token/i.test(p.card.type) || p.card.supertype === 'Token') return 'Token';
  return `${p.foil ? 'Foil ' : ''}${p.card.rarity}`;
}

function hypeColor(p: Pull): string {
  if (p.hype >= 4) return '#ffd36b';
  if (p.hype === 3) return RARITY_COLOR.showcase;
  return RARITY_COLOR[p.card.rarity];
}

function useVirtualViewport() {
  const v = useViewport();
  return { w: v.w, h: v.h };
}

/** Copies of these cards owned now, raw and graded. */
function ownedNow(ids: string[]): Record<string, number> {
  const state = collection.get();
  const graded = gradedCounts(state);
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (state.cards[id]?.normal ?? 0) + (state.cards[id]?.foil ?? 0) + (graded[id] ?? 0);
  return out;
}

/** iOS asks before a page may read the phone's tilt. Ask on the tear (a
    tap), not in the middle of the reveal. */
function askMotion() {
  const DOE = (window as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  DOE?.requestPermission?.().catch(() => undefined);
}

interface Props {
  set: SetInfo;
  cards: Card[];
  /** A booster's slots; or `deal` for any other pack (the shop's special packs). */
  pack?: PackConfig;
  deal?: () => Pull[];
  style: SetStyle;
  onInspect: (t: InspectTarget) => void;
  onExit: () => void;
}

export function PackOpening({ set, cards, pack, deal: dealPack, style, onInspect, onExit }: Props) {
  const hero = useMemo(() => heroCard(cards, style), [cards, style]);
  const deal = () => (dealPack ? dealPack() : openPack(cards, pack!));
  // A pack left mid-reveal picks up where it stopped.
  const [resumed] = useState(() => {
    const p = readPending();
    const pulls = p && p.setId === set.id ? fromPending(p, cards) : null;
    return pulls && p ? { pulls, index: Math.min(p.index, pulls.length - 1), before: p.before } : null;
  });
  const [pulls, setPulls] = useState<Pull[]>(() => resumed?.pulls ?? deal());
  const [phase, setPhase] = useState<Phase>(resumed ? 'reveal' : 'sealed');
  const [index, setIndex] = useState(resumed?.index ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [wantFlip, setWantFlip] = useState(false);
  const [ready, setReady] = useState<Set<string>>(() => new Set());
  const before = useRef<Record<string, number>>(resumed?.before ?? {});
  const flippedAt = useRef(0);
  const { w, h } = useVirtualViewport();

  // Opening a set from further down the shelf should start at the top.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Fetch and decode this pack's art while it is still sealed.
  useEffect(() => {
    let alive = true;
    for (const p of pulls) {
      cardImageReady(p.card, ART_W).then((ok) => {
        if (alive && ok) setReady((r) => (r.has(p.card.id) ? r : new Set(r).add(p.card.id)));
      });
    }
    return () => { alive = false; };
  }, [pulls]);

  const stageW = Math.round(Math.min(w * 0.62, 300, (h - 260) * (744 / 1039)));
  const packW = Math.round(Math.min(w * 0.6, 290, (h - 220) * 0.58));

  const opening = useRef(false);
  const tear = useCallback(() => {
    if (phase !== 'sealed' || opening.current) return;
    opening.current = true;
    askMotion();
    // the pack comes out of the inventory (bought in the shop, or a starter's);
    // signed in, the server deals its cards
    void collection.openPack(set.id, () => pulls, cards).then((got) => {
      opening.current = false;
      if (!got) return;
      setPulls(got);
      // into the collection straight away, so closing the tab mid-reveal never
      // loses a pull; what was owned before is what is owned now, less the pack
      const now = ownedNow(got.map((p) => p.card.id));
      for (const p of got) now[p.card.id] -= 1;
      before.current = now;
      savePending(toPending(set.id, got, 0, before.current));
      setPhase('tearing');
      window.setTimeout(() => setPhase('reveal'), 950);
    });
  }, [phase, pulls, cards, set.id]);

  const current = pulls[index];
  const currentReady = !!current && ready.has(current.card.id);
  // A battlefield is printed sideways; once turned over it lies down so it
  // can be read, as wide as fits.
  const landscape = current?.card.orientation === 'landscape';
  const landscapeScale = Math.min(1, (w - 32) / (stageW * (1039 / 744))).toFixed(3);

  const flip = useCallback(() => {
    flippedAt.current = performance.now();
    setWantFlip(false);
    setFlipped(true);
  }, []);

  // A flip asked for before the art arrived happens once it has (or after
  // a while regardless, with the card's name on its face).
  useEffect(() => {
    if (!wantFlip) return;
    if (currentReady) { flip(); return; }
    const t = window.setTimeout(flip, ART_WAIT);
    return () => window.clearTimeout(t);
  }, [wantFlip, currentReady, flip]);

  const finish = useCallback(() => {
    setFlipped(false);
    setPhase('done');
    savePending(null);
  }, []);

  const advance = useCallback(() => {
    if (phase !== 'reveal' || !current) return;
    if (!flipped) {
      if (currentReady) flip(); else setWantFlip(true);
      return;
    }
    if (performance.now() - flippedAt.current < (current.hype >= 1 ? HIT_LOCK : FLIP_LOCK)) return;
    setFlipped(false);
    if (index + 1 >= pulls.length) { finish(); return; }
    setIndex(index + 1);
    savePending(toPending(set.id, pulls, index + 1, before.current));
  }, [phase, current, currentReady, flipped, flip, finish, index, pulls, set.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a focused button already did its own thing; the inspector has the keys
      if (e.defaultPrevented || document.querySelector('.inspector')) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') {
        if (phase === 'sealed') { e.preventDefault(); tear(); }
        else if (phase === 'reveal') { e.preventDefault(); advance(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, tear, advance]);

  const left = useCollection().packs[set.id] ?? 0;
  const another = () => {
    if (left < 1) return;
    window.scrollTo(0, 0);
    savePending(null);
    setPulls(deal());
    setIndex(0);
    setFlipped(false);
    setWantFlip(false);
    setPhase('sealed');
  };

  // NEW: none owned before this pack and not earlier in it; else how many now.
  const owned = useMemo(() => {
    const seen = new Map<string, number>();
    return pulls.map((p) => {
      const n = (seen.get(p.card.id) ?? 0) + 1;
      seen.set(p.card.id, n);
      const had = before.current[p.card.id] ?? 0;
      return { isNew: had === 0 && n === 1, total: had + pulls.filter((q) => q.card.id === p.card.id).length };
    });
    // before.current is set in tear(), which also moves the phase on
  }, [pulls, phase]);

  // the strip fills as cards are put down; the summary leads with the hits
  const strip = pulls.slice(0, index).map((p, i) => ({ p, i }));
  const summary = useMemo(() => pulls.map((p, i) => ({ p, i })).sort((a, b) =>
    b.p.hype - a.p.hype ||
    RARITY_ORDER.indexOf(b.p.card.rarity) - RARITY_ORDER.indexOf(a.p.card.rarity) ||
    a.i - b.i), [pulls]);
  const top = summary[0]?.p;
  const fresh = owned.filter((o) => o.isNew).length;

  const badge = (i: number) => owned[i]?.isNew
    ? <span className="pull-tag pull-tag--new">New</span>
    : <span className="pull-tag">×{owned[i]?.total}</span>;

  return (
    <section className="opening" data-phase={phase}>
      <div className="opening__bar">
        <button type="button" className="btn btn--ghost" onClick={onExit} aria-label="All sets">
          ← <span className="opening__back-label">All sets</span>
        </button>
        <h2 className="opening__title">{set.name}</h2>
        {phase === 'reveal' && (
          <button type="button" className="btn btn--ghost" onClick={finish}>
            Reveal all
          </button>
        )}
        {phase !== 'reveal' && <span />}
      </div>

      {(phase === 'sealed' || phase === 'tearing') && (
        <div className="opening__stage">
          <div className="tear-wrap">
            {/* the cards, waiting inside: they come into view as the wrapper drops */}
            {phase === 'tearing' && (
              <div className="tear-stack" style={{ width: stageW }} aria-hidden>
                <CardBack rune={/rune/i.test(pulls[0]?.card.type ?? '')} />
              </div>
            )}
            <PackWrapper set={set} style={style} hero={hero} width={packW} tilt="idle"
              torn={phase === 'tearing'} onTear={tear} />
          </div>
          <p className={`hint${phase === 'tearing' ? ' is-gone' : ''}`}>
            {left > 0 || phase === 'tearing' ? 'Swipe across the pack to tear it open, or tap' : <>No packs of this set left. <a href="#shop">Buy one in the shop</a></>}
          </p>
        </div>
      )}

      {phase === 'reveal' && current && (
        <div className="opening__stage opening__stage--reveal" onClick={advance}
          aria-label={flipped ? 'Next card' : 'Flip the card'}>
          <div className="stack" style={{ width: stageW }}>
            {pulls.slice(index + 1, index + 4).map((p, i) => (
              <div key={p.card.id + i} className="stack__under" style={{ '--i': i + 1 } as CSSProperties}>
                <CardBack rune={/rune/i.test(p.card.type)} />
              </div>
            ))}
            <div key={index}
              className={`stack__top${flipped ? ' is-flipped' : ''}${index === 0 && !resumed ? ' is-first' : ''}${landscape ? ' is-landscape' : ''}`}
              style={{ '--ls': landscapeScale } as CSSProperties}>
              <HoloCard card={current.card} finish={current.finish} width={stageW} tilt="idle" gyro
                faceDown={!flipped} imageWidth={ART_W} gl />
              {wantFlip && !flipped && <span className="stack__wait" aria-label="Loading the card" />}
            </div>
          </div>
          <div className="reveal-caption" aria-live="polite">
            {flipped ? (
              <span className="reveal-caption__in" key={index}>
                <strong style={{ color: hypeColor(current) }}>{pullLabel(current)}</strong>
                <span>{current.card.name}</span>
                {badge(index)}
              </span>
            ) : (
              <span className="muted">Card {index + 1} of {pulls.length} · tap to flip</span>
            )}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="summary">
          <p className="summary__lead">
            {top && top.hype >= 1 ? <><b style={{ color: hypeColor(top) }}>{pullLabel(top)}:</b> {top.card.name}</> : 'Pack opened.'}
          </p>
          <p className="muted summary__sub">
            {fresh} new · {pulls.length - fresh} {pulls.length - fresh === 1 ? 'duplicate' : 'duplicates'} · all {pulls.length} cards are in your collection
          </p>
          <div className="summary__actions">
            <button type="button" className="btn btn--primary" onClick={another} disabled={left < 1}>
              {left > 0 ? `Open another (${left} left)` : 'No packs left'}
            </button>
            {left < 1 && <a className="btn btn--ghost" href="#shop">Buy packs</a>}
            <a className="btn btn--ghost" href="#collection">View collection</a>
          </div>
        </div>
      )}

      {phase === 'reveal' && strip.length > 0 && (
        <div className="pulled">
          {strip.map(({ p, i }) => (
            <div key={`${p.card.id}-${i}`} className="pulled__item">
              <HoloCard card={p.card} finish={p.finish} width="100%" imageWidth={ART_W}
                onClick={() => onInspect({ card: p.card, finish: p.finish })} />
              {p.hype > 0 && <span className="pulled__dot" style={{ background: hypeColor(p) }} title={pullLabel(p)} />}
            </div>
          ))}
        </div>
      )}

      {phase === 'done' && (
        <div className="pulled pulled--grid">
          {summary.map(({ p, i }, n) => (
            <div key={`${p.card.id}-${i}`} className="pulled__item" style={{ '--d': `${n * 40}ms` } as CSSProperties}>
              <HoloCard card={p.card} finish={p.finish} width="100%" imageWidth={ART_W}
                onClick={() => onInspect({ card: p.card, finish: p.finish })} />
              <div className="pulled__meta">
                {p.hype > 0 && <span className="pull-tag pull-tag--hit" style={{ '--tag': hypeColor(p) } as CSSProperties}>{pullLabel(p)}</span>}
                {p.foil && p.hype === 0 && <span className="pull-tag pull-tag--foil">Foil</span>}
                {badge(i)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
