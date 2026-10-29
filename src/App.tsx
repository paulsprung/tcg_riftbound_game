import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FoilDefs } from './card/HoloCard.tsx';
import { Inspector, type InspectTarget } from './card/Inspector.tsx';
import { useCardDb } from './data/useCardDb.ts';
import { Lobby, LobbyTop } from './lobby/Lobby.tsx';
import { CollectionHub, type CollectionTab } from './views/CollectionHub.tsx';
import { HomeView } from './views/HomeView.tsx';
import { PacksView } from './views/PacksView.tsx';
import { ProfileView } from './views/ProfileView.tsx';
import { RulesView } from './views/RulesView.tsx';

// The play table brings the engine with it: loaded only when opened.
const PlayLobby = lazy(() => import('./views/PlayLobby.tsx').then((m) => ({ default: m.PlayLobby })));

const ROUTES = ['home', 'play', 'collection', 'shop', 'profile', 'rules'] as const;
type Route = (typeof ROUTES)[number];
const COLLECTION_TABS: CollectionTab[] = ['cards', 'packs', 'decks', 'showcase'];

interface Where { route: Route; tab: CollectionTab; sub: string; tutorial: boolean }

/** Older addresses keep working: #packs is the shop, #showcase and #cards
    live in the collection. */
function whereFromHash(): Where {
  const [id, sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const at = (route: Route, tab: CollectionTab = 'cards'): Where => ({ route, tab, sub: '', tutorial: false });
  if (id === 'packs') return at('shop');
  if (id === 'showcase') return at('collection', 'showcase');
  if (id === 'cards') return at('collection');
  const route = ROUTES.find((r) => r === id) ?? 'home';
  const tab = COLLECTION_TABS.find((t) => t === sub) ?? 'cards';
  return { route, tab: route === 'collection' ? tab : 'cards', sub, tutorial: route === 'play' && sub === 'tutorial' };
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

  const onInspect = useCallback((t: InspectTarget) => setInspect(t), []);

  return (
    <div className="app">
      <FoilDefs />
      <LobbyTop route={route} />

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
                <PlayLobby db={state.db} mode={where.sub} />
              </Suspense>
            )}
            {route === 'profile' && <ProfileView db={state.db} onInspect={onInspect} />}
            {route === 'rules' && <Lobby><RulesView /></Lobby>}
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
