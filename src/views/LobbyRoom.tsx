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
import { online as socket, useOnline } from '../net/socket.ts';
import { playerDecks } from '../play/host/decks.ts';
import { cardFor, cardIndex, type CardIndex } from '../play/model/cards.ts';
import { DeckPicker } from '../play/setup/DeckSetup.tsx';

/*
 * The lobby of the custom game (or casual 2v2), as in the League client:
 * each member's deck as their legend card, who is ready; the host starts
 * when everyone is ready. Ready locks your deck: un-ready to change it.
 * Casual 2v2 has two teams of two: four start a game at once, two on one
 * team search together for two more.
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
  const duo = lobby.mode === 'casual';
  const ol = useOnline();
  const searching = duo && ol.queue?.mode === 'duo' ? ol.queue : null;

  // a deck to begin with: your first ready one
  useEffect(() => { if (me && !me.deck && decks[0]) social.deck(decks[0].id); }, [me, decks]);

  const allReady = lobby.members.every((m) => m.host || m.ready) && lobby.members.every((m) => m.deck);
  const team = (t: 0 | 1) => lobby.members.filter((m) => m.team === t);
  // 2v2: four in two teams play, two on one team search
  const duoOk = team(0).length === 2 ? team(1).length !== 1 : team(1).length === 2 && team(0).length === 0;
  const canStart = host && allReady && !lobby.inGame && (duo ? duoOk : lobby.members.length === lobby.max);
  const startLabel = lobby.inGame ? 'In game' : !duo ? 'Start game' : lobby.members.length === 4 ? 'Start 2v2' : 'Search together';
  const side = (t: 0 | 1) => {
    const ms = team(t);
    return [0, 1].map((i) => <Seat key={ms[i]?.id ?? `free${t}${i}`} m={ms[i] ?? null} cards={cards} me={ms[i]?.id === myId} onChange={() => setPicking(true)} />);
  };
  return (
    <section className="play-setup ds">
      <header className="ds__bar">
        <h1>{lobby.mode === 'casual' ? '2v2 Duo' : 'Custom game'} <em className="lobby-tag">Lobby</em></h1>
        <span className="ds__bar-right">
          {lobby.invited.map((i) => <span key={i.id} className="lb-soon-note">Invited: {i.name}</span>)}
          {/* with friends: your own decks; Sealed and Draft with friends come later */}
          <div className="seg seg--format" role="group" aria-label="Deck">
            <button type="button" aria-pressed="true">Constructed</button>
            <button type="button" aria-pressed="false" disabled data-soon="">Sealed</button>
            <button type="button" aria-pressed="false" disabled data-soon="">Draft</button>
          </div>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => social.leave()}>Leave lobby</button>
        </span>
      </header>

      {duo ? (
        <div className="ds__stage lobby-teams">
          <div className="lobby-team"><span className="lobby-team__label">Team 1</span>{side(0)}</div>
          <span className="play-online__vs" aria-hidden>VS</span>
          <div className="lobby-team"><span className="lobby-team__label">Team 2</span>{side(1)}</div>
        </div>
      ) : (
        <div className="ds__stage">
          <Seat m={me} cards={cards} me onChange={() => setPicking(true)} />
          <span className="play-online__vs" aria-hidden>VS</span>
          <Seat m={other} cards={cards} me={false} />
        </div>
      )}
      {duo && <p className="muted small play-online__note">Four of you: a friendly 2v2 at once (no coins). Two of you on one team: search together for two more. Teammates play different legends and battlefields.</p>}

      <div className="ds__start">
        {duo && !searching && me && !me.ready && (
          <button type="button" className="btn btn--ghost" disabled={team((1 - me.team) as 0 | 1).length >= 2} onClick={() => social.team()}>Switch team</button>
        )}
        {searching ? (
          <button type="button" className="btn btn--ghost" onClick={() => socket.send({ t: 'leave' })}>Cancel search</button>
        ) : host ? (
          <button type="button" className="btn btn--cta" disabled={!canStart} onClick={() => { socket.clearError(); social.start(); }}>{startLabel}</button>
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
