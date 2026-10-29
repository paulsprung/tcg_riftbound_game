import type { CSSProperties, ReactNode } from 'react';
import type { BoardModel, CardSlot, LaneModel, SideModel } from '../model/board.ts';
import type { CardIndex } from '../model/cards.ts';
import { OpenPile, Pile } from './Pile.tsx';
import { actOn, laneButtons, type Acts } from './acts.ts';
import { TableCard, type CardSize } from './TableCard.tsx';
import { useTableLook } from './tableContext.ts';

/*
 * The table (§12.2), laid out like a real one and sized to the window: the
 * opponent's strip on top (legend, hand, runes), their base, the
 * battlefields in the middle with the opposing units above and yours below,
 * your base, and your strip with your hand at the bottom. Nothing scrolls:
 * every card is sized from the height of the window (`--cu`), and a row
 * with more cards than it has room for lets them overlap (`Fan`).
 */

interface Common {
  cards: CardIndex;
  onZoom: (s: CardSlot) => void;
  acts?: Acts;
  kind?: string;
}

/** A row of cards that overlaps itself when it is too full for its width. */
function Fan({ children, n, className = '', label }: { children: ReactNode; n: number; className?: string; label?: string }) {
  return <div className={`bd-fan ${className}`} style={{ '--n': Math.max(1, n) } as CSSProperties} aria-label={label}>{children}</div>;
}

function poolText(side: SideModel): string {
  const p = side.pool;
  const power = Object.entries(p.power).filter(([, n]) => n > 0).map(([d, n]) => `${n} ${d}`);
  return [p.energy > 0 ? `${p.energy} Energy` : '', ...power, p.universal > 0 ? `${p.universal} any` : ''].filter(Boolean).join(' · ');
}

function Zones({ side, cards, onZoom, acts, name }: Common & { side: SideModel; name?: string }) {
  const champ = side.champion;
  return (
    <div className="bd-zones">
      <div className="bd-plate">
        <strong>{name ?? (side.me ? 'You' : 'Opponent')}</strong>
        <span>{side.deckName}</span>
        {side.first !== null && <em>{side.first ? '1st' : '2nd'}</em>}
      </div>
      <div className="bd-zones__cards">
        {side.legend.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="m" onTap={onZoom} />)}
        {champ ? (
          <TableCard slot={champ} cards={cards} size="m" onTap={onZoom} onAct={actOn(acts, champ)}
            label={actOn(acts, champ) ? 'play it' : acts?.why?.[champ.id]} />
        ) : <div className="tcard tcard--m is-empty" />}
        <div className="bd-piles">
          <Pile label="Main Deck" count={side.deck} size="xs" />
          <OpenPile label="Trash" slots={side.trash} cards={cards} onTap={onZoom} size="xs" />
          {side.banish.length > 0 && <OpenPile label="Banished" slots={side.banish} cards={cards} onTap={onZoom} size="xs" />}
        </div>
      </div>
    </div>
  );
}

function Runes({ side, cards, onZoom, acts }: Common & { side: SideModel }) {
  const pool = poolText(side);
  return (
    <div className="bd-runes">
      <div className="bd-runes__top">
        {pool && <span className="bd-pool" title="Energy and Power waiting in your pool">{pool}</span>}
        <Pile label="Rune Deck" count={side.runeDeck} rune size="xs" />
      </div>
      <Fan n={side.runes.length} className="bd-runes__row" label={side.me ? 'Your runes' : "Opponent's runes"}>
        {side.runes.map((c) => (
          <TableCard key={c.id} slot={c} cards={cards} size="xs" onTap={onZoom} onAct={actOn(acts, c)}
            picked={acts?.pay?.picked.has(c.id)} />
        ))}
      </Fan>
    </div>
  );
}

function Hand({ side, cards, onZoom, acts }: Common & { side: SideModel }) {
  return (
    <Fan n={side.hand.length} className={`bd-hand${side.me ? ' bd-hand--mine' : ''}`} label={side.me ? 'Your hand' : "Opponent's hand"}>
      {side.hand.map((c) => (
        <TableCard key={c.id} slot={c} cards={cards} size={side.me ? 'l' : 's'} tilt={false}
          onTap={c.def !== null ? onZoom : undefined} onAct={actOn(acts, c)}
          label={actOn(acts, c) ? 'play it' : acts?.why?.[c.id]} />
      ))}
    </Fan>
  );
}

function Strip(p: Common & { side: SideModel; name?: string }) {
  return (
    <section className={`bd-strip bd-strip--${p.side.me ? 'me' : 'opp'}`} aria-label={p.side.me ? 'Your side' : "Opponent's side"}>
      <Zones {...p} />
      <Hand {...p} />
      <Runes {...p} />
    </section>
  );
}

function BaseRow({ side, cards, onZoom, acts, kind }: Common & { side: SideModel }) {
  const look = useTableLook();
  const buttons = side.me ? laneButtons(acts, 'base', kind) : [];
  return (
    <section className={`bd-base${buttons.length > 0 ? ' is-choice' : ''}${side.me && look.coachLanes.has('base') ? ' is-coached' : ''}`}
      data-lane={side.me ? 'base' : undefined} aria-label={side.me ? 'Your base' : "Opponent's base"}>
      <span className="bd-base__label">Base</span>
      <Fan n={side.base.length} className="bd-base__units">
        {side.base.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="s" onTap={onZoom} onAct={actOn(acts, c)} />)}
      </Fan>
      {buttons.map((b) => (
        <button key={b.key} type="button" data-key={b.key}
          className={`btn btn--small btn--primary bd-choose${look.coachKeys.has(b.key) ? ' is-coached' : ''}`}
          onClick={() => acts!.send(b.key)}>
          {b.label === 'Move here' ? 'Move to base' : b.label === 'Play here' ? 'Play to base' : b.label}
        </button>
      ))}
    </section>
  );
}

function Units({ slots, cards, onZoom, acts, className }: Common & { slots: CardSlot[]; className: string }) {
  return (
    <Fan n={slots.length} className={className}>
      {slots.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="s" onTap={onZoom} onAct={actOn(acts, c)} />)}
    </Fan>
  );
}

function Lane({ lane, me, cards, onZoom, acts, kind }: Common & { lane: LaneModel; me: number }) {
  const look = useTableLook();
  const buttons = laneButtons(acts, lane.bf, kind);
  const flash = look.fx.lanes[lane.bf];
  const ring = lane.controller === null ? 'none' : lane.controller === me ? 'me' : 'opp';
  return (
    <section className={`bd-lane${flash ? ` lane--fx-${flash}` : ''}${look.coachLanes.has(lane.bf) ? ' is-coached' : ''}${buttons.length > 0 ? ' is-choice' : ''}`}
      aria-label={`Battlefield ${lane.bf + 1}`} data-active={lane.showdown || lane.combat} data-lane={lane.bf}
      data-contested={lane.contested !== null || undefined}>
      <i className="bd-lane__c bd-lane__c--tl" /><i className="bd-lane__c bd-lane__c--tr" />
      <i className="bd-lane__c bd-lane__c--bl" /><i className="bd-lane__c bd-lane__c--br" />
      <Units slots={lane.theirs} cards={cards} onZoom={onZoom} acts={acts} className="bd-lane__theirs" />
      <div className="bd-lane__bf" data-control={ring}>
        <TableCard slot={lane.card} cards={cards} size="xl" landscape onTap={onZoom} onAct={actOn(acts, lane.card)} />
        {lane.facedown.length > 0 && (
          <div className="bd-lane__facedown">
            {lane.facedown.map((c) => <TableCard key={c.id} slot={c} cards={cards} size="xs" onTap={onZoom} />)}
          </div>
        )}
        {lane.combat ? <span className="bd-lane__tag">Combat</span> : lane.showdown ? <span className="bd-lane__tag">Showdown</span> : null}
      </div>
      <Units slots={lane.mine} cards={cards} onZoom={onZoom} acts={acts} className="bd-lane__mine" />
      {buttons.length > 0 && (
        <div className="bd-lane__choose">
          {buttons.map((b) => (
            <button key={b.key} type="button" data-key={b.key}
              className={`btn btn--small btn--primary${look.coachKeys.has(b.key) ? ' is-coached' : ''}`}
              onClick={() => acts!.send(b.key)}>{b.label}</button>
          ))}
        </div>
      )}
    </section>
  );
}

export function Board({ board, cards, onZoom, acts, kind, names, rail }: {
  board: BoardModel; cards: CardIndex; onZoom: (s: CardSlot) => void; acts?: Acts; kind?: string;
  names?: { me: string; opponent: string }; rail: ReactNode;
}) {
  const c = { cards, onZoom, acts, kind };
  return (
    <div className="board">
      <div className="board__main">
        <Strip side={board.opponent} name={names?.opponent} {...c} />
        <BaseRow side={board.opponent} {...c} />
        <div className="bd-lanes" style={{ gridTemplateColumns: `repeat(${board.lanes.length}, minmax(0, 1fr))` }}>
          {board.lanes.map((l) => <Lane key={l.bf} lane={l} me={board.me.p} {...c} />)}
        </div>
        <BaseRow side={board.me} {...c} />
        <Strip side={board.me} name={names?.me} {...c} />
      </div>
      <aside className="board__rail" aria-label="Game panel">{rail}</aside>
    </div>
  );
}

export type { CardSize };
