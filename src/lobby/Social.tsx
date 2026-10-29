import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { DEMO, DEMO_PROFILE, type Friend, type Presence } from './demo.ts';
import { Icon } from './icons.tsx';
import { social, useSocial } from './social.ts';

const ORDER: Presence[] = ['online', 'away', 'offline'];
const LABEL: Record<Presence, string> = { online: 'Online', away: 'Away', offline: 'Offline' };

function Avatar({ name, presence }: { name: string; presence: Presence }) {
  return (
    <span className={`soc-av soc-av--${presence}`} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
      <i />
    </span>
  );
}

/** The menu on a right click (or the ⋯ button): what you can do with a friend. */
function Menu({ friend, x, y, onClose }: { friend: Friend; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { party } = useSocial();
  const inParty = party.some((m) => m.id === friend.id);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    const off = (e: Event) => { if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('pointerdown', off, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [x, y, onClose]);

  const act = (fn: () => void) => () => { fn(); onClose(); };
  const canInvite = friend.presence !== 'offline' && !friend.doing.startsWith('In Game') && !inParty;
  return (
    <div ref={ref} className="soc-menu" role="menu" style={{ left: pos.x, top: pos.y }} aria-label={`${friend.name}`}>
      <div className="soc-menu__head"><Avatar name={friend.name} presence={friend.presence} /><div><b>{friend.name}</b><span>Level {friend.level}</span></div></div>
      <button role="menuitem" type="button" disabled={!canInvite} onClick={act(() => social.invite(friend.id))}>
        {inParty ? 'Already invited' : 'Invite to game'}
      </button>
      <button role="menuitem" type="button" onClick={act(() => social.say('Chat arrives with online play'))}>Send message</button>
      <button role="menuitem" type="button" onClick={act(() => social.say('Friend profiles arrive with online play'))}>View profile</button>
      <hr />
      <button role="menuitem" type="button" className="is-danger" onClick={act(() => social.remove(friend.id))}>Remove friend</button>
    </div>
  );
}

/**
 * The social dock at the right edge, as in the League client: a list of
 * friends by presence, a lobby you invite them to, a right-click menu. It
 * folds into a slim rail.
 */
export function Social() {
  const { open, friends, party, note } = useSocial();
  const [q, setQ] = useState('');
  const [folded, setFolded] = useState<Record<string, boolean>>({ offline: true });
  const [menu, setMenu] = useState<{ f: Friend; x: number; y: number } | null>(null);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ORDER.map((p) => ({ p, list: friends.filter((f) => f.presence === p && (!needle || f.name.toLowerCase().includes(needle))) }));
  }, [friends, q]);
  const online = friends.filter((f) => f.presence === 'online').length;
  const byId = (id: string) => friends.find((f) => f.id === id);

  const openMenu = (f: Friend, e: MouseEvent) => { e.preventDefault(); setMenu({ f, x: e.clientX, y: e.clientY }); };

  if (!DEMO) return null;
  if (!open) {
    return (
      <aside className="lb-social is-rail" aria-label="Friends">
        <button type="button" className="soc-fold" onClick={() => social.setOpen(true)} aria-label="Open friends list" title="Friends"><Icon name="chevronLeft" size={16} /></button>
        <span className="soc-count" title={`${online} friends online (sample)`}>{online}</span>
        {friends.filter((f) => f.presence !== 'offline').map((f) => (
          <button key={f.id} type="button" className="soc-rail__friend" title={`${f.name} · ${f.doing}`} onClick={() => social.setOpen(true)}
            onContextMenu={(e) => openMenu(f, e)}>
            <Avatar name={f.name} presence={f.presence} />
          </button>
        ))}
        {menu && <Menu friend={menu.f} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      </aside>
    );
  }

  return (
    <aside className="lb-social" aria-label="Friends">
      <header className="soc-head">
        <h2>Social <em>sample</em></h2>
        <button type="button" className="soc-fold" onClick={() => social.setOpen(false)} aria-label="Fold friends list" title="Fold"><Icon name="chevronRight" size={16} /></button>
      </header>

      <div className="soc-me">
        <span className="soc-av soc-av--online" aria-hidden>{DEMO_PROFILE.name.slice(0, 1)}<i /></span>
        <div><b>{DEMO_PROFILE.name}</b><span>Online · Riftbound</span></div>
      </div>

      <div className="soc-party">
        <p className="lb-label">Your lobby</p>
        <ul>
          <li><Avatar name={DEMO_PROFILE.name} presence="online" /><span>You</span><em>Leader</em></li>
          {party.map((m) => {
            const f = byId(m.id);
            return f ? (
              <li key={m.id} className={m.state === 'invited' ? 'is-wait' : ''}>
                <Avatar name={f.name} presence={f.presence} /><span>{f.name}</span>
                <em>{m.state === 'invited' ? 'Invited…' : 'Ready'}</em>
                <button type="button" aria-label={`Remove ${f.name} from the lobby`} onClick={() => social.leave(m.id)}><Icon name="close" size={12} /></button>
              </li>
            ) : null;
          })}
          {party.length === 0 && <li className="soc-party__hint">Right-click a friend to invite them.</li>}
        </ul>
      </div>

      <div className="soc-search">
        <input className="input" type="search" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends" />
      </div>

      <div className="soc-list lb-scroll">
        {groups.map(({ p, list }) => (
          <section key={p}>
            <button type="button" className="soc-group" aria-expanded={!folded[p]} onClick={() => setFolded((s) => ({ ...s, [p]: !s[p] }))}>
              <span aria-hidden>{folded[p] ? '▸' : '▾'}</span>{LABEL[p]} <b>({list.length})</b>
            </button>
            {!folded[p] && list.map((f) => (
              <div key={f.id} className={`soc-row is-${p}`} onContextMenu={(e) => openMenu(f, e)}>
                <button type="button" className="soc-row__main" onDoubleClick={() => social.say('Chat arrives with online play')}
                  onClick={(e) => openMenu(f, e)} aria-haspopup="menu">
                  <Avatar name={f.name} presence={f.presence} />
                  <span className="soc-row__text"><b>{f.name}</b><span>{party.some((m) => m.id === f.id) ? 'In your lobby' : f.doing}</span></span>
                </button>
                {p !== 'offline' && !party.some((m) => m.id === f.id) && !f.doing.startsWith('In Game') && (
                  <button type="button" className="soc-row__invite" onClick={() => social.invite(f.id)} aria-label={`Invite ${f.name}`} title="Invite to game"><Icon name="plus" size={15} /></button>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      <footer className="soc-foot">
        {note ? <span role="status" className="soc-note">{note}</span> : <span className="muted small">Friends, chat and lobbies arrive with online play.</span>}
      </footer>
      {menu && <Menu friend={menu.f} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </aside>
  );
}
