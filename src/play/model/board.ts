import {
  findCard, TOKENS, type DefId, type GameObject, type ObjId, type Phase, type PlayerId, type PlayerView, type RunePool,
  type Step, type Stub, type TokenId,
} from '../../game/index.ts';

/*
 * The table as the UI draws it, read from one player's view (§12.2). The
 * viewer's side is always at the bottom; lanes come from view.bfs, so a
 * third battlefield adds a third lane. Everything here is a plain value
 * read off the view, nothing recomputed by rules: the same view always
 * gives the same board, which lets components memoize on it.
 */

/** One card on the table: a known object, or a card back. */
export interface CardSlot {
  /** The ObjId, or the viewer's alias (< 0) for a card they don't know. */
  id: ObjId;
  /** What it is; null when the viewer doesn't know [108.7.c], [108.4.e]. */
  def: DefId | null;
  /** The printing for its art (cards.json Card.id), when the deck named one. */
  printing: string | null;
  owner: PlayerId;
  exhausted: boolean;
  /** Hidden runes show the rune-deck back [129.2]. */
  rune: boolean;
  /** Damage marked [142]; 0 off the board. */
  damage: number;
  /** A unit's printed Might (abilities are off in M1.1); null for others. */
  might: number | null;
  /** In a combat [466.2.c.3]. */
  designation: 'attacker' | 'defender' | null;
}

export interface SideModel {
  p: PlayerId;
  me: boolean;
  deckName: string;
  /** [0] is the Champion Legend [107.4.d]. */
  legend: CardSlot[];
  champion: CardSlot | null;
  hand: CardSlot[];
  /** Permanents in base, runes apart: the rune row (§12.2). */
  base: CardSlot[];
  runes: CardSlot[];
  deck: number;
  runeDeck: number;
  trash: CardSlot[];
  banish: CardSlot[];
  points: number;
  xp: number;
  /** Energy and Power waiting in the Rune Pool [165]. */
  pool: RunePool;
  /** Plays first; null until the turn order is fixed [115]. */
  first: boolean | null;
}

export interface LaneModel {
  bf: number;
  /** The battlefield itself [199.1]. */
  card: CardSlot;
  /** Whose deck provided it [170.1]. */
  owner: PlayerId;
  controller: PlayerId | null;
  contested: PlayerId | null;
  /** Permanents here, split by controller: theirs on top, yours below. */
  mine: CardSlot[];
  theirs: CardSlot[];
  facedown: CardSlot[];
  /** A showdown or a combat is on here. */
  showdown: boolean;
  combat: boolean;
}

export interface BoardModel {
  me: SideModel;
  opponent: SideModel;
  lanes: LaneModel[];
  /** 0 during setup [118]. */
  turn: number;
  phase: Phase;
  step: Step;
  /** Who holds Priority and Focus [312], [313]. */
  priority: PlayerId | null;
  focus: PlayerId | null;
  /** Null before the first turn. */
  turnPlayer: PlayerId | null;
  victoryScore: number;
  chain: number;
}

const isKnown = (o: GameObject | Stub): o is GameObject => 'def' in o;

/** Reads the slot of one id in the view. */
export function slotOf(v: PlayerView, id: ObjId, isRune: (def: DefId) => boolean, runeZone = false): CardSlot {
  const o = v.objects[id];
  if (!o) throw new Error(`the view names ${id} but holds no such object`);
  if (!isKnown(o)) {
    return { id, def: null, printing: null, owner: o.owner, exhausted: false, rune: runeZone, damage: 0, might: null,
      designation: null };
  }
  const token = Object.hasOwn(TOKENS, o.def) ? TOKENS[o.def as TokenId] : undefined;
  const c = findCard(o.def);
  const unit = token ? token.type === 'unit' : c?.types.includes('unit') ?? false;
  return {
    id, def: o.def, printing: o.printing, owner: o.owner, exhausted: o.exhausted, rune: isRune(o.def),
    damage: o.damage.reduce((n, d) => n + d.amount, 0), might: unit ? (token?.might ?? c?.might ?? 0) + o.buffs : null,
    designation: o.designation,
  };
}

function sideOf(v: PlayerView, p: PlayerId, isRune: (def: DefId) => boolean): SideModel {
  const pl = v.players[p];
  const slot = (id: ObjId) => slotOf(v, id, isRune);
  const base = pl.base.map(slot);
  const ordered = v.turn.queue.length > 0;
  return {
    p, me: p === v.me, deckName: pl.deckName,
    legend: pl.legend.map(slot),
    champion: pl.champion === null ? null : slot(pl.champion),
    hand: pl.hand.map(slot),
    base: base.filter((c) => !c.rune), runes: base.filter((c) => c.rune),
    deck: pl.deck.length, runeDeck: pl.runeDeck.length,
    trash: pl.trash.map(slot), banish: pl.banish.map(slot),
    points: pl.points, xp: pl.xp, pool: pl.pool,
    first: ordered ? v.turn.firstPlayer === p : null,
  };
}

/** The board of a view. `isRune` tells runes from other permanents in
    base; the view itself holds only DefIds. */
export function boardOf(v: PlayerView, isRune: (def: DefId) => boolean = () => false): BoardModel {
  const opp = v.players.find((pl) => pl.id !== v.me)!.id;
  const lanes = v.bfs.map((b, bf): LaneModel => {
    const here = b.here.map((id) => slotOf(v, id, isRune));
    const controllerOf = (c: CardSlot) => v.objects[c.id].controller;
    const card = slotOf(v, b.obj, isRune);
    return {
      bf, card, owner: card.owner, controller: b.controller, contested: b.contested,
      mine: here.filter((c) => controllerOf(c) === v.me),
      theirs: here.filter((c) => controllerOf(c) !== v.me),
      facedown: b.facedown.map((id) => slotOf(v, id, isRune)),
      showdown: v.showdown?.bf === bf, combat: v.combat?.bf === bf,
    };
  });
  return {
    me: sideOf(v, v.me, isRune),
    opponent: sideOf(v, opp, isRune),
    lanes,
    turn: v.turn.n,
    phase: v.turn.phase,
    step: v.turn.step,
    priority: v.turn.priority,
    focus: v.turn.focus,
    turnPlayer: v.turn.n > 0 ? v.turn.player : null,
    victoryScore: v.mode.victoryScore,
    chain: v.chain.length,
  };
}
