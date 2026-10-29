/*
 * Radiance (RAD): the cards of the set beyond its Showdown Deck (rad.ts).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, banish, banishTop, battlefield, bfSel, buff, channel, choose, cond, costAbility, deal, deathknell,
  delayed, destSlot, draw, entersReady, forEach, gear, gearSel, grant, iff, keywordTo, kill, kw, legend, look, may, might,
  mightTo, modal, mode, move, named, onPlay, permanentSel, pickWhere, playerEffect, playFree, playToken, points, pred, predict, prog,
  ready, recycleAllBut, recycleRest, ref, returnToHand, revealTop, runeSel, slot, spell, unit, unitSel, val, when, cantMove,
  counter, kwFromKw, legendSel, playSelf, spellSel, stun, baseMight, gold, cardSel as cards, fight, recycle, spendBuffsOf, statik, choiceBy, dealSplit, discardHand,
  allowPlay,
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
  // ---- batch 3 (second 100) ----
  battlefield('firelights-hideout', 'When you conquer here, the next unit you play this turn has [Accelerate].', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([playerEffect({ s: 'grantAccelerate', uses: 1 })]), { controller: 'eventPlayer' }),
  ]),
  spell('forbidden-technique', 'Ready a unit.\nWhen you play a card with Energy cost [7] or more, you may play this from your trash for [1][R][R]. Then banish this.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { minEnergy: 7 } }, prog([playSelf({ energy: 1, power: ['fury', 'fury'] }, { leaveChain: 'banish' })]),
      { may: true, activeIn: ['trash'] })],
    choose: [slot('a', unitSel())], body: [ready(ref.slot('a'))],
  }),
  ...(() => {
    const blast = prog([deal(val.might(ref.self), unitSel({ rel: 'enemy', at: 'here' }))]);
    return [unit('graves-blasting-through', "When I attack or defend, deal damage equal to my Might to all enemy units here.\nI don't deal combat damage.", {
      abilities: [when({ on: 'attack', who: 'self' }, blast), when({ on: 'defend', who: 'self' }, blast), always({ s: 'noCombatDamage' })],
    })];
  })(),
  gear('gravity-field', '[Deploy]\nOpponents must pay [1][A] to move one or more units to this battlefield.\n[Deathknell][>] Draw 1.', {
    abilities: [always({ s: 'moveTax', cost: { energy: 1, power: 1 } }), deathknell(prog([draw(1)]))],
  }),
  unit('heartening-soul', 'When you play me, ready a friendly legend.\nFriendly legends have "[E]: Give a unit +3 [M] this turn."', {
    abilities: [onPlay(prog([ready(ref.slot('l'))], [slot('l', legendSel({ rel: 'friendly' }))])),
      always({ s: 'grantAbility', ability: 'heartening-soul#2', to: legendSel({ rel: 'friendly' }) }),
      activated({ exhaustSelf: true }, prog([might(3, ref.slot('a'))], [slot('a', unitSel())]), { grantedOnly: true })],
  }),
  spell('hexplosive-minefield', '[Action]\nKill any number of friendly Bomb tokens. At end of turn, play that many Bomb tokens to a single battlefield.', {
    kw: [kw.action()],
    body: [choose(gearSel({ rel: 'friendly', where: [pred.token, pred.name('Bomb')] }), 'b', { min: 0, max: 99 }),
      delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' }, prog([playToken('bomb', val.info('n'), { slot: 'f' })], [slot('f', bfSel())]),
        { captureN: { n: val.countBound('b') } }),
      kill(ref.bound('b'))],
  }),
  spell('hunker-down', "[Reaction]\nReady a friendly unit. It can't move this turn. Draw 1.", {
    kw: [kw.reaction()], choose: [slot('a', friendly)], body: [ready(ref.slot('a')), cantMove(ref.slot('a')), draw(1)],
  }),
  battlefield('hunters-circle', 'For each player, the first unit or gear they play here on their turn costs [1] less.', [
    costAbility({ grant: { types: ['unit', 'gear'], whose: 'any' }, discount: { energy: 1, firstHere: true } }),
  ]),
  gear('hunting-blind', '[Deploy]\nWhen you play this, you may move an enemy unit to this battlefield.\nFriendly units here have [Shield 2].', {
    abilities: [onPlay(prog([move(ref.slot('a'), 'here')], [slot('a', unitSel({ rel: 'enemy', at: 'elsewhere' }), { harm: true })]), { may: true }),
      keywordTo(kw.shield(2), unitSel({ rel: 'friendly', at: 'here' }))],
  }),
  spell('hush', '[Reaction]\nCounter a spell with Power cost [A][A] or more.', {
    kw: [kw.reaction()], choose: [slot('s', spellSel({ where: [pred.powerCost('>=', 2)] }), { harm: true })], body: [counter(ref.slot('s'))],
  }),
  spell('improvised-projectile', '[Action]\nChoose a friendly gear. Deal damage equal to its Energy cost to a unit at a battlefield.', {
    kw: [kw.action()], choose: [slot('g', gearSel({ rel: 'friendly' })), slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(val.energyOf(ref.slot('g')), ref.slot('a'))],
  }),
  unit('incorrigible-construct', '[Show Off] a Mech.\nI enter ready if you showed off.', {
    kw: [kw.showOff({ tag: 'Mech' })], abilities: [entersReady({ while: cond.showedOff })],
  }),
  gear('invigorating-bloom', 'When you play this, give a friendly unit +3 [M] this turn.\nExhaust a friendly [Mighty] unit, [E]: Draw 1.', {
    abilities: [onPlay(prog([might(3, ref.slot('a'))], [slot('a', friendly)])),
      activated({ exhaust: { sel: unitSel({ rel: 'friendly', where: [pred.mighty] }), n: 1 }, exhaustSelf: true }, prog([draw(1)]))],
  }),
  unit('iridescent-avian', "[E]: [Buff] a unit. If it's already buffed, give it +2 [M] this turn instead.", {
    abilities: [activated({ exhaustSelf: true }, prog([iff(cond.is(ref.slot('a'), pred.buffed), [might(2, ref.slot('a'))], [buff(ref.slot('a'))])],
      [slot('a', unitSel())]))],
  }),
  legend('jarvan-iv-exemplar-of-demacia', 'When you play a gear with [Deploy], you may exhaust me and pay [A] to move a friendly unit to that battlefield.', [
    when({ on: 'cardPlayed', by: 'you', what: { types: ['gear'], keyword: 'deploy' } }, prog([move(ref.slot('a'), { locOf: ref.subject })], [slot('a', friendly)]),
      { may: true, cost: { exhaustSelf: true, power: ['A'] } }),
  ]),
  unit('jarvan-iv-martial-paragon', 'Your gear with [Deploy] have [Action].\nWhen I conquer, if there is a friendly gear with [Deploy] here, channel 1 rune exhausted.', {
    abilities: [always({ s: 'giveTiming', timing: 'action', types: ['gear'], keyword: 'deploy' }),
      when({ on: 'conquer', who: 'you', at: 'here' }, prog([channel(1, { exhausted: true })]),
        { if: cond.count(gearSel({ rel: 'friendly', at: 'here', where: [pred.keyword('deploy')] }), '>=', 1) })],
  }),
  unit('jarvan-iv-royal-heir', '[Assault]\n[Tank]\nWhen I attack, you may move a unit you control to my battlefield.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([move(ref.slot('a'), 'here')], [slot('a', unitSel({ rel: 'friendly', at: 'elsewhere' }))]), { may: true })],
  }),
  unit('kaisa-rebel', "[Disarm].\nWhile I'm in a showdown, your spells have [Reaction].", {
    abilities: [always({ s: 'giveTiming', timing: 'reaction', types: ['spell'] }, { while: cond.selfInShowdown })],
  }),
  unit('kayn-unleashed', "[Ganking]\nIf I have moved twice this turn, I don't take damage.", {
    abilities: [always({ s: 'noDamage' }, { while: cond.self(pred.minMoves(2)) })],
  }),
  spell('ki-burst', '[Action]\nAs an additional cost to play this, exhaust a friendly unit.\n[Stun] a unit.', {
    kw: [kw.action()], abilities: [costAbility({ pay: { exhaust: { sel: friendly, n: 1 } } })],
    choose: [slot('a', unitSel(), { harm: true })], body: [stun(ref.slot('a'))],
  }),
  ...(() => {
    const dbl = prog([grant(kw.shield(), ref.slot('a'), 'thisTurn', val.kwOf(ref.slot('a'), 'shield'))], [slot('a', unitSel({ rel: 'friendly', at: 'here' }))]);
    return [unit('ksante-dauntless', '[Shield]\nWhen I attack or defend, double the [Shield] of a unit you control here this turn.', {
      abilities: [when({ on: 'attack', who: 'self' }, dbl), when({ on: 'defend', who: 'self' }, dbl)],
    })];
  })(),
  legend('ksante-pride-of-nazumah', '[1], [E]: Give a friendly unit "I have [Assault] equal to my [Shield]" this turn.', [
    activated({ energy: 1, exhaustSelf: true }, prog([kwFromKw(ref.slot('a'), 'assault', 'shield')], [slot('a', friendly)])),
  ]),
  spell('life-from-stone', '[Reaction]\nAs an additional cost to play this, exhaust a friendly unit.\nDraw 1 and channel 1 rune exhausted.', {
    kw: [kw.reaction()], abilities: [costAbility({ pay: { exhaust: { sel: friendly, n: 1 } } })], body: [draw(1), channel(1, { exhausted: true })],
  }),
  unit('lingering-animus', 'I enter ready if a friendly unit or gear died this turn.', {
    abilities: [entersReady({ while: cond.thisTurn('unitDied', { rel: 'friendly', types: ['unit', 'gear'] }) })],
  }),
  spell('lost-to-the-sands', '[Action]\nChoose one —\n• Deal 4 to a unit at a battlefield.\n• Kill a gear.', {
    kw: [kw.action()],
    ...modal(1, [mode('Deal 4 to a unit at a battlefield', [deal(4, ref.slot('a'))], [slot('a', unitSel({ at: 'battlefield' }), { harm: true })]),
      mode('Kill a gear', [kill(ref.slot('g'))], [slot('g', gearSel(), { harm: true })])]),
  }),
  // ---- batch 4 ----
  unit('lulu-whimsical', "When I move, you may have another unit's base Might become 4 this turn.", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([baseMight(4, ref.slot('a'))], [slot('a', unitSel({ other: true }))]), { may: true })],
  }),
  // Ties: every card with the lowest Energy cost counts as "the lowest".
  gear('mechanical-bandit', 'At the start of your Beginning Phase, each player reveals the top card of their Main Deck. If you revealed a card with the lowest Energy cost, draw it. Recycle the rest.', {
    abilities: [when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([forEach('each', 'you', [revealTop('r')]),
      pickWhere('r', 1, 'd', { where: [pred.ownedByYou], energyMax: val.minEnergyBound('r') }), draw(1, ref.bound('d')), recycleRest('r', 'd')]))],
  }),
  ...(() => {
    const dom = prog([kill(ref.slot('a'))], [slot('a', permanentSel(), { harm: true })]);
    return [unit('mordekaiser-dominating', 'When you play me or when I attack, you may discard 1 to kill a unit or gear.', {
      abilities: [onPlay(dom, { may: true, cost: { discard: 1 } }), when({ on: 'attack', who: 'self' }, dom, { may: true, cost: { discard: 1 } })],
    })];
  })(),
  legend('mordekaiser-iron-revenant', '[Reaction][>] Banish a unit or gear from your trash, [E]: [Add] [A]. Spend this Power only to play units or gear.', [
    activated({ banishTrash: { types: ['unit', 'gear'], n: 1 }, exhaustSelf: true }, prog([{ op: 'add', power: 1, onlyFor: 'permanents' }]),
      { timing: 'reaction', isAdd: true }),
  ]),
  unit('mordekaiser-twice-slain', '[Accelerate]\n[Assault 3]\nOnce each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead.', {
    abilities: [always({ s: 'saveSelfByKill' })],
  }),
  unit('mournful-spirit', '[Deathknell][>] You may kill a unit or gear here.', {
    abilities: [deathknell(prog([kill(ref.slot('a'))], [slot('a', permanentSel({ at: 'here' }), { min: 0, harm: true })]))],
  }),
  unit('mysterious-chronomancer', 'When you play me, [Predict 2].\n[Disarm 2]', { abilities: [onPlay(prog([predict(2)]))] }),
  spell('ntofo-strikes', '[Action]\nGive a friendly unit [Shield 2] this turn, then deal damage equal to its [Shield] to an enemy unit.', {
    kw: [kw.action()], choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [grant(kw.shield(2), ref.slot('a')), deal(val.kwOf(ref.slot('a'), 'shield'), ref.slot('b'))],
  }),
  spell('one-two-punch', '[Action]\n[Buff] a friendly unit and [Stun] an enemy unit.', {
    kw: [kw.action()], choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [buff(ref.slot('a')), stun(ref.slot('b'))],
  }),
  unit('orianna-exquisite', "[Shield]\nI don't deal combat damage unless there's a friendly gear here.", {
    abilities: [always({ s: 'noCombatDamage' }, { while: cond.not(cond.count(gearSel({ rel: 'friendly', at: 'here' }), '>=', 1)) })],
  }),
  unit('orianna-mechanical-marvel', "Once each turn, while I'm at a battlefield, you may pay [1][A] less to play a gear.", {
    abilities: [{ ...costAbility({ grant: { types: ['gear'] }, optional: true, discount: { energy: 1, power: 1 }, while: cond.selfAt('battlefield') }),
      limit: { n: 1, per: 'turn' } }],
  }),
  unit('overloaded-traveler', "While there's a friendly gear with [Deploy] at my battlefield, I have +1 [M].", {
    abilities: [statik(1, { while: cond.and(cond.selfAt('battlefield'), cond.count(gearSel({ rel: 'friendly', at: 'here', where: [pred.keyword('deploy')] }), '>=', 1)) })],
  }),
  battlefield('packed-amphitheater', 'Champion units here have +1 [M].', [mightTo(1, unitSel({ at: 'here', where: [pred.champion] }))]),
  spell('parallel-convergence', "As an additional cost to play this, return a friendly unit to its owner's hand.\nDeal 5 to a unit at a battlefield.", {
    abilities: [costAbility({ pay: { bounce: { sel: friendly, n: 1 } } })],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })], body: [deal(5, ref.slot('a'))],
  }),
  ...(() => {
    const b = prog([buff(ref.slot('a'))], [slot('a', friendly)]);
    return [gear('pillaged-armory', '[Deploy]\nWhen you play this or when you conquer here, [Buff] a friendly unit.', {
      abilities: [onPlay(b), when({ on: 'conquer', who: 'you', at: 'here' }, b)],
    })];
  })(),
  gear('portable-portal', '[Deploy]\nWhen you play this, you may pay [O] to ready a unit here.\nFriendly units here have [Ganking].', {
    abilities: [onPlay(prog([ready(ref.slot('a'))], [slot('a', unitSel({ at: 'here' }))]), { may: true, cost: { power: ['order'] } }),
      keywordTo(kw.ganking(), unitSel({ rel: 'friendly', at: 'here' }))],
  }),
  spell('primordial-roar', "[Show Off] a unit.\nIf you showed off a unit, deal damage equal to that unit's Might to a unit.", {
    kw: [kw.showOff({ type: 'unit' })], choose: [slot('a', unitSel(), { harm: true, if: cond.showedOff })],
    body: [iff(cond.showedOff, [deal(val.shownMight, ref.slot('a'))])],
  }),
  spell('rally-for-war', 'Choose an occupied enemy battlefield. Play three 1 [M] Recruit unit tokens there.', {
    choose: [slot('b', bfSel({ rel: 'enemy', where: [pred.occupied] }))], body: [playToken('recruit', 3, { slot: 'b' })],
  }),
  unit('raving-witness', "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. Otherwise, recycle it.", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([revealTop('r'),
      iff(cond.is(ref.bound('r'), pred.might('>=', 5)), [draw(1, ref.bound('r'))], [recycle(ref.bound('r'))])]))],
  }),
  spell('realm-of-death', 'Give an enemy unit -2 [M] this turn and a friendly unit +2 [M] this turn. They deal damage equal to their Mights to each other.', {
    choose: [slot('a', unitSel({ rel: 'enemy' }), { harm: true }), slot('b', friendly)],
    body: [might(2, ref.slot('a'), -1), might(2, ref.slot('b')), fight(ref.slot('a'), ref.slot('b'))],
  }),
  spell('remember-the-fallen', 'Play up to 3 units and/or gear from your trash, each with Energy cost no more than [3] and Power cost no more than [A], ignoring their costs.', {
    body: [choose(cards({ rel: 'friendly', where: [pred.type('unit', 'gear'), pred.energyCost('<=', 3), pred.powerCost('<=', 1)] }), 'c', { min: 0, max: 3 }),
      playFree(ref.bound('c'), 'all', { each: true })],
  }),
  gear('resource-extractor', '[Deploy]\nAt the end of your turn, if you control this battlefield, play a Gold gear token exhausted.', {
    abilities: [when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([gold()]), { if: cond.controlsHere })],
  }),
  gear('resplendent-rostrum', '[E]: Draw 1 and channel 1 rune exhausted.\nWhen I become exhausted, give a friendly unit +3 [M] this turn.', {
    abilities: [activated({ exhaustSelf: true }, prog([draw(1), channel(1, { exhausted: true })])),
      when({ on: 'becomesExhausted', what: 'self' }, prog([might(3, ref.slot('a'))], [slot('a', friendly)]))],
  }),
  unit('riptide-mage', '[Accelerate]\nWhen you play me, give an enemy unit -3 [M] this turn.', {
    abilities: [onPlay(prog([might(3, ref.slot('a'), -1)], [slot('a', unitSel({ rel: 'enemy' }), { harm: true })]))],
  }),
  unit('riven-broken-blade', "When I become exhausted, choose one that hasn't been chosen this turn —\n• [Buff] me.\n• Spend my buff to [Stun] an enemy unit.\n• Spend my buff to ready me.", {
    abilities: [when({ on: 'becomesExhausted', what: 'self' }, modal(1, [
      mode('Buff me', [buff(ref.self)]),
      mode('Spend my buff to stun an enemy unit', [named('s', spendBuffsOf(ref.self)), iff(cond.did('s'), [stun(ref.slot('e'))])],
        [slot('e', unitSel({ rel: 'enemy' }), { harm: true })]),
      mode('Spend my buff to ready me', [named('s', spendBuffsOf(ref.self)), iff(cond.did('s'), [ready(ref.self)])])]), { modesOncePerTurn: true })],
  }),
  // ---- batch 5 ----
  unit('riven-deserter', 'When another friendly unit becomes exhausted, give me +1 [M] this turn.\nExhaust a friendly unit: Ready a unit. Use this ability only once each turn.', {
    abilities: [when({ on: 'becomesExhausted', what: 'friendlyOther' }, prog([might(1, ref.self)])),
      activated({ exhaust: { sel: friendly, n: 1 } }, prog([ready(ref.slot('a'))], [slot('a', unitSel())]), { limit: { n: 1, per: 'turn' } })],
  }),
  legend('riven-the-exile', 'Units you play to battlefields you control enter ready.', [
    always({ s: 'entersReady', to: unitSel({ rel: 'friendly', at: 'battlefield' }) }),
  ]),
  unit('sanctum-conservator', 'When you play a card with Energy cost [7] or more, ready me.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { minEnergy: 7 } }, prog([ready(ref.self)]))],
  }),
  spell('satchel-charge', '[Action]\nMove a friendly unit, then play a Bomb gear token to a battlefield.', {
    kw: [kw.action()], choose: [slot('a', friendly), destSlot('d', 'a', 'any')],
    body: [move(ref.slot('a'), { dest: 'd' }), playToken('bomb', 1, 'choose')],
  }),
  spell('scorched-earth', '[Action]\nDeal 5 damage split among units at a single battlefield.', {
    kw: [kw.action()], choose: [slot('b', bfSel({ where: [pred.occupied] }))], body: [dealSplit(5, unitSel({ at: { slot: 'b' } }))],
  }),
  ...(() => {
    const guess = (t: 'unit' | 'spell' | 'gear') => ({ label: t[0].toUpperCase() + t.slice(1), body: [revealTop('r'),
      iff(cond.is(ref.bound('r'), pred.type(t)), [recycle(ref.bound('r'))], [draw(1, ref.bound('r'))])] });
    return [gear('scrutinizing-scope', '[1], [E]: Choose an opponent. They guess a card type. Reveal the top card of your Main Deck. If it has that type, recycle it. Otherwise, draw it.', {
      abilities: [activated({ energy: 1, exhaustSelf: true }, prog([choiceBy('opponent', [guess('unit'), guess('spell'), guess('gear')])]))],
    })];
  })(),
  unit('seraphic-wyvern', 'If you would channel runes, channel that many runes plus 1 exhausted rune instead.', {
    abilities: [always({ s: 'channelExtra' })],
  }),
  unit('sett-kingpin', '[Tank]\nI get +1 [M] for each buffed friendly unit at my battlefield.', {
    abilities: [statik(val.count(unitSel({ rel: 'friendly', at: 'here', where: [pred.buffed] })), { while: cond.selfAt('battlefield') })],
  }),
  unit('shimmering-swimmer', 'You may kill a friendly unit or gear as an additional cost to play me.\nWhen you play me, if you paid the additional cost, deal 2 to a unit.', {
    abilities: [costAbility({ optional: true, pay: { kill: { sel: permanentSel({ rel: 'friendly' }), n: 1 } } }),
      onPlay(prog([deal(2, ref.slot('a'))], [slot('a', unitSel(), { harm: true })]), { if: cond.paid('shimmering-swimmer#0') })],
  }),
  unit('skystrike-squadron', "You may return a friendly gear to its owner's hand as an additional cost to play me. If you do, I cost [2] less.\n[Deflect]", {
    abilities: [costAbility({ optional: true, pay: { bounce: { sel: gearSel({ rel: 'friendly' }), n: 1 } }, discount: { energy: 2 } })],
  }),
  unit('spirit-of-the-forge', "You may return a friendly gear to its owner's hand as an additional cost to play me.\nWhen you play me, if you paid the additional cost, ready me and give me +[M] this turn equal to the Energy cost of the gear you returned.", {
    abilities: [costAbility({ optional: true, pay: { bounce: { sel: gearSel({ rel: 'friendly' }), n: 1 } } }),
      onPlay(prog([ready(ref.self), might(val.paidEnergy, ref.self)]), { if: cond.paid('spirit-of-the-forge#0') })],
  }),
  unit('stalwart-goatherd', '[Shield 2]\nWhen you play me, you may kill a gear with Energy cost [4] or less.', {
    abilities: [onPlay(prog([kill(ref.slot('g'))], [slot('g', gearSel({ where: [pred.energyCost('<=', 4)] }), { harm: true })]), { may: true })],
  }),
  unit('stoic-ferryman', '[Shield 3]\nWhen you play me to a battlefield, you may move another unit you control here to your base.', {
    abilities: [onPlay(prog([move(ref.slot('a'), 'base')], [slot('a', unitSel({ rel: 'friendly', other: true, at: 'here' }))]),
      { may: true, if: cond.playedToBf })],
  }),
  unit('storm-raptor', '[Deflect]\nWhen a stunned enemy unit dies here, draw 1.', {
    abilities: [when({ on: 'unitDies', at: 'here', who: 'enemy', stunned: true, each: true }, prog([draw(1)]))],
  }),
  gear('titanic-shrine', 'When you play a unit with Might greater than each other unit on the board, exhaust me to draw 1.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'] } }, prog([draw(1)]),
      { cost: { exhaustSelf: true }, if: cond.is(ref.subject, pred.mightiest) })],
  }),
  unit('transpositionist', "[P], [E]: Return a friendly unit to its owner's hand. You may play a unit with less Might than that unit had, ignoring its cost.", {
    abilities: [activated({ power: ['chaos'], exhaustSelf: true }, prog([returnToHand(ref.slot('a')),
      choose(cards({ in: 'hand', rel: 'friendly', where: [pred.type('unit')] }), 'c', { min: 0, max: 1, mightBelow: val.might(ref.slot('a')) }),
      playFree(ref.bound('c'))], [slot('a', friendly)]))],
  }),
  unit('trifarian-captain', 'When you play me, look at the top 4 cards of your Main Deck. You may reveal from among them a unit or gear with Energy cost no more than [3] and with Power cost no more than [A] and draw it. Recycle the rest.', {
    abilities: [onPlay(prog([look(4, 'l'), pickWhere('l', 1, 'c', { min: 0, where: [pred.type('unit', 'gear'), pred.energyCost('<=', 3), pred.powerCost('<=', 1)] }),
      draw(1, ref.bound('c')), recycleRest('l', 'c')]))],
  }),
  unit('war-scout', '[Accelerate]\nWhen you play me, give a unit +2 [M] this turn.', {
    abilities: [onPlay(prog([might(2, ref.slot('a'))], [slot('a', unitSel())]))],
  }),
  unit('watchful-curator', 'Your gear have [Deflect].', { abilities: [keywordTo(kw.deflect(), gearSel({ rel: 'friendly' }))] }),
  gear('whirling-twirligig', '[E]: Play a Gold gear token exhausted.\nKill a friendly gear, [E]: Play a 1 [M] Recruit unit token.\nKill a friendly unit, [E]: Play a 3 [M] Mech unit token.', {
    abilities: [activated({ exhaustSelf: true }, prog([gold()])),
      activated({ kill: { sel: gearSel({ rel: 'friendly' }), n: 1 }, exhaustSelf: true }, prog([playToken('recruit', 1, 'choose')])),
      activated({ kill: { sel: friendly, n: 1 }, exhaustSelf: true }, prog([playToken('mech', 1, 'choose')]))],
  }),
  gear('zero-point-inflection', 'When you play a card, draw 2.\nWhen you draw 1 or more cards with 9 or more other cards in your hand, discard your hand, kill this, and choose an opponent. They score 1 point.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { card: true } }, prog([draw(2)])),
      when({ on: 'drewWithHand', others: 9 }, prog([discardHand, kill(ref.self), points(1, 'opponent')]))],
  }),
  unit('ziggs-explosive', '[1], [E]: Play a Bomb gear token to a battlefield.\nWhen I defend, you may kill a friendly gear to give me +2 [M] this turn.', {
    abilities: [activated({ energy: 1, exhaustSelf: true }, prog([playToken('bomb', 1, 'choose')])),
      when({ on: 'defend', who: 'self' }, prog([might(2, ref.self)]), { may: true, cost: { kill: { sel: gearSel({ rel: 'friendly' }), n: 1 } } })],
  }),
  legend('ziggs-hexplosives-expert', '[1][A], [E]: Play a Bomb gear token to a battlefield.', [
    activated({ energy: 1, power: ['A'], exhaustSelf: true }, prog([playToken('bomb', 1, 'choose')])),
  ]),
  unit('ziggs-short-fused', 'When you play me, play a Bomb gear token to a battlefield.\nAbilities of friendly gear deal 1 Bonus Damage.', {
    abilities: [onPlay(prog([playToken('bomb', 1, 'choose')])), always({ s: 'bonusDamage', n: 1, from: 'friendlyGear' })],
  }),

  // ---- rulings pass (docs/CARD-RULINGS.md) ----
  // "Until your next Ending Phase": until the next of your Ending Phases begins (Radiance FAQ, Runeblade Anvil).
  unit('akali-brash', 'The first time I move each turn, [Add] [1][A].\nThe second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([{ op: 'add', energy: 1, power: 1 }]), { first: 'turn' }),
      when({ on: 'moved', who: 'self' }, prog([banishTop(1, 'b'), allowPlay(ref.bound('b'))]), { if: cond.self(pred.moves(2)) })],
  }),
  ...(() => {
    const anvil = prog([banishTop(1, 'b'), allowPlay(ref.bound('b'))]);
    return [gear('runeblade-anvil', 'When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.\n[2][P], [E]: Kill this.', {
      abilities: [onPlay(anvil), when({ on: 'leaves', who: 'self' }, anvil), activated({ energy: 2, power: ['fury'], exhaustSelf: true }, prog([kill(ref.self)]))],
    })];
  })(),
  // Radiance patch notes: a unit gear is a gear and a unit (moves, fights, takes damage, dies); attached, it detaches as it
  // becomes one; the previous one stops being a unit as the next gear is chosen (finalization) [137.3.b], [143.5].
  legend('orianna-lady-of-clockwork', 'At the start of your Main Phase, you may pay [1] to choose a friendly gear. It becomes a unit gear with Might equal to its Energy cost until you choose another gear with me.', [
    when({ on: 'phase', at: 'mainStart', whose: 'your' }, prog([{ op: 'becomeUnit', what: ref.slot('g') }], [slot('g', gearSel({ rel: 'friendly' }))]),
      { may: true, cost: { energy: 1 } }),
  ]),
  // [Ganking] works only while this is a unit (Orianna): a Standard Move from battlefield to battlefield [810.1.a], [144.4.c].
  gear('the-ball', '[Deploy]\n[Ganking]\nWhen you play or move this, choose one —\n• Draw 1.\n• Deal 2 to enemy units here.', {
    abilities: [...(() => {
      const m = modal(1, [mode('Draw 1', [draw(1)]), mode('Deal 2 to enemy units here', [deal(2, unitSel({ rel: 'enemy', at: 'here' }))])]);
      return [onPlay(m), when({ on: 'moved', who: 'self' }, m)];
    })()],
  }),
  // Radiance patch notes: up to 3 legends chosen while building the deck (PlayerState.extra), shared by every Neeko; one
  // of each in play at most; ready; not tokens; they cease to exist as Neeko leaves the board [103.1], [440.3].
  unit('neeko-blending-in', "If Neeko is in your deck, choose up to 3 different legends in addition to your starting legend.\nWhen you play me, choose one of those Legends and add it to your Legend Zone while I'm on the board.", {
    abilities: [onPlay(prog([{ op: 'addLegend', from: 'neeko-blending-in' }]))],
  }),
];
