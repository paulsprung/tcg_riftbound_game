import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createTilt } from '../card/tilt.ts';
import { imageAt } from '../data/useCardDb.ts';
import type { Card, SetInfo } from '../data/types.ts';
import type { SetStyle } from './packConfig.ts';

const TEAR_LINE = 0.16;    // fraction of the pack's height
const PULL_FULL = 120;     // px of sideways drag that rips it

/** The champion art on the wrapper: their showiest printing in the set. */
export function heroCard(cards: Card[], style: SetStyle): Card | undefined {
  if (!style.hero) return undefined;
  const hero = style.hero.toLowerCase();
  // "Vi" must not match "Viktor": the name is the champion, then a comma.
  const theirs = cards.filter((c) => {
    const n = c.name.toLowerCase();
    return (n === hero || n.startsWith(`${hero},`) || n.startsWith(`${hero} `)) && c.orientation === 'portrait';
  });
  const rank = (c: Card) => ({ overnumbered: 0, 'alt-art': 1, signature: 2, base: 3, promo: 4 })[c.variant];
  return theirs.sort((a, b) => rank(a) - rank(b))[0];
}

function jagged(seed: number) {
  const n = 30;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const edge = i === 0 || i === n;
    const j = edge ? 0 : Math.sin(i * 2.17 + seed) * 0.9 + Math.sin(i * 5.3 + seed * 3) * 0.7;
    pts.push([(i / n) * 100, TEAR_LINE * 100 + j]);
  }
  const fmt = (p: [number, number]) => `${p[0].toFixed(2)}% ${p[1].toFixed(2)}%`;
  return {
    top: `polygon(0% 0%, 100% 0%, ${[...pts].reverse().map(fmt).join(', ')})`,
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

function Art({ set, style, hero }: Pick<Props, 'set' | 'style' | 'hero'>) {
  return (
    <div className="pk__art">
      {hero && <div className="pk__hero" style={{ backgroundImage: `url("${imageAt(hero, 500)}")` }} />}
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
  const clips = useMemo(() => jagged(set.id.length * 1.7), [set.id]);

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
    '--c1': style.wrapper[0], '--c2': style.wrapper[1], '--c3': style.wrapper[2],
    '--clip-top': clips.top, '--clip-bottom': clips.bottom,
  } as CSSProperties;

  return (
    <div
      ref={scene}
      className={`pk${torn ? ' is-torn' : ''}${onTear ? ' is-tearable' : ''}`}
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
        <div className="pk__piece pk__piece--top"><Art set={set} style={style} hero={hero} /></div>
        <div className="pk__piece pk__piece--bottom"><Art set={set} style={style} hero={hero} /></div>
      </div>
    </div>
  );
}
