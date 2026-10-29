import { useState } from 'react';
import { DIVISIONS, rankName, TIERS, type Tier } from '../economy/ranks.ts';
import { RankEmblem } from '../lobby/RankEmblem.tsx';
import type { RatingInfo } from '../net/protocol.ts';
import { RankUp } from '../play/prompt/RankUp.tsx';
import '../play/board.css';

/*
 * The preview's look at the ranks (#ranks): every crest with its armour,
 * and the rank-change ceremony played on demand, for the common cases or
 * between any two ranks.
 */

const info = (tier: Tier, division: number | null, placement = false): RatingInfo => {
  // the points at the middle of that division, so the bars sit somewhere sensible
  const ti = TIERS.indexOf(tier);
  const points = tier === 'Paragon' ? 2050 : ti === 0 ? (DIVISIONS - (division ?? 1)) * 120 + 60 : 600 + (ti - 1) * 200 + (DIVISIONS - (division ?? 1)) * 40 + 20;
  return { tier, division, points, games: placement ? 4 : 30, placement };
};

const CASES: { label: string; before: RatingInfo; after: RatingInfo }[] = [
  { label: 'Division up · Sentinel II → I', before: info('Sentinel', 2), after: info('Sentinel', 1) },
  { label: 'Division up · Warden IV → III', before: info('Warden', 4), after: info('Warden', 3) },
  { label: 'Tier up · Ascendant I → Exalted V', before: info('Ascendant', 1), after: info('Exalted', 5) },
  { label: 'To the top · Exalted I → Paragon', before: info('Exalted', 1), after: info('Paragon', null) },
  { label: 'Placement done · → Vanguard III', before: info('Initiate', 5, true), after: info('Vanguard', 3) },
  { label: 'Demoted · Warden II → III', before: info('Warden', 2), after: info('Warden', 3) },
  { label: 'Tier down · Warden V → Sentinel I', before: info('Warden', 5), after: info('Sentinel', 1) },
];

const RANKS: { t: Tier; d: number | null }[] = TIERS.flatMap<{ t: Tier; d: number | null }>((t) => (t === 'Paragon' ? [{ t, d: null }] : [5, 4, 3, 2, 1].map((d) => ({ t, d }))));

export function RankDemo() {
  const [play, setPlay] = useState<{ before: RatingInfo; after: RatingInfo; n: number } | null>(null);
  const [from, setFrom] = useState(14);
  const [to, setTo] = useState(15);
  const pick = (i: number) => { const r = RANKS[i]; return info(r.t, r.d); };
  const start = (before: RatingInfo, after: RatingInfo) => setPlay({ before, after, n: (play?.n ?? 0) + 1 });
  return (
    <div className="rank-demo">
      <header>
        <h1>Ranks</h1>
        <p className="muted">Every crest, and the ceremony after a ranked game. Pick a case to play it.</p>
      </header>
      <section className="rank-demo__cases">
        {CASES.map((c) => <button key={c.label} type="button" className="btn" onClick={() => start(c.before, c.after)}>{c.label}</button>)}
        <span className="rank-demo__custom">
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{RANKS.map((r, i) => <option key={i} value={i}>{rankName(r.t, r.d)}</option>)}</select>
          →
          <select value={to} onChange={(e) => setTo(Number(e.target.value))}>{RANKS.map((r, i) => <option key={i} value={i}>{rankName(r.t, r.d)}</option>)}</select>
          <button type="button" className="btn btn--primary" disabled={from === to} onClick={() => start(pick(from), pick(to))}>Play</button>
        </span>
      </section>
      <section className="rank-demo__grid">
        {TIERS.map((t) => (
          <div key={t} className="rank-demo__tier">
            <h2>{t}</h2>
            <div>
              {(t === 'Paragon' ? [null] : [5, 4, 3, 2, 1]).map((d) => (
                <figure key={d ?? 0}>
                  <RankEmblem tier={t} division={d} size={112} />
                  <figcaption>{rankName(t, d)}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>
      {play && <RankUp key={play.n} before={play.before} after={play.after} onDone={() => setPlay(null)} />}
    </div>
  );
}
