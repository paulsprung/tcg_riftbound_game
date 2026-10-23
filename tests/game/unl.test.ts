import { describe, expect, it } from 'vitest';
import { hasKeyword, keywordOf, mightOf } from '../../src/game/rules/chars.ts';
import { setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, keys, put, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, hide, moveTo, nextTurn, onBoard, opt, RICH, table } from './helpers/cards.ts';

/*
 * The Unleashed Champion Decks (Vex, Vi): one behaviour test per card at
 * least (cards/defs/unl.ts), keyword-only cards included.
 */

const xp = (g: ReturnType<typeof table>, p: 0 | 1, n: number) => setField(g.s, g.s.players[p], 'xp', n);
const equip = (g: ReturnType<typeof table>, gear: number, unit: number) => {
  reask(g);
  act(g, `act:${gear}#kwequip`);
  drive(g, [`t:${unit}`]);
};
/** A combat at bf1 (P1 holds it with its units), P0 attacking with these units. */
function attack(g: ReturnType<typeof table>, mine: number[], answers: string[] = []) {
  moveTo(g, mine, 1);
  drive(g, answers);
}

describe('Unleashed: Vex', () => {
  it('Vex, Gloomist: when you hold, you may exhaust me to draw 1', () => {
    const g = table(301, { legends: ['vex-gloomist'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const h = handSize(g);
    nextTurn(g);
    expect(handSize(g)).toBe(h + 2);
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);    // exhausted for the draw
  });

  it('Vex, Apathetic: an opponent\'s unit played while I\'m at a battlefield is stunned and can\'t move this turn', () => {
    const g = table(302, { first: 1 });
    control(g, 0, 0);
    put(g, 'vex-apathetic', 0, bf(0));
    cast(g, 'shipyard-skulker', [], 1);
    const u = onBoard(g, 'shipyard-skulker', 1)[0];
    expect(g.s.objects[u].stunned).toBe(true);
    setField(g.s, g.s.objects[u], 'exhausted', false);
    reask(g);
    expect(keys(g)).not.toContain('move');
  });

  it('Vex, Cheerless: in combat, friendly spells cost [1][A] less (minimum [1]), enemy spells [1][A] more', () => {
    const g = table(303);
    control(g, 1, 1);
    put(g, 'mega-mech', 1, bf(1));
    const vex = put(g, 'vex-cheerless', 0, base(0));
    const mine = inHand(g, 'smoke-screen', 0);                         // [2][B]
    moveTo(g, [vex], 1);
    act(g, `play:${mine}`);
    if (g.s.pending?.kind === 'target') act(g, g.s.pending.options[0].key);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1, power: [] } });
  });

  it('Vex, Mocking: when you stun an enemy unit at a battlefield, you may move me there', () => {
    const g = table(304);
    const vex = put(g, 'vex-mocking', 0, base(0));
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    cast(g, 'back-off', [`t:${foe}`, 'yes']);
    expect(g.s.objects[vex].zone).toEqual(bf(1));
    expect([hasKeyword(g.s, vex, 'tank'), keywordOf(g.s, vex, 'shield')]).toEqual([true, 1]);
  });

  it('Monch: if an opponent controls a stunned unit, costs [2] less and enters ready', () => {
    const g = table(305);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    setField(g.s, g.s.objects[foe], 'stunned', true);
    const id = inHand(g, 'monch');
    reask(g);
    act(g, `play:${id}`);
    opt(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
    drive(g);
    expect(g.s.objects[onBoard(g, 'monch', 0)[0]].exhausted).toBe(false);
  });

  it('Existential Dread: stun an attacking enemy unit, or return it to hand if it is already stunned; Repeat [2]', () => {
    const g = table(306, { first: 1 });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const att = put(g, 'shipyard-skulker', 1, base(1));
    const dread = inHand(g, 'existential-dread', 0);
    reask(g);
    act(g, 'move');
    opt(g, `u:${att}`);
    opt(g, 'done');
    opt(g, 'loc:bf0');
    drive(g, [`play:${dread}`, 'yes', `t:${att}`, `t:${att}`]);
    expect(g.s.players[1].hand.map((x) => g.s.objects[x].def)).toContain('shipyard-skulker');   // stunned, then returned
  });

  it('Allay, Eager Admirer: Deflect; at a battlefield, your other units here have Deflect', () => {
    const g = table(307);
    control(g, 0, 0);
    const a = put(g, 'allay-eager-admirer', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    const home = put(g, 'shipyard-skulker', 0, base(0));
    expect([hasKeyword(g.s, a, 'deflect'), hasKeyword(g.s, u, 'deflect'), hasKeyword(g.s, home, 'deflect')]).toEqual([true, true, false]);
  });

  it('Back Off: stun a unit; draw 1 if played from hand (not from face down)', () => {
    const g = table(308);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    const h = handSize(g);
    cast(g, 'back-off', [`t:${foe}`]);
    expect([g.s.objects[foe].stunned, handSize(g)]).toEqual([true, h + 1]);
  });

  it('Enthusiastic Promoter: Backline; when I hold, buff all units here', () => {
    const g = table(309);
    control(g, 0, 0);
    const p = put(g, 'enthusiastic-promoter', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    nextTurn(g);
    expect([g.s.objects[p].buffs, g.s.objects[u].buffs, hasKeyword(g.s, p, 'backline')]).toEqual([1, 1, true]);
  });

  it('Trevor Snoozebottom: Shield; when I hold, a ready 3 Might Sprite with Temporary here', () => {
    const g = table(310);
    control(g, 0, 0);
    put(g, 'trevor-snoozebottom', 0, bf(0));
    nextTurn(g);
    const sp = onBoard(g, 'sprite', 0)[0];
    expect([g.s.objects[sp].zone, g.s.objects[sp].exhausted]).toEqual([bf(0), false]);
  });

  it('Blast Cone: when you play this, you may move an enemy unit; when you move an enemy unit, you may exhaust this to stun it', () => {
    const g = table(311);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    cast(g, 'blast-cone', ['yes', `t:${foe}`, 'loc:base', 'yes']);
    expect(g.s.objects[foe]).toMatchObject({ zone: base(1), stunned: true });
    expect(g.s.objects[onBoard(g, 'blast-cone', 0)[0]].exhausted).toBe(true);
  });

  it('Megatusk: spend 3 XP: your units here get Ganking this turn', () => {
    const g = table(312);
    control(g, 0, 0);
    const m = put(g, 'megatusk', 0, bf(0));
    reask(g);
    expect(keys(g)).not.toContain(`act:${m}#0`);
    xp(g, 0, 3);
    reask(g);
    act(g, `act:${m}#0`);
    drive(g);
    expect([hasKeyword(g.s, m, 'ganking'), g.s.players[0].xp]).toEqual([true, 0]);
  });

  it('Evelynn, Entrancing: Hidden, Backline; played from face down on your turn, may pull an enemy unit to my battlefield', () => {
    const g = table(313);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const fd = hide(g, 'evelynn-entrancing', 0);
    nextTurn(g);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    reask(g);
    act(g, `play:${fd}`);
    drive(g, ['yes', `t:${foe}`]);
    expect(evs(g, 'move').some((e) => e.objs.includes(foe) && e.to.z === 'bf' && e.to.bf === 0)).toBe(true);
  });

  it('Nami, Headstrong: may pay [G] more to stun an enemy unit; when I hold, the next unit you play enters ready and buffed', () => {
    const g = table(314);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'nami-headstrong', ['yes', `t:${foe}`]);
    expect(g.s.objects[foe].stunned).toBe(true);
    const nami = onBoard(g, 'nami-headstrong', 0)[0];
    control(g, 0, 0);
    setField(g.s, g.s.objects[nami], 'zone', bf(0));
    g.s.players[0].base.splice(g.s.players[0].base.indexOf(nami), 1);
    g.s.bfs[0].here.push(nami);
    nextTurn(g);
    cast(g, 'shipyard-skulker');
    const u = onBoard(g, 'shipyard-skulker', 0)[0];
    expect([g.s.objects[u].exhausted, g.s.objects[u].buffs]).toEqual([false, 1]);
  });

  it('Iascylla: when I hold, at the start of your next Main Phase, you may move an enemy unit to this battlefield', () => {
    const g = table(315);
    control(g, 0, 0);
    put(g, 'iascylla', 0, bf(0));
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    reask(g);
    act(g, 'end');
    drive(g);
    act(g, 'end');
    drive(g, ['yes', `t:${foe}`]);
    expect(evs(g, 'move').some((e) => e.objs.includes(foe) && e.to.z === 'bf' && e.to.bf === 0)).toBe(true);
  });

  it('Shadow: enters ready if played to a battlefield; [Action] [1][A], [E]: stun an enemy unit attacking here', () => {
    const g = table(316);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'shadow', ['loc:bf0']);
    const sh = onBoard(g, 'shadow', 0)[0];
    expect(g.s.objects[sh].exhausted).toBe(false);
  });

  it('Scryer\'s Bloom: enters exhausted; kill this, [1], [E]: Predict 2, then draw 1, gain 1 XP', () => {
    const g = table(317);
    cast(g, 'scryers-bloom');
    const b = onBoard(g, 'scryers-bloom', 0)[0];
    expect(g.s.objects[b].exhausted).toBe(true);
    nextTurn(g);
    const h = handSize(g);
    reask(g);
    act(g, `act:${b}#1`);
    drive(g);
    expect([g.s.objects[b], handSize(g), g.s.players[0].xp]).toEqual([undefined, h + 1, 1]);
  });

  it('Soul Sword: Equip [G], +1; Level 3: +1 more', () => {
    const g = table(318);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const sw = put(g, 'soul-sword', 0, base(0));
    equip(g, sw, u);
    expect(mightOf(g.s, u)).toBe(4);
    xp(g, 0, 3);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Mister Root: Accelerate; when I move to a battlefield, gain 2 XP', () => {
    const g = table(319);
    const m = put(g, 'mister-root', 0, base(0));
    moveTo(g, [m], 0);
    drive(g);
    expect(g.s.players[0].xp).toBe(2);
  });

  it('Skyward Strike: move an enemy unit; Level 6: stun an enemy unit', () => {
    const g = table(320);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    const other = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'skyward-strike', [`t:${foe}`, 'loc:base']);
    expect(g.s.objects[foe].zone).toEqual(base(1));
    expect(g.s.objects[other].stunned).toBe(false);
    xp(g, 0, 6);
    cast(g, 'skyward-strike', [`t:${foe}`, 'loc:bf0', `t:${other}`]);
    expect(g.s.objects[other].stunned).toBe(true);
  });

  it('Combat Experience: +1 this turn; Level 6: +3 instead', () => {
    const g = table(321);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'combat-experience', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(4);
    xp(g, 0, 6);
    cast(g, 'combat-experience', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(7);
  });

  it('Herald of Spring: Hunt; when you play me, gain 2 XP; Hunt gains XP when it conquers', () => {
    const g = table(322);
    cast(g, 'herald-of-spring');
    expect(g.s.players[0].xp).toBe(2);
    const h = onBoard(g, 'herald-of-spring', 0)[0];
    setField(g.s, g.s.objects[h], 'exhausted', false);
    moveTo(g, [h], 0);
    drive(g);
    expect(g.s.players[0].xp).toBe(3);                                 // Hunt [823]
  });

  it('Wuju Apprentice: Hunt; Level 6: when you play me, draw 1', () => {
    const g = table(323);
    const h = handSize(g);
    cast(g, 'wuju-apprentice');
    expect(handSize(g)).toBe(h);
    xp(g, 0, 6);
    cast(g, 'wuju-apprentice');
    expect(handSize(g)).toBe(h + 1);
  });

  it('Mosstomper: Hunt 2; Level 3: +1 and Deflect', () => {
    const g = table(324);
    const m = put(g, 'mosstomper', 0, base(0));
    expect([mightOf(g.s, m), hasKeyword(g.s, m, 'deflect')]).toEqual([3, false]);
    xp(g, 0, 3);
    expect([mightOf(g.s, m), hasKeyword(g.s, m, 'deflect')]).toEqual([4, true]);
    moveTo(g, [m], 0);
    drive(g);
    expect(g.s.players[0].xp).toBe(5);
  });

  it('Amateur Recital: when you hold here, you may move a unit at a battlefield to its base', () => {
    const g = table(325, { bfs: ['amateur-recital'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    nextTurn(g);
    void foe;
    expect(evs(g, 'move').some((e) => e.to.z === 'base')).toBe(true);
  });

  it('Gardens of Becoming: units here have "[E]: Gain 1 XP."', () => {
    const g = table(326, { bfs: ['gardens-of-becoming'] });
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    reask(g);
    act(g, `act:${u}#g0`);
    drive(g);
    expect([g.s.players[0].xp, g.s.objects[u].exhausted]).toEqual([1, true]);
  });

  it('Ripper\'s Bay: when a unit here is returned to a hand, its player may pay [1] to channel 1 rune exhausted', () => {
    const g = table(327, { bfs: [undefined, 'rippers-bay'] });
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    const n = g.s.players[1].base.length;
    cast(g, 'gust', [`t:${foe}`]);
    expect(g.s.players[1].base.length).toBe(n + 1);                    // a rune
    expect(evs(g, 'channel').some((e) => e.p === 1)).toBe(true);
  });
});

describe('Unleashed: Vi', () => {
  it('Vi, Piltover Enforcer: conquering after 3+ excess damage, may exhaust me to ready a unit', () => {
    const g = table(330, { legends: ['vi-piltover-enforcer'] });
    control(g, 1, 1);
    put(g, 'recruit', 1, bf(1));
    const big = put(g, 'mega-mech', 0, base(0));
    attack(g, [big], ['yes', `t:${big}`]);
    expect(g.s.combat).toBeNull();
    expect(g.s.objects[big].exhausted).toBe(false);
  });

  it('Serrated Dirk: Equip [R], +0; the equipped unit has Assault 2', () => {
    const g = table(331);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const d = put(g, 'serrated-dirk', 0, base(0));
    equip(g, d, u);
    expect([mightOf(g.s, u), keywordOf(g.s, u, 'assault')]).toEqual([3, 2]);
  });

  it('Arena Kingpin: I enter ready; [E]: a unit +3 this turn', () => {
    const g = table(332);
    cast(g, 'arena-kingpin');
    const k = onBoard(g, 'arena-kingpin', 0)[0];
    expect(g.s.objects[k].exhausted).toBe(false);
    reask(g);
    act(g, `act:${k}#1`);
    drive(g, [`t:${k}`]);
    expect(mightOf(g.s, k)).toBe(6);
  });

  it('Towering Pairofant: Assault; if a unit died this turn, I enter ready', () => {
    const g = table(333);
    cast(g, 'towering-pairofant');
    expect(g.s.objects[onBoard(g, 'towering-pairofant', 0)[0]].exhausted).toBe(true);
    const foe = put(g, 'shipyard-skulker', 1, base(1));
    runes(g, 0, RICH);
    cast(g, 'vengeance', [`t:${foe}`]);
    cast(g, 'towering-pairofant');
    expect(onBoard(g, 'towering-pairofant', 0).filter((u) => !g.s.objects[u].exhausted)).toHaveLength(1);
  });

  it('Upstage Comedy: ready a unit; Repeat [2]', () => {
    const g = table(334);
    const a = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const b = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'upstage-comedy', ['yes', `t:${a}`, `t:${b}`]);
    expect([g.s.objects[a].exhausted, g.s.objects[b].exhausted]).toEqual([false, false]);
  });

  it('Vault Breaker: a unit gets Assault 2 and Ganking this turn', () => {
    const g = table(335);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'vault-breaker', [`t:${u}`]);
    expect([keywordOf(g.s, u, 'assault'), hasKeyword(g.s, u, 'ganking')]).toEqual([2, true]);
  });

  it('Lord Broadmane: Ambush (a Reaction to a battlefield where you have units); your other units here get Assault', () => {
    const g = table(336, { first: 1 });
    control(g, 0, 0);
    const mine = put(g, 'mega-mech', 0, bf(0));
    const att = put(g, 'shipyard-skulker', 1, base(1));
    const lord = inHand(g, 'lord-broadmane', 0);
    reask(g);
    act(g, 'move');
    opt(g, `u:${att}`);
    opt(g, 'done');
    opt(g, 'loc:bf0');
    drive(g, [`play:${lord}`, 'loc:bf0']);
    expect(onBoard(g, 'lord-broadmane', 0).map((u) => g.s.objects[u].zone)).toEqual([bf(0)]);
    expect(keywordOf(g.s, mine, 'assault')).toBe(1);
  });

  it('Right of Conquest: draw 1, then 1 for each battlefield you control', () => {
    const g = table(337);
    control(g, 0, 0);
    control(g, 1, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    put(g, 'shipyard-skulker', 0, bf(1));
    const h = handSize(g);
    cast(g, 'right-of-conquest');
    expect(handSize(g)).toBe(h + 3);
  });

  it('Square Up: a unit gets Assault 4 this turn; Repeat by discarding 1', () => {
    const g = table(338);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'square-up', ['yes', `t:${u}`, `t:${u}`]);
    expect(keywordOf(g.s, u, 'assault')).toBe(8);
    expect(evs(g, 'discard')).toHaveLength(1);
  });

  it('Yeti Brawler: conquering after 3+ excess damage, two Gold tokens', () => {
    const g = table(339);
    control(g, 1, 1);
    put(g, 'recruit', 1, bf(1));
    const y = put(g, 'yeti-brawler', 0, base(0));
    attack(g, [y]);
    expect(onBoard(g, 'gold', 0)).toHaveLength(2);
  });

  it('Xerath, Freed: [R], [E]: deal 3 to a unit, only while I\'m at a battlefield', () => {
    const g = table(340);
    const x = put(g, 'xerath-freed', 0, base(0));
    reask(g);
    expect(keys(g)).not.toContain(`act:${x}#0`);
    control(g, 0, 0);
    const x2 = put(g, 'xerath-freed', 0, bf(0));
    const foe = put(g, 'mega-mech', 1, base(1));
    reask(g);
    act(g, `act:${x2}#0`);
    drive(g, [`t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(3);
  });

  it('Vi, Hotheaded: Deflect; [2][R]: double my Might this turn', () => {
    const g = table(341);
    const vi = put(g, 'vi-hotheaded', 0, base(0));
    reask(g);
    act(g, `act:${vi}#0`);
    drive(g);
    expect(mightOf(g.s, vi)).toBe(6);
  });

  it('Carrion Dredger: Deathknell: a Bird with Deflect to your base', () => {
    const g = table(342);
    const c = put(g, 'carrion-dredger', 0, base(0));
    cast(g, 'vengeance', [`t:${c}`]);
    expect(onBoard(g, 'bird', 0)).toHaveLength(1);
  });

  it('Crimson Pigeons: +2 while attacking with another unit', () => {
    const g = table(343);
    control(g, 1, 1);
    put(g, 'mega-mech', 1, bf(1));
    const p = put(g, 'crimson-pigeons', 0, base(0));
    const q = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [p, q], 1);
    expect(mightOf(g.s, p)).toBe(5);
  });

  it('Loyal Poro: Deathknell: if I didn\'t die alone, draw 1', () => {
    const g = table(344);
    const a = put(g, 'loyal-poro', 0, base(0));
    const h = handSize(g);
    cast(g, 'vengeance', [`t:${a}`]);
    expect(handSize(g)).toBe(h);
    const b = put(g, 'loyal-poro', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    runes(g, 0, RICH);
    cast(g, 'vengeance', [`t:${b}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Soul Harvest: kill a unit at a battlefield with 3 Might or less', () => {
    const g = table(345);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    cast(g, 'soul-harvest', [`t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
  });

  it('Divining Shells: Vision; [Action] kill this, [E]: a unit +2 this turn', () => {
    const g = table(346);
    cast(g, 'divining-shells');
    expect(evs(g, 'look').length).toBeGreaterThan(0);
    const d = onBoard(g, 'divining-shells', 0)[0];
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${d}#0`);
    drive(g, [`t:${u}`]);
    expect([g.s.objects[d], mightOf(g.s, u)]).toEqual([undefined, 5]);
  });

  it('Mageseeker Investigator: opponents pay [A] per unit beyond the first to move several units to my battlefield at once', () => {
    const g = table(347);
    control(g, 1, 1);
    put(g, 'mageseeker-investigator', 1, bf(1));
    const a = put(g, 'shipyard-skulker', 0, base(0));
    const b = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [a, b], 1);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 0, power: ['any'] } });
  });

  it('Tactical Retreat: the next time it would die this turn, heal, exhaust and recall it instead', () => {
    const g = table(348);
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'tactical-retreat', [`t:${u}`]);
    cast(g, 'vengeance', [`t:${u}`]);
    expect(g.s.objects[u]).toMatchObject({ zone: base(0), exhausted: true });
  });

  it('Vi, Peacekeeper: Ambush; when I attack, stun an enemy unit here', () => {
    const g = table(349);
    control(g, 1, 1);
    const foe = put(g, 'shipyard-skulker', 1, bf(1));
    const vi = put(g, 'vi-peacekeeper', 0, base(0));
    attack(g, [vi]);
    expect(evs(g, 'stun').some((e) => e.objs.includes(foe))).toBe(true);
  });

  it('Hextech Gauntlets: Equip [3][A] less the chosen unit\'s Might; equipped: conquering after 3+ excess, draw 1', () => {
    const g = table(350);
    const u = put(g, 'mega-mech', 0, base(0));
    const hg = put(g, 'hextech-gauntlets', 0, base(0));
    reask(g);
    act(g, `act:${hg}#kwequip`);
    opt(g, `t:${u}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 0, power: ['any'] } });
    drive(g);
    control(g, 1, 1);
    put(g, 'recruit', 1, bf(1));
    const h = handSize(g);
    attack(g, [u]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Star Spring: the first time a player plays a non-token unit here each turn, they may move another of their units here to base', () => {
    const g = table(351, { bfs: ['star-spring'] });
    control(g, 0, 0);
    const old = put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'shipyard-skulker', ['loc:bf0', 'yes', `t:${old}`]);
    expect(g.s.objects[old].zone).toEqual(base(0));
  });

  it('Trapping Grounds: conquering here after 3+ excess damage, a Bird token', () => {
    const g = table(352, { bfs: [undefined, 'trapping-grounds'] });
    control(g, 1, 1);
    put(g, 'recruit', 1, bf(1));
    const big = put(g, 'mega-mech', 0, base(0));
    attack(g, [big]);
    expect(onBoard(g, 'bird', 0)).toHaveLength(1);
  });

  it('Inferna (Ambush, Assault 2), Sharkling (Accelerate, Assault 4), Rengar (Ganking, Deflect), Mutated Mouser (Shield 2, Tank)', () => {
    const g = table(353);
    cast(g, 'sharkling', ['yes']);
    const sh = onBoard(g, 'sharkling', 0)[0];
    expect([g.s.objects[sh].exhausted, keywordOf(g.s, sh, 'assault')]).toEqual([false, 4]);
    const r = put(g, 'rengar-unseen', 0, base(0));
    const m = put(g, 'mutated-mouser', 0, base(0));
    expect([hasKeyword(g.s, r, 'ganking'), hasKeyword(g.s, r, 'deflect'), keywordOf(g.s, m, 'shield'), hasKeyword(g.s, m, 'tank')])
      .toEqual([true, true, 2, true]);
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const inf = inHand(g, 'inferna');
    reask(g);
    act(g, `play:${inf}`);
    expect(keys(g)).toContain('loc:bf0');
  });
});
