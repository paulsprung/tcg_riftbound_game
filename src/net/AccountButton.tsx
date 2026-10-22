import { logout, useSession } from './session.ts';

/** Sign in with Discord, or who is signed in. Nothing at all when the app
    runs without its server. */
export function AccountButton() {
  const s = useSession();
  if (s.status !== 'online') return null;
  if (!s.user) {
    return <a className="btn btn--primary btn--small account-login" href="/auth/discord">Sign in with Discord</a>;
  }
  return (
    <div className="account">
      {s.user.avatar ? <img className="account__avatar" src={s.user.avatar} alt="" /> : <span className="account__avatar" aria-hidden />}
      <span className="account__name">{s.user.name}</span>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => { void logout(); }}>Sign out</button>
    </div>
  );
}
