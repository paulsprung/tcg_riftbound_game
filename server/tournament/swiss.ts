/*
 * Swiss rounds and a top cut, as card-game tournaments run them:
 *
 *   match points: win 3, draw 1, loss 0; a bye is a win (2-0 in games)
 *   pairing: by match points, top down, never the same pair twice if it can
 *     be helped; an odd player out gets the bye, the lowest-ranked one who
 *     has not had one
 *   standings: match points, then the tiebreakers in TIEBREAKERS order:
 *     OMW%  the opponents' average match-win rate (each at least 1/3)
 *     GW%   the player's game-win rate (at least 1/3)
 *     OGW%  the opponents' average game-win rate
 *   rounds: enough that one undefeated player can remain (log2 of the field)
 *   top cut: single elimination of the best 4 or 8, seeded 1 vs 8, 4 vs 5 …
 *
 * Byes are left out of the opponents' rates. The order of the tiebreakers is
 * a setting: check it against the current Riftbound Tournament Rules.
 * Pure: the director (director.ts) keeps the state in the database.
 */

export type PlayerId = string;

export interface MatchResult {
  round: number;
  a: PlayerId;
  /** null: a bye for a. */
  b: PlayerId | null;
  /** Games won by a and by b; a draw has equal wins. */
  wins: [number, number];
}

export type Tiebreaker = 'omw' | 'gw' | 'ogw';
export const TIEBREAKERS: Tiebreaker[] = ['omw', 'gw', 'ogw'];
const FLOOR = 1 / 3;

export interface Standing {
  player: PlayerId;
  rank: number;
  points: number;
  wins: number; losses: number; draws: number;
  omw: number; gw: number; ogw: number;
  byes: number;
  opponents: PlayerId[];
}

/** Rounds for a field of n players: ceil(log2 n), at least 3 when there are 8 or more. */
export function swissRounds(n: number): number {
  if (n < 2) return 0;
  const r = Math.ceil(Math.log2(n));
  return n >= 8 ? Math.max(3, r) : r;
}

export function standings(players: PlayerId[], results: MatchResult[], order: Tiebreaker[] = TIEBREAKERS): Standing[] {
  const base = new Map(players.map((p) => [p, { player: p, points: 0, wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesPlayed: 0, byes: 0, opponents: [] as PlayerId[] }]));
  for (const m of results) {
    const a = base.get(m.a);
    if (!a) continue;
    if (m.b === null) { a.points += 3; a.wins++; a.byes++; a.gamesWon += 2; a.gamesPlayed += 2; continue; }
    const b = base.get(m.b);
    if (!b) continue;
    a.opponents.push(m.b); b.opponents.push(m.a);
    a.gamesWon += m.wins[0]; b.gamesWon += m.wins[1];
    const games = m.wins[0] + m.wins[1];
    a.gamesPlayed += games; b.gamesPlayed += games;
    if (m.wins[0] > m.wins[1]) { a.points += 3; a.wins++; b.losses++; }
    else if (m.wins[1] > m.wins[0]) { b.points += 3; b.wins++; a.losses++; }
    else { a.points++; b.points++; a.draws++; b.draws++; }
  }
  const mw = (p: PlayerId) => {
    const x = base.get(p)!;
    const rounds = x.wins + x.losses + x.draws - x.byes;
    return rounds <= 0 ? FLOOR : Math.max(FLOOR, (x.points - 3 * x.byes) / (3 * rounds));
  };
  const gw = (p: PlayerId) => {
    const x = base.get(p)!;
    return x.gamesPlayed === 0 ? FLOOR : Math.max(FLOOR, x.gamesWon / x.gamesPlayed);
  };
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  const rows = [...base.values()].map((x) => ({
    player: x.player, rank: 0, points: x.points, wins: x.wins, losses: x.losses, draws: x.draws, byes: x.byes, opponents: x.opponents,
    omw: avg(x.opponents.map(mw)), gw: gw(x.player), ogw: avg(x.opponents.map(gw)),
  }));
  rows.sort((p, q) => q.points - p.points || order.map((t) => q[t] - p[t]).find((d) => Math.abs(d) > 1e-9) || p.player.localeCompare(q.player));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * The next round's pairings among the players still in (not dropped).
 * Top down by standing: each player meets the highest one below not met
 * before; when that fails at the bottom, the search backs up (a small
 * backtracking pass), and only if no rematch-free pairing exists is a
 * rematch allowed. `random` orders the first round.
 */
export function pairRound(active: PlayerId[], results: MatchResult[], random: () => number): { a: PlayerId; b: PlayerId | null }[] {
  const round = results.reduce((m, r) => Math.max(m, r.round), 0) + 1;
  let order: PlayerId[];
  if (round === 1) {
    order = active.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  } else {
    const st = standings(active, results);
    order = st.map((s) => s.player);
  }
  const met = new Set(results.filter((r) => r.b !== null).flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]));
  const hadBye = new Set(results.filter((r) => r.b === null).map((r) => r.a));
  const out: { a: PlayerId; b: PlayerId | null }[] = [];
  if (order.length % 2 === 1) {
    // the bye: the lowest-ranked player without one yet
    const pick = [...order].reverse().find((p) => !hadBye.has(p)) ?? order[order.length - 1];
    order = order.filter((p) => p !== pick);
    out.push({ a: pick, b: null });
  }
  // the search is bounded: a big late field that can't avoid every rematch gives up and allows them
  let budget = 50_000;
  const pair = (left: PlayerId[], allowRematch: boolean): [PlayerId, PlayerId][] | null => {
    if (left.length === 0) return [];
    if (--budget < 0 && !allowRematch) return null;
    const [p, ...rest] = left;
    for (let i = 0; i < rest.length; i++) {
      const q = rest[i];
      if (!allowRematch && met.has(`${p}|${q}`)) continue;
      const after = pair([...rest.slice(0, i), ...rest.slice(i + 1)], allowRematch);
      if (after) return [[p, q], ...after];
    }
    return null;
  };
  const pairs = pair(order, false) ?? pair(order, true)!;
  return [...pairs.map(([a, b]) => ({ a, b })), ...out];
}

/** The first round of a top cut: seeds 1 vs n, 2 vs n-1 … in bracket order, so 1 and 2 can only meet in the final. */
export function topCutPairs(seeds: PlayerId[]): [PlayerId, PlayerId][] {
  const n = seeds.length;
  const order = n === 8 ? [1, 8, 4, 5, 2, 7, 3, 6] : n === 4 ? [1, 4, 2, 3] : [1, 2];
  const out: [PlayerId, PlayerId][] = [];
  for (let i = 0; i < order.length; i += 2) out.push([seeds[order[i] - 1], seeds[order[i + 1] - 1]]);
  return out;
}
