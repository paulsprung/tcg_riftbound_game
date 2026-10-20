import { useEffect, useState } from 'react';
import { useCollection } from '../collection/store.ts';
import { cap, defaultFinish, hasFoilToggle, RARITY_COLOR, symbolFor, VARIANT_LABEL } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import type { Finish } from '../pack/generate.ts';
import { HoloCard } from './HoloCard.tsx';

export interface InspectTarget {
  card: Card;
  /** The printing to show; defaults to the card's usual one. */
  finish?: Finish;
}

const MIGHT_FALLBACK = 'https://assetcdn.rgpub.io/public/live/riot-shared/player-experiences/riot-glyphs/rb/latest/might.svg';

/** Rules text with Riot's symbol codes (:rb_energy_1:, :rb_rune_fury:,
    :rb_might:, ...) drawn as symbols and [Keywords] as tags. */
function RulesText({ text, db }: { text: string; db: CardDb }) {
  const parts = text.split(/(:rb_[a-z0-9_]+:|\[[^\]]+\])/g);
  const symbol = (code: string, key: number) => {
    const energy = /^:rb_energy_(\d+):$/.exec(code);
    if (energy) return <span key={key} className="sym sym--energy" title={`${energy[1]} energy`}>{energy[1]}</span>;
    const rune = /^:rb_rune_([a-z]+):$/.exec(code);
    if (rune) {
      const d = symbolFor(db, 'domains', rune[1]);
      if (rune[1] === 'rainbow' || !d) return <span key={key} className="sym sym--rainbow" title="Power of any domain" />;
      return <img key={key} className="sym-img" src={d.icon} alt={`${d.label} power`} title={`${d.label} power`} />;
    }
    if (code === ':rb_might:') {
      const src = db.symbols?.glyphs?.might ?? MIGHT_FALLBACK;
      return <img key={key} className="sym-img sym-img--glyph" src={src} alt="Might" title="Might" />;
    }
    if (code === ':rb_exhaust:') return <span key={key} className="sym sym--exhaust" title="Exhaust">⟳</span>;
    return <span key={key} className="sym">{code.slice(4, -1)}</span>;
  };
  return (
    <p className="rules-text">
      {parts.map((p, i) => {
        if (p.startsWith(':rb_')) return symbol(p, i);
        if (p === '[>]') return <span key={i} className="kw-arrow" aria-label="then">▸</span>;
        if (/^\[.*\]$/.test(p)) return <span key={i} className="kw">{p.slice(1, -1)}</span>;
        return p.split('\n').map((line, j) => (j ? [<br key={`${i}-${j}`} />, line] : line));
      })}
    </p>
  );
}

export function Inspector({ target, db, onClose }: { target: InspectTarget; db: CardDb; onClose: () => void }) {
  const { card } = target;
  const owned = useCollection().cards[card.id];
  const [faceDown, setFaceDown] = useState(false);
  const [finish, setFinish] = useState<Finish>(target.finish ?? defaultFinish(card, false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'f') setFaceDown((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const upright = card.orientation === 'landscape';
  // Fit the card to the viewport either way round.
  const vw = Math.min(window.innerWidth, 1200);
  const vh = window.innerHeight;
  const portraitW = Math.min(vw * 0.86, 420, (vh * 0.68) * (744 / 1039));
  const landscapeW = Math.min(vw * 0.9, 600, (vh * 0.6) * (1039 / 744));
  const width = Math.round(upright ? landscapeW : portraitW);

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
          <HoloCard
            card={card}
            finish={finish}
            width={width}
            tilt="idle"
            gyro
            thick
            upright={upright}
            imageWidth={744}
            faceDown={faceDown}
            onClick={() => setFaceDown((f) => !f)}
          />
          <p className="inspector__hint">
            {!matchMedia('(pointer: coarse)').matches
              ? 'Move to tilt · click to flip · Esc to close'
              : import.meta.env.VITE_PREVIEW ? 'Drag to tilt · tap to flip' : 'Tilt your phone or drag · tap to flip'}
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

          {card.text && <RulesText text={card.text} db={db} />}
          {card.flavor && <p className="flavor">{card.flavor}</p>}
          {card.tags.length > 0 && <p className="muted small">Tags: {card.tags.join(', ')}</p>}
          {card.artist && <p className="muted small">Illustrated by {card.artist}</p>}

          {hasFoilToggle(card) && (
            <div className="seg" role="group" aria-label="Printing">
              <button type="button" aria-pressed={finish === 'none'} onClick={() => setFinish('none')}>Normal</button>
              <button type="button" aria-pressed={finish === 'foil'} onClick={() => setFinish('foil')}>Foil</button>
            </div>
          )}

          <p className="owned">
            {owned ? <>In your collection: <b>{owned.normal}</b> normal · <b>{owned.foil}</b> foil</> : 'Not in your collection yet'}
          </p>
        </aside>
      </div>
    </div>
  );
}
