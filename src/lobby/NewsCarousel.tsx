import { useEffect, useState } from 'react';
import { useEffects } from '../card/effects.ts';
import { NEWS } from './news.ts';

/** The news, one panel at a time, turning by itself. Rests while the pointer is on it. */
export function NewsCarousel() {
  const fx = useEffects();
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold || fx === 'off') return;
    const t = setInterval(() => setI((n) => (n + 1) % NEWS.length), 6500);
    return () => clearInterval(t);
  }, [hold, fx]);

  return (
    <div className="news lb-card" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}
      role="region" aria-roledescription="carousel" aria-label="Latest news">
      <div className="news__slides" aria-live="off">
        {NEWS.map((x, k) => (
          <article key={x.title} className="news__slide" data-active={k === i ? '' : undefined} aria-hidden={k !== i}>
            <span className={`home-tag home-tag--${x.tone}`}>{x.tag}</span>
            <strong>{x.title}</strong>
            <p>{x.body}</p>
          </article>
        ))}
      </div>
      <div className="news__dots" role="tablist" aria-label="News">
        {NEWS.map((x, k) => (
          <button key={x.title} type="button" role="tab" aria-selected={k === i} aria-label={x.title} onClick={() => setI(k)} />
        ))}
      </div>
    </div>
  );
}
