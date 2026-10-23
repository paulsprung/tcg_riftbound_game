/*
 * Proving Grounds (OGS) starter cards: the Annie, Garen, Lux and Master Yi
 * decks. Each `text` is the oracle's rules text, word for word (a test
 * checks it).
 */
import {
  activated, addEnergy, always, battlefield, bfSel, cardSel, channel, cond, costAbility, deal, delayed, discard, draw,
  entersReady, fight, grant, iff, kill, kw, legend, might, mightTo, move, named, onPlay, playerEffect, playToken, pred,
  prog, ready, ref, replaceDeath, returnToHand, runeSel, slot, spell, statik, unit, unitSel, when,
} from '../../dsl/builders.ts';


export const OGS_DEFS = [
  // ---- Annie ----
  legend('annie-dark-child', 'At the end of your turn, ready up to 2 runes.', [
    when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([ready(ref.slot('r'))],
      [slot('r', runeSel({ rel: 'friendly' }), { min: 0, max: 2 })])),
  ]),

  spell('disintegrate', '[Action]\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    // "If this kills it, do this:" a reflexive trigger as the unit dies of this damage [388].
    body: [deal(3, ref.slot('a')), delayed(1, { on: 'objDies', info: 'obj' }, prog([draw(1)]), { capture: { obj: ref.slot('a') } })],
  }),

  spell('gust', "[Reaction]\nReturn a unit at a battlefield with 3 [M] or less to its owner's hand.", {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel({ at: 'battlefield', where: [pred.might('<=', 3)] }), { harm: true })],
    body: [returnToHand(ref.slot('a'))],
  }),

  spell('morbid-return', '[Action]\nReturn a unit from your trash to your hand.', {
    kw: [kw.action()],
    choose: [slot('c', cardSel({ rel: 'friendly', where: [pred.type('unit')] }))],
    body: [returnToHand(ref.slot('c'))],
  }),

  unit('sai-scout', '[Vision]\nYou may play me to an open battlefield.', {
    abilities: [always({ s: 'playTo', where: 'open' })],
  }),

  unit('sneaky-deckhand', 'You may play me to an open battlefield.', {
    abilities: [always({ s: 'playTo', where: 'open' })],
  }),

  unit('traveling-merchant', 'When I move, discard 1, then draw 1.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([discard(1), draw(1)]))],
  }),

  unit('maddened-marauder', '[Tank]\nWhen you play me, move a unit from a battlefield to its base.', {
    abilities: [onPlay(prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ at: 'battlefield' }))]))],
  }),

  unit('annie-fiery', 'Your spells and abilities deal 1 Bonus Damage.', {
    abilities: [always({ s: 'bonusDamage', n: 1, by: 'you' })],
  }),

  spell('firestorm', 'Deal 3 to all enemy units at a battlefield.', {
    choose: [slot('b', bfSel())],
    body: [deal(3, unitSel({ rel: 'enemy', at: { slot: 'b' } }))],
  }),

  spell('incinerate', '[Action]\nDeal 2 to a unit at a battlefield.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(2, ref.slot('a'))],
  }),

  unit('annie-stubborn', 'When you play me, return a spell from your trash to your hand.', {
    abilities: [onPlay(prog([returnToHand(ref.slot('c'))], [slot('c', cardSel({ rel: 'friendly', where: [pred.type('spell')] }))]))],
  }),

  spell('flash', '[Reaction]\nMove up to 2 friendly units to base.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel({ rel: 'friendly', at: 'battlefield' }), { min: 0, max: 2 })],
    body: [move(ref.slot('a'), 'base')],
  }),

  unit('tibbers', 'When you play me, deal 3 to all units at battlefields.', {
    abilities: [onPlay(prog([deal(3, unitSel({ at: 'battlefield' }))]))],
  }),

  battlefield('void-gate', 'Spells and abilities deal 1 Bonus Damage to units here.', [
    always({ s: 'bonusDamage', n: 1, to: 'here' }),
  ]),

  // ---- Garen ----
  legend('garen-might-of-demacia', 'When you conquer, if you have 4+ units at that battlefield, draw 2.', [
    when({ on: 'conquer', who: 'you', at: 'any' }, prog([draw(2)]),
      { if: cond.count(unitSel({ rel: 'friendly', at: 'eventBf' }), '>=', 4) }),
  ]),

  spell('confront', '[Action]\nUnits you play this turn enter ready. Draw 1.', {
    kw: [kw.action()],
    body: [playerEffect({ s: 'entersReady', types: ['unit'] }), draw(1)],
  }),

  unit('crackshot-corsair', 'When I attack, deal 1 to an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(1, ref.slot('a'))],
      [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]))],
  }),

  unit('dune-drake', 'When I attack, give me +2 [M] this turn if there is a ready enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([
      iff(cond.count(unitSel({ rel: 'enemy', at: 'here', where: [pred.ready] }), '>=', 1), [might(2, ref.self)]),
    ]))],
  }),

  unit('first-mate', 'When you play me, ready another unit.', {
    abilities: [onPlay(prog([ready(ref.slot('a'))], [slot('a', unitSel({ other: true }))]))],
  }),

  spell('back-to-back', '[Reaction]\nGive two friendly units each +2 [M] this turn.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel({ rel: 'friendly' }), { min: 2, max: 2 })],
    body: [might(2, ref.slot('a'))],
  }),

  unit('noxian-drummer', 'When I move to a battlefield, play a 1 [M] Recruit unit token here.', {
    abilities: [when({ on: 'moved', who: 'self', to: 'bf' }, prog([playToken('recruit', 1, 'here')]))],
  }),

  unit('garen-commander', 'Other friendly units have +1 [M] here.', {
    abilities: [mightTo(1, unitSel({ rel: 'friendly', other: true, at: 'here' }))],
  }),

  spell('recruit-the-vanguard', '[Action]\nPlay four 1 [M] Recruit unit tokens.', {
    kw: [kw.action()],
    body: [playToken('recruit', 4, 'choose')],
  }),

  unit('vanguard-attendant', 'I enter ready.', { abilities: [entersReady()] }),

  spell('decisive-strike', '[Action]\nGive friendly units +2 [M] this turn.', {
    kw: [kw.action()],
    body: [might(2, unitSel({ rel: 'friendly' }))],
  }),

  battlefield('trifarian-war-camp', 'Units here have +1 [M].', [mightTo(1, unitSel({ at: 'here' }))]),

  // ---- Lux ----
  legend('lux-lady-of-luminosity', 'When you play a spell that costs [5] or more, draw 1.', [
    when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'], minEnergy: 5 } }, prog([draw(1)])),
  ]),

  unit('eager-apprentice',
    "While I'm at a battlefield, the Energy costs for spells you play is reduced by [1], to a minimum of [1].", {
      abilities: [costAbility({ grant: { types: ['spell'] }, discount: { energy: 1, min: 1 }, while: cond.selfAt('battlefield') })],
    }),

  spell('falling-comet', '[Action]\nDeal 6 to a unit at a battlefield.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(6, ref.slot('a'))],
  }),

  unit('lecturing-yordle', '[Tank]\nWhen you play me, draw 1.', { abilities: [onPlay(prog([draw(1)]))] }),

  spell('stupefy', '[Reaction]\nGive a unit -1 [M] this turn, to a minimum of 1 [M]. Draw 1.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [might(1, ref.slot('a'), -1, { floor: 1 }), draw(1)],
  }),

  unit('ravenbloom-student', 'When you play a spell, give me +1 [M] this turn.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'] } }, prog([might(1, ref.self)]))],
  }),

  spell('singularity', 'Deal 6 to each of up to two units.', {
    choose: [slot('a', unitSel(), { min: 0, max: 2, harm: true })],
    body: [deal(6, ref.slot('a'))],
  }),

  unit('lux-illuminated', 'When you play a spell that costs [5] or more, give me +3 [M] this turn.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'], minEnergy: 5 } }, prog([might(3, ref.self)]))],
  }),

  spell('blast-of-power', '[Action]\nKill a unit at a battlefield.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [kill(ref.slot('a'))],
  }),

  unit('lux-crownguard', '[Reaction][>] [E]: [Add] [2]. Spend this Energy only to play spells.', {
    abilities: [activated({ exhaustSelf: true }, prog([addEnergy(2, 'spells')]), { timing: 'reaction', isAdd: true })],
  }),

  spell('final-spark', '[Action]\nDeal 8 to a unit.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [deal(8, ref.slot('a'))],
  }),

  battlefield('startipped-peak', 'When you hold here, you may channel 1 rune exhausted.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([channel(1, { exhausted: true })]), { may: true, controller: 'eventPlayer' }),
  ]),

  // ---- Master Yi ----
  legend('master-yi-wuju-bladesman', 'While a friendly unit defends alone, it gets +2 [M].', [
    mightTo(2, unitSel({ rel: 'friendly', where: [pred.defending, pred.alone] })),
  ]),

  spell('en-garde',
    '[Reaction]\nGive a friendly unit +1 [M] this turn, then an additional +1 [M] this turn if it is the only unit you control there.', {
      kw: [kw.reaction()],
      choose: [slot('a', unitSel({ rel: 'friendly' }))],
      body: [might(1, ref.slot('a')), iff(cond.is(ref.slot('a'), pred.alone), [might(1, ref.slot('a'))])],
    }),

  spell('meditation',
    '[Reaction]\nAs an additional cost to play this, you may exhaust a friendly unit. If you do, draw 2. Otherwise, draw 1.', {
      kw: [kw.reaction()],
      abilities: [costAbility({ optional: true, pay: { exhaust: { sel: unitSel({ rel: 'friendly' }), n: 1 } } })],
      body: [iff(cond.paid('meditation#0'), [draw(2)], [draw(1)])],
    }),

  unit('wielder-of-water', "While I'm attacking or defending alone, I have +2 [M].", {
    abilities: [statik(2, { while: cond.and(cond.self(pred.alone), cond.or(cond.self(pred.attacking), cond.self(pred.defending))) })],
  }),

  spell('cannon-barrage', '[Reaction]\nDeal 2 to all enemy units in combat.', {
    kw: [kw.reaction()],
    body: [deal(2, unitSel({ rel: 'enemy', where: [pred.inCombat] }))],
  }),

  spell('mobilize', "Channel 1 rune exhausted. If you can't, draw 1.", {
    body: [named('c', channel(1, { exhausted: true })), iff(cond.not(cond.did('c')), [draw(1)])],
  }),

  unit('stormclaw-ursine', '[Tank]\nWhen you play me, channel 1 rune exhausted.', {
    abilities: [onPlay(prog([channel(1, { exhausted: true })]))],
  }),

  unit('master-yi-meditative', 'While you have 8+ runes, I have +4 [M].', {
    abilities: [statik(4, { while: cond.count(runeSel({ rel: 'friendly' }), '>=', 8) })],
  }),

  spell('gentlemens-duel',
    '[Action]\nGive a friendly unit +3 [M] this turn. Then choose an enemy unit. They deal damage equal to their Mights to each other.', {
      kw: [kw.action()],
      choose: [slot('a', unitSel({ rel: 'friendly' })), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
      body: [might(3, ref.slot('a')), fight(ref.slot('a'), ref.slot('b'))],
    }),

  unit('master-yi-honed', '[Ganking]\nI enter ready.', { abilities: [entersReady()] }),

  spell('highlander',
    '[Reaction]\nChoose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead.', {
      kw: [kw.reaction()],
      choose: [slot('a', unitSel({ rel: 'friendly' }))],
      body: [replaceDeath(ref.slot('a'))],
    }),

  battlefield('fortified-position', 'When you defend here, choose a unit. It gains [Shield 2] this combat.', [
    when({ on: 'defend', who: 'you', at: 'here' }, prog([grant(kw.shield(2), ref.slot('a'), 'thisCombat')], [slot('a', unitSel())]),
      { controller: 'eventPlayer' }),
  ]),
];
