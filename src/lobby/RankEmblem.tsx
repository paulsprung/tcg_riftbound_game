import { useId } from 'react';
import { TIER_LOOK, TIERS, type Tier } from '../economy/ranks.ts';

/*
 * A tier's emblem, drawn: a rune-cut crest in the tier's metal around its
 * gem. Higher tiers grow more of it: side blades from the third, a crown
 * from the fifth, a halo from the seventh. Unranked is the bare crest in
 * grey.
 */

const CREST = 'M50 8 L80 24 L80 60 L50 92 L20 60 L20 24 Z';
const GEM = 'M50 30 L64 46 L50 70 L36 46 Z';
const BLADES = 'M20 30 L4 22 L10 46 L20 54 Z M80 30 L96 22 L90 46 L80 54 Z';
const CROWN = 'M31 20 L33 -2 L42 9 L50 -9 L58 9 L67 -2 L69 20 Z';

export function RankEmblem({ tier, size = 56, className }: { tier: string | null; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const known = (TIERS as readonly string[]).includes(tier ?? '') ? (tier as Tier) : null;
  const look = known ? TIER_LOOK[known] : { metal: '#4a4f58', light: '#8b929c', gem: '#5d646e' };
  const level = known ? TIERS.indexOf(known) : -1;
  return (
    <svg className={`rank-emblem${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="-6 -12 112 114"
      role="img" aria-label={known ?? 'Unranked'} opacity={known ? 1 : 0.55}>
      <defs>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.light} />
          <stop offset="0.55" stopColor={look.metal} />
          <stop offset="1" stopColor={look.metal} stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id={`g${id}`} cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.35" stopColor={look.gem} />
          <stop offset="1" stopColor={look.metal} />
        </radialGradient>
      </defs>
      {level >= 6 && <circle cx="50" cy="48" r="50" fill="none" stroke={look.gem} strokeOpacity="0.55" strokeWidth="2.5" strokeDasharray="4 6" />}
      {level >= 7 && <circle cx="50" cy="48" r="44" fill={look.gem} opacity="0.18" />}
      {level >= 2 && <path d={BLADES} fill={`url(#m${id})`} stroke="#0008" strokeWidth="1.5" strokeLinejoin="round" />}
      {level >= 4 && <path d={CROWN} fill={`url(#m${id})`} stroke="#0008" strokeWidth="1.5" strokeLinejoin="round" />}
      <path d={CREST} fill={`url(#m${id})`} stroke="#000a" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 16 L72 28 L72 57 L50 82 L28 57 L28 28 Z" fill="#0006" stroke={look.light} strokeOpacity="0.5" strokeWidth="1.2" />
      <path d={GEM} fill={`url(#g${id})`} stroke={look.light} strokeWidth="1.2" />
      {level >= 1 && <path d="M50 30 L57 46 L50 70" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" />}
    </svg>
  );
}
