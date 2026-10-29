import { useEffect, useMemo, useState } from 'react';
import { HoloSwitches } from '../card/HoloSwitches.tsx';
import { HoloCard } from '../card/HoloCard.tsx';
import { collection, useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';
import { Icon } from '../lobby/icons.tsx';
import { PRODUCT_LABEL } from '../play/host/decks.ts';
import { cardIndex } from '../play/model/cards.ts';
import { TutorialView } from '../play/tutorial/TutorialView.tsx';
import { HeroBanner } from '../views/HeroBanner.tsx';
import './onboarding.css';

/*
 * A new player does not see the lobby yet. Three steps in a row: take a
 * starter deck, play the guided match with it, and receive the five packs.
 * Only then the lobby opens. The progress is in the collection (a starter,
 * the tutorial done), so a reload picks up where the player was.
 */

type Step = 'intro' | 'deck' | 'ready' | 'tutorial';
const STEPS = [
  { id: 'deck', label: 'Choose a deck' },
  { id: 'tutorial', label: 'Learn to play' },
  { id: 'rewards', label: 'Open your packs' },
] as const;
const PRODUCT_ORDER = ['ogs', 'ogn', 'sfd', 'unl', 'rad'];

function Bar({ at }: { at: 0 | 1 | 2 }) {
  return (
    <header className="ob__bar">
      <span aria-hidden />
      <ol className="ob__steps" aria-label="Getting started">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>
            <span><i>{i < at ? '✓' : i + 1}</i></span>{s.label}
          </li>
        ))}
      </ol>
      <HoloSwitches />
    </header>
  );
}

/** Step one: the deck. Products as tabs, the decks of one product as big cards. */
function DeckStep({ db, onTaken }: { db: CardDb; onTaken: () => void }) {
  const [all, setAll] = useState<StarterChoice[] | null>(null);
  const [set, setSet] = useState(PRODUCT_ORDER[0]);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadStarters(db).then((s) => { if (alive) setAll(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, [db]);
  const groups = PRODUCT_ORDER.map((id) => ({ id, items: (all ?? []).filter((s) => s.set === id) })).filter((g) => g.items.length > 0);
  const items = groups.find((g) => g.id === set)?.items ?? [];
  const chosen = all?.find((s) => s.id === pick) ?? null;

  const take = () => {
    if (!chosen) return;
    // the preview starts with some coins, so the shop can be tried right away
    void collection.grantStarter(chosen.id, chosen.cards, { [chosen.booster]: 1 }, import.meta.env.VITE_PREVIEW ? 1200 : 0)
      .then((ok) => { if (ok) onTaken(); });
  };

  return (
    <div className="ob__page ob-deck">
      <Bar at={0} />
      <div className="ob__body">
        <div className="ob__title">
          <p className="lb-label">Step 1</p>
          <h1>Choose your starter deck</h1>
          <p className="muted">Every deck is ready to play: a legend, 40 cards, 12 runes and its battlefields, plus the booster pack from its box. The others you can win and collect later.</p>
        </div>
        <div className="ds-tabs ob-deck__tabs" role="tablist" aria-label="Product">
          {groups.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === set} onClick={() => setSet(g.id)}>
              {PRODUCT_LABEL[g.id] ?? g.items[0].product}<span>{g.items.length}</span>
            </button>
          ))}
        </div>
        {!all ? <p className="muted ob-deck__loading">Loading the decks…</p> : (
          <div className="ob-deck__row">
            {items.map((s) => {
              const card = db.cards.find((c) => c.id === s.legendCard);
              return (
                <button key={s.id} type="button" className="ob-deck__item" aria-pressed={pick === s.id} onClick={() => setPick(s.id)}>
                  <span className="ob-deck__card">{card ? <HoloCard card={card} finish="none" width="100%" imageWidth={480} /> : <span className="starter__ph" />}</span>
                  <strong>{s.title.replace(/^[^:]*: /, '')}</strong>
                  <span className="muted small">{s.blurb}</span>
                </button>
              );
            })}
          </div>
        )}
        <footer className="ob-deck__foot">
          <span className="muted">{chosen ? <><b>{chosen.title}</b> · {chosen.size} cards + 1 {chosen.booster.toUpperCase()} booster</> : 'Pick a deck to continue.'}</span>
          <button type="button" className="btn btn--cta" disabled={!chosen} onClick={take}>Take this deck</button>
        </footer>
      </div>
    </div>
  );
}

export function Onboarding({ db, onDone }: { db: CardDb; onDone: (to: 'shop' | 'play' | 'home') => void }) {
  const own = useCollection();
  const [step, setStep] = useState<Step>(() => (own.starter ? 'ready' : 'intro'));
  const cards = useMemo(() => cardIndex(db), [db]);
  const legend = useMemo(() => {
    // the deck you hold, as its legend card (for the ready screen)
    if (!own.starter) return null;
    return db.cards.find((c) => c.type === 'Legend' && own.cards[c.id]) ?? null;
  }, [db, own.starter, own.cards]);

  // the preview can step over all of it
  const skipPreview = () => {
    if (!own.starter) {
      loadStarters(db).then(async (all) => {
        const s = all[0];
        if (s) await collection.grantStarter(s.id, s.cards, { [s.booster]: 1 }, 1200);
        await collection.completeTutorial();
        onDone('home');
      }).catch(() => undefined);
    } else { void collection.completeTutorial().then(() => onDone('home')); }
  };
  const preview = Boolean(import.meta.env.VITE_PREVIEW);

  if (step === 'tutorial') {
    return (
      <div className="ob__page ob-play">
        <Bar at={1} />
        <div className="ob__play"><TutorialView db={db} cards={cards} starter={own.starter} onExit={() => onDone('play')} onFinish={onDone} /></div>
      </div>
    );
  }
  if (step === 'deck') return <DeckStep db={db} onTaken={() => setStep('ready')} />;
  if (step === 'ready') {
    return (
      <div className="ob__page ob-ready">
        <Bar at={1} />
        <div className="ob__body ob-ready__body">
          <div className="ob-ready__card">{legend && <HoloCard card={legend} finish="none" width="100%" imageWidth={520} gl />}</div>
          <div className="ob-ready__text">
            <p className="lb-label">Step 2</p>
            <h1>Your deck is ready</h1>
            <p className="muted">A short guided match teaches you the board, your runes, units, battlefields, combat and spells. Finish it and five booster packs, one from each set, are yours.</p>
            <button type="button" className="btn btn--cta" onClick={() => setStep('tutorial')}>Start the tutorial</button>
          </div>
        </div>
        {preview && <button type="button" className="ob__skip" onClick={skipPreview}>Skip onboarding (preview only)</button>}
      </div>
    );
  }
  return (
    <div className="ob__page ob-intro">
      <HeroBanner db={db} bleed plain>
        <div className="lb-card ob-intro__card">
          <h1>Welcome</h1>
          <p className="muted">Open packs, build your collection and play the card game of League of Legends. Three steps to get going:</p>
          <ol className="ob-intro__steps">
            <li><Icon name="deck" size={22} /><div><b>Choose a starter deck</b><span>Every official starter deck is ready to play.</span></div></li>
            <li><Icon name="book" size={22} /><div><b>Play the tutorial</b><span>A guided match, about ten minutes.</span></div></li>
            <li><Icon name="gift" size={22} /><div><b>Get five booster packs</b><span>One from each set, to start your collection.</span></div></li>
          </ol>
          <button type="button" className="btn btn--cta" onClick={() => setStep('deck')}>Begin</button>
        </div>
      </HeroBanner>
      <header className="ob__bar ob__bar--float"><span aria-hidden /><HoloSwitches /></header>
      {preview && <button type="button" className="ob__skip" onClick={skipPreview}>Skip onboarding (preview only)</button>}
    </div>
  );
}
