import { useState, type CSSProperties } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { collection, SHOWCASE_SIZE } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { Icon } from '../lobby/icons.tsx';
import { GradingRun } from '../showcase/GradingRun.tsx';
import type { Slab as SlabData } from '../showcase/grading.ts';
import { Picker } from '../showcase/Picker.tsx';
import { Slab } from '../showcase/Slab.tsx';
import '../showcase/showcase.css';
import type { Piece } from './showcasePieces.ts';

// Which spot of the stage each showcase place has: the first card in the
// middle, the next ones to either side of it, working outwards.
const STAGE_ORDER = [3, 1, 0, 2, 4];
const SCALE = [1, .84, .84, .7, .7];

const RARITY_GLOW: Record<string, string> = {
  common: '#a09b8c', uncommon: '#0be1a2', rare: '#4aa3ff', epic: '#c46bff', showcase: '#f0c35b', promo: '#f0c35b',
};

/**
 * Up to five favourite cards on a lit stage: the first one in the middle,
 * big, the rest around it. Click one to look at it, pick a spot to add a
 * card, send a card to the grader to put a slab on show.
 */
export function ProfileShowcase({ db, pieces, onInspect }: { db: CardDb; pieces: Piece[]; onInspect: (t: InspectTarget) => void }) {
  const [picking, setPicking] = useState<null | 'grade' | 'display'>(null);
  const [run, setRun] = useState<{ card: Card; slab: SlabData } | null>(null);
  const shown = pieces.slice(0, SHOWCASE_SIZE);

  const feature = (p: Piece) => {
    for (let i = shown.indexOf(p); i > 0; i--) collection.shift(p.item, -1);
  };
  const startGrade = (card: Card, foil: boolean) => {
    const slab = collection.grade(card.id, foil);
    setPicking(null);
    if (slab) setRun({ card, slab });
  };

  return (
    <section className="stage" aria-label="Card showcase">
      <div className="stage__head">
        <p className="lb-label">Card showcase <span className="stage__count">{shown.length} / {SHOWCASE_SIZE}</span></p>
        <button type="button" className="btn btn--small" onClick={() => setPicking('grade')}>
          <Icon name="star" size={14} /> Grade a card
        </button>
      </div>

      <div className="stage__set">
        <div className="stage__beams" aria-hidden />
        <div className="stage__floor" aria-hidden />
        <div className="stage__row">
          {STAGE_ORDER.map((idx) => {
            const p = shown[idx];
            const scale = SCALE[idx];
            const style = { '--s': scale, '--i': idx, '--glow': p ? RARITY_GLOW[p.card.rarity] ?? '#c8aa6e' : '#c8aa6e' } as CSSProperties;
            return (
              <div key={idx} className={`stage__spot${idx === 0 ? ' is-hero' : ''}${p ? '' : ' is-empty'}`} style={style}>
                {p ? (
                  <>
                    <div className="stage__piece">
                      {p.slab ? (
                        <Slab slab={p.slab} card={p.card} width="100%" imageWidth={420} gl={idx === 0}
                          onClick={() => onInspect({ card: p.card, finish: defaultFinish(p.card, p.slab!.foil), slab: p.slab! })} />
                      ) : (
                        <HoloCard card={p.card} finish={defaultFinish(p.card, p.foil)} width="100%" imageWidth={420} gl={idx === 0}
                          onClick={() => onInspect({ card: p.card, finish: defaultFinish(p.card, p.foil) })} />
                      )}
                      <div className="stage__tools">
                        {idx !== 0 && <button type="button" className="icon-btn" aria-label={`Feature ${p.card.name}`} title="Make featured" onClick={() => feature(p)}><Icon name="star" size={14} /></button>}
                        <button type="button" className="icon-btn" aria-label={`Take ${p.card.name} off the stage`} title="Remove" onClick={() => collection.undisplay(p.item)}><Icon name="close" size={14} /></button>
                      </div>
                    </div>
                    <div className="stage__pedestal" aria-hidden />
                    <div className="stage__plate">
                      <strong>{p.card.name}</strong>
                      <span>{idx === 0 ? 'Featured · ' : ''}{p.slab ? `Graded ${p.slab.grade}` : p.card.rarity}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <button type="button" className="stage__add" onClick={() => setPicking('display')} aria-label="Add a card to the showcase">
                      <Icon name="plus" size={26} />
                    </button>
                    <div className="stage__pedestal" aria-hidden />
                    <div className="stage__plate is-ghost"><span>{idx === 0 ? 'Featured card' : 'Empty spot'}</span></div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {picking === 'grade' && (
        <Picker db={db} mode="grade" title="Pick a card to grade" onClose={() => setPicking(null)} onPickRaw={startGrade} />
      )}
      {picking === 'display' && (
        <Picker db={db} mode="display" title="Add to the showcase" onClose={() => setPicking(null)}
          onPickRaw={(card, foil) => { collection.display({ kind: 'raw', cardId: card.id, foil }); setPicking(null); }}
          onPickSlab={(s) => { collection.display({ kind: 'slab', cert: s.cert }); setPicking(null); }} />
      )}
      {run && (
        <GradingRun key={run.slab.cert} card={run.card} slab={run.slab} onClose={() => setRun(null)}
          onAnother={() => { setRun(null); setPicking('grade'); }} />
      )}
    </section>
  );
}
