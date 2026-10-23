/*
 * Unleashed (UNL) Champion Deck cards: the Vex and Vi decks. Each `text` is
 * the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, battlefield, bfSel, buff, cantMove, channel, cond, costAbility, deal, deathknell, delayed, destSlot,
  double, draw, entersReady, gainXp, gear, grant, iff, keywordTo, kill, kw, legend, might, move, onPlay, playToken, pred,
  predict, prog, ready, ref, replaceDeath, returnToHand, slot, spell, statik, stun, unit, unitSel, val, when,
} from '../../dsl/builders.ts';

export const UNL_DEFS = [
  // ---- Vex ----
  legend('vex-gloomist', 'When you or an ally hold, you may exhaust me to draw 1.', [
    when({ on: 'hold', who: 'you', at: 'any' }, prog([draw(1)]), { may: true, cost: { exhaustSelf: true } }),
  ]),

  unit('vex-apathetic', "[Deflect]\nWhen an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn.", {
    abilities: [when({ on: 'cardPlayed', by: 'opponent', what: { types: ['unit'] } }, prog([stun(ref.subject), cantMove(ref.subject)]),
      { if: cond.selfAt('battlefield') })],
  }),

  unit('vex-cheerless',
    "While I'm in combat, friendly spells cost [1][A] less to a minimum of [1], and enemy spells cost [1][A] more.", {
      abilities: [
        costAbility({ grant: { types: ['spell'], whose: 'you' }, discount: { energy: 1, min: 1, power: 1 }, while: cond.self(pred.inCombat) }),
        costAbility({ grant: { types: ['spell'], whose: 'enemy' }, increase: { energy: 1, power: ['A'] }, while: cond.self(pred.inCombat) }),
      ],
    }),

  unit('vex-mocking', '[Shield]\n[Tank]\nWhen you [Stun] an enemy unit at a battlefield, you may move me to that battlefield.', {
    abilities: [when({ on: 'stunned', who: 'enemy', at: 'battlefield' }, prog([move(ref.self, { info: 'bf' })]), { may: true })],
  }),

  unit('monch', 'If an opponent controls a stunned unit, I cost [2] less and enter ready.', {
    abilities: [
      costAbility({ discount: { energy: 2 }, while: cond.count(unitSel({ rel: 'enemy', where: [pred.stunned] }), '>=', 1) }),
      entersReady({ while: cond.count(unitSel({ rel: 'enemy', where: [pred.stunned] }), '>=', 1) }),
    ],
  }),

  spell('existential-dread',
    "[Action]\n[Repeat] [2]\n[Stun] an attacking enemy unit. If it's already stunned, return it to its owner's hand instead.", {
      kw: [kw.action()],
      choose: [slot('a', unitSel({ rel: 'enemy', where: [pred.attacking] }), { harm: true })],
      body: [iff(cond.is(ref.slot('a'), pred.stunned), [returnToHand(ref.slot('a'))], [stun(ref.slot('a'))])],
    }),

  unit('allay-eager-admirer', "[Deflect]\nWhile I'm at a battlefield, your other units here have [Deflect].", {
    abilities: [keywordTo(kw.deflect(), unitSel({ rel: 'friendly', other: true, at: 'here' }), { while: cond.selfAt('battlefield') })],
  }),

  spell('back-off', '[Hidden]\n[Action]\n[Stun] a unit.\nIf you played this from your hand, draw 1.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [stun(ref.slot('a')), iff(cond.playedFrom('hand'), [draw(1)])],
  }),

  unit('enthusiastic-promoter', '[Backline]\nWhen I hold, [Buff] all units here.', {
    abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([buff(unitSel({ at: 'here' }))]))],
  }),

  unit('trevor-snoozebottom', '[Shield]\nWhen I hold, play a ready 3 [M] Sprite unit token with [Temporary] here.', {
    abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([playToken('sprite', 1, 'here', { ready: true })]))],
  }),

  gear('blast-cone', 'When you play this, you may move an enemy unit.\nWhen you move an enemy unit, you may exhaust this to [Stun] it.', {
    abilities: [
      onPlay(prog([move(ref.slot('a'), { dest: 'd' })], [slot('a', unitSel({ rel: 'enemy' }), { harm: true }), destSlot('d', 'a')]),
        { may: true }),
      when({ on: 'moved', who: 'enemy' }, prog([stun(ref.subject)]), { may: true, cost: { exhaustSelf: true } }),
    ],
  }),

  unit('megatusk', 'Spend 3 XP: Give your units here [Ganking] this turn.', {
    abilities: [activated({ xp: 3 }, prog([grant(kw.ganking(), unitSel({ rel: 'friendly', at: 'here' }))]))],
  }),

  unit('evelynn-entrancing',
    '[Hidden]\n[Backline]\nWhen you play me from face down on your turn, you may move an enemy unit at a different location to my battlefield.', {
      abilities: [onPlay(prog([move(ref.slot('a'), 'here')], [slot('a', unitSel({ rel: 'enemy', at: 'elsewhere' }), { harm: true,
        freeFromHidden: true })]), { may: true, if: cond.and(cond.playedFrom('facedown'), cond.yourTurn) })],
    }),

  unit('nami-headstrong',
    'You may pay [G] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, [Stun] an enemy unit.\n'
    + 'When I hold, the next time you play a unit this turn, ready it and [Buff] it.', {
      abilities: [
        costAbility({ optional: true, add: { power: ['calm'] } }),
        onPlay(prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]), { if: cond.paid('nami-headstrong#0') }),
        when({ on: 'hold', who: 'you', at: 'here' }, prog([delayed(1, { on: 'cardPlayed', by: 'you', what: { types: ['unit'] } },
          prog([ready(ref.subject), buff(ref.subject)]))])),
      ],
    }),

  unit('iascylla', 'When I hold, at the start of your next Main Phase, you may move an enemy unit to this battlefield.', {
    abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([delayed(1, { on: 'phase', at: 'mainStart', whose: 'your' },
      prog([move(ref.slot('a'), { info: 'bf' })], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]),
      { capture: { bf: 'eventBf' }, may: true })]))],
  }),

  unit('shadow', 'If you play me to a battlefield, I enter ready.\n[Action][>] [1][A], [E]: [Stun] an enemy unit attacking here.', {
    abilities: [
      entersReady({ while: cond.playedToBf }),
      activated({ energy: 1, power: ['A'], exhaustSelf: true }, prog([stun(ref.slot('a'))],
        [slot('a', unitSel({ rel: 'enemy', at: 'here', where: [pred.attacking] }), { harm: true })]), { timing: 'action' }),
    ],
  }),

  gear('scryers-bloom', 'This enters exhausted.\nKill this, [1], [E]: [Predict 2], then draw 1. Gain 1 XP.', {
    abilities: [always({ s: 'entersExhausted' }),
      activated({ killSelf: true, energy: 1, exhaustSelf: true }, prog([predict(2), draw(1), gainXp(1)]))],
  }),

  gear('soul-sword', '[Equip] [G]\n[Level 3][>] I have an additional +1 [M].', {
    abilities: [statik(1, { while: cond.level(3), effectText: true })],
  }),

  unit('mister-root', '[Accelerate]\nWhen I move to a battlefield, gain 2 XP.', {
    abilities: [when({ on: 'moved', who: 'self', to: 'bf' }, prog([gainXp(2)]))],
  }),

  spell('skyward-strike', 'Move an enemy unit.\n[Level 6][>] [Stun] an enemy unit.', {
    choose: [slot('a', unitSel({ rel: 'enemy' }), { harm: true }), destSlot('d', 'a'),
      slot('b', unitSel({ rel: 'enemy' }), { harm: true, if: cond.level(6) })],
    body: [move(ref.slot('a'), { dest: 'd' }), iff(cond.level(6), [stun(ref.slot('b'))])],
  }),

  spell('combat-experience', '[Reaction]\nGive a unit +1 [M] this turn.\n[Level 6][>] Give it +3 [M] this turn instead.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel())],
    body: [iff(cond.level(6), [might(3, ref.slot('a'))], [might(1, ref.slot('a'))])],
  }),

  unit('herald-of-spring', '[Hunt]\nWhen you play me, gain 2 XP.', { abilities: [onPlay(prog([gainXp(2)]))] }),

  unit('wuju-apprentice', '[Hunt]\n[Level 6][>] When you play me, draw 1.', {
    abilities: [onPlay(prog([draw(1)]), { if: cond.level(6) })],
  }),

  unit('mosstomper', '[Hunt 2]\n[Level 3][>] I have +1 [M] and [Deflect].', {
    abilities: [statik(1, { while: cond.level(3) }), keywordTo(kw.deflect(), undefined, { while: cond.level(3) })],
  }),

  battlefield('amateur-recital', 'When you hold here, you may move a unit at a battlefield to its base.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ at: 'battlefield' }))]),
      { may: true, controller: 'eventPlayer' }),
  ]),

  battlefield('gardens-of-becoming', 'Units here have "[E]: Gain 1 XP."', [
    always({ s: 'grantAbility', ability: 'gardens-of-becoming#1', to: unitSel({ at: 'here' }) }),
    activated({ exhaustSelf: true }, prog([gainXp(1)]), { grantedOnly: true }),
  ]),

  battlefield('rippers-bay', "When a unit here is returned to a player's hand, that player may pay [1] to channel 1 rune exhausted.", [
    when({ on: 'returnedToHand', at: 'here' }, prog([channel(1, { exhausted: true })]),
      { may: true, cost: { energy: 1 }, controller: 'eventPlayer' }),
  ]),

  // ---- Vi ----
  legend('vi-piltover-enforcer', 'When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit.', [
    when({ on: 'conquer', who: 'you', at: 'any' }, prog([ready(ref.slot('a'))], [slot('a', unitSel())]),
      { may: true, cost: { exhaustSelf: true }, if: cond.excess(3) }),
  ]),

  gear('serrated-dirk', '[Equip] [R]\n[Assault 2]', { abilities: [keywordTo(kw.assault(2), undefined, { effectText: true })] }),

  unit('arena-kingpin', 'I enter ready.\n[E]: Give a unit +3 [M] this turn.', {
    abilities: [entersReady(), activated({ exhaustSelf: true }, prog([might(3, ref.slot('a'))], [slot('a', unitSel())]))],
  }),

  unit('towering-pairofant', '[Assault]\nIf a unit died this turn, I enter ready.', {
    abilities: [entersReady({ while: cond.thisTurn('unitDied') })],
  }),

  spell('upstage-comedy', '[Repeat] [2]\nReady a unit.', {
    choose: [slot('a', unitSel())],
    body: [ready(ref.slot('a'))],
  }),

  spell('vault-breaker', '[Action]\nGive a unit [Assault 2] and [Ganking] this turn.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel())],
    body: [grant(kw.assault(2), ref.slot('a')), grant(kw.ganking(), ref.slot('a'))],
  }),

  unit('lord-broadmane', '[Ambush]\nWhen you play me, give your other units here [Assault] this turn.', {
    abilities: [onPlay(prog([grant(kw.assault(), unitSel({ rel: 'friendly', other: true, at: 'here' }))]))],
  }),

  spell('right-of-conquest', 'Draw 1, then draw 1 for each battlefield you or allies control.', {
    body: [draw(1), draw(val.count(bfSel({ rel: 'friendly' })))],
  }),

  spell('square-up', '[Repeat] — Discard 1\nGive a unit [Assault 4] this turn.', {
    choose: [slot('a', unitSel())],
    body: [grant(kw.assault(4), ref.slot('a'))],
  }),

  unit('yeti-brawler', 'When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([playToken('gold', 2, 'yourBase', { exhausted: true })]),
      { if: cond.excess(3) })],
  }),

  unit('xerath-freed', "[R], [E]: Deal 3 to a unit. Use this ability only while I'm at a battlefield.", {
    abilities: [activated({ power: ['fury'], exhaustSelf: true }, prog([deal(3, ref.slot('a'))], [slot('a', unitSel(), { harm: true })]),
      { while: cond.selfAt('battlefield') })],
  }),

  unit('vi-hotheaded', '[Deflect]\n[2][R]: Double my Might this turn.', {
    abilities: [activated({ energy: 2, power: ['fury'] }, prog([double(ref.self)]))],
  }),

  unit('carrion-dredger', '[Deathknell][>] Play a 1 [M] Bird unit token with [Deflect] to your base.', {
    abilities: [deathknell(prog([playToken('bird', 1, 'yourBase')]))],
  }),

  unit('crimson-pigeons', "I have +2 [M] while I'm attacking with another unit.", {
    abilities: [statik(2, { while: cond.self(pred.attackingWithOther) })],
  }),

  unit('loyal-poro', "[Deathknell][>] If I didn't die alone, draw 1.", {
    abilities: [deathknell(prog([iff(cond.info('alone', false), [draw(1)])]))],
  }),

  spell('soul-harvest', 'Kill a unit at a battlefield with 3 [M] or less.', {
    choose: [slot('a', unitSel({ at: 'battlefield', where: [pred.might('<=', 3)] }), { harm: true })],
    body: [kill(ref.slot('a'))],
  }),

  gear('divining-shells', '[Vision]\n[Action][>] Kill this, [E]: Give a unit +2 [M] this turn.', {
    abilities: [activated({ killSelf: true, exhaustSelf: true }, prog([might(2, ref.slot('a'))], [slot('a', unitSel())]),
      { timing: 'action' })],
  }),

  unit('mageseeker-investigator',
    'Opponents must pay [A] for each unit beyond the first to move multiple units to my battlefield at the same time.', {
      abilities: [always({ s: 'moveTax' })],
    }),

  spell('tactical-retreat',
    '[Reaction]\nChoose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead.', {
      kw: [kw.reaction()],
      choose: [slot('a', unitSel({ rel: 'friendly' }))],
      body: [replaceDeath(ref.slot('a'))],
    }),

  unit('vi-peacekeeper', '[Ambush]\nWhen I attack, [Stun] an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }),
      { harm: true })]))],
  }),

  gear('hextech-gauntlets',
    "[Equip] [3][A]. This ability's Energy cost is reduced by the Might of the unit you choose.\n"
    + 'When I conquer, if you assigned 3 or more excess damage, draw 1.', {
      kw: [kw.equip({ lessBy: val.might(ref.slot('u')) })],
      abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([draw(1)]), { effectText: true, if: cond.excess(3) })],
    }),

  battlefield('star-spring',
    'The first time a player plays a non-token unit here each turn, they may move another unit they control here to its base.', [
      when({ on: 'cardPlayed', by: 'anyPlayer', what: { types: ['unit'], card: true }, to: 'here' }, prog([move(ref.slot('a'), 'base')],
        [slot('a', unitSel({ rel: 'friendly', at: 'here', where: [pred.notSubject] }))]),
      { may: true, controller: 'eventPlayer', first: 'turn' }),
    ]),

  battlefield('trapping-grounds',
    'When you conquer here, if you assigned 3 or more excess damage, play a 1 [M] Bird unit token with [Deflect].', [
      when({ on: 'conquer', who: 'you', at: 'here' }, prog([playToken('bird', 1, 'choose')]),
        { controller: 'eventPlayer', if: cond.excess(3) }),
    ]),
];
