/*
 * Card definitions for the Seraphine Showdown Deck (§13.1, §13.2): all 28
 * entries (the legend, 24 main-deck cards, 3 battlefields). Each `text` is
 * the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, banish, baseMight, battlefield, bfSel, buff, burn, channel, cond, costAbility, deal, deathknell, delayed,
  discard, draw, draws, gear, gearSel, grant, iff, kill, kw, legend, linked, look, might, mode, named, onPlay,
  permanentSel, pick, playSelf, playToken, pred, predict, prog, ready, recycleRest, ref, replacement, runeSel, slot,
  spell, statik, stun, unit, unitSel, val, when,
} from '../../dsl/builders.ts';

export const SERAPHINE_DEFS = [
  legend('seraphine-starry-eyed-songstress',
    'As an additional cost to play a spell, you may exhaust me and three friendly units to reduce the cost of that spell '
    + 'by [2].', [
      costAbility({ grant: { types: ['spell'] }, optional: true,
        pay: { exhaustSelf: true, exhaust: { sel: unitSel({ rel: 'friendly' }), n: 3 } }, discount: { energy: 2 } }),
    ]),

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
        statik(val.count(unitSel({ rel: 'friendly', other: true, where: [pred.exhausted] }))),
      ],
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

  unit('heimerdinger-academy-instructor',
    'If you would play a unit token to a location while I\'m at a battlefield, you may play a 3 [M] Mech unit token to '
    + 'that same location instead.', {
      abilities: [replacement({ ev: { ev: 'playToken', by: 'you', type: 'unit' }, instead: { playToken: 'mech' },
        while: cond.selfAt('battlefield'), may: true })],
    }),

  spell('raucous-anthem', 'Ready your units and give them +3 [M] this turn.', {
    body: [ready(unitSel({ rel: 'friendly' })), might(3, unitSel({ rel: 'friendly' }))],
  }),

  unit('piltovan-guidebot',
    'When you play a card, you may have my base Might become equal to that card\'s Energy cost this turn.', {
      abilities: [when({ on: 'cardPlayed', by: 'you', what: { card: true } }, prog([baseMight(val.info('energy'), ref.self)]),
        { may: true })],
    }),

  unit('dune-devourer',
    'You may kill a friendly unit as an additional cost to play me. If you do, I cost [2] less.\n[Deflect]', {
      kw: [kw.deflect()],
      abilities: [costAbility({ optional: true, pay: { kill: { sel: unitSel({ rel: 'friendly' }), n: 1 } }, discount: { energy: 2 } })],
    }),

  unit('the-empyrean',
    '[Show Off] a card.\nWhen you play me, if you showed off a card, [Predict] equal to its Power cost, then draw 2.', {
      kw: [kw.showOff()],
      abilities: [onPlay(prog([predict(val.shownPower), draw(2)]), { if: cond.showedOff })],
    }),

  unit('steadfast-outrider',
    '[Tank]\nWhile there are 2 or more other friendly units and/or gear at my battlefield, I have +2 [M].', {
      kw: [kw.tank()],
      abilities: [statik(2, { while: cond.and(cond.selfAt('battlefield'),
        cond.count(permanentSel({ rel: 'friendly', other: true, at: 'here' }), '>=', 2)) })],
    }),

  spell('rousing-display',
    '[Show Off] a card with Energy cost [7] or more.\nPlay two 1 [M] Recruit unit tokens to your base. If you showed '
    + 'off, play four to your base instead.', {
      kw: [kw.showOff({ minEnergy: 7 })],
      body: [iff(cond.showedOff, [playToken('recruit', 4, 'yourBase')], [playToken('recruit', 2, 'yourBase')])],
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

  spell('fanfare', 'The next three times you play a unit this turn, draw 1.', {
    body: [delayed(3, { on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([draw(1)]))],
  }),

  unit('hunting-dog', '[Deathknell][>] Play a 1 [M] Bird unit token with [Deflect] to your base.', {
    abilities: [deathknell(prog([playToken('bird', 1, 'yourBase')]))],
  }),

  unit('industrious-mechsmith', 'When you play me, play a 3 [M] Mech unit token here.', {
    abilities: [onPlay(prog([playToken('mech', 1, 'here')]))],
  }),

  unit('herald-of-the-emperor', 'When you play me, choose a friendly unit. Its base Might becomes 5 this turn.', {
    abilities: [onPlay(prog([baseMight(5, ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly' }))]))],
  }),

  unit('party-crasher', 'I cost [1] less for each exhausted unit you control.\n[Tank]', {
    kw: [kw.tank()],
    abilities: [costAbility({ discount: { energy: val.count(unitSel({ rel: 'friendly', where: [pred.exhausted] })) } })],
  }),

  unit('faithful-manufactor', 'When you play me, play a 1 [M] Recruit unit token here.', {
    abilities: [onPlay(prog([playToken('recruit', 1, 'here')]))],
  }),

  unit('meticulous-restorationist',
    'When you play a card with Energy cost [7] or more, you may play me from your trash for [Y].', {
      abilities: [when({ on: 'cardPlayed', by: 'you', what: { minEnergy: 7 } }, prog([playSelf({ power: ['order'] })]),
        { may: true, activeIn: ['trash'] })],
    }),

  spell('for-demacia', '[Reaction]\nChoose a battlefield. Give friendly units there [Shield 2] this turn.', {
    kw: [kw.reaction()],
    choose: [slot('b', bfSel())],
    body: [grant(kw.shield(2), unitSel({ rel: 'friendly', at: { slot: 'b' } }))],
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
    an [E] cost and default timing [381] (Pitiless Stalker); "if you do" with
    look-back (Deathgrip); a linked instruction (Hidden Blade, played from
    hand: Hidden arrives with M2); a phase trigger with an intervening "if"
    (Sona, Harmonious). */
export const OTHER_DEFS = [
  unit('pitiless-stalker', '[E]: [Stun] an enemy unit.', {
    abilities: [activated({ exhaustSelf: true }, prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  spell('deathgrip',
    '[Reaction]\nKill a friendly unit. If you do, give +[M] equal to its Might to another friendly unit this turn.\nDraw 1.', {
      kw: [kw.reaction()],
      choose: [slot('k', unitSel({ rel: 'friendly' })), slot('g', unitSel({ rel: 'friendly' }), { distinctFrom: ['k'] })],
      body: [named('kill', kill(ref.slot('k'))), iff(cond.did('kill'), [might(val.might(ref.slot('k')), ref.slot('g'))]), draw(1)],
    }),
  spell('hidden-blade', '[Hidden]\n[Action]\nKill a unit at a battlefield. Its controller draws 2.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [named('k', kill(ref.slot('a'))), linked('k', draws(2, ref.slot('a')))],
  }),
  unit('sona-harmonious', 'At the end of your turn, if I\'m at a battlefield, ready up to 4 friendly runes.', {
    abilities: [when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([ready(ref.slot('r'))],
      [slot('r', runeSel({ rel: 'friendly' }), { min: 0, max: 4 })]), { if: cond.selfAt('battlefield') })],
  }),
];
