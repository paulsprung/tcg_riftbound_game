import type { DecisionKind, PlayerView } from '../../game/index.ts';

/*
 * The computer opponent of M0: it answers the setup's decisions and
 * nothing more, through the same API a human uses. Like the real AI
 * (§11), it is given only its own view: its options are the ones the
 * engine listed for it, and it never sees the true state.
 *
 * Play order takes the AI's default, `first` (§4.3). Anything else is a
 * random real option, drawn from a generator seeded with the game's seed,
 * so a game replays the same.
 */

/** The bot's answer to its pending decision. */
export function botAnswer(v: PlayerView, random: () => number): string {
  const d = v.pending;
  if (!d) throw new Error(`P${v.me} has no decision to answer`);
  const real = d.options.filter((o) => !o.ui);
  if (d.kind === 'playOrder' && real.some((o) => o.key === 'first')) return 'first';
  return real[Math.floor(random() * real.length)].key;
}

/**
 * How long the bot takes, in ms. It depends on the kind of decision only,
 * never on the options, so the time it takes tells the human nothing
 * about what it holds (§4.8). Setup choices sit with the in-play ones.
 */
export function botPace(kind: DecisionKind, random: () => number): number {
  const [lo, hi] = kind === 'priority' ? [350, 900] : kind === 'playOrder' ? [700, 1300] : [250, 600];
  return Math.round(lo + random() * (hi - lo));
}
