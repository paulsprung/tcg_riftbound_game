import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection } from '../collection/store.ts';
import { RARITY_COLOR, VARIANT_LABEL } from '../data/cardInfo.ts';
import type { Card, SetInfo } from '../data/types.ts';
import { openPack, type Pull } from './generate.ts';
import type { PackConfig, SetStyle } from './packConfig.ts';
import { heroCard, PackWrapper } from './PackWrapper.tsx';
import './pack.css';

type Phase = 'sealed' | 'tearing' | 'reveal' | 'done';

function pullLabel(p: Pull): string {
  switch (p.hype) {
    case 5: return 'Ultimate rare';
    case 4: return 'Signature';
    case 3: return VARIANT_LABEL[p.card.variant];
    case 2: return 'Epic';
    case 1: return 'Rare';
    default: return `${p.foil ? 'Foil ' : ''}${p.card.rarity}`;
  }
}

function hypeColor(p: Pull): string {
  if (p.hype >= 4) return '#ffd36b';
  if (p.hype === 3) return RARITY_COLOR.showcase;
  return RARITY_COLOR[p.card.rarity];
}

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

interface Props {
  set: SetInfo;
  cards: Card[];
  pack: PackConfig;
  style: SetStyle;
  onInspect: (t: InspectTarget) => void;
  onExit: () => void;
}

export function PackOpening({ set, cards, pack, style, onInspect, onExit }: Props) {
  const hero = useMemo(() => heroCard(cards, style), [cards, style]);
  const [pulls, setPulls] = useState<Pull[]>(() => openPack(cards, pack));
  const [phase, setPhase] = useState<Phase>('sealed');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const { w, h } = useViewport();

  const stageW = Math.round(Math.min(w * 0.62, 300, (h - 260) * (744 / 1039)));
  const packW = Math.round(Math.min(w * 0.6, 290, (h - 220) * 0.58));

  const tear = useCallback(() => {
    if (phase !== 'sealed') return;
    setPhase('tearing');
    // Into the collection straight away, so closing the tab mid-reveal
    // never loses a pull.
    collection.addPack(set.id, pulls);
    window.setTimeout(() => setPhase('reveal'), 950);
  }, [phase, pulls, set.id]);

  const current = pulls[index];

  const advance = useCallback(() => {
    if (phase !== 'reveal' || !current) return;
    if (!flipped) { setFlipped(true); return; }
    setFlipped(false);
    if (index + 1 >= pulls.length) setPhase('done');
    else setIndex(index + 1);
  }, [phase, current, flipped, index, pulls.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') {
        if (phase === 'sealed') { e.preventDefault(); tear(); }
        else if (phase === 'reveal') { e.preventDefault(); advance(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, tear, advance]);

  const another = () => {
    setPulls(openPack(cards, pack));
    setIndex(0);
    setFlipped(false);
    setPhase('sealed');
  };

  const revealed = phase === 'done' ? pulls : pulls.slice(0, index + (flipped ? 1 : 0));
  const best = pulls.reduce((m, p) => Math.max(m, p.hype), 0);

  return (
    <section className="opening" data-phase={phase}>
      <div className="opening__bar">
        <button type="button" className="btn btn--ghost" onClick={onExit}>← All sets</button>
        <h2 className="opening__title">{set.name}</h2>
        {phase === 'reveal' && (
          <button type="button" className="btn btn--ghost" onClick={() => { setFlipped(false); setPhase('done'); }}>
            Reveal all
          </button>
        )}
        {phase !== 'reveal' && <span />}
      </div>

      {(phase === 'sealed' || phase === 'tearing') && (
        <div className="opening__stage">
          <div className={`flash${phase === 'tearing' ? ' is-on' : ''}`} />
          <PackWrapper set={set} style={style} hero={hero} width={packW} tilt="idle"
            torn={phase === 'tearing'} onTear={tear} />
          <p className="hint">Swipe across the pack to tear it open, or tap</p>
        </div>
      )}

      {phase === 'reveal' && current && (
        <div className="opening__stage">
          <div className="stack" style={{ width: stageW }}>
            {pulls.slice(index + 1, index + 4).map((p, i) => (
              <div key={p.card.id + i} className="stack__under" style={{ '--i': i + 1 } as CSSProperties} />
            ))}
            <div
              key={index}
              className={`stack__top${flipped ? ' is-flipped' : ''}${!flipped && current.hype >= 2 ? ' is-charged' : ''}`}
              data-hype={current.hype}
              style={{ '--burst': hypeColor(current) } as CSSProperties}
            >
              {flipped && current.hype > 0 && <div className="burst" aria-hidden />}
              <HoloCard card={current.card} finish={current.finish} width={stageW} tilt="idle" gyro
                faceDown={!flipped} onClick={advance} imageWidth={600} />
            </div>
          </div>
          <div className="reveal-caption" aria-live="polite">
            {flipped ? (
              <>
                <strong style={{ color: hypeColor(current) }}>{pullLabel(current)}</strong>
                <span>{current.card.name}</span>
              </>
            ) : (
              <span className="muted">Card {index + 1} of {pulls.length} · tap to flip</span>
            )}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="summary">
          <p className="summary__lead">
            {best >= 3 ? 'What a pull!' : best === 2 ? 'An epic in the pack.' : 'Pack opened.'}{' '}
            <span className="muted">All {pulls.length} cards are in your collection.</span>
          </p>
          <div className="summary__actions">
            <button type="button" className="btn btn--primary" onClick={another}>Open another</button>
            <a className="btn btn--ghost" href="#collection">View collection</a>
          </div>
        </div>
      )}

      {revealed.length > 0 && (
        <div className={`pulled${phase === 'done' ? ' pulled--grid' : ''}`}>
          {revealed.map((p, i) => (
            <div key={`${p.card.id}-${i}`} className="pulled__item" style={{ '--d': `${phase === 'done' ? i * 40 : 0}ms` } as CSSProperties}>
              <HoloCard card={p.card} finish={p.finish} width="100%" imageWidth={360}
                onClick={() => onInspect({ card: p.card, finish: p.finish })} />
              {p.hype > 0 && <span className="pulled__dot" style={{ background: hypeColor(p) }} title={p.slot} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
