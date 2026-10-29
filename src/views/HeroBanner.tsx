import { useEffect, useMemo, useState } from 'react';
import { useEffects } from '../card/effects.ts';
import { useCardImage } from '../data/images.ts';
import type { Card, CardDb } from '../data/types.ts';

/** Legends whose art carries the banner, in rotation. */
const STARS = [
  'Jinx, Loose Cannon', 'Ahri, Nine-Tailed Fox', "Kai'Sa, Daughter of the Void", 'Yasuo, Unforgiven',
  'Seraphine, Starry-Eyed Songstress', 'Lee Sin, Blind Monk', 'Fiora, Grand Duelist', "Evelynn, Agony's Embrace",
];
const EVERY = 14_000;

/** The art of one legend, big: the crisp crop at the right, its blur filling the rest. */
function Scene({ card, active }: { card: Card; active: boolean }) {
  const { src } = useCardImage(card, 744);
  if (!src) return null;
  const url = `url("${src}")`;
  return (
    <div className="hero__scene" data-active={active ? '' : undefined} aria-hidden>
      <div className="hero__blur" style={{ backgroundImage: url }} />
      <div className="hero__art" style={{ backgroundImage: url }} />
    </div>
  );
}

/**
 * The big banner on Home. Legend art that drifts slowly, embers rising, and
 * a few legends in turn. Still when effects are off.
 */
export function HeroBanner({ db, children, footer, compact = false, bleed = false, plain = false }: {
  db: CardDb; children?: React.ReactNode; footer?: React.ReactNode; compact?: boolean; bleed?: boolean; plain?: boolean;
}) {
  const fx = useEffects();
  const stars = useMemo(() => {
    const byName = new Map(db.cards.filter((c) => c.type === 'Legend' && c.variant === 'base').map((c) => [c.name, c]));
    const found = STARS.map((n) => byName.get(n)).filter((c): c is Card => Boolean(c));
    // a new visit starts on a different legend
    const at = Math.floor(Math.random() * Math.max(1, found.length));
    return [...found.slice(at), ...found.slice(0, at)].slice(0, compact ? 1 : 4);
  }, [db, compact]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (fx === 'off' || stars.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % stars.length), EVERY);
    return () => clearInterval(t);
  }, [fx, stars.length]);

  const star = stars[i];
  const [name, title] = star ? star.name.split(/,\s*(.+)/) : ['', ''];

  return (
    <section className={`hero${compact ? ' hero--compact' : ''}${bleed ? ' hero--bleed' : ''}`} data-fx={fx}>
      {stars.map((c, k) => <Scene key={c.id} card={c} active={k === i} />)}
      <div className="hero__shade" aria-hidden />
      <div className="hero__embers" aria-hidden>
        {Array.from({ length: 14 }, (_, k) => <i key={k} style={{ '--k': k } as React.CSSProperties} />)}
      </div>
      {!compact && !plain && <div className="hero__text">
        <p className="lb-label">Riftbound</p>
        <h1>{name}</h1>
        {title && <p className="hero__title">{title}</p>}
        <div className="hero__dots" role="tablist" aria-label="Featured legend">
          {stars.map((c, k) => (
            <button key={c.id} type="button" role="tab" aria-selected={k === i} aria-label={c.name} onClick={() => setI(k)} />
          ))}
        </div>
      </div>}
      {children && <div className="hero__actions">{children}</div>}
      {footer && <div className="hero__foot">{footer}</div>}
    </section>
  );
}
