import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardDb } from '../data/types.ts';
import type { GameRecord } from '../game/index.ts';
import { GameScreen } from './GameScreen.tsx';
import { createAi, type AiClient } from './host/aiClient.ts';
import { localStore, resumable, savedSeat, type SavedGame, type SaveStore } from './host/autosave.ts';
import { BUILT_IN_DECKS } from './host/decks.ts';
import { GameHost, type HostOptions, type SaveInfo, type Seat } from './host/GameHost.ts';
import { cardIndex } from './model/cards.ts';
import { gameSetup } from './model/setup.ts';
import { getSettings, PACE_FACTOR, setSettings, usePlaySettings, type OpponentChoice } from './settings.ts';
import { DEFAULT_CHOICE, DeckSetup, type DeckSetupChoice } from './setup/DeckSetup.tsx';
import { TutorialView } from './tutorial/TutorialView.tsx';
import { useCollection } from '../collection/store.ts';
import './play.css';

/*
 * '#play' (§12.1): deck and opponent choice (the computer at Beginner or
 * Normal, or hot-seat), then a game. The route is lazy-loaded (App.tsx),
 * so the engine stays out of the pack and collection bundles. Each game is
 * a GameHost; this view decides when to make one, starts the computer's
 * worker once (falling back to this thread when the page can't run one),
 * autosaves every answer and offers to resume a saved game.
 */

/** A fresh seed per game. The engine itself never draws randomness from
    outside the state (P1, P11): the seed is all a game needs. */
function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

const deckOf = (id: DeckSetupChoice['mine']) => BUILT_IN_DECKS.find((b) => b.id === id)!.deck;

const LEVEL_NAME = { beginner: 'Beginner', normal: 'Normal' } as const;

export function seatsFor(o: OpponentChoice): [Seat, Seat] {
  return o === 'hotseat' ? [{ k: 'human' }, { k: 'human' }] : [{ k: 'human' }, { k: 'ai', level: o }];
}

export function seatName(seats: readonly Seat[], p: number): string {
  const s = seats[p];
  const hot = seats.every((x) => x.k === 'human');
  if (s.k === 'human') return hot ? `Player ${p + 1}` : 'You';
  if (s.k === 'ai') return `Computer (${LEVEL_NAME[s.level]})`;
  if (s.k === 'bot') return 'Simple bot';
  return s.name ?? 'Opponent';
}

function saveTo(store: SaveStore, seats: [Seat, Seat]) {
  const saved = seats.map(savedSeat);
  if (saved.some((s) => s === null)) return undefined;              // scripted games are never saved
  return (r: GameRecord, at: SaveInfo) => {
    if (at.over) { store.clear(); return; }
    const title = r.setup.decks.map((d) => d.name.replace(/ Showdown Deck$/, '')).join(' vs ');
    const g: SavedGame = { v: 1, record: r, seats: saved as SavedGame['seats'], savedAt: new Date().toISOString(), title,
      turn: at.turn, points: at.points };
    store.save(g);
  };
}

export function PlayView({ db, tutorial = false }: { db: CardDb; tutorial?: boolean }) {
  const cards = useMemo(() => cardIndex(db), [db]);
  const own = useCollection();
  const settings = usePlaySettings();
  const store = useMemo(() => localStore(), []);
  const [choice, setChoice] = useState<DeckSetupChoice>({ ...DEFAULT_CHOICE, opponent: getSettings().opponent });
  const [game, setGame] = useState<{ host: GameHost; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedGame | null>(() => store.load());
  const ai = useRef<AiClient | null>(null);

  useEffect(() => {
    let alive = true;
    createAi().then((c) => { if (alive) ai.current = c; else c.dispose(); }, () => {});
    return () => { alive = false; ai.current?.dispose(); ai.current = null; };
  }, []);
  useEffect(() => { game?.host.setPace(PACE_FACTOR[settings.pace]); }, [game, settings.pace]);

  const options = (seats: [Seat, Seat]): Omit<HostOptions, 'setup'> => ({
    seats, ai: ai.current ?? undefined, check: import.meta.env.DEV, onSave: saveTo(store, seats),
    pace: PACE_FACTOR[getSettings().pace],
  });

  const show = (host: GameHost) => {
    setGame((g) => ({ host, n: (g?.n ?? 0) + 1 }));
    setError(null);
  };

  const start = (c: DeckSetupChoice) => {
    setChoice(c);
    setSettings({ opponent: c.opponent });
    try {
      const setup = gameSetup({ human: 0, mine: deckOf(c.mine), theirs: deckOf(c.theirs), champion: c.champion,
        order: c.order, seed: newSeed() }, cards);
      const seats = seatsFor(c.opponent);
      show(new GameHost({ ...options(seats), setup, started: new Date().toISOString() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const resume = (g: SavedGame) => {
    try {
      show(GameHost.fromRecord(g.record, options(g.seats)));
    } catch (e) {
      store.clear();
      setSaved(null);
      setError(`The saved game can't be resumed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const load = (r: GameRecord, seats: [Seat, Seat]) => {
    try {
      show(GameHost.fromRecord(r, options(seats)));
    } catch (e) {
      setError(`That record can't be loaded: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (tutorial) return <TutorialView db={db} cards={cards} onExit={() => { location.hash = 'play'; }} />;

  if (!game) {
    return (
      <>
        {!own.tutorialDone && (
          <div className="tutorial-offer">
            <div>
              <strong>New to Riftbound? Play the tutorial</strong>
              <span className="muted"> A short guided match. Finish it for 5 free booster packs, one from each set.</span>
            </div>
            <a className="btn btn--primary btn--small" href="#play/tutorial">Play the tutorial</a>
          </div>
        )}
        <DeckSetup cards={cards} db={db} initial={choice} error={error} onStart={start}
        saved={saved && resumable(saved) ? saved : null} onResume={resume}
        onDiscard={() => { store.clear(); setSaved(null); }} />
      </>
    );
  }
  const seats = game.host.seats;
  return (
    <GameScreen key={game.n} host={game.host} cards={cards} db={db} names={[seatName(seats, 0), seatName(seats, 1)]}
      onNewGame={() => start(choice)} onLoadRecord={(r) => load(r, seats)}
      onChangeDecks={() => { setSaved(store.load()); setGame(null); }} />
  );
}
