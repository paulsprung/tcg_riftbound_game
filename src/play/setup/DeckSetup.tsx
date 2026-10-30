import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '../../lobby/icons.tsx';
import { HoloCard } from '../../card/HoloCard.tsx';
import { DOMAIN_COLOR, defaultFinish, symbolFor } from '../../data/cardInfo.ts';
import type { CardDb } from '../../data/types.ts';
import type { DeckList, DefId } from '../../game/index.ts';
import { setCustomDuo, social, useSocial } from '../../lobby/social.ts';
import { BUILT_IN_DECKS, builtInDeck, customDecks, DECK_GROUPS, deckProblems, PRODUCT_LABEL, shortName, type BuiltInDeck } from '../host/decks.ts';
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
  /** 2v2: your teammate's deck and the second opponent's; unset, one is picked that fits (pickDuoDeck). */
  ally?: BuiltInDeck['id'];
  theirs2?: BuiltInDeck['id'];
  /** Each computer's level, by seat; unset, the `opponent` choice's. */
  levels?: Partial<Record<BotSeat, BotLevel>>;
}

/** The seats a computer (or a friend) can take: the opponent, and in 2v2 your teammate and the second opponent. */
export type BotSeat = 'theirs' | 'ally' | 'theirs2';
export type BotLevel = 'beginner' | 'normal';

/** A computer seat's level. */
export const levelOf = (c: DeckSetupChoice, seat: BotSeat): BotLevel => c.levels?.[seat] ?? (c.opponent === 'hotseat' ? 'normal' : c.opponent);

/** A deck for a 2v2 seat: a Legend nobody at the table has, and no battlefield its teammate brings [491]. */
export function pickDuoDeck(taken: DeckList[], mate: DeckList | null): BuiltInDeck {
  return BUILT_IN_DECKS.find((b) => !taken.some((t) => t.legend === b.deck.legend) && !(mate && mate.battlefields.some((bf) => b.deck.battlefields.includes(bf))))
    ?? BUILT_IN_DECKS[0];
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

const LEVELS: { id: BotLevel; label: string; text: string }[] = [
  { id: 'beginner', label: 'Beginner', text: 'Makes the obvious plays, often misses a Reaction.' },
  { id: 'normal', label: 'Normal', text: 'Weighs each play by playing it out: trades in combat, holds battlefields, answers with Reactions.' },
];

/** A seat at the table, clicked: a computer at a level of your choice (and its deck), a friend, or a player at this screen. */
function SeatPopup({ title, level, hot, onLevel, onHot, onDeck, onClose }: {
  title: string; level: BotLevel; hot: boolean;
  onLevel: (l: BotLevel) => void; onHot: () => void; onDeck: () => void; onClose: () => void;
}) {
  const { friends, live } = useSocial();
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState<string[]>([]);
  const shown = friends.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b.presence === 'online') - Number(a.presence === 'online') || a.name.localeCompare(b.name));
  return (
    <div className="ds-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="ds-modal__panel seat-pop lb-card" onClick={(e) => e.stopPropagation()}>
        <header className="ds-modal__head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <section className="seat-pop__group">
          <p className="lb-label">A computer</p>
          <div className="seat-pop__levels">
            {LEVELS.map((l) => (
              <button key={l.id} type="button" className={`seat-pop__level${!hot && level === l.id ? ' is-on' : ''}`} onClick={() => { onLevel(l.id); onClose(); }}>
                <b>{l.label}</b><span>{l.text}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--small" onClick={onDeck}>Choose its deck</button>
        </section>
        <section className="seat-pop__group">
          <p className="lb-label">A friend</p>
          <div className="lb-search">
            <Icon name="search" size={15} />
            <input className="input" type="search" placeholder="Find a friend" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a friend" />
          </div>
          <div className="seat-pop__friends lb-scroll">
            {shown.length === 0 && <p className="muted small">{friends.length === 0 ? 'No friends yet: add them with their friend code in the friends list.' : 'Nobody by that name.'}</p>}
            {shown.map((f) => {
              const free = f.presence === 'online';
              return (
                <div key={f.id} className="seat-pop__friend">
                  <span><b>{f.name}</b><small className="muted">{free ? 'Online' : f.presence === 'offline' ? 'Offline' : 'Busy'}</small></span>
                  <button type="button" className="btn btn--primary btn--small" disabled={!free || asked.includes(f.id)}
                    onClick={() => { social.invite(f.id); setAsked([...asked, f.id]); }}>{asked.includes(f.id) ? 'Invited' : 'Invite'}</button>
                </div>
              );
            })}
          </div>
          {!live && <p className="muted small">Inviting friends needs you signed in.</p>}
        </section>
        <section className="seat-pop__group">
          <p className="lb-label">On this screen</p>
          <button type="button" className={`seat-pop__level${hot ? ' is-on' : ''}`} onClick={() => { onHot(); onClose(); }}>
            <b>Hot-seat</b><span>Everyone plays on this device; the screen is covered between turns so each sees only their own hand.</span>
          </button>
        </section>
      </div>
    </div>
  );
}

/** 1v1 is what the engine plays today; the 2v2 Duo rules (Magma Chamber) come later. */
/** 1v1 Duel or 2v2 (Magma Chamber [491]); without `onChange` 2v2 isn't offered there yet. */
export function FormatSwitch({ value = '1v1', onChange }: { value?: '1v1' | '2v2'; onChange?: (v: '1v1' | '2v2') => void }) {
  return (
    <div className="seg seg--format" role="group" aria-label="Format">
      <button type="button" aria-pressed={value === '1v1'} onClick={() => onChange?.('1v1')}>1v1 Duel</button>
      {onChange ? <button type="button" aria-pressed={value === '2v2'} onClick={() => onChange('2v2')}>2v2 Duo</button>
        : <button type="button" disabled aria-pressed="false" data-soon="">2v2 Duo</button>}
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

export function DeckSetup({ cards, db, initial, error, onStart, saved, onResume, onDiscard, owned, onLimited, duo, onDuo }: {
  cards: CardIndex; db: CardDb; initial: DeckSetupChoice; error: string | null; onStart: (c: DeckSetupChoice) => void;
  /** Sealed or Draft instead of your own deck. */
  onLimited?: (format: 'sealed' | 'draft') => void;
  /** 2v2: you and a computer teammate against two computers. */
  duo?: boolean; onDuo?: (on: boolean) => void;
  saved?: SavedGame | null; onResume?: (g: SavedGame) => void; onDiscard?: () => void;
  /** The starter deck the player owns (collection), if any. */
  owned?: string | null;
}) {
  const [c, setC] = useState<DeckSetupChoice>(initial);
  const [later, setLater] = useState(false);
  // friends invited from here while it is set to 2v2 come into a lobby for four
  useEffect(() => { setCustomDuo(!!duo); return () => setCustomDuo(false); }, [duo]);
  const [picking, setPicking] = useState<null | 'mine' | 'theirs' | 'ally' | 'theirs2'>(null);
  const [settings, setSettings] = useState(false);
  const [seat, setSeat] = useState<BotSeat | null>(null);
  const mine = deckById(c.mine), theirs = deckById(c.theirs);
  // 2v2: the teammate's and the second opponent's decks, picked to fit unless chosen
  const ally = c.ally ? deckById(c.ally) : pickDuoDeck([mine.deck, theirs.deck], mine.deck);
  const theirs2 = c.theirs2 ? deckById(c.theirs2) : pickDuoDeck([mine.deck, theirs.deck, ally.deck], theirs.deck);
  const hot = c.opponent === 'hotseat';
  const LEVEL_NAME: Record<BotLevel, string> = { beginner: 'Beginner', normal: 'Normal' };
  const seatLabel = (s: BotSeat, player: string) => (hot ? player : `${s === 'ally' ? 'Teammate' : 'Computer'} · ${LEVEL_NAME[levelOf(c, s)]}`);
  const problems = [
    ...deckProblems(mine.deck, c.champion).map((p) => `Your deck: ${p}`),
    ...deckProblems(theirs.deck).map((p) => `Opponent's deck: ${p}`),
    // teammates bring different Legends and no shared battlefield [491]
    ...(duo ? ([[mine, ally, 'You and your teammate'], [theirs, theirs2, 'The opponents']] as const).flatMap(([a, b, who]) => [
      ...(a.deck.legend === b.deck.legend ? [`${who} play the same Legend`] : []),
      ...(a.deck.battlefields.some((bf) => b.deck.battlefields.includes(bf)) ? [`${who} bring the same battlefield`] : []),
    ]) : []),
  ];

  return (
    <section className="play-setup ds">
      {/* a game left off: a card in the corner, as a friend's invite, not a bar that pushes the page down */}
      {saved && onResume && !later && (
        <div className="soc-challenge play-resume-pop lb-card" role="dialog" aria-label="Saved game">
          <span className="play-resume-pop__kicker">Game in progress</span>
          <b>{saved.title}</b>
          <span>
            Turn {saved.turn} · score {saved.points[0]}–{saved.points[1]} ·{' '}
            {saved.seats[1].k === 'human' ? 'hot-seat' : saved.seats[1].k === 'ai' ? `computer (${saved.seats[1].level})` : 'simple bot'}
            {' '}· saved {new Date(saved.savedAt).toLocaleString()}
          </span>
          <span className="soc-challenge__btns">
            <button type="button" className="btn btn--cta btn--small" onClick={() => onResume(saved)}>Resume</button>
            {onDiscard && <button type="button" className="btn btn--ghost btn--small" onClick={onDiscard}>Discard</button>}
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setLater(true)}>Later</button>
          </span>
        </div>
      )}

      <header className="ds__bar">
        <h1>Custom game</h1>
        <span className="ds__bar-right">
          <span className="ds-mode-chip">{duo ? '2v2 Duo' : '1v1 Duel'} · Constructed</span>
          <button type="button" className="btn btn--small" onClick={() => setSettings(true)}><Icon name="sliders" size={14} /> Settings</button>
        </span>
      </header>

      {duo ? (
        <div className="ds__stage ds__stage--duo">
          <div className="ds-team">
            <span className="ds-team__label">Your team</span>
            <DeckSlot label="You" b={mine} cards={cards} db={db} owned={mine.id === owned} onOpen={() => setPicking('mine')} />
            <DeckSlot label={seatLabel('ally', 'Player 3')} b={ally} cards={cards} db={db} onOpen={() => setSeat('ally')} />
          </div>
          <span className="play-online__vs" aria-hidden>VS</span>
          <div className="ds-team is-them">
            <span className="ds-team__label">Opponents</span>
            <DeckSlot label={seatLabel('theirs', 'Player 2')} b={theirs} cards={cards} db={db} onOpen={() => setSeat('theirs')} />
            <DeckSlot label={seatLabel('theirs2', 'Player 4')} b={theirs2} cards={cards} db={db} onOpen={() => setSeat('theirs2')} />
          </div>
        </div>
      ) : (
        <div className="ds__stage">
          <DeckSlot label="You" b={mine} cards={cards} db={db} owned={mine.id === owned} onOpen={() => setPicking('mine')} />
          <span className="play-online__vs" aria-hidden>VS</span>
          <DeckSlot label={seatLabel('theirs', 'Player 2')} b={theirs} cards={cards} db={db} onOpen={() => setSeat('theirs')} />
        </div>
      )}
      {duo && (
        <div className="ds-friends lb-card">
          <div>
            <b>Play with friends</b>
            <span className="muted small">Invite them from the friends list: four of you play a friendly 2v2 at once; two of you search together for another pair.</span>
          </div>
          <button type="button" className="btn btn--primary btn--small" onClick={() => social.setOpen(true)}>Invite friends</button>
        </div>
      )}

      <div className="ds__start">
        <p className="muted small ds__hint">Click a seat to choose a computer and its level, invite a friend, or play on this screen.</p>
        {problems.length > 0 && <ul className="play__error">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {error && <p className="play__error" role="alert">{error}</p>}
        <button type="button" className="btn btn--cta" disabled={problems.length > 0} onClick={() => onStart(c)}>Start game</button>
      </div>

      {settings && (
        <div className="ds-modal" role="dialog" aria-modal="true" aria-label="Game settings" onClick={() => setSettings(false)}>
          <div className="ds-modal__panel ds-settings lb-card" onClick={(e) => e.stopPropagation()}>
            <header className="ds-modal__head">
              <h2>Game settings</h2>
              <button type="button" className="icon-btn" onClick={() => setSettings(false)} aria-label="Close">✕</button>
            </header>
            <div className="ds-settings__group">
              <span className="lb-label">Game mode</span>
              <div className="seg seg--format" role="group" aria-label="Game mode">
                <button type="button" aria-pressed={!duo} onClick={() => onDuo?.(false)}>1v1 Duel</button>
                <button type="button" aria-pressed={!!duo} disabled={!onDuo} data-soon={onDuo ? undefined : ''} onClick={() => onDuo?.(true)}>2v2 Duo</button>
                <button type="button" aria-pressed="false" disabled={!onLimited} data-soon={onLimited ? undefined : ''} title={onLimited ? 'A pool of six boosters' : undefined} onClick={() => { setSettings(false); onLimited?.('sealed'); }}>Sealed</button>
                <button type="button" aria-pressed="false" disabled={!onLimited} data-soon={onLimited ? undefined : ''} title={onLimited ? 'Pick by pick from three boosters' : undefined} onClick={() => { setSettings(false); onLimited?.('draft'); }}>Draft</button>
              </div>
            </div>
            <div className="ds-settings__group">
              <span className="lb-label">First player</span>
              <p className="muted small ds-settings__note">Decided by the dice: everyone rolls, and the highest roll chooses to play first or second (TR 407). The same in every game.</p>
            </div>
            <footer className="ds-settings__foot"><button type="button" className="btn btn--cta" onClick={() => setSettings(false)}>Done</button></footer>
          </div>
        </div>
      )}

      {seat && (
        <SeatPopup title={seat === 'ally' ? 'Your teammate' : seat === 'theirs2' ? 'The second opponent' : 'Your opponent'}
          level={levelOf(c, seat)} hot={hot}
          onLevel={(l) => setC({ ...c, opponent: hot ? l : c.opponent, levels: { ...c.levels, [seat]: l } })}
          onHot={() => setC({ ...c, opponent: 'hotseat' })}
          onDeck={() => { setPicking(seat); setSeat(null); }}
          onClose={() => setSeat(null)} />
      )}
      {picking && (
        <DeckPicker cards={cards} db={db}
          title={picking === 'mine' ? 'Your deck' : picking === 'ally' ? "Your teammate's deck" : picking === 'theirs2' ? "The second opponent's deck" : c.opponent === 'hotseat' ? "Player 2's deck" : "The computer's deck"}
          current={picking === 'mine' ? c.mine : picking === 'ally' ? ally.id : picking === 'theirs2' ? theirs2.id : c.theirs} owned={picking === 'mine' ? owned : null}
          mine={picking === 'mine' || c.opponent === 'hotseat' ? [...BUILT_IN_DECKS.filter((b) => b.id === owned), ...customDecks()] : undefined}
          onRandom={picking !== 'mine' ? () => { setC({ ...c, [picking]: BUILT_IN_DECKS[Math.floor(Math.random() * BUILT_IN_DECKS.length)].id }); setPicking(null); } : undefined}
          onClose={() => setPicking(null)}
          onPick={(b) => { setC(picking === 'mine' ? { ...c, mine: b.id, champion: b.deck.chosenChampion } : { ...c, [picking]: b.id }); setPicking(null); }} />
      )}
    </section>
  );
}
