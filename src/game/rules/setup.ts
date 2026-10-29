/*
 * Setup: from two deck lists to the start of the first turn (§5.3, Spec A
 * §5.2, [110–118], the 1v1 Duel [487], Tournament Rules 406–407).
 *
 *   [111]  each Champion Legend to its Legend Zone, ready (legendStartsReady)
 *   [112]  each Chosen Champion to its Champion Zone, face up [108.3.e]
 *   [113]  one of each player's three battlefields at random, both placed at
 *          once, uncontrolled [487.5]; the others are not used this game
 *   [114]  Main Deck and Rune Deck shuffled separately, every card a new id
 *   [115]  turn order: a random designated player sees both battlefields and
 *          chooses to play first or second (TR 407, TR 406.1.h)
 *   [116]  each player draws 4
 *   [117]  in turn order, each player sets aside up to 2 cards, draws that
 *          many, then recycles the set-aside cards (random order if 2)
 *   [118]  stop: the First Player's turn begins with its Awaken Phase, which
 *          M1's master loop starts (turn.n is still 0, phase 'setup')
 *
 * The steps without a decision run at once when the game is created. The
 * ones with a decision are the setup frame's step table below. The Chosen
 * Champion is the deck's own unless GameSetup names another of its Champion
 * Options; it is picked with the deck, so setup asks nothing about it.
 *
 * Battlefields come before the Chosen Champion here, in TR 406.1.h order;
 * the order of steps 1–5 makes no difference to the game except that the
 * designated player has seen both battlefields when choosing (Spec A §5.2).
 */
import { findCard, isChampionUnit, isMainDeckCard, isType, oracleCard, type OracleCard } from '../cards/oracle.ts';
import type { GameSetup } from '../config.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { EngineError, NotImplementedError } from '../core/errors.ts';
import { emit, emitZone, knowers, newGroup } from '../core/events.ts';
import { answer, ask, defineStart, defineSteps, next, type FrameOf, type RunCtx, type StepTable } from '../core/frames.ts';
import { defsHash } from '../cards/registry.ts';
import {
  createBattlefield, createObject, moveObject, pushFrame, reorderZone, setField,
} from '../state/mut.ts';
import { randInt, shuffled, shuffleZone } from '../state/rng.ts';
import { Z } from '../state/zones.ts';
import { deckDefs, type DeckList } from '../decks/decklist.ts';
import type { DefId, GameState, ObjId, PlayerId } from '../state/types.ts';
import { mulliganMax, openingHandSize, turnOrder } from './defaults.ts';

/** The decks can't start a game: setup names every problem at once. */
export class SetupError extends EngineError {
  constructor(readonly issues: string[]) {
    super(`these decks can't start a game:\n  ${issues.join('\n  ')}`);
  }
}

type SetupFrame = FrameOf<'setup'>;

/**
 * The setup frame's locals. `set` holds the cards set aside so far in the
 * current mulligan; like every setup local it belongs to the deciding player
 * (frame.p), and other players' views show none of it (core/redact.ts).
 */
interface SetupLocals { set: ObjId[] }

const localsOf = (f: SetupFrame) => f.locals as unknown as SetupLocals;

// ---- decks ----

/**
 * What setup needs from a deck list to run at all. The rules of deck
 * building (identity, copies, Signature cards, bans) are validateDeck's
 * (decks/validate.ts, Spec A §1.7); a game is only created from decks that
 * pass it. This check keeps setup from building an impossible board: every
 * card goes to a zone that can hold it, and the Champion Zone holds a
 * champion unit of the legend's champion (GameSetup.chosenChampion can name
 * one the deck's validation never saw).
 */
function deckIssues(s: GameState, d: DeckList, p: PlayerId, chosen: DefId, limited: GameSetup['limited']): string[] {
  const out: string[] = [];
  const at = `P${p} '${d.name}'`;
  const total = (rows: { def: DefId; n: number }[]) => rows.reduce((t, r) => t + r.n, 0);
  // Limited decks may play without a Legend and a Chosen Champion (TR 602.4.a.5)
  if (!d.legend && !limited) out.push(`${at}: no Champion Legend [103.2]`);
  if (!chosen && !limited) out.push(`${at}: no Chosen Champion [103.3.a]`);
  const unknown = deckDefs(d).filter((def) => def && !findCard(def));
  if (unknown.length > 0) out.push(`${at}: not cards in the oracle: ${unknown.join(', ')} [103]`);
  const wrong = (defs: DefId[], ok: (c: OracleCard) => boolean) =>
    [...new Set(defs)].filter((def) => { const c = findCard(def); return c !== undefined && !ok(c); });
  const notLegend = d.legend ? wrong([d.legend], (c) => isType(c, 'legend')) : [];
  if (notLegend.length > 0) out.push(`${at}: ${d.legend} is not a legend [103.2]`);
  const notMain = wrong(d.main.map((r) => r.def), isMainDeckCard);
  if (notMain.length > 0) out.push(`${at}: not units, gear or spells in the Main Deck: ${notMain.join(', ')} [133.4]`);
  const notRunes = wrong(d.runes.map((r) => r.def), (c) => isType(c, 'rune'));
  if (notRunes.length > 0) out.push(`${at}: not runes in the Rune Deck: ${notRunes.join(', ')} [103.4.a]`);
  const notFields = wrong(d.battlefields, (c) => isType(c, 'battlefield'));
  if (notFields.length > 0) out.push(`${at}: not battlefields: ${notFields.join(', ')} [103.5]`);
  const legend = notLegend.length > 0 || !d.legend ? undefined : findCard(d.legend);
  const champion = chosen ? findCard(chosen) : undefined;
  // in Limited any champion unit of the deck's domains will do (TR 602.4.a.3.a)
  if (champion && (!isChampionUnit(champion) || (!limited && legend && champion.championTag !== legend.championTag))) {
    out.push(`${at}: Chosen Champion ${chosen} is not a champion unit with the legend's champion tag [103.3.a.2]`);
  }
  if ([...d.main, ...d.runes].some((r) => !r.def || !Number.isInteger(r.n) || r.n < 1)) {
    out.push(`${at}: every row needs a card and a count of at least 1`);
  }
  const main = total(d.main), exactly = s.rules.deckSize === 'exactly40';
  if (limited) {
    const min = limited === 'sealed' ? 25 : 20;
    if (main < min) out.push(`${at}: ${main} Main Deck cards, at least ${min} needed (TR 602.4.${limited === 'sealed' ? 'a.2' : 'b.3'})`);
  } else if (exactly ? main !== 40 : main < 40) {
    out.push(`${at}: ${main} Main Deck cards, ${exactly ? 'exactly' : 'at least'} 40 needed [103.3], TR 402.1`);
  }
  if (chosen && !d.main.some((r) => r.def === chosen)) {
    out.push(`${at}: Chosen Champion ${chosen} is not in the Main Deck [103.3.a], TR 402.1`);
  }
  if (d.championOptions && !d.championOptions.includes(chosen)) {
    out.push(`${at}: Chosen Champion ${chosen} is not one of the deck's Champion Options`);
  }
  if (total(d.runes) !== 12) out.push(`${at}: ${total(d.runes)} runes, 12 needed [103.4.a]`);
  if (d.battlefields.length < s.mode.battlefieldsPerPlayer) {
    out.push(`${at}: ${d.battlefields.length} battlefields, ${s.mode.battlefieldsPerPlayer} needed [487.4.a]`);
  }
  // Limited's blank battlefield may come more than once (TR 602.3.d)
  const named = d.battlefields.filter((b) => !(limited && b === 'blank-battlefield'));
  if (new Set(named).size !== named.length) out.push(`${at}: two battlefields share a name [103.5.c]`);
  return out;
}

/** Puts these cards on top of a shuffled deck, top first (GameSetup.stack):
    each the first copy left of its definition; the rest keep the shuffle's
    order. Uses no randomness, so a stacked game is as replayable as any. */
function stackZone(s: GameState, z: { z: 'deck' | 'runeDeck'; p: PlayerId }, top: DefId[]) {
  const rest = s.players[z.p][z.z].slice();
  const head: ObjId[] = [];
  for (const def of top) {
    const i = rest.findIndex((id) => s.objects[id].def === def);
    if (i < 0) throw new SetupError([`P${z.p}: no ${def} left to stack on top of the ${z.z === 'deck' ? 'Main Deck' : 'Rune Deck'}`]);
    head.push(rest.splice(i, 1)[0]);
  }
  reorderZone(s, z, [...head, ...rest]);
}

/** The Card id for the art of copy i of a card, when the deck names one. */
function printingOf(d: DeckList, def: DefId, i: number): string | null {
  const ids = d.printings?.[def] ?? [];
  return ids[i] ?? ids[0] ?? null;
}

/** The hash of the card definitions in effect, which records carry so a
    replay runs against the same cards (§4.9): the registry's. */
const definitionsHash = defsHash;

// ---- turn order ----

/** Fixes the First Player and the turn queue that starts with them
    [115.1.c]; M1's turn start takes the queue's head. */
function setFirstPlayer(s: GameState, x: RunCtx, first: PlayerId, rule: string) {
  setField(s, s.turn, 'firstPlayer', first);
  setField(s, s.turn, 'player', first);
  setField(s, s.turn, 'queue', turnOrder(s).map((player) => ({ player, additional: false })));
  emit(s, x, { k: 'playOrder', first, rule });
}

// ---- drawing and recycling ----

/** Draws n cards from the top of p's Main Deck [414.1.a]: one 'zone' event
    per card, seen by the drawer, and a 'draw' summary. */
function draw(s: GameState, x: RunCtx, p: PlayerId, n: number, rule: string, group: number): ObjId[] {
  const drawn: ObjId[] = [];
  for (let i = 0; i < n; i++) {
    const prev = s.players[p].deck[0];
    if (prev === undefined) throw new EngineError(`P${p}'s Main Deck ran out during setup`);   // 39 cards: can't happen
    const before = knowers(s, [prev]);
    const obj = moveObject(s, prev, Z.hand(p));
    emitZone(s, x, { obj, prev, from: Z.deck(p), to: Z.hand(p), why: 'draw', rule, before, group });
    drawn.push(obj);
  }
  emit(s, x, { k: 'draw', p, objs: drawn, rule, group, vis: knowers(s, drawn) });
  return drawn;
}

/**
 * Recycles the set-aside cards to the bottom of the Main Deck [117.3]. Two or
 * more go in random order [417.5]: nobody knows which is which afterwards, not
 * even their owner, and their new ids are minted in the new order (§7.2). A
 * single card goes to a known position, so its owner still knows it.
 *
 * The events list the cards in the order they were set aside, not the order
 * they landed in: one action's events happen at the same time, and the
 * owner, who sees which card each event moves, must not read the random
 * order off them.
 */
function recycleSetAside(s: GameState, x: RunCtx, p: PlayerId, set: ObjId[], group: number) {
  const random = set.length > 1;
  const before = set.map((id) => knowers(s, [id]));
  const moved: Record<ObjId, ObjId> = {};
  for (const prev of random ? shuffled(s, set) : set) {
    moved[prev] = moveObject(s, prev, Z.deck(p), random ? { pos: 'bottom', knownBy: 0 } : { pos: 'bottom' });
  }
  set.forEach((prev, i) => emitZone(s, x, {
    obj: moved[prev], prev, from: Z.hand(p), to: Z.deck(p), why: 'mulligan', rule: '117.3', before: before[i], group,
  }));
  const objs = set.map((prev) => moved[prev]);
  emit(s, x, { k: 'recycle', p, objs, rule: '117.3', group, vis: knowers(s, objs) });
}

// ---- the start: everything before the first decision ----

defineStart((s: GameState, setup: GameSetup, x: RunCtx) => {
  if (s.mode.battlefieldSelection !== 'random') {
    throw new NotImplementedError('choosing battlefields', 'the Match mode [488], M7');
  }
  if (!s.mode.firstPlayerContributesBattlefield) {
    throw new NotImplementedError('modes where the First Player provides no battlefield', '[490], [491], [MP]');
  }
  if (setup.decks.length !== s.players.length) {
    throw new SetupError([`${setup.decks.length} decks for ${s.players.length} players`]);
  }
  const fixed = setup.firstPlayer;
  if (typeof fixed === 'number' && !s.players.some((pl) => pl.id === fixed)) {
    throw new SetupError([`the First Player P${fixed} is not in the game [115]`]);
  }
  if (typeof fixed === 'object' && !s.players.some((pl) => pl.id === fixed.designee)) {
    throw new SetupError([`the designated player P${fixed.designee} is not in the game (TR 407)`]);
  }
  const chosen = s.players.map((pl) => setup.chosenChampion?.[pl.id] ?? setup.decks[pl.id].chosenChampion);
  const issues = s.players.flatMap((pl) => deckIssues(s, setup.decks[pl.id], pl.id, chosen[pl.id], setup.limited));
  if (issues.length > 0) throw new SetupError(issues);
  setField(s, s, 'defsHash', definitionsHash());

  for (const pl of s.players) {
    const p = pl.id, d = setup.decks[p];
    setField(s, pl, 'deckName', d.name);
    setField(s, pl, 'extra', d.extra ?? {});
    const legend = d.legend ? oracleCard(d.legend) : null;               // the deck's identity [103.2.b]
    setField(s, pl, 'identity', d.domains ?? legend?.domains ?? []);      // Limited: its own three (TR 602.4.a.3)
    setField(s, pl, 'championTag', legend?.championTag ?? '');            // [133.8.b]
    setField(s, pl, 'chosenChampionName', chosen[p] ? oracleCard(chosen[p]).name : '');   // [103.3.a.3]
    setField(s, pl, 'limitedDraw', !!setup.limited && !d.legend && !chosen[p]);           // TR 602.4.a.5.b
    if (legend) {
      createObject(s, {                                                   // [111], [107.4]
        def: d.legend, printing: printingOf(d, d.legend, 0), owner: p, zone: Z.legend(p),
        exhausted: !s.rules.legendStartsReady,
      });
    }
    if (chosen[p]) createObject(s, { def: chosen[p], printing: printingOf(d, chosen[p], 0), owner: p, zone: Z.champion(p) });   // [112]
    // The other cards of the Main Deck. The Chosen Champion is one of the 40
    // and comes out once, even from a list that names it on two rows; it
    // took the first printing of its name.
    const main: { def: DefId; printing: string | null }[] = [];
    const used: Record<DefId, number> = chosen[p] ? { [chosen[p]]: 1 } : {};
    let champion = chosen[p] ? 1 : 0;
    for (const row of d.main) {
      for (let i = 0; i < row.n; i++) {
        if (row.def === chosen[p] && champion > 0) { champion--; continue; }
        const copy = used[row.def] ?? 0;
        used[row.def] = copy + 1;
        main.push({ def: row.def, printing: printingOf(d, row.def, copy) });
      }
    }
    const runes = d.runes.flatMap((row) =>
      Array.from({ length: row.n }, (_, i) => ({ def: row.def, printing: printingOf(d, row.def, i) })));
    // Made in a random order: a card keeps its CardRef all game, and views
    // show it once the card is public, so it must not tell where the card
    // stood in the deck list (how many copies sit next to it, §7).
    for (const c of shuffled(s, main)) createObject(s, { ...c, owner: p, zone: Z.deck(p) });
    for (const c of shuffled(s, runes)) createObject(s, { ...c, owner: p, zone: Z.runeDeck(p) });
  }

  const bfs: ObjId[] = [];                                                // [113], [487.5]
  for (const pl of s.players) {
    const d = setup.decks[pl.id];
    for (const def of shuffled(s, d.battlefields).slice(0, s.mode.battlefieldsPerPlayer)) {
      bfs.push(s.bfs[createBattlefield(s, { def, printing: printingOf(d, def, 0), owner: pl.id })].obj);
    }
  }
  emit(s, x, { k: 'battlefieldsChosen', bfs, rule: '487.5' });

  for (const pl of s.players) {                                           // [114]
    for (const zone of ['deck', 'runeDeck'] as const) {
      const ids = shuffleZone(s, { z: zone, p: pl.id });
      emit(s, x, { k: 'shuffle', p: pl.id, zone, count: ids.length, rule: '114' });
      const top = setup.stack?.[pl.id]?.[zone === 'deck' ? 'main' : 'runes'];
      if (top && top.length > 0) stackZone(s, { z: zone, p: pl.id }, top);
    }
  }

  // [115]: a player named by the setup, a random one, or (TR 407) a random
  // designated player who chooses at the setup frame's first step.
  const method = setup.firstPlayer ?? s.rules.firstPlayer;
  let designee: PlayerId | undefined;
  if (typeof method === 'number') setFirstPlayer(s, x, method, '115');
  else if (typeof method === 'object') designee = method.designee;
  else if (method === 'random') setFirstPlayer(s, x, s.players[randInt(s, s.players.length)].id, '115');
  else designee = s.players[randInt(s, s.players.length)].id;

  pushFrame(s, { f: 'setup', pc: 0, ...(designee === undefined ? {} : { p: designee }), locals: { set: [] } });
});

// ---- the setup frame: the steps with decisions ----

const STEPS: StepTable<SetupFrame> = [
  // pc 0: the designated player chooses to play first or second (TR 407).
  (s, f, x) => {
    const designee = f.p;
    if (designee === undefined) return next(f);                          // the setup fixed the First Player
    const key = answer(f);
    if (key === undefined) {
      return ask(s, f, x, {
        player: designee, kind: 'playOrder', prompt: { t: 'playOrder' }, ctx: { rule: 'TR 407' },
        options: [{ key: K.first }, { key: K.second }], privateOptions: false,
      });
    }
    const order = s.players.map((pl) => pl.id);
    const first = key === K.first ? designee : order[(order.indexOf(designee) + 1) % order.length];
    setFirstPlayer(s, x, first, 'TR 407');
    delete f.p;
    return next(f);
  },

  // pc 1: opening hands, drawn at the same time [116].
  (s, f, x) => {
    const group = newGroup(s);
    const order = turnOrder(s);
    for (const p of order) draw(s, x, p, openingHandSize(s, p), '116', group);
    f.p = order[0];
    f.locals = { set: [] };
    return next(f);
  },

  // pc 2: the mulligans, in turn order [117]. Each pick is one decision of
  // the player's batch; the set-aside cards stay in hand until the commit,
  // which draws first and then recycles them, so they can't be redrawn.
  (s, f, x) => {
    const p = f.p!;
    const set = localsOf(f).set;
    const key = answer(f);
    if (key === undefined && set.length < mulliganMax(s, p)) {
      const options: Option[] = s.players[p].hand
        .filter((id) => !set.includes(id))
        .map((id) => ({ key: K.set(id), refs: [{ obj: id }] }));
      return ask(s, f, x, {
        player: p, kind: 'mulligan', prompt: { t: 'mulligan', max: mulliganMax(s, p), setAside: set.length },
        ctx: { rule: '117' }, options: [...options, { key: K.done }], batch: `mulligan:p${p}`, privateOptions: true,
      });
    }
    if (key !== undefined && key !== K.done) {                            // one more card set aside [117.1]
      f.locals = { set: [...set, parseKey(key)!.obj!] };
      return 'continue';
    }
    emit(s, x, { k: 'mulligan', p, n: set.length, rule: '117' });        // everyone sees the count
    if (set.length > 0) {
      draw(s, x, p, set.length, '117.2', newGroup(s));
      recycleSetAside(s, x, p, set, newGroup(s));
    }
    const order = turnOrder(s);
    const after = order[order.indexOf(p) + 1];
    f.locals = { set: [] };
    if (after !== undefined) {
      f.p = after;
      return 'continue';
    }
    delete f.p;
    return next(f);
  },

  // pc 3: the First Player's turn begins [118]; M1's master loop takes over.
  () => 'done',
];

defineSteps('setup', STEPS);
