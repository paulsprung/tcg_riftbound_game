import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Select } from '../lobby/Select.tsx';
import './play.css';
import './board.css';
import type { CardDb } from '../data/types.ts';
import { explainUnavailable, type GameRecord } from '../game/index.ts';
import { DevPanel } from './dev/DevPanel.tsx';
import type { TableHost } from './host/GameHost.ts';
import type { OnlineClock } from './host/RemoteHost.ts';
import { useHost } from './host/useHost.ts';
import { isAssign, rowOf, suggestKey } from './model/assign.ts';
import { boardOf, type CardSlot } from './model/board.ts';
import { isRune, nameOf, type CardIndex } from './model/cards.ts';
import { affordances, type Affordances } from './model/affordances.ts';
import { describeAll, resultHow, whereText } from './model/describe.ts';
import { fxOf, hasFx, NO_FX, type Fx } from './model/fx.ts';
import { setupSummary, stageOf } from './model/stage.ts';
import { AssignWidget } from './prompt/AssignWidget.tsx';
import { CastingSlot } from './prompt/CastingSlot.tsx';
import { HandoffCover, ReportDialog } from './prompt/Dialogs.tsx';
import { GameOver } from './prompt/GameOver.tsx';
import { ModeSheet } from './prompt/ModeSheet.tsx';
import { Mulligan } from './prompt/Mulligan.tsx';
import { OrderChoice } from './prompt/OrderChoice.tsx';
import { PromptBar, SetupDone } from './prompt/PromptBar.tsx';
import { setSettings, usePlaySettings, type PaceChoice } from './settings.ts';
import { CardZoom } from './table/CardZoom.tsx';
import { Board } from './table/Board.tsx';
import { ChainBox, GameLog, Preview, RailHead, Scores } from './table/Rail.tsx';
import { TableLookContext, type TableLook } from './table/tableContext.ts';
import { CoachPopup } from './tutorial/CoachPopup.tsx';
import { restrict, type Coach } from './tutorial/coach.ts';

/*
 * One game on screen: the table from one seat's view, with the setup steps
 * over it (§12.1). Everything shown comes from the host's snapshot (that
 * seat's view and the events it observed); every click sends option keys
 * back through the host.
 *
 * On top of the table (M1.4): the casting slot, the mode sheet and the
 * combat damage widget for the prompts of a play and a combat (§12.5); the
 * animations of the latest events, the opponent's outlined (§12.6); the
 * hot-seat handoff cover; "Report a rules problem"; the DEV panel (hidden
 * by default, Ctrl+Shift+D); and the tutorial hook (`coach`, see
 * tutorial/coach.ts): its step's prompt, highlights and allowed keys.
 */

const FX_MS = 1500;

/** The names at the table: yours, the (first) opponent's, every seat's (2v2: four). */
export interface SeatNames { me: string; opponent: string; all?: string[] }

/** A guided game (tutorial/TutorialView.tsx): its own subtitle and header
    buttons; no setup sheets, concede or game-over sheet (the tutorial shows
    its own ending). */
export interface TutorialFrame { subtitle: string; actions: ReactNode }

/** A game against another player through the server: its mode, the clock on the pending decision, and what the end brought. */
export interface OnlineFrame {
  mode: string;
  clock: () => OnlineClock;
  /** Rating and coins, once the server has said. */
  outcome: ReactNode;
}

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The chess clock: the free seconds of a decision, then the time bank running; both banks below. */
function DecisionClock({ clock }: { clock: OnlineFrame['clock'] }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  const { mine, theirs, grace, banks } = clock();
  const now = Date.now();
  const deadline = mine ?? theirs;
  // a bank as it stands now: it runs once the grace is over
  const bank = (i: 0 | 1, running: boolean) => (banks ? (running && deadline !== null && grace !== null && now > grace ? deadline - now : banks[i]) : null);
  const myBank = bank(0, mine !== null), theirBank = bank(1, theirs !== null);
  const free = grace !== null && now < grace ? Math.ceil((grace - now) / 1000) : null;
  const low = mine !== null && mine - now <= 15_000;
  if (mine === null && theirs === null && !banks) return null;
  return (
    <div className={`rail__clock${mine !== null ? ' is-mine' : theirs !== null ? ' is-theirs' : ''}${low ? ' is-low' : ''}`}>
      {mine !== null && <strong>{free !== null ? `Your turn · ${free}s` : `Time bank · ${mmss(mine - now)}`}</strong>}
      {theirs !== null && <strong>{free !== null ? 'Opponent deciding…' : `Opponent's bank · ${mmss(theirs - now)}`}</strong>}
      {myBank !== null && theirBank !== null && (
        <span className="rail__banks"><span>You {mmss(myBank)}</span><span>Them {mmss(theirBank)}</span></span>
      )}
    </div>
  );
}

export function GameScreen({ host, cards, db, names, onNewGame, onChangeDecks, onLoadRecord, coach, tutorial, online }: {
  host: TableHost; cards: CardIndex; db: CardDb; names: string[];
  onNewGame: () => void; onChangeDecks: () => void; onLoadRecord?: (r: GameRecord) => void; coach?: Coach;
  tutorial?: TutorialFrame;
  online?: OnlineFrame;
}) {
  const snap = useHost(host);
  const { view, events, error, viewer, handoff, thinking } = snap;
  const settings = usePlaySettings();
  const board = useMemo(() => boardOf(view, isRune), [view]);
  const stage = stageOf(view);
  const summary = useMemo(() => setupSummary(events), [events]);
  const seatNames: SeatNames = { me: names[viewer], opponent: names[board.opponent.p], all: names };
  // you won: you, or in 2v2 your team [491]
  const won = (w: number) => w === view.me || board.teammate?.p === w;
  const log = useMemo(() => describeAll(events, {
    me: view.me,
    nameOf: (d) => nameOf(cards, d),
    objOf: (id) => {
      const o = view.objects[id];
      return o ? { def: 'def' in o ? o.def : null, owner: o.owner } : null;
    },
    bfObj: (bf) => view.bfs[bf]?.obj,
    ...(view.players.length > 2 ? { players: names } : {}),
  }), [events, view, cards, names]);

  // ---- animations of the newest events (§12.6) ----
  const [fx, setFx] = useState<Fx>(NO_FX);
  const seenCount = useRef({ viewer, n: events.length });
  const mineNext = useRef(false);
  useEffect(() => {
    const prev = seenCount.current;
    seenCount.current = { viewer, n: events.length };
    if (prev.viewer !== viewer || events.length <= prev.n) return;
    const batch = fxOf(events.slice(prev.n), Date.now(), !mineNext.current);
    mineNext.current = false;
    if (!hasFx(batch)) return;
    setFx(batch);
    const t = setTimeout(() => setFx((f) => (f.token === batch.token ? NO_FX : f)), FX_MS);
    return () => clearTimeout(t);
  }, [events, viewer]);

  const [zoom, setZoom] = useState<CardSlot | null>(null);
  const [atTable, setAtTable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [report, setReport] = useState(false);
  const [confirmConcede, setConfirmConcede] = useState(false);
  const closeZoom = useCallback(() => setZoom(null), []);
  const [hover, setHover] = useState<CardSlot | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // the table fills the window: the lobby's own bars step aside while a game is on
  useEffect(() => {
    document.documentElement.dataset.game = '';
    return () => { delete document.documentElement.dataset.game; };
  }, []);
  const preview = useCallback((keys: string[]) => host.preview(keys), [host]);
  const mine = stage.k === 'deciding' && stage.mine && view.pending !== null && handoff === null;
  const names_ = useCallback((d: string) => nameOf(cards, d), [cards]);

  // ---- the tutorial hook ----
  const step = coach?.step({ view, events, decision: mine ? view.pending : null }) ?? null;
  const allow = step?.allow;

  const commit = useCallback((keys: string[]) => {
    mineNext.current = true;
    if (host.commit(keys)) coach?.onAnswer?.(keys, { view: host.getSnapshot().view, events: host.getSnapshot().events,
      decision: host.getSnapshot().view.pending });
  }, [host, coach]);

  // ---- the combat damage batch is drafted (§4.7, §12.5) ----
  const d = view.pending;
  const assigning = mine && isAssign(d);
  const batchId = assigning ? `${d!.batch ?? ''}:${d!.id}` : '';
  const [draft, setDraft] = useState<{ id: string; keys: string[] }>({ id: '', keys: [] });
  const keys = draft.id === batchId ? draft.keys : [];
  const next = useMemo(() => {
    if (!assigning) return null;
    try { return preview(keys); } catch { return preview([]); }
  }, [assigning, keys, preview]);
  const rows = useMemo(() => {
    if (!assigning) return [];
    // each drafted key's amount, read off the decision that offered it
    const out = [];
    let at = d!;
    for (let i = 0; i < keys.length; i++) {
      const r = rowOf(at, keys[i]);
      if (r) out.push(r);
      const p = preview(keys.slice(0, i + 1));
      if (!p.decision) break;
      at = p.decision;
    }
    return out;
  }, [assigning, keys, d, preview]);
  const addDraft = (key: string) => setDraft({ id: batchId, keys: [...keys, key] });
  const suggest = () => {
    let ks = keys.slice();
    for (let i = 0; i < 40; i++) {
      const p = preview(ks);
      if (!p.decision) break;
      ks = [...ks, suggestKey(view, p.decision)];
    }
    setDraft({ id: batchId, keys: ks });
  };

  const base = useMemo<Affordances | null>(() => {
    if (!mine || !view.pending) return null;
    if (assigning) return next?.decision ? affordances(view, next.decision, keys, view.pending, names_) : null;
    return affordances(view, view.pending, [], view.pending, names_);
  }, [mine, view, names_, assigning, next, keys]);
  const a = useMemo(() => restrict(base, allow), [base, allow]);

  // Why a card in hand can't be played now (§12.7), for its tooltip: only
  // while the human holds priority, from their own view.
  const why = useMemo(() => {
    const out: Record<number, string> = {};
    if (!mine || view.pending?.kind !== 'priority') return out;
    const me = view.players[view.me];
    for (const id of [...me.hand, ...(me.champion === null ? [] : [me.champion])]) {
      if (a?.objects[id]) continue;
      const reasons = explainUnavailable(view, id);
      if (reasons.length > 0) out[id] = reasons.map((r) => r.text).join(' ');
    }
    return out;
  }, [mine, view, a]);
  // ---- paying by tapping runes (§12.5) ----
  const plans = useMemo(() => {
    if (!mine || d?.kind !== 'payment') return null;
    const ok = allow ?? (() => true);
    return d.options.filter((o) => o.key.startsWith('pay:') && ok(o.key)).map((o) => ({
      key: o.key, objs: [...new Set((o.refs ?? []).flatMap((r) => ('obj' in r ? [r.obj] : [])))],
    }));
  }, [mine, d, allow]);
  const [pick, setPick] = useState<{ id: string; objs: number[] }>({ id: '', objs: [] });
  const payId = plans ? String(d!.id) : '';
  const picked = useMemo(() => new Set(pick.id === payId ? pick.objs : []), [pick, payId]);
  const payMatch = useMemo(() => plans?.find((p) => p.objs.length === picked.size && p.objs.every((o) => picked.has(o))) ?? null, [plans, picked]);
  const pay = useMemo(() => {
    if (!plans) return undefined;
    const still = plans.filter((p) => [...picked].every((o) => p.objs.includes(o)));
    const selectable = new Set<number>([...picked, ...still.flatMap((p) => p.objs)]);
    return { selectable, picked, toggle: (id: number) => setPick((cur) => {
      const have = new Set(cur.id === payId ? cur.objs : []);
      if (have.has(id)) have.delete(id); else have.add(id);
      return { id: payId, objs: [...have] };
    }) };
  }, [plans, picked, payId]);

  const acts = useMemo(() => ({
    a, why, pay, send: (key: string) => { if (assigning) addDraft(key); else commit([key]); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [a, why, pay, commit, assigning, keys, batchId]);

  const look = useMemo<TableLook>(() => ({
    fx, coachObjs: new Set(step?.highlight?.objs ?? []), coachLanes: new Set(step?.highlight?.lanes ?? []),
    coachKeys: new Set(step?.highlight?.keys ?? []), hover: setHover,
  }), [fx, step]);

  // ---- keys: Ctrl+Shift+D toggles the DEV panel ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setSettings({ dev: !settings.dev });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.dev]);

  const playing = view.turn.n > 0;
  const modeSheet = mine && d?.kind === 'mode';
  const payButtons = plans ? [
    { key: 'pay-confirm', label: payMatch ? 'Pay' : picked.size > 0 ? `Pay (${picked.size} picked)` : 'Pay', primary: true, disabled: !payMatch,
      commit: [payMatch?.key ?? 'pay:0'] },
    ...(plans.length > 0 ? [{ key: 'pay-auto', label: 'Auto-pay', commit: [plans[0].key] }] : []),
  ] : [];
  const promptA = a && (modeSheet ? { ...a, buttons: a.buttons.filter((b) => !b.key?.startsWith('mode:')) }
    : assigning ? { ...a, buttons: [] }
    : plans ? { ...a, buttons: [...payButtons, ...a.buttons.filter((b) => !b.key?.startsWith('pay:') && b.key !== 'manualPay')] } : a);
  const theirLines = log.filter((l) => l.who === 'opponent').slice(-2);
  const hot = host.hotseat;

  const promptArea = (
    <>
      {mine && <CastingSlot view={view} cards={cards} db={db} />}
      {modeSheet && d && <ModeSheet d={d} cards={cards} onCommit={commit} coachKeys={look.coachKeys} allow={allow} />}
      {assigning && d && (
        <AssignWidget view={view} first={d} next={next?.decision ?? null} draft={keys} rows={rows} complete={!!next?.complete}
          cards={cards} onPick={addDraft} onUndo={() => setDraft({ id: batchId, keys: keys.slice(0, -1) })} onSuggest={suggest}
          onConfirm={() => { const ks = keys; setDraft({ id: '', keys: [] }); commit(ks); }} allow={allow} />
      )}
      <PromptBar view={view} stage={stage} a={promptA} onCommit={commit} thinking={thinking} coachKeys={look.coachKeys}
        opponent={seatNames.opponent} />
      {!mine && theirLines.length > 0 && playing && stage.k !== 'over' && (
        <p className="ticker" aria-live="polite">{theirLines.map((l) => <span key={l.seq}>{l.text}</span>)}</p>
      )}
    </>
  );

  const close = () => setMenuOpen(false);
  const menu = (
    <div className="gmenu">
      <button type="button" className="icon-btn gmenu__btn" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Game menu"
        onClick={() => setMenuOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      {menuOpen && (
        <>
          <div className="gmenu__scrim" onClick={close} />
          <div className="gmenu__panel" role="menu">
            <p className="gmenu__title">
              {board.me.deckName} <span className="muted">vs</span> {board.opponent.deckName}
              <small>{tutorial ? tutorial.subtitle : online ? `${seatNames.opponent} · ${online.mode} · ${board.teams ? '2v2' : '1v1 Duel'}` : `${hot ? 'Hot-seat' : seatNames.opponent} · ${board.teams ? '2v2 Duo' : '1v1 Duel'} · seed ${host.setup.seed}`}</small>
            </p>
            {!hot && !online && (
              <div className="gmenu__row">
                <span>Opponent speed</span>
                <Select label="Opponent speed" value={settings.pace} onChange={(v) => setSettings({ pace: v as PaceChoice })}
                  options={[{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]} />
              </div>
            )}
            <label className="gmenu__row gmenu__check">
              <span>Rule numbers in the log</span>
              <input type="checkbox" checked={settings.rules} onChange={() => setSettings({ rules: !settings.rules })} />
            </label>
            <button type="button" role="menuitem" onClick={() => { close(); setReport(true); }}>Report a rules problem</button>
            {tutorial && <div className="gmenu__tut">{tutorial.actions}</div>}
            {!tutorial && stage.k !== 'over' && (
              confirmConcede ? (
                <div className="gmenu__confirm">
                  <button type="button" className="btn btn--small btn--danger" onClick={() => { setConfirmConcede(false); close(); host.concede(viewer); }}>Concede now</button>
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirmConcede(false)}>Keep playing</button>
                </div>
              ) : <button type="button" role="menuitem" onClick={() => setConfirmConcede(true)}>Concede</button>
            )}
            {!tutorial && !online && <button type="button" role="menuitem" onClick={() => { close(); onNewGame(); }}>New game</button>}
            {!tutorial && (!online || stage.k === 'over') && <button type="button" role="menuitem" onClick={() => { close(); onChangeDecks(); }}>{online ? 'Back to the lobby' : 'Leave to the decks'}</button>}
            {!tutorial && (import.meta.env.DEV || settings.dev) && (
              <button type="button" role="menuitem" aria-pressed={settings.dev} onClick={() => setSettings({ dev: !settings.dev })}>DEV panel</button>
            )}
          </div>
        </>
      )}
    </div>
  );

  const rail = (
    <>
      <RailHead board={board} names={seatNames} menu={menu} />
      <Scores board={board} names={seatNames} />
      <Preview slot={hover} cards={cards} />
      <ChainBox board={board} cards={cards} />
      <GameLog lines={log} rules={settings.rules} />
      {online && stage.k !== 'over' && <DecisionClock clock={online.clock} />}
      <div className="rail__dock">{promptArea}</div>
    </>
  );

  return (
    <section className="play">
      {error && <p className="play__error" role="alert">{error}</p>}
      <div className="play__stage" ref={stageRef}>
        <TableLookContext.Provider value={look}>
          <Board board={board} cards={cards} onZoom={setZoom} acts={acts} kind={next?.decision?.kind ?? view.pending?.kind}
            names={seatNames} rail={rail} />
        </TableLookContext.Provider>
        {stage.k === 'order' && handoff === null && (
          <OrderChoice view={view} board={board} cards={cards} onCommit={commit} onZoom={setZoom} />
        )}
        {stage.k === 'mulligan' && handoff === null && (!tutorial || mine) && (
          <Mulligan key={view.pending?.batch ?? 'waiting'} view={view} board={board} summary={summary} cards={cards}
            preview={preview} onCommit={commit} />
        )}
        {!tutorial && (stage.k === 'ready' || (playing && view.turn.n === 1)) && !atTable && stage.k !== 'over' && handoff === null && (
          <SetupDone board={board} summary={summary} onClose={() => setAtTable(true)} />
        )}
        {stage.k === 'over' && !dismissed && !tutorial && (
          <GameOver
            tone={hot ? 'neutral' : stage.result.winner === null ? 'draw' : won(stage.result.winner) ? 'win' : 'loss'}
            title={hot ? hotResult(stage.result.winner, names) : stage.result.winner === null ? 'Draw' : won(stage.result.winner) ? 'Victory' : 'Defeat'}
            detail={`${resultHow(stage.result, hot ? null : view.me)} [${stage.result.rule}]`}
            eyebrow={`${online ? `${online.mode} · ` : ''}Turn ${view.turn.n}`}
            names={[seatNames.me, seatNames.opponent]} points={[board.me.points, board.opponent.points]}
            legends={[board.me.legend[0], board.opponent.legend[0]]} cards={cards}
            buttons={<>
              {online ? <button type="button" className="btn btn--primary" autoFocus onClick={onChangeDecks}>Back to the lobby</button>
                : <button type="button" className="btn btn--primary" autoFocus onClick={onNewGame}>Rematch</button>}
              <button type="button" className="btn" onClick={() => setDismissed(true)}>Look at the table</button>
              {!online && <button type="button" className="btn btn--ghost" onClick={onChangeDecks}>Change decks</button>}
              <button type="button" className="btn btn--ghost" onClick={() => setReport(true)}>Report a rules problem</button>
            </>}>
            {online?.outcome}
          </GameOver>
        )}
        {handoff !== null && <HandoffCover name={names[handoff]} onTake={() => host.takeOver()} />}
        {report && <ReportDialog record={() => host.record()} view={view} log={log} onClose={() => setReport(false)} />}
        {step && handoff === null && stage.k !== 'order' && stage.k !== 'mulligan' && (
          <CoachPopup step={step} stage={stageRef} onNext={() => coach?.onNext?.(step)} />
        )}
      </div>
      {settings.dev && (
        <DevPanel host={host} snap={snap} cards={cards} onClose={() => setSettings({ dev: false })}
          onLoad={(r) => onLoadRecord?.(r)} />
      )}
      {zoom && <CardZoom slot={zoom} where={whereText(view, zoom.id)} cards={cards} db={db} onClose={closeZoom} />}
    </section>
  );
}

function hotResult(winner: number | null, names: string[]): string {
  return winner === null ? 'Draw' : `${names[winner]} wins`;
}
