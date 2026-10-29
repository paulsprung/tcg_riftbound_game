import { useMemo, useState } from 'react';
import { CardBack } from '../card/CardBack.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { Lobby, RankCard, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import type { IconName } from '../lobby/icons.tsx';
import { BUILT_IN_DECKS } from '../play/host/decks.ts';
import { cardIndex } from '../play/model/cards.ts';
import { PlayView } from '../play/PlayView.tsx';
import { DeckPicker, DeckSlot, FormatSwitch } from '../play/setup/DeckSetup.tsx';

type ModeId = 'ranked' | 'casual' | 'tournament' | 'custom';

const ONLINE: { id: ModeId; icon: IconName; label: string; blurb: string; match: string }[] = [
  { id: 'ranked', icon: 'trophy', label: 'Ranked', match: '1v1 Ranked Match', blurb: 'Climb the ladder. Wins earn Rank Points, coins and XP.' },
  { id: 'casual', icon: 'gamepad', label: 'Casual', match: '1v1 Casual Match', blurb: 'Unranked games with your deck. Win to earn coins and XP.' },
  { id: 'tournament', icon: 'crown', label: 'Tournament', match: 'Bracket Tournament', blurb: 'Enter a bracket and play for exclusive prizes.' },
];

/** Online modes need the server: the page is built, the queue waits for it. Same frame as the custom game. */
function OnlineMode({ db, mode }: { db: CardDb; mode: (typeof ONLINE)[number] }) {
  const own = useCollection();
  const cards = useMemo(() => cardIndex(db), [db]);
  // the decks the player really has: the starter now, the built ones later
  const decks = useMemo(() => BUILT_IN_DECKS.filter((b) => b.id === own.starter), [own.starter]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const deck = decks.find((d) => d.id === chosen) ?? decks[0] ?? null;

  return (
    <section className="play-setup ds">
      <header className="ds__bar">
        <h1>{mode.label}</h1>
        <span className="ds__bar-right">
          {mode.id === 'casual' && <FormatSwitch />}
          <span className="lb-soon-note">Online matches arrive with the server update</span>
        </span>
      </header>

      <div className="ds__stage">
        {deck ? (
          <DeckSlot label="You" b={deck} cards={cards} db={db} owned onOpen={() => setPicking(true)} />
        ) : (
          <figure className="ds-slot">
            <div className="ds-slot__card"><div className="ds-slot__back"><CardBack /></div></div>
            <figcaption><strong>No deck yet</strong><span className="muted small">Pick a starter deck on Home first.</span></figcaption>
          </figure>
        )}
        <span className="play-online__vs" aria-hidden>VS</span>
        <figure className="ds-slot is-wait">
          <div className="ds-slot__card">
            <div className="ds-slot__back"><CardBack /></div>
            <span className="ds-slot__tag ds-slot__tag--alt">Opponent</span>
          </div>
          <figcaption>
            <strong>Matchmaking</strong>
            <span className="muted small">{mode.id === 'tournament' ? 'Brackets open soon' : 'Found for you'}</span>
          </figcaption>
        </figure>
      </div>

      <div className="ds__start">
        <button type="button" className="btn btn--cta" disabled>{mode.id === 'tournament' ? 'Browse tournaments' : 'Find match'}</button>
      </div>
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
      <SideTitle>YOUR RANK</SideTitle>
      <RankCard />
      <div className="lb-side__gap" />
      <SideTitle>GAME MODE</SideTitle>
      {ONLINE.map((m) => <SideLink key={m.id} href={`#play/${m.id}`} icon={m.icon} active={id === m.id} soon>{m.label}</SideLink>)}
      <div className="lb-side__gap" />
      <SideTitle>PLAY NOW</SideTitle>
      <SideLink href="#play/custom" icon="sliders" active={id === 'custom'}>Custom game</SideLink>
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
