import { useEffect, type ReactNode } from 'react';
import { HoloSwitches } from '../card/HoloSwitches.tsx';
import { useCollection } from '../collection/store.ts';
import { logout, useSession } from '../net/session.ts';
import { DEMO, DEMO_FRIENDS, DEMO_PROFILE } from './demo.ts';
import './lobby.css';

export const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play' },
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
      <a className="lb-brand" href="#home" aria-label="Riftbound home">Riftbound</a>
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
        {user && <button type="button" className="lb-signout" onClick={() => { void logout(); }}>Sign out</button>}
        <a className="lb-icon" href="#rules" title="Rules" aria-label="Rules" aria-current={route === 'rules' ? 'page' : undefined}>?</a>
      </div>
    </header>
  );
}

/** The slim friends bar at the right edge. Friends come with online play. */
function Friends() {
  if (!DEMO) return null;
  const online = DEMO_FRIENDS.filter((f) => f.state === 'online').length;
  return (
    <aside className="lb-friends" aria-label="Friends (sample)">
      <span className="lb-friends__count" title={`${online} friends online (sample)`}>{online}</span>
      {DEMO_FRIENDS.map((f) => <i key={f.name} className={`lb-dot lb-dot--${f.state}`} title={`${f.name} · ${f.state}`} />)}
    </aside>
  );
}

/**
 * A page of the lobby: an optional sidebar of its own, the content, the
 * friends bar. `bare` drops the chrome (a game in progress).
 */
export function Lobby({ side, children, bare = false, className = '' }: {
  side?: ReactNode; children: ReactNode; bare?: boolean; className?: string;
}) {
  // One structure either way, so a game in progress is not rebuilt when the chrome goes.
  return (
    <div className={`lb-page${side ? ' has-side' : ''}${bare ? ' is-bare' : ''} ${className}`}>
      {side && <aside className="lb-side">{side}</aside>}
      <div className="lb-main">{children}</div>
      <Friends />
    </div>
  );
}

export function SideTitle({ children }: { children: ReactNode }) {
  return <h2 className="lb-side__title">{children}</h2>;
}

/** A link in the sidebar. */
export function SideLink({ href, active, icon, children, soon = false, onClick }: {
  href?: string; active: boolean; icon?: string; children: ReactNode; soon?: boolean; onClick?: () => void;
}) {
  const inner = (
    <>
      {icon && <span className="lb-side__icon" aria-hidden>{icon}</span>}
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
  if (DEMO) {
    return (
      <div className="lb-rank">
        <span className="lb-rank__badge" aria-hidden>◈</span>
        <strong>{DEMO_PROFILE.rank}</strong>
        <span className="muted small">{DEMO_PROFILE.rp.toLocaleString('en-US')} RP</span>
        <div className="bar"><span style={{ width: `${DEMO_PROFILE.rpPct}%` }} /></div>
      </div>
    );
  }
  return (
    <div className="lb-rank is-off">
      <span className="lb-rank__badge" aria-hidden>◈</span>
      <strong>Unranked</strong>
      <span className="muted small">Ranked play comes with online matches</span>
    </div>
  );
}
