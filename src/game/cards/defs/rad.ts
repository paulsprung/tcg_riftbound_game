/*
 * Radiance (RAD) Showdown Deck cards not in the Seraphine deck: the Evelynn
 * deck. Each `text` is the oracle's rules text, word for word (a test
 * checks it).
 */
import {
  addPower, always, banish, battlefield, bfSel, buff, cond, costAbility, delayed, destSlot, discard, draw, entersReady, facedownSel,
  gear, grant, iff, kw, legend, may, might, mode, modal, move, named, onPlay, opponentsDraw, pay, playerEffect, playToken, points,
  pred, predict, prog, ready, recycle, ref, returnToHand, slot, spell, unit, unitSel, when,
} from '../../dsl/builders.ts';

void may;

export const RAD_DEFS = [
  legend('evelynn-agonys-embrace',
    "Once each turn, when you play a card from face down, draw 1. Then, if it's not your turn, discard 1.", [
      when({ on: 'cardPlayed', by: 'you', what: { fromFacedown: true } }, prog([draw(1), iff(cond.not(cond.yourTurn), [discard(1)])]),
        { limit: { n: 1, per: 'turn' } }),
    ]),

  unit('evelynn-consuming', '[Ambush]\nWhen you play a card from face down, ready me and give me +1 [M] this turn.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { fromFacedown: true } }, prog([ready(ref.self), might(1, ref.self)]))],
  }),

  unit('evelynn-in-control', '[Disarm]\nWhen I hold, if you control a facedown card here, score 1 point.', {
    abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([points(1)]),
      { if: cond.count(facedownSel({ rel: 'friendly', at: 'here' }), '>=', 1) })],
  }),

  spell('last-caress',
    '[Reaction]\nThe next unit you play this turn, even from face down, can be played to any battlefield. When you play it, [Buff] it.', {
      kw: [kw.reaction()],
      body: [playerEffect({ s: 'playAnywhere', types: ['unit'], uses: 1 }),
        delayed(1, { on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([buff(ref.subject)]))],
    }),

  gear('bushwhack-trap', '[Deploy]\nWhile you or an ally control this battlefield, that player may hide an additional card here.', {
    abilities: [always({ s: 'facedownCapacity', n: 1, for: 'controller' })],
  }),

  unit('ksante-courageous', '[Accelerate]\n[Shield 2]\nWhen I hold, channel 1 rune.', {
    abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([{ op: 'channel', n: 1 }]))],
  }),

  unit('gutter-guardian', '[Hidden]\n[Show Off] a card with [Hidden].\nWhen you play me, if you showed off, [Add] [A].', {
    kw: [kw.showOff({ withKeyword: 'hidden' })],
    abilities: [onPlay(prog([addPower(1)]), { if: cond.showedOff })],
  }),

  spell('demon-shade',
    '[Hidden]\nChoose a friendly unit, then choose one —\n• Move it to an open battlefield.\n'
    + '• Give it [Ganking] this turn if there are no open battlefields.', {
      ...modal(1, [
        mode('Move it to an open battlefield.', [move(ref.slot('a'), { dest: 'd' })], [destSlot('d', 'a', 'open')]),
        mode('Give it [Ganking] this turn if there are no open battlefields.',
          [iff(cond.count(bfSel({ where: [pred.open] }), '=', 0), [grant(kw.ganking(), ref.slot('a'))])]),
      ], [slot('a', unitSel({ rel: 'friendly' }))]),
    }),

  gear('the-good-stuff', "[Deploy]\nWhen you play this, discard 1, then draw 3.\nWhen you hold here, return this to its owner's hand.", {
    abilities: [onPlay(prog([discard(1), draw(3)])), when({ on: 'hold', who: 'you', at: 'here' }, prog([returnToHand(ref.self)]))],
  }),

  unit('elnuk-herd', '[Hidden]\nWhen you play me, give a friendly unit +3 [M] this turn, then recycle me if I was played from face down.', {
    abilities: [onPlay(prog([might(3, ref.slot('a')), iff(cond.playedFrom('facedown'), [recycle(ref.self)])],
      [slot('a', unitSel({ rel: 'friendly' }))]))],
  }),

  unit('reckless-innovator', '[Accelerate]\nWhen I become exhausted, choose one —\n• Play a Gold gear token exhausted.\n• Pay [P] to draw 1.', {
    abilities: [when({ on: 'becomesExhausted', what: 'self' }, modal(1, [
      mode('Play a Gold gear token exhausted.', [playToken('gold', 1, 'yourBase', { exhausted: true })]),
      mode('Pay [P] to draw 1.', [named('p', pay({ power: ['chaos'] })), iff(cond.did('p'), [draw(1)])]),
    ]))],
  }),

  spell('wind-and-ghosts',
    "[Action]\nChoose a unit at a battlefield. If it has 3 [M] or less, banish it. Otherwise, return it to its owner's hand.", {
      kw: [kw.action()],
      choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
      body: [iff(cond.is(ref.slot('a'), pred.might('<=', 3)), [banish(ref.slot('a'))], [returnToHand(ref.slot('a'))])],
    }),

  unit('sneaky-zeebles', 'When I conquer, [Add] [A].', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([addPower(1)]))],
  }),

  spell('hold-em', "[Action]\nThis costs [2] less if you've played a unit or gear to a battlefield this turn.\nGive a unit +3 [M] this turn.", {
    kw: [kw.action()],
    abilities: [costAbility({ discount: { energy: 2 }, while: cond.thisTurn('playedToBf', { types: ['unit', 'gear'] }) })],
    choose: [slot('a', unitSel())],
    body: [might(3, ref.slot('a'))],
  }),

  spell('the-waters-wage',
    "[Hidden]\nPlay a Gold gear token exhausted. If it's your turn and you played this from face down, play three ready Gold gear tokens instead.", {
      body: [iff(cond.and(cond.yourTurn, cond.playedFrom('facedown')), [playToken('gold', 3, 'yourBase', { ready: true })],
        [playToken('gold', 1, 'yourBase', { exhausted: true })])],
    }),

  unit('momentary-companion', "[Hidden]\nWhen you play me, if it's not your turn, give me [Temporary].", {
    abilities: [onPlay(prog([grant(kw.temporary(), ref.self, 'permanent')]), { if: cond.not(cond.yourTurn) })],
  }),

  unit('suave-negotiator', 'When you play me, choose an opponent. You and that player each draw 1.', {
    abilities: [onPlay(prog([draw(1), opponentsDraw(1)]))],
  }),

  unit('wrath-of-the-freljord', 'I enter ready.\n[Shield 3]', { abilities: [entersReady()] }),

  unit('black-market-broker', 'When you play a card from face down, play a Gold gear token exhausted.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { fromFacedown: true } }, prog([playToken('gold', 1, 'yourBase', { exhausted: true })]))],
  }),

  spell('sirens-song', '[Reaction]\nMove an enemy unit that moved this turn.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel({ rel: 'enemy', where: [pred.moved] }), { harm: true }), destSlot('d', 'a')],
    body: [move(ref.slot('a'), { dest: 'd' })],
  }),

  battlefield('bandle-scouts-academy', 'When you hide a card here, play a Gold gear token exhausted.', [
    when({ on: 'hid', at: 'here' }, prog([playToken('gold', 1, 'yourBase', { exhausted: true })]), { controller: 'eventPlayer' }),
  ]),

  battlefield('rakelstake', 'For each player, the first time they play a unit or gear here each turn, they [Predict].', [
    when({ on: 'cardPlayed', by: 'anyPlayer', what: { types: ['unit', 'gear'] }, to: 'here', firstPerPlayer: true }, prog([predict(1)]),
      { controller: 'eventPlayer' }),
  ]),

  battlefield('bandle-tree', 'You may hide an additional card here.', [always({ s: 'facedownCapacity', n: 1, for: 'any' })]),
];
