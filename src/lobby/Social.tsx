import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Presence } from '../net/protocol.ts';
import { useSession } from '../net/session.ts';
import { DEMO, DEMO_PROFILE } from './demo.ts';
import { Icon } from './icons.tsx';
import { viewport } from './scale.ts';
import { lobbyModeHere, social, useSocial, type Friend } from './social.ts';

const STATUS: Record<Presence, string> = { online: 'Online', queue: 'Looking for a match', game: 'In a game', offline: 'Offline' };
const GROUPS: { id: string; label: string; has: (p: Presence) => boolean }[] = [
  { id: 'online', label: 'Online', has: (p) => p === 'online' || p === 'queue' },
  { id: 'game', label: 'In a game', has: (p) => p === 'game' },
  { id: 'offline', label: 'Offline', has: (p) => p === 'offline' },
];
const dot = (p: Presence) => (p === 'offline' ? 'offline' : p === 'game' ? 'away' : 'online');

function Avatar({ name, avatar, presence }: { name: string; avatar?: string | null; presence: Presence }) {
  return (
    <span className={`soc-av soc-av--${dot(presence)}`} aria-hidden>
      {avatar ? <img src={avatar} alt="" /> : name.slice(0, 1).toUpperCase()}
      <i />
    </span>
  );
}

/** The menu on a right click (or a click): what you can do with a friend. */
function Menu({ friend, x, y, onClose }: { friend: Friend; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { lobby } = useSocial();
  const [pos, setPos] = useState({ x, y });
  const [sure, setSure] = useState(false);

  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    const { s, w, h } = viewport();
    if (r) setPos({ x: Math.min(x / s, w - r.width / s - 8), y: Math.min(y / s, h - r.height / s - 8) });
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

  const inLobby = !!lobby?.members.some((m) => m.id === friend.id);
  return (
    <div ref={ref} className="soc-menu" role="menu" style={{ left: pos.x, top: pos.y }} aria-label={friend.name}>
      <div className="soc-menu__head"><Avatar name={friend.name} avatar={friend.avatar} presence={friend.presence} /><div><b>{friend.name}</b><span>{STATUS[friend.presence]}</span></div></div>
      {inLobby ? (
        <button role="menuitem" type="button" onClick={() => { social.kick(friend.id); onClose(); }}>Remove from lobby</button>
      ) : (
        <button role="menuitem" type="button" disabled={!canInvite(friend, lobby)} onClick={() => { social.invite(friend.id); onClose(); }}>Invite to lobby</button>
      )}
      <hr />
      {sure ? (
        <button role="menuitem" type="button" className="is-danger" onClick={() => { social.remove(friend.id); onClose(); }}>Remove {friend.name}?</button>
      ) : (
        <button role="menuitem" type="button" className="is-danger" onClick={() => setSure(true)}>Remove friend</button>
      )}
    </div>
  );
}

/** Can this friend be invited now: online and free, from the custom game or casual (or into your lobby). */
function canInvite(f: Friend, lobby: ReturnType<typeof useSocial>['lobby']): boolean {
  if (f.presence !== 'online') return false;
  if (lobby) return lobby.members.length + lobby.invited.length < lobby.max && !lobby.invited.some((i) => i.id === f.id);
  return lobbyModeHere() !== null;
}

/** A friend invites you to their lobby: join it, or not. */
function LobbyInvite() {
  const { invite } = useSocial();
  if (!invite) return null;
  return (
    <div className="soc-challenge lb-card" role="alertdialog" aria-label={`${invite.from.name} invites you`}>
      <b>{invite.from.name}</b><span>invites you to {invite.mode === 'casual' ? 'a casual 2v2 lobby' : 'a custom game'}</span>
      <span className="soc-challenge__btns">
        <button type="button" className="btn btn--cta btn--small" onClick={() => social.answer(true)}>Join</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => social.answer(false)}>Decline</button>
      </span>
    </div>
  );
}

/**
 * The social dock at the right edge, as in the League client: friends by
 * presence, requests, your friend code, your lobby, a right-click menu to
 * invite or remove. It folds into a slim rail. Signed in, all of it is real; the
 * preview shows sample friends.
 */
export function Social() {
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;
  const { open, live, code, friends, incoming, outgoing, lobby, note } = useSocial();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState('');
  const [folded, setFolded] = useState<Record<string, boolean>>({ offline: true });
  const [menu, setMenu] = useState<{ f: Friend; x: number; y: number } | null>(null);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return GROUPS.map((g) => ({ ...g, list: friends.filter((f) => g.has(f.presence) && (!needle || f.name.toLowerCase().includes(needle))) }));
  }, [friends, q]);
  const on = friends.filter((f) => f.presence !== 'offline').length;
  const openMenu = (f: Friend, e: MouseEvent) => { e.preventDefault(); setMenu({ f, x: e.clientX, y: e.clientY }); };

  if (!user && !DEMO) return null;
  const me = user?.name ?? DEMO_PROFILE.name;

  return (
    <div className={`lb-social${open ? ' is-open' : ''}`}>
      {/* the slim rail always keeps its place; the panel opens over the page, it does not push it */}
      <aside className="soc-rail" aria-label="Friends">
        <button type="button" className="soc-fold" onClick={() => social.setOpen(true)} aria-label="Open friends list" title="Friends"><Icon name="chevronLeft" size={16} /></button>
        <span className="soc-count" title={`${on} friends online`}>{on}</span>
        {incoming.length > 0 && <span className="soc-count soc-count--req" title={`${incoming.length} friend requests`}>+{incoming.length}</span>}
        {friends.filter((f) => f.presence !== 'offline').map((f) => (
          <button key={f.id} type="button" className="soc-rail__friend" title={`${f.name} · ${STATUS[f.presence]}`} onClick={() => social.setOpen(true)}
            onContextMenu={(e) => openMenu(f, e)}>
            <Avatar name={f.name} avatar={f.avatar} presence={f.presence} />
          </button>
        ))}
      </aside>
      {open && (
        <aside className="soc-panel" aria-label="Friends">
          <header className="soc-head">
            <h2>Social{!live && <em>sample</em>}</h2>
            <button type="button" className="soc-fold" onClick={() => social.setOpen(false)} aria-label="Fold friends list" title="Fold"><Icon name="chevronRight" size={16} /></button>
          </header>

          <div className="soc-me">
            <span className="soc-av soc-av--online" aria-hidden>{user?.avatar ? <img src={user.avatar} alt="" /> : me.slice(0, 1)}<i /></span>
            <div><b>{me}</b>{live && <span className="soc-code" title="Your friend code">{code.slice(0, 4)}-{code.slice(4)}
              <button type="button" aria-label="Copy your friend code" onClick={() => { void navigator.clipboard?.writeText(code).then(() => social.say('Code copied')); }}>⧉</button></span>}</div>
          </div>

          {live && (
            <form className="soc-add" onSubmit={(e) => { e.preventDefault(); void social.add(adding).then((ok) => ok && setAdding('')); }}>
              <input className="input" value={adding} onChange={(e) => setAdding(e.target.value.toUpperCase())} placeholder="Friend code" maxLength={9} aria-label="Friend code" />
              <button type="submit" className="btn btn--small" disabled={adding.replace(/[^A-Z0-9]/g, '').length !== 8}>Add</button>
            </form>
          )}

          {lobby && (
            <div className="soc-party">
              <p className="lb-label">Your lobby</p>
              {lobby.members.map((m) => (
                <div key={m.id} className="soc-req">
                  <Avatar name={m.name} presence="online" /><span>{m.name}</span>
                  <em>{m.host ? 'Host' : m.ready ? 'Ready' : 'Not ready'}</em>
                </div>
              ))}
              {lobby.invited.map((i) => (
                <div key={i.id} className="soc-req is-wait"><Avatar name={i.name} presence="offline" /><span>{i.name}</span><em>Invited…</em></div>
              ))}
              <button type="button" className="lb-linkbtn" onClick={() => social.leave()}>Leave lobby</button>
            </div>
          )}

          {(incoming.length > 0 || outgoing.length > 0) && (
            <div className="soc-party">
              {incoming.map((p) => (
                <div key={p.id} className="soc-req">
                  <Avatar name={p.name} avatar={p.avatar} presence="online" /><span>{p.name}</span>
                  <button type="button" className="btn btn--cta btn--small" onClick={() => social.accept(p.id)}>Accept</button>
                  <button type="button" className="icon-btn" aria-label={`Decline ${p.name}`} onClick={() => social.remove(p.id)}><Icon name="close" size={12} /></button>
                </div>
              ))}
              {outgoing.map((p) => (
                <div key={p.id} className="soc-req is-wait">
                  <Avatar name={p.name} avatar={p.avatar} presence="offline" /><span>{p.name}</span><em>Requested</em>
                  <button type="button" className="icon-btn" aria-label={`Take back the request to ${p.name}`} onClick={() => social.remove(p.id)}><Icon name="close" size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="soc-search">
            <input className="input" type="search" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends" />
          </div>

          <div className="soc-list lb-scroll">
            {groups.map(({ id, label, list }) => (
              <section key={id}>
                <button type="button" className="soc-group" aria-expanded={!folded[id]} onClick={() => setFolded((s) => ({ ...s, [id]: !s[id] }))}>
                  <span aria-hidden>{folded[id] ? '▸' : '▾'}</span>{label} <b>({list.length})</b>
                </button>
                {!folded[id] && list.map((f) => (
                  <div key={f.id} className={`soc-row is-${f.presence === 'offline' ? 'offline' : 'online'}`} onContextMenu={(e) => openMenu(f, e)}>
                    <button type="button" className="soc-row__main" onClick={(e) => openMenu(f, e)} aria-haspopup="menu">
                      <Avatar name={f.name} avatar={f.avatar} presence={f.presence} />
                      <span className="soc-row__text"><b>{f.name}</b><span>{lobby?.members.some((m) => m.id === f.id) ? 'In your lobby' : lobby?.invited.some((i) => i.id === f.id) ? 'Invited' : STATUS[f.presence]}</span></span>
                    </button>
                    {canInvite(f, lobby) && (
                      <button type="button" className="soc-row__invite" onClick={() => social.invite(f.id)} aria-label={`Invite ${f.name}`} title="Invite to lobby"><Icon name="plus" size={15} /></button>
                    )}
                  </div>
                ))}
              </section>
            ))}
            {live && friends.length === 0 && <p className="muted small soc-empty">Add a friend with their code.</p>}
          </div>

          <footer className="soc-foot">{note && <span role="status" className="soc-note">{note}</span>}</footer>
        </aside>
      )}
      <LobbyInvite />
      {menu && <Menu friend={menu.f} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
