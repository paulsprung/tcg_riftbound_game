import { useEffect, useState, type ReactNode } from 'react';
import { divisionProgress, rankName, tierOf } from '../economy/ranks.ts';
import { RankEmblem } from './RankEmblem.tsx';
import { HoloSwitches } from '../card/HoloSwitches.tsx';
import { useCollection } from '../collection/store.ts';
import { api } from '../net/api.ts';
import type { RatingInfo } from '../net/protocol.ts';
import { logout, useSession } from '../net/session.ts';
import { useOnline } from '../net/socket.ts';
import { DEMO, DEMO_PROFILE } from './demo.ts';
import { Icon, type IconName } from './icons.tsx';
import './lobby.css';

export const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'collection', label: 'Collection' },
  { id: 'shop', label: 'Shop' },
] as const;

const Coin = () => <span className="lb-coin" aria-hidden />;

/** The bar across the top: brand, the four places, coins, who you are. */
export function LobbyTop({ route }: { route: string }) {
  const own = useCollection();
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;
  const name = user?.name ?? (DEMO ? DEMO_PROFILE.name : 'You');

  // on a phone the tabs scroll sideways: keep the current one in view
  useEffect(() => {
    document.querySelector('.lb-nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route]);

  return (
    <header className="lb-top">
      <PlayButton active={route === 'play'} />
      <nav className="lb-nav" aria-label="Sections">
        {NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} aria-current={route === n.id ? 'page' : undefined}>{n.label}</a>
        ))}
      </nav>
      <div className="lb-top__right">
        <HoloSwitches />
        <a className="lb-pill" href="#shop" title="Your coins" aria-label={`${own.coins} coins`}>
          <Coin /> {own.coins.toLocaleString('en-US')}
        </a>
        {session.status === 'online' && !user ? (
          <a className="btn btn--primary btn--small" href="/auth/discord">Sign in with Discord</a>
        ) : (
          <a className="lb-avatar" href="#profile" aria-label={`Profile of ${name}`} aria-current={route === 'profile' ? 'page' : undefined}>
            {user?.avatar ? <img src={user.avatar} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
          </a>
        )}
        {user?.admin && <a className="lb-signout" href="#admin">Admin</a>}
        {user && <button type="button" className="lb-signout" onClick={() => { void logout(); }}>Sign out</button>}
      </div>
    </header>
  );
}

/** The way into a game, large at the top left as in the League client; while searching it counts, in a game it leads back. */
function PlayButton({ active }: { active: boolean }) {
  const ol = useOnline();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ol.queue) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ol.queue]);
  const waited = ol.queue ? Math.max(0, Math.floor((now - ol.queue.since) / 1000)) : 0;
  const state = ol.game ? 'is-live' : ol.queue ? 'is-search' : '';
  return (
    <a className={`lb-play ${state}${active ? ' is-here' : ''}`} href={ol.queue ? `#play/${ol.queue.mode}` : ol.game ? '#play/ranked' : '#play'}>
      <span className="lb-play__ring" aria-hidden />
      <strong>{ol.game ? 'In game' : ol.queue ? 'Searching' : 'Play'}</strong>
      {ol.queue && <em>{Math.floor(waited / 60)}:{String(waited % 60).padStart(2, '0')}</em>}
    </a>
  );
}

/**
 * A page of the lobby: an optional sidebar of its own and the content. The
 * page fills the window; lists inside it (`.lb-scroll`) scroll, it does not.
 * `bare` drops the chrome (a game in progress).
 */
export function Lobby({ side, sideClass = '', children, bare = false, className = '' }: {
  side?: ReactNode; sideClass?: string; children: ReactNode; bare?: boolean; className?: string;
}) {
  // the social dock hides while a game is on
  useEffect(() => {
    if (!bare) return;
    document.documentElement.dataset.bare = '';
    return () => { delete document.documentElement.dataset.bare; };
  }, [bare]);
  // One structure either way, so a game in progress is not rebuilt when the chrome goes.
  return (
    <div className={`lb-page${side ? ' has-side' : ''}${bare ? ' is-bare' : ''} ${className}`}>
      {side && <aside className={`lb-side ${sideClass}`}>{side}</aside>}
      <div className="lb-main">{children}</div>
    </div>
  );
}

export function SideTitle({ children }: { children: ReactNode }) {
  return <h2 className="lb-side__title">{children}</h2>;
}

/** A link in the sidebar. */
export function SideLink({ href, active, icon, children, soon = false, onClick }: {
  href?: string; active: boolean; icon?: IconName; children: ReactNode; soon?: boolean; onClick?: () => void;
}) {
  const inner = (
    <>
      {icon && <span className="lb-side__icon"><Icon name={icon} size={19} /></span>}
      <span>{children}</span>
      {soon && <em className="lb-soon">soon</em>}
    </>
  );
  return href
    ? <a className="lb-side__link" href={href} aria-current={active ? 'page' : undefined} onClick={onClick}>{inner}</a>
    : <button type="button" className="lb-side__link" aria-pressed={active} onClick={onClick}>{inner}</button>;
}

/** Rank panel: sample in the preview, a greyed "unranked" elsewhere. */
export function RankCard() {
  const session = useSession();
  const ol = useOnline();
  const signedIn = session.status === 'online' && !!session.user;
  const [r, setR] = useState<(RatingInfo & { wins: number }) | null>(null);
  // the standing again after each game
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api<{ ranked: RatingInfo & { wins: number } }>('GET', '/api/account/standing').then((x) => { if (alive) setR(x.ranked); }).catch(() => undefined);
    return () => { alive = false; };
  }, [signedIn, ol.end]);
  if (DEMO && !signedIn) {
    const t = tierOf(DEMO_PROFILE.rp);
    // in the preview the sample rank opens the look at all of them
    return (
      <a className="lb-rank" href="#ranks" title="All ranks and the rank-up animations">
        <RankEmblem tier={t.tier} division={t.division} size={76} />
        <strong>{rankName(t.tier, t.division)}</strong>
        <span className="muted small">{DEMO_PROFILE.rp.toLocaleString('en-US')} LP</span>
        <div className="bar"><span style={{ width: `${Math.round(divisionProgress(DEMO_PROFILE.rp) * 100)}%` }} /></div>
      </a>
    );
  }
  if (!r) {
    return (
      <div className="lb-rank is-off">
        <RankEmblem tier={null} size={76} />
        <strong>Unranked</strong>
        <span className="muted small">{signedIn ? 'Play ranked to get a rank' : 'Sign in to play ranked'}</span>
      </div>
    );
  }
  const pct = Math.round(divisionProgress(r.points) * 100);
  return (
    <div className={`lb-rank${r.placement ? ' is-off' : ''}`}>
      <RankEmblem tier={r.placement ? null : r.tier} division={r.division} size={76} />
      <strong>{r.placement ? 'Placement' : rankName(r.tier, r.division)}</strong>
      <span className="muted small">{r.placement ? `${r.games} of 5 games` : `${r.points.toLocaleString('en-US')} LP`} · {r.wins}W {r.games - r.wins}L</span>
      {!r.placement && <div className="bar"><span style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}
