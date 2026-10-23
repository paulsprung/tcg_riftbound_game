import {
  DUEL, findCard, parseKey, STARTERS, type DeckList, type Starter, type Decision, type DefId, type GameSetup, type ObjId, type PlayerId, type PlayerView,
} from '../../game/index.ts';
import { GameHost, type HostOptions, type Seat } from '../host/GameHost.ts';
import { withPrintings, type CardIndex } from '../model/cards.ts';
import type { Coach, CoachContext, CoachHighlight, CoachStep } from './coach.ts';
import type { TutorialCoach } from './lesson.ts';

/*
 * The tutorial with the player's own starter deck. Unlike the Seraphine
 * lesson (lesson.ts, a fixed script for one deck) this one works for any
 * starter: nothing in it names a card.
 *
 *   - The setup: the player's starter against a gentle opposing starter
 *     (TUTOR_DECKS), one battlefield each, first to 5 points, the human
 *     first. Both decks are stacked (GameSetup.stack) from their own lists:
 *     the opening hand holds the cheapest units the first turns can pay for
 *     (no Power cost, no champion) and a cheap spell; the runes alternate
 *     the deck's two domains so Power costs can be paid later.
 *   - The opponent (a script seat): plays its cheapest unit each turn and,
 *     on its second turn, walks one unit to its own battlefield (something
 *     to attack); it never casts Reactions in the coached turns. From turn
 *     9 on it is the simple bot.
 *   - The coach: concepts, not a script. Each step teaches one idea (play a
 *     unit, end the turn, move, the showdown, conquer, a spell, hold,
 *     combat, the last point) and comes up when the game on screen offers
 *     it: the first step in order that is eligible (the steps it builds on
 *     are done), ready (the decision on screen fits) and not done. A step
 *     that teaches a choice lets only its keys through; when the decision
 *     offers none of them, everything is let through, and every step
 *     expires after a few turns, so the lesson can never get stuck.
 */

export const STARTER_TUTORIAL_SEED = 20261024;
export const STARTER_TUTORIAL_SCORE = 5;
const HUMAN: PlayerId = 0;
const OPPONENT: PlayerId = 1;
export const STARTER_OPPONENT_NAME = 'Tutor';
/** Opponents with plain, cheap units, in order of preference. */
export const TUTOR_DECKS = ['garen', 'lux', 'master-yi'];

const card = (def: DefId) => findCard(def);
const nameOf = (def: DefId | null) => (def ? card(def)?.name ?? def : 'a card');
const energy = (def: DefId) => card(def)?.cost?.energy ?? 99;
const powerFree = (def: DefId) => (card(def)?.cost?.power.length ?? 1) === 0;
const isType = (def: DefId | null, t: 'unit' | 'spell' | 'gear') => !!def && !!card(def)?.types.includes(t);
const hasKw = (def: DefId, kw: string) => !!card(def)?.keywords.some((l) => l.keywords.some((k) => k.kw === kw));

export const starterOf = (id: string | null | undefined): Starter | undefined => STARTERS.find((s) => s.id === id);
export const tutorOpponent = (mine: string): Starter => starterOf(TUTOR_DECKS.find((id) => id !== mine) ?? 'garen')!;

/** The cards to stack on top of a deck, top first: the opening hand, then
    one per draw. Deterministic from the list alone. */
export function stackFor(d: DeckList, spell: boolean): DefId[] {
  const pool: DefId[] = [];
  for (const e of d.main) {
    const n = e.def === d.chosenChampion ? e.n - 1 : e.n;      // one copy is the Chosen Champion
    for (let i = 0; i < n; i++) pool.push(e.def);
  }
  const picked = new Set<DefId>();
  // a card not dealt yet first: a hand of different cards shows more
  const take = (pick: (def: DefId) => boolean, order: (a: DefId, b: DefId) => number) => {
    const c = pool.filter(pick).sort((a, b) => Number(picked.has(a)) - Number(picked.has(b)) || order(a, b))[0];
    if (c === undefined) return null;
    picked.add(c);
    pool.splice(pool.indexOf(c), 1);
    return c;
  };
  const cheap = (a: DefId, b: DefId) => energy(a) - energy(b) || a.localeCompare(b);
  const easyUnit = (def: DefId) => isType(def, 'unit') && powerFree(def) && !card(def)!.supertypes.includes('champion');
  const out: (DefId | null)[] = [
    take((x) => easyUnit(x) && energy(x) <= 2, cheap),
    take((x) => easyUnit(x) && energy(x) <= 3, cheap),
  ];
  if (spell) {
    // a cheap spell, one that can be cast in a showdown first
    const quick = (x: DefId) => hasKw(x, 'reaction') || hasKw(x, 'action');
    out.push(take((x) => isType(x, 'spell') && energy(x) <= 4, (a, b) =>
      Number(quick(b)) - Number(quick(a)) || Number(powerFree(b)) - Number(powerFree(a)) || cheap(a, b)));
  }
  out.push(take((x) => easyUnit(x) && energy(x) <= 4, cheap), take(easyUnit, cheap), take(easyUnit, cheap));
  return out.filter((x): x is DefId => x !== null);
}

/** The runes, alternating the deck's domains (top first). */
function runeStack(d: DeckList): DefId[] {
  const kinds = d.runes.map((r) => r.def);
  const left = new Map(d.runes.map((r) => [r.def, r.n]));
  const out: DefId[] = [];
  for (let i = 0; out.length < 8 && i < 32; i++) {
    const def = kinds[i % kinds.length];
    if ((left.get(def) ?? 0) > 0) { out.push(def); left.set(def, left.get(def)! - 1); }
  }
  return out;
}

export function starterTutorialDecks(mine: Starter): [DeckList, DeckList] {
  const them = tutorOpponent(mine.id);
  return [
    { ...mine.deck, name: `Your ${mine.deck.name}`, battlefields: mine.deck.battlefields.slice(0, 1) },
    { ...them.deck, name: `${STARTER_OPPONENT_NAME}'s ${them.deck.name}`, battlefields: them.deck.battlefields.slice(0, 1) },
  ];
}

export function starterTutorialSetup(mine: Starter, ix?: CardIndex): GameSetup {
  const [a, b] = starterTutorialDecks(mine);
  return {
    seed: STARTER_TUTORIAL_SEED,
    decks: ix ? [withPrintings(a, ix), withPrintings(b, ix)] : [a, b],
    firstPlayer: HUMAN,
    mode: { ...DUEL, victoryScore: STARTER_TUTORIAL_SCORE },
    stack: [{ main: stackFor(a, true), runes: runeStack(a) }, { main: stackFor(b, false), runes: runeStack(b) }],
  };
}

// ---- reading a view ----

const realKeys = (d: Decision | null) => (d ? d.options.filter((o) => !o.ui).map((o) => o.key) : []);
const head = (k: string) => parseKey(k)?.head;
const objOfKey = (k: string) => parseKey(k)?.obj;
const defOf = (v: PlayerView, id: ObjId | undefined): DefId | null => {
  const o = id === undefined ? undefined : v.objects[id];
  return o && 'def' in o ? o.def : null;
};
/** p's units on the board (base and battlefields). */
function unitsOf(v: PlayerView, p: PlayerId): ObjId[] {
  return [...v.players[p].base, ...v.bfs.flatMap((b) => b.here)].filter((id) => {
    const o = v.objects[id];
    return o && 'def' in o && o.controller === p && isType(o.def, 'unit');
  });
}
const whereIs = (v: PlayerView, id: ObjId): 'base' | number | null => {
  const z = v.objects[id]?.zone;
  return z?.z === 'base' ? 'base' : z?.z === 'bf' ? z.bf : null;
};
const inHandOfType = (v: PlayerView, p: PlayerId, t: 'unit' | 'spell') => v.players[p].hand.filter((id) => isType(defOf(v, id), t));

// ---- the opponent ----

/** The opponent's answers, from its own view; null is the simple bot. */
export function starterOpponentAnswer(v: PlayerView): string | null {
  const d = v.pending;
  if (!d) return null;
  const keys = realKeys(d);
  const has = (k: string) => keys.includes(k);
  const me = v.me;
  if (d.kind === 'mulligan') return has('done') ? 'done' : null;
  if (v.turn.n > 8) return null;
  const mine = v.turn.player === me;
  switch (d.kind) {
    case 'priority': {
      if (d.prompt.window !== 'main' || !mine) return has('pass') ? 'pass' : null;
      const plays = inHandOfType(v, me, 'unit').filter((id) => has(`play:${id}`))
        .sort((a, b) => energy(defOf(v, a)!) - energy(defOf(v, b)!));
      if (plays.length > 0) return `play:${plays[0]}`;
      // the second turn: one unit takes its own battlefield
      const atBf = unitsOf(v, me).some((id) => typeof whereIs(v, id) === 'number');
      if (v.turn.n >= 4 && !atBf && has('move')) return 'move';
      return has('end') ? 'end' : null;
    }
    case 'moveUnits': {
      const chosen = d.prompt.t === 'moveUnits' ? d.prompt.chosen : 0;
      const u = keys.find((k) => head(k) === 'u' && whereIs(v, objOfKey(k)!) === 'base');
      return chosen === 0 && u !== undefined ? u : has('done') ? 'done' : null;
    }
    case 'moveDest': {
      const free = v.bfs.map((b, i) => ({ b, i })).filter(({ b }) => b.here.every((id) => v.objects[id]?.controller === me));
      const at = free.find(({ i }) => i === OPPONENT) ?? free[0];
      return at && has(`loc:bf${at.i}`) ? `loc:bf${at.i}` : null;
    }
    case 'payment': return keys.find((k) => head(k) === 'pay') ?? null;
    case 'location': return has('loc:base') ? 'loc:base' : null;
    case 'showOff': case 'may': case 'optionalCost': return has('no') ? 'no' : null;
    default: return null;
  }
}

export function starterOpponentSeat(): Seat {
  return { k: 'script', answer: starterOpponentAnswer, name: STARTER_OPPONENT_NAME };
}

/** The starter tutorial's game; the human keeps the stacked hand at once. */
export function starterTutorialHost(mine: Starter, ix: CardIndex | undefined, o: Omit<HostOptions, 'setup' | 'seats'> = {}): GameHost {
  const h = new GameHost({ ...o, setup: starterTutorialSetup(mine, ix), seats: [{ k: 'human' }, starterOpponentSeat()] });
  if (h.getSnapshot().view.pending?.kind === 'mulligan') h.commit(['done']);
  return h;
}

// ---- the coach ----

interface Mem {
  done: Set<string>;
  /** The turn each step was first shown. */
  shown: Map<string, number>;
  /** The spell the coach pointed at. */
  spell?: ObjId;
  sawCombat?: boolean;
}
interface Ctx extends CoachContext { mem: Mem }

interface Concept {
  id: string;
  title: string;
  /** Steps that must be done (or expired) first. */
  after?: string[];
  /** An explanation: done when Next is pressed. */
  next?: boolean;
  /** The decision on screen fits the step. */
  ready: (c: Ctx) => boolean;
  /** The step is done; explanations are done by Next. */
  done?: (c: Ctx) => boolean;
  /** From this turn on the step is skipped. */
  expires?: number;
  /** Skipped this many turns after it was first shown (an offer the player may let pass). */
  lingers?: number;
  text: (c: Ctx) => string;
  /** The keys the step teaches; non-priority decisions of a step let everything through. */
  allow?: (key: string, c: Ctx) => boolean;
  /** Highlights only, nothing restricted. */
  soft?: boolean;
  highlight?: (c: Ctx) => CoachHighlight;
  anchor?: CoachStep['anchor'];
}

const kind = (c: Ctx) => c.decision?.kind ?? null;
const window_ = (c: Ctx) => (c.decision?.kind === 'priority' ? c.decision.prompt.window : null);
const myTurn = (c: Ctx) => c.view.turn.player === HUMAN;
const myMain = (c: Ctx) => myTurn(c) && window_(c) === 'main';
const points = (c: Ctx, p: PlayerId) => c.view.players[p].points;
const keys = (c: Ctx) => realKeys(c.decision);
const PAY = (k: string) => head(k) === 'pay' || k === 'loc:base';
const myBase = (c: Ctx) => unitsOf(c.view, HUMAN).filter((id) => whereIs(c.view, id) === 'base');
const myBfs = (c: Ctx) => c.view.bfs.map((b, i) => (b.controller === HUMAN ? i : -1)).filter((i) => i >= 0);
const enemiesAt = (c: Ctx, i: number) => c.view.bfs[i].here.filter((id) => c.view.objects[id]?.controller === OPPONENT
  && isType(defOf(c.view, id), 'unit'));
/** Unit play keys offered for cards in hand. */
const unitPlays = (c: Ctx) => inHandOfType(c.view, HUMAN, 'unit').map((id) => `play:${id}`).filter((k) => keys(c).includes(k));
const spellPlays = (c: Ctx) => inHandOfType(c.view, HUMAN, 'spell').map((id) => `play:${id}`).filter((k) => keys(c).includes(k));
const casting = (c: Ctx) => c.decision !== null && c.decision.kind !== 'priority';
/** The answers to a choice inside a play (targets, modes, a may), the
    sensible ones first: enemies for harm, friends otherwise. */
function choices(c: Ctx): CoachHighlight {
  const d = c.decision;
  if (!d || d.kind === 'priority' || d.kind === 'payment') return {};
  const harm = 'harm' in d.prompt && !!d.prompt.harm;
  const rank = (k: string) => {
    const id = objOfKey(k);
    const o = id === undefined ? undefined : c.view.objects[id];
    return !o ? 1 : (o.controller === OPPONENT) === harm ? 0 : 2;
  };
  const ks = keys(c).filter((k) => k !== 'back' && k !== 'decline').sort((a, b) => rank(a) - rank(b));
  return { keys: ks, objs: ks.map(objOfKey).filter((x): x is number => x !== undefined) };
}
const domains = (def: DefId | null) => (def ? card(def)?.domains ?? [] : []);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listNames = (c: Ctx, ids: ObjId[]) => {
  const names = ids.map((id) => nameOf(defOf(c.view, id)));
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
/** Move steps: the units in base, Done once every one is picked. */
function moveAllow(k: string, c: Ctx, dest: (i: number) => boolean) {
  if (k === 'move') return true;
  if (head(k) === 'loc') return k.startsWith('loc:bf') && dest(Number(k.slice(6)));
  if (kind(c) !== 'moveUnits') return false;
  const fromBase = (key: string) => { const id = objOfKey(key); return id !== undefined && whereIs(c.view, id) === 'base'; };
  if (k === 'done') return !keys(c).some((x) => head(x) === 'u' && fromBase(x));
  return head(k) === 'u' && fromBase(k);
}
function moveHighlight(c: Ctx, dest: number[]): CoachHighlight {
  const base = myBase(c);
  return { keys: ['move', ...base.map((id) => `u:${id}`), 'done', ...dest.map((i) => `loc:bf${i}`)],
    lanes: kind(c) === 'moveDest' ? dest : [], objs: kind(c) === 'moveUnits' ? base : [] };
}
const freeBfs = (c: Ctx) => c.view.bfs.map((_, i) => i).filter((i) => c.view.bfs[i].controller !== HUMAN);
const emptyBfs = (c: Ctx) => freeBfs(c).filter((i) => enemiesAt(c, i).length === 0);

const CONCEPTS: Concept[] = [
  {
    id: 'welcome', title: 'Welcome to Riftbound', next: true, anchor: 'top', ready: () => true,
    text: () => 'This short match teaches you the basics with your own starter deck. Your base is at the bottom, your ' +
      'opponent\'s at the top, and the battlefields are in the middle. Units fight over the battlefields to score ' +
      `points: the first to ${STARTER_TUTORIAL_SCORE} points wins (a normal game goes to 8).`,
    highlight: (c) => ({ lanes: c.view.bfs.map((_, i) => i) }),
  },
  {
    id: 'legend', title: 'Your legend and champion', next: true, anchor: 'top', after: ['welcome'], ready: () => true,
    text: (c) => {
      const p = c.view.players[HUMAN];
      const legend = defOf(c.view, p.legend[0]);
      const ds = domains(legend).map(cap);
      return `Your Legend, ${nameOf(legend)}, sits beside your base${ds.length ? ` and gives your deck its domains: ${ds.join(' and ')}` : ''}. ` +
        `Your Chosen Champion${p.champion === null ? '' : `, ${nameOf(defOf(c.view, p.champion))},`} waits in its own zone; ` +
        'you can play it like any unit from your hand.';
    },
    highlight: (c) => { const p = c.view.players[HUMAN]; return { objs: [...p.legend, ...(p.champion === null ? [] : [p.champion])] }; },
  },
  {
    id: 'runes', title: 'Runes pay for cards', next: true, after: ['legend'], ready: () => true,
    text: () => 'At the start of each turn you channel 2 runes from your rune deck and draw a card. A rune pays 1 ' +
      'Energy when you exhaust it (turn it sideways); a cost with a domain symbol (Power) is paid by recycling a ' +
      'rune of that domain. Your runes ready again next turn.',
    highlight: (c) => ({ objs: c.view.players[HUMAN].base.filter((id) => (defOf(c.view, id) ?? '').endsWith('-rune')) }),
  },
  {
    id: 'play-unit', title: 'Play a unit', after: ['runes'], expires: 3,
    ready: (c) => (myMain(c) && unitPlays(c).length > 0) || (myTurn(c) && casting(c)),
    done: (c) => unitsOf(c.view, HUMAN).length > 0,
    text: (c) => (kind(c) === 'payment' ? 'Pay the cost: exhaust your runes for Energy. Click the payment button.'
      : kind(c) === 'location' ? 'Units are played to your base (or to a battlefield you control). Choose your base.'
        : casting(c) ? 'Your unit asks for a choice: click one of the glowing options.'
          : 'The number in a card\'s corner is its Energy cost. Click a glowing unit in your hand to play it.'),
    allow: (k, c) => unitPlays(c).includes(k) || PAY(k),
    highlight: (c) => (casting(c) && kind(c) !== 'payment' ? choices(c)
      : { objs: unitPlays(c).map((k) => objOfKey(k)!), keys: [...unitPlays(c).slice(0, 1), ...keys(c).filter(PAY)] }),
  },
  {
    id: 'end-turn', title: 'End your turn', after: ['play-unit'], expires: 2,
    ready: (c) => myMain(c) && c.view.turn.n === 1,
    done: (c) => c.view.turn.n >= 2,
    text: () => 'Units enter play exhausted, so your unit can\'t move this turn. End your turn.',
    allow: (k) => k === 'end',
    highlight: () => ({ keys: ['end'] }),
  },
  {
    id: 'their-turn', title: 'Your opponent\'s turn', next: true, after: ['end-turn'], expires: 6,
    ready: (c) => c.view.turn.n >= 3 && myTurn(c),
    text: (c) => {
      const theirs = unitsOf(c.view, OPPONENT);
      return (theirs.length ? `Your opponent played ${listNames(c, theirs)}. ` : '') + 'A unit\'s Might is both how ' +
        'much damage it deals and how much it takes to kill it. New turn: your units and runes are ready again, you ' +
        'channeled 2 more runes and drew a card.';
    },
    highlight: (c) => ({ objs: unitsOf(c.view, OPPONENT) }),
  },
  {
    id: 'move', title: 'Move to a battlefield', after: ['their-turn'], expires: 7,
    ready: (c) => myTurn(c) && ((myMain(c) && keys(c).includes('move') && myBase(c).length > 0)
      || kind(c) === 'moveUnits' || kind(c) === 'moveDest'),
    done: (c) => unitsOf(c.view, HUMAN).some((id) => typeof whereIs(c.view, id) === 'number'),
    text: (c) => (kind(c) === 'moveUnits' ? 'Pick the units in your base to send together, then click Done.'
      : kind(c) === 'moveDest' ? 'Click a battlefield nobody holds to send them there.'
        : 'Your units are ready. Click Move units to send them to a battlefield nobody holds.'),
    allow: (k, c) => moveAllow(k, c, (i) => (emptyBfs(c).length ? emptyBfs(c) : freeBfs(c)).includes(i)),
    highlight: (c) => moveHighlight(c, emptyBfs(c).length ? emptyBfs(c) : freeBfs(c)),
  },
  {
    id: 'showdown', title: 'A showdown', next: true, after: ['move'], expires: 12,
    ready: (c) => window_(c) === 'showdown',
    text: () => 'Units arriving at a battlefield start a showdown: a window where both players, taking turns, may play ' +
      'Actions and Reactions. When everyone passes, a fight starts if both players have units there; otherwise the ' +
      'units take the battlefield. Click Pass when you are done.',
    highlight: () => ({ keys: ['pass'] }),
  },
  {
    id: 'spell', title: 'Cast a spell', after: ['move'], soft: true, expires: 12, lingers: 2,
    ready: (c) => myTurn(c) && (spellPlays(c).length > 0 || (c.mem.spell !== undefined && casting(c))),
    done: (c) => c.mem.spell !== undefined && !c.view.players[HUMAN].hand.includes(c.mem.spell) && !casting(c),
    text: (c) => {
      if (kind(c) === 'payment') return 'Pay for the spell with your runes.';
      if (casting(c)) return 'The spell asks for a choice: click one of the glowing options.';
      const def = defOf(c.view, objOfKey(spellPlays(c)[0]));
      const how = def && hasKw(def, 'reaction') ? 'a Reaction: it can be cast at any time, even in a showdown or in reply to your opponent'
        : def && hasKw(def, 'action') ? 'an Action: it can be cast in your turn and in showdowns' : 'cast in your own turn, when nothing else is going on';
      return `Spells do their thing once, then go to the trash. ${nameOf(def)} is ${how}. Try it now, or keep it for later.`;
    },
    highlight: (c) => (casting(c) && kind(c) !== 'payment' ? choices(c)
      : { keys: [...spellPlays(c).slice(0, 1), ...keys(c).filter(PAY).slice(0, 1)], objs: spellPlays(c).slice(0, 1).map((k) => objOfKey(k)!) }),
  },
  {
    id: 'conquer', title: 'Conquer and score', next: true, after: ['move'], expires: 12,
    ready: (c) => points(c, HUMAN) >= 1 && myBfs(c).length > 0,
    text: (c) => `You took a battlefield: you conquered it and scored 1 point (you have ${points(c, HUMAN)}). Each ` +
      'battlefield can score for you once per turn.',
    highlight: (c) => ({ lanes: myBfs(c) }),
  },
  {
    id: 'hold', title: 'Hold for a point', next: true, after: ['conquer'], expires: 14,
    ready: (c) => myMain(c) && myBfs(c).length > 0 && c.view.turn.n >= 5,
    text: (c) => 'Your turn began with a Hold: every battlefield you still control scores again. Score: you ' +
      `${points(c, HUMAN)}, them ${points(c, OPPONENT)}.`,
    highlight: (c) => ({ lanes: myBfs(c) }),
  },
  {
    id: 'attack', title: 'Attack!', after: ['conquer'], soft: true, expires: 14, lingers: 4,
    ready: (c) => myTurn(c) && !c.mem.sawCombat && c.view.bfs.some((_, i) => enemiesAt(c, i).length > 0)
      && ((myMain(c) && keys(c).includes('move') && myBase(c).length > 0) || kind(c) === 'moveUnits' || kind(c) === 'moveDest'),
    done: (c) => !!c.mem.sawCombat,
    text: (c) => (kind(c) === 'moveUnits' ? 'Pick your units in base, then click Done.'
      : kind(c) === 'moveDest' ? 'Send them to the battlefield where the enemy unit stands.'
        : 'An enemy unit holds a battlefield. Move units there to fight it: when combat starts, each unit deals ' +
          'damage equal to its Might, and the side left standing takes the battlefield.'),
    highlight: (c) => moveHighlight(c, c.view.bfs.map((_, i) => i).filter((i) => enemiesAt(c, i).length > 0)),
  },
  {
    id: 'combat', title: 'Combat', next: true, after: ['move'], expires: 16,
    ready: (c) => c.view.combat !== null && c.decision !== null,
    text: () => 'Combat: every unit deals damage equal to its Might, split among the enemy units (a Tank must be ' +
      'dealt damage first). A unit dealt damage equal to its Might dies. Damage wears off at the end of each turn.',
  },
  {
    id: 'last-point', title: 'One more point', soft: true, after: ['conquer'],
    ready: (c) => myMain(c) && points(c, HUMAN) === STARTER_TUTORIAL_SCORE - 1,
    done: (c) => points(c, HUMAN) >= STARTER_TUTORIAL_SCORE,
    text: () => 'One more point wins. Conquer a battlefield you haven\'t scored this turn, or hold one at the start of ' +
      'your next turn. You decide how from here.',
    highlight: (c) => ({ keys: ['move'], lanes: freeBfs(c) }),
  },
];

/** A hint when no step is on. */
function hint(c: Ctx): CoachStep | null {
  const v = c.view;
  if (v.result) return null;
  const d = c.decision;
  const pts = `You ${points(c, HUMAN)} · them ${points(c, OPPONENT)} · ${STARTER_TUTORIAL_SCORE} to win.`;
  if (!d) return { id: 'hint-wait', title: 'Tutorial', text: `Your opponent is playing. ${pts}` };
  const quiet = keys(c).filter((k) => k === 'pass' || head(k) === 'keep');
  if (d.kind === 'priority' && d.prompt.window === 'main') {
    return { id: 'hint-main', title: 'Your turn', text: 'Play units and spells, move units to a battlefield you don\'t ' +
      `control, then end the turn. ${pts}`, highlight: { keys: unitPlays(c).slice(0, 1), objs: unitPlays(c).slice(0, 1).map((k) => objOfKey(k)!) } };
  }
  if (d.kind === 'priority' && d.prompt.window === 'chain') {
    return { id: 'hint-chain', title: 'Tutorial', text: 'Something is on the chain (shown beside the board). Reply with a ' +
      'Reaction, or click Pass to let it resolve.', highlight: { keys: quiet } };
  }
  if (d.kind === 'priority' && d.prompt.window === 'showdown') {
    return { id: 'hint-showdown', title: 'Showdown', text: 'You may play an Action or a Reaction now, or pass.', highlight: { keys: quiet } };
  }
  if (d.kind === 'moveUnits') return { id: 'hint-move', title: 'Move', text: 'Pick the units to move together, then Done.' };
  if (d.kind !== 'priority' && d.kind !== 'payment' && !d.kind.startsWith('assign')) {
    return { id: 'hint-choice', title: 'Tutorial', text: 'Make a choice: the glowing options are the ones on offer.', highlight: choices(c) };
  }
  return null;
}

function allowFor(s: Concept, c: Ctx): ((key: string) => boolean) | undefined {
  if (!c.decision) return undefined;
  if (s.next) return () => false;                       // read first, then Next
  if (!s.allow || s.soft) return undefined;
  if (c.decision.kind !== 'priority' && c.decision.kind !== 'moveUnits' && c.decision.kind !== 'moveDest'
    && c.decision.kind !== 'payment' && c.decision.kind !== 'location') return undefined;
  const ok = (k: string) => s.allow!(k, c);
  return keys(c).some(ok) ? ok : undefined;              // never stuck
}

export function createStarterCoach(): TutorialCoach {
  const mem: Mem = { done: new Set(), shown: new Map() };
  let at: string | null = null;
  const isDone = (s: Concept, c: Ctx) => {
    if (mem.done.has(s.id)) return true;
    const first = mem.shown.get(s.id);
    const d = (s.expires !== undefined && c.view.turn.n >= s.expires)
      || (s.lingers !== undefined && first !== undefined && c.view.turn.n >= first + s.lingers) || (!s.next && !!s.done?.(c));
    if (d) mem.done.add(s.id);
    return d;
  };
  const pick = (c: Ctx): Concept | null => {
    for (const s of CONCEPTS) {
      if (isDone(s, c)) continue;
      if (s.after && !s.after.every((id) => mem.done.has(id))) continue;
      if (s.ready(c)) return s;
    }
    return null;
  };
  return {
    get free() { return CONCEPTS.every((s) => mem.done.has(s.id) || s.soft); },
    get at() { return at; },
    step(ctx) {
      const c: Ctx = { ...ctx, mem };
      if (ctx.view.result) return null;
      if (ctx.view.combat !== null) mem.sawCombat = true;
      // a spell the coach pointed at, once its cast began
      const s = pick(c);
      if (s && s.id === 'spell' && !casting(c)) mem.spell = objOfKey(spellPlays(c)[0] ?? '') ?? mem.spell;
      at = s?.id ?? null;
      if (!s) return hint(c);
      if (!mem.shown.has(s.id)) mem.shown.set(s.id, ctx.view.turn.n);
      const out: CoachStep = { id: s.id, title: s.title, text: s.text(c), highlight: s.highlight?.(c), anchor: s.anchor };
      if (s.next) out.next = true;
      const allow = allowFor(s, c);
      if (allow) out.allow = allow;
      return out;
    },
    onNext(step) { mem.done.add(step.id); },
  };
}

export const STARTER_LESSON_STEPS = CONCEPTS.map((s) => s.id);
/** The steps every starter's lesson reaches. */
export const STARTER_CORE_STEPS = ['welcome', 'legend', 'runes', 'play-unit', 'end-turn', 'their-turn', 'move', 'conquer'];

export type { Coach };
