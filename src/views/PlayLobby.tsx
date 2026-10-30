import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CardBack } from '../card/CardBack.tsx';
import { useCollection } from '../collection/store.ts';
import type { CardDb } from '../data/types.ts';
import { Lobby, RankCard, SideLink, SideTitle } from '../lobby/Lobby.tsx';
import type { IconName } from '../lobby/icons.tsx';
import { playerDecks } from '../play/host/decks.ts';
import { useDecks } from '../decks/store.ts';
import { cardIndex } from '../play/model/cards.ts';
import { PlayView } from '../play/PlayView.tsx';
import { useSession } from '../net/session.ts';
import { online as socket, useOnline } from '../net/socket.ts';
import { useSocial } from '../lobby/social.ts';
import { DeckPicker, DeckSlot, FormatSwitch } from '../play/setup/DeckSetup.tsx';
import { LobbyRoom } from './LobbyRoom.tsx';
import { CasualLimited } from '../limited/OnlineLimited.tsx';

const Tournaments = lazy(() => import('./Tournaments.tsx').then((m) => ({ default: m.Tournaments })));
const OnlineGame = lazy(() => import('../play/OnlineGame.tsx').then((m) => ({ default: m.OnlineGame })));

type ModeId = 'ranked' | 'casual' | 'tournament' | 'custom';

const ONLINE: { id: ModeId; icon: IconName; label: string; blurb: string; match: string }[] = [
  { id: 'ranked', icon: 'trophy', label: 'Ranked', match: '1v1 Ranked Match', blurb: 'Climb the ladder. Wins earn Rank Points, coins and XP.' },
  { id: 'casual', icon: 'gamepad', label: 'Casual', match: '1v1 Casual Match', blurb: 'Unranked games with your deck. Win to earn coins and XP.' },
  { id: 'tournament', icon: 'crown', label: 'Tournament', match: 'Bracket Tournament', blurb: 'Enter a bracket and play for exclusive prizes.' },
];

/** mm:ss since a moment. */
function Waited({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</>;
}

/** A seat matchmaking fills. */
function Waiting({ label, queued, tournament }: { label: string; queued: { since: number } | null; tournament?: boolean }) {
  return (
    <figure className="ds-slot is-wait">
      <div className="ds-slot__card">
        <div className="ds-slot__back"><CardBack /></div>
        <span className="ds-slot__tag ds-slot__tag--alt">{label}</span>
      </div>
      <figcaption>
        <strong>{queued ? 'Searching…' : 'Matchmaking'}</strong>
        <span className="muted small">{tournament ? 'Brackets open soon' : queued ? <>Waiting <Waited since={queued.since} /></> : 'Found for you'}</span>
      </figcaption>
    </figure>
  );
}

/** Online modes need the server: the page is built, the queue waits for it. Same frame as the custom game. */
function OnlineMode({ db, mode }: { db: CardDb; mode: (typeof ONLINE)[number] }) {
  const own = useCollection();
  const cards = useMemo(() => cardIndex(db), [db]);
  // the decks the player really has, ready to play: the starter and the built ones
  const built = useDecks();
  const decks = useMemo(() => playerDecks(own, true), [own, built]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // casual: your own deck, or a Limited pool
  const [kind, setKind] = useState<'constructed' | 'sealed' | 'draft'>('constructed');
  // casual: 1v1, or 2v2 with three others (or a friend from a lobby)
  const [duo, setDuo] = useState(false);
  const queueMode = mode.id === 'casual' && duo ? 'duo' : mode.id;
  const deck = decks.find((d) => d.id === chosen) ?? decks[0] ?? null;
  const session = useSession();
  const ol = useOnline();
  const signedIn = session.status === 'online' && !!session.user;
  const playable = mode.id === 'ranked' || mode.id === 'casual';
  const queued = ol.queue && ol.queue.mode === queueMode ? ol.queue : null;
  const note = session.status === 'offline' ? 'Not in the preview'
    : !signedIn ? 'Sign in with Discord' : !playable ? 'Soon' : ol.status !== 'open' ? 'Connecting…' : null;

  return (
    <section className="play-setup ds">
      <header className="ds__bar">
        <h1>{mode.label}</h1>
        <span className="ds__bar-right">
          {/* what casual plays; what it doesn't yet is greyed out (2v2: Constructed only). Ranked is 1v1 Constructed, nothing to pick */}
          {mode.id === 'casual' && signedIn && (
            <div className="seg seg--format" role="group" aria-label="Deck">
              {(['constructed', 'sealed', 'draft'] as const).map((k) => {
                const soon = k !== 'constructed' && duo;
                return (
                  <button key={k} type="button" aria-pressed={(soon ? 'constructed' : kind) === k} disabled={soon} data-soon={soon ? '' : undefined}
                    onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
                );
              })}
            </div>
          )}
          {mode.id === 'casual' && <FormatSwitch value={duo ? '2v2' : '1v1'} onChange={(v) => { setDuo(v === '2v2'); if (v === '2v2') setKind('constructed'); }} />}
          {note && <span className="lb-soon-note">{note}</span>}
        </span>
      </header>

      {mode.id === 'casual' && kind !== 'constructed' && signedIn ? <CasualLimited db={db} format={kind} /> : <>
      <div className="ds__stage">
        {deck ? (
          <DeckSlot label="You" b={deck} cards={cards} db={db} owned onOpen={() => setPicking(true)} />
        ) : (
          <figure className="ds-slot">
            <div className="ds-slot__card"><div className="ds-slot__back"><CardBack /></div></div>
            <figcaption><strong>No deck yet</strong><span className="muted small">Pick a starter deck on Home first.</span></figcaption>
          </figure>
        )}
        {duo && <Waiting label="Teammate" queued={queued} />}
        <span className="play-online__vs" aria-hidden>VS</span>
        <Waiting label={duo ? 'Opponents' : 'Opponent'} queued={queued} tournament={mode.id === 'tournament'} />
      </div>
      {duo && <p className="muted small play-online__note">2v2 to 11 points: three battlefields, teammates share their points. Invite a friend from the friends list to search together.</p>}

      <div className="ds__start">
        {queued ? (
          <button type="button" className="btn btn--ghost" onClick={() => socket.send({ t: 'leave' })}>Cancel search</button>
        ) : (
          <button type="button" className="btn btn--cta" disabled={!!note || !deck}
            onClick={() => { socket.clearError(); if (deck && playable) socket.send({ t: 'queue', mode: queueMode as 'ranked' | 'casual' | 'duo', deck: deck.id }); }}>
            {mode.id === 'tournament' ? 'Browse tournaments' : 'Find match'}
          </button>
        )}
      </div>
      {picking && deck && (
        <DeckPicker cards={cards} db={db} title="Your deck" only={decks} current={deck.id} owned={own.starter}
          onClose={() => setPicking(false)} onPick={(b) => { setChosen(b.id); setPicking(false); }} />
      )}
      </>}
    </section>
  );
}

export function PlayLobby({ db, mode }: { db: CardDb; mode: string }) {
  // #play, #play/computer and the older #play/tutorial all land on the custom game
  const tutorial = mode === 'tutorial';
  const id = (ONLINE.find((m) => m.id === mode)?.id ?? 'custom') as ModeId;
  const [inGame, setInGame] = useState(false);
  const online = ONLINE.find((m) => m.id === id);
  const ol = useOnline();
  const { lobby } = useSocial();
  // an online game (or its end screen) takes the page, whatever tab is open
  if (ol.start && (ol.game === ol.start.gameId || ol.end?.gameId === ol.start.gameId)) {
    return (
      <Lobby bare>
        <div className="lb-bare">
          <Suspense fallback={<p className="status">Setting up the table…</p>}>
            <OnlineGame key={ol.start.gameId} db={db} start={ol.start} end={ol.end?.gameId === ol.start.gameId ? ol.end : null} />
          </Suspense>
        </div>
      </Lobby>
    );
  }

  const side = (
    <>
      <SideTitle>YOUR RANK</SideTitle>
      <RankCard />
      <div className="lb-side__gap" />
      <SideTitle>GAME MODE</SideTitle>
      {ONLINE.map((m) => <SideLink key={m.id} href={`#play/${m.id}`} icon={m.icon} active={id === m.id} >{m.label}</SideLink>)}
      <div className="lb-side__gap" />
      <SideTitle>PLAY NOW</SideTitle>
      <SideLink href="#play/custom" icon="sliders" active={id === 'custom'}>Custom game</SideLink>
    </>
  );

  // a running game takes the whole width
  const bare = tutorial || (id === 'custom' && inGame);
  return (
    <Lobby side={side} bare={bare}>
      {/* in a lobby: its room, on the page it belongs to (the custom game, or casual for 2v2) */}
      {lobby && ((lobby.mode === 'custom' && id === 'custom') || (lobby.mode === 'casual' && (id === 'casual' || id === 'custom'))) ? <LobbyRoom db={db} lobby={lobby} />
        : online?.id === 'tournament' ? <Suspense fallback={<p className="muted">Loading…</p>}><Tournaments db={db} /></Suspense>
        : online ? <OnlineMode db={db} mode={online} /> : (
        <div className={bare ? 'lb-bare' : 'lb-play-scroll'}>
          <PlayView key={tutorial ? 'tutorial' : 'play'} db={db} tutorial={tutorial} onInGame={setInGame} />
        </div>
      )}
    </Lobby>
  );
}
