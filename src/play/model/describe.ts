import type {
  DecisionStub, DefId, GameResult, ObjId, ObservedEvent, PlayerId, PlayerView,
} from '../../game/index.ts';
import type { SetupSummary } from './stage.ts';

/*
 * The game log in words (§12.7): one line per thing that happened, from
 * the events as the viewer observed them, with the rule each implements
 * (P12). A line never names a card the viewer didn't see: the names come
 * from the events' own `def` fields, which observe() left only where the
 * viewer may see them.
 *
 * M0 covers the events of setup; every later event kind gets its line
 * with the procedure that emits it.
 */

export interface LogLine {
  /** The event's sequence number: a stable React key. */
  seq: number;
  text: string;
  rule: string;
  who: 'me' | 'opponent' | 'game';
}

export interface DescribeCtx {
  me: PlayerId;
  /** A card's name. */
  nameOf: (def: DefId) => string;
  /** An object as the viewer's current view knows it, for events that
      name objects without their definition (battlefields). */
  objOf: (id: ObjId) => { def: DefId | null; owner: PlayerId } | null;
}

/** "A", "A and B", "A, B and C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
const ZONE_NAME = { deck: 'Main Deck', runeDeck: 'Rune Deck' } as const;

function resultText(r: GameResult, me: PlayerId): string {
  const who = r.winner === null ? 'Nobody wins' : r.winner === me ? 'You win' : 'The opponent wins';
  const how: Record<GameResult['reason'], string> = {
    score: 'by points', burnout: 'by burn out', concede: 'by concession', effect: 'by a card effect',
    loop: 'because the game could not go on',
  };
  return `${who} ${how[r.reason]}.`;
}

/** The log of a sequence of observed events, oldest first. */
export function describeAll(events: readonly ObservedEvent[], c: DescribeCtx): LogLine[] {
  // The cards a draw or recycle moved: its 'zone' events, by group and by
  // the player whose zone they went to (both opening hands are one group).
  const moved: Record<string, (DefId | undefined)[]> = {};
  for (const e of events) {
    if (e.k === 'zone' && 'p' in e.to) (moved[`${e.group}:${e.to.p}`] ??= []).push(e.def);
  }

  const out: LogLine[] = [];
  const who = (p: PlayerId) => (p === c.me ? 'me' : 'opponent');
  const add = (e: ObservedEvent, text: string, w: LogLine['who']) => out.push({ seq: e.seq, text, rule: e.rule, who: w });
  const named = (group: number, p: PlayerId): string[] | null => {
    const defs = moved[`${group}:${p}`] ?? [];
    return defs.length > 0 && defs.every((d) => d !== undefined) ? defs.map((d) => c.nameOf(d!)) : null;
  };

  for (const e of events) {
    switch (e.k) {
      case 'gameStart': add(e, 'The game begins.', 'game'); break;
      case 'battlefieldsChosen': {
        const parts = e.bfs.map((id) => {
          const o = c.objOf(id);
          const name = o?.def ? c.nameOf(o.def) : 'a battlefield';
          return o ? `${name} (${o.owner === c.me ? 'yours' : "the opponent's"})` : name;
        });
        add(e, `Battlefields this game: ${listOf(parts)}.`, 'game');
        break;
      }
      case 'shuffle': {
        const last = out[out.length - 1];
        const mine = e.p === c.me;
        const text = mine ? `You shuffle your ${ZONE_NAME[e.zone]} (${cards(e.count)}).`
          : `The opponent shuffles their ${ZONE_NAME[e.zone]} (${cards(e.count)}).`;
        if (last && last.rule === e.rule && last.who === who(e.p) && last.text.includes('shuffle')) {
          last.text = `${last.text.replace(/\.$/, '')} and ${ZONE_NAME[e.zone]} (${cards(e.count)}).`;
        } else add(e, text, who(e.p));
        break;
      }
      case 'playOrder': add(e, e.first === c.me ? 'You play first.' : 'The opponent plays first.', 'game'); break;
      case 'draw': {
        const names = e.p === c.me ? named(e.group, e.p) : null;
        if (e.p === c.me) add(e, names ? `You draw ${listOf(names)}.` : `You draw ${cards(e.objs.length)}.`, 'me');
        else add(e, `The opponent draws ${cards(e.objs.length)}.`, 'opponent');
        break;
      }
      case 'mulligan':
        if (e.n === 0) add(e, e.p === c.me ? 'You keep your hand.' : 'The opponent keeps their hand.', who(e.p));
        else add(e, e.p === c.me ? `You set aside ${cards(e.n)}.` : `The opponent sets aside ${cards(e.n)}.`, who(e.p));
        break;
      case 'recycle': {
        const n = e.objs.length;
        const order = n > 1 ? ' in random order' : '';
        const names = e.p === c.me ? named(e.group, e.p) : null;
        if (e.p === c.me) {
          const what = names ? listOf(names) : cards(n);
          add(e, `You put ${what} on the bottom of your Main Deck${order}.`, 'me');
        } else add(e, `The opponent puts ${cards(n)} on the bottom of their Main Deck${order}.`, 'opponent');
        break;
      }
      case 'gameOver': if (e.result) add(e, resultText(e.result, c.me), 'game'); break;
      default: break;                 // zone moves are told by their summaries; decisions by the prompt
    }
  }
  return out;
}

/** What the other player is doing, from the stub of their decision: only
    its kind and context, never its options (§12.5). */
export function waitingText(stub: DecisionStub): string {
  switch (stub.kind) {
    case 'playOrder': return 'The opponent was picked at random to choose who plays first…';
    case 'mulligan': return 'The opponent is choosing cards to set aside…';
    default: return 'The opponent is deciding…';
  }
}

const ZONE_LABEL: Record<string, string> = {
  base: 'base', legend: 'Legend Zone', champion: 'Champion Zone', hand: 'hand', deck: 'Main Deck',
  runeDeck: 'Rune Deck', trash: 'trash', banish: 'banishment',
};

/** Where an object is, in words, for the card zoom: "Your hand",
    "Opponent's Champion Zone", "At a battlefield". */
export function whereText(v: PlayerView, id: ObjId): string {
  const o = v.objects[id];
  if (!o) return '';
  const z = o.zone;
  if ('p' in z) return `${z.p === v.me ? 'Your' : "Opponent's"} ${ZONE_LABEL[z.z] ?? z.z}`;
  if (z.z === 'bf') return v.bfs[z.bf]?.obj === id ? 'Battlefield' : 'At a battlefield';
  if (z.z === 'facedown') return 'Face down at a battlefield';
  if (z.z === 'chain') return 'On the chain';
  return '';
}

/** Who plays first and how that was settled, for the setup screens. */
export function orderText(sum: SetupSummary, me: PlayerId): string {
  if (sum.first === null) return '';
  const meFirst = sum.first === me;
  if (sum.designee === null) return `${meFirst ? 'You play' : 'The opponent plays'} first, as set for this game.`;
  if (sum.designee === me) return `You chose to play ${meFirst ? 'first' : 'second'}.`;
  return meFirst ? 'The opponent was picked at random to choose, and lets you play first.'
    : 'The opponent was picked at random to choose, and plays first: you play second.';
}

/** A finished mulligan in words; null while that player hasn't done it. */
export function setAsideText(sum: SetupSummary, p: PlayerId, me: PlayerId): string | null {
  const n = sum.setAside[p];
  if (n === undefined) return null;
  if (n === 0) return p === me ? 'You kept your hand.' : 'The opponent kept their hand.';
  return p === me ? `You set aside ${cards(n)} and drew ${n} new.` : `The opponent set aside ${cards(n)}.`;
}
