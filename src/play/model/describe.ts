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
 * Setup (M0), the duel of M1.1 (turns, channels, draws, plays, moves,
 * showdowns, combats, damage, deaths, scoring, points) and the chain of
 * M1.2: spells and tokens played, abilities triggering and activated,
 * instructions that did nothing, banish, burn, discard, buff, stun, Might
 * changes, looks. Every later event kind gets its line with the procedure
 * that emits it.
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
  /** The object of battlefield i, for its name. */
  bfObj?: (bf: number) => ObjId | undefined;
  /** 2v2: every seat's name, so "the opponent" says who [491]. */
  players?: string[];
}

/** "A", "A and B", "A, B and C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
const TOKEN_DEFS: readonly string[] = ['recruit', 'mech', 'bird', 'gold', 'sprite', 'sandSoldier', 'reflection', 'tentacle',
  'shadowClone', 'bomb'];
const ZONE_NAME = { deck: 'Main Deck', runeDeck: 'Rune Deck' } as const;

const HOW: Record<GameResult['reason'], string> = {
  score: 'by points', burnout: 'by burn out', concede: 'by concession', effect: 'by a card effect',
  loop: 'because the game could not go on',
};

export function resultText(r: GameResult, me: PlayerId): string {
  const who = r.winner === null ? 'Nobody wins' : r.winner === me ? 'You win' : 'The opponent wins';
  return `${who} ${HOW[r.reason]}.`;
}

/** How a game was won: "Won by points", "Lost by concession". */
export function resultHow(r: GameResult, me: PlayerId | null): string {
  const verb = r.winner === null ? 'Ended' : me === null ? 'Won' : r.winner === me ? 'Won' : 'Lost';
  return `${verb} ${HOW[r.reason]}`;
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
  // with more than one other player "the opponent" becomes the player's name
  const named2 = (text: string, p: PlayerId | null | undefined) => {
    if (!c.players || p === null || p === undefined || p === c.me) return text;
    const n = c.players[p] ?? `Player ${p + 1}`;
    return text.replace(/\bThe opponent's\b/, `${n}'s`).replace(/\bthe opponent's\b/, `${n}'s`)
      .replace(/\bThe opponent\b/, n).replace(/\bthe opponent\b/, n);
  };
  const actor = (e: ObservedEvent): PlayerId | null => {
    const x = e as { p?: PlayerId | null; first?: PlayerId };
    return x.p ?? x.first ?? null;
  };
  const add = (e: ObservedEvent, text: string, w: LogLine['who'], by?: PlayerId | null) =>
    out.push({ seq: e.seq, text: named2(text, by ?? actor(e)), rule: e.rule, who: w });
  const named = (group: number, p: PlayerId): string[] | null => {
    const defs = moved[`${group}:${p}`] ?? [];
    return defs.length > 0 && defs.every((d) => d !== undefined) ? defs.map((d) => c.nameOf(d!)) : null;
  };

  const subject = (p: PlayerId) => (p === c.me ? 'You' : 'The opponent');
  // What each id was, from the moves the viewer saw: a unit that died since
  // is gone from the view but not from the log.
  const known: Record<ObjId, DefId> = {};
  for (const e of events) {
    if (e.k !== 'zone' || !e.def) continue;
    if (e.obj !== null) known[e.obj] = e.def;
    if (e.prev !== undefined) known[e.prev] = e.def;
  }
  const unitName = (id: ObjId | null) => {
    const def = id === null ? null : c.objOf(id)?.def ?? known[id] ?? null;
    return def ? c.nameOf(def) : 'a unit';
  };
  const bfName = (bf: number) => {
    const id = c.bfObj?.(bf);
    const o = id === undefined ? null : c.objOf(id);
    return o?.def ? c.nameOf(o.def) : `battlefield ${bf + 1}`;
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
      case 'turnStart': add(e, `Turn ${e.n}: ${e.p === c.me ? 'your turn' : "the opponent's turn"}.`, 'game'); break;
      case 'channel': add(e, `${subject(e.p)} channel${e.p === c.me ? '' : 's'} ${e.objs.length} rune${e.objs.length === 1 ? '' : 's'}.`,
        who(e.p)); break;
      case 'played': {
        const o = events.find((z) => z.k === 'zone' && z.why === 'play' && z.group !== undefined && z.to.z === 'chain'
          && 'item' in z.to && z.to.item === e.item);
        const p = e.p ?? (o && o.k === 'zone' && 'p' in o.from ? o.from.p : null);
        const by = p === null ? 'A card is' : p === c.me ? 'You' : 'The opponent';
        const what = TOKEN_DEFS.includes(e.def) ? `a ${c.nameOf(e.def)} token` : c.nameOf(e.def);
        add(e, `${by}${p === null ? '' : p === c.me ? ' play' : ' plays'} ${what}${p === null ? ' played' : ''}.`,
          p === null ? 'game' : who(p), p);
        break;
      }
      case 'chainPush': {
        if (e.kind !== 'triggered' && e.kind !== 'activated') break;
        if (e.kind === 'triggered' && e.source === undefined) { add(e, 'A delayed ability triggers.', 'game'); break; }
        const src = e.source === undefined ? null : c.objOf(e.source)?.def ?? known[e.source] ?? null;
        if (!src || src.endsWith('-rune')) break;                     // rune Add abilities: told by the payment
        add(e, e.kind === 'triggered' ? `${c.nameOf(src)}'s ability triggers.` : `${c.nameOf(src)}'s ability is activated.`,
          'game');
        break;
      }
      case 'outcome':
        if (e.outcome.o === 'ignored') {
          add(e, e.outcome.why === 'targets' ? 'Its target is no longer legal: that part does nothing.'
            : 'What it refers to is gone: that part does nothing.', 'game');
        }
        break;
      case 'playFailed':
        if (e.reason === 'declined' || e.reason === 'unpaid') add(e, 'A cost was not paid: it doesn\'t happen.', 'game');
        else if (e.reason === 'noTargets') add(e, 'An ability has no legal target and is removed.', 'game');
        break;
      case 'banish': add(e, `${listOf(e.objs.map(unitName))} ${e.objs.length === 1 ? 'is' : 'are'} banished.`, 'game'); break;
      case 'burn': add(e, `${subject(e.p)} burn${e.p === c.me ? '' : 's'} ${cards(e.objs.length)}.`, who(e.p)); break;
      case 'discard': add(e, `${subject(e.p)} discard${e.p === c.me ? '' : 's'} ${cards(e.objs.length)}.`, who(e.p)); break;
      case 'buff': add(e, `${listOf(e.objs.map(unitName))} ${e.objs.length === 1 ? 'is' : 'are'} buffed (+1 Might).`, 'game'); break;
      case 'stun': add(e, `${listOf(e.objs.map(unitName))} ${e.objs.length === 1 ? 'is' : 'are'} stunned.`, 'game'); break;
      case 'mightChanged': {
        const last = out[out.length - 1];
        if (last?.rule === e.rule && last.seq === e.seq - 1 && last.text.includes('Might')) break;
        add(e, `${unitName(e.obj)}'s Might changes this turn.`, 'game');
        break;
      }
      case 'look': if (e.objs.every((x) => x !== null)) add(e, `You look at ${cards(e.objs.length)}.`, 'me'); break;
      case 'payment': add(e, `${subject(e.p)} pay${e.p === c.me ? '' : 's'}: ${e.summary}.`, who(e.p)); break;
      case 'move': {
        const first = e.objs[0];
        const owner = first === null || first === undefined ? null : c.objOf(first)?.owner ?? null;
        const names = e.objs.map((id) => unitName(id));
        const to = e.to.z === 'base' ? 'base' : bfName(e.to.bf);
        add(e, `${owner === null ? 'Units move' : `${subject(owner)} move${owner === c.me ? '' : 's'}`} ${listOf(names)} to ${to}.`,
          owner === null ? 'game' : who(owner));
        break;
      }
      case 'recall': add(e, `${listOf(e.objs.map(unitName))} ${e.objs.length === 1 ? 'is' : 'are'} recalled to base.`, 'game'); break;
      case 'showdownStart': add(e, `A showdown begins at ${bfName(e.bf)}.`, 'game'); break;
      case 'combatStart': add(e, `Combat at ${bfName(e.bf)}: ${e.attacker === c.me ? 'you attack' : 'the opponent attacks'}.`, 'game'); break;
      case 'deal': add(e, `${unitName(e.to)} takes ${e.n} damage.`, 'game'); break;
      case 'zone':
        if (e.why === 'kill') add(e, `${e.def ? c.nameOf(e.def) : 'A unit'} dies.`, 'game');
        if (e.why === 'returnToHand') add(e, `${e.def ? c.nameOf(e.def) : 'A card'} returns to its owner's hand.`, 'game');
        if (e.why === 'mill') add(e, `${e.def ? c.nameOf(e.def) : 'A card'} goes from the top of the deck to the trash.`, 'game');
        break;
      case 'combatResult': {
        const r = e.result ?? [];
        const won = r.findIndex((x) => x === 'won');
        add(e, won < 0 ? 'The combat ends with no result.' : won === c.me ? 'You win the combat.' : 'The opponent wins the combat.',
          'game', won < 0 ? null : (won as PlayerId));
        break;
      }
      case 'control':
        add(e, e.p === null ? `Nobody controls ${bfName(e.bf)} now.` : `${subject(e.p)} control${e.p === c.me ? '' : 's'} ${bfName(e.bf)}.`,
          e.p === null ? 'game' : who(e.p));
        break;
      case 'score': {
        const how = e.how === 'conquer' ? 'conquer' : 'hold';
        const verb = e.p === c.me ? how : `${how}s`;
        add(e, `${subject(e.p)} ${verb} ${bfName(e.bf)}${e.point ? '' : ' (at the final point: a card instead of the point)'}.`,
          who(e.p));
        break;
      }
      case 'points': add(e, `${subject(e.p)} ${e.p === c.me ? 'have' : 'has'} ${e.total} point${e.total === 1 ? '' : 's'}.`, who(e.p)); break;
      case 'burnOut': add(e, `${subject(e.p)} burn${e.p === c.me ? '' : 's'} out: the trash is shuffled back.`, who(e.p)); break;
      case 'rollback': add(e, e.reason === 'illegal' ? 'The play fails and is undone.' : 'The play is taken back.', 'me'); break;
      case 'reveal': {
        const names = e.objs.map((id) => unitName(id).replace(/^a unit$/, 'a card'));
        add(e, `A card is revealed: ${listOf(names)}.`, 'game');
        break;
      }
      case 'replaced': {
        const src = unitName(e.source);
        const what = e.event.startsWith('playToken:') ? `a ${c.nameOf(e.event.slice(10))} token` : 'it';
        add(e, `${src}: something else happens instead of ${what}.`, 'game');
        break;
      }
      case 'attach': add(e, `${unitName(e.obj).replace(/^a unit$/, 'An Equipment')} is attached to ${unitName(e.to)}.`, 'game'); break;
      case 'detach': add(e, `${unitName(e.obj).replace(/^a unit$/, 'An Equipment')} is detached.`, 'game'); break;
      case 'xp': add(e, `${subject(e.p)} ${e.delta >= 0 ? (e.p === c.me ? 'gain' : 'gains') : (e.p === c.me ? 'spend' : 'spends')} `
        + `${Math.abs(e.delta)} XP.`, who(e.p)); break;
      case 'hide': {
        const o = c.objOf(e.obj ?? -1);
        const mine = o?.owner === c.me;
        add(e, `${mine ? 'You hide a card' : 'The opponent hides a card'} face down at ${bfName(e.bf)}.`, mine ? 'me' : 'opponent', o?.owner ?? null);
        break;
      }
      case 'counter': add(e, 'A spell is countered.', 'game'); break;
      case 'spendBuff': add(e, `${listOf(e.objs.map(unitName))} spend${e.objs.length === 1 ? 's' : ''} a buff.`, 'game'); break;
      case 'becomeMighty': add(e, `${unitName(e.obj)} becomes Mighty.`, 'game'); break;
      case 'becomeCopy': add(e, `${unitName(e.obj)} becomes ${c.nameOf(e.def)}.`, 'game'); break;
      case 'legendAdded': add(e, `${subject(e.p)} ${e.p === c.me ? 'add' : 'adds'} ${c.nameOf(e.def)} to the Legend Zone.`, who(e.p)); break;
      case 'becomeUnit': add(e, `${unitName(e.obj)} ${e.unit ? 'becomes a unit' : 'stops being a unit'}.`, 'game'); break;
      case 'keywordsChanged': {
        const last = out[out.length - 1];
        if (last?.rule === e.rule && last.seq === e.seq - 1 && last.text.includes('keywords')) break;
        add(e, `${unitName(e.obj)}'s keywords change this turn.`, 'game');
        break;
      }
      default: break;                 // zone moves are told by their summaries; decisions by the prompt
    }
  }
  return out;
}

/** What the other player is doing, from the stub of their decision: only
    its kind and context, never its options (§12.5). */
export function waitingText(stub: DecisionStub): string {
  switch (stub.kind) {
    case 'playOrder': return 'The opponent rolled highest and chooses who plays first…';
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
  return meFirst ? 'The opponent rolled highest and lets you play first.'
    : 'The opponent rolled highest and plays first: you play second.';
}

/** A finished mulligan in words; null while that player hasn't done it. */
export function setAsideText(sum: SetupSummary, p: PlayerId, me: PlayerId): string | null {
  const n = sum.setAside[p];
  if (n === undefined) return null;
  if (n === 0) return p === me ? 'You kept your hand.' : 'The opponent kept their hand.';
  return p === me ? `You set aside ${cards(n)} and drew ${n} new.` : `The opponent set aside ${cards(n)}.`;
}
