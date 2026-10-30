import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { setEffects, useEffects } from '../card/effects.ts';
import { api, showNotice } from '../net/api.ts';
import { logout, useSession } from '../net/session.ts';
import { setSettings, usePlaySettings, type PaceChoice } from '../play/settings.ts';
import { Icon } from './icons.tsx';

/*
 * Settings, from the button left of your picture: a window in the middle of
 * the screen with everything you can set. Display (card effects), play (how
 * fast the computer plays, rule numbers in the log), and your account: the
 * admin page, your data (GDPR art. 15, 17, 20: all of it as a download, or
 * the account deleted) and signing out.
 */

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg seg--format" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

function Row({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <span><b>{title}</b><small>{note}</small></span>
      {children}
    </div>
  );
}

function SettingsWindow({ onClose }: { onClose: () => void }) {
  const fx = useEffects();
  const play = usePlaySettings();
  const session = useSession();
  const user = session.status === 'online' ? session.user : null;
  const [sure, setSure] = useState(false);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const remove = () => api('POST', '/api/account/delete', { confirm: typed })
    .then(() => { void logout(); location.hash = 'home'; location.reload(); })
    .catch((e: Error) => showNotice(e.message));
  const go = (hash: string) => () => { location.hash = hash; onClose(); };

  return createPortal(
    <div className="ds-modal set-modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="ds-modal__panel set-panel lb-card" onClick={(e) => e.stopPropagation()}>
        <header className="ds-modal__head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <section className="set-group">
          <p className="lb-label">Display</p>
          <Row title="Card effects" note="Foil, tilt and the animations around them. Off: still, flat cards.">
            <Seg label="Card effects" value={fx} options={[['on', 'On'], ['off', 'Off']]} onChange={setEffects} />
          </Row>
        </section>

        <section className="set-group">
          <p className="lb-label">Play</p>
          <Row title="Computer's speed" note="How fast the computer and its animations play.">
            <Seg label="Computer's speed" value={play.pace} options={[['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] as [PaceChoice, string][]}
              onChange={(pace) => setSettings({ pace })} />
          </Row>
          <Row title="Rule numbers" note="Show the rule behind each step in the game log.">
            <Seg label="Rule numbers" value={play.rules ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => setSettings({ rules: v === 'on' })} />
          </Row>
        </section>

        {user && (
          <section className="set-group">
            <p className="lb-label">Account</p>
            <Row title={user.name} note="Signed in with Discord.">
              <span className="set-btns">
                {user.admin && <button type="button" className="btn btn--small" onClick={go('admin')}>Admin</button>}
                <button type="button" className="btn btn--ghost btn--small" onClick={() => { void logout(); }}>Sign out</button>
              </span>
            </Row>
            <Row title="Your data" note="Everything kept about you, as a file; or the account deleted for good.">
              <span className="set-btns">
                <a className="btn btn--ghost btn--small" href="/api/account/export" download>Download</a>
                {!sure && <button type="button" className="btn btn--ghost btn--small set-danger" onClick={() => setSure(true)}>Delete account</button>}
              </span>
            </Row>
            {sure && (
              <div className="set-delete">
                <small>Your account and everything in it go for good: cards, coins, decks, ratings. Type DELETE to confirm.</small>
                <span className="set-btns">
                  <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
                  <button type="button" className="btn btn--danger btn--small" disabled={typed !== 'DELETE'} onClick={() => { void remove(); }}>Delete my account</button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => { setSure(false); setTyped(''); }}>Keep it</button>
                </span>
              </div>
            )}
          </section>
        )}

        <footer className="set-foot">
          <button type="button" className="lb-linkbtn" onClick={go('rules')}>Rules</button>
          <button type="button" className="lb-linkbtn" onClick={go('privacy')}>Privacy</button>
          <button type="button" className="lb-linkbtn" onClick={go('imprint')}>Legal notice</button>
          <button type="button" className="btn btn--cta btn--small" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** The button in the top bar; the window opens over everything. */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lb-settings__btn" aria-label="Settings" title="Settings" onClick={() => setOpen(true)}>
        <Icon name="sliders" size={17} />
      </button>
      {open && <SettingsWindow onClose={() => setOpen(false)} />}
    </>
  );
}
