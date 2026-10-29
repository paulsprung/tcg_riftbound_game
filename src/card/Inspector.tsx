import { viewport } from '../lobby/scale.ts';
import { useEffect, useState } from 'react';
import { useCollection } from '../collection/store.ts';
import { cap, defaultFinish, hasFoilToggle, RARITY_COLOR, symbolFor, VARIANT_LABEL } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import type { Finish } from '../pack/generate.ts';
import { GradeReport } from '../showcase/GradeReport.tsx';
import type { Slab as SlabData } from '../showcase/grading.ts';
import { Slab } from '../showcase/Slab.tsx';
import { HoloCard } from './HoloCard.tsx';
import { HoloSwitches } from './HoloSwitches.tsx';
import { RulesText } from './RulesText.tsx';

export interface InspectTarget {
  card: Card;
  /** The printing to show; defaults to the card's usual one. */
  finish?: Finish;
  /** A graded copy: shown in its slab, with the grader's report. */
  slab?: SlabData;
}

export function Inspector({ target, db, onClose }: { target: InspectTarget; db: CardDb; onClose: () => void }) {
  const { card, slab } = target;
  const state = useCollection();
  const owned = state.cards[card.id];
  const graded = state.slabs.filter((s) => s.cardId === card.id).length;
  const [faceDown, setFaceDown] = useState(false);
  const [finish, setFinish] = useState<Finish>(target.finish ?? defaultFinish(card, false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'f' && !slab) setFaceDown((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, slab]);

  const upright = card.orientation === 'landscape';
  // Fit the card to the viewport either way round.
  const virt = viewport();
  const vw = Math.min(virt.w, 1200);
  const vh = virt.h;
  const portraitW = Math.min(vw * 0.86, 420, (vh * 0.68) * (744 / 1039));
  const landscapeW = Math.min(vw * 0.9, 600, (vh * 0.6) * (1039 / 744));
  const width = Math.round(upright ? landscapeW : portraitW);
  const slabW = Math.round(Math.min(vw * 0.8, 380, vh * 0.74 * (3.25 / 5.375)));

  const rarity = symbolFor(db, 'rarities', card.rarity);
  const stats = [
    card.energy !== null && ['Energy', card.energy],
    card.might !== null && ['Might', card.might],
    card.power !== null && ['Power', card.power],
  ].filter(Boolean) as [string, number][];

  return (
    <div className="inspector" role="dialog" aria-modal="true" aria-label={card.name} onClick={onClose}>
      <div className="inspector__body" onClick={(e) => e.stopPropagation()}>
        <div className="inspector__stage">
          {slab ? (
            <Slab slab={slab} card={card} width={slabW} tilt="idle" gyro thick gl imageWidth={744} />
          ) : (
            <HoloCard
              card={card}
              finish={finish}
              width={width}
              tilt="idle"
              gyro
              thick
              upright={upright}
              imageWidth={744}
              gl
              faceDown={faceDown}
              onClick={() => setFaceDown((f) => !f)}
            />
          )}
          <p className="inspector__hint">
            {!matchMedia('(pointer: coarse)').matches
              ? `Move to tilt${slab ? '' : ' · click to flip'} · Esc to close`
              : import.meta.env.VITE_PREVIEW ? `Drag to tilt${slab ? '' : ' · tap to flip'}` : `Tilt your phone or drag${slab ? '' : ' · tap to flip'}`}
          </p>
        </div>

        <aside className="inspector__info">
          <button className="icon-btn inspector__close" type="button" onClick={onClose} aria-label="Close">✕</button>
          <p className="eyebrow">{card.setName} · {card.code}</p>
          <h2 className="inspector__name">{card.name}</h2>
          <div className="chips">
            <span className="chip" style={{ '--chip': RARITY_COLOR[card.rarity] } as React.CSSProperties}>
              {rarity && <img src={rarity.icon} alt="" />}
              {cap(card.rarity)}
            </span>
            {card.variant !== 'base' && <span className="chip chip--gold">{VARIANT_LABEL[card.variant]}</span>}
            {card.edition && <span className="chip chip--gold">{card.edition}</span>}
            {card.type && <span className="chip">{card.type}</span>}
            {card.supertype && <span className="chip">{card.supertype}</span>}
            {card.domains.map((d) => {
              const s = symbolFor(db, 'domains', d);
              return <span key={d} className="chip">{s && <img src={s.icon} alt="" />}{d}</span>;
            })}
          </div>

          {stats.length > 0 && (
            <dl className="stats">
              {stats.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
            </dl>
          )}

          {slab && <GradeReport slab={slab} />}
          {card.errata ? (
            <>
              <RulesText text={card.errata} db={db} />
              <details className="printed">
                <summary className="muted small">Errata: Riot has updated this card's wording. As printed</summary>
                <RulesText text={card.text} db={db} />
              </details>
            </>
          ) : card.text && <RulesText text={card.text} db={db} />}
          {card.flavor && <p className="flavor">{card.flavor}</p>}
          {card.tags.length > 0 && <p className="muted small">Tags: {card.tags.join(', ')}</p>}
          {card.artist && <p className="muted small">Illustrated by {card.artist}</p>}

          {!slab && hasFoilToggle(card) && (
            <div className="seg" role="group" aria-label="Printing">
              <button type="button" aria-pressed={finish === 'none'} onClick={() => setFinish('none')}>Normal</button>
              <button type="button" aria-pressed={finish === 'foil'} onClick={() => setFinish('foil')}>Foil</button>
            </div>
          )}

          <div className="inspector__switches">
            <HoloSwitches compact />
          </div>

          <p className="owned">
            {owned || graded ? (
              <>In your collection: <b>{owned?.normal ?? 0}</b> normal · <b>{owned?.foil ?? 0}</b> foil{graded > 0 && <> · <b>{graded}</b> graded</>}</>
            ) : 'Not in your collection yet'}
          </p>
        </aside>
      </div>
    </div>
  );
}
