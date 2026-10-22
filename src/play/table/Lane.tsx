import type { CardSlot, LaneModel } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { actOn, laneButtons, type Acts } from './acts.ts';
import { TableCard } from './TableCard.tsx';
import { useTableLook } from './tableContext.ts';

/*
 * One battlefield and what is at it (§12.2): the opponent's units above,
 * the battlefield card (landscape) with its controller, the Facedown Zone,
 * your units below. A battlefield starts uncontrolled [113], [190.2.b].
 */

function Units({ slots, cards, onZoom, empty, acts }: {
  slots: CardSlot[]; cards: CardIndex; onZoom: (s: CardSlot) => void; empty: string; acts?: Acts;
}) {
  return (
    <div className="lane__units">
      {slots.length === 0 ? <span className="lane__empty">{empty}</span>
        : slots.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="s" onTap={onZoom} onAct={actOn(acts, c)} />)}
    </div>
  );
}

export function Lane({ lane, me, cards, onZoom, acts, kind }: {
  lane: LaneModel; me: number; cards: CardIndex; onZoom: (s: CardSlot) => void; acts?: Acts; kind?: string;
}) {
  const look = useTableLook();
  const buttons = laneButtons(acts, lane.bf, kind);
  const flash = look.fx.lanes[lane.bf];
  const control = lane.controller === null ? 'Uncontrolled' : lane.controller === me ? 'You control it' : 'Opponent controls it';
  const ring = lane.controller === null ? 'none' : lane.controller === me ? 'me' : 'opp';
  return (
    <section className={`lane${flash ? ` lane--fx-${flash}` : ''}${look.coachLanes.has(lane.bf) ? ' is-coached' : ''}`}
      aria-label={`Battlefield ${lane.bf + 1}`} data-active={lane.showdown || lane.combat} data-lane={lane.bf}
      data-contested={lane.contested !== null || undefined}>
      <Units slots={lane.theirs} cards={cards} onZoom={onZoom} empty="No opposing units" acts={acts} />
      <div className="lane__bf" data-control={ring}>
        <TableCard slot={lane.card} cards={cards} size="xl" landscape onTap={onZoom} onAct={actOn(acts, lane.card)} />
        <p className="lane__caption">
          <span>{lane.owner === me ? 'Your battlefield' : "Opponent's battlefield"}</span>
          <span className="muted">{control}</span>
          {lane.combat ? <span className="lane__tag">Combat</span> : lane.showdown ? <span className="lane__tag">Showdown</span> : null}
        </p>
        {buttons.map((b) => (
          <button key={b.key} type="button" data-key={b.key}
            className={`btn btn--small btn--primary lane__choose${look.coachKeys.has(b.key) ? ' is-coached' : ''}`}
            onClick={() => acts!.send(b.key)}>
            {b.label}
          </button>
        ))}
      </div>
      {lane.facedown.length > 0 && (
        <div className="lane__facedown">
          {lane.facedown.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="xs" onTap={onZoom} />)}
        </div>
      )}
      <Units slots={lane.mine} cards={cards} onZoom={onZoom} empty="No units of yours" acts={acts} />
    </section>
  );
}
