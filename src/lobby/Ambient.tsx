import { useEffects } from '../card/effects.ts';
import { useCardImage } from '../data/images.ts';
import type { Card, CardDb } from '../data/types.ts';

/** The legend whose art hangs, out of focus, behind each page. */
const BY_ROUTE: Record<string, string> = {
  home: 'Jinx, Loose Cannon', play: 'Jinx, Loose Cannon', collection: 'Ahri, Nine-Tailed Fox',
  shop: 'Seraphine, Starry-Eyed Songstress', profile: "Kai'Sa, Daughter of the Void", rules: 'Lee Sin, Blind Monk',
};

function Art({ card }: { card: Card }) {
  const { src } = useCardImage(card, 744);
  return src ? <div className="lb-ambient__art" style={{ backgroundImage: `url("${src}")` }} key={card.id} /> : null;
}

/**
 * What sits behind the pages: a soft, drifting wash of legend art, a faint
 * hextech lattice, a light that moves across it and a dark edge, so the
 * panels float in something instead of on a flat colour.
 */
export function Ambient({ db, route }: { db: CardDb; route: string }) {
  const fx = useEffects();
  const name = BY_ROUTE[route] ?? BY_ROUTE.home;
  const card = db.cards.find((c) => c.type === 'Legend' && c.variant === 'base' && c.name === name);
  return (
    <div className="lb-ambient" data-fx={fx} aria-hidden>
      {card && <Art card={card} />}
      <div className="lb-ambient__hex" />
      <div className="lb-ambient__sweep" />
      <div className="lb-ambient__vignette" />
    </div>
  );
}
