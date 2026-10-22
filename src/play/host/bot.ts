import { parseKey, type DecisionKind, type Option, type PlayerView } from '../../game/index.ts';

/*
 * The computer opponent of M1.1: a simple heuristic over the options the
 * engine lists, until the real AI arrives (§11, M1.4). Like the real AI it
 * is given only its own view, and it never answers with a UI-only option.
 *
 *   priority   play the dearest card it can pay for; otherwise usually move
 *              ready units out (to a battlefield it doesn't control, or home);
 *              otherwise end the turn, or pass
 *   moves      take every unit it can, then a battlefield it doesn't hold
 *   payment    plan 0, the engine's best; never decline
 *   setup      play first; keep the opening hand
 *   the rest   a random real option
 *
 * Random choices draw from a generator seeded with the game's seed, so a
 * game replays the same.
 */

const pick = <T>(xs: T[], random: () => number): T => xs[Math.floor(random() * xs.length)];

export function botAnswer(v: PlayerView, random: () => number): string {
  const d = v.pending;
  if (!d) throw new Error(`P${v.me} has no decision to answer`);
  const real = d.options.filter((o) => !o.ui);
  const has = (key: string) => real.some((o) => o.key === key);
  const heads = (head: string) => real.filter((o) => parseKey(o.key)?.head === head);
  switch (d.kind) {
    case 'playOrder': return has('first') ? 'first' : real[0].key;
    case 'mulligan': return has('done') ? 'done' : real[0].key;
    case 'priority': {
      const plays = heads('play');
      if (plays.length > 0) {
        const cost = (o: Option) => o.meta?.cost?.energy ?? 0;
        return plays.reduce((a, b) => (cost(b) > cost(a) ? b : a)).key;
      }
      if (has('move') && random() < 0.75) return 'move';
      return has('end') ? 'end' : has('pass') ? 'pass' : real[0].key;
    }
    case 'moveUnits': {
      const units = heads('u');
      return units.length > 0 ? units[0].key : 'done';
    }
    case 'moveDest': {
      const away = real.filter((o) => {
        const loc = parseKey(o.key)?.loc;
        return loc !== undefined && loc !== 'base' && v.bfs[loc.bf].controller !== v.me;
      });
      return (away.length > 0 ? pick(away, random) : pick(real, random)).key;
    }
    case 'payment': return heads('pay')[0]?.key ?? real[0].key;
    default: return pick(real, random).key;
  }
}

/**
 * How long the bot takes, in ms. It depends on the kind of decision only,
 * never on the options, so the time it takes tells the human nothing
 * about what it holds (§4.8).
 */
export function botPace(kind: DecisionKind, random: () => number): number {
  const [lo, hi] = kind === 'priority' ? [350, 900] : kind === 'playOrder' ? [700, 1300] : [250, 600];
  return Math.round(lo + random() * (hi - lo));
}
