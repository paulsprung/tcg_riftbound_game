/*
 * VEN: the cards of the set (those not in the starter decks).
 * Each `text` is the oracle's rules text, word for word (a test checks it).
 */
import {
  activated, always, burn, cardSel as cards, channel, choiceBy, choose, cond, costAbility, deal, deathknell, draw, empower,
  entersReady, forEach, gear, grant, iff, keywordTo, kill, killAllBut, kw, legend, might, mightTo, move, onPlay, permanentSel,
  playerEffect, points, pred, predict, prog, ready, ref, runeSel, slot, spell, statik, unit, unitSel, val, when, gearSel,
  banish, baseMight, battlefield, counter, discard, double, grantAbility, playToken, recycle, returnToHand, revealHand, spellSel,
  bfSel, gainControl, modal, mode, named, recall, stun, look, may, pickWhere, playFree, toTrash,
  revealTop, addEnergy, legendSel, fight, pay, retarget, buff, delayed, destSlot, swap, recycleRest,
} from '../../dsl/builders.ts';

const friendly = unitSel({ rel: 'friendly' });
const empowered = cond.self(pred.empowered);

export const VEN_SET_DEFS = [
  // ---- batch 1 ----
  spell('acceleration-gate', 'Ready up to 4 units, gear, and/or runes.', {
    choose: [slot('a', [permanentSel(), runeSel()], { min: 0, max: 4 })], body: [ready(ref.slot('a'))],
  }),
  unit('affectionate-poro', "When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1.", {
    abilities: [when({ on: 'combatEnded', who: 'self' }, prog([draw(1)]), { if: cond.not(cond.self(pred.damagedThisTurn)) })],
  }),
  ...(() => {
    const fx = prog([might(2, ref.slot('a'), -1, { floor: 1 })], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]);
    return [unit('ahri-inquisitive', 'When I attack or defend, give an enemy unit here -2 [M] this turn, to a minimum of 1 [M].', {
      abilities: [when({ on: 'attack', who: 'self' }, fx), when({ on: 'defend', who: 'self' }, fx)],
    })];
  })(),
  unit('akali-deadly-weapon', "[Empower] [2][R]\nWhen I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n[Empowered][>] I have +1 [M].", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([iff(empowered, [deal(2, ref.slot('a'))], [deal(1, ref.slot('a'))])],
      [slot('a', unitSel({ where: [pred.atMoveEnds] }), { harm: true })]), { may: true }),
    statik(1, { while: empowered })],
  }),
  legend('akali-rogue-assassin', "[Empower] [3][A]\n[Action][>] [E]: If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it.", [
    activated({ exhaustSelf: true }, prog([iff(cond.yourTurn, [move(ref.slot('a'), 'base'), iff(empowered, [ready(ref.slot('a'))])])],
      [slot('a', unitSel({ rel: 'friendly', where: [pred.inShowdown] }))]), { timing: 'action' }),
  ]),
  unit('akali-silent', "I can't be chosen by enemy spells and abilities unless I'm in combat.\nWhen I move to a battlefield, give me +2 [M] this turn.", {
    abilities: [always({ s: 'noEnemyChoose' }, { while: cond.not(cond.self(pred.inCombat)) }),
      when({ on: 'moved', who: 'self', to: 'bf' }, prog([might(2, ref.self)]))],
  }),
  legend('ambessa-matriarch-of-war', 'When you empower something else, empower me.\nDisempower me, [A], [E]: Ready a unit.', [
    when({ on: 'empowered', who: 'other' }, prog([empower(ref.self)])),
    activated({ disempowerSelf: true, power: ['A'], exhaustSelf: true }, prog([ready(ref.slot('a'))], [slot('a', unitSel())])),
  ]),
  unit('ambessa-respected-and-feared', '[Empower] [1][Y][Y]\n[Empowered][>] I have [Assault 2].\n[Empowered][>] When I attack, kill an enemy unit here with less Might than me.', {
    abilities: [keywordTo(kw.assault(2), undefined, { while: empowered }),
      when({ on: 'attack', who: 'self' }, prog([kill(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here', where: [pred.mightVsSource('<')] }), { harm: true })]),
        { if: empowered })],
  }),
  unit('ambessa-the-wolf', "[Empower] [3][O]\n[Empowered][>] I have +3 [M] and can't be dealt damage unless I'm in combat.", {
    abilities: [statik(3, { while: empowered }), always({ s: 'noDamage' }, { while: cond.and(empowered, cond.not(cond.self(pred.inCombat))) })],
  }),
  unit('applied-researchers', '[Empower] [3]\n[Empowered][>] Your spells cost [1][A] less, to a minimum of [1].', {
    abilities: [costAbility({ grant: { types: ['spell'] }, discount: { energy: 1, power: 1, min: 1 }, while: empowered })],
  }),
  unit('apprentice-mage', '[Empower] [2]\nWhen I become [Empowered], [Predict 2].\n[Empowered][>] I have +1 [M].', {
    abilities: [when({ on: 'empowered', who: 'self' }, prog([predict(2)])), statik(1, { while: empowered })],
  }),
  unit('astral-heron', "When you play your first card each turn, if I'm at a battlefield, the next card you play this turn costs [2][A][A] less.", {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { card: true } },
      prog([playerEffect({ s: 'costLess', types: ['unit', 'spell', 'gear'], energy: 2, power: 2, uses: 1 })]),
      { if: cond.and(cond.selfAt('battlefield'), cond.thisTurn('played', { op: '=', n: 1 })) })],
  }),
  unit('aurok-general', '[Empower] [3][Y]\n[Empowered][>] Your units that are [Empowered] have +2 [M].', {
    abilities: [mightTo(2, unitSel({ rel: 'friendly', where: [pred.empowered] }), { while: empowered })],
  }),
  unit('baccai-reaper', 'When I attack, you may pay [R] to give me [Assault 2] this turn.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([grant(kw.assault(2), ref.self)]), { may: true, cost: { power: ['fury'] } })],
  }),
  unit('baccai-sandspinner', '[Empower] [5]. This ability costs [3] less if you control 4 or fewer runes.\n[Empowered][>] I have [Deflect] and [Assault 2].', {
    kw: [{ kw: 'empower', equipLessBy: val.if(cond.count(runeSel({ rel: 'friendly' }), '<=', 4), 3, 0) }],
    abilities: [keywordTo(kw.deflect(), undefined, { while: empowered }), keywordTo(kw.assault(2), undefined, { while: empowered })],
  }),
  unit('baccai-witherclaw', '[Empower] [1][A][A]\n[Empowered][>] I have +2 [M].\n[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted.', {
    abilities: [statik(2, { while: empowered }), deathknell(prog([iff(cond.lki(pred.empowered), [channel(2, { exhausted: true })])]))],
  }),
  unit('blade-twirler', 'The first time I move each turn, choose a player. They [Burn 1].', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([choiceBy('self', [{ label: 'You', body: [burn(1)] },
      { label: 'An opponent', body: [forEach('opponents', 'next', [burn(1)])] }])]), { first: 'turn' })],
  }),
  gear('bottled-constellation', 'At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point.', {
    abilities: [when({ on: 'phase', at: 'mainStart', whose: 'your' }, prog([points(1)]),
      { may: true, cost: { kill: { sel: permanentSel({ rel: 'friendly', other: true }), n: 3 } } })],
  }),
  spell('brittle-steel', 'Kill a gear.\n[Flow] [4][R]', { choose: [slot('g', gearSel(), { harm: true })], body: [kill(ref.slot('g'))] }),
  unit('brutal-hunter', '[Empower] [3]\n[Empowered][>] I have +2 [M] and [Ganking].', {
    abilities: [statik(2, { while: empowered }), keywordTo(kw.ganking(), undefined, { while: empowered })],
  }),
  spell('cataclysmic-duel', 'Each player chooses a unit they control. Kill the rest.', {
    body: [forEach('each', 'you', [choose(friendly, 'k')]), killAllBut(unitSel(), ['k'])],
  }),
  spell('clairvoyance', '[Reaction]\n[Predict 5].\nDraw 2.', { kw: [kw.reaction()], body: [predict(5), draw(2)] }),
  unit('cloud-drake', 'When you play me, draw 1.', { abilities: [onPlay(prog([draw(1)]))] }),
  spell('consuming-curse', '[Action]\nDeal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash.', {
    kw: [kw.action()], choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [deal(val.sum(2, val.count(cards({ rel: 'friendly', where: [pred.name('Consuming Curse')] }))), ref.slot('a'))],
  }),
  unit('corrupted-dragon', 'If your score is not within 3 points of the Victory Score, I enter ready.\nWhen I attack, you may move any number of enemy units here each with 5 [M] or less to their base.', {
    abilities: [entersReady({ while: cond.not(cond.nearWin(3)) }),
      when({ on: 'attack', who: 'self' }, prog([move(ref.slot('a'), 'base')],
        [slot('a', unitSel({ rel: 'enemy', at: 'here', where: [pred.might('<=', 5)] }), { min: 0, max: 99, harm: true })]), { may: true })],
  }),
  unit('covert-informant', '[Empower] [3]\n[Empowered][>] When I move, draw 1.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([draw(1)]), { if: empowered })],
  }),
  // ---- batch 2 ----
  spell('crumbling-sands', '[Reaction]\nCounter a spell if an opponent has played another spell this turn.', {
    kw: [kw.reaction()], choose: [slot('s', spellSel(), { harm: true })],
    body: [iff(cond.thisTurn('played', { types: ['spell'], who: 'opponent' }), [counter(ref.slot('s'))])],
  }),
  ...(() => {
    const fx = prog([might(val.diff(val.might(ref.slot('a')), val.might(ref.self)), ref.self), might(1, ref.self)], [slot('a', unitSel({ at: 'here' }))]);
    return [unit('dame-the-despoiler', '[Empower] [5][O]\n[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might this turn, then give me +1 [M] this turn.', {
      abilities: [when({ on: 'attack', who: 'self' }, fx, { if: empowered }), when({ on: 'defend', who: 'self' }, fx, { if: empowered })],
    })];
  })(),
  spell('death-mark', '[Burn 3].\nPlay a 0 [M] Shadow Clone unit token.\n[Flow] [1][A][A]', {
    body: [burn(3), playToken('shadowClone', 1, 'choose')],
  }),
  spell('decree-of-discord', "Return any number of enemy Order units with total Might 5 or less to their owners' hands.", {
    choose: [slot('a', unitSel({ rel: 'enemy', where: [pred.domain('order')] }), { min: 0, max: 99, harm: true, sumMightMax: 5 })],
    body: [returnToHand(ref.slot('a'))],
  }),
  spell('decree-of-focus', "[Reaction]\nChoose a friendly unit that's in combat with an enemy Fury unit or that's being chosen by an enemy Fury spell. Give it +4 [M] this turn.", {
    kw: [kw.reaction()],
    choose: [slot('a', [unitSel({ rel: 'friendly', where: [{ p: 'inCombatWithDomain', d: 'fury' }] }),
      unitSel({ rel: 'friendly', where: [{ p: 'chosenBySpellOfDomain', d: 'fury' }] })])],
    body: [might(4, ref.slot('a'))],
  }),
  spell('decree-of-insight', "[Reaction]\nIgnore [Deflect] while paying this spell's cost.\nGive an enemy Body unit -5 [M] this turn.", {
    kw: [kw.reaction()], abilities: [costAbility({ ignoreDeflect: true })],
    choose: [slot('a', unitSel({ rel: 'enemy', where: [pred.domain('body')] }), { harm: true })], body: [might(5, ref.slot('a'), -1)],
  }),
  spell('decree-of-rage', "[Action]\nThis can't be countered.\nDeal 4 to an enemy Calm unit.", {
    kw: [kw.action()], abilities: [always({ s: 'cantBeCountered' })],
    choose: [slot('a', unitSel({ rel: 'enemy', where: [pred.domain('calm')] }), { harm: true })], body: [deal(4, ref.slot('a'))],
  }),
  spell('decree-of-strength', 'Choose an opponent. They reveal their hand and you choose a Mind card from it. They recycle that card.', {
    body: [revealHand, choose(cards({ in: 'hand', rel: 'enemy', where: [pred.domain('mind')] }), 'c'), recycle(ref.bound('c'))],
  }),
  spell('decree-of-unity', 'Kill an enemy Chaos unit or gear.', {
    choose: [slot('a', permanentSel({ rel: 'enemy', where: [pred.domain('chaos')] }), { harm: true })], body: [kill(ref.slot('a'))],
  }),
  unit('diana-no-longer-human', '[Ambush]\nWhen you play a spell, give me +2 [M] this turn.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['spell'] } }, prog([might(2, ref.self)]))],
  }),
  unit('disciple-of-shen', "[Hidden]\nI have [Shield 3] while I'm at a battlefield with exactly one other unit you control.", {
    abilities: [keywordTo(kw.shield(3), undefined, { while: cond.and(cond.selfAt('battlefield'),
      cond.count(unitSel({ rel: 'friendly', other: true, at: 'here' }), '=', 1)) })],
  }),
  spell('dominus', '[Action]\nThis turn, double a unit\'s Might and give it "[A][A]: Ready me."', {
    kw: [kw.action()], abilities: [activated({ power: ['A', 'A'] }, prog([ready(ref.self)]), { grantedOnly: true })],
    choose: [slot('a', unitSel())], body: [double(ref.slot('a')), grantAbility('dominus#0', ref.slot('a'))],
  }),
  spell('dragon-form', 'Choose a unit. Its base Might becomes 5 this turn.\n[Flow] [3]', {
    choose: [slot('a', unitSel())], body: [baseMight(5, ref.slot('a'))],
  }),
  battlefield('dragon-roost', 'Any player may pay [A][A] as an additional cost to play a Dragon. If they do, they play it to this battlefield.', [
    costAbility({ grant: { types: ['unit'], whose: 'any', tag: 'Dragon' }, optional: true, add: { power: ['A', 'A'] }, playHere: true }),
  ]),
  unit('draven-showboat', 'My Might is increased by your points.', { abilities: [statik(val.points)] }),
  spell('dredge-up', 'Draw 1.\n[Flow] [2]', { body: [draw(1)] }),
  unit('dune-surfer', 'You ignore [Tank] while assigning combat damage here.', { abilities: [always({ s: 'ignoreTank' })] }),
  unit('eclipse-dragon', '[Accelerate]\nWhen I move, if you control 4 or fewer runes, draw 1.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([draw(1)]), { if: cond.count(runeSel({ rel: 'friendly' }), '<=', 4) })],
  }),
  gear('endless-riches', 'When you play this, banish your hand and trash, then [Burn 7].\nSkip your Draw Phase.\nYou may play cards from your trash.\nIf a card would go to your trash from anywhere other than your Main Deck, banish it instead.', {
    abilities: [onPlay(prog([banish(cards({ in: 'hand', rel: 'friendly' })), banish(cards({ rel: 'friendly' })), burn(7)])),
      always({ s: 'skipDraw' }), always({ s: 'playAllFromTrash' }), always({ s: 'trashToBanish' })],
  }),
  unit('escaped-grayback', '[Empower] — Kill a friendly unit\n[Empowered][>] I have +2 [M].', { abilities: [statik(2, { while: empowered })] }),
  unit('esteemed-hierophant', 'While you control 7 or more runes, prevent all damage that enemy spells and abilities would deal to me.', {
    abilities: [always({ s: 'noDamage', from: 'enemyEffects' }, { while: cond.count(runeSel({ rel: 'friendly' }), '>=', 7) })],
  }),
  unit('ezreal-prodigy', 'When you play me, discard 1, then draw 2.\nOptional additional costs you pay cost [1] or [A] less.', {
    abilities: [onPlay(prog([discard(1), draw(2)])), always({ s: 'optionalLess' })],
  }),
  unit('fallen-feline', "When you play me, name a spell.\nWhile I'm at a battlefield, opponents can't play spells with that name.", {
    abilities: [always({ s: 'nameCard', types: ['spell'] }), always({ s: 'opponentsCantPlayNamed' }, { while: cond.selfAt('battlefield') })],
  }),
  unit('field-musicians', 'When you play me, give a unit +3 [M] this turn.', {
    abilities: [onPlay(prog([might(3, ref.slot('a'))], [slot('a', unitSel())]))],
  }),
  ...(() => {
    const relic = prog([burn(1, 'b'), iff(cond.is(ref.bound('b'), pred.type('unit')), [choose(friendly, 'u'), might(val.might(ref.bound('b')), ref.bound('u'))])]);
    return [gear('forgotten-relic', "When you play this or at the start of your Beginning Phase, [Burn 1]. When you burn a unit this way, do this: Give a friendly unit +[M] equal to the burned card's Might this turn.", {
      abilities: [onPlay(relic), when({ on: 'phase', at: 'beginning', whose: 'your' }, relic)],
    })];
  })(),
  // ---- batch 3 ----
  unit('frostcoat-mother', '[Empower] [12]. This ability costs [1] less for each rune you control.\n[Empowered][>] I have +3 [M].', {
    kw: [{ kw: 'empower', equipLessBy: val.count(runeSel({ rel: 'friendly' })) }], abilities: [statik(3, { while: empowered })],
  }),
  unit('gangplank-naval', '[Empower] [O][O]\n[Empowered][>] If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] this turn instead.', {
    abilities: [always({ s: 'chosenImmune', n: 3 }, { while: empowered })],
  }),
  gear('glowstone', '[Empower] [A][A]\nDisempower this, [E]: Choose a player. They gain control of this and recall it.\nAt the end of your turn, kill this and deal 5 to all units you control.', {
    abilities: [activated({ disempowerSelf: true, exhaustSelf: true }, prog([choiceBy('self', [{ label: 'You', body: [recall(ref.self)] },
      { label: 'An opponent', body: [forEach('opponents', 'next', [gainControl(ref.self), recall(ref.self)])] }])])),
    when({ on: 'phase', at: 'endOfTurn', whose: 'your' }, prog([kill(ref.self), deal(5, friendly)]))],
  }),
  unit('grumpy-rockbear', '[Empower] [12]. This ability costs [1] less for each rune you control.\n[Empowered][>] I have [Deflect] and [Shield 3].', {
    kw: [{ kw: 'empower', equipLessBy: val.count(runeSel({ rel: 'friendly' })) }],
    abilities: [keywordTo(kw.deflect(), undefined, { while: empowered }), keywordTo(kw.shield(3), undefined, { while: empowered })],
  }),
  unit('gust-monk', 'You may pay [1] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, banish a card from any trash to give a unit [Assault 2] this turn.', {
    abilities: [costAbility({ optional: true, add: { energy: 1 } }),
      onPlay(prog([choose(cards({ rel: 'any' }), 'c'), named('b', banish(ref.bound('c'))),
        iff(cond.did('b'), [choose(unitSel(), 'u'), grant(kw.assault(2), ref.bound('u'))])]), { if: cond.paid('gust-monk#0') })],
  }),
  spell('guttural-roar', "[Action]\nGive a unit +2 [M] this turn. If it's [Empowered], give it +4 [M] this turn instead.", {
    kw: [kw.action()], choose: [slot('a', unitSel())],
    body: [iff(cond.is(ref.slot('a'), pred.empowered), [might(4, ref.slot('a'))], [might(2, ref.slot('a'))])],
  }),
  gear('hand-hammer', "[Equip] [G]\nI have +2 [M] while I'm at a battlefield with exactly one other unit you control.", {
    abilities: [statik(2, { effectText: true, while: cond.and(cond.selfAt('battlefield'), cond.count(unitSel({ rel: 'friendly', other: true, at: 'here' }), '=', 1)) })],
  }),
  battlefield('heisho-shell-of-the-world', 'Players ignore [Deflect] while paying for spells and abilities choosing something here.', [always({ s: 'ignoreDeflectHere' })]),
  gear('helm-of-suppression', "[Empower] [4][G]\nOpponents' spells cost [1] more. If this is [Empowered], they cost [1][A] more instead.", {
    abilities: [costAbility({ grant: { types: ['spell'], whose: 'enemy' }, increase: { energy: 1 }, while: cond.not(empowered) }),
      costAbility({ grant: { types: ['spell'], whose: 'enemy' }, increase: { energy: 1, power: ['A'] }, while: empowered })],
  }),
  gear('hextech-disc', '[Empower] — [E]\nDisempower this, [1], [E]: Play a 3 [M] Mech unit token to your base.', {
    abilities: [activated({ disempowerSelf: true, energy: 1, exhaustSelf: true }, prog([playToken('mech', 1, 'yourBase')]))],
  }),
  gear('hextech-formula', 'This enters exhausted.\n[E]: Empower another gear.', {
    abilities: [always({ s: 'entersExhausted' }),
      activated({ exhaustSelf: true }, prog([empower(ref.slot('g'))], [slot('g', gearSel({ other: true, where: [pred.canEmpower] }))]))],
  }),
  unit('hungry-wolf', "[Y]: Ready me and give me +1 [M] this turn. Use only if you've chosen an enemy unit this turn and only once each turn.", {
    abilities: [activated({ power: ['order'] }, prog([ready(ref.self), might(1, ref.self)]), { while: cond.chosenEnemies(1), limit: { n: 1, per: 'turn' } })],
  }),
  ...(() => {
    const tentacle = prog([playToken('tentacle', 1, 'choose')]);
    return [unit('illaoi-prophet-of-the-great-kraken', 'When you play me or when I score, play a [1] [M] Tentacle unit token from Bilgewater.\nI have +1 [M] for each token unit you control.', {
      abilities: [onPlay(tentacle), when({ on: 'score', who: 'you', at: 'here' }, tentacle),
        statik(val.count(unitSel({ rel: 'friendly', where: [pred.token] })))],
    })];
  })(),
  unit('irelia-fervent', '[Deflect]\nWhen you choose or ready me, give me +1 [M] this turn.', {
    abilities: [when({ on: 'chosen', who: 'self' }, prog([might(1, ref.self)])), when({ on: 'readied', who: 'self' }, prog([might(1, ref.self)]))],
  }),
  spell('iterative-design', 'Play a 3 [M] Mech unit token.\n[Flow] [2][B]', { body: [playToken('mech', 1, 'choose')] }),
  gear('jagged-cutlass', "[Equip] [O]\nI can't be moved by enemy spells and abilities.", { abilities: [always({ s: 'noEnemyMove' }, { effectText: true })] }),
  ...(() => {
    const rdy = prog([ready(ref.slot('a'))], [slot('a', [permanentSel({ other: true, where: [pred.exhausted] }), runeSel({ where: [pred.exhausted] })])]);
    return [unit('jayce-brilliant-inventor', "When you play me or the first time you play a non-token gear each turn, you may ready something besides me that's exhausted.", {
      abilities: [onPlay(rdy, { may: true }), when({ on: 'cardPlayed', by: 'you', what: { types: ['gear'], card: true } }, rdy, { may: true, first: 'turn' })],
    })];
  })(),
  legend('jayce-defender-of-tomorrow', '[Empower] [2][A][A]\n[1], [E]: Ready a gear.\n[Empowered][>] [1], [E]: Ready 2 gear.', [
    activated({ energy: 1, exhaustSelf: true }, prog([ready(ref.slot('g'))], [slot('g', gearSel())])),
    activated({ energy: 1, exhaustSelf: true }, prog([ready(ref.slot('g'))], [slot('g', gearSel(), { min: 1, max: 2 })]), { while: empowered }),
  ]),
  unit('jayce-hammer-in-hand', 'When I become ready, choose one to give me this turn —\n• [Assault 2]\n• [Deflect 2]\n• [Ganking]', {
    abilities: [when({ on: 'becomesReady', who: 'self' }, modal(1, [mode('Assault 2', [grant(kw.assault(2), ref.self)]),
      mode('Deflect 2', [grant(kw.deflect(2), ref.self)]), mode('Ganking', [grant(kw.ganking(), ref.self)])]))],
  }),
  unit('jayce-man-of-progress', 'When you play me, you may kill a friendly gear. If you do, you may play a gear with Energy cost no more than [7] from hand this turn, ignoring its Energy cost.', {
    abilities: [onPlay(prog([playerEffect({ s: 'costLess', types: ['gear'], energy: 7, maxEnergy: 7, uses: 1 })]),
      { may: true, cost: { kill: { sel: gearSel({ rel: 'friendly' }), n: 1 } } })],
  }),
  unit('kaisa-survivor', '[Accelerate]\nWhen I conquer, draw 1.', { abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([draw(1)]))] }),
  unit('kayle-justified', "[Empower] [3]\nI can be [Empowered] up to three times.\nI have +2 [M] for each time I'm [Empowered].\nWhile I'm [Empowered] three times, I have [Deflect 3] and [Ganking].", {
    abilities: [always({ s: 'maxEmpower', n: 3 }), statik(val.sum(val.empowerCount, val.empowerCount)),
      keywordTo(kw.deflect(3), undefined, { while: cond.self(pred.empoweredAtLeast(3)) }),
      keywordTo(kw.ganking(), undefined, { while: cond.self(pred.empoweredAtLeast(3)) })],
  }),
  unit('keeper-of-law', 'I cost [2][Y] less if you control a battlefield with exactly two units there.', {
    abilities: [costAbility({ discount: { energy: 2, power: 1 }, while: cond.count(bfSel({ rel: 'friendly', where: [pred.unitCount(2)] }), '>=', 1) })],
  }),
  legend('kennen-heart-of-the-tempest', 'When you play a card from anywhere other than your hand, empower me.\n[Action][>] Disempower me, [E]: Give a unit [Assault 2] this turn.', [
    when({ on: 'cardPlayed', by: 'you', what: { card: true, notFromHand: true } }, prog([empower(ref.self)])),
    activated({ disempowerSelf: true, exhaustSelf: true }, prog([grant(kw.assault(2), ref.slot('a'))], [slot('a', unitSel())]), { timing: 'action' }),
  ]),
  ...(() => {
    const st = prog([stun(ref.slot('a'))], [slot('a', unitSel(), { harm: true })]);
    return [unit('kennen-keeper-of-balance', "[Hidden]\nWhen you play me or I attack, you may pay [2] to [Stun] a unit.\nWhile there's a stunned enemy unit here, I have +2 [M].", {
      abilities: [onPlay(st, { may: true, cost: { energy: 2 } }), when({ on: 'attack', who: 'self' }, st, { may: true, cost: { energy: 2 } }),
        statik(2, { while: cond.count(unitSel({ rel: 'enemy', at: 'here', where: [pred.stunned] }), '>=', 1) })],
    })];
  })(),
  // ---- batch 4 ----
  unit('kennen-storm-of-shuriken', 'When you play me, [Burn 2].\nWhen I conquer, give a spell in your trash [Flow] equal to its cost this turn.', {
    abilities: [onPlay(prog([burn(2)])),
      when({ on: 'conquer', who: 'you', at: 'here' }, prog([choose(cards({ rel: 'friendly', where: [pred.type('spell')] }), 'c'), { op: 'grantFlow', what: ref.bound('c') }]))],
  }),
  unit('kharox', '[Empower] [6][P][P]\nWhen I become [Empowered], choose an opponent. They [Burn 3]. Then you may do this: Choose a unit in their trash and play it, ignoring its cost.', {
    abilities: [when({ on: 'empowered', who: 'self' }, prog([forEach('opponents', 'next', [burn(3)]),
      may([choose(cards({ rel: 'enemy', where: [pred.type('unit')] }), 'c'), playFree(ref.bound('c'))])]))],
  }),
  unit('khazix-evolving-hunter', '[Hunt]\nWhen I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(val.might(ref.self), ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]),
      { may: true, cost: { xp: 3 } })],
  }),
  spell('ki-barrier', '[Reaction]\nChoose a unit. Prevent the next 7 damage that would be dealt to it this turn.', {
    kw: [kw.reaction()], choose: [slot('a', unitSel())], body: [{ op: 'preventAmount', what: ref.slot('a'), n: 7 }],
  }),
  unit('kinkou-lifeblade', '[Empower] [2]\n[Empowered][>] I have +1 [M] and [Ganking].', {
    abilities: [statik(1, { while: empowered }), keywordTo(kw.ganking(), undefined, { while: empowered })],
  }),
  battlefield('kinkou-temple', 'Units here with [Tank] have +1 [M].', [mightTo(1, unitSel({ at: 'here', where: [pred.keyword('tank')] }))]),
  spell('lacerate', "Choose a unit. If it's [Empowered], disempower it. Then kill it if it has 3 [M] or less.\n[Flow] [4][Y][Y]", {
    choose: [slot('a', unitSel(), { harm: true })],
    body: [{ op: 'disempower', what: ref.slot('a') }, iff(cond.is(ref.slot('a'), pred.might('<=', 3)), [kill(ref.slot('a'))])],
  }),
  unit('legion-marauder', '[Empower] — [1] or [O]\n[Empowered][>] I have +1 [M].', { abilities: [statik(1, { while: empowered })] }),
  unit('leona-determined', '[Shield]\nWhen I attack, stun an enemy unit here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]))],
  }),
  spell('lightning-rush', 'Look at the top 3 cards of your Main Deck. You may choose a card from among them and draw it. Put the rest into your trash.\n[Flow] [2][A]', {
    body: [look(3, 'l'), pickWhere('l', 1, 'c', { min: 0 }), draw(1, ref.bound('c')), toTrash(ref.bound('l'))],
  }),
  unit('masa-crashing-thunder', 'You may pay [Y] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield.', {
    abilities: [costAbility({ optional: true, add: { power: ['order'] } }),
      onPlay(prog([stun(ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true })]), { if: cond.paid('masa-crashing-thunder#0') })],
  }),
  unit('mask-mother', 'When you discard me, you may pay [1] to give a friendly unit +2 [M] this turn.', {
    abilities: [when({ on: 'discarded', who: 'self' }, prog([might(2, ref.slot('a'))], [slot('a', friendly)]), { may: true, cost: { energy: 1 }, activeIn: ['trash'] })],
  }),
  unit('mel-defiant-soul', '[Empower] — Discard a spell\nWhen I become [Empowered], banish an enemy unit at a battlefield with 3 [M] or less.', {
    abilities: [when({ on: 'empowered', who: 'self' }, prog([banish(ref.slot('a'))],
      [slot('a', unitSel({ rel: 'enemy', at: 'battlefield', where: [pred.might('<=', 3)] }), { harm: true })]))],
  }),
  unit('mel-newly-awakened', "When you play me, draw 1.\n[Empower] [3]\n[Empowered][>] Your spells and abilities can't be countered. If a spell or ability you control would give -[M] to a unit it chooses, it gives an additional -1 [M].", {
    abilities: [onPlay(prog([draw(1)])), always({ s: 'cantBeCountered', yours: true }, { while: empowered }),
      always({ s: 'extraDecrease', n: 1 }, { while: empowered })],
  }),
  legend('mel-souls-reflection', 'When you empower something else, empower me.\nDisempower me, [E]: Give a unit at a battlefield -2 [M] this turn.', [
    when({ on: 'empowered', who: 'other' }, prog([empower(ref.self)])),
    activated({ disempowerSelf: true, exhaustSelf: true }, prog([might(2, ref.slot('a'), -1)], [slot('a', unitSel({ at: 'battlefield' }), { harm: true })])),
  ]),
  spell('mesmerize', "[Reaction]\nChoose one —\n• Return a friendly unit to its owner's hand.\n• Give an enemy unit -2 [M] this turn.", {
    kw: [kw.reaction()],
    ...modal(1, [mode('Return a friendly unit', [returnToHand(ref.slot('a'))], [slot('a', friendly)]),
      mode('An enemy unit -2', [might(2, ref.slot('b'), -1)], [slot('b', unitSel({ rel: 'enemy' }), { harm: true })])]),
  }),
  unit('minah-swiftfoot', 'When I move to a battlefield, choose one —\n• Each player discards 1.\n• Each player draws 1.', {
    abilities: [when({ on: 'moved', who: 'self', to: 'bf' }, modal(1, [mode('Each player discards 1', [forEach('each', 'you', [discard(1)])]),
      mode('Each player draws 1', [forEach('each', 'you', [draw(1)])])]))],
  }),
  unit('morgana-vindictive', '[Ambush]\nWhen you play me, deal damage to a unit equal to the damage marked on it.', {
    abilities: [onPlay(prog([deal(val.damageOn(ref.slot('a')), ref.slot('a'))], [slot('a', unitSel({ where: [pred.damaged] }), { harm: true })]))],
  }),
  unit('mournful-witness', 'When a combat that I was in ends, empower me.\n[Empowered][>] I have +2 [M].', {
    abilities: [when({ on: 'combatEnded', who: 'self' }, prog([empower(ref.self)])), statik(2, { while: empowered })],
  }),
  battlefield('mystic-vortex', 'During showdowns here, cards with [Reaction] cost [A] more to play.', [
    costAbility({ grant: { types: ['unit', 'spell', 'gear'], whose: 'any', keyword: 'reaction' }, increase: { power: ['A'] }, while: cond.selfInShowdown }),
  ]),
  unit('nasus-ascended', '[Deflect 2]\n[Empower] [8]\n[Empowered][>] When I conquer, you score 1 point.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([points(1)]), { if: empowered })],
  }),
  ...(() => {
    const runes2 = prog([choose(runeSel({ rel: 'friendly', where: [pred.exhausted] }), 'r', { min: 0, max: 2 }), ready(ref.bound('r'))]);
    const o = { may: true as const, cost: { exhaustSelf: true as const } };
    return [legend('nasus-curator-of-the-sands', 'When you play a unit, gear, or activated ability with Energy cost [7] or more, you may exhaust me to ready up to 2 runes.', [
      when({ on: 'cardPlayed', by: 'you', what: { types: ['unit', 'gear'], minEnergy: 7 } }, runes2, o),
      when({ on: 'abilityPlayed', minEnergy: 7 }, runes2, o),
    ])];
  })(),
  unit('nasus-guardian-of-knowledge', 'Once each turn, when an enemy unit here dies, channel 1 rune exhausted.', {
    abilities: [when({ on: 'unitDies', at: 'here', who: 'enemy' }, prog([channel(1, { exhausted: true })]), { limit: { n: 1, per: 'turn' } })],
  }),
  unit('noxian-demolitionist', 'When I conquer, you may kill a gear with Energy cost no more than my Might.', {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([kill(ref.slot('g'))], [slot('g', gearSel({ where: [pred.energyAtMostSourceMight] }), { harm: true })]),
      { may: true })],
  }),
  unit('noxian-emissary', '[Empower] [1][Y]\n[Empowered][>][>>][Deathknell][>] Play two 1 [M] Recruit unit tokens to your base.', {
    abilities: [deathknell(prog([iff(cond.lki(pred.empowered), [playToken('recruit', 2, 'yourBase')])]))],
  }),
  // ---- batch 5 ----
  unit('forsaken-baccai', 'If you control fewer runes than an opponent at the start of your Beginning Phase, give me +1 [M] this turn.', {
    abilities: [when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([might(1, ref.self)]), { if: cond.fewerRunes })],
  }),
  unit('fretful-feline', 'When I become ready, give me +2 [M] this turn.', { abilities: [when({ on: 'becomesReady', who: 'self' }, prog([might(2, ref.self)]))] }),
  unit('oasis-raider', 'If you control fewer runes than an opponent at the start of your Beginning Phase, give me +2 [M] and [Ganking] this turn.', {
    abilities: [when({ on: 'phase', at: 'beginning', whose: 'your' }, prog([might(2, ref.self), grant(kw.ganking(), ref.self)]), { if: cond.fewerRunes })],
  }),
  unit('ocean-drake', 'You may play me to an open battlefield.\nWhen you play me, you may return a non-Dragon unit to its owner\'s hand.', {
    abilities: [always({ s: 'playTo', where: 'open' }),
      onPlay(prog([returnToHand(ref.slot('a'))], [slot('a', unitSel({ where: [pred.not(pred.tag('Dragon'))] }), { harm: true })]), { may: true })],
  }),
  unit('ol-poro', "I can't be played on your first, second, or third turns.", { abilities: [always({ s: 'cantBePlayed' }, { while: { c: 'ownTurns', op: '<=', n: 3 } })] }),
  spell('onslaught', 'Give a unit +6 [M] this turn.\n[Flow] [4]', { choose: [slot('a', unitSel())], body: [might(6, ref.slot('a'))] }),
  unit('otterpus', 'If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead.', {
    abilities: [always({ s: 'earlyPointsToDraw' })],
  }),
  unit('pakaa-protector', "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 [M] this turn.", {
    abilities: [when({ on: 'moved', who: 'self' }, prog([revealTop('r'),
      iff(cond.is(ref.bound('r'), pred.type('unit')), [draw(1, ref.bound('r'))], [toTrash(ref.bound('r')), might(2, ref.self)])]))],
  }),
  unit('patched-porobot', 'When you play me, if you control 3 or more other gear, draw 1.', {
    abilities: [onPlay(prog([draw(1)]), { if: cond.count(gearSel({ rel: 'friendly', other: true }), '>=', 3) })],
  }),
  gear('pendulum-blade', '[Equip] [R]\nWhen I move to a battlefield, give me +2 [M] this turn.', {
    abilities: [when({ on: 'moved', who: 'self', to: 'bf' }, prog([might(2, ref.self)]), { effectText: true })],
  }),
  spell('perfect-execution', 'Ready a unit and give it [Assault 3] this turn.\n[Flow] [3][R]', {
    choose: [slot('a', unitSel())], body: [ready(ref.slot('a')), grant(kw.assault(3), ref.slot('a'))],
  }),
  battlefield('piltovan-forge', 'While you control this battlefield, the first friendly gear activated ability played each turn costs [1] less.', [
    always({ s: 'gearAbilityLess', n: 1 }, { while: cond.controlsSelf }),
  ]),
  gear('platewyrm-egg', 'This enters exhausted.\n[Empower] — [1], [E]\n[Reaction][>] [E]: [Add] [1]. If this is [Empowered], [Add] [2] instead.', {
    abilities: [always({ s: 'entersExhausted' }),
      activated({ exhaustSelf: true }, prog([addEnergy(1)]), { timing: 'reaction', isAdd: true, while: cond.not(empowered) }),
      activated({ exhaustSelf: true }, prog([addEnergy(2)]), { timing: 'reaction', isAdd: true, while: empowered })],
  }),
  unit('plaza-guardian', 'I cost [1] less for each gear you control.\n[Deflect]', {
    abilities: [costAbility({ discount: { energy: val.count(gearSel({ rel: 'friendly' })) } })],
  }),
  unit('profiteer', 'When you play me, you may disempower something you control to empower a legend, unit, or gear.', {
    abilities: [onPlay(prog([choose([permanentSel({ rel: 'friendly', where: [pred.empowered] }), legendSel({ rel: 'friendly', where: [pred.empowered] })], 'd'),
      named('x', { op: 'disempower', what: ref.bound('d') }),
      iff(cond.did('x'), [choose([permanentSel({ where: [pred.canEmpower] }), legendSel({ where: [pred.canEmpower] })], 'e'), empower(ref.bound('e'))])]),
    { may: true })],
  }),
  battlefield('protective-sands', 'When you conquer here, if you control 4 or fewer runes, you may pay [1] to draw 1.', [
    when({ on: 'conquer', who: 'you', at: 'here' }, prog([draw(1)]),
      { controller: 'eventPlayer', may: true, cost: { energy: 1 }, if: cond.count(runeSel({ rel: 'friendly' }), '<=', 4) }),
  ]),
  spell('public-execution', 'Choose a friendly unit. Kill an enemy unit with less Might than it.\n[Flow] [5][A][A]', {
    choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy', where: [pred.mightVsSlot('a', '<')] }), { harm: true })], body: [kill(ref.slot('b'))],
  }),
  unit('punching-poro', '[Empower] — Discard 1\n[Empowered][>] I have +1 [M].', { abilities: [statik(1, { while: empowered })] }),
  gear('questionable-tome', '[Empower] — [E]\nDisempower this, [1], [E]: Draw 1.', {
    abilities: [activated({ disempowerSelf: true, energy: 1, exhaustSelf: true }, prog([draw(1)]))],
  }),
  gear('rage-amplifier', "[Empower] [6][R]\nYour units have +1 [M]. If I'm [Empowered], they have +2 [M] instead.", {
    abilities: [mightTo(1, friendly, { while: cond.not(empowered) }), mightTo(2, friendly, { while: empowered })],
  }),
  spell('rampage', 'As you play this, you may pay [O] as an additional cost.\nChoose a friendly unit and an enemy unit. If you paid the additional cost, give the friendly unit +2 [M] this turn. They deal damage equal to their Mights to each other.', {
    abilities: [costAbility({ optional: true, add: { power: ['body'] } })],
    choose: [slot('a', friendly), slot('b', unitSel({ rel: 'enemy' }), { harm: true })],
    body: [iff(cond.paid('rampage#0'), [might(2, ref.slot('a'))]), fight(ref.slot('a'), ref.slot('b'))],
  }),
  unit('ravenbloom-prefect', 'When an opponent plays a gear, you may banish me to banish it.', {
    abilities: [when({ on: 'cardPlayed', by: 'opponent', what: { types: ['gear'] } }, prog([banish(ref.subject)]), { may: true, cost: { banishSelf: true } })],
  }),
  spell('rebuttal', '[Reaction]\nChoose a spell with Energy cost no more than [4]. You may pay [A]. If you do, gain control of it and you may make new choices for it. Otherwise, counter it.', {
    kw: [kw.reaction()], choose: [slot('s', spellSel({ where: [pred.energyCost('<=', 4)] }), { harm: true })],
    body: [named('p', pay({ power: ['A'] })), iff(cond.did('p'), [retarget(ref.slot('s'))], [counter(ref.slot('s'))])],
  }),
  unit('reluctant-leader', 'When you play another unit, give me +2 [M] this turn.', {
    abilities: [when({ on: 'cardPlayed', by: 'you', what: { types: ['unit'], other: true } }, prog([might(2, ref.self)]))],
  }),
  unit('renekton-brute', '[1]: Give me +1 [M] this turn.\nWhen my Might becomes 10 or more, empower me.\n[Empowered][>] I have [Deflect] and [Ganking].', {
    abilities: [activated({ energy: 1 }, prog([might(1, ref.self)])), when({ on: 'mightReaches', n: 10 }, prog([empower(ref.self)])),
      keywordTo(kw.deflect(), undefined, { while: empowered }), keywordTo(kw.ganking(), undefined, { while: empowered })],
  }),
  legend('renekton-butcher-of-the-sands', '[Reaction][>] [A][A], [E]: [Add] [2]. Spend this Energy only to play units or activated abilities of units.', [
    activated({ power: ['A', 'A'], exhaustSelf: true }, prog([{ op: 'add', energy: 2, onlyFor: 'units' }]), { timing: 'reaction', isAdd: true }),
  ]),
  unit('renekton-rage-fueled', '[Accelerate]\nWhen I attack, if you control 4 or fewer runes, deal 2 to all enemy units here.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(2, unitSel({ rel: 'enemy', at: 'here' }))]), { if: cond.count(runeSel({ rel: 'friendly' }), '<=', 4) })],
  }),
  // ---- batch 6 ----
  unit('rengar-trophy-hunter', "[Ambush]\nI can [Ambush] to a battlefield where there are enemy units, even if you don't have units there.", {
    abilities: [always({ s: 'ambushEnemy' })],
  }),
  unit('repair-specialist', 'I have [Assault] equal to the number of gear you control.', {
    abilities: [always({ s: 'keyword', kw: kw.assault(), n: val.count(gearSel({ rel: 'friendly' })) })],
  }),
  spell('resonating-strike', '[Hidden]\n[Reaction]\nChoose a battlefield you control and a unit you control at a different location. Move that unit to that battlefield and give it +2 [M] this turn.', {
    kw: [kw.reaction()], choose: [slot('b', bfSel({ rel: 'friendly' })), slot('a', unitSel({ rel: 'friendly', where: [pred.notAtSlot('b')] }))],
    body: [might(2, ref.slot('a')), move(ref.slot('a'), { slotBf: 'b' })],
  }),
  battlefield('risen-altar', '[Empower] costs of your units here cost [1] or [A] less.', [always({ s: 'empowerLessHere' })]),
  unit('riven-shattered', '[Weaponmaster]\nWhen I attack, choose an enemy unit here. Deal 2 to it for each Equipment attached to me.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([deal(val.sum(val.count(gearSel({ where: [pred.attachedToSource] })),
      val.count(gearSel({ where: [pred.attachedToSource] }))), ref.slot('a'))], [slot('a', unitSel({ rel: 'enemy', at: 'here' }), { harm: true })]))],
  }),
  spell('ruthless-strike', '[Action]\nAs an additional cost to play this, you may discard 1.\nDeal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead.', {
    kw: [kw.action()], abilities: [costAbility({ optional: true, pay: { discard: 1 } })],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [iff(cond.paid('ruthless-strike#0'), [deal(5, ref.slot('a'))], [deal(3, ref.slot('a'))])],
  }),
  unit('sacred-protector', "I don't deal combat damage unless I'm at a battlefield with exactly one other unit you control.", {
    abilities: [always({ s: 'noCombatDamage' }, { while: cond.not(cond.and(cond.selfAt('battlefield'),
      cond.count(unitSel({ rel: 'friendly', other: true, at: 'here' }), '=', 1))) })],
  }),
  spell('sanction', "[Reaction]\nChoose one —\n• Empower a unit. Disempower it at end of turn.\n• Disempower a unit that's [Empowered]. Empower it at end of turn.", {
    kw: [kw.reaction()],
    ...modal(1, [
      mode('Empower a unit until end of turn', [empower(ref.slot('a')),
        delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' }, prog([{ op: 'disempower', what: ref.info('u') }]), { capture: { u: ref.slot('a') } })],
      [slot('a', unitSel({ where: [pred.canEmpower] }))]),
      mode('Disempower an Empowered unit until end of turn', [{ op: 'disempower', what: ref.slot('b') },
        delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' }, prog([empower(ref.info('u'))]), { capture: { u: ref.slot('b') } })],
      [slot('b', unitSel({ where: [pred.empowered] }), { harm: true })])]),
  }),
  unit('sandstone-chimera', "While I'm at a battlefield, players only channel 1 rune at the start of their Channel Phase.", {
    abilities: [always({ s: 'channelPhaseOne' }, { while: cond.selfAt('battlefield') })],
  }),
  battlefield('sandswept-tomb', 'Each spell that chooses one or more units here that are friendly to it costs [A] less.', [
    costAbility({ grant: { types: ['spell'], whose: 'any' }, discount: { energy: 0, power: 1, ifTarget: [pred.type('unit'), pred.friendly, pred.atSource] } }),
  ]),
  unit('serene-ascetic', '[Empower] [3]\n[Empowered][>] I have [Deflect] and [Shield 3].', {
    abilities: [keywordTo(kw.deflect(), undefined, { while: empowered }), keywordTo(kw.shield(3), undefined, { while: empowered })],
  }),
  unit('sett-brawler', 'When you play me or when I conquer, buff me.\nSpend my buff: Give me +4 [M] this turn.', {
    abilities: [onPlay(prog([buff(ref.self)])), when({ on: 'conquer', who: 'you', at: 'here' }, prog([buff(ref.self)])),
      activated({ spendBuffSelf: true }, prog([might(4, ref.self)]))],
  }),
  unit('shadow-assassin', 'I enter ready if you have a card with my name in your trash.', {
    abilities: [entersReady({ while: cond.count(cards({ rel: 'friendly', where: [pred.name('Shadow Assassin')] }), '>=', 1) })],
  }),
  spell('shadow-dash', 'Move an enemy unit to a battlefield where you have units. If you have exactly two units there, they each get +1 [M] this turn.\n[Flow] [5][A][A]', {
    choose: [slot('e', unitSel({ rel: 'enemy' }), { harm: true }), destSlot('d', 'e', 'yourUnits')],
    body: [move(ref.slot('e'), { dest: 'd' }), iff(cond.count(unitSel({ rel: 'friendly', at: { slot: 'd' } }), '=', 2),
      [might(1, unitSel({ rel: 'friendly', at: { slot: 'd' } }))])],
  }),
  unit('shadow-fiend', '[Empower] [2][R]\n[Empowered][>] I have [Assault 3].', { abilities: [keywordTo(kw.assault(3), undefined, { while: empowered })] }),
  unit('shadow-order-disciple', 'When I move, you may [Burn 1] to give me +1 [M] this turn.', {
    abilities: [when({ on: 'moved', who: 'self' }, prog([burn(1), might(1, ref.self)]), { may: true })],
  }),
  battlefield('shadow-temple', 'When you hold here, [Burn 3].', [
    when({ on: 'hold', who: 'you', at: 'here' }, prog([burn(3)]), { controller: 'eventPlayer' }),
  ]),
  unit('shadowblade-lurker', 'I cost [2] less for each card with my name in your trash.', {
    abilities: [costAbility({ discount: { energy: 2, times: val.count(cards({ rel: 'friendly', where: [pred.name('Shadowblade Lurker')] })) } })],
  }),
  spell('shadows-of-the-past', "Return up to 2 units from trashes to their owners' hands.", {
    choose: [slot('c', cards({ rel: 'any', where: [pred.type('unit')] }), { min: 0, max: 2 })], body: [returnToHand(ref.slot('c'))],
  }),
  legend('shen-eye-of-twilight', '[Action][>] [E]: Give a friendly unit [Tank] this turn.', [
    activated({ exhaustSelf: true }, prog([grant(kw.tank(), ref.slot('a'))], [slot('a', friendly)]), { timing: 'action' }),
  ]),
  ...(() => {
    const pair = cond.count(unitSel({ rel: 'friendly', other: true, at: 'here' }), '=', 1);
    return [unit('shen-leader-of-the-kinkou-order', '[Shield]\nWhen I hold, if there is exactly one other unit you control here, you score 1 point.', {
      abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([points(1)]), { if: pair })],
    }), unit('shen-scourge-of-shadows', 'When I hold, if there is exactly one other unit you control here, draw 1.', {
      abilities: [when({ on: 'hold', who: 'you', at: 'here' }, prog([draw(1)]), { if: pair })],
    })];
  })(),
  // ---- batch 7 ----
  spell('shock-blast', "[Action]\nThis costs [2] less if you control something that's [Empowered].\nDeal 4 to a unit at a battlefield.", {
    kw: [kw.action()],
    abilities: [costAbility({ discount: { energy: 2 }, while: cond.or(cond.count(permanentSel({ rel: 'friendly', where: [pred.empowered] }), '>=', 1),
      cond.count(legendSel({ rel: 'friendly', where: [pred.empowered] }), '>=', 1)) })],
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })], body: [deal(4, ref.slot('a'))],
  }),
  spell('shuriken-flip', 'Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n[Flow] [3][A]', {
    choose: [slot('e', unitSel({ rel: 'enemy', at: 'battlefield' }), { harm: true, min: 0 }), slot('a', friendly), destSlot('d', 'a')],
    body: [deal(2, ref.slot('e')), move(ref.slot('a'), { dest: 'd' })],
  }),
  spell('siphoning-strike', 'Deal 4 to a unit at a battlefield. If you control 7 or more runes, deal 7 to it instead. When it dies this turn, channel 1 rune exhausted.', {
    choose: [slot('a', unitSel({ at: 'battlefield' }), { harm: true })],
    body: [delayed(1, { on: 'objDies', info: 'u', any: true }, prog([channel(1, { exhausted: true })]), { capture: { u: ref.slot('a') } }),
      iff(cond.count(runeSel({ rel: 'friendly' }), '>=', 7), [deal(7, ref.slot('a'))], [deal(4, ref.slot('a'))])],
  }),
  unit('sky-crusier', 'Discard a gear, [1], [E]: Deal 4 to a unit at a battlefield.', {
    abilities: [activated({ energy: 1, exhaustSelf: true, discard: 1, discardTypes: ['gear'] },
      prog([deal(4, ref.slot('a'))], [slot('a', unitSel({ at: 'battlefield' }), { harm: true })]))],
  }),
  unit('solari-sunhawk', '[Empower] [2]\n[Empowered][>] I have +1 [M] and [Deflect 2].', {
    abilities: [statik(1, { while: empowered }), keywordTo(kw.deflect(2), undefined, { while: empowered })],
  }),
  unit('spiderling', '[Hidden]\nI have +1 [M] for each other unit you control here with my name.\nYour deck can have any number of cards named Spiderling.', {
    abilities: [statik(val.count(unitSel({ rel: 'friendly', other: true, at: 'here', where: [pred.name('Spiderling')] })))],
  }),
  unit('stargazer', 'Spells with [Flow] you play from your trash cost [2] less, to a minimum of [1].', {
    abilities: [costAbility({ grant: { types: ['spell'], keyword: 'flow' }, discount: { energy: 2, min: 1 }, while: cond.origin('trash') })],
  }),
  unit('steel-paws', '[Deflect]\n[Empower] [7]\n[Empowered][>] I have +7 [M].', { abilities: [statik(7, { while: empowered })] }),
  unit('swain-visionary', "[Vision]\nWhen I conquer, if you've played a non-token unit, a non-token gear, and a spell this turn, you score 1 point.", {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([points(1)]), { if: cond.and(cond.thisTurn('played', { types: ['unit'] }),
      cond.thisTurn('played', { types: ['gear'] }), cond.thisTurn('played', { types: ['spell'] })) })],
  }),
  unit('tail-cloaked-matriarch', '[Empower] [2][P]\nWhen I become [Empowered], you may choose a unit in your trash with Energy cost no more than [3] and Power cost no more than [A]. Play it to your base, ignoring its cost.', {
    abilities: [when({ on: 'empowered', who: 'self' }, prog([playFree(ref.slot('c'), 'all', { at: 'base' })], [slot('c', cards({ rel: 'friendly',
      where: [pred.type('unit'), pred.energyCost('<=', 3), pred.powerCost('<=', 1)] }))]), { may: true })],
  }),
  spell('temporal-breach', '[Hidden]\nBanish a unit, then its owner plays it to the same location, ignoring its cost.', {
    choose: [slot('a', unitSel())], body: [named('b', banish(ref.slot('a'))), playFree(ref.bound('b'), 'all', { by: 'owner', sameLoc: true })],
  }),
  battlefield('threshold-of-the-gray', 'When combat starts here, the attacker and defender each [Add] [1].', [
    when({ on: 'attack', who: 'you', at: 'here' }, prog([addEnergy(1)]), { controller: 'eventPlayer' }),
    when({ on: 'defend', who: 'you', at: 'here' }, prog([addEnergy(1)]), { controller: 'eventPlayer' }),
  ]),
  unit('tomb-raider-barbara', "When you play me, if you control 7 or more runes, choose an enemy gear. If it's [Empowered], disempower it. Otherwise, kill it.", {
    abilities: [onPlay(prog([iff(cond.is(ref.slot('g'), pred.empowered), [{ op: 'disempower', what: ref.slot('g') }], [kill(ref.slot('g'))])],
      [slot('g', gearSel({ rel: 'enemy' }), { harm: true })]), { if: cond.count(runeSel({ rel: 'friendly' }), '>=', 7) })],
  }),
  gear('tools-of-empire', '[Empower] [2]\n[E]: Give a unit +2 [M] this turn. If this is [Empowered], give that unit +4 [M] this turn instead.', {
    abilities: [activated({ exhaustSelf: true }, prog([iff(empowered, [might(4, ref.slot('a'))], [might(2, ref.slot('a'))])], [slot('a', unitSel())]))],
  }),
  unit('tornado-warrior', '[Hidden]\nWhen you play me from face down, you may empower something here. Disempower it at end of turn.', {
    abilities: [onPlay(prog([empower(ref.slot('a')),
      delayed(1, { on: 'phase', at: 'endOfTurn', whose: 'any' }, prog([{ op: 'disempower', what: ref.info('u') }]), { capture: { u: ref.slot('a') } })],
    [slot('a', permanentSel({ at: 'here', where: [pred.canEmpower] }))]), { may: true, if: cond.playedFrom('facedown') })],
  }),
  unit('twilight-reveler', 'When I attack, ready another friendly unit.', {
    abilities: [when({ on: 'attack', who: 'self' }, prog([ready(ref.slot('a'))], [slot('a', unitSel({ rel: 'friendly', other: true }))]))],
  }),
  spell('twilight-shroud', "Give a friendly unit +1 [M] this turn. It can't be chosen by enemy spells and abilities this turn.\n[Flow] [2]", {
    choose: [slot('a', friendly)], body: [might(1, ref.slot('a')), { op: 'protect', what: ref.slot('a') }],
  }),
  spell('twilight-step', 'Move a unit with 3 [M] or less.\n[Flow] [4][P]', {
    choose: [slot('a', unitSel({ where: [pred.might('<=', 3)] })), destSlot('d', 'a')], body: [move(ref.slot('a'), { dest: 'd' })],
  }),
  spell('up-from-the-deep', 'Play two 1 [M] Tentacle unit tokens from Bilgewater.\n[Flow] [3]', { body: [playToken('tentacle', 2, 'choose')] }),
  spell('wild-claw', 'Look at the top 5 cards of your Main Deck. You may banish a unit or gear from among them and play it, reducing its Energy cost by [5]. Recycle the rest. Then you may do this: Empower it.', {
    body: [look(5, 'l'), pickWhere('l', 1, 'u', { min: 0, where: [pred.type('unit', 'gear')] }), named('b', banish(ref.bound('u'))),
      named('p', { op: 'playCard', what: ref.bound('b'), energyLess: 5 }), recycleRest('l', 'u'),
      iff(cond.did('p'), [delayed(1, { on: 'cardPlayed', by: 'you', what: { types: ['unit', 'gear'] } },
        prog([may([empower(ref.subject)])]))])],
  }),
  unit('zed-from-the-shadows', 'You may discard 1 as an additional cost to play me.\nWhen you play me, if you paid the additional cost, play a 0 [M] Shadow Clone unit token.', {
    abilities: [costAbility({ optional: true, pay: { discard: 1 } }),
      onPlay(prog([playToken('shadowClone', 1, 'choose')]), { if: cond.paid('zed-from-the-shadows#0') })],
  }),
  legend('zed-master-of-shadows', 'When you banish a card you own, empower me.\n[Action][>] Disempower me, [E]: Discard 1, then draw 1.', [
    when({ on: 'banished', who: 'you', owned: true }, prog([empower(ref.self)])),
    activated({ disempowerSelf: true, exhaustSelf: true }, prog([discard(1), draw(1)]), { timing: 'action' }),
  ]),
  unit('zed-without-a-sound', "When I conquer, play a 0 [M] Shadow Clone unit token to your base.\n[Action][>] [1][P]: Move me and a Shadow Clone you control to each other's locations.", {
    abilities: [when({ on: 'conquer', who: 'you', at: 'here' }, prog([playToken('shadowClone', 1, 'yourBase')])),
      activated({ energy: 1, power: ['C'] }, prog([swap(ref.self, ref.slot('c'))], [slot('c', unitSel({ rel: 'friendly', where: [pred.name('Shadow Clone')] }))]),
        { timing: 'action' })],
  }),
  // ---- rulings pass (docs/CARD-RULINGS.md) ----
  // Vendetta FAQ: a copy effect of the printed (or copied) traits; status, buffs, damage, Empowered stay; chosen on each
  // attach, right after it; it ends as this is detached or leaves the board [479.1].
  gear('shady-spectacles', '[Equip] [1][Y]\nAs this is attached to a unit, choose another friendly unit. The equipped unit becomes a copy of that unit for as long as this is attached to it.', {
    abilities: [always({ s: 'copyOnAttach' })],
  }),
];
