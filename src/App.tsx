import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FoilDefs } from './card/HoloCard.tsx';
import { HoloSwitches } from './card/HoloSwitches.tsx';
import { AccountButton } from './net/AccountButton.tsx';
import { Inspector, type InspectTarget } from './card/Inspector.tsx';
import { useCardDb } from './data/useCardDb.ts';
import { CollectionHub, type CollectionTab } from './views/CollectionHub.tsx';
import { HomeView } from './views/HomeView.tsx';
import { PacksView } from './views/PacksView.tsx';
import { RulesView } from './views/RulesView.tsx';

// The play table brings the engine with it: loaded only when opened.
const PlayView = lazy(() => import('./play/PlayView.tsx').then((m) => ({ default: m.PlayView })));

const ROUTES = [
  { id: 'home', label: 'Home', short: 'Home' },
  { id: 'collection', label: 'Collection', short: 'Collection' },
  { id: 'shop', label: 'Shop', short: 'Shop' },
  { id: 'play', label: 'Play', short: 'Play' },
  { id: 'rules', label: 'Rules', short: 'Rules' },
] as const;
type Route = (typeof ROUTES)[number]['id'];

interface Where { route: Route; tab: CollectionTab; tutorial: boolean }

/** Older addresses keep working: #packs is the shop, #showcase and #cards
    live in the collection. */
function whereFromHash(): Where {
  const [id, sub] = location.hash.replace(/^#\/?/, '').split('/');
  if (id === 'packs') return { route: 'shop', tab: 'cards', tutorial: false };
  if (id === 'showcase') return { route: 'collection', tab: 'showcase', tutorial: false };
  if (id === 'cards') return { route: 'collection', tab: 'all', tutorial: false };
  const route = (ROUTES.find((r) => r.id === id)?.id ?? 'home') as Route;
  return { route, tab: route === 'collection' && (sub === 'showcase' || sub === 'all') ? sub : 'cards',
    tutorial: route === 'play' && sub === 'tutorial' };
}

export function App() {
  const state = useCardDb();
  const [where, setWhere] = useState<Where>(whereFromHash);
  const route = where.route;
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  useEffect(() => {
    const on = () => setWhere(whereFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // on a phone the tabs scroll sideways: keep the current one in view
  useEffect(() => {
    document.querySelector('.nav__link[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route]);


  const onInspect = useCallback((t: InspectTarget) => setInspect(t), []);

  return (
    <div className="app">
      <FoilDefs />
      <header className="top">
        <a className="brand" href="#home">
          <span className="brand__mark" aria-hidden>◆</span>
          <span className="brand__name">Riftbound <em>Simulator</em></span>
        </a>
        <nav className="nav" aria-label="Sections">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#${r.id}`} className="nav__link" aria-label={r.label} aria-current={route === r.id ? 'page' : undefined}>
              <span className="nav__long">{r.label}</span><span className="nav__short">{r.short}</span>
            </a>
          ))}
        </nav>
        <HoloSwitches />
        <AccountButton />
      </header>

      <main className="main">
        {state.status === 'loading' && <p className="status">Loading cards…</p>}
        {state.status === 'missing' && (
          <div className="status status--error">
            <h2>No card data yet</h2>
            <p>Run <code>npm run fetch-cards</code> to download the card list, then reload.</p>
            <p className="muted">({state.error})</p>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            {route === 'home' && <HomeView db={state.db} />}
            {route === 'shop' && <PacksView db={state.db} onInspect={onInspect} />}
            {route === 'collection' && <CollectionHub db={state.db} tab={where.tab} onInspect={onInspect} />}
            {route === 'play' && (
              <Suspense fallback={<p className="status">Setting up the table…</p>}>
                <PlayView key={where.tutorial ? 'tutorial' : 'play'} db={state.db} tutorial={where.tutorial} />
              </Suspense>
            )}
            {route === 'rules' && <RulesView />}
          </>
        )}
      </main>

      <footer className="foot">
        {import.meta.env.VITE_PREVIEW && <>Preview build: card art is bundled at reduced size. </>}
        Fan-made simulator, not affiliated with or endorsed by Riot Games. Riftbound, League of Legends and all
        card art are © Riot Games. Card data: Riot's card gallery and{' '}
        <a href="https://riftcodex.com" target="_blank" rel="noreferrer">Riftcodex</a>.
      </footer>

      {inspect && state.status === 'ready' && (
        <Inspector target={inspect} db={state.db} onClose={() => setInspect(null)} />
      )}
    </div>
  );
}
