import { useEffect, useRef, useState } from 'react';
import { setEffects, useEffects } from '../card/effects.ts';
import { api, showNotice } from '../net/api.ts';
import { logout, useSession } from '../net/session.ts';
import { Icon } from './icons.tsx';

/*
 * The gear left of your picture: how the app looks and moves (card effects),
 * and your account: the admin page, your data (GDPR art. 15, 17, 20: all of
 * it as a download, or the account deleted) and signing out.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const [typed, setTyped] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const fx = useEffects();
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;

  useEffect(() => {
    if (!open) { setSure(false); setTyped(''); return; }
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const remove = () => api('POST', '/api/account/delete', { confirm: typed })
    .then(() => { void logout(); location.hash = 'home'; location.reload(); })
    .catch((e: Error) => showNotice(e.message));

  return (
    <div className="lb-settings" ref={box}>
      <button type="button" className="lb-settings__btn" aria-label="Settings" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="gear" size={19} />
      </button>
      {open && (
        <div className="lb-settings__menu lb-card" role="menu" aria-label="Settings">
          <p className="lb-settings__head">Display</p>
          <div className="lb-settings__row">
            <span>
              <b>Card effects</b>
              <small>Foil, tilt and the animations around them</small>
            </span>
            <div className="seg seg--format" role="group" aria-label="Card effects">
              {(['on', 'off'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={fx === v} onClick={() => setEffects(v)}>{v === 'on' ? 'On' : 'Off'}</button>
              ))}
            </div>
          </div>

          {user && (
            <>
              <p className="lb-settings__head">Account</p>
              {user.admin && <a role="menuitem" className="lb-settings__item" href="#admin" onClick={() => setOpen(false)}>Admin</a>}
              <a role="menuitem" className="lb-settings__item" href="/api/account/export" download>Download my data</a>
              {sure ? (
                <div className="lb-settings__danger">
                  <small>Your account and everything in it go for good. Type DELETE to confirm.</small>
                  <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
                  <span className="lb-settings__btns">
                    <button type="button" className="btn btn--danger btn--small" disabled={typed !== 'DELETE'} onClick={() => { void remove(); }}>Delete my account</button>
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setSure(false)}>Keep it</button>
                  </span>
                </div>
              ) : (
                <button type="button" role="menuitem" className="lb-settings__item is-danger" onClick={() => setSure(true)}>Delete account…</button>
              )}
              <button type="button" role="menuitem" className="lb-settings__item" onClick={() => { void logout(); }}>Sign out</button>
            </>
          )}
          <p className="lb-settings__foot">
            <a href="#privacy" onClick={() => setOpen(false)}>Privacy</a> · <a href="#imprint" onClick={() => setOpen(false)}>Legal notice</a> · <a href="#rules" onClick={() => setOpen(false)}>Rules</a>
          </p>
        </div>
      )}
    </div>
  );
}
