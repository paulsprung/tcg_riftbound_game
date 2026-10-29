import { useMemo } from 'react';
import { useEffects } from '../card/effects.ts';
import { useCardImage } from '../data/images.ts';
import type { Card, CardDb } from '../data/types.ts';
import { SEASON } from '../lobby/season.ts';

/** The season's picture, big: the crisp art at the right, its blur filling the rest. */
function Scene({ card }: { card: Card }) {
  const { src } = useCardImage(card, 744);
  const url = SEASON.art ?? src;
  if (!url) return null;
  const css = `url("${url}")`;
  return (
    <div className="hero__scene" data-active="" aria-hidden>
      <div className="hero__blur" style={{ backgroundImage: css }} />
      <div className="hero__art" style={{ backgroundImage: css }} />
    </div>
  );
}

/**
 * The big banner on Home: one picture for the whole season that drifts
 * slowly, with embers rising. Still when effects are off. `compact` is the
 * plain strip of the profile, without a picture.
 */
export function HeroBanner({ db, children, footer, compact = false, bleed = false, plain = false }: {
  db: CardDb; children?: React.ReactNode; footer?: React.ReactNode; compact?: boolean; bleed?: boolean; plain?: boolean;
}) {
  const fx = useEffects();
  const star = useMemo(
    () => db.cards.find((c) => c.type === 'Legend' && c.variant === 'base' && c.name === SEASON.legend) ?? null, [db]);
  const [name, title] = star ? star.name.split(/,\s*(.+)/) : ['', ''];

  return (
    <section className={`hero${compact ? ' hero--compact' : ''}${bleed ? ' hero--bleed' : ''}`} data-fx={fx}>
      {!compact && star && <Scene card={star} />}
      {!compact && <div className="hero__shade" aria-hidden />}
      {!compact && (
        <div className="hero__embers" aria-hidden>
          {Array.from({ length: 14 }, (_, k) => <i key={k} style={{ '--k': k } as React.CSSProperties} />)}
        </div>
      )}
      {!compact && !plain && star && (
        <div className="hero__text">
          <h1>{name}</h1>
          {title && <p className="hero__title">{title}</p>}
        </div>
      )}
      {children && <div className="hero__actions">{children}</div>}
      {footer && <div className="hero__foot">{footer}</div>}
    </section>
  );
}
