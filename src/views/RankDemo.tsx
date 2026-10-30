import { useMemo, useState } from 'react';
import type { CardDb } from '../data/types.ts';
import { findCard, type PlayerId } from '../game/index.ts';
import { Outcome } from '../play/OnlineGame.tsx';
import { GameOver } from '../play/prompt/GameOver.tsx';
import type { CardSlot } from '../play/model/board.ts';
import { cardIndex } from '../play/model/cards.ts';
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

/** The end of a ranked game as the table shows it: Victory or Defeat, the score, what it brought, and the ceremony when the rank moves. */
const ENDINGS: { label: string; win: boolean; before: RatingInfo; after: RatingInfo }[] = [
  { label: 'Win · division up', win: true, before: info('Sentinel', 2), after: info('Sentinel', 1) },
  { label: 'Win · tier up', win: true, before: info('Ascendant', 1), after: info('Exalted', 5) },
  { label: 'Win · placement done', win: true, before: info('Initiate', 5, true), after: info('Vanguard', 3) },
  { label: 'Win · points only', win: true, before: info('Warden', 3), after: { ...info('Warden', 3), points: info('Warden', 3).points + 22 } },
  { label: 'Loss · demoted', win: false, before: info('Warden', 2), after: info('Warden', 3) },
];

const slot = (def: string): CardSlot => ({ id: 0, def, printing: null, owner: 0, exhausted: false, rune: false } as unknown as CardSlot);

function EndingDemo({ db, ending, onClose }: { db: CardDb; ending: (typeof ENDINGS)[number]; onClose: () => void }) {
  const cards = useMemo(() => cardIndex(db), [db]);
  const [me, them] = [findCard('jinx-loose-cannon') ? 'jinx-loose-cannon' : 'annie-dark-child', 'seraphine-starry-eyed-songstress'];
  const end = { t: 'end' as const, gameId: 'demo', winner: (ending.win ? 0 : 1) as PlayerId, reason: 'points', coins: ending.win ? 60 : 20, bonus: ending.win ? 40 : 0,
    rating: { before: ending.before, after: ending.after } };
  return (
    <div className="rank-demo__ending" style={{ '--rail-w': '0px' } as React.CSSProperties}>
      <GameOver tone={ending.win ? 'win' : 'loss'} title={ending.win ? 'Victory' : 'Defeat'}
        detail={ending.win ? 'You reached 8 points. [452.1]' : 'Your opponent reached 8 points. [452.1]'} eyebrow="Ranked · Turn 11"
        names={['You', 'Kalista']} points={ending.win ? [8, 5] : [6, 8]} legends={[slot(me), slot(them)]} cards={cards}
        buttons={<button type="button" className="btn btn--primary" autoFocus onClick={onClose}>Back to the lobby</button>}>
        <Outcome end={end} tournament={false} mode="ranked" />
      </GameOver>
    </div>
  );
}

const RANKS: { t: Tier; d: number | null }[] = TIERS.flatMap<{ t: Tier; d: number | null }>((t) => (t === 'Paragon' ? [{ t, d: null }] : [5, 4, 3, 2, 1].map((d) => ({ t, d }))));

export function RankDemo({ db }: { db: CardDb | null }) {
  const [ending, setEnding] = useState<{ e: (typeof ENDINGS)[number]; n: number } | null>(null);
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
      <section className="rank-demo__cases">
        <span className="rank-demo__label">After a ranked game:</span>
        {ENDINGS.map((e) => <button key={e.label} type="button" className="btn" disabled={!db} onClick={() => setEnding({ e, n: (ending?.n ?? 0) + 1 })}>{e.label}</button>)}
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
      {ending && db && <EndingDemo key={ending.n} db={db} ending={ending.e} onClose={() => setEnding(null)} />}
      {play && <RankUp key={play.n} before={play.before} after={play.after} onDone={() => setPlay(null)} />}
    </div>
  );
}
