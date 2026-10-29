import { useMemo } from 'react';
import type { InspectTarget } from '../card/Inspector.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { DEMO, DEMO_PROFILE } from '../lobby/demo.ts';
import { Lobby } from '../lobby/Lobby.tsx';
import { useSession } from '../net/session.ts';
import { HeroBanner } from './HeroBanner.tsx';
import { ProfileShowcase } from './ProfileShowcase.tsx';
import { useShowcase } from './showcasePieces.ts';

/** Your public face: who you are, the cards you show off, how you play. */
export function ProfileView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const own = useCollection();
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;
  const name = user?.name ?? (DEMO ? DEMO_PROFILE.name : 'You');
  const pieces = useShowcase(db);

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
            <div className="profile__chips" aria-label="Player stats">
              {stats.map((s) => (
                <div key={s.label} className={`lb-card profile__chip${s.off ? ' is-off' : ''}`}>
                  <b className={`tone-${s.tone}`}>{s.value}</b>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </HeroBanner>

        <ProfileShowcase db={db} pieces={pieces} onInspect={onInspect} />

      </div>
    </Lobby>
  );
}
