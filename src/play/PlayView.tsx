import { useMemo, useState } from 'react';
import type { CardDb } from '../data/types.ts';
import { GameScreen } from './GameScreen.tsx';
import { BUILT_IN_DECKS } from './host/decks.ts';
import { GameHost } from './host/GameHost.ts';
import { cardIndex } from './model/cards.ts';
import { gameSetup } from './model/setup.ts';
import { DEFAULT_CHOICE, DeckSetup, type DeckSetupChoice } from './setup/DeckSetup.tsx';
import './play.css';

/*
 * '#play' (§12.1): deck choice, then a game against the computer. The
 * route is lazy-loaded (App.tsx), so the engine stays out of the pack and
 * collection bundles. Each game is a GameHost; this view only decides
 * when to make a new one.
 */

/** A fresh seed per game. The engine itself never draws randomness from
    outside the state (P1, P11): the seed is all a game needs. */
function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

const deckOf = (id: DeckSetupChoice['mine']) => BUILT_IN_DECKS.find((b) => b.id === id)!.deck;

export function PlayView({ db }: { db: CardDb }) {
  const cards = useMemo(() => cardIndex(db), [db]);
  const [choice, setChoice] = useState<DeckSetupChoice>(DEFAULT_CHOICE);
  const [game, setGame] = useState<{ host: GameHost; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = (c: DeckSetupChoice) => {
    setChoice(c);
    try {
      const setup = gameSetup({ human: 0, mine: deckOf(c.mine), theirs: deckOf(c.theirs), champion: c.champion,
        order: c.order, seed: newSeed() }, cards);
      const host = new GameHost({ setup, human: 0, check: import.meta.env.DEV, started: new Date().toISOString() });
      setGame((g) => ({ host, n: (g?.n ?? 0) + 1 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!game) return <DeckSetup cards={cards} db={db} initial={choice} error={error} onStart={start} />;
  return (
    <GameScreen key={game.n} host={game.host} cards={cards} db={db} onNewGame={() => start(choice)}
      onChangeDecks={() => setGame(null)} />
  );
}
