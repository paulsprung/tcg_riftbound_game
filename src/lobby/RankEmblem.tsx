import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TIERS, type Tier } from '../economy/ranks.ts';

/*
 * A rank as a crest: a heraldic shield with a helm's visor and a gem on
 * its brow, in the tier's metal, lit as metal (an SVG lighting filter, not
 * flat colour). The tier sets the shield's cut, the metal and the gem; the
 * division sets the armour around it, as the old ranked helms did: V is
 * the bare shield, IV adds the crest on top, III the side guards, II the
 * spikes below, I the wings. The top tier wears all of it and a halo.
 *
 * Each piece of armour is a group of its own, so a rank change can move
 * them (RankUp.tsx): `enter` pieces fly in and lock, `leave` pieces fall
 * away, `burst` sends all of them flying. For that the crest is `layered`:
 * each piece is drawn once, off screen, into a picture of its own (and a
 * white one of its outline, for the flashes), and the pictures are what
 * move: the lighting never runs while it animates, and the animations
 * touch only transform and opacity, which the compositor plays alone.
 */

export type Piece = 'shield' | 'crest' | 'guards' | 'spikes' | 'wings' | 'halo';
export const PIECE_ORDER: Piece[] = ['shield', 'crest', 'guards', 'spikes', 'wings', 'halo'];

interface Look { base: string; hi: string; dark: string; glow: string; gem: string; cut: Cut; scale: number }
type Cut = 'heater' | 'notched' | 'kite' | 'hex' | 'grand';
const LOOK: Record<Tier, Look> = {
  Initiate: { base: '#5d5752', hi: '#b3aaa0', dark: '#221e1c', glow: '#cfc6ba', gem: '#9b948c', cut: 'heater', scale: 0.92 },
  Adept: { base: '#8e5130', hi: '#f0b183', dark: '#331709', glow: '#ff9e5c', gem: '#e0773a', cut: 'notched', scale: 0.95 },
  Vanguard: { base: '#7c8897', hi: '#f2f6fb', dark: '#262d36', glow: '#bcd8ff', gem: '#8fb8ff', cut: 'heater', scale: 0.98 },
  Sentinel: { base: '#a97b22', hi: '#ffe9a8', dark: '#3d2805', glow: '#ffd25e', gem: '#ffb92e', cut: 'notched', scale: 1 },
  Warden: { base: '#2f7f7a', hi: '#b3fbf2', dark: '#0b2f2d', glow: '#3ff2e0', gem: '#2fe0cf', cut: 'hex', scale: 1.02 },
  Ascendant: { base: '#257a4b', hi: '#b5f9cf', dark: '#082e1a', glow: '#4dff98', gem: '#2bef7e', cut: 'kite', scale: 1.04 },
  Exalted: { base: '#5c48b3', hi: '#ddd2ff', dark: '#1c144a', glow: '#b49bff', gem: '#9d7cff', cut: 'kite', scale: 1.06 },
  Paragon: { base: '#b9873e', hi: '#fff0c8', dark: '#3e2408', glow: '#ff6b8f', gem: '#ff4572', cut: 'grand', scale: 1.08 },
};
const UNRANKED: Look = { base: '#3d424a', hi: '#8a919b', dark: '#15181c', glow: '#6c737d', gem: '#4c535c', cut: 'heater', scale: 0.92 };

const SHIELD: Record<Cut, string> = {
  heater: 'M120 44 L176 60 C179 112 170 160 120 206 C70 160 61 112 64 60 Z',
  notched: 'M120 48 L136 40 L178 56 C181 112 170 162 120 208 C70 162 59 112 62 56 L104 40 Z',
  kite: 'M120 36 L176 66 L168 148 L120 212 L72 148 L64 66 Z',
  hex: 'M120 38 L178 64 L178 146 L120 208 L62 146 L62 64 Z',
  grand: 'M120 30 C148 46 166 48 184 54 C188 118 172 168 120 214 C68 168 52 118 56 54 C74 48 92 46 120 30 Z',
};

/** The pieces a rank wears. */
export function piecesOf(tier: string | null, division: number | null | undefined): Piece[] {
  if (!tier || !(TIERS as readonly string[]).includes(tier)) return ['shield'];
  const d = tier === 'Paragon' ? 0 : division ?? 5;
  const out: Piece[] = ['shield'];
  if (d <= 4) out.push('crest');
  if (d <= 3) out.push('guards');
  if (d <= 2) out.push('spikes');
  if (d <= 1) out.push('wings');
  if (tier === 'Paragon') out.push('halo');
  return out;
}

const mirror = 'translate(240 0) scale(-1 1)';
/** Back to front. */
const DRAW_ORDER: Piece[] = ['halo', 'wings', 'spikes', 'guards', 'crest', 'shield'];

/** Where each piece sits in the crest's box (its viewBox), for it to turn and scale about itself as a layer. */
const ORIGIN: Record<Piece, string> = { shield: '50% 51%', crest: '50% 17%', guards: '50% 40%', spikes: '50% 87%', wings: '50% 31%', halo: '50% 51%' };

export function RankEmblem({ tier, division, size = 56, className, enter, leave, keep, burst, delay = 0, layered = false, onReady }: {
  tier: string | null; division?: number | null; size?: number; className?: string;
  /** Each piece a picture in a layer of its own (the ceremony), not one SVG. */
  layered?: boolean;
  /** Layered: called once its pictures are drawn and decoded. */
  onReady?: () => void;
  /** Pieces that fly in and lock, in order, from `delay` ms on. */
  enter?: Piece[];
  /** Pieces that fall away. */
  leave?: Piece[];
  /** Pieces it still wears, though its rank does not: the ones about to fall away, drawn before they do. */
  keep?: Piece[];
  /** Everything flies apart. */
  burst?: boolean;
  delay?: number;
}) {
  const id = useId().replace(/:/g, '');
  const known = (TIERS as readonly string[]).includes(tier ?? '') ? (tier as Tier) : null;
  const k = known ? LOOK[known] : UNRANKED;
  const wear = new Set([...piecesOf(known, division), ...(keep ?? []), ...(leave ?? [])]);
  const url = (n: string) => `url(#${n}${id})`;
  const lit = url('l');
  const anim = (p: Piece): { className: string; style?: CSSProperties } => {
    const i = enter?.indexOf(p) ?? -1;
    if (burst) return { className: `rc-p rc-burst rc-${p}`, style: { '--i': PIECE_ORDER.indexOf(p), '--delay': `${delay}ms` } as CSSProperties };
    if (i >= 0) return { className: `rc-p rc-enter rc-${p}`, style: { '--delay': `${delay + i * 420}ms` } as CSSProperties };
    if (leave?.includes(p)) return { className: `rc-p rc-leave rc-${p}`, style: { '--delay': `${delay}ms` } as CSSProperties };
    return { className: `rc-p rc-${p}` };
  };
  const metal = { fill: url('m'), stroke: k.dark, strokeWidth: 2.4, strokeLinejoin: 'round' as const };
  const edge = { fill: 'none', stroke: k.glow, strokeOpacity: known && LOOK[known].scale >= 1.02 ? 0.85 : 0.35, strokeWidth: 1.6 };
  const shield = SHIELD[k.cut];
  // the art of each piece it wears, back to front
  const art: Partial<Record<Piece, ReactNode>> = {
    halo: wear.has('halo') ? (<>
      <circle cx="120" cy="124" r="128" fill={url('h')} />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d="M120 124 L116 6 L124 6 Z" fill={k.glow} opacity="0.22" transform={`rotate(${i * 30 + 15} 120 124)`} />
      ))}
    </>) : undefined,
    wings: wear.has('wings') ? (<>
      <g filter={lit}>
        {[0, 1].map((side) => (
          <g key={side} transform={side ? mirror : undefined}>
            <path d="M66 84 C30 70 10 44 2 8 C30 30 50 44 78 60 Z" {...metal} />
            <path d="M62 108 C24 106 2 88 -8 62 C22 76 44 84 68 90 Z" {...metal} />
            <path d="M64 132 C32 138 12 128 -2 110 C24 116 44 116 66 114 Z" {...metal} />
            <path d="M66 84 C34 72 16 50 8 22" {...edge} />
          </g>
        ))}
      </g>
    </>) : undefined,
    spikes: wear.has('spikes') ? (<>
      <g filter={lit}>
        <path d="M120 200 L110 252 L120 244 L130 252 Z" {...metal} />
        {[0, 1].map((side) => (
          <g key={side} transform={side ? mirror : undefined}>
            <path d="M96 180 L76 238 L108 198 Z" {...metal} />
            <path d="M96 182 L80 230" {...edge} />
          </g>
        ))}
      </g>
    </>) : undefined,
    guards: wear.has('guards') ? (<>
      <g filter={lit}>
        {[0, 1].map((side) => (
          <g key={side} transform={side ? mirror : undefined}>
            <path d="M68 64 C40 66 22 88 22 124 C34 110 48 104 64 106 Z" {...metal} />
            <path d="M64 110 C42 112 28 132 30 160 C40 146 52 140 66 140 Z" {...metal} />
            <circle cx="52" cy="90" r="3.6" fill={k.hi} stroke={k.dark} strokeWidth="1.2" />
            <path d="M64 70 C42 74 28 94 26 116" {...edge} />
          </g>
        ))}
      </g>
    </>) : undefined,
    crest: wear.has('crest') ? (<>
      <g filter={lit}>
        {[0, 1].map((side) => (
          <path key={side} d="M104 50 L88 16 L114 42 Z" {...metal} transform={side ? mirror : undefined} />
        ))}
        <path d="M120 0 L138 40 L120 58 L102 40 Z" {...metal} />
      </g>
      <path d="M120 14 L128 36 L120 46 L112 36 Z" fill={url('g')} filter={url('gl')} />
    </>) : undefined,
    shield: wear.has('shield') ? (<>
      <g filter={lit}>
        <path d={shield} {...metal} strokeWidth="3" />
        <path d={shield} fill="none" stroke={k.hi} strokeOpacity="0.55" strokeWidth="1.5" transform="translate(120 124) scale(.9) translate(-120 -124)" />
        <path d={shield} fill={url('m')} stroke={k.dark} strokeWidth="2" transform="translate(120 128) scale(.76) translate(-120 -128)" />
      </g>
      {/* the visor: a deep opening under the brow ridge, the eye line glowing, the nose guard down the middle */}
      <path d="M74 118 C94 104 146 104 166 118 L160 146 C148 158 134 162 126 162 L126 188 L120 198 L114 188 L114 162 C106 162 92 158 80 146 Z"
        fill={url('v')} stroke={k.dark} strokeWidth="2" />
      <path d="M84 128 C100 122 112 126 117 136 M156 128 C140 122 128 126 123 136" fill="none" stroke={k.glow} strokeWidth="2.6" strokeLinecap="round" filter={url('gl')} />
      <g filter={lit}>
        <path d="M70 116 C92 98 148 98 170 116 L166 124 C146 110 94 110 74 124 Z" fill={url('m')} stroke={k.dark} strokeWidth="1.8" />
        <path d="M112 112 L128 112 L126 180 L120 190 L114 180 Z" fill={url('m')} stroke={k.dark} strokeWidth="1.6" />
        <path d="M88 150 L106 156 L104 168 L92 160 Z M152 150 L134 156 L136 168 L148 160 Z" fill={url('m')} stroke={k.dark} strokeWidth="1.2" />
        {[[90, 82], [150, 82]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.4" fill={k.hi} stroke={k.dark} strokeWidth="1.2" />)}
      </g>
      <g filter={url('gl')}>
        <path d="M120 74 L134 92 L120 108 L106 92 Z" fill={url('g')} stroke={k.hi} strokeWidth="1.4" />
        <path d="M120 74 L106 92 L120 92 Z" fill="#fff" opacity="0.45" />
      </g>
    </>) : undefined,
  };
  const scaled = (n: ReactNode) => <g transform={`translate(120 124) scale(${k.scale}) translate(-120 -124)`}>{n}</g>;
  const draw = (p: Piece) => (p === 'halo' ? art[p] : scaled(art[p]));
  const label = known ? `${known}${division ? ` ${['I', 'II', 'III', 'IV', 'V'][division - 1]}` : ''}` : 'Unranked';
  const defsNode = (
    <defs>
      <linearGradient id={`m${id}`} x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stopColor={k.hi} />
        <stop offset="0.28" stopColor={k.base} />
        <stop offset="0.5" stopColor={k.dark} />
        <stop offset="0.62" stopColor={k.hi} stopOpacity="0.9" />
        <stop offset="0.8" stopColor={k.base} />
        <stop offset="1" stopColor={k.dark} />
      </linearGradient>
      <linearGradient id={`v${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={k.dark} />
        <stop offset="1" stopColor="#020304" />
      </linearGradient>
      <radialGradient id={`g${id}`} cx="0.4" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.3" stopColor={k.glow} />
        <stop offset="0.75" stopColor={k.gem} />
        <stop offset="1" stopColor={k.dark} />
      </radialGradient>
      <radialGradient id={`h${id}`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.35" stopColor={k.glow} stopOpacity="0.5" />
        <stop offset="1" stopColor={k.glow} stopOpacity="0" />
      </radialGradient>
      {/* metal: the shape's alpha as a height map, lit from the top left */}
      <filter id={`l${id}`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="b" />
        <feSpecularLighting in="b" surfaceScale="5" specularConstant="1.05" specularExponent="18" lightingColor="#fff" result="s">
          <feDistantLight azimuth="235" elevation="38" />
        </feSpecularLighting>
        <feComposite in="s" in2="SourceAlpha" operator="in" result="s2" />
        <feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3="0.75" k4="0" result="lit" />
        <feDropShadow in="lit" dx="0" dy="4" stdDeviation="3.5" floodColor="#000" floodOpacity="0.65" />
      </filter>
      {/* the piece's outline in white, softened: what flashes as it locks or bursts */}
      <filter id={`w${id}`} x="-10%" y="-10%" width="120%" height="120%">
        <feFlood floodColor="#fff" />
        <feComposite in2="SourceAlpha" operator="in" />
        <feGaussianBlur stdDeviation="1.5" />
      </filter>
      <filter id={`gl${id}`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="g" />
        <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
  const worn = DRAW_ORDER.filter((p) => art[p]);

  if (layered) {
    return (
      <Layered label={label} size={size} dim={!known} className={className} worn={worn} anim={anim} onReady={onReady}
        source={(p, white, px) => (
          <svg xmlns="http://www.w3.org/2000/svg" width={size * px} height={size * px} viewBox="-20 -18 280 280">
            {defsNode}
            {white ? <g filter={url('w')}>{draw(p)}</g> : draw(p)}
          </svg>
        )} />
    );
  }
  return (
    <svg className={`rank-emblem${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="-20 -18 280 280"
      role="img" aria-label={label} opacity={known ? 1 : 0.7}>
      {defsNode}
      {worn.map((p) => {
        const a = anim(p);
        return <g key={p} {...a}>{draw(p)}</g>;
      })}
    </svg>
  );
}

/** How sharp the pictures are drawn: the screen's density, at most twice the size. */
const pixels = () => Math.min(2, Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));

/** Draws each piece off screen once, into a bitmap, and shows the bitmaps as canvas layers: textures the
    compositor moves without drawing anything again. */
function Layered({ label, size, dim, className, worn, anim, source, onReady }: {
  label: string; size: number; dim: boolean; className?: string; worn: Piece[];
  anim: (p: Piece) => { className: string; style?: CSSProperties };
  source: (p: Piece, white: boolean, px: number) => ReactNode; onReady?: () => void;
}) {
  const off = useRef<HTMLDivElement>(null);
  const [maps, setMaps] = useState<Record<string, ImageBitmap> | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const px = pixels();
  const key = worn.join();
  useEffect(() => {
    const el = off.current;
    if (!el) return;
    let live = true;
    const made: string[] = [];
    const jobs = [...el.querySelectorAll<HTMLElement>('[data-k]')].map(async (box) => {
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(box.firstElementChild!)], { type: 'image/svg+xml' }));
      made.push(url);
      const img = new Image();
      img.src = url;
      await img.decode();
      return [box.dataset.k!, await createImageBitmap(img)] as const;
    });
    Promise.all(jobs).then((done) => {
      made.forEach((u) => URL.revokeObjectURL(u));
      if (live) { setMaps(Object.fromEntries(done)); ready.current?.(); } else done.forEach(([, b]) => b.close());
    }).catch(() => { made.forEach((u) => URL.revokeObjectURL(u)); if (live) ready.current?.(); });
    return () => { live = false; };
    // the drawing is the same as long as the pieces, the rank and the size are
  }, [key, label, size, px]);
  useEffect(() => () => { if (maps) Object.values(maps).forEach((b) => b.close()); }, [maps]);
  const paint = (k: string) => (c: HTMLCanvasElement | null) => {
    const b = maps?.[k];
    if (!c || !b || c.dataset.drawn === k) return;
    c.width = b.width; c.height = b.height;
    c.getContext('2d')?.drawImage(b, 0, 0);
    c.dataset.drawn = k;
  };
  return (
    <div className={`rank-emblem rank-emblem--layered${className ? ` ${className}` : ''}`} style={{ width: size, height: size, opacity: dim ? 0.7 : 1 }}
      role="img" aria-label={label}>
      {!maps && (
        <div ref={off} className="rank-emblem__off" aria-hidden>
          {worn.flatMap((p) => [false, true].map((w) => <div key={`${p}${w}`} data-k={`${p}${w ? '-w' : ''}`}>{source(p, w, w ? 1 : px)}</div>))}
        </div>
      )}
      {maps && worn.map((p) => {
        const a = anim(p);
        return (
          <div key={p} className={a.className} style={{ ...a.style, transformOrigin: ORIGIN[p] }}>
            <canvas ref={paint(p)} aria-hidden />
            <canvas ref={paint(`${p}-w`)} aria-hidden className="rc-flash" />
          </div>
        );
      })}
    </div>
  );
}
