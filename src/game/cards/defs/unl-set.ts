/*
 * Unleashed (UNL): the cards of the set beyond its Champion Decks (unl.ts).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, banish, battlefield, bfSel, cardSel, channel, choiceBy, choose, cond, costAbility, counter, deal,
  dealSplit, deathknell, delayed, destSlot, discard, draw, eachPlayerKills, entersReady, exhaust, fight, forEach, gainControl, kill,
  gainXp, gear, grant, iff, keywordTo, kw, might, mightTo, move, named, onPlay, playFree, pred, predict, prog, ready,
  recall, ref, returnToHand, revealHand, slot, spell, spellSel, stun, unit, unitSel, val, when, addPower, detach,
  addEnergy, buff, cardSel as cards, gold, legend, look, modal, mode, pickWhere, playCard, playToken, recycle, recycleRest,
  replay, revealTop, PETS, discardCards, keywordTo as kwTo, opponentsDraw, pay, points, runeSel, statik, win,
  doubleDamage, permanentSel, playerEffect, putOnTop, toTrash, facedownSel, gearSel, swap, lookAt, banishIfDies, replacement,
} from '../../dsl/builders.ts';

const friendly = unitSel({ rel: 'friendly' });
const hold = { on: 'hold', who: 'you', at: 'here' } as const;

export const UNL_SET_DEFS = [
  // ---- batch 1 ----
  spell('abandon', "[Reaction]\nCounter a spell. Return it to its owner's hand instead of putting it in their trash.\n[Predict].", {
    kw: [kw.reaction()], choose: [slot('a', spellSel(), { harm: true })], body: [counter(ref.slot('a'), 'hand'), predict(1)],
  }),
  battlefield('abandoned-hall', 'When a player plays a spell, they may give a unit they control here +1 [M] this turn.', [
    when({ on: 'cardPlayed', by: 'anyPlayer', what: { types: ['spell'] } }, prog([might(1, ref.slot('a'))],
      [slot('a', unitSel({ rel: 'friendly', at: 'here' }))]), { may: true, controller: 'eventPlayer' }),
  ]),
  spell('alpha-strike', '[Action]\nChoose a friendly unit. It deals damage equal to its Might split among enemy units at battlefields. Then for each unit this kills, do this: Gain 1 XP.', {
    kw: [kw.action()], choose: [slot('a', friendly)],
    body: [delayed(999, { on: 'objDies' }, prog([gainXp(1)])),
      dealSplit(val.might(ref.slot('a')), unitSel({ rel: 'enemy', at: 'battlefield' }), ref.slot('a'))],
  }),
  unit('alpha-wildclaw', "[Tank]\nYour units here with less Might than me can't be chosen by enemy spells and abilities.", {
    abilities: [always({ s: 'noEnemyChoose', to: unitSel({ rel: 'friendly', at: 'here', where: [pred.mightVsSource('<')] }) })],
  }),
  battlefield('altar-of-blood', 'If a unit here would die during combat, its controller may pay [A][A][A] to heal it, exhaust it, and recall it instead.', [
    always({ s: 'saveHere', cost: { power: ['A', 'A', 'A'] }, combat: true }),
  ]),
  unit('angler-beast', "When you play me, return all units with 2 [M] or less to their owners' hands.", {
    abilities: [onPlay(prog([returnToHand(unitSel({ where: [pred.might('<=', 2)] }))]))],
  }),
  unit('arachnoid-horror', '[Hunt 2]\nI can be played to an occupied battlefield if an enemy unit is alone there.\nFriendly units can be played to an occupied battlefield if an enemy unit is alone there.', {
    abilities: [always({ s: 'playTo', where: 'enemyAlone' }), always({ s: 'othersPlayTo', where: 'enemyAlone', types: ['unit'] })],
  }),
  unit('ashe-focused', 'When you play me, choose an opponent. They reveal their hand. Choose a card revealed this way and banish it. When they hold, return it to their hand.', {
    abilities: [onPlay(prog([revealHand, choose(cardSel({ in: 'hand', rel: 'enemy' }), 'c'), named('b', banish(ref.bound('c'))),
      delayed(1, { on: 'hold', who: 'opponent', at: 'any' }, prog([returnToHand(ref.info('b'))]), { capture: { b: ref.bound('b') }, lasting: true })]))],
  }),
  unit('atakhan', 'You may kill a friendly unit as an additional cost to play me. If you do, I cost [1] less for each Energy it costs and [Y] less for each Power it costs.\n[Ganking]\nWhen I attack, the defender must kill one of their units here.', {
    abilities: [costAbility({ optional: true, pay: { kill: { sel: friendly, n: 1 } }, lessByPaid: { power: 'order' } }),
      when({ on: 'attack', who: 'self' }, prog([eachPlayerKills(1, { who: 'opponents', at: 'here' })]))],
  }),
  unit('bandle-soldier', '[Level 3][>] I enter ready.', { abilities: [entersReady({ while: cond.level(3) })] }),
  unit('baron-nashor', "As you play me, add the Baron Pit battlefield token to the board if it's not there already. If you do, I enter there.\nI can't be chosen by enemy spells and abilities.\nOther friendly units have +2 [M].", {
    abilities: [always({ s: 'addBfToken', token: 'baronPit' }), always({ s: 'noEnemyChoose' }),
      mightTo(2, unitSel({ rel: 'friendly', other: true }))],
  }),
  unit('bewitching-spirit', 'When you play me, choose a player. They discard 1.', {
    abilities: [onPlay(prog([choiceBy('self', [{ label: 'You', body: [discard(1)] },
      { label: 'An opponent', body: [forEach('opponents', 'next', [discard(1)])] }])]))],
  }),
  battlefield('black-flame-altar', 'Units here with [Temporary] have [Shield].', [
    keywordTo(kw.shield(), unitSel({ at: 'here', where: [pred.keyword('temporary')] })),
  ]),
  unit('black-rose-dignitary', '[Assault]\n[Deathknell][>] Channel 1 rune exhausted.', {
    abilities: [deathknell(prog([channel(1, { exhausted: true })]))],
  }),
  gear('blighted-battleaxe', "[Equip] [1][R]\nAt the end of your turn, if I didn't conquer this turn, unattach this and deal 4 to me.", {
    abilities: [when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([detach(ref.this), deal(4, ref.self)]),
      { effectText: true, if: cond.not(cond.scoredThisTurn('conquer')) })],
  }),
  gear('blood-rose', 'When you play a unit, you may pay [1] to gain 1 XP.\nSpend 3 XP, [E]: Ready a unit.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([gainXp(1)]), { may: true, cost: { energy: 1 } }),
      activated({ xp: 3, exhaustSelf: true }, prog([ready(ref.slot('a'))], [slot('a', unitSel())]))],
  }),
  unit('blue-sentinel', '[Shield 2]\nYour hold effects for holding here trigger an additional time.\nWhen I hold, [Add] [A] at the start of your next Main Phase.', {
    abilities: [always({ s: 'extraScoreTriggers', how: 'hold' }),
      when(hold, prog([delayed(1, { on: 'phase', at: 'mainStart', whose: 'your' }, prog([addPower(1)]))]))],
  }),
  spell('bone-skewer', '[Hidden]\nChoose a battlefield. An opponent reveals their hand. You may choose a unit from it. They play that unit to that battlefield, ignoring any and all costs. If they do, then do this: [Stun] it.', {
    choose: [slot('b', bfSel())],
    body: [revealHand, choose(cardSel({ in: 'hand', rel: 'enemy', where: [pred.type('unit')] }), 'c', { min: 0, max: 1 }),
      named('p', playFree(ref.bound('c'), 'all', { by: 'owner', atRef: ref.slot('b') })),
      iff(cond.did('p'), [delayed(1, { on: 'cardPlayed', by: 'opponent', what: { types: ['unit'] } }, prog([stun(ref.subject)]))])],
  }),
  spell('call-to-battle', 'Move a unit you control to a battlefield you control. Then, choose an opponent. They move a unit they control to the same battlefield.', {
    choose: [slot('a', friendly), destSlot('d', 'a', 'controlled')],
    body: [move(ref.slot('a'), { dest: 'd' }), forEach('opponents', 'next', [choose(friendly, 'u'), move(ref.bound('u'), { dest: 'd' })])],
  }),
  unit('chakram-dancer', '[Ambush]\nWhen you play me, give your other units here [Shield] this turn.', {
    abilities: [onPlay(prog([grant(kw.shield(), unitSel({ rel: 'friendly', other: true, at: 'here' }))]))],
  }),
  spell('clash-of-giants', 'Choose two units. They deal damage equal to their Mights to each other.', {
    choose: [slot('a', unitSel()), slot('b', unitSel(), { distinctFrom: ['a'] })], body: [fight(ref.slot('a'), ref.slot('b'))],
  }),
  spell('concentrate', 'Draw 2.\n[Level 6][>] This costs [2] less.\n[Level 11][>] This costs [4] less instead.', {
    abilities: [costAbility({ discount: { energy: 2 }, while: cond.and(cond.level(6), cond.not(cond.level(11))) }),
      costAbility({ discount: { energy: 4 }, while: cond.level(11) })],
    body: [draw(2)],
  }),
  spell('conscription', 'You may spend 5 XP as an additional cost to play this.\nChoose an enemy unit at a battlefield with 3 [M] or less. If you paid the additional cost, choose any enemy unit at a battlefield instead. Take control of it, exhaust it, and recall it.', {
    abilities: [costAbility({ optional: true, pay: { xp: 5 } })],
    choose: [slot('a', unitSel({ rel: 'enemy', at: 'battlefield', where: [pred.might('<=', 3)] }), { harm: true, if: cond.not(cond.paid('conscription#0')) }),
      slot('b', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true, if: cond.paid('conscription#0') })],
    body: [named('c', gainControl(ref.slot('a'))), named('d', gainControl(ref.slot('b'))), exhaust(ref.bound('c')), recall(ref.bound('c')),
      exhaust(ref.bound('d')), recall(ref.bound('d'))],
  }),
  unit('crescent-guardian', "If you've played a spell this turn, you may pay [P] as an additional cost to play me. If you do, I enter ready.", {
    abilities: [costAbility({ optional: true, add: { power: ['chaos'] }, accelerate: true, while: cond.thisTurn('played', { types: ['spell'] }) })],
  }),
  spell('crescent-strike', '[Action]\nChoose a battlefield and an enemy unit there. Deal 4 to that unit and 1 to each other enemy unit there.', {
    kw: [kw.action()], choose: [slot('b', bfSel()), slot('a', unitSel({ rel: 'enemy', at: { slot: 'b' } }), { harm: true })],
    // One instruction, one Deal action dealing 4 and 1 at the same time [418.1.d].
    body: [{ op: 'deal', n: 4, to: ref.slot('a'), and: { n: 1, to: unitSel({ rel: 'enemy', at: { slot: 'b' }, where: [pred.notSlot('a')] }) } }],
  }),

  // ---- batch 2 ----
  unit('crowd-favorite', '[Hunt]\nSpend 2 XP: [Buff] me.', { abilities: [activated({ xp: 2 }, prog([buff(ref.self)]))] }),
  gear('cursed-sarcophagus', 'When you play this, banish all units from your trash.\n[E]: Play a unit banished with this.', {
    abilities: [onPlay(prog([{ op: 'banish', what: cards({ rel: 'friendly', where: [pred.type('unit')] }), linkGroup: 'cursed-sarcophagus' }])),
      activated({ exhaustSelf: true }, prog([playCard(ref.slot('c'))],
        [slot('c', cards({ in: 'banish', rel: 'friendly', where: [pred.type('unit'), { p: 'linked', group: 'cursed-sarcophagus' }] }))]))],
  }),
  spell('curtain-call', "[Repeat] — [1] / [A] / [1][A]\nChoose one you haven't already chosen —\n• Draw 1.\n• Deal 2 to a unit at a battlefield.\n• Deal 3 to a unit at a base.\n• Give a unit at a battlefield -4 [M] this turn.", {
    modes: { pick: 1, distinct: true, of: [mode('Draw 1', [draw(1)]),
      mode('Deal 2 to a unit at a battlefield', [deal(2, ref.slot('a'))], [slot('a', unitSel({ at: 'battlefield' }), { harm: true })]),
      mode('Deal 3 to a unit at a base', [deal(3, ref.slot('b'))], [slot('b', unitSel({ at: 'base' }), { harm: true })]),
      mode('Give a unit at a battlefield -4', [might(4, ref.slot('c'), -1)], [slot('c', unitSel({ at: 'battlefield' }), { harm: true })])] },
    body: [],
  }),
  unit('daisy', 'I enter ready.\nReduce my cost by [1] for each of the following tags among your units — Bird, Cat, Dog, and Poro.\nWhen I attack while your units have all 4 tags, [Stun] an enemy unit here.', {
    abilities: [entersReady(), costAbility({ discount: { energy: val.tagsAmong(PETS) } }),
      when({ on: 'attack', who: 'self' }, prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]),
        { if: cond.tags(PETS) })],
  }),
  spell('dancing-grenade', 'Deal 2 to a unit. Its controller may play this spell again for [A]. If they do, this deals 1 additional Bonus Damage for each time this spell has dealt damage this turn.', {
    choose: [slot('a', unitSel(), { harm: true })],
    body: [deal(val.sum(2, val.cardDeals), ref.slot('a')), replay({ power: ['A'] }, { controllerOf: ref.slot('a') })],
  }),
  spell('deadly-flourish', 'Deal 3 to an enemy unit. When it dies this turn, play a Gold gear token exhausted.', {
    choose: [slot('a', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [delayed(1, { on: 'objDies', info: 'u', any: true }, prog([gold(1)]), { capture: { u: ref.slot('a') } }), deal(3, ref.slot('a'))],
  }),
  spell('death-from-below', 'Kill a unit at a battlefield. Then, if it had 3 [M] or less, do this: You may play this from your trash for [A].', {
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [kill(ref.slot('a')), iff(cond.val(val.might(ref.slot('a')), '<=', 3), [replay({ power: ['A'] })])],
  }),
  unit('demacian-diplomat', 'When you play me, gain 1 XP.', { abilities: [onPlay(prog([gainXp(1)]))] }),
  unit('determined-sentry', "I can't move to base.", { abilities: [always({ s: 'noMoveToBase', self: true })] }),
  unit('diana-lunari', "When a showdown begins here, you may pay [1] to [Predict], then reveal the top card of your Main Deck. If it's a spell, draw it.", {
    abilities: [when({ on: 'showdownStart', at: 'here' }, prog([predict(1), revealTop('r'),
      iff(cond.is(ref.bound('r'), pred.type('spell')), [draw(1, ref.bound('r'))])]), { may: true, cost: { energy: 1 } })],
  }),
  legend('diana-scorn-of-the-moon', '[Reaction][>] [E]: [Add] [1]. Spend this Energy only during showdowns.', [
    // A [Reaction] Add ability: usable any time; the Energy may be spent only while a showdown is going on [430], [163].
    activated({ exhaustSelf: true }, prog([{ op: 'add', energy: 1, onlyFor: 'showdown' }]), { timing: 'reaction', isAdd: true }),
  ]),
  spell('disposal-order', "[Reaction]\nChoose one —\n• Choose up to 3 cards from opponents' trashes. Their owners recycle them.\n• Draw 1.", {
    kw: [kw.reaction()],
    ...modal(1, [mode('Recycle up to 3 cards from opponents\' trashes', [recycle(ref.slot('c'))], [slot('c', cards({ rel: 'enemy' }), { min: 0, max: 3, harm: true })]),
      mode('Draw 1', [draw(1)])]),
  }),
  spell('double-trouble', '[Repeat] [2]\nLook at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.', {
    body: [look(3, 'l'), pickWhere('l', 1, 'u', { min: 0, where: [pred.type('unit')] }), draw(1, ref.bound('u')), recycleRest('l', 'u')],
  }),
  spell('downstage-dramatics', '[Reaction]\n[Repeat] [2]\nDraw 1.', { kw: [kw.reaction()], body: [draw(1)] }),
  unit('dragonsoul-sage', '[Reaction][>] [E]: [Add] [1].', {
    abilities: [activated({ exhaustSelf: true }, prog([addEnergy(1)]), { timing: 'reaction', isAdd: true })],
  }),
  unit('dramatic-visionary', '[Deathknell][>] [Predict 2].', { abilities: [deathknell(prog([predict(2)]))] }),
  battlefield('dusk-rose-lab', 'At the start of your Beginning Phase, you may kill a unit you control here to draw 1.', [
    when({ on: 'phase', at: 'beginning', whose: 'any' }, prog([draw(1)]),
      { may: true, cost: { kill: { sel: unitSel({ rel: 'friendly', at: 'here' }), n: 1 } }, controller: 'eventPlayer' }),
  ]),
  spell('eclipse', '[Reaction]\nGive a unit -4 [M] this turn.\n[Predict].', {
    kw: [kw.reaction()], choose: [slot('a', unitSel(), { harm: true })], body: [might(4, ref.slot('a'), -1), predict(1)],
  }),
  unit('elder-dragon', 'Any amount of your damage is enough to kill enemy units.\nWhen you play me, choose up to one enemy unit at each location. Deal 1 to them.', {
    // Unleashed FAQ: targets, up to one per location, each restricted to the location it was chosen at.
    abilities: [always({ s: 'anyDamageKills' }), onPlay(prog([deal(1, ref.slot('e'))],
      [slot('e', unitSel({ rel: 'enemy' }), { min: 0, max: 99, oneEachLoc: true, harm: true })]))],
  }),
  unit('enthralling-protector', '[Hunt]\nSpend 2 XP: [Buff] me.', { abilities: [activated({ xp: 2 }, prog([buff(ref.self)]))] }),
  unit('evershade-stalker', 'When you play me, discard 1, then draw 1.', { abilities: [onPlay(prog([discard(1), draw(1)]))] }),
  unit('fate-weaver', 'When you play me, look at the top 4 cards of your Main Deck. You may reveal a spell with Energy cost [4] or more from among them and draw it. Recycle the rest.', {
    abilities: [onPlay(prog([look(4, 'l'), pickWhere('l', 1, 'c', { min: 0, where: [pred.type('spell'), pred.energyCost('>=', 4)] }),
      draw(1, ref.bound('c')), recycleRest('l', 'c')]))],
  }),
  spell('flurry-of-feathers', '[Reaction]\nChoose one —\n• Counter a spell.\n• Play four 1 [M] Bird unit tokens with [Deflect].', {
    kw: [kw.reaction()],
    ...modal(1, [mode('Counter a spell', [counter(ref.slot('s'))], [slot('s', spellSel(), { harm: true })]),
      mode('Play four Birds', [playToken('bird', 4, 'choose')])]),
  }),
  battlefield('forbidding-waste', 'While a unit here is defending alone, it has -2 [M].', [
    always({ s: 'might', n: 2, dec: true, to: unitSel({ at: 'here', where: [pred.defending, pred.alone] }) }),
  ]),
  battlefield('forgotten-library', 'While you control this battlefield, when you play a spell, if you spent [4] or more, [Predict].', [
    when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'], minSpent: 4 } }, prog([predict(1)]), { if: cond.controlsSelf }),
  ]),

  // ---- batch 3 ----
  gear('forgotten-signpost', '[Action][>] Exhaust a unit you control, [E]: Move a different unit you control to the location of the unit you exhausted to pay for this ability.', {
    abilities: [activated({ exhaust: { sel: friendly, n: 1 }, exhaustSelf: true }, prog([move(ref.slot('u'), { locOf: ref.paid('exhaust') })],
      [slot('u', friendly)]), { timing: 'action' })],
  }),
  gear('fresh-beans', 'When you play a unit during a showdown, you may exhaust this to draw 1.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([draw(1)]),
      { may: true, cost: { exhaustSelf: true }, if: cond.showdown })],
  }),
  spell('friendship', '[Reaction]\nChoose a unit. Give it +1 [M] this turn for each of the following tags among your units — Bird, Cat, Dog, and Poro.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel())], body: [might(val.tagsAmong(PETS), ref.slot('a'))],
  }),
  gear('frigid-jewel', 'When you draw your second card each turn, give a friendly unit +2 [M] this turn.', {
    abilities: [when({ on: 'drew', nth: 2 }, prog([might(2, ref.slot('a'))], [slot('a', friendly)]))],
  }),
  unit('frisky-hunter', 'When you play me, play a 1 [M] Bird unit token with [Deflect] here.', {
    abilities: [onPlay(prog([playToken('bird', 1, 'here')]))],
  }),
  battlefield('frozen-fortress', "At the start of each player's Beginning Phase, deal 1 to each unit here.", [
    when({ on: 'phase', at: 'beginning', whose: 'any' }, prog([deal(1, unitSel({ at: 'here' }))]), { controller: 'eventPlayer' }),
  ]),
  unit('galio-indefatigable', "[Deflect]\n[Tank]\nI don't deal combat damage.", { abilities: [always({ s: 'noCombatDamage' })] }),
  unit('gemhand-hunter', '[Hunt]\n[Level 6][>] I have +1 [M].', { abilities: [statik(1, { while: cond.level(6) })] }),
  unit('gentle-gemdragon', 'When you play me or another Dragon, ready up to 2 runes.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { tag: 'Dragon' } }, prog([choose(runeSel({ rel: 'friendly', where: [pred.exhausted] }), 'r',
      { min: 0, max: 2 }), ready(ref.bound('r'))]))],
  }),
  unit('grim-apothecary', "[Ambush]\nWhen you play me, you may return a friendly unit at a battlefield to its owner's hand.", {
    abilities: [onPlay(prog([returnToHand(ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', at: 'battlefield' }))]), { may: true })],
  }),
  spell('grim-resolve', '[Action]\nGive a friendly unit +3 [M] this turn. When it wins a combat this turn, gain 2 XP.', {
    kw: [kw.action()], choose: [slot('a', friendly)],
    body: [might(3, ref.slot('a')), delayed(1, { on: 'winCombat', who: 'self', info: 'u' }, prog([gainXp(2)]), { capture: { u: ref.slot('a') } })],
  }),
  unit('gustwalker', '[Hunt 2]\n[Level 3][>] I have +1 [M] and [Ganking].', {
    abilities: [statik(1, { while: cond.level(3) }), kwTo(kw.ganking(), undefined, { while: cond.level(3) })],
  }),
  gear('gutter-palace', 'At the start of your Beginning Phase, if you have exactly 4 cards in hand and exactly 4 units at battlefields, you win the game.\nDiscard 1, [E]: Play a 1 [M] Bird unit token with [Deflect].', {
    abilities: [when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([win]),
      { if: cond.and(cond.handSize('=', 4), cond.count(unitSel({ rel: 'friendly', at: 'battlefield' }), '=', 4)) }),
      activated({ discard: 1, exhaustSelf: true }, prog([playToken('bird', 1, 'choose')]))],
  }),
  spell('heedless-resurrection', '[Reaction]\nAs an additional cost to play this, kill a friendly unit.\nPlay a unit from your trash that costs no more Energy and no more Power than the killed unit, ignoring its cost.', {
    kw: [kw.reaction()], abilities: [costAbility({ pay: { kill: { sel: friendly, n: 1 } } })],
    body: [choose(cards({ rel: 'friendly', where: [pred.type('unit'), pred.costAtMostPaid] }), 'c'), playFree(ref.bound('c'))],
  }),
  spell('heroic-charge', '[Action]\nGive a friendly unit +1 [M] this turn and [Stun] an enemy unit at its location.', {
    kw: [kw.action()], choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy', at: { slot: 'a' } }), { harm: true })],
    body: [might(1, ref.slot('a')), stun(ref.slot('b'))],
  }),
  gear('honeyfruit', 'This enters exhausted.\n[Reaction][>] [E]: [Add] [A].\n[Level 6][>] [>>][Reaction][>] [E]: [Add] [1][A].', {
    abilities: [always({ s: 'entersExhausted' }), activated({ exhaustSelf: true }, prog([addPower(1)]), { timing: 'reaction', isAdd: true }),
      activated({ exhaustSelf: true }, prog([addEnergy(1), addPower(1)]), { timing: 'reaction', isAdd: true, while: cond.level(6) })],
  }),
  unit('hwei-brooding-painter', "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's type:\n• Spell — Draw 1.\n• Gear — Ready up to 2 runes.\n• Unit — Give me +3 [M] this turn.", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([draw(1), named('d', discard(1)),
      iff(cond.is(ref.now(ref.bound('d')), pred.type('spell')), [draw(1)]),
      iff(cond.is(ref.now(ref.bound('d')), pred.type('gear')), [choose(runeSel({ rel: 'friendly', where: [pred.exhausted] }), 'r', { min: 0, max: 2 }),
        ready(ref.bound('r'))]),
      iff(cond.is(ref.now(ref.bound('d')), pred.type('unit')), [might(3, ref.self)])]))],
  }),
  unit('icevale-archer', 'When I attack, you may pay [1] to give a unit here -1 [M] this turn.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([might(1, ref.slot('a'), -1)], [slot('a', unitSel({ at: 'here' }), { harm: true })]),
      { may: true, cost: { energy: 1 } })],
  }),
  unit('imposing-challenger', 'When I move, you may move an enemy unit here with less Might than me to a different battlefield.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([move(ref.slot('a'), { dest: 'd' })],
      [slot('a', unitSel({ rel: 'enemy', at: 'here', where: [pred.mightVsSource('<')] }), { harm: true }), destSlot('d', 'a', 'bf')]), { may: true })],
  }),
  unit('insightful-investigator', 'When you play me, choose an opponent. They reveal their hand. You may pay 2 XP to choose a card from their hand. If you do, they discard that card and draw 1.', {
    abilities: [onPlay(prog([revealHand, named('x', pay({ xp: 2 })),
      iff(cond.did('x'), [choose(cards({ in: 'hand', rel: 'enemy' }), 'c'), discardCards(ref.bound('c')), opponentsDraw(1)])]))],
  }),
  unit('inviolus-vox', 'When I conquer, give a friendly unit +8 [M] this turn.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([might(8, ref.slot('a'))], [slot('a', friendly)]))],
  }),
  unit('irresistible-faefolk', 'When I move to a battlefield, you may move an enemy unit to that battlefield.', {
    abilities: [when({ on: 'moved', who: 'self', to: 'bf' }, prog([move(ref.slot('a'), { info: 'bf' })], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]),
      { may: true })],
  }),
  spell('isolate', "Move an enemy unit from a battlefield to its base. Then, if there's an enemy unit alone at that battlefield, draw 1.", {
    choose: [slot('a', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true })],
    body: [move(ref.slot('a'), 'base'), iff(cond.count(unitSel({ rel: 'enemy', at: { slot: 'was:a' }, where: [pred.alone] }), '>=', 1), [draw(1)])],
  }),
  unit('ivern-friend-to-all', 'As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag.\nWhen I conquer or hold, score 1 point if your units have all of the following tags among them — Bird, Cat, Dog, and Poro.', {
    abilities: [always({ s: 'chooseTag', tags: PETS }), when({ on: 'score', who: 'you', at: 'here' }, prog([iff(cond.tags(PETS), [points(1)])]))],
  }),
  legend('ivern-green-father', 'When you conquer or hold, you may exhaust me to replace that battlefield with a Brush battlefield token.', [
    when({ on: 'score', who: 'you', at: 'any' }, prog([{ op: 'replaceBf', token: 'brush', at: 'eventBf' }]), { may: true, cost: { exhaustSelf: true } }),
  ]),

  // ---- batch 4 ----
  ...(() => {
    const nurture = prog([look(3, 'l'), pickWhere('l', 1, 'u', { min: 0, where: [pred.type('unit')] }), draw(1, ref.bound('u')), recycleRest('l', 'u'),
      iff(cond.is(ref.now(ref.bound('u')), pred.anyTag(...PETS)), [choose(friendly, 'b'), buff(ref.bound('b'))])]);
    return [unit('ivern-nurturer', 'When you play me or when I hold, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest. Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit.', {
      abilities: [onPlay(nurture), when(hold, nurture)],
    })];
  })(),
  unit('jhin-meticulous-killer', "[Vision]\nIf you've spent [4] or more to play a spell this turn, you may play me for [B].", {
    abilities: [costAbility({ optional: true, alt: { power: ['mind'] }, while: cond.thisTurn('played', { types: ['spell'], minSpent: 4 }) })],
  }),
  unit('jhin-murderous-artist', '[Deflect]\n[Ganking]\nWhen I move, [Add] [1][A].', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([addEnergy(1), addPower(1)]))],
  }),
  legend('jhin-virtuoso', 'When you play a spell, if you spent [4] or more, you may banish it. Then, if there are four spells banished with me, put each in its trash, channel 4 runes, and draw 1.', [
    when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'], minSpent: 4 } }, prog([
      { op: 'banish', what: ref.info('cardObj'), linkGroup: 'jhin-virtuoso' },
      iff(cond.count(cards({ in: 'banish', rel: 'friendly', where: [{ p: 'linked', group: 'jhin-virtuoso' }] }), '>=', 4),
        [toTrash(cards({ in: 'banish', rel: 'friendly', where: [{ p: 'linked', group: 'jhin-virtuoso' }] })), channel(4), draw(1)])]), { may: true }),
  ]),
  unit('katarina-reckless', 'When you hide a card, ready me.\nWhen you play a card from face down, deal 2 to an enemy unit.', {
    abilities: [when({ on: 'hid', at: 'any' }, prog([ready(ref.self)])),
      when({ on: 'cardPlayed', by: 'you', what: { fromFacedown: true } }, prog([deal(2, ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  unit('keeper-of-masks', '[Hidden]\n[Temporary]\nWhen you play me, play two Reflection unit tokens here. Then do this: They become copies of me.', {
    abilities: [onPlay(prog([playToken('reflection', 2, 'here', { copyOf: ref.self })]))],
  }),
  spell('keepers-verdict', '[Action]\nChoose an enemy unit at a battlefield. Its owner places it on the top or bottom of their Main Deck.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true })],
    body: [choiceBy({ controllerOf: ref.slot('a') }, [{ label: 'Top', body: [putOnTop(ref.slot('a'))] }, { label: 'Bottom', body: [recycle(ref.slot('a'))] }])],
  }),
  ...(() => {
    const ifAlone = { if: cond.count(unitSel({ rel: 'enemy', at: 'here', where: [pred.alone] }), '>=', 1) };
    const fx = prog([might(2, ref.self), gainXp(2)]);
    return [unit('khazix-mutating-horror', '[Ambush]\nWhen I attack or defend, if an enemy unit is alone here, give me +2 [M] this turn and gain 2 XP.', {
      abilities: [when({ on: 'attack', who: 'self' }, fx, ifAlone), when({ on: 'defend', who: 'self' }, fx, ifAlone)],
    })];
  })(),
  legend('khazix-voidreaver', 'When you win a combat, gain 1 XP.\nSpend 1 XP, [E]: [Buff] a unit.\nSpend 2 XP, [E]: Move an exhausted friendly unit from a battlefield to its base.', [
    when({ on: 'winCombat', who: 'you' }, prog([gainXp(1)])),
    activated({ xp: 1, exhaustSelf: true }, prog([buff(ref.slot('a'))], [slot('a', unitSel())])),
    activated({ xp: 2, exhaustSelf: true }, prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ rel: 'friendly', at: 'battlefield', where: [pred.exhausted] }))])),
  ]),
  unit('kinkou-initiate', 'When you play me, draw 1 if your other units have total Might 5 or more.', {
    abilities: [onPlay(prog([iff(cond.val(val.sumMight(unitSel({ rel: 'friendly', other: true })), '>=', 5), [draw(1)])]))],
  }),
  legend('leblanc-deceiver', 'When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. Then do this: It becomes a copy of another unit there. Give it [Temporary].', [
    when({ on: 'score', who: 'you', at: 'any' }, prog([choose(unitSel({ at: 'eventBf' }), 'c'),
      playToken('reflection', 1, { info: 'bf' }, { ready: true, copyOf: ref.bound('c'), give: [kw.temporary()] })]),
    { may: true, cost: { discard: 1, exhaustSelf: true } }),
  ]),
  unit('leblanc-everywhere-at-once', "[Backline]\nYour [Temporary] effects at my battlefield don't trigger.", {
    abilities: [always({ s: 'noTemporaryTrigger', to: permanentSel({ rel: 'friendly', at: 'here' }) }, { while: cond.selfAt('battlefield') })],
  }),
  unit('leblanc-fragmented', "[Assault]\n[Deathknell][>] Draw 1. If it's your Beginning Phase, draw 2 instead.", {
    abilities: [deathknell(prog([iff(cond.yourBeginning, [draw(2)], [draw(1)])]))],
  }),
  legend('lillia-bashful-bloom', '[4], [E]: Play a ready 3 [M] Sprite unit token with [Temporary]. This ability costs [1] less for each friendly unit with [Temporary].', [
    activated({ energy: 4, exhaustSelf: true, energyLessBy: val.count(unitSel({ rel: 'friendly', where: [pred.keyword('temporary')] })) },
      prog([playToken('sprite', 1, 'choose', { ready: true })])),
  ]),
  unit('lillia-fae-fawn', '[Accelerate]\nWhen I move from a location, play a 3 [M] Sprite unit token with [Temporary] there.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([playToken('sprite', 1, 'eventFrom')]))],
  }),
  unit('lillia-protector-of-dreams', 'When you play a token unit, give me +1 [M] this turn.\nYour token units have [Tank].', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'], token: true } }, prog([might(1, ref.self)])),
      kwTo(kw.tank(), unitSel({ rel: 'friendly', where: [pred.token] }))],
  }),
  spell('lilting-lullaby', "[Reaction]\nCounter a spell. Its controller can't play spells this turn.", {
    kw: [kw.reaction()], choose: [slot('a', spellSel(), { harm: true })],
    body: [playerEffect({ s: 'cantPlayTypes', types: ['spell'] }, { controllerOf: ref.slot('a') }), counter(ref.slot('a'))],
  }),
  unit('lonely-poro', '[Deathknell][>] If I died alone, draw 1.', { abilities: [deathknell(prog([iff(cond.info('alone', true), [draw(1)])]))] }),
  spell('lotus-trap', '[Hidden]\n[Reaction]\nChoose a unit. Double all damage that would be dealt to it this turn.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel(), { harm: true })], body: [doubleDamage(ref.slot('a'))],
  }),
  spell('lunar-boon', '[Reaction]\nDiscard 1, then draw 2.', { kw: [kw.reaction()], body: [discard(1), draw(2)] }),
  unit('maduli-the-gatekeeper', "I can't be readied.\n[P]: Move me to an occupied enemy battlefield if my Might is greater than the total Might of enemy units there.", {
    abilities: [always({ s: 'cantBeReadied' }), activated({ power: ['chaos'] }, prog([move(ref.self, { slotBf: 'b' })],
      [slot('b', bfSel({ rel: 'enemy', where: [pred.occupied, pred.enemyMightBelowSource] }))]))],
  }),
  unit('master-yi-tempered', '[Hunt 2]\n[Level 6][>] I have [Deflect] and [Ganking].', {
    abilities: [kwTo(kw.deflect(), undefined, { while: cond.level(6) }), kwTo(kw.ganking(), undefined, { while: cond.level(6) })],
  }),
  unit('master-yi-unstoppable', "[Level 3][>] I cost [2][G] less.\n[Level 6][>] I cost [4][G][G] less instead.\n[Level 11][>] I cost [6][G][G][G] less instead.\n[Level 16][>] I can't be chosen by enemy spells and abilities.", {
    abilities: [costAbility({ discount: { energy: 2, power: 1 }, while: cond.and(cond.level(3), cond.not(cond.level(6))) }),
      costAbility({ discount: { energy: 4, power: 2 }, while: cond.and(cond.level(6), cond.not(cond.level(11))) }),
      costAbility({ discount: { energy: 6, power: 3 }, while: cond.level(11) }),
      always({ s: 'noEnemyChoose' }, { while: cond.level(16) })],
  }),
  legend('master-yi-wuju-master', '[Level 6][>] Your units have +1 [M].\n[Level 11][>] Your units enter ready.', [
    mightTo(1, friendly, { while: cond.level(6) }), always({ s: 'entersReady', to: friendly }, { while: cond.level(11) }),
  ]),
  spell('mirror-image', 'Choose a unit. Play a ready Reflection unit token to your base. Then do this: It becomes a copy of that unit. Give it [Temporary].', {
    choose: [slot('a', unitSel())],
    body: [playToken('reflection', 1, 'yourBase', { ready: true, copyOf: ref.slot('a'), give: [kw.temporary()] })],
  }),

  // ---- batch 5 (UNL batch B) ----
  unit('mischievous-marai', '[Hidden]\nWhen you play me to a battlefield, deal 2 to an enemy unit here.', {
    abilities: [onPlay(prog([deal(2, ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]), { if: cond.playedToBf })],
  }),
  spell('monster-harpoon', '[Action]\nDeal 2 to a unit at a battlefield. If you control a facedown card, deal 4 to it instead.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [iff(cond.count(facedownSel({ rel: 'friendly' }), '>=', 1), [deal(4, ref.slot('a'))], [deal(2, ref.slot('a'))])],
  }),
  spell('moonfall', '[Action]\nChoose a battlefield where you have units. You may move up to one enemy unit to that battlefield. Then give enemy units there -2 [M] this turn.', {
    kw: [kw.action()],
    choose: [slot('b', bfSel({ where: [pred.unitsHere('friendly')] })), slot('e', unitSel({ rel: 'enemy' }), { min: 0, max: 1, harm: true })],
    body: [move(ref.slot('e'), { slotBf: 'b' }), might(2, unitSel({ rel: 'enemy', at: { slot: 'b' } }), -1)],
  }),
  unit('nidalee-cat-form', '[Ambush]\nWhen I win a combat, draw 1.', { abilities: [when({ on: 'winCombat', who: 'self' }, prog([draw(1)]))] }),
  unit('nilah-joyful-ascetic', '[Accelerate]\n[Ganking]\nWhen I move, gain 1 XP.', { abilities: [when({ on: 'moved', who: 'self' }, prog([gainXp(1)]))] }),
  unit('petal-pixie', 'I have +1 [M] for each of your units with [Temporary] at my battlefield.', {
    abilities: [statik(val.count(unitSel({ rel: 'friendly', at: 'here', where: [pred.keyword('temporary')] })), { while: cond.selfAt('battlefield') })],
  }),
  unit('poppy-defender-of-the-meek', 'You may spend 3 XP as an additional cost to play me. If you do, I cost [3] less.\n[Ambush]\n[Tank]', {
    abilities: [costAbility({ optional: true, pay: { xp: 3 }, discount: { energy: 3 } })],
  }),
  legend('poppy-keeper-of-the-hammer', 'When you hold, gain 1 XP.\nSpend 3 XP, [E]: Draw 1.', [
    when({ on: 'hold', who: 'you', at: 'any' }, prog([gainXp(1)])), activated({ xp: 3, exhaustSelf: true }, prog([draw(1)])),
  ]),
  unit('poppy-paragon', "[Deflect]\nWhen you play me, if an opponent's score is within 3 points of the Victory Score, ready me and gain 3 XP.", {
    abilities: [onPlay(prog([ready(ref.self), gainXp(3)]), { if: cond.opponentNearWin(3) })],
  }),
  unit('prepared-neophyte', "If you've spent [4] or more to play a spell this turn, I have +4 [M].", {
    abilities: [statik(4, { while: cond.thisTurn('played', { types: ['spell'], minSpent: 4 }) })],
  }),
  legend('pyke-bloodharbor-ripper', "[1], [E]: Return a friendly unit at a battlefield to its owner's hand. Play a Gold gear token exhausted.", [
    activated({ energy: 1, exhaustSelf: true }, prog([returnToHand(ref.slot('a')), gold()], [slot('a', unitSel({ rel: 'friendly', at: 'battlefield' }))])),
  ]),
  unit('pyke-dockside-butcher', '[Hidden]\n[Ganking]\nYou may pay [R] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, ready me and give me +2 [M] this turn.', {
    abilities: [costAbility({ optional: true, add: { power: ['fury'] } }),
      onPlay(prog([ready(ref.self), might(2, ref.self)]), { if: cond.paid('pyke-dockside-butcher#0') })],
  }),
  unit('pyke-returned', "[Hidden]\n[Backline]\nOnce each turn, when an enemy unit dies while I'm at a battlefield, play a Gold gear token exhausted.", {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'enemy' }, prog([gold()]), { limit: { n: 1, per: 'turn' }, if: cond.selfAt('battlefield') })],
  }),
  unit('red-brambleback', '[Accelerate]\nYour conquer effects for conquering here trigger an additional time.\nWhen I conquer, [Buff] a friendly unit.', {
    abilities: [always({ s: 'extraScoreTriggers', how: 'conquer' }),
      when({ on: 'conquer', who: 'you', at: 'here' }, prog([buff(ref.slot('a'))], [slot('a', friendly)]))],
  }),
  legend('rengar-pridestalker', 'When you play a unit, give a unit +1 [M] this turn.', [
    when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([might(1, ref.slot('a'))], [slot('a', unitSel())])),
  ]),
  // "a spell or ability": finalized ability items on the chain may be chosen too [355.9.a.2].
  spell('repulse', '[Reaction]\nChoose a friendly unit at a battlefield. Counter an enemy spell or ability that chooses it and no other friendly unit.', {
    kw: [kw.reaction()],
    choose: [slot('u', unitSel({ rel: 'friendly', at: 'battlefield' })), slot('s', spellSel({ rel: 'enemy', abilities: true, where: [pred.choosesOnly('u')] }), { harm: true })],
    body: [counter(ref.slot('s'))],
  }),
  unit('revna-the-lorekeeper', '[Ganking]\nWhen you play a spell, if you spent [4] or more, ready me.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'], minSpent: 4 } }, prog([ready(ref.self)]))],
  }),
  unit('rift-herald', 'When I move to a battlefield, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.\n[Deathknell][>] Play a unit from your hand to your base, ignoring its Energy cost.', {
    abilities: [when({ on: 'moved', who: 'self', to: 'bf' }, prog([look(3, 'l'), pickWhere('l', 1, 'u', { min: 0, where: [pred.type('unit')] }),
      draw(1, ref.bound('u')), recycleRest('l', 'u')])),
    deathknell(prog([choose(cards({ in: 'hand', rel: 'friendly', where: [pred.type('unit')] }), 'c'), playFree(ref.bound('c'), 'energy', { at: 'base' })]))],
  }),
  unit('ruined-rex', '[Deathknell][>] Deal 4 to an enemy unit.', {
    abilities: [deathknell(prog([deal(4, ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  spell('sacrifice', '[Reaction]\nAs an additional cost to play this, kill a friendly [Mighty] unit.\nDraw 2 and channel 1 rune exhausted.', {
    kw: [kw.reaction()], abilities: [costAbility({ pay: { kill: { sel: unitSel({ rel: 'friendly', where: [pred.mighty] }), n: 1 } } })],
    body: [draw(2), channel(1, { exhausted: true })],
  }),
  unit('safety-inspector', "You may spend 3 XP as an additional cost to play me.\nWhen you play me, each player must kill one of their units. If you paid my additional cost, you don't kill a unit this way.", {
    abilities: [costAbility({ optional: true, pay: { xp: 3 } }),
      onPlay(prog([eachPlayerKills(1, { exceptIf: cond.paid('safety-inspector#0') })]))],
  }),
  unit('scorchclaw', '[Hunt 2]\n[Level 3][>] I have +1 [M] and enter ready.', {
    abilities: [statik(1, { while: cond.level(3) }), entersReady({ while: cond.level(3) })],
  }),
  unit('scrutinizing-sergeant', 'When you play me, gain 1 XP for each friendly unit.', { abilities: [onPlay(prog([gainXp(val.count(friendly))]))] }),
  unit('scuttle-crab', 'When you play me, draw 1.\n[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. Gain 1 XP.', {
    // "this turn": the facedown cards they have now, and the ones they hide later this turn (seen as they are hidden).
    abilities: [onPlay(prog([draw(1)])), deathknell(prog([revealHand, lookAt(facedownSel({ rel: 'enemy' })),
      playerEffect({ s: 'seeFacedown' }), gainXp(1)]))],
  }),
  unit('shadow-watcher', 'If a friendly unit died during your Beginning Phase this turn, I enter ready.', {
    abilities: [entersReady({ while: cond.thisTurn('unitDied', { rel: 'friendly', yourBeginning: true }) })],
  }),
  spell('shadows-call', 'Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2.', {
    choose: [slot('a', unitSel({ rel: 'friendly', where: [pred.not(pred.keyword('temporary'))] }))],
    body: [grant(kw.temporary(), ref.slot('a'), 'permanent'), draw(2)],
  }),
  gear('shard-of-undoing', 'The first time a friendly unit dies during your Beginning Phase each turn, each opponent must kill one of their units.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendly' }, prog([eachPlayerKills(1, { who: 'opponents' })]), { first: 'turn', firstIf: true, if: cond.yourBeginning })],
  }),
  gear('shepherds-heirloom', 'When you play this, gain 1 XP.\n[Equip] — Spend 1 XP', { abilities: [onPlay(prog([gainXp(1)]))] }),
  unit('sinister-poro', 'When I attack, you may pay [1] to move an enemy unit here to its base.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]),
      { may: true, cost: { energy: 1 } })],
  }),
  spell('smite', '[Action]\nDeal 3 to a unit at a battlefield. If it would die this turn, banish it instead.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })], body: [banishIfDies(ref.slot('a')), deal(3, ref.slot('a'))],
  }),
  spell('smoke-and-mirrors', "[Hidden]\n[Action]\nChoose a unit you control and another unit you control at a different location. If at least one of them has [Temporary], move each to the other's location. Draw 1.", {
    kw: [kw.action()], choose: [slot('a', friendly), slot('b', unitSel({ rel: 'friendly', where: [pred.notAtSlot('a')] }), { distinctFrom: ['a'] })],
    body: [iff(cond.or(cond.is(ref.slot('a'), pred.keyword('temporary')), cond.is(ref.slot('b'), pred.keyword('temporary'))),
      [swap(ref.slot('a'), ref.slot('b'))]), draw(1)],
  }),
  unit('soul-shepherd', 'Your token units have +1 [M].', { abilities: [mightTo(1, unitSel({ rel: 'friendly', where: [pred.token] }))] }),
  unit('spectral-centaur', 'When another friendly unit dies, give me +2 [M] this turn.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendlyOther', each: true }, prog([might(2, ref.self)]))],
  }),
  spell('sprite-burst', 'Play two ready 3 [M] Sprite unit tokens with [Temporary].', { body: [playToken('sprite', 2, 'choose', { ready: true })] }),
  ...(() => {
    const sprite = prog([playToken('sprite', 1, 'yourBase', { ready: true })]);
    return [gear('sprite-fountain', "[Temporary]\nWhen you play this, play a ready 3 [M] Sprite unit token with [Temporary] to your base.\n[Deathknell][>] Repeat this gear's play effect.", {
      abilities: [onPlay(sprite), deathknell(sprite)],
    }), unit('sprite-queen', 'When you play me or at the start of your Beginning Phase, play a ready 3 [M] Sprite unit token with [Temporary] to your base.', {
      abilities: [onPlay(sprite), when({ on: 'phase', at: 'beginning', whose: 'your' }, sprite)],
    })];
  })(),
  unit('stalking-wolf', "[Ambush]\nAs an additional cost to play me, kill a Bird, Cat, Dog, or Poro you control. You may [Ambush] me to its battlefield, even if you don't have other units there.", {
    abilities: [costAbility({ pay: { kill: { sel: unitSel({ rel: 'friendly', where: [pred.anyTag(...PETS)] }), n: 1 } } })],
  }),
  spell('star-crossed', "[Reaction]\nReturn a friendly unit and an enemy unit to their owners' hands.", {
    kw: [kw.reaction()], choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [returnToHand(ref.slot('a')), returnToHand(ref.slot('b'))],
  }),
  spell('stare-down', 'Choose a friendly unit and a battlefield. Move all enemy units at that battlefield with less Might than the chosen unit to their base. Gain 1 XP.', {
    choose: [slot('a', friendly), slot('b', bfSel())],
    body: [move(unitSel({ rel: 'enemy', at: { slot: 'b' }, where: [pred.mightVsSlot('a', '<')] }), 'base'), gainXp(1)],
  }),
  unit('starhound', 'When you play me, return a Bird, Cat, Dog, or Poro from your trash to your hand.', {
    abilities: [onPlay(prog([returnToHand(ref.slot('c'))], [slot('c', cards({ rel: 'friendly', where: [pred.anyTag(...PETS)] }))]))],
  }),
  gear('sumpworks-map', '[Reaction]\n[Temporary]\nWhen an opponent scores, draw 1.', {
    abilities: [when({ on: 'score', who: 'opponent', at: 'any' }, prog([draw(1)]))],
  }),
  unit('syndra-transcendent', "While I'm in a showdown, your spells have [Repeat] [2][P].", {
    abilities: [costAbility({ grant: { types: ['spell'] }, optional: true, repeat: true, add: { energy: 2, power: ['chaos'] }, while: cond.selfInShowdown })],
  }),
  unit('targonian-visionary', '[Level 11][>] I have +4 [M].', { abilities: [statik(4, { while: cond.level(11) })] }),
  battlefield('the-academy', 'When you hold here, give your next spell this turn [Repeat] equal to its base cost.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([playerEffect({ s: 'grantRepeat', uses: 1 })]), { controller: 'eventPlayer' }),
  ]),
  gear('the-list', 'As you play this, name a tag.\n[E]: Give a unit with the named tag -2 [M] this turn.', {
    abilities: [always({ s: 'chooseTag', tags: 'any', gain: false }),
      activated({ exhaustSelf: true }, prog([might(2, ref.slot('a'), -1)], [slot('a', unitSel({ where: [pred.namedTag] }), { harm: true })]))],
  }),
  spell('the-ruination', 'Kill all units.', { body: [kill(unitSel())] }),
  spell('thrill-of-the-hunt', '[Reaction]\nBanish a friendly unit, then its owner plays it to any battlefield, ignoring its cost.', {
    kw: [kw.reaction()], choose: [slot('a', friendly)],
    body: [named('b', banish(ref.slot('a'))), playFree(ref.bound('b'), 'all', { by: 'owner', anyBf: true })],
  }),
  // In a Duel every enemy unit has the same controller.
  spell('tricksy-tentacles', 'Move any number of enemy units with the same controller and a total Might of 8 or less to a single location.', {
    choose: [slot('a', unitSel({ rel: 'enemy' }), { min: 1, max: 99, harm: true, sumMightMax: 8 }), destSlot('d', 'a', 'any')],
    body: [move(ref.slot('a'), { dest: 'd' })],
  }),
  spell('turn-to-dust', 'Give a gear [Temporary].', {
    choose: [slot('a', gearSel(), { harm: true })], body: [grant(kw.temporary(), ref.slot('a'), 'permanent')],
  }),
  unit('ultrasoft-poro', "[E]: Play two [1] [M] Bird unit tokens with [Deflect]. Use this ability only while I'm at a battlefield.", {
    abilities: [activated({ exhaustSelf: true }, prog([playToken('bird', 2, 'choose')]), { while: cond.selfAt('battlefield') })],
  }),
  unit('undying-legion', '[Legion][>] You may play me from your trash for [3][R].', {
    abilities: [always({ s: 'playFromTrash' }, { while: cond.legion }), costAbility({ alt: { energy: 3, power: ['fury'] }, while: cond.origin('trash') })],
  }),
  spell('undying-loyalty', 'This costs [2] less if you choose a Bird, Cat, Dog, or Poro.\nPlay a unit with cost no more than [2] and no more than [A] from your trash, ignoring its cost.', {
    abilities: [costAbility({ discount: { energy: 2, ifTarget: [pred.anyTag(...PETS)] } })],
    choose: [slot('c', cards({ rel: 'friendly', where: [pred.type('unit'), pred.energyCost('<=', 2), pred.powerCost('<=', 1)] }))],
    body: [playFree(ref.slot('c'))],
  }),
  battlefield('vaults-of-helia', 'When you hold here, your non-token units cost [1] more to play this turn.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([playerEffect({ s: 'costMore', types: ['unit'], energy: 1, nonToken: true })]),
      { controller: 'eventPlayer' }),
  ]),
  unit('vicious-snapjaws', 'When another friendly unit dies, gain 1 XP.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendlyOther', each: true }, prog([gainXp(1)]))],
  }),
  unit('vilemaw', "[Ambush]\nEnemy units here with less Might than me don't deal combat damage.\nWhen I hold, draw 1.", {
    abilities: [always({ s: 'noCombatDamage', to: unitSel({ rel: 'enemy', at: 'here', where: [pred.mightVsSource('<')] }) }), when(hold, prog([draw(1)]))],
  }),
  spell('void-assault', 'Move a friendly unit, then move an enemy unit.', {
    choose: [slot('a', friendly), destSlot('da', 'a', 'any'), slot('b', unitSel({ rel: 'enemy' }), { harm: true }), destSlot('db', 'b', 'any')],
    body: [move(ref.slot('a'), { dest: 'da' }), move(ref.slot('b'), { dest: 'db' })],
  }),
  unit('walking-roost', '[Deflect]\nWhen you play me, choose an opponent. They play a 1 [M] Bird unit token with [Deflect].', {
    abilities: [onPlay(prog([forEach('opponents', 'next', [playToken('bird', 1, 'choose')])]))],
  }),
  unit('wily-newtfish', "If you've gained XP this turn, I have +1 [M] and [Ganking].", {
    abilities: [statik(1, { while: cond.xpGained }), kwTo(kw.ganking(), undefined, { while: cond.xpGained })],
  }),
  ...(() => {
    const fx = prog([might(3, ref.slot('a')), grant(kw.tank(), ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', other: true, at: 'here' }))]);
    return [unit('yuumi-magical-cat', 'When I attack or defend, give one of your other units here +3 [M] and [Tank] this turn.', {
      abilities: [when({ on: 'attack', who: 'self' }, fx), when({ on: 'defend', who: 'self' }, fx)],
    })];
  })(),
  unit('zilean-time-mage', "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token and an additional copy of it instead.", {
    abilities: [replacement({ ev: { ev: 'playToken', by: 'you', type: 'unit' }, instead: { extraCopy: true }, while: cond.selfAt('battlefield'), may: true,
      limit: { n: 1, per: 'turn' } })],
  }),
];
