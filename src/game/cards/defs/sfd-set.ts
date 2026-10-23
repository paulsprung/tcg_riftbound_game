/*
 * Spiritforged (SFD): the cards of the set beyond its Champion Decks (sfd.ts).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, addDomain, addEnergy, always, banish, banishThis, battlefield, bfSel, buff, cardSel, channel, choose, cond, costAbility,
  deal, deathknell, delayed, discard, draw, draws, entersReady, fight, forEach, gainControl, gear, gearSel, gold, grant,
  heal, iff, keywordTo, kill, kw, legend, legendSel, look, might, mightTo, modal, mode, move, named, onPlay, pay, permanentSel,
  pick, pickWhere, playCard, playerEffect, playFree, playToken, points, pred, prog, ready, recall, recycle, recycleRest,
  ref, returnToHand, revealTop, slot, spell, statik, stun, unit, unitSel, val, when, attach, exhaust,
} from '../../dsl/builders.ts';

const friendly = unitSel({ rel: 'friendly' });
const atBf = unitSel({ at: 'battlefield' });
const enemyHere = unitSel({ rel: 'enemy', at: 'here' });
const equipment = (rel: 'friendly' | 'enemy' | 'any' = 'friendly') => gearSel({ rel, where: [pred.tag('Equipment')] });
const conquer = { on: 'conquer', who: 'you', at: 'here' } as const;
const hold = { on: 'hold', who: 'you', at: 'here' } as const;
const movedToBf = { on: 'moved', who: 'self', to: 'bf' } as const;
const fx = { effectText: true } as const;

export const SFD_SET_DEFS = [
  spell('against-the-odds', '[Reaction]\nGive a friendly unit at a battlefield +2 [M] this turn for each enemy unit there.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel({ rel: 'friendly', at: 'battlefield' }))],
    body: [might(val.sum(val.count(unitSel({ rel: 'enemy', at: { slot: 'a' } })), val.count(unitSel({ rel: 'enemy', at: { slot: 'a' } }))),
      ref.slot('a'))],
  }),
  unit('apprentice-smith', "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it.", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([revealTop('r'),
      iff(cond.is(ref.bound('r'), pred.type('gear')), [draw(1, ref.bound('r'))], [recycle(ref.bound('r'))])]))],
  }),
  spell('arcane-shift', '[Action]\nBanish a friendly unit, then its owner plays it, ignoring its cost. Deal 3 to an enemy unit at a battlefield. Banish this.', {
    kw: [kw.action()], choose: [slot('a', friendly), slot('e', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true })],
    body: [named('b', banish(ref.slot('a'))), playFree(ref.bound('b'), 'all', { by: 'owner' }), deal(3, ref.slot('e')), banishThis],
  }),
  spell('arise', 'Play a 2 [M] Sand Soldier unit token for each Equipment you control. Then do this: Ready up to two of them.', {
    body: [playToken('sandSoldier', val.count(equipment()), 'choose', { readyFirst: 2 })],
  }),
  unit('aspiring-engineer', 'When you play me, return a gear from your trash to your hand.', {
    abilities: [onPlay(prog([returnToHand(ref.slot('c'))], [slot('c', cardSel({ rel: 'friendly', where: [pred.type('gear')] }))]))],
  }),
  legend('azir-emperor-of-the-sands', "Your Sand Soldiers have [Weaponmaster].\n[1], [E]: Play a 2 [M] Sand Soldier unit token to your base. Use only if you've played an Equipment this turn.", [
    keywordTo({ kw: 'weaponmaster' }, unitSel({ rel: 'friendly', where: [pred.name('Sand Soldier')] })),
    activated({ energy: 1, exhaustSelf: true }, prog([playToken('sandSoldier', 1, 'yourBase')]),
      { while: cond.thisTurn('played', { tag: 'Equipment' }) }),
  ]),
  unit('azir-sovereign', '[Accelerate]\nWhen I attack, you may move any number of your token units to this battlefield.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([choose(unitSel({ rel: 'friendly', at: 'elsewhere', where: [pred.token] }), 'u',
      { min: 0, max: 99 }), move(ref.bound('u'), 'here')]), { may: true })],
  }),
  unit('bard-mercurial', 'You may exhaust your legend as an additional cost to play me.\nWhen you play me, if you paid the additional cost, move any number of your units to an open battlefield.', {
    abilities: [costAbility({ optional: true, pay: { exhaust: { sel: legendSel({ rel: 'friendly' }), n: 1 } } }),
      onPlay(prog([choose(bfSel({ where: [pred.open] }), 'b'), choose(friendly, 'u', { min: 0, max: 99 }), move(ref.bound('u'), { locOf: ref.bound('b') })]),
        { if: cond.paid('bard-mercurial#0') })],
  }),
  unit('battering-ram', "I cost [1] less for each card you've played this turn, to a minimum of [1].", {
    abilities: [costAbility({ discount: { energy: val.playedThisTurn, min: 1 } })],
  }),
  unit('beast-below', "When you play me, return another friendly unit and an enemy unit to their owners' hands.", {
    abilities: [onPlay(prog([returnToHand(ref.slot('a')), returnToHand(ref.slot('b'))],
      [slot('a', unitSel({ rel: 'friendly', other: true })), slot('b', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  spell('bellows-breath', '[Action]\n[Repeat] [1][B]\nDeal 1 to up to three units at the same location.', {
    kw: [kw.action()], choose: [slot('a', unitSel(), { min: 0, harm: true }),
      slot('b', unitSel({ at: { slot: 'a' } }), { min: 0, max: 2, distinctFrom: ['a'], harm: true })],
    body: [deal(1, ref.slot('a')), deal(1, ref.slot('b'))],
  }),
  unit('blast-corps-cadet', 'You may pay [1][R] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, deal 2 to a unit at a battlefield.', {
    abilities: [costAbility({ optional: true, add: { energy: 1, power: ['fury'] } }),
      onPlay(prog([deal(2, ref.slot('a'))], [slot('a', atBf, { harm: true })]), { if: cond.paid('blast-corps-cadet#0') })],
  }),
  spell('blood-money', '[Action]\nKill a unit at a battlefield with 2 [M] or less. If it was an enemy unit, play a Gold gear token exhausted. If it was a friendly unit, play two Gold gear tokens exhausted.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ at: 'battlefield', where: [pred.might('<=', 2)] }), { harm: true })],
    body: [iff(cond.is(ref.slot('a'), pred.enemy), [kill(ref.slot('a')), gold(1)], [kill(ref.slot('a')), gold(2)])],
  }),
  spell('blood-rush', '[Action]\n[Repeat] [1]\nGive a unit [Assault 2] this turn.', {
    kw: [kw.action()], choose: [slot('a', unitSel())], body: [grant(kw.assault(2), ref.slot('a'))],
  }),
  spell('bonds-of-strength', '[Reaction]\n[Repeat] [2]\nGive two friendly units each +1 [M] this turn.', {
    kw: [kw.reaction()], choose: [slot('a', friendly, { min: 2, max: 2 })], body: [might(1, ref.slot('a'))],
  }),
  gear('boneshiver', '[Equip] [1][O]\nWhen I conquer, channel 1 rune exhausted.', {
    abilities: [when(conquer, prog([channel(1, { exhausted: true })]), fx)],
  }),
  unit('buhru-captain', 'When you play me, you may draw 1 or buff me.', {
    abilities: [onPlay(modal(1, [mode('Draw 1', [draw(1)]), mode('Buff me', [buff(ref.self)])]), { may: true })],
  }),
  spell('bushwhack', '[Hidden]\nFriendly units enter ready this turn. Play a Gold gear token exhausted.', {
    body: [playerEffect({ s: 'entersReady', types: ['unit'] }), gold(1)],
  }),
  spell('called-shot', '[Action]\n[Repeat] [P]\nLook at the top 2 cards of your Main Deck. Draw one and recycle the other.', {
    kw: [kw.action()], body: [look(2, 'l'), pick('l', 1, 'd'), draw(1, ref.bound('d')), recycleRest('l', 'd')],
  }),
  gear('chemtech-cask', "When you play a spell on an opponent's turn, you may exhaust me to play a Gold gear token exhausted.", {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'] } }, prog([gold(1)]),
      { may: true, cost: { exhaustSelf: true }, if: cond.not(cond.yourTurn) })],
  }),
  unit('corinna-veraza', '[Accelerate]\nWhen I move to a battlefield, play three 1 [M] Recruit unit tokens here.', {
    abilities: [when(movedToBf, prog([playToken('recruit', 3, 'here')]))],
  }),
  unit('corrupt-enforcer', 'When I move to a battlefield, discard 1.\nWhen I win a combat, draw 1.', {
    abilities: [when(movedToBf, prog([discard(1)])), when({ on: 'winCombat', who: 'self' }, prog([draw(1)]))],
  }),
  gear('cull', '[Equip] [P]\nWhen I conquer, play a Gold gear token exhausted.', { abilities: [when(conquer, prog([gold(1)]), fx)] }),
  unit('darius-executioner', '[Legion][>] When you play me, ready me.\nOther friendly units have +1 [M] here.', {
    abilities: [onPlay(prog([ready(ref.self)]), { if: cond.legion }), mightTo(1, unitSel({ rel: 'friendly', other: true, at: 'here' }))],
  }),
  spell('defiant-dance', '[Reaction]\nGive a unit +2 [M] this turn and another unit -2 [M] this turn.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel()), slot('b', unitSel(), { distinctFrom: ['a'], harm: true })],
    body: [might(2, ref.slot('a')), might(2, ref.slot('b'), -1)],
  }),
  spell('deserts-call', '[Repeat] [2]\nPlay a 2 [M] Sand Soldier unit token.', { body: [playToken('sandSoldier', 1, 'choose')] }),
  spell('detonate', 'Kill a gear. Its controller draws 2.', {
    choose: [slot('g', gearSel(), { harm: true })], body: [kill(ref.slot('g')), draws(2, ref.slot('g'))],
  }),
  unit('direwing', 'I enter ready if you control another Dragon.', {
    abilities: [entersReady({ while: cond.count(unitSel({ rel: 'friendly', where: [pred.tag('Dragon')] }), '>=', 1) })],
  }),
  unit('disarming-rake', 'When you play me, you may kill a gear.', {
    abilities: [onPlay(prog([kill(ref.slot('g'))], [slot('g', gearSel(), { harm: true })]), { may: true })],
  }),
  gear('dorans-ring', '[Equip] [P]\nWhen I conquer, discard 1, then draw 1.', { abilities: [when(conquer, prog([discard(1), draw(1)]), fx)] }),
  spell('downwell', "Return all units and gear to their owners' hands.", { body: [returnToHand(permanentSel())] }),
  unit('draven-audacious', '[Deflect]\nThe first time I win a combat each turn, you score 1 point.\nWhen I die in combat, choose an opponent. They score 1 point.', {
    abilities: [when({ on: 'winCombat', who: 'self' }, prog([points(1)]), { first: 'turn' }),
      when({ on: 'dies', who: 'self' }, prog([points(1, 'opponent')]), { if: cond.info('inCombat', true) })],
  }),
  legend('draven-glorious-executioner', 'When you win a combat, draw 1.', [when({ on: 'winCombat', who: 'you' }, prog([draw(1)]))]),
  unit('draven-vanquisher', 'When I win a combat, play a Gold gear token exhausted.\nWhen I attack or defend, you may pay [R] to give me +2 [M] this turn.', {
    abilities: [when({ on: 'winCombat', who: 'self' }, prog([gold(1)])),
      when({ on: 'attack', who: 'self' }, prog([might(2, ref.self)]), { may: true, cost: { power: ['fury'] } }),
      when({ on: 'defend', who: 'self' }, prog([might(2, ref.self)]), { may: true, cost: { power: ['fury'] } })],
  }),
  unit('dropboarder', 'When you play me, if you control two or more gear, ready me.', {
    abilities: [onPlay(prog([ready(ref.self)]), { if: cond.count(gearSel({ rel: 'friendly' }), '>=', 2) })],
  }),
  unit('dunebreaker', 'If you have two or fewer cards in your hand, I enter ready.\nWhen I hold, draw 2.', {
    abilities: [entersReady({ while: cond.handSize('<=', 2) }), when(hold, prog([draw(2)]))],
  }),
  unit('eager-drakehound', 'I enter ready.', { abilities: [entersReady()] }),
  gear('edge-of-night', '[Hidden]\nWhen you play this from face down, attach it to a unit you control.\n[Equip] [P]', {
    abilities: [onPlay(prog([attach(ref.self, ref.slot('u'))], [slot('u', friendly, { freeFromHidden: true })]), { if: cond.playedFrom('facedown') })],
  }),
  unit('eminent-benefactor', 'When I hold, play two Gold gear tokens exhausted.', { abilities: [when(hold, prog([gold(2)]))] }),
  battlefield('emperors-dais', 'When you conquer here, you may pay [1] and return a unit you control here to its owner\'s hand to play a 2 [M] Sand Soldier unit token here.', [
    when(conquer, prog([named('r', returnToHand(ref.slot('u'))), iff(cond.did('r'), [playToken('sandSoldier', 1, { info: 'bf' })])],
      [slot('u', unitSel({ rel: 'friendly', at: 'here' }))]), { may: true, cost: { energy: 1 }, controller: 'eventPlayer' }),
  ]),
  spell('emperors-divide', '[Hidden]\n[Action]\nMove any number of friendly units at a battlefield to their base.', {
    kw: [kw.action()], choose: [slot('b', bfSel())],
    body: [choose(unitSel({ rel: 'friendly', at: { slot: 'b' } }), 'u', { min: 0, max: 99 }), move(ref.bound('u'), 'base')],
  }),
  gear('eye-of-the-herald', '[Equip] [Y]\nWhen I move, play a 1 [M] Recruit unit token here.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([playToken('recruit', 1, 'here')]), fx)],
  }),
  spell('factory-recall', "[Action]\nReturn a gear to its owner's hand.", {
    kw: [kw.action()], choose: [slot('g', gearSel())], body: [returnToHand(ref.slot('g'))],
  }),
  unit('fae-porter', 'When I move to a battlefield, you may pay [P] to move a unit you control to the same battlefield.', {
    abilities: [when(movedToBf, prog([move(ref.slot('u'), { info: 'bf' })], [slot('u', unitSel({ rel: 'friendly', other: true }))]),
      { may: true, cost: { power: ['chaos'] } })],
  }),
  spell('feral-strength', '[Reaction]\n[Repeat] [2]\nGive a unit +2 [M] this turn.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel())], body: [might(2, ref.slot('a'))],
  }),
  unit('fizz-trickster', 'When you play me, you may play a spell from your trash with Energy cost no more than [3], ignoring its Energy cost. Then recycle it.', {
    abilities: [onPlay(prog([playFree(ref.slot('c'), 'energy', { leaveChain: 'recycle' })],
      [slot('c', cardSel({ rel: 'friendly', where: [pred.type('spell'), pred.energyCost('<=', 3)] }))]), { may: true })],
  }),
  gear('forgefire-cape', '[Unique]\n[Equip] [A]\nWhen I attack or defend, deal 2 to all enemy units here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(2, enemyHere)]), fx), when({ on: 'defend', who: 'self' }, prog([deal(2, enemyHere)]), fx)],
  }),
  battlefield('forgotten-monument', "Players can't score here until their third turn.", [always({ s: 'noScoreBefore', turn: 3 })]),
  unit('frostcoat-cub', 'You may pay [B] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, give a unit -2 [M] this turn.', {
    abilities: [costAbility({ optional: true, add: { power: ['mind'] } }),
      onPlay(prog([might(2, ref.slot('a'), -1)], [slot('a', unitSel(), { harm: true })]), { if: cond.paid('frostcoat-cub#0') })],
  }),
  unit('glasc-mixologist', '[Deathknell][>] You may play a unit with cost no more than [3] and no more than [A] from your trash, ignoring its cost.', {
    abilities: [when({ on: 'dies', who: 'self' }, prog([playFree(ref.slot('c'))], [slot('c', cardSel({ rel: 'friendly',
      where: [pred.type('unit'), pred.energyCost('<=', 3), pred.powerCost('<=', 1)] }))]), { may: true })],
  }),
  unit('guardian-of-the-passage', 'When I hold, you may return a unit or gear from your trash to your hand.', {
    abilities: [when(hold, prog([returnToHand(ref.slot('c'))], [slot('c', cardSel({ rel: 'friendly', where: [pred.type('unit', 'gear')] }))]),
      { may: true })],
  }),
  spell('guards', '[Hidden]\nPlay a 2 [M] Sand Soldier unit token. Then do this: You may pay [Y] to ready it.', {
    body: [named('y', pay({ power: ['order'] })), iff(cond.did('y'), [playToken('sandSoldier', 1, 'choose', { ready: true })],
      [playToken('sandSoldier', 1, 'choose')])],
  }),
  battlefield('hall-of-legends', 'When you conquer here, you may pay [1] to ready your legend.', [
    when(conquer, prog([ready(legendSel({ rel: 'friendly' }))]), { may: true, cost: { energy: 1 }, controller: 'eventPlayer' }),
  ]),
  unit('harpoon-squad', 'When I move from a battlefield, give me +2 [M] this turn.', {
    abilities: [when({ on: 'moved', who: 'self', from: 'bf' }, prog([might(2, ref.self)]))],
  }),
  gear('heart-of-dark-ice', '[E]: Give a unit +3 [M] this turn.', {
    abilities: [activated({ exhaustSelf: true }, prog([might(3, ref.slot('a'))], [slot('a', unitSel())]))],
  }),
  unit('honest-broker', '[Deathknell][>] Play a Gold gear token exhausted.', { abilities: [deathknell(prog([gold(1)]))] }),
  spell('hostile-takeover', '[Hidden]\nTake control of an enemy unit at a battlefield. Ready it.\nLose control of that unit and recall it at end of turn.', {
    choose: [slot('a', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true })],
    body: [named('c', gainControl(ref.slot('a'))), ready(ref.bound('c')),
      delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' }, prog([{ op: 'gainControl', what: ref.info('u'), toOwner: true }, recall(ref.info('u'))]),
        { capture: { u: ref.bound('c') } })],
  }),
  unit('janna-savior', '[Reaction]\nWhen you play me, heal your units here, then move up to one enemy unit from here to its base.', {
    abilities: [onPlay(prog([heal(unitSel({ rel: 'friendly', at: 'here' })), choose(unitSel({ rel: 'enemy', at: 'here' }), 'e', { min: 0, max: 1 }),
      move(ref.bound('e'), 'base')]))],
  }),
  unit('loyal-pup', 'When you defend at a battlefield, you may move me there.', {
    abilities: [when({ on: 'defend', who: 'you' }, prog([move(ref.self, { info: 'bf' })]), { may: true })],
  }),
  unit('lucian-gunslinger', '[Assault]\nWhen I attack, deal damage equal to my [Assault] to an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal({ v: 'kw', kw: 'assault' }, ref.slot('a'))], [slot('a', enemyHere, { harm: true })]))],
  }),
  spell('marching-orders', '[Action]\n[Repeat] [3]\nChoose a friendly unit anywhere and an enemy unit at a battlefield. They deal damage equal to their Mights to each other.', {
    kw: [kw.action()], choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true })],
    body: [fight(ref.slot('a'), ref.slot('b'))],
  }),
  unit('minotaur-reckoner', "Units can't move to base.", { abilities: [always({ s: 'noMoveToBase', anywhere: true })] }),
  spell('on-the-hunt', 'Ready your units.', { body: [ready(friendly)] }),
  unit('ornn-blacksmith', 'When you play me or when I hold, look at the top 4 cards of your Main Deck. You may reveal a gear from among them and draw it. Then recycle the rest.', {
    abilities: [onPlay(prog([look(4, 'l'), pickWhere('l', 1, 'g', { min: 0, where: [pred.type('gear')] }), draw(1, ref.bound('g')), recycleRest('l', 'g')])),
      when(hold, prog([look(4, 'l'), pickWhere('l', 1, 'g', { min: 0, where: [pred.type('gear')] }), draw(1, ref.bound('g')), recycleRest('l', 'g')]))],
  }),
  unit('ornn-forge-god', '[Deflect 2]\n[Weaponmaster]\nI have +1 [M] for each friendly gear.', {
    abilities: [statik(val.count(gearSel({ rel: 'friendly' })))],
  }),
  unit('overzealous-fan', 'When I defend, you may kill me to move an attacking unit to its base.', {
    abilities: [when({ on: 'defend', who: 'self' }, prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ at: 'here', where: [pred.attacking] }), { harm: true })]),
      { may: true, cost: { killSelf: true } })],
  }),
  unit('perched-grimwyrm', 'Play me only to a battlefield you conquered this turn.', { abilities: [always({ s: 'playOnlyToConquered' })] }),
  gear('petricite-monument', '[Temporary]\nFriendly units have [Deflect].', { abilities: [keywordTo(kw.deflect(), friendly)] }),
  unit('pickpocket', 'When you play me, you may kill a gear with Energy cost no more than [1]. If you do, play a Gold gear token exhausted.', {
    abilities: [onPlay(prog([named('k', kill(ref.slot('g'))), iff(cond.did('k'), [gold(1)])],
      [slot('g', gearSel({ where: [pred.energyCost('<=', 1)] }), { harm: true })]), { may: true })],
  }),
  spell('piercing-light', '[Repeat] [2][R]\nDeal 2 to a unit at a battlefield, then deal 2 to up to one other unit.', {
    choose: [slot('a', atBf, { harm: true }), slot('b', unitSel(), { min: 0, max: 1, distinctFrom: ['a'], harm: true })],
    body: [deal(2, ref.slot('a')), deal(2, ref.slot('b'))],
  }),
  gear('poro-snax', 'When you play this, draw 1.\n[1][G], [E], Kill this: Draw 1.', {
    abilities: [onPlay(prog([draw(1)])), activated({ energy: 1, power: ['calm'], exhaustSelf: true, killSelf: true }, prog([draw(1)]))],
  }),
  battlefield('power-nexus', 'When you hold here, you may pay [A][A][A][A] to score 1 point.', [
    when(hold, prog([points(1)]), { may: true, cost: { power: ['A', 'A', 'A', 'A'] }, controller: 'eventPlayer' }),
  ]),
  spell('premonition', '[Reaction]\nDraw 3.', { kw: [kw.reaction()], body: [draw(3)] }),
  spell('rally-the-troops', '[Action]\nWhen a friendly unit is played this turn, buff it.\nDraw 1.', {
    kw: [kw.action()], body: [delayed(999, { on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([buff(ref.subject)])), draw(1)],
  }),
  gear('recurve-bow', '[Equip] [R]\nWhen I attack or defend, deal 2 to an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(2, ref.slot('a'))], [slot('a', enemyHere, { harm: true })]), fx),
      when({ on: 'defend', who: 'self' }, prog([deal(2, ref.slot('a'))], [slot('a', enemyHere, { harm: true })]), fx)],
  }),
  unit('reksai-swarm-queen', 'When I attack, you may reveal the top 2 cards of your Main Deck. You may banish one, then play it. If it is a unit, you may play it here. Recycle the rest.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([revealTop('r', 2), pickWhere('r', 1, 'c', { min: 0 }), named('b', banish(ref.bound('c'))),
      { op: 'playCard', what: ref.bound('b'), at: 'here' }, recycleRest('r', 'c')]), { may: true })],
  }),
  legend('reksai-void-burrower', 'When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. You may banish one, then play it. Recycle the rest.', [
    when({ on: 'conquer', who: 'you', at: 'any' }, prog([revealTop('r', 2), pickWhere('r', 1, 'c', { min: 0 }), named('b', banish(ref.bound('c'))),
      playCard(ref.bound('b')), recycleRest('r', 'c')]), { may: true, cost: { exhaustSelf: true } }),
  ]),
  unit('renata-glasc-mastermind', "[1][B]: Draw 1.\n[4][B][B][B][B], [E]: Score 1 point.\nUse my abilities only while I'm at a battlefield.", {
    abilities: [activated({ energy: 1, power: ['mind'] }, prog([draw(1)]), { while: cond.selfAt('battlefield') }),
      activated({ energy: 4, power: ['mind', 'mind', 'mind', 'mind'], exhaustSelf: true }, prog([points(1)]), { while: cond.selfAt('battlefield') })],
  }),
  unit('rengar-pouncing', "[Reaction]\n[Assault 2]\nI can be played to a battlefield you're attacking.", {
    abilities: [always({ s: 'playTo', where: 'attacking' })],
  }),
  unit('ribbon-dancer', 'When I move to a battlefield, give another friendly unit +1 [M] this turn.', {
    abilities: [when(movedToBf, prog([might(1, ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', other: true }))]))],
  }),
  spell('rocket-barrage', '[Repeat] [4][B]\nChoose one —\n• Deal 4 to a unit in a base.\n• Kill a gear.', {
    ...modal(1, [mode('Deal 4 to a unit in a base', [deal(4, ref.slot('a'))], [slot('a', unitSel({ at: 'base' }), { harm: true })]),
      mode('Kill a gear', [kill(ref.slot('g'))], [slot('g', gearSel(), { harm: true })])]),
  }),
  battlefield('rockfall-path', "Units can't be played here.", [always({ s: 'noPlayHere' })]),
  unit('royal-entourage', 'When you play me, ready or exhaust a legend.', {
    abilities: [onPlay(modal(1, [mode('Ready', [ready(ref.slot('l'))]), mode('Exhaust', [exhaust(ref.slot('l'))])], [slot('l', legendSel())]))],
  }),
  unit('sandshifter', 'When you play me, kill an enemy unit with 3 [M] or less.', {
    abilities: [onPlay(prog([kill(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', where: [pred.might('<=', 3)] }), { harm: true })]))],
  }),
  unit('sea-monkey', 'You may pay [1] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, buff me.', {
    abilities: [costAbility({ optional: true, add: { energy: 1 } }), onPlay(prog([buff(ref.self)]), { if: cond.paid('sea-monkey#0') })],
  }),
  ...([['seal-of-discord', 'P', 'chaos'], ['seal-of-focus', 'G', 'calm'], ['seal-of-insight', 'B', 'mind'], ['seal-of-rage', 'R', 'fury'],
    ['seal-of-strength', 'O', 'body'], ['seal-of-unity', 'Y', 'order']] as const).map(([id, sym, d]) =>
    gear(id, `[Reaction][>] [E]: [Add] [${sym}].`, {
      abilities: [activated({ exhaustSelf: true }, prog([addDomain(d)]), { timing: 'reaction', isAdd: true })],
    })),
  battlefield('seat-of-power', 'When you conquer here, draw 1 for each other battlefield you or allies control..', [
    when(conquer, prog([draw(val.count(bfSel({ rel: 'friendly', other: true })))]), { controller: 'eventPlayer' }),
  ]),
  unit('simian-ancestor', 'When you buff me, ready me.', { abilities: [when({ on: 'buffed', who: 'self' }, prog([ready(ref.self)]))] }),
  unit('sivir-ambitious', '[Deflect 2]\nWhen I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit.', {
    abilities: [when(conquer, prog([deal(val.excess, ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]),
      { may: true, if: cond.excess(5) })],
  }),
  unit('sivir-mercenary', "[Accelerate]\nIf you've spent at least [A][A] this turn, I have +2 [M] and [Ganking].", {
    abilities: [statik(2, { while: cond.powerSpent(2) }), keywordTo(kw.ganking(), undefined, { while: cond.powerSpent(2) })],
  }),
  unit('stellacorn-herder', 'When I move, draw 1.', { abilities: [when({ on: 'moved', who: 'self' }, prog([draw(1)]))] }),
  spell('sudden-storm', "[Hidden]\n[Action]\nDeal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead.", {
    kw: [kw.action()], choose: [slot('a', atBf, { harm: true })],
    body: [iff(cond.is(ref.slot('a'), pred.attacking), [deal(4, ref.slot('a'))], [deal(2, ref.slot('a'))])],
  }),
  battlefield('the-papertree', 'When you hold here, each player channels 1 rune exhausted.', [
    when(hold, prog([forEach('each', 'you', [channel(1, { exhausted: true })])]), { controller: 'eventPlayer' }),
  ]),
  spell('thwonk', '[Action]\n[Repeat] [2]\nStun an attacking unit.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ where: [pred.attacking] }), { harm: true })], body: [stun(ref.slot('a'))],
  }),
  unit('tianna-crownguard', "[Deflect]\nWhile I'm at a battlefield, opponents can't gain points.", {
    abilities: [always({ s: 'noPointsForOpponents' }, { while: cond.selfAt('battlefield') })],
  }),
  unit('treasure-hunter', 'When I move, play a Gold gear token exhausted.', { abilities: [when({ on: 'moved', who: 'self' }, prog([gold(1)]))] }),
  gear('trinity-force', '[Equip] [O]\nWhen I hold, score 1 point.', { abilities: [when(hold, prog([points(1)]), fx)] }),
  unit('trove-golem', 'When you play me, play four Gold gear tokens exhausted.', { abilities: [onPlay(prog([gold(4)]))] }),
  unit('trusty-ramhound', 'While you have another unit here, I have +1 [M].', {
    abilities: [statik(1, { while: cond.count(unitSel({ rel: 'friendly', other: true, at: 'here' }), '>=', 1) })],
  }),
  unit('undertitan', "When you play me, give your other units +2 [M] this turn.\nAs I'm revealed from your deck, [Add] [2].", {
    abilities: [onPlay(prog([might(2, unitSel({ rel: 'friendly', other: true }))])),
      when({ on: 'seenOnTop', reveal: true }, prog([addEnergy(2)]), { activeIn: ['deck'] })],
  }),
  gear('vanguard-armory', '[E]: Play three 1 [M] Recruit unit tokens.', {
    abilities: [activated({ exhaustSelf: true }, prog([playToken('recruit', 3, 'choose')]))],
  }),
  unit('vayne-hunter', "[Assault 3]\nIf an opponent controls a battlefield, I enter ready.\nWhen I conquer, you may pay [1] to return me to my owner's hand.", {
    abilities: [entersReady({ while: cond.count(bfSel({ rel: 'enemy' }), '>=', 1) }),
      when(conquer, prog([returnToHand(ref.self)]), { may: true, cost: { energy: 1 } })],
  }),
  spell('void-rush', "Reveal the top 2 cards of your Main Deck. You may banish one, then play it, reducing its cost by [2]. Draw any you didn't banish.", {
    body: [revealTop('r', 2), pickWhere('r', 1, 'c', { min: 0 }), named('b', banish(ref.bound('c'))), playCard(ref.bound('b'), 2),
      draw(1, ref.bound('r'))],
  }),
  unit('windsinger', "[Hidden]\nWhen you play me, you may return another unit at a battlefield with 3 [M] or less to its owner's hand.", {
    abilities: [onPlay(prog([returnToHand(ref.slot('a'))], [slot('a', unitSel({ at: 'battlefield', other: true, where: [pred.might('<=', 3)] }),
      { harm: true })]), { may: true })],
  }),
  gear('world-atlas', '[Equip] [B]\nWhen I hold, play two Gold gear tokens exhausted.', { abilities: [when(hold, prog([gold(2)]), fx)] }),
  unit('xin-zhao-vigilant', '[Tank]\nI enter ready if you have two or more other units in your base.', {
    abilities: [entersReady({ while: cond.count(unitSel({ rel: 'friendly', at: 'base' }), '>=', 2) })],
  }),
  unit('yasuo-windrider', '[Ganking]\nThe third time I move in a turn, you score 1 point.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([points(1)]), { if: cond.self(pred.moves(3)) })],
  }),
  unit('yordle-explorer', 'When you play a card with Power cost [A][A] or more, draw 1.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { minPower: 2 } }, prog([draw(1)]))],
  }),
  unit('zaun-punk', 'You may kill a friendly gear as an additional cost to play me.\nWhen you play me, if you paid the additional cost, kill a gear.', {
    abilities: [costAbility({ optional: true, pay: { kill: { sel: gearSel({ rel: 'friendly' }), n: 1 } } }),
      onPlay(prog([kill(ref.slot('g'))], [slot('g', gearSel(), { harm: true })]), { if: cond.paid('zaun-punk#0') })],
  }),
];
