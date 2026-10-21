import { describe, expect, it } from 'vitest';
import { K } from '../../src/game/core/decisions.ts';
import {
  choose, createGame, hashState, type Decision, type GameSetup, type GameState, type PlayerId,
} from '../../src/game/index.ts';
import {
  channelCount, drawCount, facedownCapacity, hideCost, maxBuffs, mulliganMax, openingHandSize, turnOrder, victoryScore,
} from '../../src/game/rules/defaults.ts';
import { SetupError } from '../../src/game/rules/setup.ts';
import { checkInvariants, checkSetupDone } from '../../src/game/state/invariants.ts';
import { EVELYNN, SERAPHINE } from './helpers/decks.ts';
import { duel, playOut, randomPicker, scripted } from './helpers/play.ts';

/*
 * Setup, from two deck lists to the start of the first turn (§5.3, Spec A
 * §5.2–5.3, [110–118], [487], TR 406–407), with the two Radiance precons.
 */

const other = (p: PlayerId) => (1 - p) as PlayerId;
const keys = (d: Decision | null) => d?.options.map((o) => o.key) ?? [];
const sets = (d: Decision) => d.options.filter((o) => o.key.startsWith('set:')).map((o) => o.key);
const cardsOf = (s: GameState, ids: number[]) => ids.map((id) => s.objects[id].card);

describe('[110–115] the board before the first decision', () => {
  const { state: s, events } = createGame(duel(11), { check: true });

  it('[111] puts each Champion Legend in its Legend Zone, ready (legendStartsReady)', () => {
    expect(s.players.map((p) => p.legend.map((id) => s.objects[id].def)))
      .toEqual([['seraphine-starry-eyed-songstress'], ['evelynn-agonys-embrace']]);
    expect(s.players.map((p) => s.objects[p.legend[0]].exhausted)).toEqual([false, false]);
    const tired = createGame(duel(11, { rules: { legendStartsReady: false } })).state;
    expect(tired.players.map((p) => tired.objects[p.legend[0]].exhausted)).toEqual([true, true]);
  });

  it('[112] puts the deck\'s Chosen Champion in the Champion Zone, face up, out of its 40', () => {
    expect(s.players.map((p) => s.objects[p.champion!].def)).toEqual(['seraphine-inspiring', 'evelynn-entrancing']);
    expect(s.players.map((p) => s.objects[p.champion!].knownBy)).toEqual([0b11, 0b11]);
    const champions = (p: PlayerId) => s.players[p].deck.filter((id) => s.objects[id].def === 'seraphine-inspiring');
    expect(champions(0)).toHaveLength(1);                          // 2 copies in the list, one in the Champion Zone
    const picked = createGame(duel(11, { chosenChampion: ['seraphine-not-alone'] })).state;
    expect(picked.objects[picked.players[0].champion!].def).toBe('seraphine-not-alone');
    expect(picked.players[0].deck.filter((id) => picked.objects[id].def === 'seraphine-inspiring')).toHaveLength(2);
  });

  it('[113], [487.5] places one random battlefield of each player\'s three, uncontrolled, owned by its provider', () => {
    expect(s.bfs).toHaveLength(2);
    s.bfs.forEach((b, i) => {
      const o = s.objects[b.obj];
      expect(o.owner).toBe(i);
      expect([SERAPHINE, EVELYNN][i].battlefields).toContain(o.def);
      expect([b.controller, o.controller, b.here, b.facedown]).toEqual([null, null, [], []]);
    });
    const seen = [0, 1].map((p) => new Set(Array.from({ length: 30 }, (_, seed) => {
      const g = createGame(duel(seed)).state;
      return g.objects[g.bfs[p].obj].def;
    })));
    expect(seen.map((x) => x.size)).toEqual([3, 3]);                // every one of the three comes up
    expect(events.find((e) => e.k === 'battlefieldsChosen')).toMatchObject({ bfs: s.bfs.map((b) => b.obj), vis: 0b11 });
  });

  it('[114] shuffles each Main Deck (39 left) and Rune Deck: fresh ids in deck order, known to nobody', () => {
    for (const pl of s.players) {
      expect([pl.deck.length, pl.runeDeck.length, pl.hand.length, pl.base.length]).toEqual([39, 12, 0, 0]);
      for (const zone of [pl.deck, pl.runeDeck]) {
        expect(zone).toEqual(zone.slice().sort((a, b) => a - b));   // minted top first, after the shuffle
        expect(zone.every((id) => s.objects[id].knownBy === 0)).toBe(true);
      }
    }
    expect(events.filter((e) => e.k === 'shuffle').map((e) => e.k === 'shuffle' && [e.p, e.zone, e.count]))
      .toEqual([[0, 'deck', 39], [0, 'runeDeck', 12], [1, 'deck', 39], [1, 'runeDeck', 12]]);
    const order = (seed: number) => {
      const g = createGame(duel(seed)).state;
      return g.players[0].deck.map((id) => g.objects[id].def).join();
    };
    expect(order(11)).toBe(order(11));
    expect(order(11)).not.toBe(order(12));
  });

  it('§7: makes the cards in a random order, so a CardRef says nothing about the deck list', () => {
    const byCard = (seed: number) => {
      const g = createGame(duel(seed)).state;
      return [...g.players[0].deck].sort((a, b) => g.objects[a].card - g.objects[b].card).map((id) => g.objects[id].def);
    };
    const list = SERAPHINE.main.flatMap((r) => Array<string>(r.n - (r.def === 'seraphine-inspiring' ? 1 : 0)).fill(r.def));
    expect([...byCard(11)].sort()).toEqual([...list].sort());
    expect(byCard(11)).not.toEqual(list);
    expect(byCard(11)).not.toEqual(byCard(12));
  });

  it('TR 407: a random designated player, who has seen both battlefields, chooses first or second', () => {
    expect(s.pending).toMatchObject({ kind: 'playOrder', ctx: { rule: 'TR 407' }, privateOptions: false });
    expect(keys(s.pending)).toEqual(['first', 'second']);
    expect(events.map((e) => e.k)).toEqual(['gameStart', 'battlefieldsChosen', 'shuffle', 'shuffle', 'shuffle', 'shuffle',
      'deciding']);
    const designees = new Set(Array.from({ length: 20 }, (_, seed) => createGame(duel(seed)).state.pending!.player));
    expect(designees).toEqual(new Set([0, 1]));
  });

  it('records the card set in effect (defsHash) and the deck names', () => {
    expect(s.defsHash).toMatch(/^[0-9a-f]{16}$/);
    expect(s.players.map((p) => p.deckName)).toEqual(['Seraphine Showdown Deck', 'Evelynn Showdown Deck']);
  });

  it('[103.2.b], [133.8.b], [103.3.a.3] reads each identity, champion tag and champion name from the oracle', () => {
    expect(s.players.map((p) => [p.identity, p.championTag, p.chosenChampionName])).toEqual([
      [['mind', 'order'], 'Seraphine', 'Seraphine, Inspiring'],
      [['body', 'chaos'], 'Evelynn', 'Evelynn, Entrancing'],
    ]);
    const alt = createGame(duel(1, { chosenChampion: ['seraphine-not-alone'] })).state;
    expect(alt.players[0].chosenChampionName).toBe('Seraphine, Not Alone');
  });
});

describe('[115] turn order', () => {
  it.each([['first', 0], ['second', 1]] as const)('TR 407: answering %s', (key, offset) => {
    const r = createGame(duel(5), { check: true });
    const designee = r.state.pending!.player;
    const after = choose(r.state, { decision: r.state.pending!.id, key }, { check: true });
    const first = (offset === 0 ? designee : other(designee));
    const t = after.state.turn;
    expect([t.firstPlayer, t.player, t.queue]).toEqual([first, first,
      [{ player: first, additional: false }, { player: other(first), additional: false }]]);
    expect(after.events[0]).toMatchObject({ k: 'playOrder', first, vis: 0b11 });
    expect(turnOrder(after.state)).toEqual([first, other(first)]);
  });

  it('uses a First Player fixed by the setup, or a random one, without asking', () => {
    for (const p of [0, 1] as const) {
      const r = createGame(duel(5, { firstPlayer: p }), { check: true });
      expect(r.state.turn.firstPlayer).toBe(p);
      expect(r.state.pending).toMatchObject({ kind: 'mulligan', player: p });
    }
    const random = new Set(Array.from({ length: 20 }, (_, seed) => {
      const r = createGame(duel(seed, { rules: { firstPlayer: 'random' } }), { check: true });
      expect(r.state.pending?.kind).toBe('mulligan');
      return r.state.turn.firstPlayer;
    }));
    expect(random).toEqual(new Set([0, 1]));
  });
});

describe('[116–117] opening hands and mulligans', () => {
  const start = () => {
    const r = createGame(duel(9, { firstPlayer: 1 }), { check: true });
    return r;
  };

  it('[116] draws 4 for each player; each player sees only their own', () => {
    const { state: s, events } = start();
    expect(s.players.map((p) => p.hand.length)).toEqual([4, 4]);
    expect(s.players.map((p) => p.deck.length)).toEqual([35, 35]);
    for (const pl of s.players) expect(pl.hand.map((id) => s.objects[id].knownBy)).toEqual([1, 1, 1, 1].map(() => 1 << pl.id));
    const draws = events.filter((e) => e.k === 'zone');
    expect(draws.map((e) => e.vis)).toEqual([0b10, 0b10, 0b10, 0b10, 0b01, 0b01, 0b01, 0b01]);   // turn order: P1 first
    expect(new Set(draws.map((e) => e.group)).size).toBe(1);                                    // drawn at the same time
  });

  it('[117] asks the First Player first, one card at a time, privately, up to 2', () => {
    const { state: s } = start();
    const d1 = s.pending!;
    expect(d1).toMatchObject({ player: 1, kind: 'mulligan', batch: 'mulligan:p1', privateOptions: true,
      ctx: { rule: '117' } });
    expect(keys(d1)).toEqual([...s.players[1].hand.map((id) => K.set(id)), 'done']);
    const s2 = choose(s, { decision: d1.id, key: sets(d1)[2] }, { check: true }).state;
    const d2 = s2.pending!;
    expect(d2).toMatchObject({ player: 1, kind: 'mulligan', batch: 'mulligan:p1' });
    expect(sets(d2)).toEqual(sets(d1).filter((k) => k !== sets(d1)[2]));
    const r3 = choose(s2, { decision: d2.id, key: sets(d2)[0] }, { check: true });
    expect(r3.state.pending).toMatchObject({ player: 0, kind: 'mulligan', batch: 'mulligan:p0' });   // the third pick isn't asked
    expect(r3.events.find((e) => e.k === 'mulligan')).toMatchObject({ p: 1, n: 2, vis: 0b11 });
  });

  it('[117.1–117.3] draws as many as were set aside, then recycles them to the bottom, never redrawn', () => {
    const { state: s } = start();
    const set = s.players[1].hand.slice(1, 3);
    const keep = s.players[1].hand.filter((id) => !set.includes(id));
    const g = playOut(duel(9, { firstPlayer: 1 }), scripted([K.set(set[0]), K.set(set[1]), K.done]));
    const e = g.end;
    const hand = e.players[1].hand;
    expect(hand).toHaveLength(4);
    expect(cardsOf(e, hand.slice(0, 2))).toEqual(cardsOf(s, keep));                 // kept cards keep their place
    expect(cardsOf(e, hand.slice(2))).toEqual(cardsOf(s, s.players[1].deck.slice(0, 2)));   // the next two of the deck
    const bottom = e.players[1].deck.slice(-2);
    expect(new Set(cardsOf(e, bottom))).toEqual(new Set(cardsOf(s, set)));
    expect(bottom.map((id) => e.objects[id].knownBy)).toEqual([0, 0]);                // random order [417.5]: nobody knows
    expect(bottom.every((id) => id > Math.max(...hand))).toBe(true);                 // new ids, minted after the draws
    expect(checkSetupDone(e)).toEqual([]);
  });

  it('[417.5] puts two recycled cards in an order the RNG decides', () => {
    const orders = new Set(Array.from({ length: 12 }, (_, seed) => {
      const s = createGame(duel(seed, { firstPlayer: 0 })).state;
      const set = s.players[0].hand.slice(0, 2);
      const g = playOut(duel(seed, { firstPlayer: 0 }), scripted([K.set(set[0]), K.set(set[1]), K.done]));
      return g.end.players[0].deck.slice(-2).map((id) => g.end.objects[id].card)
        .map((c) => cardsOf(s, set).indexOf(c)).join();
    }));
    expect(orders).toEqual(new Set(['0,1', '1,0']));
  });

  it('[117.3] a single recycled card goes to a known position: its owner still knows it', () => {
    const { state: s } = start();
    const card = s.players[1].hand[0];
    const g = playOut(duel(9, { firstPlayer: 1 }), scripted([K.set(card), K.done, K.done]));
    const bottom = g.end.players[1].deck.at(-1)!;
    expect(g.end.objects[bottom]).toMatchObject({ card: s.objects[card].card, knownBy: 0b10 });
    expect(g.end.players[0].hand.map((id) => g.end.objects[id].card)).toEqual(cardsOf(s, s.players[0].hand));   // P0 kept
  });
});

describe('[118] setup ends at the start of the first turn (Spec A §5.3)', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i))('random setup %i satisfies every setup invariant', (seed) => {
    const g = playOut(duel(seed), randomPicker(seed * 7 + 1));
    const s = g.end;
    expect(checkSetupDone(s)).toEqual([]);
    expect(checkInvariants(s)).toEqual([]);
    expect([s.pending, s.result, s.frames, s.chain, s.turn.n, s.turn.phase]).toEqual([null, null, [], [], 0, 'setup']);
    expect(g.steps.map((st) => st.decision.kind).slice(0, 1)).toEqual(['playOrder']);
    expect(g.steps.length).toBeGreaterThanOrEqual(3);                 // play order + at least one answer per mulligan
    expect(g.steps.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic: the same seed and answers give the same state at every step, through JSON copies (P11)', () => {
    const run = (o: { roundTrip?: boolean } = {}) => {
      const g = playOut(duel(21), randomPicker(4), o);
      return [g.start.state, ...g.steps.map((st) => st.after.state)].map(hashState);
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(run({ roundTrip: true })).toEqual(a);
    expect(playOut(duel(22), randomPicker(4)).end).not.toEqual(playOut(duel(21), randomPicker(4)).end);
  });

  it('refuses decks setup can\'t build a board from, naming every problem', () => {
    const short = { ...SERAPHINE, main: SERAPHINE.main.slice(1) };
    const noChampion = { ...EVELYNN, chosenChampion: 'evelynn-not-in-deck', championOptions: undefined };
    const err = (() => { try { createGame(duel(1, { decks: [short, noChampion] })); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(SetupError);
    expect((err as SetupError).issues).toEqual([
      "P0 'Seraphine Showdown Deck': 39 Main Deck cards, exactly 40 needed [103.3], TR 402.1",
      "P1 'Evelynn Showdown Deck': Chosen Champion evelynn-not-in-deck is not in the Main Deck [103.3.a], TR 402.1",
    ]);
    const unknown = { ...SERAPHINE, main: [...SERAPHINE.main.slice(0, -1), { def: 'moonlight-afliction', n: 1 }] };
    expect(() => createGame(duel(1, { decks: [unknown, EVELYNN] }))).toThrow(/not cards in the oracle: moonlight-afliction/);
    expect(() => createGame(duel(1, { chosenChampion: [undefined, 'ksante-courageous'] }))).toThrow(/Champion Options/);
    const runes = { ...EVELYNN, runes: [{ def: 'body-rune', n: 11 }] };
    expect(() => createGame(duel(1, { decks: [SERAPHINE, runes] }))).toThrow(/11 runes, 12 needed/);
    const twice = { ...SERAPHINE, battlefields: ['valley-of-idols', 'valley-of-idols', 'ruined-monastery'] };
    expect(() => createGame(duel(1, { decks: [twice, EVELYNN] }))).toThrow(/share a name/);
  });

  it('[103.2], [103.3.a.2], [133.4] refuses cards a zone can\'t hold, and a First Player who isn\'t playing', () => {
    const issues = (setup: GameSetup) => {
      try { createGame(setup); } catch (e) { if (e instanceof SetupError) return e.issues; throw e; }
      return [];
    };
    const free = { ...SERAPHINE, championOptions: undefined };
    expect(issues(duel(1, { decks: [free, EVELYNN], chosenChampion: ['encore'] }))).toEqual([
      "P0 'Seraphine Showdown Deck': Chosen Champion encore is not a champion unit with the legend's champion tag "
        + '[103.3.a.2]',
    ]);
    expect(issues(duel(1, { decks: [free, EVELYNN], chosenChampion: ['heimerdinger-academy-instructor'] })))
      .toEqual([expect.stringMatching(/heimerdinger-academy-instructor is not a champion unit with the legend's/)]);
    expect(issues(duel(1, { decks: [{ ...SERAPHINE, legend: 'hunting-dog' }, EVELYNN] })))
      .toEqual(["P0 'Seraphine Showdown Deck': hunting-dog is not a legend [103.2]"]);
    const misplaced = {
      ...EVELYNN, main: [...EVELYNN.main.slice(0, -1), { def: 'body-rune', n: 2 }],
      runes: [{ def: 'pakaa-cub', n: 12 }], battlefields: ['bandle-tree', 'rakelstake', 'sirens-song'],
    };
    expect(issues(duel(1, { decks: [SERAPHINE, misplaced] }))).toEqual([
      "P1 'Evelynn Showdown Deck': not units, gear or spells in the Main Deck: body-rune [133.4]",
      "P1 'Evelynn Showdown Deck': not runes in the Rune Deck: pakaa-cub [103.4.a]",
      "P1 'Evelynn Showdown Deck': not battlefields: sirens-song [103.5]",
    ]);
    expect(issues(duel(1, { firstPlayer: 2 as PlayerId }))).toEqual(['the First Player P2 is not in the game [115]']);
  });

  it('[112] takes the Chosen Champion out of the 40 once, even from a list that names it on two rows', () => {
    const rows = SERAPHINE.main.flatMap((r) => (r.def === 'seraphine-inspiring' ? [{ ...r, n: 1 }, { ...r, n: 1 }] : [r]));
    const s = playOut(duel(1, { decks: [{ ...SERAPHINE, main: rows }, EVELYNN] }), randomPicker(1)).end;
    expect(checkSetupDone(s)).toEqual([]);
    const rest = [...s.players[0].deck, ...s.players[0].hand].map((id) => s.objects[id].def);
    expect(rest.filter((def) => def === 'seraphine-inspiring')).toHaveLength(1);
  });

  it('takes a deck of more than 40 when the rules allow it (deckSize atLeast40)', () => {
    const big = { ...SERAPHINE, main: [...SERAPHINE.main, { def: 'hunting-dog', n: 1 }] };
    expect(() => createGame(duel(1, { decks: [big, EVELYNN] }))).toThrow(SetupError);
    const g = playOut(duel(1, { decks: [big, EVELYNN], rules: { deckSize: 'atLeast40' } }), randomPicker(1));
    expect(g.end.players[0].deck).toHaveLength(36);
    expect(checkSetupDone(g.end)).toEqual([]);
  });
});

describe('rules defaults as queries (P13, §3.12)', () => {
  it('answers the printed rules in a Duel', () => {
    const s = playOut(duel(3, { firstPlayer: 1 }), randomPicker(3)).end;
    expect([victoryScore(s), openingHandSize(s, 0), mulliganMax(s, 0), drawCount(s, 0), facedownCapacity(s, 0, 0),
      maxBuffs(s, 1), hideCost(s, 0, 1)]).toEqual([8, 4, 2, 1, 1, 1, { energy: 0, power: [{ k: 'any' }], other: [],
      components: [] }]);
    expect(turnOrder(s)).toEqual([1, 0]);
    expect([channelCount(s, 1), channelCount(s, 0)]).toEqual([2, 3]);    // the second player's first channel [487.7]
  });
});
