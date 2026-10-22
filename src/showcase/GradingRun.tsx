import { useEffect, useState, type CSSProperties } from 'react';
import { collection } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card } from '../data/types.ts';
import { GradeReport } from './GradeReport.tsx';
import { GRADER, SUBGRADES, type Slab as SlabData } from './grading.ts';
import { Slab } from './Slab.tsx';

type Phase = 'scan' | 'sub' | 'seal' | 'done';

// how long each step takes, in ms
const SCAN = 1900;
const SUB = 650;
const SEAL = 900;

/**
 * A card at the grader's: measured for centering, looked over corner by
 * corner, then sealed in its slab with the grade on the label. The grade
 * is already decided (and saved) when this opens; the steps just tell it.
 */
export function GradingRun({ card, slab, onClose, onAnother }: {
  card: Card;
  slab: SlabData;
  onClose: () => void;
  onAnother: () => void;
}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [phase, setPhase] = useState<Phase>(reduced ? 'done' : 'scan');
  const [rows, setRows] = useState(reduced ? SUBGRADES.length : 0);
  const [displayed, setDisplayed] = useState(() => collection.isDisplayed({ kind: 'slab', cert: slab.cert }));
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (phase === 'scan') {
      const t = setTimeout(() => { setPhase('sub'); setRows(1); }, SCAN);
      return () => clearTimeout(t);
    }
    if (phase === 'sub') {
      const t = setTimeout(() => {
        if (rows < SUBGRADES.length) setRows(rows + 1);
        else setPhase('seal');
      }, SUB);
      return () => clearTimeout(t);
    }
    if (phase === 'seal') {
      const t = setTimeout(() => setPhase('done'), SEAL);
      return () => clearTimeout(t);
    }
  }, [phase, rows]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  const vw = Math.min(window.innerWidth, 1100);
  const vh = window.innerHeight;
  const slabW = Math.round(Math.min(vw * 0.8, 340, vh * 0.7 * (3.25 / 5.375)));
  const sealed = phase === 'seal' || phase === 'done';
  // borders as printed: their share of a 6% margin, for the centering guides
  const guides = {
    '--gl': `${(slab.lr / 100) * 6}%`, '--gr': `${((100 - slab.lr) / 100) * 6}%`,
    '--gt': `${(slab.tb / 100) * 4.4}%`, '--gb': `${((100 - slab.tb) / 100) * 4.4}%`,
  } as CSSProperties;

  const display = () => {
    if (collection.display({ kind: 'slab', cert: slab.cert })) setDisplayed(true);
    else setFull(true);
  };

  return (
    <div className="grading" role="dialog" aria-modal="true" aria-label={`Grading ${card.name}`} data-phase={phase}>
      <div className="grading__body">
        <div className="grading__stage" style={{ width: slabW, ...guides }}>
          <Slab slab={slab} card={card} width={slabW} open={!sealed} tilt={phase === 'done' ? 'idle' : 'off'} gyro
            gl={phase === 'done'} imageWidth={600}>
            {!sealed && (
              <div className="scan" aria-hidden>
                <span className="scan__beam" />
                <span className="scan__guide scan__guide--l" />
                <span className="scan__guide scan__guide--r" />
                <span className="scan__guide scan__guide--t" />
                <span className="scan__guide scan__guide--b" />
              </div>
            )}
          </Slab>
        </div>

        <aside className="grading__panel">
          <p className="eyebrow">{GRADER.name} · {phase === 'scan' ? 'Measuring centering' : phase === 'sub' ? 'Inspecting' : 'Sealed'}</p>
          <h2 className="inspector__name">{card.name}</h2>
          <p className="muted small">{card.setName} · {card.code}{slab.foil && defaultFinish(card, false) === 'none' ? ' · Foil' : ''}</p>
          <GradeReport slab={slab} shown={rows} final={sealed} />
          {phase === 'done' ? (
            <div className="grading__actions">
              {displayed ? (
                <a className="btn btn--ghost" href="#collection/showcase" onClick={onClose}>In your showcase ✓</a>
              ) : (
                <button type="button" className="btn btn--primary" onClick={display}>Put in showcase</button>
              )}
              <button type="button" className="btn btn--ghost" onClick={onAnother}>Grade another</button>
              <button type="button" className="btn btn--ghost" onClick={onClose}>Done</button>
              {full && <p className="muted small grading__note">The showcase is full: take something out first.</p>}
            </div>
          ) : (
            <div className="grading__actions">
              <button type="button" className="btn btn--ghost btn--small" onClick={() => { setRows(SUBGRADES.length); setPhase('done'); }}>
                Skip
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
