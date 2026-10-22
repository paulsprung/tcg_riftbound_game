import { useState, type CSSProperties } from 'react';
import { HoloCard } from '../../card/HoloCard.tsx';
import { DOMAIN_COLOR, defaultFinish, symbolFor } from '../../data/cardInfo.ts';
import type { CardDb } from '../../data/types.ts';
import type { DefId } from '../../game/index.ts';
import { BUILT_IN_DECKS, deckProblems, type BuiltInDeck } from '../host/decks.ts';
import { cardFor, nameOf, type CardIndex } from '../model/cards.ts';
import type { OrderChoice } from '../model/setup.ts';

/*
 * The first screen of '#play' (§12.1 step 1): your deck (the two built-in
 * precons), your Chosen Champion among its Champion Options [103.3.a],
 * the opponent's deck, and how the first player is settled: TR 407 by
 * default, or fixed for a casual game.
 */

export interface DeckSetupChoice {
  mine: BuiltInDeck['id'];
  theirs: BuiltInDeck['id'];
  champion: DefId;
  order: OrderChoice;
}

const deckById = (id: BuiltInDeck['id']) => BUILT_IN_DECKS.find((b) => b.id === id)!;

/** The Seraphine mirror: the deck M1 plays against itself (§15 M1). */
export const DEFAULT_CHOICE: DeckSetupChoice = {
  mine: 'seraphine', theirs: 'seraphine', champion: deckById('seraphine').deck.chosenChampion, order: 'random',
};

const ORDERS: { id: OrderChoice; label: string }[] = [
  { id: 'random', label: 'Random (TR 407)' }, { id: 'first', label: 'I play first' }, { id: 'second', label: 'I play second' },
];

function DeckTile({ b, cards, db, selected, onPick }: {
  b: BuiltInDeck; cards: CardIndex; db: CardDb; selected: boolean; onPick: () => void;
}) {
  const legend = cardFor(cards, b.deck.legend);
  return (
    <button type="button" className="deck-tile" aria-pressed={selected} onClick={onPick}>
      {legend && <HoloCard card={legend} finish={defaultFinish(legend)} width={132} tilt="hover" imageWidth={300} />}
      <span className="deck-tile__text">
        <strong>{b.deck.name}</strong>
        <span className="muted small">{nameOf(cards, b.deck.legend)}</span>
        <span className="chips">
          {(legend?.domains ?? []).map((d) => {
            const sym = symbolFor(db, 'domains', d);
            return (
              <span key={d} className="chip" style={{ '--chip': DOMAIN_COLOR[d.toLowerCase()] } as CSSProperties}>
                {sym && <img src={sym.icon} alt="" />}{d}
              </span>
            );
          })}
        </span>
        <span className="muted small">
          {b.deck.battlefields.map((bf) => nameOf(cards, bf)).join(' · ')}
        </span>
      </span>
    </button>
  );
}

export function DeckSetup({ cards, db, initial, error, onStart }: {
  cards: CardIndex; db: CardDb; initial: DeckSetupChoice; error: string | null; onStart: (c: DeckSetupChoice) => void;
}) {
  const [c, setC] = useState<DeckSetupChoice>(initial);
  const mine = deckById(c.mine), theirs = deckById(c.theirs);
  const problems = [
    ...deckProblems(mine.deck, c.champion).map((p) => `Your deck: ${p}`),
    ...deckProblems(theirs.deck).map((p) => `Opponent's deck: ${p}`),
  ];
  const options = mine.deck.championOptions ?? [mine.deck.chosenChampion];

  return (
    <section className="play-setup">
      <div className="page-head">
        <h1>Play</h1>
        <p className="muted">
          A 1v1 Duel with the official Radiance Showdown Decks. This first version covers the start of a game: pick
          the decks, see the battlefields, settle who plays first and take your mulligan. Taking turns comes next.
        </p>
      </div>

      <div className="play-setup__grid">
        <section className="play-setup__block">
          <h2>Your deck</h2>
          <div className="deck-tiles">
            {BUILT_IN_DECKS.map((b) => (
              <DeckTile key={b.id} b={b} cards={cards} db={db} selected={b.id === c.mine}
                onPick={() => setC({ ...c, mine: b.id, champion: b.deck.chosenChampion })} />
            ))}
          </div>

          <h3>Chosen Champion</h3>
          <p className="muted small">It starts in your Champion Zone, ready to be played from there; the other copies stay in your deck [103.3.a].</p>
          <div className="champions">
            {options.map((def) => {
              const card = cardFor(cards, def);
              return (
                <button key={def} type="button" className="champion" aria-pressed={def === c.champion}
                  onClick={() => setC({ ...c, champion: def })} title={nameOf(cards, def)}>
                  {card && <HoloCard card={card} finish={defaultFinish(card)} width={96} tilt="off" imageWidth={200} />}
                  <span className="small">{nameOf(cards, def)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="play-setup__block">
          <h2>Opponent</h2>
          <p className="muted small">The computer. For now it answers its setup choices only.</p>
          <div className="seg" role="group" aria-label="Opponent's deck">
            {BUILT_IN_DECKS.map((b) => (
              <button key={b.id} type="button" aria-pressed={b.id === c.theirs} onClick={() => setC({ ...c, theirs: b.id })}>
                {b.deck.name.replace(/ Showdown Deck$/, '')}
              </button>
            ))}
          </div>

          <h3>First player</h3>
          <p className="muted small">
            By the Tournament Rules a random player chooses, after seeing both battlefields (TR 407).
          </p>
          <div className="seg" role="group" aria-label="First player">
            {ORDERS.map((o) => (
              <button key={o.id} type="button" aria-pressed={o.id === c.order} onClick={() => setC({ ...c, order: o.id })}>
                {o.label}
              </button>
            ))}
          </div>

          <div className="play-setup__start">
            {problems.length > 0
              ? <ul className="play__error">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              : <p className="muted small">Both decks are legal in Standard: 40 cards, 12 runes, 3 battlefields.</p>}
            {error && <p className="play__error" role="alert">{error}</p>}
            <button type="button" className="btn btn--primary" disabled={problems.length > 0} onClick={() => onStart(c)}>
              Start game
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
