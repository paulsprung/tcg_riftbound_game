import { useEffect, type ReactNode } from 'react';
import { HoloSwitches } from '../card/HoloSwitches.tsx';
import { useCollection } from '../collection/store.ts';
import { logout, useSession } from '../net/session.ts';
import { DEMO, DEMO_PROFILE } from './demo.ts';
import { Icon, type IconName } from './icons.tsx';
import { social, useSocial } from './social.ts';
import './lobby.css';

export const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play' },
  { id: 'collection', label: 'Collection' },
  { id: 'shop', label: 'Shop' },
] as const;

const Coin = () => <span className="lb-coin" aria-hidden />;

/** The hextech mark in front of the name. */
const Emblem = () => (
  <svg className="lb-emblem" viewBox="0 0 32 32" aria-hidden>
    <defs>
      <linearGradient id="lb-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f0e6d2" /><stop offset=".5" stopColor="#c8aa6e" /><stop offset="1" stopColor="#785a28" />
      </linearGradient>
    </defs>
    <polygon points="16,1.5 28.5,8.75 28.5,23.25 16,30.5 3.5,23.25 3.5,8.75" fill="#0a1428" stroke="url(#lb-g)" strokeWidth="1.6" />
    <polygon points="16,7 23.8,11.5 23.8,20.5 16,25 8.2,20.5 8.2,11.5" fill="none" stroke="#0ac8b9" strokeWidth="1" opacity=".85" />
    <path d="M16 11 L19.2 16 L16 21 L12.8 16 Z" fill="url(#lb-g)" />
  </svg>
);

/** The bar across the top: brand, the four places, coins, who you are. */
export function LobbyTop({ route }: { route: string }) {
  const own = useCollection();
  const session = useSession();
  const { open, friends } = useSocial();
  const user = session.status === 'online' ? session.user : null;
  const name = user?.name ?? (DEMO ? DEMO_PROFILE.name : 'You');
  const online = friends.filter((f) => f.presence === 'online').length;

  // on a phone the tabs scroll sideways: keep the current one in view
  useEffect(() => {
    document.querySelector('.lb-nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route]);

  return (
    <header className="lb-top">
      <a className="lb-brand" href="#home" aria-label="Riftbound home"><Emblem /><span>Riftbound</span></a>
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
        {DEMO && (
          <button type="button" className="lb-icon lb-icon--social" aria-label="Friends" aria-pressed={open} title="Friends"
            onClick={() => social.setOpen(!open)}>
            <Icon name="users" size={20} />
            {online > 0 && <em>{online}</em>}
          </button>
        )}
        {session.status === 'online' && !user ? (
          <a className="btn btn--primary btn--small" href="/auth/discord">Sign in with Discord</a>
        ) : (
          <a className="lb-avatar" href="#profile" aria-label={`Profile of ${name}`} aria-current={route === 'profile' ? 'page' : undefined}>
            {user?.avatar ? <img src={user.avatar} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
          </a>
        )}
        {user && <button type="button" className="lb-signout" onClick={() => { void logout(); }}>Sign out</button>}
      </div>
    </header>
  );
}

/**
 * A page of the lobby: an optional sidebar of its own and the content. The
 * page fills the window; lists inside it (`.lb-scroll`) scroll, it does not.
 * `bare` drops the chrome (a game in progress).
 */
export function Lobby({ side, children, bare = false, className = '' }: {
  side?: ReactNode; children: ReactNode; bare?: boolean; className?: string;
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
      {side && <aside className="lb-side">{side}</aside>}
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
