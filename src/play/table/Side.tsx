import type { ReactNode } from 'react';
import type { CardSlot, SideModel } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { OpenPile, Pile } from './Pile.tsx';
import { actOn, laneButtons, type Acts } from './acts.ts';
import { TableCard } from './TableCard.tsx';

/*
 * One player's side of the table (§12.2): the strip with the Legend Zone,
 * the Champion Zone, the hand and the piles, and the row with the base and
 * the runes. The opponent's strip is on top, above their base; yours is at
 * the bottom, below your base. Their hand shows card backs only [108.7.c].
 */

interface SideProps {
  side: SideModel;
  cards: CardIndex;
  onZoom: (s: CardSlot) => void;
  acts?: Acts;
  kind?: string;
}

function Zone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="zone">
      <div className="zone__cards">{children}</div>
      <span className="zone__label">{label}</span>
    </div>
  );
}

function poolText(side: SideModel): string {
  const p = side.pool;
  const power = Object.entries(p.power).filter(([, n]) => n > 0).map(([d, n]) => `${n} ${d}`);
  const parts = [p.energy > 0 ? `${p.energy} Energy` : '', ...power, p.universal > 0 ? `${p.universal} any` : '']
    .filter(Boolean);
  return parts.length > 0 ? `Pool: ${parts.join(', ')}` : '';
}

function Strip({ side, cards, onZoom, acts }: SideProps) {
  return (
    <div className="side__strip">
      <div className="side__who">
        <strong>{side.me ? 'You' : 'Opponent'}</strong>
        <span className="muted small">{side.deckName}</span>
        {side.first !== null && <span className="chip side__order">{side.first ? 'Plays first' : 'Plays second'}</span>}
        <span className="pool-chip">{poolText(side)}</span>
      </div>
      <Zone label="Legend">
        {side.legend.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="m" onTap={onZoom} />)}
      </Zone>
      <Zone label="Champion">
        {side.champion ? <TableCard slot={side.champion} cards={cards} size="m" onTap={onZoom} onAct={actOn(acts, side.champion)}
          label={actOn(acts, side.champion) ? 'play it' : acts?.why?.[side.champion.id]} />
          : <div className="tcard tcard--m is-empty" />}
      </Zone>
      <div className={`hand${side.me ? ' hand--mine' : ''}`} aria-label={side.me ? 'Your hand' : "Opponent's hand"}>
        {side.hand.map((c) => (
          <TableCard key={c.id} slot={c} cards={cards} size={side.me ? 'l' : 's'} tilt={side.me}
            onTap={c.def !== null ? onZoom : undefined} onAct={actOn(acts, c)}
            label={actOn(acts, c) ? 'play it' : acts?.why?.[c.id]} />
        ))}
        <span className="zone__label">Hand · {side.hand.length}</span>
      </div>
      <div className="side__piles">
        <Pile label="Main Deck" count={side.deck} />
        <Pile label="Rune Deck" count={side.runeDeck} rune />
        <OpenPile label="Trash" slots={side.trash} cards={cards} onTap={onZoom} />
        {side.banish.length > 0 && <OpenPile label="Banished" slots={side.banish} cards={cards} onTap={onZoom} />}
      </div>
    </div>
  );
}

function Row({ label, slots, empty, cards, onZoom, acts, choose }: {
  label: string; slots: CardSlot[]; empty: string; cards: CardIndex; onZoom: (s: CardSlot) => void; acts?: Acts;
  choose?: { key: string; label: string }[];
}) {
  return (
    <div className={`side__row${choose && choose.length > 0 ? ' side__row--choose' : ''}`}>
      <span className="side__row-label">{label}</span>
      <div className="side__row-cards">
        {slots.length === 0 ? <span className="muted small">{empty}</span>
          : slots.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="s" onTap={onZoom} onAct={actOn(acts, c)} />)}
        {choose?.map((b) => (
          <button key={b.key} type="button" className="btn btn--small btn--primary side__choose" onClick={() => acts!.send(b.key)}>
            {b.label === 'Move here' ? 'Move to base' : b.label === 'Play here' ? 'Play to base' : b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Side(p: SideProps) {
  const base = (
    <div className="side__base" key="base">
      <Row label="Base" slots={p.side.base} empty="No units or gear" cards={p.cards} onZoom={p.onZoom} acts={p.acts}
        choose={p.side.me ? laneButtons(p.acts, 'base', p.kind) : undefined} />
      <Row label="Runes" slots={p.side.runes} empty="No runes channeled" cards={p.cards} onZoom={p.onZoom} acts={p.acts} />
    </div>
  );
  const strip = <Strip key="strip" {...p} />;
  return (
    <section className={`side side--${p.side.me ? 'me' : 'opp'}`} aria-label={p.side.me ? 'Your side' : "Opponent's side"}>
      {p.side.me ? [base, strip] : [strip, base]}
    </section>
  );
}
