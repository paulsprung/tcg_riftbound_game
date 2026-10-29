/*
 * The ranked ladder's tiers, shared by the server (server/rating.ts, which
 * turns a rating into ladder points) and the app (the emblems and bars).
 *
 * Eight tiers of five divisions each (V lowest … I highest), the top one
 * without divisions. The first tier spans 600 points (120 a division), each
 * later one 200 (40 a division); the top tier starts at 2000.
 */

export const TIERS = ['Initiate', 'Adept', 'Vanguard', 'Sentinel', 'Warden', 'Ascendant', 'Exalted', 'Paragon'] as const;
export type Tier = (typeof TIERS)[number];
export type Division = 1 | 2 | 3 | 4 | 5;
export const DIVISIONS = 5;

/** Placement games before a tier is shown. */
export const PLACEMENT_GAMES = 5;

const TOP = 2000;
const FIRST = 600;

/** Each tier's colours for its emblem: metal, its light, and the gem. */
export const TIER_LOOK: Record<Tier, { metal: string; light: string; gem: string }> = {
  Initiate: { metal: '#6f6a66', light: '#b9b2aa', gem: '#9a948c' },
  Adept: { metal: '#8a4f2a', light: '#e0a070', gem: '#c8743a' },
  Vanguard: { metal: '#7d8a99', light: '#e8eef5', gem: '#a9c2dd' },
  Sentinel: { metal: '#9a6f1c', light: '#ffe08a', gem: '#f2b83a' },
  Warden: { metal: '#1d6f73', light: '#8ff0e6', gem: '#38c7c0' },
  Ascendant: { metal: '#1f6b45', light: '#9ff2bf', gem: '#3fd17f' },
  Exalted: { metal: '#4a3a9e', light: '#cdbdff', gem: '#8d6bff' },
  Paragon: { metal: '#8a2350', light: '#ffc2dc', gem: '#ff5c9a' },
};

/** The tier and division of ladder points. The top tier has no divisions. */
export function tierOf(points: number): { tier: Tier; division: Division | null } {
  if (points >= TOP) return { tier: 'Paragon', division: null };
  if (points < FIRST) return { tier: 'Initiate', division: (DIVISIONS - Math.min(DIVISIONS - 1, Math.floor(Math.max(0, points) / 120))) as Division };
  const i = Math.min(6, Math.floor((points - FIRST) / 200) + 1);
  const within = points - (FIRST + (i - 1) * 200);
  return { tier: TIERS[i], division: (DIVISIONS - Math.min(DIVISIONS - 1, Math.floor(within / 40))) as Division };
}

/** How far into its division a score is, 0 to 1 (the top tier is always full). */
export function divisionProgress(points: number): number {
  if (points >= TOP) return 1;
  const size = points < FIRST ? 120 : 40;
  const floor = points < FIRST ? 0 : FIRST;
  return (((Math.max(0, points) - floor) % size) / size);
}

export const roman = (d: Division | number | null) => (d ? ['I', 'II', 'III', 'IV', 'V'][d - 1] : '');

/** Where a rank stands on the whole ladder, for comparing two: higher is better. */
export const rankStep = (tier: string, division: number | null) =>
  Math.max(0, TIERS.indexOf(tier as Tier)) * DIVISIONS + (division ? DIVISIONS - division : DIVISIONS - 1);

/** "Sentinel II", or "Paragon". */
export const rankName = (tier: string, division: number | null) => (division ? `${tier} ${roman(division)}` : tier);
