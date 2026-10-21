import { useCallback, useEffect, useState } from 'react';
import { FoilDefs } from './card/HoloCard.tsx';
import { HoloSwitches } from './card/HoloSwitches.tsx';
import { Inspector, type InspectTarget } from './card/Inspector.tsx';
import { useCardDb } from './data/useCardDb.ts';
import { CardsView } from './views/CardsView.tsx';
import { CollectionView } from './views/CollectionView.tsx';
import { PacksView } from './views/PacksView.tsx';
import { RulesView } from './views/RulesView.tsx';
import { ShowcaseView } from './views/ShowcaseView.tsx';

const ROUTES = [
  { id: 'packs', label: 'Open packs', short: 'Packs' },
  { id: 'collection', label: 'Collection', short: 'Collection' },
  { id: 'showcase', label: 'Showcase', short: 'Showcase' },
  { id: 'cards', label: 'Card database', short: 'Cards' },
  { id: 'rules', label: 'Rules', short: 'Rules' },
] as const;
type Route = (typeof ROUTES)[number]['id'];

function routeFromHash(): Route {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  return (ROUTES.find((r) => r.id === id)?.id ?? 'packs') as Route;
}


export function App() {
  const state = useCardDb();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  useEffect(() => {
    const on = () => setRoute(routeFromHash());
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
        <a className="brand" href="#packs">
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
            {route === 'packs' && <PacksView db={state.db} onInspect={onInspect} />}
            {route === 'collection' && <CollectionView db={state.db} onInspect={onInspect} />}
            {route === 'showcase' && <ShowcaseView db={state.db} onInspect={onInspect} />}
            {route === 'cards' && <CardsView db={state.db} onInspect={onInspect} />}
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
