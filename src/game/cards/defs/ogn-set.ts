/*
 * Origins (OGN): the cards of the set beyond its Champion Decks (ogn.ts).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, addEnergy, always, battlefield, buff, cardSel, channel, cond, costAbility, counter, deal, dealFrom, deathknell,
  destSlot, discard, double, draw, entersReady, fight, gear, gearSel, grant, iff, keywordTo, kill, kw, legend, look, might,
  mode, modal, move, named, onPlay, permanentSel, pick, playerEffect, playFree, playToken, points, pred, predict, prog, ready,
  recycleRest, ref, returnToHand, slot, spell, spellSel, stun, toHand, unit, unitSel, val, when, addPower,
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
];
