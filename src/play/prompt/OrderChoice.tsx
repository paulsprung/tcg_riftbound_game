import { useEffect, useMemo, useState } from 'react';
import type { PlayerView } from '../../game/index.ts';
import { affordances } from '../model/affordances.ts';
import type { BoardModel, CardSlot } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { waitingText } from '../model/describe.ts';
import { TableCard } from '../table/TableCard.tsx';
import { Buttons, SetupSheet } from './SetupSheet.tsx';

/*
 * Choosing the turn order (§12.1 step 2, TR 407): both battlefields picked
 * at random are shown face up [487.5], and the randomly designated player,
 * who has seen them (TR 406.1.h), chooses to play first or second.
 *
 * The random designation is shown as a roll of the dice: everyone rolls a
 * d20 and the highest roll chooses. The engine has already drawn who that
 * is; the dice show it (their numbers follow from the table, the same on
 * every screen, the chooser's always the highest).
 */

const ROLL_MS = 1300;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Each seat's roll: the chooser's the highest, nobody tied with it. */
function rollsFor(seats: number, chooser: number, seed: string): number[] {
  const top = 12 + (hash(`${seed}:top`) % 9);
  return Array.from({ length: seats }, (_, p) => (p === chooser ? top : 1 + (hash(`${seed}:${p}`) % (top - 1))));
}

function Dice({ names, me, chooser, seed, onDone }: { names: string[]; me: number; chooser: number; seed: string; onDone: () => void }) {
  const rolls = useMemo(() => rollsFor(names.length, chooser, seed), [names.length, chooser, seed]);
  const [shown, setShown] = useState(() => rolls.map(() => 1));
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      if (t - t0 >= ROLL_MS) { setShown(rolls); setDone(true); onDone(); return; }
      setShown(rolls.map((_, i) => 1 + ((Math.floor(t / 70) * 7 + i * 13) % 20)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rolls, onDone]);
  return (
    <div className={`dice-roll${done ? ' is-done' : ''}`} aria-live="polite">
      {names.map((n, p) => (
        <figure key={p} className={`dice${done && p === chooser ? ' is-high' : ''}`}>
          <span className="dice__face" aria-label={done ? `${n} rolled ${rolls[p]}` : `${n} is rolling`}>{shown[p]}</span>
          <figcaption>{p === me ? 'You' : n}</figcaption>
        </figure>
      ))}
      <p className="dice-roll__result">{done ? (chooser === me ? 'You rolled highest: you choose.' : `${names[chooser]} rolled highest and chooses.`) : 'Rolling for the turn order…'}</p>
    </div>
  );
}

export function OrderChoice({ view, board, cards, names, onCommit, onZoom }: {
  view: PlayerView; board: BoardModel; cards: CardIndex; names: string[]; onCommit: (keys: string[]) => void;
  onZoom: (s: CardSlot) => void;
}) {
  const d = view.pending?.kind === 'playOrder' ? view.pending : null;
  const a = d ? affordances(view, d) : null;
  const chooser = d ? d.player : view.opponentDecision?.kind === 'playOrder' ? view.opponentDecision.player : null;
  const [rolled, setRolled] = useState(false);
  const onRolled = useMemo(() => () => setRolled(true), []);
  const seed = board.lanes.map((l) => l.bf).join('|');
  return (
    <SetupSheet step="Setup · turn order" title={!rolled ? 'Roll for the turn order' : d ? 'Play first or second?' : 'Who plays first?'}>
      {chooser !== null && <Dice names={view.players.map((_, p) => names[p] ?? `Player ${p + 1}`)} me={view.me} chooser={chooser} seed={seed} onDone={onRolled} />}
      <div className="sheet__bfs">
        {board.lanes.map((l) => (
          <figure key={l.bf} className="sheet__bf">
            <TableCard slot={l.card} cards={cards} size="xl" landscape onTap={onZoom} />
            <figcaption className="muted small">{l.owner === board.me.p ? 'Your battlefield' : "Opponent's battlefield"}</figcaption>
          </figure>
        ))}
      </div>
      {!rolled && chooser !== null ? null : a ? (
        <>
          <p>{a.prompt} <span className="muted small">(TR 407)</span></p>
          <Buttons buttons={a.buttons} onCommit={onCommit} />
        </>
      ) : (
        <p className="sheet__waiting">{view.opponentDecision ? waitingText(view.opponentDecision) : ''}</p>
      )}
    </SetupSheet>
  );
}
