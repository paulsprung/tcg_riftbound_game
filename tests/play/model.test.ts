import '../game/helpers/setupOnly.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import {
  choose, createGame, observe, parseKey, viewFor, type Decision, type GameState, type ObservedEvent, type PlayerId,
} from '../../src/game/index.ts';
import { ORACLE } from '../../src/game/cards/oracle.ts';
import { PRECONS } from '../../src/game/decks/precons.ts';
import { STARTERS } from '../../src/game/decks/starters.ts';
import { BUILT_IN_DECKS, deckIssues, deckProblems, withChampion } from '../../src/play/host/decks.ts';
import { affordances, promptText } from '../../src/play/model/affordances.ts';
import { boardOf } from '../../src/play/model/board.ts';
import {
  cardFor, cardIndex, displayText, isRune, nameOf, textOf, withPrintings,
} from '../../src/play/model/cards.ts';
import {
  describeAll, listOf, orderText, setAsideText, waitingText, whereText,
} from '../../src/play/model/describe.ts';
import { gameSetup } from '../../src/play/model/setup.ts';
import { setupSummary, stageOf } from '../../src/play/model/stage.ts';

/*
 * The Play screen's pure helpers (§12, §14.10): the card index, the board
 * model, affordances, the stage of setup and the log, on real setups
 * between the two built-in decks.
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const [SERAPHINE, EVELYNN] = (['seraphine', 'evelynn'] as const).map((id) => BUILT_IN_DECKS.find((b) => b.id === id)!.deck);

const setupFor = (seed: number, order: 'random' | 'first' | 'second' = 'random') =>
  gameSetup({ human: 0, mine: SERAPHINE, theirs: EVELYNN, champion: SERAPHINE.chosenChampion, order, seed }, ix);

/** Plays setup out, answering with `pick`, and keeps every state and the
    events each player observed. */
function playOut(seed: number, pick: (d: Decision) => string, order: 'random' | 'first' | 'second' = 'random') {
  const first = createGame(setupFor(seed, order), { check: true });
  let s: GameState = first.state;
  const states = [s];
  const seen: Record<PlayerId, ObservedEvent[]> = { 0: observe(first.events, 0), 1: observe(first.events, 1) };
  while (s.pending) {
    const r = choose(s, { decision: s.pending.id, key: pick(s.pending) }, { check: true });
    s = r.state;
    states.push(s);
    for (const p of [0, 1] as const) seen[p].push(...observe(r.events, p));
  }
  return { states, seen, end: s };
}

const firstOption = (d: Decision) => d.options[0].key;

describe('card index (the oracle\'s names, wording and printings)', () => {
  it('finds a printing for every card the built-in decks name', () => {
    for (const { deck } of BUILT_IN_DECKS) {
      const defs = [deck.legend, ...deck.main.map((e) => e.def), ...deck.runes.map((e) => e.def), ...deck.battlefields];
      expect(defs.filter((d) => !cardFor(ix, d)), deck.name).toEqual([]);
    }
  });

  it('finds every card of the oracle, and shows one of the oracle\'s own printings', () => {
    const off = ORACLE.cards.filter((c) => !c.printings.includes(cardFor(ix, c.id)?.id ?? '')).map((c) => c.id);
    expect(off).toEqual([]);
  });

  it('names legends with their champion tag, as the canonical name does [132]', () => {
    expect(nameOf(ix, 'seraphine-starry-eyed-songstress')).toBe('Seraphine, Starry-Eyed Songstress');
    expect(cardFor(ix, 'seraphine-starry-eyed-songstress')?.name).toBe('Seraphine, Starry-Eyed Songstress');
    expect(nameOf(ix, 'ksante-courageous')).toBe("K'Sante, Courageous");
    expect(nameOf(ix, 'annie-dark-child')).toBe('Annie, Dark Child');        // ", Starter" and promo spellings folded
    expect(nameOf(ix, 'bullet-time')).toBe('Bullet Time');                    // Signature cards lose ", Miss Fortune"
    expect(nameOf(ix, 'not-a-card')).toBe('Not A Card');
  });

  it('shows the newest main-set base printing first', () => {
    expect(cardFor(ix, 'mind-rune')?.id).toBe('rad-r03');
    expect(cardFor(ix, 'seraphine-inspiring')?.variant).toBe('base');
    expect(isRune('order-rune')).toBe(true);
    expect(isRune('encore')).toBe(false);
  });

  it('gives a deck a printing for each card, keeping the ones it names', () => {
    const d = withPrintings({ ...SERAPHINE, printings: { encore: ['x-1'] } }, ix);
    expect(d.printings?.encore).toEqual(['x-1']);
    expect(d.printings?.['valley-of-idols']).toEqual([cardFor(ix, 'valley-of-idols')!.id]);
    expect(SERAPHINE.printings).toBeUndefined();                      // the original is untouched
  });

  it('the built-in decks are the engine\'s precons', () => {
    // every official starter, grouped by product, the Radiance precons among them
    expect(BUILT_IN_DECKS.map((b) => [b.id, b.deck])).toEqual(STARTERS.map((p) => [p.id, p.deck]));
    expect(BUILT_IN_DECKS).toHaveLength(13);
    for (const p of PRECONS) expect(BUILT_IN_DECKS.find((b) => b.id === p.id)!.deck).toBe(p.deck);
  });

  it('checks the decks with the engine\'s validator, with the Chosen Champion picked', () => {
    // only warnings: the Proving Grounds decks' single battlefield, cards banned since a box was printed
    for (const b of BUILT_IN_DECKS) {
      expect(deckIssues(b.deck).filter((i) => i.severity !== 'warning'), b.id).toEqual([]);
      expect(deckProblems(b.deck), b.id).toEqual([]);
      for (const c of b.deck.championOptions ?? []) expect(deckProblems(b.deck, c), `${b.id} ${c}`).toEqual([]);
    }
    expect(deckIssues(SERAPHINE)).toEqual([]);
    expect(deckIssues(BUILT_IN_DECKS.find((b) => b.set === 'ogs')!.deck).map((i) => i.code)).toEqual(['battlefields']);
    expect(deckProblems({ ...SERAPHINE, runes: [] })).toEqual(['the Rune Deck has 0 runes; it needs 12 ([103.4.a])']);
    expect(deckProblems(SERAPHINE, 'heimerdinger-academy-instructor')).toEqual([
      'Heimerdinger, Academy Instructor does not have the Seraphine champion tag ([103.3.a.2])',
      'the Chosen Champion must be one of the champion options ([103.3.a])',
    ]);
    expect(deckProblems({ ...SERAPHINE, main: SERAPHINE.main.slice(1) })[0]).toMatch(/39 cards.*\(TR 601\.1\.b\)/);
    expect(withChampion(SERAPHINE)).toBe(SERAPHINE);
    expect(withChampion(SERAPHINE, 'seraphine-not-alone').chosenChampion).toBe('seraphine-not-alone');
  });

  it('shows the oracle\'s wording, in the symbols the rules text draws', () => {
    expect(textOf('rousing-display')).not.toMatch(/disa/);              // the override row's fix
    expect(textOf('rousing-display')).toContain('two 1 :rb_might: Recruit unit tokens');
    expect(textOf('mind-rune')).toBe('[Reaction][>] :rb_exhaust:: Add :rb_energy_1:.\n'
      + '[Reaction][>] Recycle this: Add :rb_rune_mind:.');
    expect(displayText({ text: '[A][C][R][G][B][O][P][Y] [12] [Legion][>>] [Level 6]', domains: ['mind', 'order'] }))
      .toBe(':rb_rune_rainbow::rb_rune_rainbow::rb_rune_fury::rb_rune_calm::rb_rune_mind::rb_rune_body:'
        + ':rb_rune_chaos::rb_rune_order: :rb_energy_12: [Legion][>] [Level 6]');
    expect(textOf('gold')).toBe('[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.');   // a token [187.5]
    expect(textOf('not-a-card')).toBeNull();
    const errata = ORACLE.cards.filter((c) => c.source === 'errata');
    expect(errata.length).toBeGreaterThan(0);
    expect(errata.filter((c) => /\[(\d+|[A-Z]|>>)\]/.test(textOf(c.id)!)).map((c) => c.id)).toEqual([]);
  });

  it('finds art for tokens from the oracle\'s token art', () => {
    expect(cardFor(ix, 'recruit')?.id).toBe(ORACLE.tokenArt.recruit[0]);
    expect(cardFor(ix, 'recruit')?.name).toBe('Recruit');               // a single face, not a double-faced record
    expect(nameOf(ix, 'sandSoldier')).toBe('Sand Soldier');
    expect(cardFor(ix, 'tentacle')?.name).toBe('Tentacle');
  });
});

describe('gameSetup', () => {
  it('seats the human, names their champion and fixes the order when asked', () => {
    const s = gameSetup({ human: 1, mine: SERAPHINE, theirs: EVELYNN, champion: 'seraphine-not-alone', order: 'second',
      seed: 7 }, ix);
    expect(s.decks.map((d) => d.legend)).toEqual(['evelynn-agonys-embrace', 'seraphine-starry-eyed-songstress']);
    expect(s.chosenChampion).toEqual([undefined, 'seraphine-not-alone']);
    expect(s.firstPlayer).toBe(0);
    expect(setupFor(1).firstPlayer).toBeUndefined();                // TR 407 by default
  });

  it('gives every object its printing', () => {
    const s = createGame(setupFor(3)).state;
    expect(Object.values(s.objects).filter((o) => o.printing === null).map((o) => o.def)).toEqual([]);
  });
});

describe('boardOf', () => {
  const g = playOut(21, firstOption, 'first');
  const v = viewFor(g.end, 0);
  const b = boardOf(v, isRune);

  it('puts the viewer at the bottom and hides the opponent\'s hand', () => {
    expect(b.me.p).toBe(0);
    expect(b.opponent.p).toBe(1);
    expect(b.me.hand.every((c) => c.def !== null)).toBe(true);
    expect(b.opponent.hand).toHaveLength(4);
    expect(b.opponent.hand.every((c) => c.def === null && c.id < 0)).toBe(true);
  });

  it('shows legends, champions, battlefields and the deck counts of a finished setup (Spec A §5.3)', () => {
    for (const side of [b.me, b.opponent]) {
      expect(side.legend).toHaveLength(1);
      expect(side.champion?.def).toBeTruthy();
      expect([side.hand.length, side.deck, side.runeDeck, side.base.length, side.runes.length]).toEqual([4, 35, 12, 0, 0]);
    }
    expect(b.me.legend[0].def).toBe('seraphine-starry-eyed-songstress');
    expect(b.lanes.map((l) => [l.owner, l.controller, l.mine.length, l.theirs.length])).toEqual([[0, null, 0, 0],
      [1, null, 0, 0]]);
    expect(b.lanes.every((l) => l.card.def !== null && l.card.printing !== null)).toBe(true);
    expect([b.me.first, b.opponent.first, b.turn, b.phase]).toEqual([true, false, 0, 'setup']);
  });

  it('is the same board for the same view', () => {
    expect(boardOf(viewFor(g.end, 0), isRune)).toEqual(b);
    const theirs = boardOf(viewFor(g.end, 1));
    expect(theirs.me.p).toBe(1);
    expect(theirs.opponent.hand.every((c) => c.def === null)).toBe(true);
  });

  it('leaves the turn order open until it is chosen', () => {
    const s = createGame(setupFor(4)).state;
    const board = boardOf(viewFor(s, 0));
    expect([board.me.first, board.opponent.first]).toEqual([null, null]);
  });
});

describe('affordances (§12.5)', () => {
  /** Every key an affordance sends is an option of the decision it came from. */
  function checkKeys(d: Decision, draft: string[] = []) {
    const a = affordances(viewFor(stateWith(d), d.player), d, draft);
    const keys = d.options.map((o) => o.key);
    for (const o of Object.values(a.objects)) for (const k of o.keys) expect(keys).toContain(k);
    for (const btn of a.buttons) {
      expect(btn.commit.slice(0, draft.length)).toEqual(draft);
      if (btn.key !== null) expect(keys).toContain(btn.key);
    }
    return a;
  }
  let current: GameState;
  const stateWith = (d: Decision) => {
    if (current.pending?.id !== d.id) throw new Error('stale');
    return current;
  };

  it('offers only option keys, at every decision of several setups', () => {
    for (const seed of [31, 32, 33]) {
      const g = playOut(seed, (d) => d.options[Math.floor(d.options.length / 2)].key);
      for (const s of g.states) {
        if (!s.pending) continue;
        current = s;
        checkKeys(s.pending);
      }
    }
  });

  it('play order: two buttons, Play first primary', () => {
    current = createGame(setupFor(5)).state;
    const d = current.pending!;
    expect(d.kind).toBe('playOrder');
    const a = checkKeys(d);
    expect(a.buttons.map((x) => [x.key, x.label, !!x.primary])).toEqual([['first', 'Play first', true],
      ['second', 'Play second', false]]);
    expect(a.prompt).toBe(promptText(d));
    expect(a.rule).toBe('TR 407');
  });

  it('mulligan: hand cards toggle, the draft shows as selected, Confirm sends the draft', () => {
    current = createGame(setupFor(6, 'first')).state;
    const d = current.pending!;
    expect(d.kind).toBe('mulligan');
    const a = checkKeys(d);
    const hand = current.players[0].hand;
    expect(Object.keys(a.objects).map(Number).sort()).toEqual([...hand].sort());
    expect(Object.values(a.objects).every((o) => o.style === 'toggle')).toBe(true);
    expect(a.buttons.map((x) => x.label)).toEqual(['Keep my hand']);

    const pick = `set:${hand[0]}`;
    const next = choose(current, { decision: d.id, key: pick }).state;
    current = next;
    const b = affordances(viewFor(next, 0), next.pending, [pick], d);
    expect(b.objects[hand[0]]).toEqual({ keys: [], style: 'toggle', selected: true });
    expect(b.buttons.map((x) => [x.label, x.commit])).toEqual([['Set aside 1', [pick, 'done']]]);

    const done = affordances(viewFor(next, 0), null, [pick, `set:${hand[1]}`], d);
    expect(done.buttons.map((x) => [x.key, x.label, x.commit])).toEqual([[null, 'Set aside 2',
      [pick, `set:${hand[1]}`]]]);
    expect(done.prompt).toBe(promptText(d));
  });

  it('refuses a decision that is not the viewer\'s', () => {
    current = createGame(setupFor(6, 'first')).state;
    expect(() => affordances(viewFor(current, 1), current.pending, [])).toThrow(/not the viewer/);
  });
});

describe('stage and setup summary', () => {
  it('follows setup: order, mulligans in turn order, then ready', () => {
    const g = playOut(41, firstOption);
    const stages = g.states.map((s) => stageOf(viewFor(s, 0)).k);
    expect(stages[0]).toBe('order');
    expect(stages.at(-1)).toBe('ready');
    expect([...new Set(stages)]).toEqual(['order', 'mulligan', 'ready']);
    const v1 = viewFor(g.states[0], 1);
    const st = stageOf(v1);
    expect(st.k === 'order' && st.decider === g.states[0].pending!.player && st.mine === (st.decider === 1)).toBe(true);
  });

  it('sums up who chose, who is first and how many cards were set aside', () => {
    const g = playOut(42, firstOption);
    const designee = g.states[0].pending!.player;
    for (const p of [0, 1] as const) {
      const sum = setupSummary(g.seen[p]);
      expect(sum.designee).toBe(designee);
      expect(sum.first).toBe(g.end.turn.firstPlayer);
      expect(sum.setAside).toEqual({ 0: 2, 1: 2 });                  // first option = set aside, twice
    }
    expect(setupSummary(playOut(43, firstOption, 'first').seen[0]).designee).toBeNull();
  });
});

describe('describeAll: the log (§12.7)', () => {
  const ctxFor = (s: GameState, me: PlayerId) => {
    const v = viewFor(s, me);
    return {
      me, nameOf: (d: string) => nameOf(ix, d),
      objOf: (id: number) => {
        const o = v.objects[id];
        return o ? { def: 'def' in o ? o.def : null, owner: o.owner } : null;
      },
    };
  };

  it('tells setup in order, with the viewer\'s own cards by name and the opponent\'s as counts', () => {
    const g = playOut(51, (d) => (d.kind === 'mulligan' && d.player === 0 && d.options.length > 4 ? d.options[0].key
      : d.kind === 'mulligan' ? 'done' : 'first'), 'first');
    const lines = describeAll(g.seen[0], ctxFor(g.end, 0)).map((l) => l.text);
    expect(lines[0]).toBe('The game begins.');
    expect(lines[1]).toMatch(/^Battlefields this game: .+ \(yours\) and .+ \(the opponent's\)\.$/);
    expect(lines).toContain('You shuffle your Main Deck (39 cards) and Rune Deck (12 cards).');
    expect(lines).toContain('The opponent shuffles their Main Deck (39 cards) and Rune Deck (12 cards).');
    expect(lines).toContain('You play first.');
    expect(lines).toContain('The opponent draws 4 cards.');
    expect(lines).toContain('You set aside 1 card.');
    expect(lines).toContain('The opponent keeps their hand.');
    const draw = lines.find((l) => l.startsWith('You draw') && l.includes(','))!;
    expect(draw).toMatch(/^You draw [^,]+, [^,]+, [^,]+ and .+\.$/);
    expect(lines.find((l) => l.startsWith('You put'))).toMatch(/^You put .+ on the bottom of your Main Deck\.$/);
  });

  it('never names a card the viewer could not see', () => {
    const g = playOut(52, firstOption, 'first');
    const theirHand = g.end.players[1].hand.map((id) => nameOf(ix, g.end.objects[id].def));
    const mine = new Set(g.end.players[0].hand.map((id) => nameOf(ix, g.end.objects[id].def)));
    const text = describeAll(g.seen[0], ctxFor(g.end, 0)).map((l) => l.text).join('\n');
    for (const name of theirHand) if (!mine.has(name)) expect(text).not.toContain(name);
    expect(text).toContain('The opponent puts 2 cards on the bottom of their Main Deck in random order.');
  });

  it('says how the order was settled and how each mulligan went', () => {
    expect(orderText({ designee: 1, first: 1, setAside: {} }, 0)).toMatch(/opponent was picked .* plays first/);
    expect(orderText({ designee: 1, first: 0, setAside: {} }, 0)).toMatch(/lets you play first/);
    expect(orderText({ designee: 0, first: 1, setAside: {} }, 0)).toBe('You chose to play second.');
    expect(orderText({ designee: null, first: 0, setAside: {} }, 0)).toBe('You play first, as set for this game.');
    expect(orderText({ designee: null, first: null, setAside: {} }, 0)).toBe('');
    const sum = { designee: null, first: 0 as const, setAside: { 0: 2, 1: 0 } };
    expect([setAsideText(sum, 0, 0), setAsideText(sum, 1, 0)]).toEqual(['You set aside 2 cards and drew 2 new.',
      'The opponent kept their hand.']);
    expect(setAsideText({ ...sum, setAside: {} }, 1, 0)).toBeNull();
  });

  it('says where a card is, from the viewer\'s side', () => {
    const s = createGame(setupFor(53, 'first')).state;
    const v = viewFor(s, 0);
    expect(whereText(v, v.players[0].hand[0])).toBe('Your hand');
    expect(whereText(v, v.players[1].champion!)).toBe("Opponent's Champion Zone");
    expect(whereText(v, v.bfs[0].obj)).toBe('Battlefield');
    expect(whereText(v, 999999)).toBe('');
  });

  it('words lists and waiting', () => {
    expect([listOf([]), listOf(['A']), listOf(['A', 'B']), listOf(['A', 'B', 'C'])]).toEqual(['', 'A', 'A and B',
      'A, B and C']);
    expect(waitingText({ player: 1, kind: 'mulligan', ctx: { rule: '117' } })).toMatch(/set aside/);
  });
});

describe('option keys stay parseable', () => {
  it('mulligan keys name the viewer\'s own hand cards', () => {
    const s = createGame(setupFor(61, 'first')).state;
    const v = viewFor(s, 0);
    const objs = v.pending!.options.map((o) => parseKey(o.key)!.obj).filter((o) => o !== undefined);
    expect(objs.sort()).toEqual([...v.players[0].hand].sort());
  });
});

describe('the deck choice (DeckSetup)', () => {
  it('offers every starter grouped by product, and starts from the one the player owns', async () => {
    const { DECK_GROUPS } = await import('../../src/play/host/decks.ts');
    const { choiceFor, DEFAULT_CHOICE } = await import('../../src/play/setup/DeckSetup.tsx');
    expect(DECK_GROUPS.map((g) => [g.set, g.decks.length])).toEqual([['ogs', 4], ['ogn', 3], ['sfd', 2], ['unl', 2], ['rad', 2]]);
    expect(choiceFor(null)).toEqual(DEFAULT_CHOICE);
    expect(choiceFor('not-a-starter')).toEqual(DEFAULT_CHOICE);
    for (const b of BUILT_IN_DECKS) {
      const c = choiceFor(b.id);
      expect(c.mine).toBe(b.id);
      expect(c.champion).toBe(b.deck.chosenChampion);
      expect(BUILT_IN_DECKS.find((x) => x.id === c.theirs)!.set).not.toBe(b.set);
    }
  });
});
