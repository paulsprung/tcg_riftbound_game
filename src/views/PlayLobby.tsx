import { useMemo, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { CardBack } from '../card/CardBack.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { Lobby, RankCard, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import type { IconName } from '../lobby/icons.tsx';
import { BUILT_IN_DECKS, shortName } from '../play/host/decks.ts';
import { cardFor, cardIndex } from '../play/model/cards.ts';
import { PlayView } from '../play/PlayView.tsx';
import { DeckPicker } from '../play/setup/DeckSetup.tsx';

type ModeId = 'ranked' | 'casual' | 'tournament' | 'custom';

const ONLINE: { id: ModeId; icon: IconName; label: string; blurb: string; match: string }[] = [
  { id: 'ranked', icon: 'trophy', label: 'Ranked', match: '1v1 Ranked Match', blurb: 'Climb the ladder. Wins earn Rank Points, coins and XP.' },
  { id: 'casual', icon: 'gamepad', label: 'Casual', match: '1v1 Casual Match', blurb: 'Unranked games with your deck. Win to earn coins and XP.' },
  { id: 'tournament', icon: 'crown', label: 'Tournament', match: 'Bracket Tournament', blurb: 'Enter a bracket and play for exclusive prizes.' },
];

/** Online modes need the server: the page is built, the queue waits for it. */
function OnlineMode({ db, mode }: { db: CardDb; mode: (typeof ONLINE)[number] }) {
  const own = useCollection();
  const cards = useMemo(() => cardIndex(db), [db]);
  // the decks the player really has: the starter now, the built ones later
  const decks = useMemo(() => BUILT_IN_DECKS.filter((b) => b.id === own.starter), [own.starter]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const deck = decks.find((d) => d.id === chosen) ?? decks[0] ?? null;
  const legend = deck ? cardFor(cards, deck.deck.legend) : undefined;

  return (
    <section className="play-online">
      <header className="play-online__head">
        <h1>Select your deck</h1>
        <p className="muted">{mode.blurb}</p>
        <span className="lb-soon-note">Online matches arrive with the server update</span>
      </header>
      <div className="play-online__stage">
        <figure className="play-online__side">
          <button type="button" className="play-online__card play-online__card--pick" disabled={!deck} onClick={() => setPicking(true)}
            aria-label={deck ? `${shortName(deck.deck)}. Change deck` : 'No deck yet'}>
            {legend ? <HoloCard card={legend} finish="none" width="100%" imageWidth={480} /> : <CardBack />}
            <span className="play-online__change">Change deck</span>
          </button>
          <figcaption>
            <span className="play-online__tag">Solo</span>
            <strong>{deck ? shortName(deck.deck) : 'No deck yet'}</strong>
            <span className="muted small">{mode.match}</span>
          </figcaption>
        </figure>
        <span className="play-online__vs" aria-hidden>VS</span>
        <figure className="play-online__side is-wait">
          <div className="play-online__card"><CardBack /></div>
          <figcaption>
            <span className="play-online__tag play-online__tag--alt">Opponent</span>
            <strong>Matchmaking</strong>
            <span className="muted small">{mode.id === 'tournament' ? 'Brackets open soon' : 'Found for you'}</span>
          </figcaption>
        </figure>
      </div>
      <div className="play-online__actions">
        <button type="button" className="btn btn--cta" disabled>{mode.id === 'tournament' ? 'Browse tournaments' : 'Find match'}</button>
      </div>
      {!own.starter && <p className="muted">Pick a starter deck on <a href="#home">Home</a> first.</p>}
      {picking && deck && (
        <DeckPicker cards={cards} db={db} title="Your deck" only={decks} current={deck.id} owned={own.starter}
          onClose={() => setPicking(false)} onPick={(b) => { setChosen(b.id); setPicking(false); }} />
      )}
    </section>
  );
}

export function PlayLobby({ db, mode }: { db: CardDb; mode: string }) {
  // #play, #play/computer and the older #play/tutorial all land on the custom game
  const tutorial = mode === 'tutorial';
  const id = (ONLINE.find((m) => m.id === mode)?.id ?? 'custom') as ModeId;
  const [inGame, setInGame] = useState(false);
  const online = ONLINE.find((m) => m.id === id);

  const side = (
    <>
      <SideTitle>GAME MODE</SideTitle>
      {ONLINE.map((m) => <SideLink key={m.id} href={`#play/${m.id}`} icon={m.icon} active={id === m.id} soon>{m.label}</SideLink>)}
      <div className="lb-side__gap" />
      <SideTitle>PLAY NOW</SideTitle>
      <SideLink href="#play/custom" icon="sliders" active={id === 'custom'}>Custom game</SideLink>
      <SideTitle>YOUR RANK</SideTitle>
      <RankCard />
    </>
  );

  // a running game takes the whole width
  const bare = tutorial || (id === 'custom' && inGame);
  return (
    <Lobby side={side} bare={bare}>
      {online ? <OnlineMode db={db} mode={online} /> : (
        <div className={bare ? 'lb-bare' : 'lb-play-scroll'}>
          <PlayView key={tutorial ? 'tutorial' : 'play'} db={db} tutorial={tutorial} onInGame={setInGame} />
        </div>
      )}
    </Lobby>
  );
}
