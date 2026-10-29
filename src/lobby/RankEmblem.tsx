import { useId } from 'react';
import { roman, TIER_LOOK, TIERS, type Tier } from '../economy/ranks.ts';

/*
 * A tier's emblem, drawn in the manner of the old ranked badges: a bevelled
 * metal frame around a dark field and a cut gem, in the tier's metal. Each
 * tier has its own frame and grows more around it: wings from the third,
 * more feathers as it climbs, a crown from the fifth, horns and a halo at
 * the top. A ribbon below carries the division when one is given.
 */

type Shape = 'round' | 'shield' | 'crest' | 'crystal';
interface Build { shape: Shape; feathers: number; crown: boolean; horns: boolean; halo: boolean; spike: boolean }
const BUILD: Record<Tier, Build> = {
  Initiate: { shape: 'round', feathers: 0, crown: false, horns: false, halo: false, spike: false },
  Adept: { shape: 'shield', feathers: 0, crown: false, horns: false, halo: false, spike: true },
  Vanguard: { shape: 'shield', feathers: 2, crown: false, horns: false, halo: false, spike: true },
  Sentinel: { shape: 'shield', feathers: 3, crown: false, horns: false, halo: false, spike: true },
  Warden: { shape: 'crest', feathers: 3, crown: true, horns: false, halo: false, spike: false },
  Ascendant: { shape: 'crystal', feathers: 4, crown: true, horns: false, halo: false, spike: false },
  Exalted: { shape: 'crystal', feathers: 4, crown: true, horns: true, halo: true, spike: false },
  Paragon: { shape: 'crest', feathers: 5, crown: true, horns: true, halo: true, spike: false },
};

const FRAME: Record<Shape, string> = {
  round: 'M100 34 C130 34 150 52 150 80 L150 106 C150 136 126 154 100 168 C74 154 50 136 50 106 L50 80 C50 52 70 34 100 34 Z',
  shield: 'M100 30 L152 46 L152 102 C152 134 128 154 100 170 C72 154 48 134 48 102 L48 46 Z',
  crest: 'M100 26 L154 54 L154 118 L100 170 L46 118 L46 54 Z',
  crystal: 'M100 20 L150 62 L150 120 L100 172 L50 120 L50 62 Z',
};
const FEATHER = 'M0 -7 C22 -16 52 -14 74 -3 C52 4 24 8 0 7 Z';
const CROWN = 'M66 46 L70 14 L84 32 L100 2 L116 32 L130 14 L134 46 Z';
const HORN = 'M62 52 C40 40 30 18 40 0 C44 20 56 34 74 42 Z';

const grey = { metal: '#3c414a', light: '#7c838d', gem: '#555c66' };

export function RankEmblem({ tier, division, size = 56, className }: {
  tier: string | null; division?: number | null; size?: number; className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const known = (TIERS as readonly string[]).includes(tier ?? '') ? (tier as Tier) : null;
  const look = known ? TIER_LOOK[known] : grey;
  const b = known ? BUILD[known] : BUILD.Initiate;
  const frame = FRAME[b.shape];
  const ribbon = division ? roman(division) : null;
  const url = (k: string) => `url(#${k}${id})`;
  // the feathers of the right wing, top to bottom; the left one mirrors it
  const feathers = Array.from({ length: b.feathers }, (_, i) => {
    const a = -38 + i * (76 / Math.max(1, b.feathers - 1 || 1));
    const scale = 1 - i * 0.1;
    return <path key={i} d={FEATHER} transform={`translate(146 ${84 + i * 4}) rotate(${b.feathers === 1 ? 0 : a}) scale(${scale})`} />;
  });
  return (
    <svg className={`rank-emblem${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 -6 200 206"
      role="img" aria-label={known ? `${known}${ribbon ? ` ${ribbon}` : ''}` : 'Unranked'} opacity={known ? 1 : 0.6}>
      <defs>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={look.light} />
          <stop offset="0.45" stopColor={look.metal} />
          <stop offset="0.8" stopColor={look.light} stopOpacity="0.8" />
          <stop offset="1" stopColor={look.metal} />
        </linearGradient>
        <linearGradient id={`e${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="0.5" stopColor={look.light} stopOpacity="0.1" />
          <stop offset="1" stopColor="#000" stopOpacity="0.4" />
        </linearGradient>
        <radialGradient id={`f${id}`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor={look.metal} stopOpacity="0.9" />
          <stop offset="1" stopColor="#05070c" />
        </radialGradient>
        <radialGradient id={`h${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.45" stopColor={look.gem} stopOpacity="0.55" />
          <stop offset="1" stopColor={look.gem} stopOpacity="0" />
        </radialGradient>
        <filter id={`s${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.6" />
        </filter>
      </defs>

      {b.halo && (
        <g>
          <circle cx="100" cy="96" r="98" fill={url('h')} />
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d="M100 96 L96 -2 L104 -2 Z" fill={look.light} opacity="0.18" transform={`rotate(${i * 22.5} 100 96)`} />
          ))}
        </g>
      )}
      <g filter={url('s')}>
        {b.feathers > 0 && (
          <g fill={url('m')} stroke="#0009" strokeWidth="2" strokeLinejoin="round">
            <g>{feathers}</g>
            <g transform="translate(200 0) scale(-1 1)">{feathers}</g>
          </g>
        )}
        {b.horns && (
          <g fill={url('m')} stroke="#0009" strokeWidth="2" strokeLinejoin="round">
            <path d={HORN} />
            <path d={HORN} transform="translate(200 0) scale(-1 1)" />
          </g>
        )}
        {b.crown && <path d={CROWN} fill={url('m')} stroke="#0009" strokeWidth="2.5" strokeLinejoin="round" />}
        {b.spike && <path d="M86 40 L100 12 L114 40 Z" fill={url('m')} stroke="#0009" strokeWidth="2.5" strokeLinejoin="round" />}

        {/* the frame: metal, its bevel, the dark field inside */}
        <path d={frame} fill={url('m')} stroke="#000" strokeOpacity="0.8" strokeWidth="3" strokeLinejoin="round" />
        <path d={frame} fill="none" stroke={url('e')} strokeWidth="6" strokeLinejoin="round" transform="translate(100 98) scale(.93) translate(-100 -98)" />
        <path d={frame} fill={url('f')} stroke={look.light} strokeOpacity="0.55" strokeWidth="2.5" transform="translate(100 99) scale(.74) translate(-100 -99)" />

        {/* the gem, cut in facets */}
        <g transform="translate(100 100)">
          <path d="M0 -36 L26 -4 L0 38 L-26 -4 Z" fill={look.gem} stroke={look.light} strokeWidth="2" />
          <path d="M0 -36 L-26 -4 L0 -2 Z" fill="#fff" opacity="0.55" />
          <path d="M0 -36 L26 -4 L0 -2 Z" fill="#fff" opacity="0.25" />
          <path d="M-26 -4 L0 38 L0 -2 Z" fill="#000" opacity="0.15" />
          <path d="M26 -4 L0 38 L0 -2 Z" fill="#000" opacity="0.38" />
          <path d="M-8 -22 L-2 -30" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
        </g>
      </g>

      {ribbon && (
        <g>
          <path d="M52 160 L62 152 L62 178 L52 186 L44 172 Z M148 160 L138 152 L138 178 L148 186 L156 172 Z" fill={look.metal} stroke="#000a" strokeWidth="2" />
          <path d="M60 150 L140 150 L140 180 L60 180 Z" fill={url('m')} stroke="#000a" strokeWidth="2.5" />
          <path d="M64 154 L136 154 L136 176 L64 176 Z" fill="#0b0f16" opacity="0.82" />
          <text x="100" y="172" textAnchor="middle" fontSize="22" fontWeight="800" fill={look.light} letterSpacing="2"
            style={{ fontFamily: 'var(--font-display), serif' }}>{ribbon}</text>
        </g>
      )}
    </svg>
  );
}
