/*
 * Matchmaking rating: Glicko-2 (Glickman, "Example of the Glicko-2 system",
 * 2012), one game at a time. A rating is how strong a player looks (r), how
 * sure we are of it (rd: high for new players, so their first games move it
 * a lot) and how steady they are (vol). The ladder shows the cautious
 * estimate r - 2*rd, so a new account starts low and climbs as the system
 * learns it, instead of starting in the middle and dropping.
 */

export interface Rating { r: number; rd: number; vol: number }

export const START: Rating = { r: 1500, rd: 350, vol: 0.06 };
const SCALE = 173.7178;
const TAU = 0.5;
const RD_MIN = 45;
const RD_MAX = 350;

/** The new rating after one game against `opp`: score 1 win, 0 loss, 0.5 draw. */
export function rate(me: Rating, opp: Rating, score: 0 | 0.5 | 1): Rating {
  const mu = (me.r - 1500) / SCALE, phi = me.rd / SCALE;
  const muJ = (opp.r - 1500) / SCALE, phiJ = opp.rd / SCALE;
  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
  const e = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * e * (1 - e));
  const delta = v * g * (score - e);

  // the new volatility (step 5, the Illinois algorithm)
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a, B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * g * (score - e);
  return {
    r: muNew * SCALE + 1500,
    rd: Math.min(RD_MAX, Math.max(RD_MIN, phiNew * SCALE)),
    vol,
  };
}

/** What the ladder shows: the cautious estimate, never below 0. */
export const ladderPoints = (x: Rating) => Math.max(0, Math.round(x.r - 2 * x.rd));

export const TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master'] as const;
export type Tier = (typeof TIERS)[number];

/** Placement games before a tier is shown. */
export const PLACEMENT_GAMES = 5;

/** The tier and division (IV lowest … I highest) of ladder points. Master has no divisions. */
export function tierOf(points: number): { tier: Tier; division: 1 | 2 | 3 | 4 | null } {
  // 200 points per tier from 600 up: Iron below 600, Master from 2000
  if (points >= 2000) return { tier: 'Master', division: null };
  const i = Math.max(0, Math.min(6, Math.floor((points - 600) / 200) + 1));
  if (i === 0) return { tier: 'Iron', division: (4 - Math.min(3, Math.floor(points / 150))) as 1 | 2 | 3 | 4 };
  const within = points - (600 + (i - 1) * 200);
  return { tier: TIERS[i], division: (4 - Math.min(3, Math.floor(within / 50))) as 1 | 2 | 3 | 4 };
}
