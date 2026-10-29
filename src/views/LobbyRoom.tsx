import { useEffect, useMemo, useState } from 'react';
import { CardBack } from '../card/CardBack.tsx';
import { HoloCard } from '../card/HoloCard.tsx';
import { useCollection } from '../collection/store.ts';
import { defaultFinish } from '../data/cardInfo.ts';
import type { CardDb } from '../data/types.ts';
import { useDecks } from '../decks/store.ts';
import { social } from '../lobby/social.ts';
import type { LobbyMember, LobbyView } from '../net/protocol.ts';
import { useSession } from '../net/session.ts';
import { playerDecks } from '../play/host/decks.ts';
import { cardFor, cardIndex, type CardIndex } from '../play/model/cards.ts';
import { DeckPicker } from '../play/setup/DeckSetup.tsx';

/*
 * The lobby of the custom game (or casual 2v2), as in the League client:
 * each member's deck as their legend card, who is ready; the host starts
 * when everyone is ready. Ready locks your deck: un-ready to change it.
 */

function Seat({ m, cards, me, onChange }: { m: LobbyMember | null; cards: CardIndex; me: boolean; onChange?: () => void }) {
  const legend = m?.deck ? cardFor(cards, m.deck.legend) : null;
  return (
    <figure className={`ds-slot lobby-seat${m?.ready ? ' is-ready' : ''}`}>
      <div className="ds-slot__card">
        {legend ? <HoloCard card={legend} finish={defaultFinish(legend)} width="100%" tilt="hover" imageWidth={480} /> : <div className="ds-slot__back"><CardBack /></div>}
        {m && <span className="ds-slot__tag">{m.host ? 'Host' : m.ready ? 'Ready' : 'Not ready'}</span>}
      </div>
      <figcaption>
        <strong>{m ? m.name : 'Free seat'}</strong>
        <span className="muted small">{m?.deck?.name ?? (m ? 'No deck yet' : 'Invite a friend from the friends list')}</span>
        {me && <button type="button" className="btn btn--small" disabled={m?.ready} onClick={onChange}>Change deck</button>}
      </figcaption>
    </figure>
  );
}

export function LobbyRoom({ db, lobby }: { db: CardDb; lobby: LobbyView }) {
  const session = useSession();
  const myId = session.status === 'online' ? session.user?.id : undefined;
  const own = useCollection();
  const built = useDecks();
  const decks = useMemo(() => playerDecks(own, true), [own, built]);
  const cards = useMemo(() => cardIndex(db), [db]);
  const [picking, setPicking] = useState(false);
  const me = lobby.members.find((m) => m.id === myId) ?? null;
  const other = lobby.members.find((m) => m.id !== myId) ?? null;
  const host = !!me?.host;

  // a deck to begin with: your first ready one
  useEffect(() => { if (me && !me.deck && decks[0]) social.deck(decks[0].id); }, [me, decks]);

  const allReady = lobby.members.length === lobby.max && lobby.members.every((m) => m.host || m.ready);
  const canStart = host && allReady && !!me?.deck && lobby.mode === 'custom' && !lobby.inGame;
  return (
    <section className="play-setup ds">
      <header className="ds__bar">
        <h1>{lobby.mode === 'casual' ? 'Casual 2v2' : 'Custom game'} <em className="lobby-tag">Lobby</em></h1>
        <span className="ds__bar-right">
          {lobby.invited.map((i) => <span key={i.id} className="lb-soon-note">Invited: {i.name}</span>)}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => social.leave()}>Leave lobby</button>
        </span>
      </header>

      <div className="ds__stage">
        <Seat m={me} cards={cards} me onChange={() => setPicking(true)} />
        <span className="play-online__vs" aria-hidden>VS</span>
        <Seat m={other} cards={cards} me={false} />
      </div>

      <div className="ds__start">
        {host ? (
          <button type="button" className="btn btn--cta" disabled={!canStart} onClick={() => social.start()}>
            {lobby.mode === 'casual' ? '2v2 soon' : lobby.inGame ? 'In game' : 'Start game'}
          </button>
        ) : me?.ready ? (
          <button type="button" className="btn btn--ghost" onClick={() => social.ready(false)}>Not ready</button>
        ) : (
          <button type="button" className="btn btn--cta" disabled={!me?.deck} onClick={() => social.ready(true)}>Ready</button>
        )}
      </div>

      {picking && (
        <DeckPicker cards={cards} db={db} title="Your deck" only={decks} current={me?.deck?.ref ?? ''} owned={own.starter}
          onClose={() => setPicking(false)} onPick={(b) => { setPicking(false); social.deck(b.id); }} />
      )}
    </section>
  );
}
