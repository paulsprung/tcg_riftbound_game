/*
 * VEN: the cards of the set (those not in the starter decks).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, burn, cardSel as cards, channel, choiceBy, choose, cond, costAbility, deal, deathknell, draw, empower,
  entersReady, forEach, gear, grant, iff, keywordTo, kill, killAllBut, kw, legend, might, mightTo, move, onPlay, permanentSel,
  playerEffect, points, pred, predict, prog, ready, ref, runeSel, slot, spell, statik, unit, unitSel, val, when, gearSel,
} from '../../dsl/builders.ts';

const friendly = unitSel({ rel: 'friendly' });
const empowered = cond.self(pred.empowered);

export const VEN_SET_DEFS = [
  // ---- batch 1 ----
  spell('acceleration-gate', 'Ready up to 4 units, gear, and/or runes.', {
    choose: [slot('a', [permanentSel(), runeSel()], { min: 0, max: 4 })], body: [ready(ref.slot('a'))],
  }),
  unit('affectionate-poro', "When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1.", {
    abilities: [when({ on: 'combatEnded', who: 'self' }, prog([draw(1)]), { if: cond.not(cond.self(pred.damagedThisTurn)) })],
  }),
  ...(() => {
    const fx = prog([might(2, ref.slot('a'), -1, { floor: 1 })], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]);
    return [unit('ahri-inquisitive', 'When I attack or defend, give an enemy unit here -2 [M] this turn, to a minimum of 1 [M].', {
      abilities: [when({ on: 'attack', who: 'self' }, fx), when({ on: 'defend', who: 'self' }, fx)],
    })];
  })(),
  unit('akali-deadly-weapon', "[Empower] [2][R]\nWhen I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n[Empowered][>] I have +1 [M].", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([iff(empowered, [deal(2, ref.slot('a'))], [deal(1, ref.slot('a'))])],
      [slot('a', unitSel({ where: [pred.atMoveEnds] }), { harm: true })]), { may: true }),
    statik(1, { while: empowered })],
  }),
  legend('akali-rogue-assassin', "[Empower] [3][A]\n[Action][>] [E]: If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it.", [
    activated({ exhaustSelf: true }, prog([iff(cond.yourTurn, [move(ref.slot('a'), 'base'), iff(empowered, [ready(ref.slot('a'))])])],
      [slot('a', unitSel({ rel: 'friendly', where: [pred.inShowdown] }))]), { timing: 'action' }),
  ]),
  unit('akali-silent', "I can't be chosen by enemy spells and abilities unless I'm in combat.\nWhen I move to a battlefield, give me +2 [M] this turn.", {
    abilities: [always({ s: 'noEnemyChoose' }, { while: cond.not(cond.self(pred.inCombat)) }),
      when({ on: 'moved', who: 'self', to: 'bf' }, prog([might(2, ref.self)]))],
  }),
  legend('ambessa-matriarch-of-war', 'When you empower something else, empower me.\nDisempower me, [A], [E]: Ready a unit.', [
    when({ on: 'empowered', who: 'other' }, prog([empower(ref.self)])),
    activated({ disempowerSelf: true, power: ['A'], exhaustSelf: true }, prog([ready(ref.slot('a'))], [slot('a', unitSel())])),
  ]),
  unit('ambessa-respected-and-feared', '[Empower] [1][Y][Y]\n[Empowered][>] I have [Assault 2].\n[Empowered][>] When I attack, kill an enemy unit here with less Might than me.', {
    abilities: [keywordTo(kw.assault(2), undefined, { while: empowered }),
      when({ on: 'attack', who: 'self' }, prog([kill(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here', where: [pred.mightVsSource('<')] }), { harm: true })]),
        { if: empowered })],
  }),
  unit('ambessa-the-wolf', "[Empower] [3][O]\n[Empowered][>] I have +3 [M] and can't be dealt damage unless I'm in combat.", {
    abilities: [statik(3, { while: empowered }), always({ s: 'noDamage' }, { while: cond.and(empowered, cond.not(cond.self(pred.inCombat))) })],
  }),
  unit('applied-researchers', '[Empower] [3]\n[Empowered][>] Your spells cost [1][A] less, to a minimum of [1].', {
    abilities: [costAbility({ grant: { types: ['spell'] }, discount: { energy: 1, power: 1, min: 1 }, while: empowered })],
  }),
  unit('apprentice-mage', '[Empower] [2]\nWhen I become [Empowered], [Predict 2].\n[Empowered][>] I have +1 [M].', {
    abilities: [when({ on: 'empowered', who: 'self' }, prog([predict(2)])), statik(1, { while: empowered })],
  }),
  unit('astral-heron', "When you play your first card each turn, if I'm at a battlefield, the next card you play this turn costs [2][A][A] less.", {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { card: true } },
      prog([playerEffect({ s: 'costLess', types: ['unit', 'spell', 'gear'], energy: 2, power: 2, uses: 1 })]),
      { if: cond.and(cond.selfAt('battlefield'), cond.thisTurn('played', { op: '=', n: 1 })) })],
  }),
  unit('aurok-general', '[Empower] [3][Y]\n[Empowered][>] Your units that are [Empowered] have +2 [M].', {
    abilities: [mightTo(2, unitSel({ rel: 'friendly', where: [pred.empowered] }), { while: empowered })],
  }),
  unit('baccai-reaper', 'When I attack, you may pay [R] to give me [Assault 2] this turn.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([grant(kw.assault(2), ref.self)]), { may: true, cost: { power: ['fury'] } })],
  }),
  unit('baccai-sandspinner', '[Empower] [5]. This ability costs [3] less if you control 4 or fewer runes.\n[Empowered][>] I have [Deflect] and [Assault 2].', {
    kw: [{ kw: 'empower', equipLessBy: val.if(cond.count(runeSel({ rel: 'friendly' }), '<=', 4), 3, 0) }],
    abilities: [keywordTo(kw.deflect(), undefined, { while: empowered }), keywordTo(kw.assault(2), undefined, { while: empowered })],
  }),
  unit('baccai-witherclaw', '[Empower] [1][A][A]\n[Empowered][>] I have +2 [M].\n[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted.', {
    abilities: [statik(2, { while: empowered }), deathknell(prog([iff(cond.lki(pred.empowered), [channel(2, { exhausted: true })])]))],
  }),
  unit('blade-twirler', 'The first time I move each turn, choose a player. They [Burn 1].', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([choiceBy('self', [{ label: 'You', body: [burn(1)] },
      { label: 'An opponent', body: [forEach('opponents', 'next', [burn(1)])] }])]), { first: 'turn' })],
  }),
  gear('bottled-constellation', 'At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point.', {
    abilities: [when({ on: 'phase', at: 'mainStart', whose: 'your' }, prog([points(1)]),
      { may: true, cost: { kill: { sel: permanentSel({ rel: 'friendly', other: true }), n: 3 } } })],
  }),
  spell('brittle-steel', 'Kill a gear.\n[Flow] [4][R]', { choose: [slot('g', gearSel(), { harm: true })], body: [kill(ref.slot('g'))] }),
  unit('brutal-hunter', '[Empower] [3]\n[Empowered][>] I have +2 [M] and [Ganking].', {
    abilities: [statik(2, { while: empowered }), keywordTo(kw.ganking(), undefined, { while: empowered })],
  }),
  spell('cataclysmic-duel', 'Each player chooses a unit they control. Kill the rest.', {
    body: [forEach('each', 'you', [choose(friendly, 'k')]), killAllBut(unitSel(), ['k'])],
  }),
  spell('clairvoyance', '[Reaction]\n[Predict 5].\nDraw 2.', { kw: [kw.reaction()], body: [predict(5), draw(2)] }),
  unit('cloud-drake', 'When you play me, draw 1.', { abilities: [onPlay(prog([draw(1)]))] }),
  spell('consuming-curse', '[Action]\nDeal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(val.sum(2, val.count(cards({ rel: 'friendly', where: [pred.name('Consuming Curse')] }))), ref.slot('a'))],
  }),
  unit('corrupted-dragon', 'If your score is not within 3 points of the Victory Score, I enter ready.\nWhen I attack, you may move any number of enemy units here each with 5 [M] or less to their base.', {
    abilities: [entersReady({ while: cond.not(cond.nearWin(3)) }),
      when({ on: 'attack', who: 'self' }, prog([move(ref.slot('a'), 'base')],
        [slot('a', unitSel({ rel: 'enemy', at: 'here', where: [pred.might('<=', 5)] }), { min: 0, max: 99, harm: true })]), { may: true })],
  }),
  unit('covert-informant', '[Empower] [3]\n[Empowered][>] When I move, draw 1.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([draw(1)]), { if: empowered })],
  }),
];
