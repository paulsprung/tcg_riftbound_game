/*
 * Spiritforged (SFD) Champion Deck cards: the Fiora and Rumble decks. Each
 * `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, battlefield, buff, cardSel, channel, cond, costAbility, counter, deal, dealFrom, deathknell, detach,
  double, draw, entersReady, gear, grant, iff, keywordTo, kill, kw, legend, may, might, mightTo, mill, named, onPlay,
  playCard, playToken, pred, prog, ready, recycle, ref, revealTop, slot, spell, spellSel, toHand, unit, unitSel, gearSel, val,
  when,
} from '../../dsl/builders.ts';

const mechs = (o: { other?: true } = {}) => unitSel({ rel: 'friendly', where: [pred.tag('Mech')], ...o });

export const SFD_DEFS = [
  // ---- Fiora ----
  legend('fiora-grand-duelist', 'When one of your units becomes [Mighty], you may exhaust me to channel 1 rune exhausted.', [
    when({ on: 'becomesMighty', who: 'friendly' }, prog([channel(1, { exhausted: true })]), { may: true, cost: { exhaustSelf: true } }),
  ]),

  spell('vengeance', 'Kill a unit.', {
    choose: [slot('a', unitSel(), { harm: true })],
    body: [kill(ref.slot('a'))],
  }),

  unit('dauntless-vanguard', 'You may play me to an occupied enemy battlefield.', {
    abilities: [always({ s: 'playTo', where: 'occupiedEnemy' })],
  }),

  spell('punch-first', '[Action]\nGive a unit +5 [M] this turn.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel())],
    body: [might(5, ref.slot('a'))],
  }),

  unit('jaull-fish', '[Accelerate]\nI cost [2] less for each of your [Mighty] units.', {
    abilities: [costAbility({ discount: { energy: val.sum(val.count(unitSel({ rel: 'friendly', where: [pred.mighty] })),
      val.count(unitSel({ rel: 'friendly', where: [pred.mighty] }))) } })],
  }),

  spell('show-of-strength', '[Reaction]\nDraw 1 for each of your [Mighty] units.', {
    kw: [kw.reaction()],
    body: [draw(val.count(unitSel({ rel: 'friendly', where: [pred.mighty] })))],
  }),

  spell('strike-down',
    'Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it.', {
      choose: [slot('a', unitSel({ rel: 'friendly', where: [pred.equipped] })), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
      body: [dealFrom(ref.slot('a'), ref.slot('b')), detach(ref.slot('a'))],
    }),

  gear('warmogs-armor', '[Equip] [O]\nWhen I conquer, buff me.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([buff(ref.self)]), { effectText: true })],
  }),

  unit('fiora-peerless', 'When I attack or defend one on one, double my Might this combat.', {
    abilities: [
      when({ on: 'attack', who: 'self' }, prog([double(ref.self, 'thisCombat')]), { if: cond.self(pred.oneOnOne) }),
      when({ on: 'defend', who: 'self' }, prog([double(ref.self, 'thisCombat')]), { if: cond.self(pred.oneOnOne) }),
    ],
  }),

  unit('lucian-merciless', '[Weaponmaster]\nThe first time I conquer each turn, ready me.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([ready(ref.self)]), { first: 'turn' })],
  }),

  unit('yone-blademaster',
    '[Weaponmaster]\nWhen I conquer a battlefield that was uncontrolled, deal damage equal to my Might to an enemy unit in a base.', {
      abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([dealFrom(ref.self, ref.slot('a'))],
        [slot('a', unitSel({ rel: 'enemy', at: 'base' }), { harm: true })]), { if: cond.info('wasUncontrolled', true) })],
    }),

  unit('royal-guard', 'When you play me, play a 2 [M] Sand Soldier unit token here.', {
    abilities: [onPlay(prog([playToken('sandSoldier', 1, 'here')]))],
  }),

  unit('unsung-hero', '[Deathknell][>] If I was [Mighty], draw 2.', {
    abilities: [deathknell(prog([iff(cond.lki(pred.mighty), [draw(2)])]))],
  }),

  gear('sacred-shears', '[Equip] [Y]\n[Deathknell][>] Draw 1.', {
    abilities: [deathknell(prog([draw(1)]), { effectText: true })],
  }),

  unit('fiora-worthy', 'When a unit you control becomes [Mighty], you may pay [Y] to ready it.', {
    abilities: [when({ on: 'becomesMighty', who: 'friendly' }, prog([ready(ref.subject)]), { may: true, cost: { power: ['order'] } })],
  }),

  spell('riposte',
    "[Reaction]\nChoose a friendly unit and a spell. Counter that spell and give that unit +[M] equal to that spell's Energy cost this turn.", {
      kw: [kw.reaction()],
      choose: [slot('a', unitSel({ rel: 'friendly' })), slot('c', spellSel(), { harm: true })],
      body: [counter(ref.slot('c')), might(val.energyOf(ref.slot('c')), ref.slot('a'))],
    }),

  battlefield('ornns-forge',
    'While you control this battlefield, the first friendly non-token gear played each turn costs [1] less.', [
      costAbility({ grant: { types: ['gear'] }, discount: { energy: 1 },
        while: cond.thisTurn('finalized', { types: ['gear'], op: '=', n: 0 }) }),
    ]),

  battlefield('sunken-temple', 'When you conquer here with one or more [Mighty] units, you may pay [1] to draw 1.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([draw(1)]), { may: true, cost: { energy: 1 }, controller: 'eventPlayer',
      if: cond.count(unitSel({ rel: 'friendly', at: 'here', where: [pred.mighty] }), '>=', 1) }),
  ]),

  battlefield('veiled-temple', "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it.", [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([ready(ref.slot('g')),
      iff(cond.is(ref.slot('g'), pred.attached), [may([detach(ref.slot('g'))])])],
    [slot('g', gearSel({ rel: 'friendly' }))]), { may: true, controller: 'eventPlayer' }),
  ]),

  // ---- Rumble ----
  legend('rumble-mechanized-menace', 'Your Mechs have [Shield].', [keywordTo(kw.shield(), mechs())]),

  unit('dangerous-duo', '[Legion][>] When you play me, give a unit +2 [M] this turn.', {
    abilities: [onPlay(prog([might(2, ref.slot('a'))], [slot('a', unitSel())]), { if: cond.legion })],
  }),

  unit('gem-jammer', 'When you play me, give a unit [Ganking] this turn.', {
    abilities: [onPlay(prog([grant(kw.ganking(), ref.slot('a'))], [slot('a', unitSel())]))],
  }),

  gear('assembly-rig', '[1][R], Recycle a unit from your trash, [E]: Play a 3 [M] Mech unit token to your base.', {
    abilities: [activated({ energy: 1, power: ['fury'], recycleTrash: { types: ['unit'], n: 1 }, exhaustSelf: true },
      prog([playToken('mech', 1, 'yourBase')]))],
  }),

  unit('ferrous-forerunner', '[Deathknell][>] Play two 3 [M] Mech unit tokens to your base.', {
    abilities: [deathknell(prog([playToken('mech', 2, 'yourBase')]))],
  }),

  unit('rumble-hotheaded',
    'Your Mechs each have [Assault].\nWhen I conquer, you may recycle another friendly unit to play a Mech from your trash. '
    + 'Reduce its Energy cost by the Might of the unit you recycled.', {
      abilities: [
        keywordTo(kw.assault(), mechs()),
        when({ on: 'conquer', who: 'you', at: 'here' }, prog([named('rc', recycle(ref.slot('r'))),
          iff(cond.did('rc'), [playCard(ref.slot('m'), val.might(ref.slot('r')))])],
        [slot('r', unitSel({ rel: 'friendly', other: true })), slot('m', cardSel({ rel: 'friendly', where: [pred.type('unit'), pred.tag('Mech')] }))]),
        { may: true }),
      ],
    }),

  unit('bubble-bot', 'When you play me, ready another friendly Mech.', {
    abilities: [onPlay(prog([ready(ref.slot('a'))], [slot('a', mechs({ other: true }))]))],
  }),

  unit('forecaster', 'Your Mechs have [Vision].', { abilities: [keywordTo(kw.vision(), mechs())] }),

  spell('frigid-touch', '[Reaction]\n[Repeat] [2]\nGive a unit -2 [M] this turn.', {
    kw: [kw.reaction()],
    choose: [slot('a', unitSel(), { harm: true })],
    body: [might(2, ref.slot('a'), -1)],
  }),

  unit('plundering-poro', 'When I conquer, play a Gold gear token exhausted.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([playToken('gold', 1, 'yourBase', { exhausted: true })]))],
  }),

  spell('wages-of-pain', '[Hidden]\n[Action]\nDeal 3 to a unit at a battlefield. Play a Gold gear token exhausted.', {
    kw: [kw.action()],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(3, ref.slot('a')), playToken('gold', 1, 'yourBase', { exhausted: true })],
  }),

  unit('breakneck-mech', 'Your Mechs have [Deflect] and [Ganking].\nI enter ready if you control another Mech.', {
    abilities: [keywordTo(kw.deflect(), mechs()), keywordTo(kw.ganking(), mechs()),
      entersReady({ while: cond.count(mechs(), '>=', 1) })],
  }),

  spell('production-surge', 'This costs [2] less if you control a Mech.\nPlay a 3 [M] Mech unit token to your base.\nDraw 1.', {
    abilities: [costAbility({ discount: { energy: 2 }, while: cond.count(mechs(), '>=', 1) })],
    body: [playToken('mech', 1, 'yourBase'), draw(1)],
  }),

  unit('rumble-scrapper', 'Your Mechs have +1 [M].\nWhen I hold, play a 3 [M] Mech unit token to your base.', {
    abilities: [mightTo(1, mechs()), when({ on: 'hold', who: 'you', at: 'here' }, prog([playToken('mech', 1, 'yourBase')]))],
  }),

  spell('danger-zone', '[Reaction]\n[Repeat] [1][A]\nGive your Mechs +1 [M] this turn.', {
    kw: [kw.reaction()],
    body: [might(1, mechs())],
  }),

  battlefield('minefield', 'When you conquer here, put the top 2 cards of your Main Deck into your trash.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([mill(2)]), { controller: 'eventPlayer' }),
  ]),

  battlefield('ravenbloom-conservatory',
    "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.", [
      when({ on: 'defend', who: 'you', at: 'here' }, prog([revealTop('R'),
        iff(cond.is(ref.bound('R'), pred.type('spell')), [toHand(ref.bound('R'))], [recycle(ref.bound('R'))])]),
      { controller: 'eventPlayer' }),
    ]),

  battlefield('treasure-hoard', 'When you conquer here, you may pay [1] to play a Gold gear token exhausted.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([playToken('gold', 1, 'yourBase', { exhausted: true })]),
      { may: true, cost: { energy: 1 }, controller: 'eventPlayer' }),
  ]),
];
