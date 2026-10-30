import { useEffect, useState } from 'react';
import { api, showNotice } from '../net/api.ts';
import { useSession } from '../net/session.ts';
import { Lobby } from '../lobby/Lobby.tsx';
import { BOOSTER_SETS } from '../pack/packConfig.ts';
import { LEGENDS } from '../decks/ownership.ts';
import { DEFAULT_BANNER, reloadHome, TONES, type HomeBanner, type NewsItem, type Tone } from '../lobby/site.ts';
import './tournaments.css';

/*
 * '#admin', for admins only (users.is_admin; the server checks every call):
 * players (find one, see their ledger, give coins or packs with a reason
 * that is kept with your name), tournaments (make one, start it early,
 * cancel it with the fees going back), and Home: the banner's words and
 * the news column (server/site.ts).
 */

interface Player { id: string; discordId: string; name: string; coins: number }
interface Entry { coins: number; packs: Record<string, number> | null; reason: string; at: number; actor: string | null }
interface Tour { id: string; name: string; status: string; startsAt: number; players: number; settings: { maxPlayers: number } }
interface PrizeRow { coins: number; set: string; packs: number }

const SETS = BOOSTER_SETS.map((b) => b.id);

function Players() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Player[]>([]);
  const [pick, setPick] = useState<Player | null>(null);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [coins, setCoins] = useState(0);
  const [set, setSet] = useState(SETS[0]);
  const [packs, setPacks] = useState(0);
  const [reason, setReason] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { api<{ users: Player[] }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => setFound(r.users)).catch(() => undefined); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const loadLedger = (p: Player) => api<{ ledger: Entry[] }>('GET', `/api/admin/ledger?userId=${p.id}`).then((r) => setLedger(r.ledger)).catch(() => setLedger([]));
  const choose = (p: Player) => { setPick(p); void loadLedger(p); };
  const grant = () => {
    if (!pick) return;
    api<{ account: { coins: number } }>('POST', '/api/admin/grant', { userId: pick.id, coins, packs: packs > 0 ? { [set]: packs } : {}, reason })
      .then((r) => {
        showNotice(`Given to ${pick.name}.`, true);
        const next = { ...pick, coins: r.account.coins };
        setPick(next); setFound((f) => f.map((x) => (x.id === pick.id ? next : x)));
        setCoins(0); setPacks(0); setReason('');
        void loadLedger(next);
      })
      .catch((e: Error) => showNotice(e.message));
  };

  return (
    <section className="adm__col lb-card">
      <h2>Players</h2>
      <input className="input" type="search" placeholder="Name or Discord ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a player" />
      <div className="adm-list lb-scroll">
        {found.map((p) => (
          <button key={p.id} type="button" className="adm-row" aria-pressed={pick?.id === p.id} onClick={() => choose(p)}>
            <span>{p.name} <span className="muted small">{p.discordId}</span></span>
            <span className="muted small">{p.coins.toLocaleString('en-US')} coins</span>
          </button>
        ))}
        {found.length === 0 && <p className="muted small">Nobody found.</p>}
      </div>
      {pick && (
        <>
          <div className="adm-form">
            <label>Coins<input className="input" type="number" min={0} value={coins} onChange={(e) => setCoins(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></label>
            <label>Packs
              <span style={{ display: 'flex', gap: 6 }}>
                <select className="input" value={set} onChange={(e) => setSet(e.target.value)}>{SETS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select>
                <input className="input" type="number" min={0} max={100} value={packs} onChange={(e) => setPacks(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              </span>
            </label>
            <label className="is-wide">Reason (kept with your name)<input className="input" value={reason} maxLength={200} placeholder="Found a bug in …" onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="btn btn--cta is-wide" disabled={!reason.trim() || (coins === 0 && packs === 0)} onClick={grant}>Give to {pick.name}</button>
          </div>
          <div className="adm-list adm-ledger lb-scroll">
            {ledger.map((e, i) => (
              <div key={i} className="adm-row">
                <span>{e.reason}{e.actor ? <span className="muted small"> · by {e.actor}</span> : null}</span>
                <span className={e.coins > 0 ? 'is-plus' : e.coins < 0 ? 'is-minus' : 'muted'}>{e.coins ? `${e.coins > 0 ? '+' : ''}${e.coins}` : ''}{e.packs ? ` ${Object.entries(e.packs).map(([s, n]) => `${n > 0 ? '+' : ''}${n} ${s}`).join(' ')}` : ''}</span>
                <span className="muted small">{new Date(e.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TournamentsAdmin() {
  const [list, setList] = useState<Tour[]>([]);
  const inAnHour = () => { const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
  const [name, setName] = useState('');
  const [at, setAt] = useState(inAnHour);
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  const [maxPlayers, setMax] = useState(32);
  const [entryFee, setFee] = useState(0);
  const [topCut, setCut] = useState<0 | 4 | 8>(0);
  const [rounds, setRounds] = useState('');
  const [noShow, setNoShow] = useState(10);
  // Limited (TR 602): the boosters' set, the build time, the pick clock
  const [format, setFormat] = useState<'constructed' | 'sealed' | 'draft'>('constructed');
  const [setId, setSetId] = useState(SETS[0]);
  const [buildMinutes, setBuild] = useState(20);
  const [pickSeconds, setPick] = useState(40);
  const [prizes, setPrizes] = useState<PrizeRow[]>([{ coins: 500, set: SETS[0], packs: 0 }]);
  const load = () => api<{ tournaments: Tour[] }>('GET', '/api/tournaments').then((r) => setList(r.tournaments)).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const create = () => {
    api('POST', '/api/admin/tournaments', {
      name, startsAt: new Date(at).getTime(),
      settings: { bestOf, maxPlayers, entryFee, topCut, rounds: rounds ? Number(rounds) : null, noShowMinutes: noShow,
        format, ...(format !== 'constructed' ? { setId, buildMinutes, pickSeconds } : {}),
        prizes: prizes.map((p) => ({ coins: p.coins, ...(p.packs > 0 ? { packs: { [p.set]: p.packs } } : {}) })) },
    }).then(() => { showNotice('Tournament made.', true); setName(''); void load(); }).catch((e: Error) => showNotice(e.message));
  };
  const act = (id: string, what: 'start' | 'cancel') => api('POST', `/api/admin/tournaments/${id}/${what}`).then(load).catch((e: Error) => showNotice(e.message));
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  return (
    <section className="adm__col lb-card">
      <h2>Tournaments</h2>
      <div className="adm-form">
        <label className="is-wide">Name<input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Friday Night Rift" /></label>
        <label>Starts<input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
        <label>Best of<select className="input" value={bestOf} onChange={(e) => setBestOf(Number(e.target.value) as 1 | 3)}><option value={1}>1</option><option value={3}>3</option></select></label>
        <label>Players (max)<input className="input" type="number" min={2} max={256} value={maxPlayers} onChange={(e) => setMax(num(e.target.value))} /></label>
        <label>Entry fee (coins)<input className="input" type="number" min={0} value={entryFee} onChange={(e) => setFee(num(e.target.value))} /></label>
        <label>Top cut<select className="input" value={topCut} onChange={(e) => setCut(Number(e.target.value) as 0 | 4 | 8)}><option value={0}>None</option><option value={4}>Top 4</option><option value={8}>Top 8</option></select></label>
        <label>Swiss rounds<input className="input" type="number" min={1} max={12} value={rounds} placeholder="auto" onChange={(e) => setRounds(e.target.value)} /></label>
        <label>No-show (minutes)<input className="input" type="number" min={1} max={30} value={noShow} onChange={(e) => setNoShow(num(e.target.value))} /></label>
        <label>Format<select className="input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
          <option value="constructed">Constructed (own decks)</option><option value="sealed">Sealed (6 boosters)</option><option value="draft">Draft (pods of 8)</option>
        </select></label>
        {format !== 'constructed' && <>
          <label>Set<select className="input" value={setId} onChange={(e) => setSetId(e.target.value)}>{SETS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></label>
          <label>Build time (minutes)<input className="input" type="number" min={5} max={60} value={buildMinutes} onChange={(e) => setBuild(num(e.target.value))} /></label>
          {format === 'draft' && <label>Pick clock (seconds)<input className="input" type="number" min={15} max={120} value={pickSeconds} onChange={(e) => setPick(num(e.target.value))} /></label>}
        </>}
        <div className="adm-prizes is-wide">
          <span className="lb-label">Prizes by place</span>
          {prizes.map((p, i) => (
            <div key={i}>
              <span>#{i + 1}</span>
              <input className="input" type="number" min={0} value={p.coins} aria-label={`Coins for place ${i + 1}`} onChange={(e) => setPrizes(prizes.map((x, k) => (k === i ? { ...x, coins: num(e.target.value) } : x)))} />
              <span style={{ display: 'flex', gap: 4 }}>
                <select className="input" value={p.set} onChange={(e) => setPrizes(prizes.map((x, k) => (k === i ? { ...x, set: e.target.value } : x)))}>{SETS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select>
                <input className="input" type="number" min={0} max={100} value={p.packs} aria-label={`Packs for place ${i + 1}`} onChange={(e) => setPrizes(prizes.map((x, k) => (k === i ? { ...x, packs: num(e.target.value) } : x)))} />
              </span>
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setPrizes(prizes.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setPrizes([...prizes, { coins: 0, set: SETS[0], packs: 0 }])}>+ Place</button>
        </div>
        <button type="button" className="btn btn--cta is-wide" disabled={!name.trim()} onClick={create}>Make tournament</button>
      </div>
      <div className="adm-list lb-scroll">
        {list.map((t) => (
          <div key={t.id} className="adm-row">
            <span>{t.name} <span className="muted small">{t.status} · {t.players}/{t.settings.maxPlayers} · {new Date(t.startsAt).toLocaleString()}</span></span>
            {t.status === 'open' && <button type="button" className="btn btn--small" onClick={() => act(t.id, 'start')}>Start now</button>}
            {(t.status === 'open' || t.status === 'running') && <button type="button" className="btn btn--ghost btn--small" onClick={() => act(t.id, 'cancel')}>Cancel</button>}
            <a className="btn btn--ghost btn--small" href={`#play/tournament/${t.id}`}>Open</a>
          </div>
        ))}
      </div>
    </section>
  );
}

const BLANK: Omit<NewsItem, 'id'> = { tag: 'Update', tone: 'purple', title: '', body: '', published: true };

/** Home: the banner over the season's art, and the news column, in its order. */
function HomeAdmin() {
  const [banner, setBanner] = useState<HomeBanner>(DEFAULT_BANNER);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [edit, setEdit] = useState<(Omit<NewsItem, 'id'> & { id?: string }) | null>(null);
  const load = () => api<{ news: NewsItem[]; home: HomeBanner | null }>('GET', '/api/admin/news')
    .then((r) => { setNews(r.news); setBanner({ ...DEFAULT_BANNER, ...(r.home ?? {}) }); }).catch((e: Error) => showNotice(e.message));
  useEffect(() => { void load(); }, []);
  const done = (msg: string) => { showNotice(msg, true); reloadHome(); void load(); };
  const field = (k: keyof HomeBanner) => (e: { target: { value: string } }) => setBanner({ ...banner, [k]: e.target.value });

  const saveBanner = () => api('PUT', '/api/admin/home', banner).then(() => done('Banner saved: Home shows it now.')).catch((e: Error) => showNotice(e.message));
  const saveNews = () => edit && api('POST', '/api/admin/news', edit).then(() => { setEdit(null); done('News saved.'); }).catch((e: Error) => showNotice(e.message));
  const remove = (n: NewsItem) => { if (confirm(`Delete “${n.title}”?`)) api('DELETE', `/api/admin/news/${n.id}`).then(() => done('News deleted.')).catch((e: Error) => showNotice(e.message)); };
  const move = (i: number, by: -1 | 1) => {
    const next = [...news];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    setNews(next);
    api('POST', '/api/admin/news/order', { ids: next.map((n) => n.id) }).then(() => reloadHome()).catch((e: Error) => showNotice(e.message));
  };
  const toggle = (n: NewsItem) => api('POST', '/api/admin/news', { ...n, published: !n.published }).then(() => done(n.published ? 'Hidden from Home.' : 'Shown on Home.')).catch((e: Error) => showNotice(e.message));

  return (
    <>
      <section className="adm__col lb-card">
        <h2>Home banner</h2>
        <p className="muted small">The big picture on Home: the art of the season's legend, with your words over it. Empty fields are left out.</p>
        <label className="adm-field">Legend (its art)
          <input className="input" list="adm-legends" value={banner.legend} onChange={field('legend')} />
          <datalist id="adm-legends">{LEGENDS.map((l) => <option key={l.id} value={l.name} />)}</datalist>
        </label>
        <label className="adm-field">Season name<input className="input" maxLength={40} value={banner.season} onChange={field('season')} /></label>
        <label className="adm-field">Kicker, small above the headline<input className="input" maxLength={40} placeholder="Update 1.4" value={banner.kicker} onChange={field('kicker')} /></label>
        <label className="adm-field">Headline (instead of the legend's name)<input className="input" maxLength={80} value={banner.headline} onChange={field('headline')} /></label>
        <label className="adm-field">Text<textarea className="input" maxLength={200} rows={2} value={banner.text} onChange={field('text')} /></label>
        <div className="adm-pair">
          <label className="adm-field">Button<input className="input" maxLength={30} placeholder="Open the shop" value={banner.button} onChange={field('button')} /></label>
          <label className="adm-field">Goes to<input className="input" maxLength={60} placeholder="#shop" value={banner.link} onChange={field('link')} /></label>
        </div>
        <div className="adm-actions">
          <button type="button" className="btn btn--cta btn--small" onClick={() => { void saveBanner(); }}>Save banner</button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setBanner(DEFAULT_BANNER)}>Back to the default</button>
        </div>
      </section>

      <section className="adm__col lb-card">
        <div className="adm-head">
          <h2>News</h2>
          <button type="button" className="btn btn--primary btn--small" onClick={() => setEdit({ ...BLANK })}>New</button>
        </div>
        {edit && (
          <div className="adm-news-edit">
            <div className="adm-pair">
              <label className="adm-field">Tag<input className="input" maxLength={20} value={edit.tag} onChange={(e) => setEdit({ ...edit, tag: e.target.value })} /></label>
              <label className="adm-field">Colour
                <select className="input" value={edit.tone} onChange={(e) => setEdit({ ...edit, tone: e.target.value as Tone })}>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <label className="adm-field">Title<input className="input" maxLength={80} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
            <label className="adm-field">Text<textarea className="input" maxLength={400} rows={3} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
            <label className="adm-check"><input type="checkbox" checked={edit.published !== false} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} /> Show on Home</label>
            <div className="adm-actions">
              <button type="button" className="btn btn--cta btn--small" onClick={() => { void saveNews(); }}>{edit.id ? 'Save' : 'Post'}</button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="adm-list lb-scroll">
          {news.length === 0 && <p className="muted small">No news yet: Home shows none until you post some.</p>}
          {news.map((n, i) => (
            <div key={n.id} className={`adm-news${n.published ? '' : ' is-hidden'}`}>
              <span className={`home-tag home-tag--${n.tone}`}>{n.tag}</span>
              <strong>{n.title}</strong>
              <p className="muted small">{n.body}</p>
              <div className="adm-actions">
                <button type="button" className="btn btn--ghost btn--small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up">↑</button>
                <button type="button" className="btn btn--ghost btn--small" disabled={i === news.length - 1} onClick={() => move(i, 1)} aria-label="Down">↓</button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setEdit(n)}>Edit</button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => { void toggle(n); }}>{n.published ? 'Hide' : 'Show'}</button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => remove(n)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function AdminView() {
  const session = useSession();
  const admin = session.status === 'online' && !!session.user?.admin;
  const [tab, setTab] = useState<'players' | 'home'>('players');
  return (
    <Lobby>
      <section className="adm lb-col">
        <div className="lb-head">
          <h1>Admin</h1>
          {admin && (
            <div className="seg seg--format" role="tablist" aria-label="Admin">
              <button type="button" role="tab" aria-selected={tab === 'players'} aria-pressed={tab === 'players'} onClick={() => setTab('players')}>Players &amp; tournaments</button>
              <button type="button" role="tab" aria-selected={tab === 'home'} aria-pressed={tab === 'home'} onClick={() => setTab('home')}>Home &amp; news</button>
            </div>
          )}
        </div>
        {!admin ? <p className="muted">Admins only.</p>
          : tab === 'players' ? <div className="adm__cols"><Players /><TournamentsAdmin /></div>
            : <div className="adm__cols"><HomeAdmin /></div>}
      </section>
    </Lobby>
  );
}
