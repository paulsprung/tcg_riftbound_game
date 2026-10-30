import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DIVISIONS, rankName, rankStep } from '../../economy/ranks.ts';
import { piecesOf, PIECE_ORDER, RankEmblem, type Piece } from '../../lobby/RankEmblem.tsx';
import type { RatingInfo } from '../../net/protocol.ts';

/*
 * The rank change after a ranked game, as a ceremony over the whole screen
 * (the way the old ranked helms gained their armour):
 *
 *   - a division up: the crest charges, then the pieces it now wears fly in
 *     one by one and lock with a flash, sparks and a shock ring;
 *   - a tier up: the charge ends in a white flash, the old crest bursts
 *     apart and the new one is built piece by piece in its new metal;
 *   - down: the pieces it lost fall away (a tier down fades to the new
 *     metal);
 *   - the fifth placement game: the first crest is built from nothing.
 *
 * Then light breaks behind it and the new rank is named. Continue (or a
 * click anywhere once it is done) closes it.
 */

type Phase = 'enter' | 'charge' | 'change' | 'reveal';
const PIECE_MS = 420;

export function rankMoved(before: RatingInfo, after: RatingInfo): boolean {
  if (after.placement) return false;
  if (before.placement) return true;
  return rankStep(before.tier, before.division) !== rankStep(after.tier, after.division);
}

function Sparks({ at }: { at: number }) {
  return (
    <div className="rk-sparks" style={{ '--at': `${at}ms` } as CSSProperties} aria-hidden>
      <span className="rk-ring" />
      {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${i * (360 / 14) + (i % 2) * 9}deg`, '--l': `${50 + ((i * 29) % 60)}px` } as CSSProperties} />)}
    </div>
  );
}

export function RankUp({ before, after, onDone }: { before: RatingInfo; after: RatingInfo; onDone: () => void }) {
  const placed = before.placement;
  const up = placed || rankStep(after.tier, after.division) > rankStep(before.tier, before.division);
  const newTier = placed || before.tier !== after.tier;
  const was = placed ? [] : piecesOf(before.tier, before.division);
  const now = piecesOf(after.tier, after.division);
  // what the crest gains or loses, in the order the armour is put on
  const gained: Piece[] = newTier && up ? now : PIECE_ORDER.filter((p) => now.includes(p) && !was.includes(p));
  const lost: Piece[] = PIECE_ORDER.filter((p) => was.includes(p) && !now.includes(p));
  // the name comes as the last piece locks: no pause after it
  const lastMs = gained.at(-1) === 'shield' ? 700 : 500;
  const build = up && gained.length ? (gained.length - 1) * PIECE_MS + lastMs - 150 : 900;
  const [phase, setPhase] = useState<Phase>('enter');
  // both crests are drawn into pictures first (RankEmblem, layered): the show starts once they are,
  // so no frame of it waits on drawing
  const [drawn, setDrawn] = useState(0);
  const ready = drawn >= 2;
  useEffect(() => {
    document.body.classList.add('rk-open');
    return () => document.body.classList.remove('rk-open');
  }, []);
  useEffect(() => {
    if (!ready) return;
    const t = [setTimeout(() => setPhase('charge'), 500), setTimeout(() => setPhase('change'), 1700), setTimeout(() => setPhase('reveal'), 1700 + (newTier && up ? 350 : 0) + build)];
    return () => t.forEach(clearTimeout);
  }, [ready, build, newTier, up]);
  // never stuck on a picture that will not draw
  useEffect(() => { const t = setTimeout(() => setDrawn(2), 1500); return () => clearTimeout(t); }, []);
  const onDrawn = () => setDrawn((n) => n + 1);

  const changing = phase === 'change' || phase === 'reveal';
  const verdict = placed ? 'Ranked' : up ? (newTier ? 'Tier up' : 'Promoted') : 'Demoted';
  const division = (d: number | null) => (d ? `Division ${['I', 'II', 'III', 'IV', 'V'][d - 1]} of ${DIVISIONS}` : 'The top of the ladder');
  // over the whole screen, outside the end scene (whose animations would hold a fixed layer in)
  return createPortal(
    <div className={`rk is-${phase}${up ? ' is-up' : ' is-down'}${newTier ? ' is-tier' : ''}`} role="dialog" aria-label={`${verdict}: ${rankName(after.tier, after.division)}`}
      onClick={() => { if (phase === 'reveal') onDone(); }}>
      <div className="rk__stage">
        <div className="rk__rays" aria-hidden />
        <div className="rk__charge" aria-hidden />
        <div className="rk__glow" aria-hidden />
        {/* both from the start, the new one hidden until the change: before it, the old crest; a tier up bursts it */}
        <RankEmblem key="old" layered tier={placed ? null : before.tier} division={before.division} size={440} onReady={onDrawn}
          className={`rk__crest is-old${changing && !(newTier && up) ? ' is-gone' : ''}`} burst={changing && newTier && up} />
        <RankEmblem key="new" layered tier={after.tier} division={after.division} size={440} onReady={onDrawn}
          className={`rk__crest is-new${changing ? '' : ' is-waiting'}`}
          enter={changing && up ? gained : undefined} keep={!up && !newTier ? lost : undefined} leave={changing && !up && !newTier ? lost : undefined} delay={newTier && up ? 350 : 0} />
        {changing && up && gained.map((p, i) => <Sparks key={p} at={(newTier ? 350 : 0) + i * PIECE_MS + 380} />)}
      </div>
      {/* over the whole screen, so not on the stage, which centres what it holds */}
      {phase === 'change' && newTier && up && <div className="rk__flash" aria-hidden />}
      <div className="rk__text">
        <p className="rk__verdict">{verdict}</p>
        <h2 className="rk__name">{rankName(after.tier, after.division)}</h2>
        <p className="rk__sub">{division(after.division)} · {after.points.toLocaleString('en-US')} LP</p>
        <button type="button" className="btn btn--primary rk__go" onClick={onDone}>Continue</button>
      </div>
    </div>,
    document.body,
  );
}
