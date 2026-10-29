import {
  DUEL, parseKey, type DeckList, type Decision, type DefId, type GameSetup, type ObjId, type PlayerId, type PlayerView,
} from '../../game/index.ts';
import { BUILT_IN_DECKS } from '../host/decks.ts';
import { GameHost, type HostOptions, type Seat } from '../host/GameHost.ts';
import { withPrintings, type CardIndex } from '../model/cards.ts';
import type { Coach, CoachContext, CoachHighlight, CoachStep } from './coach.ts';

/*
 * The guided first match (the Tutorial): a Seraphine mirror on a fixed
 * seed with both decks stacked (GameSetup.stack), the human playing first
 * against a scripted opponent, first to 5 points. The coach walks the human
 * through one designed game, a step at a time:
 *
 *   T1  the board, runes and the draw; pay for and play Strigian Oracle
 *   T2  (the opponent plays Hunting Dog)
 *   T3  move the Oracle to a battlefield: a showdown, nobody there, conquer
 *       and score; play Faithful Manufactor (and its Recruit)
 *   T4  (the opponent conquers its own battlefield, plays Steadfast Outrider)
 *   T5  hold your battlefield for a point; attack the Dog with two units,
 *       cast the Reaction High Note in the showdown, win the combat, conquer
 *   T6  (the opponent's Outrider takes your battlefield back)
 *   T7  free: one more point wins — hold, then retake it (light hints)
 *
 * Every coached step lets through only the keys it teaches (coach.ts
 * restrict); when the decision on screen offers none of them (something
 * unexpected), the step lets everything through instead, so the lesson can
 * never get stuck. After the coached part the opponent turns into the
 * simple bot and the coach only gives hints.
 */

export const TUTORIAL_SEED = 20261023;
export const TUTORIAL_SCORE = 5;
export const HUMAN: PlayerId = 0;
export const OPPONENT: PlayerId = 1;
export const OPPONENT_NAME = 'Tutor';

const SERAPHINE = BUILT_IN_DECKS.find((b) => b.id === 'seraphine')!.deck;

/** The human's cards, top first: the opening four, then one per draw. */
const HUMAN_TOP: DefId[] = [
  'strigian-oracle', 'faithful-manufactor', 'high-note', 'hunting-dog',
  'fanfare',                       // T1 draw
  'herald-of-the-emperor',         // T3
  'encore',                        // T5
  'industrious-mechsmith',         // T7
];
const OPPONENT_TOP: DefId[] = ['hunting-dog', 'steadfast-outrider', 'concert-poster', 'strigian-oracle', 'fanfare', 'piltovan-guidebot'];
const RUNES: DefId[] = ['mind-rune', 'order-rune', 'mind-rune', 'order-rune', 'mind-rune', 'order-rune', 'mind-rune', 'order-rune'];

export function tutorialDecks(): [DeckList, DeckList] {
  return [
    { ...SERAPHINE, name: 'Your Seraphine deck', battlefields: ['valley-of-idols'] },
    { ...SERAPHINE, name: 'Tutor\'s Seraphine deck', battlefields: ['black-rose-sanctum'] },
  ];
}

export function tutorialSetup(ix?: CardIndex): GameSetup {
  const [a, b] = tutorialDecks();
  return {
    seed: TUTORIAL_SEED,
    decks: ix ? [withPrintings(a, ix), withPrintings(b, ix)] : [a, b],
    firstPlayer: HUMAN,
    mode: { ...DUEL, victoryScore: TUTORIAL_SCORE },
    stack: [{ main: HUMAN_TOP, runes: RUNES }, { main: OPPONENT_TOP, runes: RUNES }],
  };
}

// ---- reading a view ----

const realKeys = (d: Decision | null) => (d ? d.options.filter((o) => !o.ui).map((o) => o.key) : []);
const defOf = (v: PlayerView, id: ObjId | undefined): DefId | null => {
  const o = id === undefined ? undefined : v.objects[id];
  return o && 'def' in o ? o.def : null;
};
/** The first card of this definition in p's hand (the human sees only their own). */
export const inHand = (v: PlayerView, p: PlayerId, def: DefId): ObjId | undefined =>
  v.players[p].hand.find((id) => defOf(v, id) === def);
/** Units of p on the board: base and battlefields. */
export function unitsOf(v: PlayerView, p: PlayerId, def?: DefId): ObjId[] {
  const ids = [...v.players[p].base, ...v.bfs.flatMap((b) => b.here)];
  return ids.filter((id) => {
    const o = v.objects[id];
    return o && 'def' in o && o.controller === p && (def === undefined ? !!o.def && !o.def.endsWith('-rune') : o.def === def);
  });
}
/** Where an object is: 'base', a battlefield index, or null. */
export function whereIs(v: PlayerView, id: ObjId): 'base' | number | null {
  const o = v.objects[id];
  if (!o) return null;
  if (o.zone.z === 'base') return 'base';
  if (o.zone.z === 'bf') return o.zone.bf;
  return null;
}
const head = (k: string) => parseKey(k)?.head;
const objOfKey = (k: string) => parseKey(k)?.obj;

/** The human's battlefield (theirs to start) and the opponent's. */
export const MY_BF = 0, THEIR_BF = 1;

// ---- the opponent ----

/** What the opponent answers, from its own view: the lesson's moves in the
    coached turns; null (the simple bot) for everything else. */
export function opponentAnswer(v: PlayerView): string | null {
  const d = v.pending;
  if (!d) return null;
  const keys = realKeys(d);
  const has = (k: string) => keys.includes(k);
  const n = v.turn.n;
  const me = v.me;
  if (d.kind === 'mulligan') return has('done') ? 'done' : null;
  if (n > 7) return null;
  const playOf = (def: DefId) => { const id = inHand(v, me, def); return id !== undefined && has(`play:${id}`) ? `play:${id}` : null; };
  const unit = (def: DefId) => unitsOf(v, me, def)[0];
  switch (d.kind) {
    case 'priority': {
      if (d.prompt.window !== 'main') return has('pass') ? 'pass' : null;
      if (v.turn.player !== me) return has('pass') ? 'pass' : null;
      if (n === 2) return playOf('hunting-dog') ?? 'end';
      if (n === 4) {
        const dog = unit('hunting-dog');
        if (dog !== undefined && whereIs(v, dog) === 'base' && has('move')) return 'move';
        return playOf('steadfast-outrider') ?? 'end';
      }
      if (n === 6) {
        const out = unit('steadfast-outrider');
        if (out !== undefined && whereIs(v, out) === 'base' && has('move')) return 'move';
        return 'end';
      }
      return has('end') ? 'end' : null;
    }
    case 'moveUnits': {
      const want = n === 4 ? unit('hunting-dog') : unit('steadfast-outrider');
      if (want !== undefined && has(`u:${want}`)) return `u:${want}`;
      return has('done') ? 'done' : null;
    }
    case 'moveDest': {
      // T4: the Dog takes its own empty battlefield; T6: the Outrider goes
      // where the human's units are fewest (the lesson's retake).
      if (n === 4) return has(`loc:bf${THEIR_BF}`) ? `loc:bf${THEIR_BF}` : null;
      const target = [THEIR_BF, MY_BF].find((bf) => has(`loc:bf${bf}`) && v.bfs[bf].controller === HUMAN
        && v.bfs[bf].here.filter((id) => v.objects[id]?.controller === HUMAN).length <= 1);
      return target !== undefined ? `loc:bf${target}` : null;
    }
    case 'payment': return keys.find((k) => head(k) === 'pay') ?? null;
    case 'location': return has('loc:base') ? 'loc:base' : null;
    case 'showOff': return has('no') ? 'no' : null;
    case 'may': case 'optionalCost': return has('no') ? 'no' : null;
    default: return null;
  }
}

export function opponentSeat(): Seat {
  return { k: 'script', answer: opponentAnswer, name: OPPONENT_NAME };
}

/** The tutorial's game: the human keeps the stacked opening hand at once
    (no mulligan to explain), the opponent is scripted. Never autosaved. */
export function tutorialHost(ix: CardIndex | undefined, o: Omit<HostOptions, 'setup' | 'seats'> = {}): GameHost {
  const h = new GameHost({ ...o, setup: tutorialSetup(ix), seats: [{ k: 'human' }, opponentSeat()] });
  if (h.getSnapshot().view.pending?.kind === 'mulligan') h.commit(['done']);
  return h;
}

// ---- the coach ----

interface Ctx extends CoachContext { mem: Mem }
interface Mem { nexts: Set<string> }

interface LessonStep {
  id: string;
  title: string;
  /** The words, by situation. */
  text: (c: Ctx) => string;
  /** An explanation: done when Next is pressed. */
  next?: boolean;
  /** Shown only once this holds (an action of the opponent, a new turn). */
  ready?: (c: Ctx) => boolean;
  /** Done (the lesson moves on) once this holds. */
  done?: (c: Ctx) => boolean;
  /** The keys this step teaches, for the decision on screen. */
  allow?: (key: string, c: Ctx) => boolean;
  highlight?: (c: Ctx) => CoachHighlight;
  anchor?: CoachStep['anchor'];
  /** A suggestion only: highlighted, nothing restricted (the free finish). */
  soft?: boolean;
}

const me = (c: Ctx) => c.view.players[HUMAN];
const turnIs = (c: Ctx, n: number) => c.view.turn.n === n;
const turnAtLeast = (c: Ctx, n: number) => c.view.turn.n >= n;
const kind = (c: Ctx) => c.decision?.kind ?? null;
const window_ = (c: Ctx) => (c.decision?.kind === 'priority' ? c.decision.prompt.window : null);
const pointsOf = (c: Ctx, p: PlayerId) => c.view.players[p].points;
const handKey = (c: Ctx, def: DefId) => { const id = inHand(c.view, HUMAN, def); return id === undefined ? null : `play:${id}`; };
const runeIds = (c: Ctx) => me(c).base.filter((id) => (defOf(c.view, id) ?? '').endsWith('-rune'));
const PAY = (k: string) => head(k) === 'pay' || k.startsWith('pay-') || k === 'loc:base';
// the confirm button of the rune-tap payment stands in for the engine's pay options
const payKeys = (ks: string[]) => (ks.some((k) => head(k) === 'pay') ? ['pay-confirm'] : []);

/** The lesson, in order. */
const STEPS: LessonStep[] = [
  {
    id: 'welcome', title: 'Welcome to Riftbound', next: true, anchor: 'top',
    text: () => 'This short match teaches you the basics, one step at a time. The board: your base is at the bottom, ' +
      'your opponent\'s at the top, and the two battlefields are in the middle. Units fight over the battlefields to ' +
      `score points: the first to ${TUTORIAL_SCORE} points wins (a normal game goes to 8).`,
    highlight: () => ({ lanes: [MY_BF, THEIR_BF] }),
  },
  {
    id: 'legend', title: 'Your legend and champion', next: true, anchor: 'top',
    text: () => 'Your Legend (Seraphine) sits beside your base and gives your deck its colours: Mind and Order. Your ' +
      'Chosen Champion waits in its own zone; you can play it like any unit from your hand.',
    highlight: (c) => ({ objs: [...me(c).legend, ...(me(c).champion === null ? [] : [me(c).champion!])] }),
  },
  {
    id: 'runes', title: 'Runes pay for cards', next: true,
    text: () => 'At the start of each turn you channel 2 runes from your rune deck and draw a card. A rune pays 1 ' +
      'Energy when you exhaust it (turn it sideways). You have 2 runes now; they ready again next turn.',
    highlight: (c) => ({ objs: runeIds(c) }),
  },
  {
    id: 'play-oracle', title: 'Play a unit',
    text: (c) => (kind(c) === 'payment'
      ? 'Pay the cost: exhaust 2 runes for 2 Energy. Tap the runes to exhaust, then press Pay.'
      : 'Strigian Oracle costs 2 Energy, the number in its corner. Click it in your hand to play it to your base.'),
    done: (c) => unitsOf(c.view, HUMAN, 'strigian-oracle').length > 0,
    allow: (k, c) => k === handKey(c, 'strigian-oracle') || PAY(k),
    highlight: (c) => ({ objs: [inHand(c.view, HUMAN, 'strigian-oracle')].filter((x): x is number => x !== undefined),
      keys: payKeys(realKeys(c.decision)) }),
  },
  {
    id: 'end-1', title: 'End your turn',
    text: () => 'Units enter play exhausted, so the Oracle can\'t move this turn. You have no Energy left: end your turn.',
    done: (c) => turnAtLeast(c, 2),
    allow: (k) => k === 'end',
    highlight: () => ({ keys: ['end'] }),
  },
  {
    id: 'their-turn', title: 'Your opponent\'s turn', next: true,
    ready: (c) => turnAtLeast(c, 3) || unitsOf(c.view, OPPONENT, 'hunting-dog').length > 0,
    text: () => 'Your opponent played Hunting Dog (3 Might). Might is both how much damage a unit deals and how much ' +
      'it takes to kill it.',
    highlight: (c) => ({ objs: unitsOf(c.view, OPPONENT, 'hunting-dog') }),
  },
  {
    id: 'move', title: 'Move to a battlefield',
    ready: (c) => turnIs(c, 3) && c.decision !== null,
    text: (c) => (kind(c) === 'moveDest'
      ? 'Now click the battlefield on your side (Valley of Idols) to send the Oracle there.'
      : 'New turn: your units and runes are ready, you channeled 2 more runes (4 now) and drew a card. Click Move units ' +
        'to send the Oracle to a battlefield.'),
    done: (c) => { const o = unitsOf(c.view, HUMAN, 'strigian-oracle')[0]; return o !== undefined && whereIs(c.view, o) === MY_BF; },
    allow: (k, c) => k === 'move' || k === `loc:bf${MY_BF}` || (kind(c) === 'moveUnits' && head(k) === 'u'),
    highlight: (c) => ({ keys: ['move', `loc:bf${MY_BF}`], lanes: kind(c) === 'moveDest' ? [MY_BF] : [] }),
  },
  {
    id: 'predict', title: 'A triggered ability',
    ready: (c) => kind(c) === 'predict',
    done: (c) => pointsOf(c, HUMAN) >= 1 || (turnIs(c, 3) && kind(c) !== 'predict' && c.mem.nexts.has('predict-seen')),
    text: () => 'Moving exhausted the Oracle, and its ability says: when I become exhausted, Predict. Look at the top ' +
      'card of your deck: keep it on top, or recycle it to the bottom. Keep it for now.',
    allow: (k) => head(k) === 'keep',
    highlight: (c) => ({ keys: realKeys(c.decision).filter((k) => head(k) === 'keep') }),
  },
  {
    id: 'conquer', title: 'Conquer and score', next: true,
    ready: (c) => pointsOf(c, HUMAN) >= 1,
    text: () => 'Units arriving at a battlefield start a showdown, a window where both players may cast Reactions. Nobody ' +
      'was there to stop you, so you conquered Valley of Idols and scored 1 point. Each battlefield can score for you ' +
      'once per turn.',
    highlight: () => ({ lanes: [MY_BF] }),
  },
  {
    id: 'manufactor', title: 'Play another unit',
    ready: (c) => turnIs(c, 3) && (window_(c) === 'main' || kind(c) === 'payment' || kind(c) === 'location'),
    text: (c) => (kind(c) === 'location' ? 'Units are played to your base (or to a battlefield you control). Choose your base.'
      : kind(c) === 'payment' ? 'Pay 3 Energy with your runes.'
      : 'You still have 4 ready runes. Play Faithful Manufactor (3 Energy): when it is played, it brings a 1 Might ' +
        'Recruit token along.'),
    done: (c) => unitsOf(c.view, HUMAN, 'faithful-manufactor').length > 0,
    allow: (k, c) => k === handKey(c, 'faithful-manufactor') || PAY(k) || k === 'pass',
    highlight: (c) => ({ objs: [inHand(c.view, HUMAN, 'faithful-manufactor')].filter((x): x is number => x !== undefined),
      keys: payKeys(realKeys(c.decision)) }),
  },
  {
    id: 'end-3', title: 'End your turn',
    ready: (c) => window_(c) === 'main',
    text: () => 'Keep High Note in your hand for later. End your turn.',
    done: (c) => turnAtLeast(c, 4),
    allow: (k) => k === 'end',
    highlight: () => ({ keys: ['end'] }),
  },
  {
    id: 'hold', title: 'Hold for a point', next: true,
    ready: (c) => turnAtLeast(c, 5),
    text: (c) => 'Your opponent moved Hunting Dog to Black Rose Sanctum, conquered it, and played Steadfast Outrider ' +
      '(a Tank: it must be dealt combat damage first). Your turn began with a Hold: you still control Valley of ' +
      `Idols, so it scored again. You have ${pointsOf(c, HUMAN)} points, they have ${pointsOf(c, OPPONENT)}.`,
    highlight: (c) => ({ lanes: [MY_BF, THEIR_BF], objs: unitsOf(c.view, OPPONENT, 'steadfast-outrider') }),
  },
  {
    id: 'attack', title: 'Attack!',
    ready: (c) => turnIs(c, 5) && c.decision !== null,
    text: (c) => (kind(c) === 'moveUnits'
      ? 'Pick Faithful Manufactor and the Recruit (the two units in your base), then click Done.'
      : kind(c) === 'moveDest'
        ? 'Send them to Black Rose Sanctum, where the Dog is.'
        : 'Take their battlefield. Click Move units to attack the Hunting Dog with Faithful Manufactor and the Recruit.'),
    done: (c) => c.view.showdown !== null || c.view.combat !== null || (turnIs(c, 5) && pointsOf(c, HUMAN) >= 3),
    allow: (k, c) => {
      if (k === 'move' || k === `loc:bf${THEIR_BF}`) return true;
      if (kind(c) !== 'moveUnits') return false;
      const fromBase = (key: string) => { const id = objOfKey(key); return id !== undefined && whereIs(c.view, id) === 'base'; };
      if (k === 'done') return !realKeys(c.decision).some(fromBase);
      return fromBase(k);
    },
    highlight: (c) => ({ keys: ['move', 'done', `loc:bf${THEIR_BF}`], lanes: kind(c) === 'moveDest' ? [THEIR_BF] : [],
      objs: kind(c) === 'moveUnits' ? unitsOf(c.view, HUMAN).filter((id) => whereIs(c.view, id) === 'base') : [] }),
  },
  {
    id: 'reaction', title: 'Cast a Reaction',
    ready: (c) => turnIs(c, 5) && (window_(c) === 'showdown' || kind(c) === 'target' || kind(c) === 'payment'),
    text: (c) => (kind(c) === 'target'
      ? 'Choose the Hunting Dog as the target.'
      : kind(c) === 'payment'
        ? 'Pay 3 Energy.'
        : 'A showdown at Black Rose Sanctum: 3 Might against 3 is an even trade. Spells change that. High Note is a ' +
          'Reaction spell, so it can be cast now: it gives a unit -1 Might for each exhausted unit you control. Click it.'),
    done: (c) => !turnIs(c, 5) || pointsOf(c, HUMAN) >= 3
      || (inHand(c.view, HUMAN, 'high-note') === undefined && kind(c) !== 'target' && kind(c) !== 'payment'),
    allow: (k, c) => k === handKey(c, 'high-note') || PAY(k)
      || (kind(c) === 'target' && unitsOf(c.view, OPPONENT, 'hunting-dog').includes(objOfKey(k) ?? -1)),
    highlight: (c) => ({ objs: [inHand(c.view, HUMAN, 'high-note'), ...(kind(c) === 'target' ? unitsOf(c.view, OPPONENT, 'hunting-dog') : [])]
      .filter((x): x is number => x !== undefined), keys: payKeys(realKeys(c.decision)) }),
  },
  {
    id: 'won-fight', title: 'You won the fight', next: true,
    ready: (c) => !turnIs(c, 5) || window_(c) === 'main',
    text: (c) => (pointsOf(c, HUMAN) >= 3
      ? 'Combat: each unit deals damage equal to its Might. High Note shrank the Dog to 1 Might, so it fell and you ' +
        `conquered Black Rose Sanctum: ${pointsOf(c, HUMAN)} points. Its Deathknell left your opponent a Bird token, ` +
        'and the battlefield gave you a Recruit for your fallen unit. Damage wears off at the end of each turn.'
      : 'The combat is over. Damage wears off at the end of each turn.'),
    highlight: () => ({ lanes: [THEIR_BF] }),
  },
  {
    id: 'dog', title: 'More units',
    ready: (c) => turnIs(c, 5) && (window_(c) === 'main' || kind(c) === 'payment' || kind(c) === 'location'),
    text: (c) => (kind(c) === 'payment' ? 'Pay 3 Energy.' : kind(c) === 'location' ? 'Play it to your base.'
      : 'Use your last 3 Energy: play your own Hunting Dog. Units in your base can defend or attack next turn.'),
    done: (c) => !turnIs(c, 5) || unitsOf(c.view, HUMAN, 'hunting-dog').length > 0,
    allow: (k, c) => k === handKey(c, 'hunting-dog') || PAY(k) || k === 'pass',
    highlight: (c) => ({ objs: [inHand(c.view, HUMAN, 'hunting-dog')].filter((x): x is number => x !== undefined),
      keys: payKeys(realKeys(c.decision)) }),
  },
  {
    id: 'end-5', title: 'End your turn',
    ready: (c) => !turnIs(c, 5) || window_(c) === 'main',
    text: () => 'End your turn and see what your opponent does.',
    done: (c) => turnAtLeast(c, 6),
    allow: (k) => k === 'end',
    highlight: () => ({ keys: ['end'] }),
  },
  {
    id: 'retake', title: 'They strike back', next: true,
    ready: (c) => turnAtLeast(c, 7),
    text: (c) => `Your opponent sent Steadfast Outrider to retake a battlefield. Score: you ${pointsOf(c, HUMAN)}, ` +
      `them ${pointsOf(c, OPPONENT)}. You need ${TUTORIAL_SCORE} to win.`,
    highlight: (c) => ({ objs: unitsOf(c.view, OPPONENT, 'steadfast-outrider') }),
  },
  {
    id: 'finish-herald', title: 'One more point', soft: true,
    ready: (c) => turnIs(c, 7) && c.decision !== null,
    text: (c) => (kind(c) === 'target'
      ? 'Choose your Hunting Dog: its base Might becomes 5 this turn, more than the Outrider\'s 4.'
      : kind(c) === 'payment' ? 'Pay 5 Energy.'
        : kind(c) === 'location' ? 'Play it to your base.'
          : 'One more point wins, and Hold already scored Valley of Idols this turn, so conquering Black Rose ' +
            'Sanctum back wins the game. You decide how from here; a suggestion: play Herald of the Emperor (5 ' +
            'Energy) to make your Hunting Dog stronger.'),
    done: (c) => !turnIs(c, 7) || (inHand(c.view, HUMAN, 'herald-of-the-emperor') === undefined && window_(c) === 'main'),
    highlight: (c) => ({
      objs: [inHand(c.view, HUMAN, 'herald-of-the-emperor'), ...unitsOf(c.view, HUMAN, 'hunting-dog')]
        .filter((x): x is number => x !== undefined),
      keys: [handKey(c, 'herald-of-the-emperor'), 'loc:base', ...payKeys(realKeys(c.decision)),
        ...(kind(c) === 'target' ? unitsOf(c.view, HUMAN, 'hunting-dog').map((id) => `t:${id}`) : [])]
        .filter((k): k is string => k !== null),
    }),
  },
  {
    id: 'finish-attack', title: 'Take it back', soft: true,
    ready: (c) => turnIs(c, 7) && c.decision !== null,
    text: (c) => (kind(c) === 'moveUnits' ? 'Pick the Hunting Dog and the Recruit, then click Done.'
      : kind(c) === 'moveDest' ? 'Click Black Rose Sanctum.'
        : window_(c) === 'showdown' || window_(c) === 'chain' ? 'Pass, and let combat decide.'
          : 'Now move your units from your base to Black Rose Sanctum and win the fight.'),
    done: (c) => !turnIs(c, 7),
    highlight: (c) => {
      const base = unitsOf(c.view, HUMAN).filter((id) => whereIs(c.view, id) === 'base');
      const left = realKeys(c.decision).some((k) => head(k) === 'u' && base.includes(objOfKey(k) ?? -1));
      return { lanes: kind(c) === 'moveDest' ? [THEIR_BF] : [], objs: kind(c) === 'moveUnits' ? base : [],
        keys: ['move', `loc:bf${THEIR_BF}`, 'pass', ...base.map((id) => `u:${id}`), ...(left ? [] : ['done'])] };
    },
  },
];

/** A hint for free play, by situation. */
function hint(c: Ctx): CoachStep | null {
  const v = c.view;
  if (v.result) return null;
  const d = c.decision;
  const pts = `You ${pointsOf(c, HUMAN)} · them ${pointsOf(c, OPPONENT)} · ${TUTORIAL_SCORE} to win.`;
  if (!d) return { id: 'hint-wait', title: 'Tutorial', text: `Your opponent is playing. ${pts}` };
  if (d.kind === 'priority' && d.prompt.window === 'main') {
    return { id: 'hint-main', title: 'Your turn', text: `Play units and spells, move units to a battlefield you don't ` +
      `control, then end the turn. ${pts}` };
  }
  if (d.kind === 'priority' && d.prompt.window === 'showdown') {
    return { id: 'hint-showdown', title: 'Showdown', text: 'You may cast a Reaction now, or pass.' };
  }
  if (d.kind === 'moveUnits') return { id: 'hint-move', title: 'Move', text: 'Pick the units to move together, then Done.' };
  return null;
}

/** Between two steps (the opponent acts, a chain or a showdown runs out):
    a caption, and only the quiet answers (pass, keep) when there are any. */
function waiting(s: LessonStep, c: Ctx): CoachStep {
  const d = c.decision;
  const id = `${s.id}-wait`;
  if (!d) return { id, title: 'Tutorial', text: 'Your opponent is playing…' };
  const quiet = (k: string) => k === 'pass' || head(k) === 'keep';
  const allow = realKeys(d).some(quiet) ? quiet : undefined;
  const text = window_(c) === 'chain'
    ? 'Something is on the chain (shown beside the board). Click Pass to let it resolve.'
    : window_(c) === 'showdown' ? 'A showdown: both players may cast Reactions. Nothing to do here: click Pass.'
      : d.kind === 'predict' ? 'Predict: keep the top card of your deck, or recycle it.' : 'Choose an option to go on.';
  return { id, title: 'Tutorial', text, ...(allow ? { allow, highlight: { keys: realKeys(d).filter(quiet) } } : {}) };
}

/** Keys the step lets through for this decision, or undefined for all. */
function allowFor(s: LessonStep, c: Ctx): ((key: string) => boolean) | undefined {
  if (!c.decision) return undefined;
  if (s.next) return () => false;                       // read first, then Next
  if (!s.allow || s.soft) return undefined;
  const ok = (k: string) => s.allow!(k, c);
  // never stuck: when the step's keys aren't on offer, everything is
  return realKeys(c.decision).some(ok) ? ok : undefined;
}

export interface TutorialCoach extends Coach {
  /** The coached part is over (only hints are left). */
  readonly free: boolean;
  /** Which step is on (for tests and the DEV panel). */
  readonly at: string | null;
}

export function createTutorialCoach(): TutorialCoach {
  let i = 0;
  const mem: Mem = { nexts: new Set() };
  const current = (ctx: CoachContext): LessonStep | null => {
    const c: Ctx = { ...ctx, mem };
    for (let guard = 0; i < STEPS.length && guard < STEPS.length; guard++) {
      const s = STEPS[i];
      const doneNow = s.next ? mem.nexts.has(s.id) : s.done?.(c) ?? false;
      if (!doneNow) return s;
      i++;
    }
    return i < STEPS.length ? STEPS[i] : null;
  };
  return {
    get free() { return i >= STEPS.length; },
    get at() { return i < STEPS.length ? STEPS[i].id : null; },
    step(ctx) {
      const c: Ctx = { ...ctx, mem };
      if (ctx.view.result) return null;
      const s = current(ctx);
      if (!s) return hint(c);
      if (s.ready && !s.ready(c)) return waiting(s, c);
      if (s.id === 'predict') mem.nexts.add('predict-seen');
      const allow = allowFor(s, c);
      const out: CoachStep = { id: s.id, title: s.title, text: s.text(c), highlight: s.highlight?.(c), anchor: s.anchor };
      if (s.next) out.next = true;
      if (allow) out.allow = allow;
      return out;
    },
    onNext(step) {
      mem.nexts.add(step.id);
    },
  };
}

export const LESSON_STEPS = STEPS.map((s) => s.id);
