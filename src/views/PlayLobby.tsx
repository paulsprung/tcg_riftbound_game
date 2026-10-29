import { useEffect, useState } from 'react';
import { HoloCard } from '../card/HoloCard.tsx';
import { CardBack } from '../card/CardBack.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { loadStarters, type StarterChoice } from '../economy/starter.ts';
import { Lobby, RankCard, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import { PlayView } from '../play/PlayView.tsx';

type ModeId = 'ranked' | 'casual' | 'custom' | 'tournament' | 'computer' | 'tutorial';

const ONLINE: { id: ModeId; icon: string; label: string; blurb: string; match: string }[] = [
  { id: 'ranked', icon: '🏆', label: 'Ranked', match: '1v1 Ranked Match', blurb: 'Climb the ladder. Wins earn Rank Points, coins and XP.' },
  { id: 'casual', icon: '🎮', label: 'Casual', match: '1v1 Casual Match', blurb: 'Unranked games with your deck. Win to earn coins and XP.' },
  { id: 'custom', icon: '⚙', label: 'Custom', match: 'Private Lobby', blurb: 'Invite a friend to a private match. Every card in the game is available, no deck needed.' },
  { id: 'tournament', icon: '♛', label: 'Tournament', match: 'Bracket Tournament', blurb: 'Enter a bracket and play for exclusive prizes.' },
];
const OFFLINE: { id: ModeId; icon: string; label: string }[] = [
  { id: 'computer', icon: '🤖', label: 'vs Computer' },
  { id: 'tutorial', icon: '📖', label: 'Tutorial' },
];

/** Online modes need the server: the page is built, the queue waits for it. */
function OnlineMode({ db, mode }: { db: CardDb; mode: (typeof ONLINE)[number] }) {
  const own = useCollection();
  const [deck, setDeck] = useState<StarterChoice | null>(null);
  useEffect(() => {
    let alive = true;
    loadStarters(db).then((all) => { if (alive) setDeck(all.find((s) => s.id === own.starter) ?? null); }).catch(() => undefined);
    return () => { alive = false; };
  }, [db, own.starter]);
  const legend = deck?.legendCard ? db.cards.find((c) => c.id === deck.legendCard) : undefined;

  return (
    <section className="play-online">
      <header className="play-online__head">
        <h1>{mode.id === 'custom' ? 'Private lobby' : 'Select your deck'}</h1>
        <p className="muted">{mode.blurb}</p>
        <span className="lb-soon-note">Online matches arrive with the server update</span>
      </header>
      <div className="play-online__stage">
        <figure className="play-online__side">
          <div className="play-online__card">
            {legend ? <HoloCard card={legend} finish="none" width="100%" imageWidth={480} /> : <CardBack />}
          </div>
          <figcaption>
            <span className="play-online__tag">{mode.id === 'custom' ? 'You' : 'Solo'}</span>
            <strong>{mode.id === 'custom' ? 'All cards available' : deck?.title ?? 'No deck yet'}</strong>
            <span className="muted small">{mode.match}</span>
          </figcaption>
        </figure>
        <span className="play-online__vs" aria-hidden>VS</span>
        <figure className="play-online__side is-wait">
          <div className="play-online__card"><CardBack /></div>
          <figcaption>
            <span className="play-online__tag play-online__tag--alt">Opponent</span>
            <strong>{mode.id === 'custom' ? 'A friend' : 'Matchmaking'}</strong>
            <span className="muted small">{mode.id === 'tournament' ? 'Brackets open soon' : 'Found for you'}</span>
          </figcaption>
        </figure>
      </div>
      <div className="play-online__actions">
        <button type="button" className="btn btn--cta" disabled>{mode.id === 'custom' ? 'Create lobby' : mode.id === 'tournament' ? 'Browse tournaments' : 'Find match'}</button>
        <a className="btn btn--ghost" href="#play/computer">Practice vs Computer</a>
      </div>
      {!own.starter && <p className="muted">Pick a starter deck on <a href="#home">Home</a> first.</p>}
    </section>
  );
}

export function PlayLobby({ db, mode }: { db: CardDb; mode: string }) {
  const id = ([...ONLINE, ...OFFLINE].find((m) => m.id === mode)?.id ?? 'computer') as ModeId;
  const [inGame, setInGame] = useState(false);
  const online = ONLINE.find((m) => m.id === id);

  const side = (
    <>
      <SideTitle>GAME MODE</SideTitle>
      {ONLINE.map((m) => <SideLink key={m.id} href={`#play/${m.id}`} icon={m.icon} active={id === m.id} soon>{m.label}</SideLink>)}
      <div className="lb-side__gap" />
      <SideTitle>PLAY NOW</SideTitle>
      {OFFLINE.map((m) => <SideLink key={m.id} href={`#play/${m.id}`} icon={m.icon} active={id === m.id}>{m.label}</SideLink>)}
      <SideTitle>YOUR RANK</SideTitle>
      <RankCard />
    </>
  );

  // The tutorial and a running game take the whole width.
  const bare = id === 'tutorial' || (id === 'computer' && inGame);
  return (
    <Lobby side={side} bare={bare}>
      {online ? <OnlineMode db={db} mode={online} /> : (
        <div className={bare ? 'lb-bare' : 'lb-play-scroll'}>
          <PlayView key={id === 'tutorial' ? 'tutorial' : 'play'} db={db} tutorial={id === 'tutorial'} onInGame={setInGame} />
        </div>
      )}
    </Lobby>
  );
}
