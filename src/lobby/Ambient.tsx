import { useEffects } from '../card/effects.ts';

/**
 * What sits behind the pages: a faint hextech lattice, a light that moves
 * across it and a dark edge, so the panels float in something instead of on
 * a flat colour. No pictures: the only picture is the season's, on Home.
 */
export function Ambient() {
  const fx = useEffects();
  return (
    <div className="lb-ambient" data-fx={fx} aria-hidden>
      <div className="lb-ambient__glow" />
      <div className="lb-ambient__hex" />
      <div className="lb-ambient__sweep" />
      <div className="lb-ambient__vignette" />
    </div>
  );
}
