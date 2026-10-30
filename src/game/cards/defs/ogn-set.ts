/*
 * Origins (OGN): the cards of the set beyond its Champion Decks (ogn.ts).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, addEnergy, always, battlefield, buff, cardSel, channel, cond, costAbility, counter, deal, dealFrom, deathknell,
  destSlot, discard, double, draw, entersReady, fight, gear, gearSel, grant, iff, keywordTo, kill, kw, legend, look, might,
  mode, modal, move, named, onPlay, permanentSel, pick, playerEffect, playFree, playToken, points, pred, predict, prog, ready,
  recycleRest, ref, returnToHand, slot, spell, spellSel, stun, toHand, unit, unitSel, val, when, addPower,
  banishThis, bfSel, choose, extraTurn, facedownSel, playSelf, recycle, runeSel, spendBuffsOf, statik,
  activateConquer, banish, casterDraws, choiceBy, dealSplit, delayed, discardCards, discardHand, exhaust, forEach, gainControl,
  may, payX, pickWhere, recall, recycleAllBut, replaceDeath, retarget, returnChampion, revealHand, revealRune, revealTop,
  revealUntil, swap,
} from '../../dsl/builders.ts';

const atBf = unitSel({ at: 'battlefield' });
const enemyAtBf = unitSel({ rel: 'enemy', at: 'battlefield' });
const friendly = unitSel({ rel: 'friendly' });

export const OGN_SET_DEFS = [
  unit('adaptatron', 'When I conquer, you may kill a gear. If you do, buff me.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' },
      prog([named('k', kill(ref.slot('g'))), iff(cond.did('k'), [buff(ref.self)])], [slot('g', gearSel(), { harm: true })]), { may: true })],
  }),
  unit('ahri-alluring', 'When I hold, you score 1 point.', {
    abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([points(1)]))],
  }),
  unit('anivia-primal', 'When I attack, deal 3 to all enemy units here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(3, unitSel({ rel: 'enemy', at: 'here' }))]))],
  }),
  gear('arena-bar', '[E]: Buff an exhausted friendly unit.', {
    abilities: [activated({ exhaustSelf: true }, prog([buff(ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', where: [pred.exhausted] }))]))],
  }),
  battlefield('aspirants-climb', 'Increase the points needed to win the game by 1.', [always({ s: 'victoryScore', n: 1 })]),
  unit('blastcone-fae', '[Hidden]\nWhen you play me, give a unit -2 [M] this turn, to a minimum of 1 [M].', {
    abilities: [onPlay(prog([might(2, ref.slot('a'), -1, { floor: 1 })], [slot('a', unitSel(), { harm: true })]))],
  }),
  spell('block', '[Hidden]\n[Action]\nGive a unit [Shield 3] and [Tank] this turn.', {
    kw: [kw.action()], choose: [slot('a', unitSel())], body: [grant(kw.shield(3), ref.slot('a')), grant(kw.tank(), ref.slot('a'))],
  }),
  unit('caitlyn-patrolling', "I must be assigned combat damage last.\n[E]: Deal damage equal to my Might to a unit at a battlefield. Use this ability only while I'm at a battlefield.", {
    abilities: [keywordTo(kw.backline()),
      activated({ exhaustSelf: true }, prog([deal(val.might(ref.self), ref.slot('a'))], [slot('a', atBf, { harm: true })]),
        { while: cond.selfAt('battlefield') })],
  }),
  unit('captain-farron', 'Other friendly units here have [Assault].', {
    abilities: [keywordTo(kw.assault(), unitSel({ rel: 'friendly', other: true, at: 'here' }))],
  }),
  unit('carnivorous-snapvine', 'When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other.', {
    abilities: [onPlay(prog([fight(ref.self, ref.slot('a'))], [slot('a', enemyAtBf, { harm: true })]))],
  }),
  spell('catalyst-of-aeons', "Channel 2 runes exhausted. If you couldn't channel 2 runes this way, draw 1.", {
    body: [named('c', channel(2, { exhausted: true })), iff(cond.not(cond.full('c')), [draw(1)])],
  }),
  unit('cithria-of-cloudfield', 'When you play another unit, buff me.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'], other: true } }, prog([buff(ref.self)]))],
  }),
  spell('cleave', '[Action]\nGive a unit [Assault 3] this turn.', {
    kw: [kw.action()], choose: [slot('a', unitSel())], body: [grant(kw.assault(3), ref.slot('a'))],
  }),
  unit('clockwork-keeper', 'You may pay [G] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, draw 1.', {
    abilities: [costAbility({ optional: true, add: { power: ['calm'] } }), onPlay(prog([draw(1)]), { if: cond.paid('clockwork-keeper#0') })],
  }),
  legend('darius-hand-of-noxus', '[E]: [Reaction], [Legion][>] [Add] [1].', [
    activated({ exhaustSelf: true }, prog([addEnergy(1)]), { timing: 'reaction', isAdd: true, while: cond.legion }),
  ]),
  unit('darius-trifarian', 'When you play your second card in a turn, give me +2 [M] this turn and ready me.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { card: true } }, prog([might(2, ref.self), ready(ref.self)]),
      { if: cond.thisTurn('played', { op: '=', n: 2 }) })],
  }),
  unit('deadbloom-predator', '[Deflect]\nYou may play me to an occupied enemy battlefield.', {
    abilities: [always({ s: 'playTo', where: 'occupiedEnemy' })],
  }),
  spell('defy', '[Reaction]\nCounter a spell that costs no more than [4] and no more than [A].', {
    kw: [kw.reaction()], choose: [slot('a', spellSel({ where: [pred.energyCost('<=', 4), pred.powerCost('<=', 1)] }), { harm: true })],
    body: [counter(ref.slot('a'))],
  }),
  unit('eclipse-herald', 'When you stun an enemy unit, ready me and give me +1 [M] this turn.', {
    abilities: [when({ on: 'stunned', who: 'enemy', at: 'any' }, prog([ready(ref.self), might(1, ref.self)]))],
  }),
  unit('ember-monk', 'When you play a card from [Hidden], give me +2 [M] this turn.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { fromFacedown: true } }, prog([might(2, ref.self)]))],
  }),
  gear('energy-conduit', '[Reaction][>] [E]: [Add] [1].', {
    abilities: [activated({ exhaustSelf: true }, prog([addEnergy(1)]), { timing: 'reaction', isAdd: true })],
  }),
  spell('falling-star', 'Deal 3 to a unit.\nDeal 3 to a unit.', {
    choose: [slot('a', unitSel(), { harm: true }), slot('b', unitSel(), { harm: true })],
    body: [deal(3, ref.slot('a')), deal(3, ref.slot('b'))],
  }),
  spell('find-your-center', "[Action]\nIf an opponent's score is within 3 points of the Victory Score, this costs [2] less.\nDraw 1 and channel 1 rune exhausted.", {
    kw: [kw.action()], abilities: [costAbility({ discount: { energy: 2 }, while: cond.opponentNearWin(3) })],
    body: [draw(1), channel(1, { exhausted: true })],
  }),
  unit('fiora-victorious', "While I'm [Mighty], I have [Deflect], [Ganking], and [Shield].", {
    abilities: [keywordTo(kw.deflect(), undefined, { while: cond.self(pred.mighty) }),
      keywordTo(kw.ganking(), undefined, { while: cond.self(pred.mighty) }), keywordTo(kw.shield(), undefined, { while: cond.self(pred.mighty) })],
  }),
  spell('flurry-of-blades', '[Reaction]\nDeal 1 to all units at battlefields.', { kw: [kw.reaction()], body: [deal(1, atBf)] }),
  gear('garbage-grabber', 'Recycle 3 from your trash, [1], [E]: Draw 1.', {
    abilities: [activated({ recycleTrash: { n: 3 }, energy: 1, exhaustSelf: true }, prog([draw(1)]))],
  }),
  unit('gemcraft-seer', '[Vision]\nOther friendly units have [Vision].', {
    abilities: [keywordTo(kw.vision(), unitSel({ rel: 'friendly', other: true }))],
  }),
  unit('harnessed-dragon', 'When you play me, kill an enemy unit.', {
    abilities: [onPlay(prog([kill(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  unit('herald-of-scales', "Your Dragons' Energy costs are reduced by [2], to a minimum of [1].", {
    abilities: [costAbility({ grant: { types: ['unit', 'gear', 'spell'], tag: 'Dragon' }, discount: { energy: 2, min: 1 } })],
  }),
  spell('hextech-ray', '[Action]\nDeal 3 to a unit at a battlefield.', {
    kw: [kw.action()], choose: [slot('a', atBf, { harm: true })], body: [deal(3, ref.slot('a'))],
  }),
  spell('icathian-rain', 'Deal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.', {
    choose: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => slot(id, unitSel(), { harm: true })),
    body: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => deal(2, ref.slot(id))),
  }),
  gear('iron-ballista', 'This enters exhausted.\n[E]: Deal 2 to a unit at a battlefield.', {
    abilities: [always({ s: 'entersExhausted' }),
      activated({ exhaustSelf: true }, prog([deal(2, ref.slot('a'))], [slot('a', atBf, { harm: true })]))],
  }),
  unit('kadregrin-the-infernal', 'When you play me, draw 1 for each of your [Mighty] units.', {
    abilities: [onPlay(prog([draw(val.count(unitSel({ rel: 'friendly', where: [pred.mighty] })))]))],
  }),
  legend('kaisa-daughter-of-the-void', '[Reaction][>] [E]: [Add] [A]. Use only to play spells.', [
    activated({ exhaustSelf: true }, prog([{ op: 'add', power: 1, onlyFor: 'spells' }]), { timing: 'reaction', isAdd: true }),
  ]),
  unit('kinkou-monk', 'When you play me, buff up to two other friendly units.', {
    abilities: [onPlay(prog([buff(ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', other: true }), { min: 0, max: 2 })]))],
  }),
  spell('last-breath', '[Action]\nReady a friendly unit. It deals damage equal to its Might to an enemy unit at a battlefield.', {
    kw: [kw.action()], choose: [slot('a', friendly), slot('b', enemyAtBf, { harm: true })],
    body: [ready(ref.slot('a')), dealFrom(ref.slot('a'), ref.slot('b'))],
  }),
  spell('last-stand', "[Action]\nDouble a friendly unit's Might this turn. Give it [Temporary].", {
    kw: [kw.action()], choose: [slot('a', friendly)], body: [double(ref.slot('a')), grant(kw.temporary(), ref.slot('a'), 'permanent')],
  }),
  unit('machine-evangel', '[Deathknell][>] Play three 1 [M] Recruit unit tokens into your base.', {
    abilities: [deathknell(prog([playToken('recruit', 3, 'yourBase')]))],
  }),
  unit('malzahar-fanatic', '[Action][>] Kill a friendly unit or gear, [E]: [Add] [A][A].', {
    abilities: [activated({ kill: { sel: permanentSel({ rel: 'friendly' }), n: 1 }, exhaustSelf: true }, prog([addPower(2)]),
      { timing: 'action', isAdd: true })],
  }),
  legend('miss-fortune-bounty-hunter', '[E]: Give a unit [Ganking] this turn.', [
    activated({ exhaustSelf: true }, prog([grant(kw.ganking(), ref.slot('a'))], [slot('a', unitSel())])),
  ]),
  battlefield('navori-fighting-pit', 'When you hold here, buff a unit here.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([buff(ref.slot('a'))], [slot('a', unitSel({ at: 'here' }))]), { controller: 'eventPlayer' }),
  ]),
  unit('noxus-hopeful', '[Legion][>] I cost [2] less.', { abilities: [costAbility({ discount: { energy: 2 }, while: cond.legion })] }),
  battlefield('obelisk-of-power', "At the start of each player's first Beginning Phase, that player channels 1 rune.", [
    when({ on: 'phase', at: 'beginning', whose: 'any' }, prog([channel(1)]), { controller: 'eventPlayer', if: cond.firstBeginning }),
  ]),
  unit('peak-guardian', 'When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there.', {
    abilities: [onPlay(prog([buff(ref.self), iff(cond.selfAt('battlefield'), [buff(unitSel({ rel: 'friendly', other: true, at: 'here' }))])]))],
  }),
  unit('pit-crew', 'When you play a gear, ready me.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['gear'] } }, prog([ready(ref.self)]))],
  }),
  unit('poro-herder', 'When you play me, if you control a Poro, buff me and draw 1.', {
    abilities: [onPlay(prog([buff(ref.self), draw(1)]), { if: cond.count(unitSel({ rel: 'friendly', other: true, where: [pred.tag('Poro')] }), '>=', 1) })],
  }),
  spell('primal-strength', '[Action]\nGive a unit +7 [M] this turn.', { kw: [kw.action()], choose: [slot('a', unitSel())], body: [might(7, ref.slot('a'))] }),
  spell('progress-day', 'Draw 4.', { body: [draw(4)] }),
  unit('qiyana-victorious', '[Deflect]\nWhen I conquer, draw 1 or channel 1 rune exhausted.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' },
      modal(1, [mode('Draw 1', [draw(1)]), mode('Channel 1 rune exhausted', [channel(1, { exhausted: true })])]))],
  }),
  spell('rebuke', "[Action]\nReturn a unit at a battlefield to its owner's hand.", {
    kw: [kw.action()], choose: [slot('a', atBf, { harm: true })], body: [returnToHand(ref.slot('a'))],
  }),
  spell('retreat', "[Reaction]\nReturn a friendly unit to its owner's hand. Its owner channels 1 rune exhausted.", {
    kw: [kw.reaction()], choose: [slot('a', friendly)], body: [returnToHand(ref.slot('a')), channel(1, { exhausted: true })],
  }),
  spell('ride-the-wind', '[Action]\nMove a friendly unit and ready it.', {
    kw: [kw.action()], choose: [slot('a', friendly), destSlot('d', 'a')], body: [move(ref.slot('a'), { dest: 'd' }), ready(ref.slot('a'))],
  }),
  unit('riptide-rex', 'When you play me, deal 6 to an enemy unit at a battlefield.', {
    abilities: [onPlay(prog([deal(6, ref.slot('a'))], [slot('a', enemyAtBf, { harm: true })]))],
  }),
  spell('rune-prison', '[Action]\nStun a unit.', { kw: [kw.action()], choose: [slot('a', unitSel(), { harm: true })], body: [stun(ref.slot('a'))] }),
  spell('salvage', '[Action]\nYou may kill up to one gear. Draw 1.', {
    kw: [kw.action()], choose: [slot('g', gearSel(), { min: 0, max: 1, harm: true })], body: [kill(ref.slot('g')), draw(1)],
  }),
  unit('scrapyard-champion', '[Legion][>] When you play me, discard 2, then draw 2.', {
    abilities: [onPlay(prog([discard(2), draw(2)]), { if: cond.legion })],
  }),
  unit('solari-chief', 'When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it.', {
    abilities: [onPlay(prog([iff(cond.is(ref.slot('a'), pred.stunned), [kill(ref.slot('a'))], [stun(ref.slot('a'))])],
      [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  unit('solari-shieldbearer', 'When you play me, stun a unit.', {
    abilities: [onPlay(prog([stun(ref.slot('a'))], [slot('a', unitSel(), { harm: true })]))],
  }),
  unit('soulgorger', 'When you play me, you may play a unit from your trash, ignoring its Energy cost.', {
    abilities: [onPlay(prog([playFree(ref.slot('c'), 'energy')], [slot('c', cardSel({ rel: 'friendly', where: [pred.type('unit')] }))]), { may: true })],
  }),
  unit('spectral-matron', 'When you play me, you may play a unit costing no more than [3] and no more than [A] from your trash, ignoring its cost.', {
    abilities: [onPlay(prog([playFree(ref.slot('c'))], [slot('c', cardSel({ rel: 'friendly',
      where: [pred.type('unit'), pred.energyCost('<=', 3), pred.powerCost('<=', 1)] }))]), { may: true })],
  }),
  spell('spoils-of-war', '[Reaction]\nIf an enemy unit has died this turn, this costs [2] less.\nDraw 2.', {
    kw: [kw.reaction()], abilities: [costAbility({ discount: { energy: 2 }, while: cond.thisTurn('unitDied', { rel: 'enemy' }) })],
    body: [draw(2)],
  }),
  unit('sprite-mother', 'When you play me, play a ready 3 [M] Sprite unit token with [Temporary] here.', {
    abilities: [onPlay(prog([playToken('sprite', 1, 'here', { ready: true })]))],
  }),
  spell('stacked-deck', '[Action]\nLook at the top 3 cards of your Main Deck. Put 1 into your hand and recycle the rest.', {
    kw: [kw.action()], body: [look(3, 'l'), pick('l', 1, 'h'), toHand(ref.bound('h')), recycleRest('l', 'h')],
  }),
  gear('sun-disc', '[Legion][>] [E]: The next unit you play this turn enters ready.', {
    abilities: [activated({ exhaustSelf: true }, prog([playerEffect({ s: 'entersReady', types: ['unit'], uses: 1 })]), { while: cond.legion })],
  }),
  unit('taric-protector', '[Shield]\n[Tank]\nOther friendly units here have [Shield].', {
    abilities: [keywordTo(kw.shield(), unitSel({ rel: 'friendly', other: true, at: 'here' }))],
  }),
  unit('tasty-faefolk', '[Accelerate]\n[Deathknell][>] Channel 2 runes exhausted and draw 1.', {
    abilities: [deathknell(prog([channel(2, { exhausted: true }), draw(1)]))],
  }),
  unit('teemo-scout', '[Hidden]\nWhen you play me, give me +3 [M] this turn.', { abilities: [onPlay(prog([might(3, ref.self)]))] }),
  battlefield('the-arenas-greatest', "At the start of each player's first Beginning Phase, that player gains 1 point.", [
    when({ on: 'phase', at: 'beginning', whose: 'any' }, prog([points(1)]), { controller: 'eventPlayer', if: cond.firstBeginning }),
  ]),
  battlefield('the-candlelit-sanctum', "When you conquer here, look at the top two cards of your Main Deck. You may recycle one or both of them. Put those you don't back in any order.", [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([predict(2)]), { controller: 'eventPlayer' }),
  ]),
  spell('the-harrowing', 'Play a unit from your trash, ignoring its Energy cost.', {
    choose: [slot('c', cardSel({ rel: 'friendly', where: [pred.type('unit')] }))], body: [playFree(ref.slot('c'), 'energy')],
  }),
  gear('the-syren', '[1], [E]: Move a friendly unit at a battlefield to its base.', {
    abilities: [activated({ energy: 1, exhaustSelf: true }, prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ rel: 'friendly', at: 'battlefield' }))]))],
  }),
  spell('thermo-beam', '[Action]\nKill all gear.', { kw: [kw.action()], body: [kill(gearSel())] }),
  unit('thousand-tailed-watcher', '[Accelerate]\nWhen you play me, give enemy units -3 [M] this turn, to a minimum of 1 [M].', {
    abilities: [onPlay(prog([might(3, unitSel({ rel: 'enemy' }), -1, { floor: 1 })]))],
  }),
  unit('trifarian-gloryseeker', '[Legion][>] When you play me, buff me.', { abilities: [onPlay(prog([buff(ref.self)]), { if: cond.legion })] }),
  unit('vanguard-captain', '[Legion][>] When you play me, play two 1 [M] Recruit unit tokens here.', {
    abilities: [onPlay(prog([playToken('recruit', 2, 'here')]), { if: cond.legion })],
  }),
  unit('warwick-hunter', 'I enter ready.\nWhen I attack, kill all damaged enemy units here.', {
    abilities: [entersReady(), when({ on: 'attack', who: 'self' }, prog([kill(unitSel({ rel: 'enemy', at: 'here', where: [pred.damaged] }))]))],
  }),
  unit('watchful-sentry', '[Deathknell][>] Draw 1.', { abilities: [deathknell(prog([draw(1)]))] }),
  unit('whiteflame-protector', 'When you play me, give a unit +8 [M] this turn.', {
    abilities: [onPlay(prog([might(8, ref.slot('a'))], [slot('a', unitSel())]))],
  }),
  spell('wind-wall', '[Reaction]\nCounter a spell.', { kw: [kw.reaction()], choose: [slot('a', spellSel(), { harm: true })], body: [counter(ref.slot('a'))] }),
  battlefield('windswept-hillock', 'Units here have [Ganking].', [keywordTo(kw.ganking(), unitSel({ at: 'here' }))]),
  unit('yasuo-remorseful', 'When I attack, deal damage equal to my Might to an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(val.might(ref.self), ref.slot('a'))],
      [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]))],
  }),
  unit('zaunite-bouncer', "When you play me, return another unit at a battlefield to its owner's hand.", {
    abilities: [onPlay(prog([returnToHand(ref.slot('a'))], [slot('a', unitSel({ at: 'battlefield', other: true }), { harm: true })]))],
  }),

  // ---- batch 2 ----
  legend('ahri-nine-tailed-fox', 'When an enemy unit attacks a battlefield you control, give it -1 [M] this turn, to a minimum of 1 [M].', [
    when({ on: 'attack', who: 'enemy', at: 'yours' }, prog([might(1, ref.subject, -1, { floor: 1 })])),
  ]),
  unit('albus-ferros', 'When you play me, spend any number of buffs. For each buff spent, channel 1 rune exhausted.', {
    abilities: [onPlay(prog([choose(unitSel({ rel: 'friendly', where: [pred.buffed] }), 'b', { min: 0, max: 99 }),
      spendBuffsOf(ref.bound('b')), channel(val.countBound('b'), { exhausted: true })]))],
  }),
  battlefield('back-alley-bar', 'When a unit moves from here, give it +1 [M] this turn.', [
    when({ on: 'moved', who: 'any', from: 'here' }, prog([might(1, ref.subject)]), { controller: 'eventPlayer' }),
  ]),
  unit('blitzcrank-impassive', "[Tank]\nWhen you play me to a battlefield, you may move an enemy unit to here.\nWhen I hold, return me to my owner's hand.", {
    abilities: [onPlay(prog([move(ref.slot('a'), 'here')], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]), { may: true, if: cond.playedToBf }),
      when({ on: 'hold', who: 'you', at: 'here' }, prog([returnToHand(ref.self)]))],
  }),
  unit('brynhir-thundersong', "When you play me, opponents can't play cards this turn.", {
    abilities: [onPlay(prog([playerEffect({ s: 'cantPlay' }, 'opponents')]))],
  }),
  spell('convergent-mutation', '[Reaction]\nChoose a friendly unit. This turn, increase its Might to the Might of another friendly unit.', {
    kw: [kw.reaction()], choose: [slot('a', friendly), slot('b', friendly, { distinctFrom: ['a'] })],
    body: [might(val.diff(val.might(ref.slot('b')), val.might(ref.slot('a'))), ref.slot('a'))],
  }),
  unit('dr-mundo-expert', 'My Might is increased by the number of cards in your trash.\nAt the start of your Beginning Phase, recycle 3 from your trash.', {
    abilities: [statik(val.count(cardSel({ rel: 'friendly' }))),
      when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([choose(cardSel({ rel: 'friendly' }), 'c', { min: 3 }), recycle(ref.bound('c'))]))],
  }),
  unit('ekko-recurrent', '[Accelerate]\n[Deathknell][>] Recycle me to ready your runes.', {
    abilities: [deathknell(prog([named('r', recycle(ref.now(ref.self))), iff(cond.did('r'), [ready(runeSel({ rel: 'friendly' }))])]))],
  }),
  gear('forge-of-the-future', 'When you play this, play a 1 [M] Recruit unit token at your base.\nKill this: Recycle up to 4 cards from trashes.', {
    abilities: [onPlay(prog([playToken('recruit', 1, 'yourBase')])),
      activated({ killSelf: true }, prog([recycle(ref.slot('c'))], [slot('c', cardSel({ rel: 'any' }), { min: 0, max: 4 })]))],
  }),
  unit('immortal-phoenix', '[Assault 2]\nWhen you kill a unit with a spell, you may pay [1][R] to play me from your trash.', {
    abilities: [when({ on: 'unitDies', at: 'any', each: true, killedBy: 'yourSpell' }, prog([playSelf({ energy: 1, power: ['fury'] })]),
      { may: true, activeIn: ['trash'] })],
  }),
  unit('jinx-rebel', 'When you discard one or more cards, ready me and give me +1 [M] this turn.', {
    abilities: [when({ on: 'discarded', who: 'you' }, prog([ready(ref.self), might(1, ref.self)]))],
  }),
  unit('karthus-eternal', 'Your [Deathknell] effects trigger an additional time.', { abilities: [always({ s: 'deathknellTwice' })] }),
  unit('kogmaw-caustic', '[Deathknell][>] Deal 4 to all units at my battlefield.', {
    abilities: [deathknell(prog([iff(cond.lkiAtBf, [deal(4, unitSel({ at: 'here' }))])]))],
  }),
  unit('lee-sin-ascetic', '[Shield]\n[E]: Buff me.\nI can have any number of buffs.', {
    abilities: [activated({ exhaustSelf: true }, prog([buff(ref.self)])), always({ s: 'maxBuffs' })],
  }),
  legend('leona-radiant-dawn', 'When you stun one or more enemy units, buff a friendly unit.', [
    when({ on: 'stunned', who: 'enemy', at: 'any', once: true }, prog([buff(ref.slot('a'))], [slot('a', friendly)])),
  ]),
  unit('leona-zealot', "If an opponent's score is within 3 points of the Victory Score, I enter ready.\nStunned enemy units here have -8 [M], to a minimum of 1 [M].", {
    abilities: [entersReady({ while: cond.opponentNearWin(3) }),
      always({ s: 'might', n: 8, dec: true, floor: 1, to: unitSel({ rel: 'enemy', at: 'here', where: [pred.stunned] }) })],
  }),
  unit('mageseeker-warden', "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear.", {
    abilities: [always({ s: 'opponentsPlayToBase' }, { while: cond.selfAt('battlefield') }),
      always({ s: 'noReadyByEffects', to: permanentSel({ rel: 'enemy' }) }, { while: cond.selfAt('battlefield') })],
  }),
  unit('miss-fortune-buccaneer', 'You may play me to an open battlefield.\nFriendly units may be played to open battlefields.', {
    abilities: [always({ s: 'playTo', where: 'open' }), always({ s: 'othersPlayTo', where: 'open', types: ['unit'] })],
  }),
  unit('miss-fortune-captain', "[Accelerate]\n[Ganking]\nThe first time I move each turn, you may ready something else that's exhausted.", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([ready(ref.slot('a'))], [slot('a', [unitSel({ rel: 'friendly', other: true, where: [pred.exhausted] }),
      gearSel({ rel: 'friendly', where: [pred.exhausted] }), runeSel({ rel: 'friendly', where: [pred.exhausted] })])]), { may: true, first: 'turn' })],
  }),
  unit('noxus-saboteur', "Your opponents' [Hidden] cards can't be revealed here.", { abilities: [always({ s: 'noFacedownPlayHere' })] }),
  spell('overt-operation', '[Action]\nFor each friendly unit, you may spend its buff to ready it. Then buff all friendly units.', {
    kw: [kw.action()],
    body: [choose(unitSel({ rel: 'friendly', where: [pred.buffed] }), 'b', { min: 0, max: 99 }), spendBuffsOf(ref.bound('b')),
      ready(ref.bound('b')), buff(friendly)],
  }),
  gear('pack-of-wonders', "[E]: Return another friendly gear, unit, or facedown card to its owner's hand.", {
    abilities: [activated({ exhaustSelf: true }, prog([returnToHand(ref.slot('a'))], [slot('a', [gearSel({ rel: 'friendly', other: true }), friendly,
      facedownSel({ rel: 'friendly' })])]))],
  }),
  gear('pirates-haven', 'When you ready a friendly unit, give it +1 [M] this turn.', {
    abilities: [when({ on: 'readied', who: 'friendly' }, prog([might(1, ref.subject)]))],
  }),
  unit('raging-firebrand', 'When you play me, the next spell you play this turn costs [5] less.', {
    abilities: [onPlay(prog([playerEffect({ s: 'costLess', types: ['spell'], energy: 5, uses: 1 })]))],
  }),
  gear('ravenborn-tome', '[E]: The next spell you play this turn deals 1 Bonus Damage.', {
    abilities: [activated({ exhaustSelf: true }, prog([playerEffect({ s: 'nextSpellBonus', n: 1, uses: 1 })]))],
  }),
  spell('showstopper', 'Buff a friendly unit in your base, then move it to a battlefield.', {
    choose: [slot('a', unitSel({ rel: 'friendly', at: 'base' })), destSlot('d', 'a', 'bf')],
    body: [buff(ref.slot('a')), move(ref.slot('a'), { dest: 'd' })],
  }),
  battlefield('sigil-of-the-storm', 'When you conquer here, you must recycle one of your runes.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([choose(runeSel({ rel: 'friendly' }), 'r'), recycle(ref.bound('r'))]), { controller: 'eventPlayer' }),
  ]),
  spell('sky-splitter', "[Action]\nThis spell's Energy cost is reduced by the highest Might among units you control.\nDeal 5 to a unit at a battlefield.", {
    kw: [kw.action()], abilities: [costAbility({ discount: { energy: val.maxMight(friendly) } })],
    choose: [slot('a', atBf, { harm: true })], body: [deal(5, ref.slot('a'))],
  }),
  unit('solari-shrine', 'When you kill a stunned enemy unit, you may exhaust this to draw 1.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'enemy', stunned: true, killedBy: 'you', each: true }, prog([draw(1)]),
      { may: true, cost: { exhaustSelf: true } })],
  }),
  gear('spirits-refuge', "When you play this, buff a friendly unit.\nFriendly buffed units have [Deflect] if they didn't already.", {
    abilities: [onPlay(prog([buff(ref.slot('a'))], [slot('a', friendly)])),
      always({ s: 'keyword', kw: kw.deflect(), to: unitSel({ rel: 'friendly', where: [pred.buffed] }), ifNot: true })],
  }),
  spell('stormbringer', 'Choose a friendly unit in your base. Deal damage equal to its Might to all enemy units at a battlefield, then move your unit there.', {
    choose: [slot('u', unitSel({ rel: 'friendly', at: 'base' })), slot('b', bfSel())],
    body: [deal(val.might(ref.slot('u')), unitSel({ rel: 'enemy', at: { slot: 'b' } })), move(ref.slot('u'), { slotBf: 'b' })],
  }),
  spell('super-mega-death-rocket', 'Deal 5 to a unit.\nWhen you conquer, you may discard 1 to return this from your trash to your hand.', {
    choose: [slot('a', unitSel(), { harm: true })], body: [deal(5, ref.slot('a'))],
    abilities: [when({ on: 'conquer', who: 'you', at: 'any' }, prog([returnToHand(ref.self)]),
      { may: true, cost: { discard: 1 }, activeIn: ['trash'] })],
  }),
  gear('symbol-of-the-solari', 'If a combat where you are the attacker ends in a tie, recall ALL units instead.', { abilities: [always({ s: 'tieRecallAll' })] }),
  spell('time-warp', 'Take a turn after this one. Banish this.', { body: [extraTurn, banishThis] }),
  gear('treasure-trove', 'When this leaves the board, draw 1 and channel 1 rune exhausted.\n[P], [E]: Kill this.', {
    abilities: [when({ on: 'leaves', who: 'self' }, prog([draw(1), channel(1, { exhausted: true })])),
      activated({ power: ['chaos'], exhaustSelf: true }, prog([kill(ref.self)]))],
  }),
  unit('tryndamere-barbarian', 'When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you score 1 point.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([points(1)]), { if: cond.excess(5) })],
  }),
  spell('unyielding-spirit', '[Reaction]\nPrevent all spell and ability damage this turn.', { kw: [kw.reaction()], body: [playerEffect({ s: 'preventNonCombat' })] }),
  gear('vanguard-helm', 'When a buffed friendly unit dies, buff another friendly unit.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendly', buffed: true, each: true }, prog([buff(ref.slot('a'))], [slot('a', friendly)]))],
  }),
  unit('viktor-leader', 'When another non-Recruit unit you control dies, play a 1 [M] Recruit unit token into your base.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendlyOther', notTag: 'Recruit', each: true }, prog([playToken('recruit', 1, 'yourBase')]))],
  }),
  battlefield('vilemaws-lair', "Units can't move from here to base.", [always({ s: 'noMoveToBase' })]),
  unit('volibear-imposing', '[Shield 3]\n[Tank]\nWhen an opponent moves to a battlefield other than mine, draw 1.', {
    abilities: [when({ on: 'moved', who: 'opponent', to: 'otherBf' }, prog([draw(1)]))],
  }),
  legend('volibear-relentless-storm', 'When you play a [Mighty] unit, you may exhaust me to channel 1 rune exhausted.', [
    when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([channel(1, { exhausted: true })]),
      { may: true, cost: { exhaustSelf: true }, if: cond.is(ref.subject, pred.mighty) }),
  ]),

  // ---- batch 3 ----
  spell('acceptable-losses', '[Action]\nEach player kills one of their gear.', {
    kw: [kw.action()], body: [forEach('each', 'you', [choose(gearSel({ rel: 'friendly' }), 'g')]), kill(ref.bound('g'))],
  }),
  unit('ava-achiever', "When I attack, you may pay [B] to play a card with [Hidden] from your hand, ignoring its cost. If it's a unit, play it here.", {
    abilities: [when({ on: 'attack', who: 'self' }, prog([choose(cardSel({ in: 'hand', rel: 'friendly', where: [pred.keyword('hidden')] }), 'c'),
      playFree(ref.bound('c'), 'all', { at: 'here' })]), { may: true, cost: { power: ['mind'] } })],
  }),
  gear('baited-hook', '[1][Y], [E]: Kill a friendly unit. Look at the top 5 cards of your Main Deck. You may banish a unit from among them that has Might up to 1 more than the killed unit and play it, ignoring its cost. Then recycle the rest.', {
    abilities: [activated({ energy: 1, power: ['order'], exhaustSelf: true }, prog([kill(ref.slot('a')), look(5, 'l'),
      pickWhere('l', 1, 'u', { min: 0, where: [pred.type('unit')], mightMax: val.sum(val.might(ref.slot('a')), 1) }),
      named('b', banish(ref.bound('u'))), playFree(ref.bound('b')), recycleRest('l', 'u')], [slot('a', friendly)]))],
  }),
  spell('blind-fury', '[Action]\nEach opponent reveals the top card of their Main Deck. Choose one and banish it, then play it, ignoring its cost. Then recycle the rest.', {
    kw: [kw.action()],
    body: [forEach('opponents', 'next', [revealTop('r')]), pick('r', 1, 'c'), named('b', banish(ref.bound('c'))), playFree(ref.bound('b')),
      recycleRest('r', 'c')],
  }),
  spell('bullet-time', '[Action]\nPay any amount of [A] to deal that much damage to all enemy units at a battlefield.', {
    kw: [kw.action()], choose: [slot('b', bfSel())],
    body: [payX('x'), deal(val.x('x'), unitSel({ rel: 'enemy', at: { slot: 'b' } }))],
  }),
  spell('call-to-glory', "[Reaction]\nAs you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\nGive a unit +3 [M] this turn.", {
    kw: [kw.reaction()], abilities: [costAbility({ optional: true, pay: { spendBuff: { sel: friendly, n: 1 } }, discount: { energy: 0, all: true } })],
    choose: [slot('a', unitSel())], body: [might(3, ref.slot('a'))],
  }),
  unit('commander-ledros', 'As you play me, you may kill any number of friendly units as an additional cost. Reduce my cost by [Y] for each killed this way.\n[Deflect]\n[Ganking]', {
    abilities: [costAbility({ x: { kill: friendly, lessPower: 'order' } })],
  }),
  gear('dazzling-aurora', 'At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit and banish it. Play it, ignoring its cost, and recycle the rest.', {
    abilities: [when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([revealUntil(['unit'], 'u', 'rest'), named('b', banish(ref.bound('u'))),
      playFree(ref.bound('b')), recycle(ref.bound('rest'))]))],
  }),
  spell('divine-judgment', 'Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands. Recycle the rest.', {
    body: [forEach('each', 'you', [choose(friendly, 'ku', { min: 2 }), choose(gearSel({ rel: 'friendly' }), 'kg', { min: 2 }),
      choose(runeSel({ rel: 'friendly' }), 'kr', { min: 2 }), choose(cardSel({ in: 'hand', rel: 'friendly' }), 'kh', { min: 2 })]),
    recycleAllBut([unitSel(), gearSel(), runeSel(), cardSel({ in: 'hand', rel: 'any' })], ['ku', 'kg', 'kr', 'kh'])],
  }),
  spell('dragons-rage', 'Move an enemy unit. Then do this: Choose another enemy unit at its destination. They deal damage equal to their Mights to each other.', {
    choose: [slot('a', unitSel({ rel: 'enemy' }), { harm: true }), destSlot('d', 'a')],
    body: [move(ref.slot('a'), { dest: 'd' }), choose(unitSel({ rel: 'enemy', at: { slot: 'd' } }), 'b', { notSlots: ['a'] }),
      fight(ref.slot('a'), ref.bound('b'))],
  }),
  spell('facebreaker', '[Hidden]\n[Action]\nStun a friendly unit and an enemy unit at the same battlefield.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ rel: 'friendly', at: 'battlefield' })), slot('b', unitSel({ rel: 'enemy', at: { slot: 'a' } }), { harm: true })],
    body: [stun(ref.slot('a')), stun(ref.slot('b'))],
  }),
  spell('fox-fire', '[Hidden]\n[Action]\nKill any number of units at a battlefield with total Might 4 or less.', {
    kw: [kw.action()],
    choose: [slot('f', bfSel()), { ...slot('u', unitSel({ at: { slot: 'f' } }), { min: 0, max: 99, harm: true }), sumMightMax: 4 }],
    body: [kill(ref.slot('u'))],
  }),
  spell('guerilla-warfare', 'Return up to two cards with [Hidden] from your trash to your hand. You can hide ignoring costs this turn.', {
    choose: [slot('c', cardSel({ rel: 'friendly', where: [pred.keyword('hidden')] }), { min: 0, max: 2 })],
    body: [returnToHand(ref.slot('c')), playerEffect({ s: 'hideFree' })],
  }),
  battlefield('hallowed-tomb', 'When you hold here, you may return your Chosen Champion from your trash to your Champion Zone if it is empty.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([returnChampion]), { may: true, controller: 'eventPlayer' }),
  ]),
  spell('imperial-decree', '[Action]\nWhen any unit takes damage this turn, kill it.', {
    kw: [kw.action()], body: [delayed(999, { on: 'damaged' }, prog([kill(ref.subject)]))],
  }),
  spell('invert-timelines', 'Each player discards their hand, then draws 4.', { body: [forEach('each', 'you', [discardHand, draw(4)])] }),
  unit('kaisa-evolutionary', '[Ganking]\nWhen I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([playFree(ref.slot('c'), 'energy', { leaveChain: 'recycle' })],
      [slot('c', cardSel({ rel: 'friendly', where: [pred.type('spell'), pred.energyCostVsPoints('<')] }))]), { may: true })],
  }),
  spell('kings-edict', "Starting with the next player, each other player chooses a unit you don't control that hasn't been chosen for this spell. Kill those units.", {
    body: [forEach('opponents', 'next', [choose(friendly, 'k')]), kill(ref.bound('k'))],
  }),
  unit('kraken-hunter', '[Accelerate]\n[Assault]\nAs you play me, you may spend any number of buffs as an additional cost. Reduce my cost by [O] for each buff you spend.', {
    abilities: [costAbility({ x: { spendBuff: friendly, lessPower: 'body' } })],
  }),
  unit('mindsplitter', 'When you play me, choose an opponent. They reveal their hand. Choose a card from it, and they discard that card.', {
    abilities: [onPlay(prog([revealHand, choose(cardSel({ in: 'hand', rel: 'enemy' }), 'c'), discardCards(ref.bound('c'))]))],
  }),
  spell('mystic-reversal', '[Reaction]\nGain control of a spell. You may make new choices for it.', {
    kw: [kw.reaction()], choose: [slot('a', spellSel({ rel: 'enemy' }), { harm: true })], body: [retarget(ref.slot('a'))],
  }),
  unit('nocturne-horrifying', '[Ganking]\nAs you look at or reveal me from the top of your deck, you may banish me. If you do, you may play me for [A].', {
    abilities: [when({ on: 'seenOnTop' }, prog([iff(cond.is(ref.now(ref.self), pred.inZone('deck')), [named('b', banish(ref.now(ref.self))),
      iff(cond.did('b'), [may([playFree(ref.bound('b'), 'all', { cost: { power: ['A'] } })])])])]), { may: true, activeIn: ['deck'] })],
  }),
  spell('noxian-guillotine', '[Action]\nChoose a unit. Kill it the next time it takes damage this turn.\n[Legion][>] Kill it now instead.', {
    kw: [kw.action()], choose: [slot('a', unitSel(), { harm: true })],
    body: [iff(cond.legion, [kill(ref.slot('a'))],
      [delayed(1, { on: 'damaged', info: 'u' }, prog([kill(ref.subject)]), { capture: { u: ref.slot('a') } })])],
  }),
  spell('party-favors', 'Each other player chooses Cards or Runes. For each player that chooses Cards, you and that player each draw 1. For each player that chooses Runes, you and that player each channel 1 rune exhausted.', {
    body: [forEach('opponents', 'next', [choiceBy('self', [
      { label: 'Cards', body: [draw(1), casterDraws(1)] },
      { label: 'Runes', body: [channel(1, { exhausted: true }), { op: 'channel', n: 1, exhausted: true, caster: true }] },
    ])])],
  }),
  spell('portal-rescue', '[Action]\nBanish a friendly unit, then its owner plays it to their base, ignoring its cost.', {
    kw: [kw.action()], choose: [slot('a', friendly)],
    body: [named('b', banish(ref.slot('a'))), playFree(ref.bound('b'), 'all', { at: 'base', by: 'owner' })],
  }),
  spell('possession', '[Action]\nChoose an enemy unit at a battlefield. Take control of it and recall it.', {
    kw: [kw.action()], choose: [slot('a', enemyAtBf, { harm: true })], body: [named('c', gainControl(ref.slot('a'))), recall(ref.bound('c'))],
  }),
  spell('promising-future', 'Each player looks at the top 5 cards of their Main Deck, banishes one of them, then recycles the rest. Starting with the next player, each player plays those cards, ignoring Energy costs.', {
    body: [forEach('each', 'you', [look(5, 'l'), pick('l', 1, 'c'), named('bb', banish(ref.bound('c'))), recycleRest('l', 'c')]),
      forEach('each', 'next', [playFree(ref.bound('bb'), 'energy')])],
  }),
  battlefield('reckoners-arena', 'When you hold here, activate the conquer effects of units here.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([activateConquer]), { controller: 'eventPlayer' }),
  ]),
  spell('reinforce', 'Look at the top 5 cards of your Main Deck. You may banish a unit from among them, then play it, reducing its cost by [5]. Recycle the remaining cards.', {
    body: [look(5, 'l'), pickWhere('l', 1, 'u', { min: 0, where: [pred.type('unit')] }), named('b', banish(ref.bound('u'))),
      { op: 'playCard', what: ref.bound('b'), energyLess: 5 }, recycleRest('l', 'u')],
  }),
  spell('sabotage', 'Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card.', {
    body: [revealHand, choose(cardSel({ in: 'hand', rel: 'enemy', where: [pred.not(pred.type('unit'))] }), 'c'), recycle(ref.bound('c'))],
  }),
  legend('sett-the-boss', 'If a buffed unit you control would die, you may pay [A], exhaust me, and spend its buff to heal it, exhaust it, and recall it instead.\nWhen you conquer, ready me.', [
    always({ s: 'saveBuffed', cost: { power: ['A'] } }), when({ on: 'conquer', who: 'you', at: 'any' }, prog([ready(ref.self)])),
  ]),
  spell('shakedown', '[Reaction]\nChoose an enemy unit. Deal 6 to it unless its controller has you draw 2.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [choiceBy({ controllerOf: ref.slot('a') }, [{ label: 'You draw 2', body: [draw(2)] }, { label: 'Take 6', body: [deal(6, ref.slot('a'))] }])],
  }),
  spell('siphon-power', '[Reaction]\nChoose a battlefield. Give friendly units there +1 [M] this turn and enemy units there -1 [M] this turn, to a minimum of 1 [M].', {
    kw: [kw.reaction()], choose: [slot('b', bfSel())],
    body: [might(1, unitSel({ rel: 'friendly', at: { slot: 'b' } })), might(1, unitSel({ rel: 'enemy', at: { slot: 'b' } }), -1, { floor: 1 })],
  }),
  unit('stealthy-pursuer', 'When a friendly unit moves from my location, I may be moved with it.', {
    abilities: [when({ on: 'moved', who: 'friendlyOther', from: 'here' }, prog([move(ref.self, 'eventTo')]), { may: true })],
  }),
  legend('teemo-swift-scout', 'You may pay [1] to hide a card with [Hidden] instead of [A].\n[1], [E]: Put a Teemo unit you own into your hand from your Champion Zone or the board.', [
    always({ s: 'hideFor', cost: { energy: 1 } }),
    activated({ energy: 1, exhaustSelf: true }, prog([returnToHand(ref.slot('t'))], [slot('t', [unitSel({ rel: 'friendly', where: [pred.tag('Teemo')] }),
      cardSel({ in: 'champion', rel: 'friendly', where: [pred.tag('Teemo'), pred.type('unit')] })])])),
  ]),
  battlefield('the-dreaming-tree', 'When a player chooses a friendly unit here with a spell for the first time each turn, they draw 1.', [
    when({ on: 'chosenBySpell', at: 'here' }, prog([draw(1)]), { controller: 'eventPlayer' }),
  ]),
  unit('tideturner', '[Hidden]\nWhen you play me, you may choose a unit you control at another location. Move me to its location and it to my original location.', {
    abilities: [onPlay(prog([swap(ref.self, ref.slot('u'))], [slot('u', unitSel({ rel: 'friendly', at: 'elsewhere' }))]), { may: true })],
  }),
  unit('twisted-fate-gambler', 'When I attack, reveal the top rune of your rune deck, then recycle it. Do one of the following based on its domain:\n• [R] — Deal 2 to an enemy unit here and 1 to all other enemy units here.\n• [B] — Draw 1.\n• [Y] — Stun an enemy unit.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([revealRune('r'),
      iff(cond.boundDomain('r', 'fury'), [choose(unitSel({ rel: 'enemy', at: 'here' }), 't'), deal(1, unitSel({ rel: 'enemy', at: 'here' })), deal(1, ref.bound('t'))]),
      iff(cond.boundDomain('r', 'mind'), [draw(1)]),
      iff(cond.boundDomain('r', 'order'), [choose(unitSel({ rel: 'enemy' }), 's'), stun(ref.bound('s'))])]))],
  }),
  spell('unchecked-power', 'Exhaust all friendly units, then deal 12 to all units at battlefields.', {
    body: [exhaust(friendly), deal(12, atBf)],
  }),
  gear('unlicensed-armory', 'Discard 1, [E]: Choose a friendly unit. The next time it would die this turn, you may pay [R] to heal it, exhaust it, and recall it instead.', {
    abilities: [activated({ discard: 1, exhaustSelf: true }, prog([replaceDeath(ref.slot('a'), { power: ['fury'] })], [slot('a', friendly)]))],
  }),
  unit('volibear-furious', '[Deflect 2]\nWhen I attack, deal 5 damage split among any number of enemy units here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([dealSplit(5, unitSel({ rel: 'enemy', at: 'here' }))]))],
  }),
  spell('wallop', "[Action]\nAs you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\nReady a unit.", {
    kw: [kw.action()], abilities: [costAbility({ optional: true, pay: { spendBuff: { sel: friendly, n: 1 } }, discount: { energy: 0, all: true } })],
    choose: [slot('a', unitSel())], body: [ready(ref.slot('a'))],
  }),
  spell('whirlwind', "Starting with the next player, each player may return a unit to its owner's hand.", {
    body: [forEach('each', 'next', [choose(unitSel(), 'r', { min: 0, max: 1 }), returnToHand(ref.bound('r'))])],
  }),
  legend('yasuo-unforgiven', '[2], [E]: Move a friendly unit to or from its base.', [
    activated({ energy: 2, exhaustSelf: true }, prog([move(ref.slot('a'), { dest: 'd' })], [slot('a', friendly), destSlot('d', 'a', 'toOrFromBase')])),
  ]),
  spell('zenith-blade', "[Action]\nStun an enemy unit at a battlefield. You may move a friendly unit to that enemy unit's battlefield.", {
    kw: [kw.action()], choose: [slot('a', enemyAtBf, { harm: true })],
    body: [stun(ref.slot('a')), choose(friendly, 'm', { min: 0, max: 1 }), move(ref.bound('m'), { locOf: ref.slot('a') })],
  }),
  gear('zhonyas-hourglass', '[Hidden]\nIf a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it.', {
    abilities: [always({ s: 'saveFriendly' })],
  }),
];
