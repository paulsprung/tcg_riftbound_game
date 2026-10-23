/*
 * Cleanups (§5.9, Spec C §7, [318–324]). A cleanup runs only as an
 * Outstanding Task, in a 'cleanup' frame. While it runs nothing finalizes
 * or resolves and Priority and Focus are neither passed nor awarded
 * [320], [320.1]; the only questions it asks are the Turn Player's choice
 * of battlefield in steps 9 and 10, a Limited-Action choice [312.1.b.1].
 *
 *   1    win check [323.1]
 *   2    combat designations, while a combat is in progress [323.2]
 *   3a   kill every unit with lethal damage, as one Kill action [323.4]
 *   3c–e special cleanups only: combat (heal all, recall the attackers if
 *        defenders remain) [468.1.a]; ending (heal all, "this turn"
 *        effects expire, every Rune Pool empties) [317.2.b–d]
 *   4    lose control of an empty battlefield, if Open and nothing is
 *        ongoing there [323.5], [190.4.c]
 *   5    recall stray gear (not Deploy gear [830.1.b.3]), runes, and permanents in a base not their
 *        controller's [323.6]; 5a trash foreign facedown cards [323.6.a]
 *   6–8a stage showdowns and combats, unstage, remove and re-apply
 *        Contested [323.7–323.10.a]
 *   9    Neutral Open, a showdown staged where no combat is: the Turn Player
 *        picks one, it begins [323.11]
 *   10   else Neutral Open and a combat staged: the Turn Player picks one, it
 *        opens with a new combat showdown [323.12]
 *   10a  else Showdown Open, a combat staged where the non-combat showdown
 *        is: it becomes a combat showdown [323.13]
 *
 * Repetition (fix F14): if anything changed (the epoch moved) or a cleanup
 * was asked for meanwhile, another normal cleanup runs at once [322],
 * [324.2]. The writers of state/mut.ts are set-if-changed, so a cleanup that
 * finds nothing to do changes nothing and the repetition stops.
 */
import { K, parseKey } from '../core/decisions.ts';
import { emit } from '../core/events.ts';
import { answer, ask, defineSteps, next, type FrameOf, type StepTable } from '../core/frames.ts';
import { setField, setInCleanup } from '../state/mut.ts';
import type { GameState, PlayerId } from '../state/types.ts';
import { emptyPools, heal, kill, recall, setController, clearContested, applyContested, trashForeignFacedown } from './actions.ts';
import { playersWithUnitsAt, turnOrderFromTurnPlayer, turnState, unitsAt, unitsOfAt, unitsOnBoard } from './board.ts';
import { hasKeyword, isLethal, isType, mightOf } from './chars.ts';
import { fire } from '../abilities/triggers.ts';
import { designate, designationFor, openCombat } from './combat.ts';
import { checkWin } from './scoring.ts';
import { beginShowdown } from './showdown.ts';
import { enqueueFront } from './tasks.ts';
import { staticsFor } from '../layers/derive.ts';

type CleanupFrame = FrameOf<'cleanup'>;

const ongoingAt = (s: GameState, bf: number) => s.showdown?.bf === bf || s.combat?.bf === bf;

/** Asks the Turn Player which battlefield goes first when there are several
    [323.11], [323.12], [463.1]; returns the one to use, or the decision. */
function pickBattlefield(s: GameState, f: CleanupFrame, x: Parameters<typeof ask>[2], bfs: number[], rule: string):
  number | 'waiting' {
  if (bfs.length === 1) return bfs[0];
  const key = answer(f);
  if (key !== undefined) return parseKey(key)!.n!;
  ask(s, f, x, {
    player: s.turn.player, kind: 'chooseBattlefield', prompt: { t: rule === '323.11' ? 'showdownAt' : 'combatAt' },
    ctx: { rule }, options: bfs.map((bf) => ({ key: K.bf(bf), refs: [{ loc: { z: 'bf', bf } }] })), privateOptions: false,
  });
  return 'waiting';
}

const STEPS: StepTable<CleanupFrame> = [
  // 1: win check [323.1].
  (s, f, x) => {
    setInCleanup(s, true);
    if (checkWin(s, x)) {
      setInCleanup(s, false);
      return 'continue';                                             // the game is over; endGame cleared the frames
    }
    return next(f);
  },

  // 2: designations while a combat is in progress [323.2.a–c].
  (s, f, x) => {
    const c = s.combat;
    if (c) {
      const first: Record<'attacker' | 'defender', number[]> = { attacker: [], defender: [] };
      for (const id of unitsOnBoard(s)) {
        const o = s.objects[id];
        const want = o.zone.z === 'bf' && o.zone.bf === c.bf ? designationFor(c, o.controller) : null;
        if (o.designation !== want && designate(s, id, want) && want) first[want].push(id);
      }
      // A unit designated for the first time this combat: its attack or
      // defend triggers [383.4.e.2.a], [466.2.c.3.a].
      for (const d of ['attacker', 'defender'] as const) {
        if (first[d].length > 0) fire(s, x, { e: 'designated', objs: first[d], d }, 'combat');
      }
    }
    return next(f);
  },

  // 3a: every unit with lethal damage dies, as one action [323.4], [142.4].
  (s, f, x) => {
    const dying = unitsOnBoard(s).filter((id) => isLethal(s, id));
    kill(s, x, dying, { rule: '323.4', inCombat: (id) => s.combat !== null && s.objects[id].designation !== null });
    return next(f);
  },

  // 3c–3e: the special cleanups' own steps [324.1].
  (s, f, x) => {
    if (f.v === 'combat') {
      const c = s.combat!;
      heal(s, x, unitsOnBoard(s), '468.1.a.1');                      // every unit, everywhere
      const here = playersWithUnitsAt(s, c.bf);
      setField(s, c, 'tie', here.includes(c.attacker) && here.includes(c.defender));   // [740.3.a]
      const recallAll = here.includes(c.attacker) && here.includes(c.defender)
        && staticsFor(s, null, 'tieRecallAll').some(({ st }) => st.ctl === c.attacker);   // Symbol of the Solari
      if (recallAll) {
        recall(s, x, unitsAt(s, { z: 'bf', bf: c.bf }), '468.1.a.2');
        setField(s, c, 'recalled', true);
      } else if (unitsOfAt(s, c.defender, c.bf).length > 0) {        // [468.1.a.2]
        const attackers = unitsAt(s, { z: 'bf', bf: c.bf }).filter((id) => s.objects[id].designation === 'attacker');
        if (attackers.length > 0) {
          recall(s, x, attackers, '468.1.a.2');
          setField(s, c, 'recalled', true);
        }
      }
    } else if (f.v === 'ending') {
      heal(s, x, unitsOnBoard(s), '317.2.b');
      // [317.2.c]: "this turn" effects expire together, Stun included [424.1.a.2].
      for (const id of unitsOnBoard(s)) if (s.objects[id].stunned) setField(s, s.objects[id], 'stunned', false);
      // [317.2.c]: "this turn" effects too.
      if (s.effects.some((e) => e.until === 'thisTurn')) {
        setField(s, s, 'effects', s.effects.filter((e) => e.until !== 'thisTurn'));
      }
      // Delayed abilities "this turn" end with it (Fanfare's unused draws) [391.3].
      if (s.delayed.some((d) => 'during' in d.window && d.window.during === 'thisTurn')) {
        setField(s, s, 'delayed', s.delayed.filter((d) => !('during' in d.window && d.window.during === 'thisTurn')));
      }
      emptyPools(s, x, '317.2.d');
    }
    return next(f);
  },

  // 4: control of an empty battlefield is lost, if the turn is Open and no
  // showdown or combat is ongoing there [323.5], [190.4.c].
  (s, f, x) => {
    if (s.chain.length === 0) {
      s.bfs.forEach((b, bf) => {
        if (b.controller !== null && unitsOfAt(s, b.controller, bf).length === 0 && !ongoingAt(s, bf)) {
          setController(s, x, bf, null, '323.5');
        }
      });
    }
    return next(f);
  },

  // 5: stray objects go home [323.6]; 5a: facedown cards at a battlefield
  // their controller doesn't control go to the trash, revealed [323.6.a].
  (s, f, x) => {
    const stray: number[] = [];
    s.bfs.forEach((b) => {
      for (const id of b.here) {
        const o = s.objects[id];
        const gear = isType(o, 'gear') && !isType(o, 'unit') && o.attachedTo === null
          && !hasKeyword(s, id, 'deploy');                           // Deploy gear stays [830.1.b.3]
        if (gear || isType(o, 'rune')) stray.push(id);
      }
    });
    for (const pl of s.players) {
      for (const id of pl.base) if (s.objects[id].controller !== pl.id && s.objects[id].attachedTo === null) stray.push(id);
    }
    recall(s, x, stray, '323.6');
    s.bfs.forEach((_, bf) => trashForeignFacedown(s, x, bf, '323.6.a'));
    // Effects on objects that left the board are gone with them [124]; an
    // object that "becomes Mighty" triggers (Fiora) [709].
    const live = new Set(Object.keys(s.objects).map(Number));
    if (s.effects.some((e) => 'objs' in e.affects && e.affects.objs.every((id) => !live.has(id)))) {
      setField(s, s, 'effects', s.effects.filter((e) => !('objs' in e.affects) || e.affects.objs.some((id) => live.has(id))));
    }
    const rose: number[] = [];
    for (const id of unitsOnBoard(s)) {
      const now = mightOf(s, id) >= 5;
      const was = s.objects[id].mighty;
      if (was === now) continue;
      setField(s, s.objects[id], 'mighty', now);
      if (now && was === false) rose.push(id);
    }
    if (rose.length > 0) {
      for (const id of rose) emit(s, x, { k: 'becomeMighty', obj: id, rule: '709' });
      fire(s, x, { e: 'mighty', objs: rose });
    }
    return next(f);
  },

  // 6–8a: staging and Contested [323.7–323.10.a].
  (s, f, x) => {
    s.bfs.forEach((b, bf) => {
      const present = playersWithUnitsAt(s, bf);
      const applierHere = b.contested !== null && present.includes(b.contested);
      if (!ongoingAt(s, bf)) {                                       // 6 [323.7], [323.7.a] (Spec C Q11)
        if (b.staged.showdown !== (b.contested !== null && applierHere)) {
          setField(s, b.staged, 'showdown', b.contested !== null && applierHere);
          if (b.staged.showdown) emit(s, x, { k: 'staged', bf, what: 'showdown', rule: '323.7' });
        }
      }
      if (s.combat?.bf !== bf) {
        if (b.contested !== null && present.length >= 2 && !b.staged.combat) {   // 7 [323.8]
          setField(s, b.staged, 'combat', true);
          emit(s, x, { k: 'staged', bf, what: 'combat', rule: '323.8' });
        } else if (present.length < 2 && b.staged.combat) {
          setField(s, b.staged, 'combat', false);                    // 7a [323.9], [463.2]
        }
      }
      if (b.contested !== null && !applierHere && !ongoingAt(s, bf)) {   // 8 [323.10], [190.3.b.1]
        clearContested(s, x, bf, '323.10');
        setField(s, b.staged, 'showdown', false);
      }
      if (b.contested === null) {                                    // 8a [323.10.a], in turn order (Spec C Q8)
        const p: PlayerId | undefined = turnOrderFromTurnPlayer(s).find((q) => present.includes(q) && b.controller !== q);
        if (p !== undefined) applyContested(s, x, bf, p);
      }
    });
    return next(f);
  },

  // 9, 10, 10a: a showdown or a combat begins [323.11–323.13].
  (s, f, x) => {
    const st = turnState(s);
    if (st === 'NeutralOpen') {
      const shows = s.bfs.map((_, i) => i).filter((i) => s.bfs[i].staged.showdown && !s.bfs[i].staged.combat);
      if (shows.length > 0) {
        const bf = pickBattlefield(s, f, x, shows, '323.11');
        if (bf === 'waiting') return 'waiting';
        beginShowdown(s, x, bf);
        return next(f);
      }
      const combats = s.bfs.map((_, i) => i).filter((i) => s.bfs[i].staged.combat);
      if (combats.length > 0) {
        const bf = pickBattlefield(s, f, x, combats, '323.12');
        if (bf === 'waiting') return 'waiting';
        openCombat(s, x, bf, true);
      }
    } else if (st === 'ShowdownOpen' && s.showdown?.kind === 'nonCombat' && !s.combat
      && s.bfs[s.showdown.bf].staged.combat) {
      openCombat(s, x, s.showdown.bf, false);
    }
    return next(f);
  },

  // The end: once more if anything changed [322], as a normal cleanup [324.2].
  (s, f) => {
    setInCleanup(s, false);
    if (s.epoch !== f.epoch0 || s.turn.cleanupRequested) {
      setField(s, s.turn, 'cleanupRequested', false);
      enqueueFront(s, { t: 'cleanup', v: 'normal' });
    }
    return 'done';
  },
];

defineSteps('cleanup', STEPS);

