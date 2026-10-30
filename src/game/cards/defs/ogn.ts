/*
 * Origins (OGN) Champion Deck cards: the Jinx, Lee Sin and Viktor decks.
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, battlefield, buff, cardSel, channel, cond, costAbility, deal, deathknell, delayed, destSlot, discard,
  draw, eachPlayerKills, facedownSel, fight, gear, grant, iff, keywordTo, kw, legend, legendSel, might,
  mightTo, mode, modal, move, named, onPlay, permanentSel, playerEffect, playSelf, playToken, pred, prog, ready, ref,
  returnToHand, runeSel, slot, spell, spendBuff, statik, unit, unitSel, gearSel, val, when, win, stun,
} from '../../dsl/builders.ts';


export const OGN_DEFS = [
  // ---- Jinx ----
  legend('jinx-loose-cannon', 'At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.', [
    when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([iff(cond.handSize('<=', 1), [draw(1)])])),
  ]),

  unit('brazen-buccaneer', 'As you play me, you may discard a card as an additional cost. If you do, reduce my cost by [2].', {
    abilities: [costAbility({ optional: true, pay: { discard: 1 }, discount: { energy: 2 } })],
  }),

  unit('chemtech-enforcer', '[Assault 2]\nWhen you play me, discard 1.', { abilities: [onPlay(prog([discard(1)]))] }),

  unit('flame-chompers', 'When you discard me, you may pay [R] to play me.', {
    abilities: [when({ on: 'discarded', who: 'self' }, prog([playSelf({ power: ['fury'] })]), { may: true, activeIn: ['trash'] })],
  }),

  spell('get-excited', '[Action]\nDiscard 1. Deal its Energy cost as damage to a unit at a battlefield.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [named('d', discard(1)), deal(val.energyOf(ref.bound('d')), ref.slot('a'))],
  }),

  unit('magma-wurm', 'Other friendly units enter ready.', {
    abilities: [always({ s: 'entersReady', to: unitSel({ rel: 'friendly', other: true }) })],
  }),

  unit('raging-soul', "If you've discarded a card this turn, I have [Assault] and [Ganking].", {
    abilities: [keywordTo(kw.assault(), undefined, { while: cond.thisTurn('discarded') }),
      keywordTo(kw.ganking(), undefined, { while: cond.thisTurn('discarded') })],
  }),

  spell('void-seeker', '[Action]\nDeal 4 to a unit at a battlefield. Draw 1.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(4, ref.slot('a')), draw(1)],
  }),

  unit('jinx-demolitionist', '[Accelerate]\n[Assault 2]\nWhen you play me, discard 2.', { abilities: [onPlay(prog([discard(2)]))] }),

  unit('vi-destructive', '[Ganking]\nRecycle 1 from your trash: Give me +1 [M] this turn.', {
    abilities: [activated({ recycleTrash: { n: 1 } }, prog([might(1, ref.self)]))],
  }),

  unit('cemetery-attendant', 'When you play me, return a unit from your trash to your hand.', {
    abilities: [onPlay(prog([returnToHand(ref.slot('c'))], [slot('c', cardSel({ rel: 'friendly', where: [pred.type('unit')] }))]))],
  }),

  spell('fight-or-flight', '[Hidden]\n[Action]\nMove a unit from a battlefield to its base.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }))],
    body: [move(ref.slot('a'), 'base')],
  }),

  unit('undercover-agent', '[Deathknell][>] Discard 2, then draw 2.', { abilities: [deathknell(prog([discard(2), draw(2)]))] }),

  spell('fading-memories', 'Give a unit at a battlefield or a gear [Temporary].', {
    choose: [slot('a', [unitSel({ at: 'battlefield' }), gearSel()], { harm: true })],
    body: [grant(kw.temporary(), ref.slot('a'), 'permanent')],
  }),

  gear('scrapheap', 'When this is played, discarded, or killed, draw 1.', {
    abilities: [onPlay(prog([draw(1)])), when({ on: 'discarded', who: 'self' }, prog([draw(1)]), { activeIn: ['trash'] }),
      deathknell(prog([draw(1)]))],
  }),

  unit('rhasa-the-sunderer', 'I cost [1] less for each card in your trash.', {
    abilities: [costAbility({ discount: { energy: val.count(cardSel({ rel: 'friendly' })) } })],
  }),

  battlefield('reavers-row', 'When you defend here, you may move a friendly unit here to base.', [
    when({ on: 'defend', who: 'you', at: 'here' }, prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ rel: 'friendly', at: 'here' }))]),
      { may: true, controller: 'eventPlayer' }),
  ]),

  battlefield('targons-peak', 'When you conquer here, ready up to 2 runes at the end of this turn.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' },
      prog([ready(ref.slot('r'))], [slot('r', runeSel({ rel: 'friendly' }), { min: 0, max: 2 })]))]), { controller: 'eventPlayer' }),
  ]),

  battlefield('zaun-warrens', 'When you conquer here, discard 1, then draw 1.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([discard(1), draw(1)]), { controller: 'eventPlayer' }),
  ]),

  // ---- Lee Sin ----
  legend('lee-sin-blind-monk', '[1], [E]: Buff a friendly unit.', [
    activated({ energy: 1, exhaustSelf: true }, prog([buff(ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly' }))])),
  ]),

  spell('charm', 'Move an enemy unit.', {
    choose: [slot('a', unitSel({ rel: 'enemy' }), { harm: true }), destSlot('d', 'a')],
    body: [move(ref.slot('a'), { dest: 'd' })],
  }),

  spell('stand-united', '[Hidden]\n[Action]\nBuff a friendly unit. Buffs give an additional +1 [M] to friendly units this turn.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ rel: 'friendly' }))],
    body: [buff(ref.slot('a')), playerEffect({ s: 'buffValue', n: 1 })],
  }),

  spell('discipline', '[Reaction]\nGive a unit +2 [M] this turn. Draw 1.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel())],
    body: [might(2, ref.slot('a')), draw(1)],
  }),

  gear('mask-of-foresight', 'When a friendly unit attacks or defends alone, give it +1 [M] this turn.', {
    abilities: [
      when({ on: 'attack', who: 'friendly' }, prog([might(1, ref.subject)]), { if: cond.is(ref.subject, pred.alone) }),
      when({ on: 'defend', who: 'friendly' }, prog([might(1, ref.subject)]), { if: cond.is(ref.subject, pred.alone) }),
    ],
  }),

  unit('wizened-elder', "While I'm buffed, I have an additional +1 [M].", {
    abilities: [statik(1, { while: cond.self(pred.buffed) })],
  }),

  unit('bilgewater-bully', "While I'm buffed, I have [Ganking].", {
    abilities: [keywordTo(kw.ganking(), undefined, { while: cond.self(pred.buffed) })],
  }),

  spell('challenge', '[Action]\nChoose a friendly unit and an enemy unit. They deal damage equal to their Mights to each other.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ rel: 'friendly' })), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [fight(ref.slot('a'), ref.slot('b'))],
  }),

  unit('pit-rookie', 'When you play me, buff another friendly unit.', {
    abilities: [onPlay(prog([buff(ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', other: true }))]))],
  }),

  unit('wildclaw-shaman', 'When you play me, you may spend a buff to buff me and ready me.', {
    abilities: [onPlay(prog([named('sb', spendBuff(unitSel({ rel: 'friendly' }))), iff(cond.did('sb'), [buff(ref.self), ready(ref.self)])]),
      { may: true })],
  }),

  unit('lee-sin-centered', '[Accelerate]\nOther buffed friendly units at my battlefield have +2 [M].', {
    abilities: [mightTo(2, unitSel({ rel: 'friendly', other: true, at: 'here', where: [pred.buffed] }),
      { while: cond.selfAt('battlefield') })],
  }),

  gear('mistfall', 'When you buff a friendly unit, you may pay [O] and exhaust this to ready it.', {
    abilities: [when({ on: 'buffed', who: 'friendly' }, prog([ready(ref.subject)]), { may: true, cost: { power: ['body'], exhaustSelf: true } })],
  }),

  unit('udyr-wildman',
    "Spend my buff: Choose one you've not chosen this turn —\n• Deal 2 to a unit at a battlefield.\n• Stun a unit at a battlefield.\n"
    + '• Ready me.\n• Give me [Ganking] this turn.', {
      abilities: [activated({ spendBuffSelf: true }, modal(1, [
        mode('Deal 2 to a unit at a battlefield.', [deal(2, ref.slot('a'))], [slot('a', unitSel({ at: 'battlefield' }), { harm: true })]),
        mode('Stun a unit at a battlefield.', [stun(ref.slot('b'))], [slot('b', unitSel({ at: 'battlefield' }), { harm: true })]),
        mode('Ready me.', [ready(ref.self)]),
        mode('Give me [Ganking] this turn.', [grant(kw.ganking(), ref.self)]),
      ]), { modesOncePerTurn: true })],
    }),

  battlefield('grove-of-the-god-willow', 'When you hold here, draw 1.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([draw(1)]), { controller: 'eventPlayer' }),
  ]),

  battlefield('monastery-of-hirana', 'When you conquer here, you may spend a buff to draw 1.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([named('sb', spendBuff(unitSel({ rel: 'friendly' }))),
      iff(cond.did('sb'), [draw(1)])]), { may: true, controller: 'eventPlayer' }),
  ]),

  // ---- Viktor ----
  legend('viktor-herald-of-the-arcane', '[1], [E]: Play a 1 [M] Recruit unit token.', [
    activated({ energy: 1, exhaustSelf: true }, prog([playToken('recruit', 1, 'choose')])),
  ]),

  spell('consult-the-past', '[Hidden]\n[Reaction]\nDraw 2.', { kw: [kw.reaction()], body: [draw(2)] }),

  gear('orb-of-regret', '[E]: Give a unit -1 [M] this turn, to a minimum of 1 [M].', {
    abilities: [activated({ exhaustSelf: true }, prog([might(1, ref.slot('a'), -1, { floor: 1 })], [slot('a', unitSel(), { harm: true })]))],
  }),

  spell('smoke-screen', '[Reaction]\nGive a unit -4 [M] this turn, to a minimum of 1 [M].', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [might(4, ref.slot('a'), -1, { floor: 1 })],
  }),

  spell('sprite-call', '[Hidden]\n[Action]\nPlay a ready 3 [M] Sprite unit token with [Temporary].', {
    kw: [kw.action()],
    body: [playToken('sprite', 1, 'choose', { ready: true })],
  }),

  gear('mushroom-pouch', 'At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1.', {
    abilities: [when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([draw(1)]),
      { if: cond.count(facedownSel({ rel: 'friendly' }), '>=', 1) })],
  }),

  unit('heimerdinger-inventor', 'I have all [E] abilities of all friendly legends, units, and gear.', {
    abilities: [always({ s: 'copyAbilities', of: [legendSel({ rel: 'friendly' }), permanentSel({ rel: 'friendly' })] })],
  }),

  unit('viktor-innovator', "When you play a card on an opponent's turn, play a 1 [M] Recruit unit token to your base.", {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { card: true } }, prog([playToken('recruit', 1, 'yourBase')]),
      { if: cond.not(cond.yourTurn) })],
  }),

  unit('wraith-of-echoes', 'The first time another friendly unit dies each turn, draw 1.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendlyOther' }, prog([draw(1)]), { first: 'turn' })],
  }),

  unit('cruel-patron', 'As an additional cost to play me, kill a friendly unit.', {
    abilities: [costAbility({ pay: { kill: { sel: unitSel({ rel: 'friendly' }), n: 1 } } })],
  }),

  spell('cull-the-weak', 'Each player kills one of their units.', { body: [eachPlayerKills(1)] }),

  unit('soaring-scout', '[Deathknell][>] Channel 1 rune exhausted.', { abilities: [deathknell(prog([channel(1, { exhausted: true })]))] }),

  spell('grand-strategem', '[Action]\nGive friendly units +5 [M] this turn.', {
    kw: [kw.action()],
    body: [might(5, unitSel({ rel: 'friendly' }))],
  }),

  battlefield('altar-to-unity', 'When you hold here, play a 1 [M] Recruit unit token in your base.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([playToken('recruit', 1, 'yourBase')]), { controller: 'eventPlayer' }),
  ]),

  battlefield('the-grand-plaza', 'When you hold here, if you have 7+ units here, you win the game.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([win]), { controller: 'eventPlayer',
      if: cond.count(unitSel({ rel: 'friendly', at: 'here' }), '>=', 7) }),
  ]),
];

