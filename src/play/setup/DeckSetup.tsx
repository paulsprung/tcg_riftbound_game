import { useEffect, useState, type CSSProperties } from 'react';
import { HoloCard } from '../../card/HoloCard.tsx';
import { DOMAIN_COLOR, defaultFinish, symbolFor } from '../../data/cardInfo.ts';
import type { CardDb } from '../../data/types.ts';
import type { DefId } from '../../game/index.ts';
import { BUILT_IN_DECKS, builtInDeck, DECK_GROUPS, deckProblems, PRODUCT_LABEL, shortName, type BuiltInDeck } from '../host/decks.ts';
import { cardFor, nameOf, type CardIndex } from '../model/cards.ts';
import type { SavedGame } from '../host/autosave.ts';
import type { OrderChoice } from '../model/setup.ts';
import type { OpponentChoice } from '../settings.ts';

/*
 * The first screen of '#play' (§12.1 step 1): your deck (any of the 13
 * official starter decks, by product; the one you own is picked first),
 * your Chosen Champion among its Champion Options [103.3.a], the opponent
 * (the computer at Beginner or Normal, §11.7, or a second human on the same
 * device: hot-seat) and its deck, and how the first player is settled: TR
 * 407 by default, or fixed for a casual game. A saved game in progress
 * shows as a Resume card on top (§12.1).
 */

export interface DeckSetupChoice {
  mine: BuiltInDeck['id'];
  theirs: BuiltInDeck['id'];
  champion: DefId;
  order: OrderChoice;
  opponent: OpponentChoice;
}

const deckById = (id: BuiltInDeck['id']) => builtInDeck(id) ?? builtInDeck('seraphine')!;

/** The Seraphine mirror: the deck M1 plays against itself (§15 M1). */
export const DEFAULT_CHOICE: DeckSetupChoice = {
  mine: 'seraphine', theirs: 'seraphine', champion: deckById('seraphine').deck.chosenChampion, order: 'random',
  opponent: 'normal',
};

/** The default choice for a player who owns a starter deck: that deck,
    against the next deck of another product. */
export function choiceFor(owned: string | null): DeckSetupChoice {
  const mine = builtInDeck(owned);
  if (!mine) return DEFAULT_CHOICE;
  const others = BUILT_IN_DECKS.filter((b) => b.set !== mine.set);
  const theirs = others[(BUILT_IN_DECKS.indexOf(mine) * 5 + 3) % others.length] ?? mine;
  return { ...DEFAULT_CHOICE, mine: mine.id, theirs: theirs.id, champion: mine.deck.chosenChampion };
}

const OPPONENTS: { id: OpponentChoice; label: string; text: string }[] = [
  { id: 'beginner', label: 'Computer: Beginner', text: 'Makes the obvious plays, often misses a Reaction.' },
  { id: 'normal', label: 'Computer: Normal', text: 'Weighs each play by playing it out: trades in combat, holds battlefields, answers with Reactions.' },
  { id: 'hotseat', label: 'Hot-seat', text: 'Two players on this device. The screen is covered between turns so each sees only their own hand.' },
];

/** 1v1 is what the engine plays today; the 2v2 Duo rules (Magma Chamber) come later. */
export function FormatSwitch() {
  return (
    <div className="seg seg--format" role="group" aria-label="Format">
      <button type="button" aria-pressed="true">1v1 Duel</button>
      <button type="button" disabled aria-pressed="false" title="2v2 is not playable yet">2v2 Duo <em className="lb-soon">soon</em></button>
    </div>
  );
}

/** The domains of a legend as chips with their symbols. */
function DomainChips({ domains, db }: { domains: string[]; db: CardDb }) {
  return (
    <span className="chips">
      {domains.map((d) => {
        const sym = symbolFor(db, 'domains', d);
        return (
          <span key={d} className="chip" style={{ '--chip': DOMAIN_COLOR[d.toLowerCase()] } as CSSProperties}>
            {sym && <img src={sym.icon} alt="" />}{d}
          </span>
        );
      })}
    </span>
  );
}

/** One deck as a big legend card with its name, for the picker. */
function DeckChoice({ b, cards, db, selected, owned, onPick }: {
  b: BuiltInDeck; cards: CardIndex; db: CardDb; selected: boolean; owned: boolean; onPick: () => void;
}) {
  const legend = cardFor(cards, b.deck.legend);
  return (
    <button type="button" className="ds-choice" aria-pressed={selected} onClick={onPick} data-deck={b.id}>
      <span className="ds-choice__card">{legend && <HoloCard card={legend} finish={defaultFinish(legend)} width="100%" tilt="hover" imageWidth={360} />}</span>
      <strong>{shortName(b.deck)}{owned && <em className="ds-yours">Yours</em>}</strong>
      <span className="muted small">{nameOf(cards, b.deck.legend)}</span>
      <DomainChips domains={legend?.domains ?? []} db={db} />
    </button>
  );
}

/** Pick a deck: the products as tabs, the decks of the one you look at as big cards. One screen, nothing to scroll. */
export function DeckPicker({ cards, db, title, current, owned, mine, only, onRandom, onPick, onClose }: {
  cards: CardIndex; db: CardDb; title: string; current: string; owned?: string | null; onPick: (b: BuiltInDeck) => void; onClose: () => void;
  /** The decks the player owns: a tab of their own, ahead of every set. */
  mine?: BuiltInDeck[];
  /** Only these decks, in one list (the decks a player really has). */
  only?: BuiltInDeck[];
  /** Offers a random deck. */
  onRandom?: () => void;
}) {
  const [set, setSet] = useState<string>(() => (mine?.some((d) => d.id === current) ? 'mine' : DECK_GROUPS.find((g) => g.decks.some((d) => d.id === current))?.set ?? DECK_GROUPS[0].set));
  const tabs = only ? [{ set: 'mine', name: 'Your decks', label: 'My decks', decks: only }] : [...(mine && mine.length > 0 ? [{ set: 'mine', name: 'Decks you own', label: 'My decks', decks: mine }] : []),
    ...DECK_GROUPS.map((g) => ({ set: g.set as string, name: g.name, label: PRODUCT_LABEL[g.set] ?? g.name, decks: g.decks }))];
  const group = tabs.find((g) => g.set === set) ?? tabs[0];
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="ds-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="ds-modal__panel lb-card" onClick={(e) => e.stopPropagation()}>
        <header className="ds-modal__head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {!only && <div className="ds-tabs" role="tablist" aria-label="Product">
          {tabs.map((g) => (
            <button key={g.set} type="button" role="tab" aria-selected={g.set === set} onClick={() => setSet(g.set)}>
              {g.label}
              <span>{g.decks.length}</span>
            </button>
          ))}
          {onRandom && <button type="button" className="ds-tabs__random" onClick={onRandom}>Random deck</button>}
        </div>}
        <div className="ds-choices">
          {group.decks.map((b) => (
            <DeckChoice key={b.id} b={b} cards={cards} db={db} selected={b.id === current} owned={b.id === owned} onPick={() => onPick(b)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A deck slot on the table: the legend, big, and a button to change it. */
export function DeckSlot({ label, b, cards, db, owned, onOpen }: {
  label: string; b: BuiltInDeck; cards: CardIndex; db: CardDb; owned?: boolean; onOpen: () => void;
}) {
  const legend = cardFor(cards, b.deck.legend);
  return (
    <figure className="ds-slot">
      <button type="button" className="ds-slot__card" onClick={onOpen} aria-label={`${label}: ${shortName(b.deck)}. Change deck`}>
        {legend && <HoloCard card={legend} finish={defaultFinish(legend)} width="100%" tilt="hover" imageWidth={480} />}
        <span className="ds-slot__tag">{label}</span>
      </button>
      <figcaption>
        <strong>{shortName(b.deck)}{owned && <em className="ds-yours">Yours</em>}</strong>
        <DomainChips domains={legend?.domains ?? []} db={db} />
        <button type="button" className="btn btn--small" onClick={onOpen}>Change deck</button>
      </figcaption>
    </figure>
  );
}

export function DeckSetup({ cards, db, initial, error, onStart, saved, onResume, onDiscard, owned }: {
  cards: CardIndex; db: CardDb; initial: DeckSetupChoice; error: string | null; onStart: (c: DeckSetupChoice) => void;
  saved?: SavedGame | null; onResume?: (g: SavedGame) => void; onDiscard?: () => void;
  /** The starter deck the player owns (collection), if any. */
  owned?: string | null;
}) {
  const [c, setC] = useState<DeckSetupChoice>(initial);
  const [picking, setPicking] = useState<null | 'mine' | 'theirs'>(null);
  const mine = deckById(c.mine), theirs = deckById(c.theirs);
  const problems = [
    ...deckProblems(mine.deck, c.champion).map((p) => `Your deck: ${p}`),
    ...deckProblems(theirs.deck).map((p) => `Opponent's deck: ${p}`),
  ];

  return (
    <section className="play-setup ds">
      {saved && onResume && (
        <section className="play-resume lb-card" aria-label="Saved game">
          <div>
            <p className="eyebrow">Game in progress</p>
            <strong>{saved.title}</strong>
            <p className="muted small">
              Turn {saved.turn} · score {saved.points[0]}–{saved.points[1]} ·{' '}
              {saved.seats[1].k === 'human' ? 'hot-seat' : saved.seats[1].k === 'ai' ? `computer (${saved.seats[1].level})` : 'simple bot'}
              {' '}· saved {new Date(saved.savedAt).toLocaleString()}
            </p>
          </div>
          <div className="play-resume__buttons">
            <button type="button" className="btn btn--cta" onClick={() => onResume(saved)}>Resume</button>
            {onDiscard && <button type="button" className="btn btn--ghost" onClick={onDiscard}>Discard</button>}
          </div>
        </section>
      )}

      <header className="ds__bar">
        <h1>Custom game</h1>
        <FormatSwitch />
      </header>

      <div className="ds__stage">
        <DeckSlot label="You" b={mine} cards={cards} db={db} owned={mine.id === owned} onOpen={() => setPicking('mine')} />
        <span className="play-online__vs" aria-hidden>VS</span>
        <DeckSlot label={c.opponent === 'hotseat' ? 'Player 2' : 'Computer'} b={theirs} cards={cards} db={db} onOpen={() => setPicking('theirs')} />
      </div>

      <div className="ds__start">
        <div className="seg" role="radiogroup" aria-label="Opponent">
          {OPPONENTS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={o.id === c.opponent} aria-pressed={o.id === c.opponent}
              onClick={() => setC({ ...c, opponent: o.id })}>{o.label.replace('Computer: ', '')}</button>
          ))}
        </div>
        {problems.length > 0 && <ul className="play__error">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {error && <p className="play__error" role="alert">{error}</p>}
        <button type="button" className="btn btn--cta" disabled={problems.length > 0} onClick={() => onStart(c)}>Start game</button>
      </div>

      {picking && (
        <DeckPicker cards={cards} db={db} title={picking === 'mine' ? 'Your deck' : c.opponent === 'hotseat' ? "Player 2's deck" : "The computer's deck"}
          current={picking === 'mine' ? c.mine : c.theirs} owned={picking === 'mine' ? owned : null}
          mine={(picking === 'mine' || c.opponent === 'hotseat') && owned ? BUILT_IN_DECKS.filter((b) => b.id === owned) : undefined}
          onRandom={picking === 'theirs' ? () => { setC({ ...c, theirs: BUILT_IN_DECKS[Math.floor(Math.random() * BUILT_IN_DECKS.length)].id }); setPicking(null); } : undefined}
          onClose={() => setPicking(null)}
          onPick={(b) => { setC(picking === 'mine' ? { ...c, mine: b.id, champion: b.deck.chosenChampion } : { ...c, theirs: b.id }); setPicking(null); }} />
      )}
    </section>
  );
}
