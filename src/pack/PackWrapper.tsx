import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createTilt } from '../card/tilt.ts';
import { useCardImage } from '../data/images.ts';
import { packArt, type PackArt } from '../data/media.ts';
import type { Card, SetInfo } from '../data/types.ts';
import type { SetStyle } from './packConfig.ts';

export { heroCard } from './hero.ts';

const TEAR_LINE = 0.16;    // drawn wrappers: fraction of the pack's height
const PULL_FULL = 120;     // px of sideways drag that rips it

function jagged(seed: number, tear = TEAR_LINE) {
  const n = 30;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const edge = i === 0 || i === n;
    const j = edge ? 0 : Math.sin(i * 2.17 + seed) * 0.9 + Math.sin(i * 5.3 + seed * 3) * 0.7;
    pts.push([(i / n) * 100, tear * 100 + j]);
  }
  const fmt = (p: [number, number]) => `${p[0].toFixed(2)}% ${p[1].toFixed(2)}%`;
  // The top piece reaches a little past the line and sits above the bottom
  // one, so the two halves overlap and no seam shows before it is torn.
  const lower = (p: [number, number]): [number, number] => [p[0], p[1] + 0.8];
  return {
    top: `polygon(0% 0%, 100% 0%, ${[...pts].reverse().map(lower).map(fmt).join(', ')})`,
    bottom: `polygon(${pts.map(fmt).join(', ')}, 100% 100%, 0% 100%)`,
  };
}

interface Props {
  set: SetInfo;
  style: SetStyle;
  hero?: Card;
  width: number;
  /** Opened: the top tears off and the wrapper drops away. */
  torn?: boolean;
  /** Interactive: drag or tap to tear. */
  onTear?: () => void;
  onClick?: () => void;
  tilt?: 'idle' | 'hover';
}

function Hero({ card }: { card: Card }) {
  const { src } = useCardImage(card, 500);
  return src ? <div className="pk__hero" style={{ backgroundImage: `url("${src}")` }} /> : null;
}

/** The real wrapper: Riot's product shot of the sealed pack. The foil
    sheen is masked to the pack's own outline so it never spills onto the
    transparent background around it. */
function RealArt({ art }: { art: PackArt }) {
  const mask = { WebkitMaskImage: `url("${art.src}")`, maskImage: `url("${art.src}")` } as CSSProperties;
  return (
    <div className="pk__art pk__art--real">
      <img className="pk__img" src={art.src} alt="" draggable={false} />
      <div className="pk__gloss pk__gloss--masked" style={mask} />
    </div>
  );
}

/** Drawn stand-in for sets without a product shot. */
function Art({ set, style, hero }: Pick<Props, 'set' | 'style' | 'hero'>) {
  return (
    <div className="pk__art">
      {hero && <Hero card={hero} />}
      <div className="pk__wash" />
      <div className="pk__gloss" />
      <div className="pk__crimp pk__crimp--top" />
      <div className="pk__crimp pk__crimp--bottom" />
      <div className="pk__title">
        <span className="pk__logo">Riftbound</span>
        <span className="pk__set">{set.name}</span>
      </div>
      <div className="pk__meta">
        <span>{style.tagline}</span>
        <span>Booster · 14 cards</span>
      </div>
    </div>
  );
}

export function PackWrapper({ set, style, hero, width, torn = false, onTear, onClick, tilt = 'hover' }: Props) {
  const scene = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; done: boolean } | null>(null);
  const art = packArt(set.id);
  const clips = useMemo(() => jagged(set.id.length * 1.7, art?.tear), [set.id, art?.tear]);

  useEffect(() => {
    if (!scene.current) return;
    const t = createTilt(scene.current, { idle: tilt === 'idle', hoverScale: 1.03 });
    return () => t.destroy();
  }, [tilt]);

  const setPull = (v: number) => scene.current?.style.setProperty('--pull', v.toFixed(3));

  const down = (e: RPointerEvent) => {
    if (!onTear || torn) return;
    drag.current = { x: e.clientX, done: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d || d.done) return;
    const p = Math.min(1, Math.abs(e.clientX - d.x) / PULL_FULL);
    setPull(p);
    if (p >= 1) { d.done = true; onTear?.(); }
  };
  const up = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.done) return;
    setPull(0);
    if (Math.abs(e.clientX - d.x) < 8) onTear?.();   // a tap tears it too
  };

  const vars = {
    width,
    ...(art ? { aspectRatio: String(art.aspect) } : {}),
    '--c1': style.wrapper[0], '--c2': style.wrapper[1], '--c3': style.wrapper[2],
    '--clip-top': clips.top, '--clip-bottom': clips.bottom,
  } as CSSProperties;

  return (
    <div
      ref={scene}
      className={`pk${art ? ' pk--real' : ''}${torn ? ' is-torn' : ''}${onTear ? ' is-tearable' : ''}`}
      style={vars}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => { drag.current = null; setPull(0); }}
      onClick={onClick}
      role={onTear || onClick ? 'button' : undefined}
      tabIndex={onTear || onClick ? 0 : undefined}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (onTear ?? onClick)?.(); } }}
      aria-label={onTear ? `Tear open the ${set.name} pack` : `${set.name} booster pack`}
    >
      <div className="pk__shadow" />
      <div className="pk__body">
        {art ? (
          <>
            <div className="pk__piece pk__piece--top"><RealArt art={art} /></div>
            <div className="pk__piece pk__piece--bottom"><RealArt art={art} /></div>
          </>
        ) : (
          <>
            <div className="pk__piece pk__piece--top"><Art set={set} style={style} hero={hero} /></div>
            <div className="pk__piece pk__piece--bottom"><Art set={set} style={style} hero={hero} /></div>
          </>
        )}
      </div>
    </div>
  );
}
