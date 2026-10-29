import { useMemo } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { SHOWCASE_SIZE, useCollection } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { Card, CardDb } from '../data/types.ts';
import { DEMO, DEMO_PROFILE } from '../lobby/demo.ts';
import { Lobby } from '../lobby/Lobby.tsx';
import { useSession } from '../net/session.ts';
import { Slab } from '../showcase/Slab.tsx';
import type { Slab as SlabData } from '../showcase/grading.ts';
import { HeroBanner } from './HeroBanner.tsx';
import '../showcase/showcase.css';

interface Piece { key: string; card: Card; slab: SlabData | null; foil: boolean }

/** Your public face: who you are, the cards you show off, how you play. */
export function ProfileView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const own = useCollection();
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;
  const name = user?.name ?? (DEMO ? DEMO_PROFILE.name : 'You');
  const byId = useMemo(() => new Map(db.cards.map((c) => [c.id, c])), [db]);
  const slabByCert = useMemo(() => new Map(own.slabs.map((s) => [s.cert, s])), [own.slabs]);

  const pieces = own.showcase.flatMap((item): Piece[] => {
    if (item.kind === 'slab') {
      const slab = slabByCert.get(item.cert);
      const card = slab && byId.get(slab.cardId);
      return slab && card ? [{ key: `s${item.cert}`, card, slab, foil: slab.foil }] : [];
    }
    const card = byId.get(item.cardId);
    const o = own.cards[item.cardId];
    return card && o && (item.foil ? o.foil : o.normal) > 0 ? [{ key: `r${item.cardId}${item.foil}`, card, slab: null, foil: item.foil }] : [];
  }).slice(0, 4);

  const collected = useMemo(() => {
    const ids = new Set(Object.entries(own.cards).filter(([, o]) => o.normal + o.foil > 0).map(([id]) => id));
    for (const s of own.slabs) ids.add(s.cardId);
    return ids.size;
  }, [own.cards, own.slabs]);

  const stats: { label: string; value: string; tone: string; off?: boolean }[] = [
    { label: 'Total matches', value: DEMO ? DEMO_PROFILE.matches.toLocaleString('en-US') : '–', tone: 'text', off: !DEMO },
    { label: 'Win rate', value: DEMO ? DEMO_PROFILE.winRate : '–', tone: 'green', off: !DEMO },
    { label: 'Cards collected', value: collected.toLocaleString('en-US'), tone: 'purple' },
    { label: 'Tournaments won', value: DEMO ? String(DEMO_PROFILE.tournaments) : '–', tone: 'gold', off: !DEMO },
  ];

  return (
    <Lobby>
      <div className="profile">
        <HeroBanner db={db} compact>
          <div className="profile__id">
            <span className="profile__avatar">
              {user?.avatar ? <img src={user.avatar} alt="" /> : <b>{name.slice(0, 1).toUpperCase()}</b>}
            </span>
            <div className="profile__who">
              <h1>{name}</h1>
              <div className="profile__meta">
                <span className={`profile__rank${DEMO ? '' : ' is-off'}`}>◈ {DEMO ? DEMO_PROFILE.rank : 'Unranked'}</span>
                {DEMO && <span>Level {DEMO_PROFILE.level}</span>}
                {DEMO && <span>Joined {DEMO_PROFILE.joined}</span>}
              </div>
            </div>
            <button type="button" className="btn btn--ghost profile__edit" disabled title="Profiles come with accounts and online play">Edit profile</button>
          </div>
        </HeroBanner>

        <p className="lb-label profile__label">Card showcase</p>
        <div className="profile__showcase">
          {pieces.map((p) => (
            <figure key={p.key} className="profile__piece">
              {p.slab ? (
                <Slab slab={p.slab} card={p.card} width="100%" imageWidth={360}
                  onClick={() => onInspect({ card: p.card, finish: defaultFinish(p.card, p.slab!.foil), slab: p.slab! })} />
              ) : (
                <HoloCard card={p.card} finish={defaultFinish(p.card, p.foil)} width="100%" imageWidth={360}
                  onClick={() => onInspect({ card: p.card, finish: defaultFinish(p.card, p.foil) })} />
              )}
              <figcaption><strong>{p.card.name}</strong><span className="muted small">{p.slab ? `Graded ${p.slab.grade}` : p.card.rarity}</span></figcaption>
            </figure>
          ))}
          {own.showcase.length < SHOWCASE_SIZE && (
            <a className="profile__add" href="#collection/showcase"><span aria-hidden>+</span>Add card</a>
          )}
        </div>

        <p className="lb-label profile__label">Player stats</p>
        <div className="profile__stats">
          {stats.map((s) => (
            <div key={s.label} className={`lb-card profile__stat${s.off ? ' is-off' : ''}`}>
              <b className={`tone-${s.tone}`}>{s.value}</b>
              <span className="muted">{s.label}</span>
            </div>
          ))}
        </div>
        {!DEMO && <p className="muted small">Match stats, rank and level appear once online matches start.</p>}
      </div>
    </Lobby>
  );
}
