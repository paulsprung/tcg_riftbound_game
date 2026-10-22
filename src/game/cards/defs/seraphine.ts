/*
 * Card definitions for the Seraphine Showdown Deck (§13.1, §13.2): the
 * cards whose text the chain, the interpreter and the triggers of M1.2 can
 * carry. Each `text` is the oracle's rules text, word for word (the
 * registry checks it). The rest of the deck (layers, replacements, Show
 * Off, the cost pipeline, delayed abilities) arrives with M1.3; until then
 * those units are vanilla bodies and those spells can't be played.
 */
import {
  activated, banish, battlefield, buff, burn, channel, deal, discard, draw, gear, gearSel, kw, look, might, mode,
  onPlay, pick, playSelf, playToken, pred, predict, prog, ready, recycleRest, ref, slot, spell, stun, unit, unitSel, val,
  when,
} from '../../dsl/builders.ts';

export const SERAPHINE_DEFS = [
  unit('seraphine-inspiring',
    '[Disarm 2]\nOnce each turn, when you exhaust three or more friendly units at the same time, you may draw 1.', {
      kw: [kw.disarm(2)],
      abilities: [when({ on: 'exhaustBatch', by: 'you', min: 3 }, prog([draw(1)]), { may: true, limit: { n: 1, per: 'turn' } })],
    }),

  unit('seraphine-not-alone',
    'When you play me or when I become exhausted, play a 1 [M] Recruit unit token to your base.\n'
    + 'I have +1 [M] for each other exhausted unit you control.', {
      abilities: [
        onPlay(prog([playToken('recruit', 1, 'yourBase')])),
        when({ on: 'becomesExhausted', what: 'self' }, prog([playToken('recruit', 1, 'yourBase')])),
      ],
      missing: ['I have +1 [M] for each other exhausted unit you control.'],
    }),

  spell('encore',
    'Choose two —\n• Deal 2 to a unit.\n• Play two 1 [M] Recruit unit tokens.\n• Give up to two units each +1 [M] this turn.\n'
    + '• Look at the top 2 cards of your Main Deck, draw 1 and recycle the other.', {
      modes: {
        pick: 2,
        of: [
          mode('Deal 2 to a unit.', [deal(2, ref.slot('a'))], [slot('a', unitSel(), { harm: true })]),
          mode('Play two 1 [M] Recruit unit tokens.', [playToken('recruit', 2, 'choose')]),
          mode('Give up to two units each +1 [M] this turn.', [might(1, ref.slot('b'))], [slot('b', unitSel(), { min: 0, max: 2 })]),
          mode('Look at the top 2 cards of your Main Deck, draw 1 and recycle the other.',
            [look(2, 'L'), pick('L', 1, 'P'), draw(1, ref.bound('P')), recycleRest('L', 'P')]),
        ],
      },
      body: [],
    }),

  spell('raucous-anthem', 'Ready your units and give them +3 [M] this turn.', {
    body: [ready(unitSel({ rel: 'friendly' })), might(3, unitSel({ rel: 'friendly' }))],
  }),

  spell('supernova', 'Deal 10 to a unit. Draw 2.', {
    choose: [slot('a', unitSel(), { harm: true })],
    body: [deal(10, ref.slot('a')), draw(2)],
  }),

  spell('burn-away', 'Banish a unit with 3 [M] or less or a gear. [Burn 2].', {
    choose: [slot('a', [unitSel({ where: [pred.might('<=', 3)] }), gearSel()], { harm: true })],
    body: [banish(ref.slot('a')), burn(2)],
  }),

  gear('concert-poster',
    '[Deploy]\nWhen you play this or when you conquer here, you may pay [1] to play a 1 [M] Recruit unit token to your base.', {
      kw: [kw.deploy()],
      abilities: [
        onPlay(prog([playToken('recruit', 1, 'yourBase')]), { may: true, cost: { energy: 1 } }),
        when({ on: 'conquer', who: 'you', at: 'here' }, prog([playToken('recruit', 1, 'yourBase')]),
          { may: true, cost: { energy: 1 } }),
      ],
    }),

  unit('strigian-oracle', 'When I become exhausted, [Predict].', {
    abilities: [when({ on: 'becomesExhausted', what: 'self' }, prog([predict(1)]))],
  }),

  spell('high-note', '[Reaction]\nGive a unit -[M] this turn equal to the number of exhausted units you control.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [might(val.count(unitSel({ rel: 'friendly', where: [pred.exhausted] })), ref.slot('a'), -1)],
  }),

  spell('moonlight-affliction', '[Reaction]\nGive a unit -10 [M] this turn.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [might(10, ref.slot('a'), -1)],
  }),

  unit('industrious-mechsmith', 'When you play me, play a 3 [M] Mech unit token here.', {
    abilities: [onPlay(prog([playToken('mech', 1, 'here')]))],
  }),

  unit('faithful-manufactor', 'When you play me, play a 1 [M] Recruit unit token here.', {
    abilities: [onPlay(prog([playToken('recruit', 1, 'here')]))],
  }),

  unit('meticulous-restorationist',
    'When you play a card with Energy cost [7] or more, you may play me from your trash for [Y].', {
      abilities: [when({ on: 'cardPlayed', by: 'you', what: { minEnergy: 7 } }, prog([playSelf({ power: ['order'] })]),
        { may: true, activeIn: ['trash'] })],
    }),

  battlefield('black-rose-sanctum',
    'For each player, the first time each turn a non-token unit they control dies here, they play a 1 [M] Recruit unit '
    + 'token to their base.', [
      when({ on: 'unitDies', nonToken: true, at: 'here', firstPerPlayer: true }, prog([playToken('recruit', 1, 'yourBase')]),
        { controller: 'eventPlayer' }),
    ]),

  battlefield('ruined-monastery', 'When you conquer here, you may discard 1 and channel 1 rune exhausted.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([discard(1), channel(1, { exhausted: true })]),
      { may: true, controller: 'eventPlayer' }),
  ]),

  battlefield('valley-of-idols', 'When a player plays a unit here, they may pay [1] to [Buff] it.', [
    when({ on: 'cardPlayed', by: 'anyPlayer', what: { types: ['unit'] }, to: 'here' }, prog([buff(ref.subject)]),
      { may: true, cost: { energy: 1 }, controller: 'eventPlayer' }),
  ]),
];

/** Cards of other decks the engine tests use: an activated ability with
    an [E] cost and default timing [381]. */
export const OTHER_DEFS = [
  unit('pitiless-stalker', '[E]: [Stun] an enemy unit.', {
    abilities: [activated({ exhaustSelf: true }, prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
];
