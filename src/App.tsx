import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FoilDefs } from './card/HoloCard.tsx';
import { Inspector, type InspectTarget } from './card/Inspector.tsx';
import { useCollection } from './collection/store.ts';
import { useCardDb } from './data/useCardDb.ts';
import { Ambient } from './lobby/Ambient.tsx';
import { seedDemoShowcase } from './lobby/demoSeed.ts';
import { Lobby, LobbyTop } from './lobby/Lobby.tsx';
import { Social } from './lobby/Social.tsx';
import { CollectionHub, type CollectionTab } from './views/CollectionHub.tsx';
import { HomeView } from './views/HomeView.tsx';
import { PacksView } from './views/PacksView.tsx';
import { ProfileView } from './views/ProfileView.tsx';
import { RulesView } from './views/RulesView.tsx';

// The play table brings the engine with it: loaded only when opened.
// A new player sees this first, not the lobby (loaded only for them).
const Onboarding = lazy(() => import('./onboarding/Onboarding.tsx').then((m) => ({ default: m.Onboarding })));
const PlayLobby = lazy(() => import('./views/PlayLobby.tsx').then((m) => ({ default: m.PlayLobby })));

const ROUTES = ['home', 'play', 'collection', 'shop', 'profile', 'rules'] as const;
type Route = (typeof ROUTES)[number];
const COLLECTION_TABS: CollectionTab[] = ['cards', 'packs', 'decks'];

interface Where { route: Route; tab: CollectionTab; sub: string; tutorial: boolean }

/** Older addresses keep working: #packs is the shop, #showcase and #cards
    live in the collection. */
function whereFromHash(): Where {
  const [id, sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const at = (route: Route, tab: CollectionTab = 'cards'): Where => ({ route, tab, sub: '', tutorial: false });
  if (id === 'packs') return at('shop');
  if (id === 'showcase') return at('profile');
  if (id === 'cards') return at('collection');
  if (id === 'collection' && sub === 'showcase') return at('profile');
  const route = ROUTES.find((r) => r === id) ?? 'home';
  const tab = COLLECTION_TABS.find((t) => t === sub) ?? 'cards';
  return { route, tab: route === 'collection' ? tab : 'cards', sub, tutorial: route === 'play' && sub === 'tutorial' };
}

export function App() {
  const state = useCardDb();
  const [where, setWhere] = useState<Where>(whereFromHash);
  const route = where.route;
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const own = useCollection();
  // until a starter deck is taken and the tutorial played, there is no lobby
  const needsOnboarding = !(own.starter && own.tutorialDone);
  const [onboarding, setOnboarding] = useState(needsOnboarding);
  // a reset brings it back; finishing the tutorial must not end it before its reward screen
  useEffect(() => { if (needsOnboarding && !onboarding) setOnboarding(true); }, [needsOnboarding, onboarding]);
  useEffect(() => { if (state.status === 'ready') seedDemoShowcase(state.db); }, [state, own.starter]);

  useEffect(() => {
    const on = () => setWhere(whereFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const onInspect = useCallback((t: InspectTarget) => setInspect(t), []);

  return (
    <div className="app">
      <FoilDefs />
      {state.status === 'ready' && <Ambient db={state.db} route={route} />}
      {state.status === 'ready' && onboarding ? (
        <main className="main">
          <div className="lb-view">
            <Suspense fallback={<p className="status">Getting things ready…</p>}>
              <Onboarding db={state.db} onDone={(to) => { setOnboarding(false); location.hash = to; }} />
            </Suspense>
          </div>
        </main>
      ) : (
        <>
        <LobbyTop route={route} />

        <main className="main">
          <div className="lb-view">
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
              {route === 'rules' && <Lobby><div className="lb-scroll"><RulesView /></div></Lobby>}
            </>
          )}
          </div>
          <Social />
        </main>


        </>
      )}

      <footer className="foot">
        {import.meta.env.VITE_PREVIEW && <>Preview build: card art is bundled at reduced size. </>}
        Fan-made simulator, not affiliated with or endorsed by Riot Games. Riftbound, League of Legends and all
        card art are © Riot Games. Card data: Riot's card gallery and{' '}
        <a href="https://riftcodex.com" target="_blank" rel="noreferrer">Riftcodex</a>. · <a href="#rules">Rules</a>
      </footer>

      {inspect && state.status === 'ready' && (
        <Inspector target={inspect} db={state.db} onClose={() => setInspect(null)} />
      )}
    </div>
  );
}
