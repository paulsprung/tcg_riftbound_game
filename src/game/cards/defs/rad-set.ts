/*
 * Radiance (RAD): the cards of the set beyond its Showdown Deck (rad.ts).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, banish, banishTop, battlefield, bfSel, buff, channel, choose, cond, costAbility, deal, deathknell,
  delayed, destSlot, draw, entersReady, forEach, gear, gearSel, grant, iff, keywordTo, kill, kw, legend, look, may, might,
  mightTo, modal, mode, move, named, onPlay, permanentSel, pickWhere, playerEffect, playFree, playToken, points, pred, predict, prog,
  ready, recycleAllBut, recycleRest, ref, returnToHand, revealTop, runeSel, slot, spell, unit, unitSel, val, when, cantMove,
} from '../../dsl/builders.ts';

const friendly = unitSel({ rel: 'friendly' });
const hold = { on: 'hold', who: 'you', at: 'here' } as const;
const exhaustedRunes = runeSel({ rel: 'friendly', where: [pred.exhausted] });

export const RAD_SET_DEFS = [
  // ---- batch 1 ----
  unit('ahri-confident', '[Disarm]\nWhen you reduce the Might of an enemy unit here by 1 or more, give me +1 [M] this turn.', {
    abilities: [when({ on: 'mightReduced', at: 'here' }, prog([might(1, ref.self)]))],
  }),
  unit('amateur-demolitionist', 'When you play me, play a Bomb gear token to a battlefield.', {
    abilities: [onPlay(prog([playToken('bomb', 1, 'choose')]))],
  }),
  spell('an-offer-you-cant-refuse', '[Action]\nKill a gear. Its controller plays a Gold gear token exhausted.', {
    kw: [kw.action()], choose: [slot('g', gearSel(), { harm: true })],
    body: [kill(ref.slot('g')), { op: 'playToken', token: 'gold', n: 1, at: 'yourBase', exhausted: true, who: { controllerOf: ref.slot('g') } }],
  }),
  unit('angler-wyrm', '[Deflect]\n[E]: Choose an opponent. They must move a unit they control to my battlefield.', {
    abilities: [activated({ exhaustSelf: true }, prog([forEach('opponents', 'next', [choose(unitSel({ rel: 'friendly', at: 'elsewhere' }), 'u'),
      move(ref.bound('u'), 'here')])]))],
  }),
  unit('antagonistic-apparatus', 'I enter ready.\nWhen you play me, play a ready 3 [M] Mech unit token here.', {
    abilities: [entersReady(), onPlay(prog([playToken('mech', 1, 'here', { ready: true })]))],
  }),
  unit('aphelios-exalted', "When you attach an Equipment to me, choose one that hasn't been chosen this turn —\n• Ready 2 runes.\n• Channel 1 rune exhausted.\n• [Buff] a friendly unit.", {
    abilities: [when({ on: 'attached', who: 'self' }, modal(1, [
      mode('Ready 2 runes', [choose(exhaustedRunes, 'r', { min: 2, max: 2 }), ready(ref.bound('r'))]),
      mode('Channel 1 rune exhausted', [channel(1, { exhausted: true })]),
      mode('Buff a friendly unit', [buff(ref.slot('a'))], [slot('a', friendly)])]), { modesOncePerTurn: true })],
  }),
  unit('armored-tusker', '[Shield 3]\n[Tank]\nWhen I move, you may deal damage equal to my [Shield] to a unit at a battlefield.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([deal({ v: 'kw', kw: 'shield' }, ref.slot('a'))],
      [slot('a', unitSel({ at: 'battlefield' }), { harm: true })]), { may: true })],
  }),
  spell('avalanche', 'Deal 3 to all units in bases.', { body: [deal(3, unitSel({ at: 'base' }))] }),
  gear('banner-of-conquest', '[Deploy]\nFriendly units here have [Assault].', {
    abilities: [keywordTo(kw.assault(), unitSel({ rel: 'friendly', at: 'here' }))],
  }),
  spell('battle-preparations', '[Reaction]\n[Show Off] a gear.\nGive a unit +2 [M] this turn. If you showed off, ready up to 2 runes.', {
    kw: [kw.reaction(), kw.showOff({ type: 'gear' })], choose: [slot('a', unitSel())],
    body: [might(2, ref.slot('a')), iff(cond.showedOff, [choose(exhaustedRunes, 'r', { min: 0, max: 2 }), ready(ref.bound('r'))])],
  }),
  unit('battlefield-armorer', "When a friendly gear at a battlefield dies, you may pay [1] to return it to its owner's hand.", {
    abilities: [when({ on: 'unitDies', at: 'battlefield', who: 'friendly', types: ['gear'], each: true }, prog([returnToHand(ref.now(ref.subject))]),
      { may: true, cost: { energy: 1 } })],
  }),
  unit('bedeviling-stranger', "[Hidden]\nWhen you play me, choose a battlefield. If there are 4 or more units there, you may return an enemy unit there to its owner's hand.", {
    abilities: [onPlay(prog([iff(cond.count(unitSel({ at: { slot: 'b' } }), '>=', 4), [choose(unitSel({ rel: 'enemy', at: { slot: 'b' } }), 'e', { min: 0, max: 1 }),
      returnToHand(ref.bound('e'))])], [slot('b', bfSel())]))],
  }),
  unit('bilgewater-tracker', 'When you play me, deal 1 to each of up to 2 units.', {
    abilities: [onPlay(prog([deal(1, ref.slot('a'))], [slot('a', unitSel(), { min: 0, max: 2, harm: true })]))],
  }),
  battlefield('black-market', '[A][A]: Draw 1. Each player may use this ability once on their turn.', [
    activated({ power: ['A', 'A'] }, prog([draw(1)]), { anyPlayer: true, limit: { n: 1, per: 'turn' } }),
  ]),
  unit('bloodscent-swarm', "I cost [2] less for each battlefield you've conquered this turn.", {
    abilities: [costAbility({ discount: { energy: 2, times: val.conquered } })],
  }),
  gear('blossoming-dreamroot', '[Deploy]\nWhen you win a combat here, draw 1.', {
    abilities: [when({ on: 'winCombat', who: 'you', at: 'here' }, prog([draw(1)]))],
  }),
  spell('brawl', '[Action]\nGive a unit [Assault] this turn equal to its Might.', {
    kw: [kw.action()], choose: [slot('a', unitSel())], body: [grant(kw.assault(), ref.slot('a'), 'thisTurn', val.might(ref.slot('a')))],
  }),
  spell('cataclysm', "Opponents can't play spells this turn.\nMove a friendly unit to an occupied enemy battlefield.", {
    choose: [slot('a', friendly), destSlot('d', 'a', 'occupiedEnemy')],
    body: [playerEffect({ s: 'cantPlayTypes', types: ['spell'] }, 'opponents'), move(ref.slot('a'), { dest: 'd' })],
  }),
  spell('chronobreak', 'As an additional cost to play this, pay any amount of Power.\nBanish that many units you control, then for each, its owner plays that unit back to the same location or to their base, ignoring its cost.', {
    abilities: [costAbility({ xPower: true })],
    body: [choose(friendly, 'u', { count: val.xCost }), named('b', banish(ref.bound('u'))),
      playFree(ref.bound('b'), 'all', { by: 'owner', each: true, sameOrBase: true })],
  }),
  unit('clanging-sentry', 'Your Mechs have [Disarm].', {
    abilities: [keywordTo(kw.disarm(), unitSel({ rel: 'friendly', where: [pred.tag('Mech')] }))],
  }),

  // ---- batch 2 ----
  ...(() => {
    const p3 = prog([predict(3)]);
    return [unit('clocktower-guardian', 'When you play me or when I hold, [Predict 3].\n[Deathknell][>] Banish the top card of your Main Deck. You may play it, ignoring its Energy cost.', {
      abilities: [onPlay(p3), when(hold, p3), deathknell(prog([banishTop(1, 'b'), may([playFree(ref.bound('b'), 'energy')])]))],
    })];
  })(),
  unit('coalesced-energy', 'At the end of your turn, recycle all your runes, then channel 4 runes exhausted.', {
    abilities: [when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([recycleAllBut([runeSel({ rel: 'friendly' })], []), channel(4, { exhausted: true })]))],
  }),
  spell('command-attack', 'Choose one —\n• Move a friendly gear with [Deploy] to a battlefield.\n• Look at the top 5 cards of your Main Deck. You may reveal a gear from among them and draw it. Recycle the rest.', {
    ...modal(1, [
      mode('Move a friendly Deploy gear to a battlefield', [move(ref.slot('g'), { dest: 'd' })],
        [slot('g', gearSel({ rel: 'friendly', where: [pred.keyword('deploy')] })), destSlot('d', 'g', 'bf')]),
      mode('Look at the top 5, may draw a gear', [look(5, 'l'), pickWhere('l', 1, 'c', { min: 0, where: [pred.type('gear')] }),
        draw(1, ref.bound('c')), recycleRest('l', 'c')])]),
  }),
  spell('consult-the-heavens', '[Reaction]\nGive a unit [Shield 2] this turn.\n[Predict].', {
    kw: [kw.reaction()], choose: [slot('a', unitSel())], body: [grant(kw.shield(2), ref.slot('a')), predict(1)],
  }),
  battlefield('cosmic-vista', 'When you hold here, if your Rune Deck is empty, you score 1 point.', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([points(1)]), { controller: 'eventPlayer', if: cond.runeDeck('=', 0) }),
  ]),
  unit('demacian-illuminators', 'When one or more friendly units die, [Buff] a friendly unit.', {
    abilities: [when({ on: 'unitDies', at: 'any', who: 'friendly' }, prog([buff(ref.slot('a'))], [slot('a', friendly)]))],
  }),
  gear('demacian-standard', "[Deploy]\nWhen one or more friendly units attack here, give one of them +2 [M] this turn.\nWhen you hold here, you may return this to its owner's hand.", {
    abilities: [when({ on: 'attack', who: 'you', at: 'here' }, prog([might(2, ref.slot('a'))],
      [slot('a', unitSel({ rel: 'friendly', at: 'here', where: [pred.attacking] }))])),
    when(hold, prog([returnToHand(ref.self)]), { may: true })],
  }),
  gear('detonation-amplifier', '[Deploy]\nWhen you play this, you may kill another friendly unit or gear to draw 1.\nFriendly [Deathknell] effects here trigger an additional time.', {
    abilities: [onPlay(prog([draw(1)]), { may: true, cost: { kill: { sel: permanentSel({ rel: 'friendly', other: true }), n: 1 } } }),
      always({ s: 'deathknellTwice', here: true })],
  }),
  unit('disposal-expert', 'I enter ready if you control no other units.\n[Disarm 2]', {
    abilities: [entersReady({ while: cond.count(friendly, '=', 0) })],
  }),
  // "kill this to play the banished card": a cost the hold trigger pays (not a "may").
  gear('dockside-lock-up', '[Deploy]\nWhen you play this, banish a unit here.\nWhen you hold here, kill this to play the banished card, ignoring its cost.', {
    abilities: [onPlay(prog([{ op: 'banish', what: ref.slot('u'), linkGroup: 'dockside-lock-up' }], [slot('u', unitSel({ at: 'here' }), { harm: true })])),
      when(hold, prog([{ op: 'playLinked', group: 'dockside-lock-up', anyOwner: true }]), { cost: { killSelf: true } })],
  }),
  unit('drakehound-packmaster', "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish it, then play it, ignoring its cost. Recycle the rest.", {
    abilities: [onPlay(prog([forEach('opponents', 'next', [revealTop('r')]), pickWhere('r', 1, 'c'), named('b', banish(ref.bound('c'))),
      playFree(ref.bound('b')), recycleRest('r', 'c')]))],
  }),
  battlefield('durand-memorial', 'When you defend here, choose a unit you control here. Give it [Tank] this combat.', [
    when({ on: 'defend', who: 'you', at: 'here' }, prog([grant(kw.tank(), ref.slot('a'), 'thisCombat')], [slot('a', unitSel({ rel: 'friendly', at: 'here' }))]),
      { controller: 'eventPlayer' }),
  ]),
  legend('ekko-boy-who-shattered-time', '[Empower] — [1], [E]\nDisempower me, [E]: Reduce the cost of the next unit you play this turn by [2][A] and give it "Kill me at end of turn."', [
    activated({ disempowerSelf: true, exhaustSelf: true }, prog([playerEffect({ s: 'costLess', types: ['unit'], energy: 2, power: 1, uses: 1 }),
      delayed(1, { on: 'cardPlayed', by: 'you', what: { types: ['unit'], card: true } }, prog([
        delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' }, prog([kill(ref.info('u'))]), { capture: { u: ref.subject } })]))])),
  ]),
  unit('ekko-ingenious', "As an additional cost to play me, return a friendly unit to its owner's hand.\n[Ganking]", {
    abilities: [costAbility({ pay: { bounce: { sel: friendly, n: 1 } } })],
  }),
  unit('ekko-revolutionary', 'I enter ready.\n[Assault]\n[Action][>] Discard 1, [1][R]: Banish me, then play me to your base, ignoring my cost.', {
    abilities: [entersReady(), activated({ discard: 1, energy: 1, power: ['fury'] }, prog([named('b', banish(ref.self)),
      playFree(ref.bound('b'), 'all', { at: 'base' })]), { timing: 'action' })],
  }),
  unit('entrenched-boar', "You may have me enter ready. If you do, I can't move this turn.", {
    abilities: [costAbility({ optional: true, accelerate: true }), onPlay(prog([cantMove(ref.self)]), { if: cond.paid('entrenched-boar#0') })],
  }),
  gear('ephemeral-ward', 'Your units have +2 [M].\nWhen you play a unit, kill this.', {
    abilities: [mightTo(2, friendly), when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([kill(ref.self)]))],
  }),
  unit('explosimian', 'When I hold, play three Bomb gear tokens to a single battlefield.', {
    abilities: [when(hold, prog([playToken('bomb', 3, { slot: 'b' })], [slot('b', bfSel())]))],
  }),
  ...(() => {
    const zap = prog([deal(val.might(ref.self), ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]);
    return [unit('ezreal-dashing', "When I attack or defend, deal damage equal to my Might to an enemy unit here.\nI don't deal combat damage.\n[Action][>] [B]: Move me to your base.", {
      abilities: [when({ on: 'attack', who: 'self' }, zap), when({ on: 'defend', who: 'self' }, zap), always({ s: 'noCombatDamage' }),
        activated({ power: ['mind'] }, prog([move(ref.self, 'base')]), { timing: 'action' })],
    })];
  })(),
  unit('firebrand-raider', "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\nUnits don't ready during the Awaken Phase.", {
    abilities: [entersReady(), onPlay(prog([ready(unitSel({ rel: 'enemy' }))])), always({ s: 'entersReady', to: unitSel({ other: true }) }),
      always({ s: 'noAwakenReady' })],
  }),
];

