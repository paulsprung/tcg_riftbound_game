import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { collection, TUTORIAL_PACKS, useCollection } from '../../collection/store.ts';
import type { CardDb } from '../../data/types.ts';
import { packArt } from '../../data/media.ts';
import { BOOSTER_SETS } from '../../pack/packConfig.ts';
import { heroCard, PackWrapper } from '../../pack/PackWrapper.tsx';
import { GameScreen } from '../GameScreen.tsx';
import type { GameHost } from '../host/GameHost.ts';
import type { CardIndex } from '../model/cards.ts';
import { PACE_FACTOR, getSettings, usePlaySettings } from '../settings.ts';
import type { Coach } from './coach.ts';
import { createTutorialCoach, OPPONENT_NAME, TUTORIAL_SCORE, tutorialHost, type TutorialCoach } from './lesson.ts';
import {
  createStarterCoach, STARTER_OPPONENT_NAME, STARTER_TUTORIAL_SCORE, starterOf, starterTutorialHost, tutorOpponent,
} from './starterLesson.ts';

/*
 * '#play/tutorial': the guided first match and its ending: with the
 * player's own starter deck (starterLesson.ts) when they chose one, else the
 * Seraphine lesson (lesson.ts). The
 * game is never autosaved; Restart deals it again from the start. Finishing
 * it (win or lose) or skipping it (after a confirmation) calls
 * collection.completeTutorial(), which grants the five packs only the first
 * time; the reward screen then sends the player to the Shop to open them.
 */

interface Run { host: GameHost; coach: TutorialCoach; n: number; subtitle: string }

const newRun = (cards: CardIndex, starter: string | null, n: number): Run => {
  const pace = { pace: PACE_FACTOR[getSettings().pace] };
  const mine = starterOf(starter);
  if (!mine) {
    return { host: tutorialHost(cards, pace), coach: createTutorialCoach(), n,
      subtitle: `Tutorial · you against ${OPPONENT_NAME} · first to ${TUTORIAL_SCORE} points` };
  }
  const short = (name: string) => name.replace(/^[^:]*: /, '').replace(/ (Showdown|Champion) Deck$/, '');
  return { host: starterTutorialHost(mine, cards, pace), coach: createStarterCoach(), n,
    subtitle: `Tutorial · your ${short(mine.deck.name)} deck against ${STARTER_OPPONENT_NAME} (${short(tutorOpponent(mine.id).deck.name)}) `
      + `· first to ${STARTER_TUTORIAL_SCORE} points` };
};

export function TutorialView({ db, cards, starter, onExit }: {
  db: CardDb; cards: CardIndex; starter: string | null; onExit: () => void;
}) {
  const [run, setRun] = useState<Run>(() => newRun(cards, starter, 0));
  const [ending, setEnding] = useState<{ granted: boolean; won: boolean | null } | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const snap = useSyncExternalStore(run.host.subscribe, run.host.getSnapshot);
  const result = snap.view.result;
  const pace = usePlaySettings().pace;
  useEffect(() => { run.host.setPace(PACE_FACTOR[pace]); }, [run, pace]);

  useEffect(() => {
    if (!result || ending) return;
    // the last state stays on screen for a moment before the ending
    const t = setTimeout(() => setEnding({ granted: collection.completeTutorial(), won: result.winner === run.host.human }), 1600);
    return () => clearTimeout(t);
  }, [result, ending, run.host]);

  // A new step brings what it points at into view (on a phone the hand and
  // the battlefields are often off screen); instantly when motion is off.
  const shownStep = useRef<string | null>(null);
  useEffect(() => {
    const at = run.coach.at;
    if (at === shownStep.current) return;
    const el = document.querySelector('.play__stage .is-coached:not(.coach)');
    if (!el) return;
    shownStep.current = at;
    const r = el.getBoundingClientRect();
    if (r.top >= 60 && r.bottom <= innerHeight - 160) return;      // already in view (clear of the prompt bar)
    const still = document.documentElement.dataset.fx === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: still ? 'auto' : 'smooth' });
  });

  // Next re-renders the table, which asks the coach for its step again
  const coach = useMemo<Coach>(() => ({
    step: (ctx) => run.coach.step(ctx),
    onNext: (s) => { run.coach.onNext?.(s); rerender(); },
  }), [run]);

  const restart = () => { run.host.stop(); setEnding(null); setConfirmSkip(false); setRun(newRun(cards, starter, run.n + 1)); };
  const skip = () => { run.host.stop(); setEnding({ granted: collection.completeTutorial(), won: null }); };

  if (ending) return <TutorialReward db={db} granted={ending.granted} won={ending.won} onReplay={restart} onExit={onExit} />;

  const actions = confirmSkip ? (
    <span className="tutorial__confirm">
      <span className="small">Skip the tutorial? You still get the packs.</span>
      <button type="button" className="btn btn--small" onClick={skip}>Skip now</button>
      <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirmSkip(false)}>Keep learning</button>
    </span>
  ) : (
    <>
      <button type="button" className="btn btn--small btn--ghost" onClick={restart}>Restart</button>
      <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirmSkip(true)}>Skip tutorial</button>
    </>
  );
  return (
    <GameScreen key={run.n} host={run.host} cards={cards} db={db} names={['You', OPPONENT_NAME]} coach={coach}
      onNewGame={restart} onChangeDecks={onExit}
      tutorial={{ subtitle: run.subtitle, actions }} />
  );
}

/** The ending: the five packs (or a note that they were taken already). */
export function TutorialReward({ db, granted, won, onReplay, onExit }: {
  db: CardDb; granted: boolean; won: boolean | null; onReplay: () => void; onExit: () => void;
}) {
  const own = useCollection();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const sets = useMemo(() => TUTORIAL_PACKS.map((id) => {
    const b = BOOSTER_SETS.find((x) => x.id === id);
    const info = db.sets.find((x) => x.id === id);
    return b && info ? { id, info, style: b.style, cards: db.cards.filter((c) => c.setId === id) } : null;
  }).filter((x) => x !== null), [db]);
  const title = won === null ? 'Tutorial skipped' : won ? 'You won the tutorial!' : 'Tutorial complete';
  return (
    <section className="tutorial-reward" aria-labelledby="tutorial-reward-title">
      <div className="page-head">
        <h1 id="tutorial-reward-title">{title}</h1>
        <p className="muted">
          {granted
            ? 'Your reward: one booster pack from each set. They are waiting in the Shop, ready to open.'
            : 'You already took the tutorial reward. Play it again any time to practise.'}
        </p>
      </div>
      {granted && (
        <div className="tutorial-reward__packs">
          {sets.map((s) => (
            <figure key={s.id} className="tutorial-reward__pack">
              <PackWrapper set={s.info} style={s.style} hero={heroCard(s.cards, s.style)}
                width={Math.round(170 * (packArt(s.id)?.aspect ?? 1 / 1.72))} onClick={() => { location.hash = 'shop'; }} />
              <figcaption className="small">{s.info.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="home__actions">
        <a className="btn btn--primary" href="#shop">
          Open your packs ({Object.values(own.packs).reduce((a, b) => a + b, 0)} in the Shop)
        </a>
        <button type="button" className="btn btn--ghost" onClick={onReplay}>Play the tutorial again</button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>Play a real game</button>
      </div>
    </section>
  );
}
