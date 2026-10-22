import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { useEffects } from '../card/effects.ts';
import { createTilt } from '../card/tilt.ts';
import { TiltFeed, type TiltListener } from '../card/tiltFeed.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card } from '../data/types.ts';
import { descriptor, GRADER, type Slab as SlabData } from './grading.ts';
import { useLabelStyle } from './labelStyle.ts';
import './slab.css';

interface Props {
  slab: SlabData;
  card: Card;
  /** Rendered width of the whole slab: px or any CSS length. */
  width: number | string;
  tilt?: 'hover' | 'idle' | 'off';
  gyro?: boolean;
  /** Draw the card's foil with WebGL (big views only). */
  gl?: boolean;
  /** Give the case visible thickness (for the big inspect view). */
  thick?: boolean;
  imageWidth?: number;
  /** Show only the card, the case not yet closed around it. */
  open?: boolean;
  /** Drawn over the card (the grader's scanner). */
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

// as printed on a label, where space is short
const VARIANT_SHORT: Partial<Record<Card['variant'], string>> = {
  'alt-art': 'Alt Art', overnumbered: 'Overnumbered', signature: 'Signature',
};

// Where the card sits in the case, as fractions of the case (see slab.css).
const WELL = { left: 0.115, width: 0.77, top: 0.295, height: 0.65 };

/** Bars for the cert number: decorative, but each number gets its own. */
function Barcode({ cert }: { cert: string }) {
  const bars = useMemo(() => {
    const out: { x: number; w: number }[] = [];
    let x = 0;
    const digits = `9${cert}0`.split('').map(Number);
    for (const d of digits) {
      for (let i = 0; i < 4; i++) {
        const bit = (d >> (i % 3)) & 1;
        const w = bit ? 2 : 1;
        if (i % 2 === 0) out.push({ x, w });
        x += w + 1;
      }
    }
    return { out, x };
  }, [cert]);
  return (
    <svg className="slab__barcode" viewBox={`0 0 ${bars.x} 10`} preserveAspectRatio="none" aria-hidden>
      {bars.out.map((b, i) => <rect key={i} x={b.x} y="0" width={b.w} height="10" />)}
    </svg>
  );
}

/**
 * A graded card in its case: the label on top (grade, card, cert number),
 * the card sealed underneath. The whole case tilts, and the card's foil
 * follows it.
 */
export function Slab({
  slab, card, width, tilt = 'hover', gyro = false, gl = false, thick = false, imageWidth,
  open = false, children, onClick, className = '', style,
}: Props) {
  const scene = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const feed = useMemo(() => new Set<TiltListener>(), []);
  const labelStyle = useLabelStyle();
  const still = useEffects() === 'off';

  useEffect(() => {
    if (tilt === 'off' || still || !scene.current) return;
    const t = createTilt(scene.current, {
      idle: tilt === 'idle',
      gyro,
      hoverScale: 1.03,
      onFrame: (s) => {
        // the pointer over the case, re-measured over the card in it
        const px = ((s.px / 100 - WELL.left) / WELL.width) * 100;
        const py = ((s.py / 100 - WELL.top) / WELL.height) * 100;
        const pfc = Math.min(1, Math.hypot((px - 50) / 50, (py - 50) / 50));
        const w = well.current;
        if (w) {
          w.style.setProperty('--px', px.toFixed(1));
          w.style.setProperty('--py', py.toFixed(1));
          w.style.setProperty('--bgx', (37 + px * 0.26).toFixed(1));
          w.style.setProperty('--bgy', (33 + py * 0.34).toFixed(1));
          w.style.setProperty('--pfc', pfc.toFixed(2));
        }
        const local = { ...s, px, py, pfc };
        feed.forEach((l) => l(local));
      },
    });
    return () => t.destroy();
  }, [tilt, gyro, feed, still]);

  const finish = defaultFinish(card, slab.foil);
  const extras = [
    VARIANT_SHORT[card.variant] ?? null,
    slab.foil && finish === 'foil' ? 'Foil' : null,
  ].filter(Boolean);

  return (
    <div
      ref={scene}
      className={`slab ${className}`}
      data-tilt={tilt}
      data-thick={thick ? '' : undefined}
      data-label={labelStyle}
      data-pristine={slab.pristine ? '' : undefined}
      data-open={open ? '' : undefined}
      data-grade={slab.grade}
      style={{ width, ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-label={`${card.name}, graded ${descriptor(slab)} ${slab.grade}`}
    >
      <div className="slab__shadow" />
      <div className="slab__body">
        <div className="slab__case">
          <div className="slab__label">
            <span className="slab__holo" data-mark={GRADER.short} aria-hidden />
            <div className="slab__lines">
              <span className="slab__brand">{GRADER.name}</span>
              <span className="slab__name">{card.name}</span>
              <span className="slab__set">Riftbound · {card.setName}</span>
              <span className="slab__code">#{card.code}{extras.length > 0 && <> · {extras.join(' · ')}</>}</span>
            </div>
            <div className="slab__grade">
              <span className="slab__desc">{descriptor(slab)}</span>
              <span className="slab__num">{slab.grade}</span>
            </div>
            <div className="slab__cert">
              <Barcode cert={slab.cert} />
              <span>{slab.cert}</span>
            </div>
          </div>
          <div className="slab__ridge" aria-hidden />
          <div ref={well} className="slab__well">
            <TiltFeed.Provider value={feed}>
              <HoloCard card={card} finish={finish} width="100%" tilt="parent" gl={gl} imageWidth={imageWidth} />
            </TiltFeed.Provider>
            {children}
          </div>
          <span className="slab__gloss" aria-hidden />
        </div>
        {thick && (
          <>
            <span className="slab__edge slab__edge--top" />
            <span className="slab__edge slab__edge--bottom" />
            <span className="slab__edge slab__edge--left" />
            <span className="slab__edge slab__edge--right" />
          </>
        )}
      </div>
    </div>
  );
}
