import { useEffect, useMemo, useState } from 'react';
import { rankName, tierOf } from '../economy/ranks.ts';
import { RankEmblem } from '../lobby/RankEmblem.tsx';
import type { InspectTarget } from '../card/Inspector.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { DEMO, DEMO_PROFILE } from '../lobby/demo.ts';
import { Lobby } from '../lobby/Lobby.tsx';
import { api, showNotice } from '../net/api.ts';
import type { RatingInfo } from '../net/protocol.ts';
import { logout, useSession } from '../net/session.ts';
import { HeroBanner } from './HeroBanner.tsx';
import { ProfileShowcase } from './ProfileShowcase.tsx';
import { useShowcase } from './showcasePieces.ts';

type Standing = RatingInfo & { wins: number };
interface Stats { ranked: Standing; casual: Standing; tournamentsWon: number }

/** Your data (GDPR art. 15, 17, 20): download all of it, or delete the account. */
function YourData() {
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const remove = () => api('POST', '/api/account/delete', { confirm: typed })
    .then(() => { void logout(); location.hash = 'home'; location.reload(); })
    .catch((e: Error) => showNotice(e.message));
  return (
    <section className="profile__data lb-card" aria-label="Your data">
      <a className="btn btn--ghost btn--small" href="/api/account/export" download>Download my data</a>
      {confirm ? (
        <span className="profile__delete">
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type DELETE" aria-label="Type DELETE to confirm" />
          <button type="button" className="btn btn--danger btn--small" disabled={typed !== 'DELETE'} onClick={remove}>Delete my account</button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => { setConfirm(false); setTyped(''); }}>Keep it</button>
        </span>
      ) : <button type="button" className="lb-linkbtn" onClick={() => setConfirm(true)}>Delete account</button>}
      <a className="lb-linkbtn" href="#privacy">Privacy</a>
    </section>
  );
}

/** Your public face: who you are, the cards you show off, how you play. */
export function ProfileView({ db, onInspect }: { db: CardDb; onInspect: (t: InspectTarget) => void }) {
  const own = useCollection();
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;
  const name = user?.name ?? (DEMO ? DEMO_PROFILE.name : 'You');
  const pieces = useShowcase(db);
  const [st, setSt] = useState<Stats | null>(null);
  useEffect(() => {
    if (!user) return;
    api<Stats>('GET', '/api/account/standing').then(setSt).catch(() => undefined);
  }, [user]);
  const games = st ? st.ranked.games + st.casual.games : 0;
  const wins = st ? st.ranked.wins + st.casual.wins : 0;
  const rank = !st || st.ranked.games === 0 ? null : st.ranked.placement ? `Placement ${st.ranked.games}/5`
    : rankName(st.ranked.tier, st.ranked.division);
  const demoTier = tierOf(DEMO_PROFILE.rp);

  const collected = useMemo(() => {
    const ids = new Set(Object.entries(own.cards).filter(([, o]) => o.normal + o.foil > 0).map(([id]) => id));
    for (const s of own.slabs) ids.add(s.cardId);
    return ids.size;
  }, [own.cards, own.slabs]);

  const demo = DEMO && !user;
  const stats: { label: string; value: string; tone: string; off?: boolean }[] = [
    { label: 'Total matches', value: demo ? DEMO_PROFILE.matches.toLocaleString('en-US') : games ? games.toLocaleString('en-US') : '–', tone: 'text', off: !demo && !games },
    { label: 'Win rate', value: demo ? DEMO_PROFILE.winRate : games ? `${Math.round((wins / games) * 100)}%` : '–', tone: 'green', off: !demo && !games },
    { label: 'Cards collected', value: collected.toLocaleString('en-US'), tone: 'purple' },
    { label: 'Tournaments won', value: demo ? String(DEMO_PROFILE.tournaments) : String(st?.tournamentsWon ?? 0), tone: 'gold', off: !demo && !st?.tournamentsWon },
  ];

  return (
    <Lobby>
      <div className="profile">
        <HeroBanner db={db} compact>
          <div className="profile__id">
            <span className="profile__avatar">
              {user?.avatar ? <img src={user.avatar} alt="" /> : <b>{name.slice(0, 1).toUpperCase()}</b>}
            </span>
            <span className="profile__crest">
              <RankEmblem tier={demo ? demoTier.tier : st && rank && !st.ranked.placement ? st.ranked.tier : null} division={demo ? demoTier.division : st?.ranked.division} size={124} />
            </span>
            <div className="profile__who">
              <h1>{name}</h1>
              <div className="profile__meta">
                <span className={`profile__rank${demo || rank ? '' : ' is-off'}`}>
                  {demo ? rankName(demoTier.tier, demoTier.division) : rank ?? 'Unranked'}
                </span>
                {demo && <span>Level {DEMO_PROFILE.level}</span>}
                {demo && <span>Joined {DEMO_PROFILE.joined}</span>}
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
        {user && <YourData />}

      </div>
    </Lobby>
  );
}
