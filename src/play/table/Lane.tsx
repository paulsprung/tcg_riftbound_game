import type { CardSlot, LaneModel } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { TableCard } from './TableCard.tsx';

/*
 * One battlefield and what is at it (§12.2): the opponent's units above,
 * the battlefield card (landscape) with its controller, the Facedown Zone,
 * your units below. A battlefield starts uncontrolled [113], [190.2.b].
 */

function Units({ slots, cards, onZoom, empty }: {
  slots: CardSlot[]; cards: CardIndex; onZoom: (s: CardSlot) => void; empty: string;
}) {
  return (
    <div className="lane__units">
      {slots.length === 0 ? <span className="lane__empty">{empty}</span>
        : slots.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="s" onTap={onZoom} />)}
    </div>
  );
}

export function Lane({ lane, me, cards, onZoom }: {
  lane: LaneModel; me: number; cards: CardIndex; onZoom: (s: CardSlot) => void;
}) {
  const control = lane.controller === null ? 'Uncontrolled' : lane.controller === me ? 'You control it' : 'Opponent controls it';
  const ring = lane.controller === null ? 'none' : lane.controller === me ? 'me' : 'opp';
  return (
    <section className="lane" aria-label={`Battlefield ${lane.bf + 1}`}>
      <Units slots={lane.theirs} cards={cards} onZoom={onZoom} empty="No opposing units" />
      <div className="lane__bf" data-control={ring}>
        <TableCard slot={lane.card} cards={cards} size="xl" landscape onTap={onZoom} />
        <p className="lane__caption">
          <span>{lane.owner === me ? 'Your battlefield' : "Opponent's battlefield"}</span>
          <span className="muted">{control}</span>
        </p>
      </div>
      {lane.facedown.length > 0 && (
        <div className="lane__facedown">
          {lane.facedown.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="xs" onTap={onZoom} />)}
        </div>
      )}
      <Units slots={lane.mine} cards={cards} onZoom={onZoom} empty="No units of yours" />
    </section>
  );
}
