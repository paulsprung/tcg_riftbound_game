import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, reask, runes, ready } from './helpers/scenario.ts';
import { cast, drive, handSize, moveTo, nextTurn, onBoard, opt, RICH, table } from './helpers/cards.ts';

/*
 * The Spiritforged Champion Decks (Fiora, Rumble): one behaviour test per
 * card at least (cards/defs/sfd.ts), Equipment included.
 */

const equip = (g: ReturnType<typeof table>, gear: number, unit: number) => {
  reask(g);
  act(g, `act:${gear}#kwequip`);
  drive(g, [`t:${unit}`]);
};

describe('Spiritforged: Fiora', () => {
  it('Fiora, Grand Duelist: when one of your units becomes Mighty, you may exhaust me to channel 1 rune exhausted', () => {
    const g = table(201, { legends: ['fiora-grand-duelist'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'punch-first', [`t:${u}`]);
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);
    expect(evs(g, 'channel').filter((e) => e.rule === '431')).toHaveLength(1);
  });

  it('Vengeance: kill a unit', () => {
    const g = table(202);
    const foe = put(g, 'mega-mech', 1, base(1));
    cast(g, 'vengeance', [`t:${foe}`]);
    expect(g.s.objects[foe]).toBeUndefined();
  });

  it('Dauntless Vanguard: may be played to an occupied enemy battlefield', () => {
    const g = table(203);
    control(g, 1, 1);
    put(g, 'shipyard-skulker', 1, bf(1));
    const id = inHand(g, 'dauntless-vanguard');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf1');
    expect(keys(g)).not.toContain('loc:bf0');                          // open, but not enemy
    drive(g, ['loc:bf1']);
    expect(g.s.combat ?? g.s.bfs[1].controller).not.toBeNull();
  });

  it('Punch First: +5 this turn', () => {
    const g = table(204);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'punch-first', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(8);
  });

  it('Jaull-fish: costs [2] less for each of your Mighty units; Accelerate', () => {
    const g = table(205);
    put(g, 'mega-mech', 0, base(0));
    put(g, 'mega-mech', 0, base(0));
    const id = inHand(g, 'jaull-fish');
    reask(g);
    act(g, `play:${id}`);
    opt(g, 'no');                                                      // no Accelerate
    opt(g, 'loc:base');
    expect(g.s.pending, JSON.stringify(g.s.pending)).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Show of Strength: draw 1 for each of your Mighty units', () => {
    const g = table(206);
    put(g, 'mega-mech', 0, base(0));
    put(g, 'mega-mech', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g);
    cast(g, 'show-of-strength');
    expect(handSize(g)).toBe(h + 2);
  });

  it('Strike Down: an equipped friendly unit deals its Might to an enemy unit, then an Equipment detaches', () => {
    const g = table(207);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const sword = put(g, 'b-f-sword', 0, base(0));
    equip(g, sword, u);
    expect(g.s.objects[sword].attachedTo).toBe(u);
    expect(mightOf(g.s, u)).toBe(6);                                   // Might Bonus +3 [137.3]
    const foe = put(g, 'mega-mech', 1, base(1));
    cast(g, 'strike-down', [`t:${u}`, `t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(6);
    expect(g.s.objects[sword].attachedTo).toBeNull();
  });

  it('Warmog\'s Armor: Equip [O], +1; the equipped unit: "When I conquer, buff me."', () => {
    const g = table(208);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const arm = put(g, 'warmogs-armor', 0, base(0));
    equip(g, arm, u);
    expect(mightOf(g.s, u)).toBe(4);
    moveTo(g, [u], 0);
    drive(g);
    expect(g.s.objects[u].buffs).toBe(1);
    expect(g.s.objects[arm].zone).toEqual(bf(0));                      // it went along [719.3]
  });

  it('B.F. Sword and Doran\'s Blade: Equip, Might Bonus; an Equipment stays when its unit dies, then goes home', () => {
    const g = table(209);
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    const blade = put(g, 'dorans-blade', 0, base(0));
    equip(g, blade, u);
    expect([mightOf(g.s, u), g.s.objects[blade].zone]).toEqual([5, bf(0)]);
    cast(g, 'vengeance', [`t:${u}`]);
    expect(g.s.objects[blade]).toMatchObject({ attachedTo: null, zone: base(0) });   // detached, recalled [719.5], [459.1]
  });

  it('Fiora, Peerless: attacking one on one doubles her Might this combat', () => {
    const g = table(210);
    control(g, 1, 1);
    put(g, 'shipyard-skulker', 1, bf(1));
    const f = put(g, 'fiora-peerless', 0, base(0));
    moveTo(g, [f], 1);
    drive(g);
    expect(g.s.objects[f]).toBeDefined();                              // 6 beats 3
    expect(g.s.bfs[1].controller).toBe(0);
    expect(mightOf(g.s, f)).toBe(3);                                   // this combat only
  });

  it('Lucian, Merciless: Weaponmaster; the first time I conquer each turn, ready me', () => {
    const g = table(211);
    const sword = put(g, 'long-sword', 0, base(0));
    cast(g, 'lucian-merciless', ['yes', `t:${sword}`]);
    const l = onBoard(g, 'lucian-merciless', 0)[0];
    expect(g.s.objects[sword].attachedTo).toBe(l);                     // Equip [R] less [A]: free [821.1.c]
    setField(g.s, g.s.objects[l], 'exhausted', false);
    moveTo(g, [l], 0);
    drive(g);
    expect(g.s.objects[l].exhausted).toBe(false);
  });

  it('Yone, Blademaster: conquering an uncontrolled battlefield, deal my Might to an enemy unit in a base', () => {
    const g = table(212);
    const foe = put(g, 'mega-mech', 1, base(1));
    const y = put(g, 'yone-blademaster', 0, base(0));
    moveTo(g, [y], 0);
    drive(g, [`t:${foe}`]);
    expect(g.s.objects[foe].damage[0].amount).toBe(5);
  });

  it('Royal Guard: when you play me, a 2 Might Sand Soldier here', () => {
    const g = table(213);
    cast(g, 'royal-guard');
    const ss = onBoard(g, 'sandSoldier', 0);
    expect(ss.map((u) => mightOf(g.s, u))).toEqual([2]);
  });

  it('Unsung Hero: Deathknell: if I was Mighty, draw 2', () => {
    const g = table(214);
    const a = put(g, 'unsung-hero', 0, base(0));
    const b = put(g, 'unsung-hero', 0, base(0));
    const h = handSize(g);
    cast(g, 'vengeance', [`t:${a}`]);
    expect(handSize(g)).toBe(h);
    runes(g, 0, RICH);
    cast(g, 'punch-first', [`t:${b}`]);
    cast(g, 'vengeance', [`t:${b}`]);
    expect(handSize(g)).toBe(h + 2);
  });

  it('Sacred Shears: Equip [Y]; the equipped unit: "Deathknell: Draw 1."', () => {
    const g = table(215);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const sh = put(g, 'sacred-shears', 0, base(0));
    equip(g, sh, u);
    runes(g, 0, RICH);
    const h = handSize(g);
    cast(g, 'vengeance', [`t:${u}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Fiora, Worthy: when a unit you control becomes Mighty, you may pay [Y] to ready it', () => {
    const g = table(216);
    put(g, 'fiora-worthy', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'punch-first', [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Riposte: counter a spell and give a friendly unit +Might equal to its Energy cost', () => {
    const g = table(217, { first: 1 });
    const mine = put(g, 'shipyard-skulker', 0, base(0));
    const foe = put(g, 'mega-mech', 1, base(1));
    void foe;
    const vg = inHand(g, 'vengeance', 1);
    const rip = inHand(g, 'riposte', 0);
    reask(g);
    act(g, `play:${vg}`);
    act(g, `t:${mine}`);
    drive(g, [`play:${rip}`, `t:${mine}`]);
    expect(g.s.objects[mine]).toBeDefined();
    expect(mightOf(g.s, mine)).toBe(7);                                // +4
    expect(g.s.players[1].trash.map((x) => g.s.objects[x].def)).toContain('vengeance');
  });

  it('Ornn\'s Forge: the first friendly non-token gear played each turn costs [1] less', () => {
    const g = table(218, { bfs: ['ornns-forge'] });
    control(g, 0, 0);
    put(g, 'shipyard-skulker', 0, bf(0));
    const a = inHand(g, 'b-f-sword');
    reask(g);
    act(g, `play:${a}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
    drive(g);
    const b = inHand(g, 'b-f-sword');
    reask(g);
    act(g, `play:${b}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
  });

  it('Sunken Temple: conquering here with a Mighty unit, you may pay [1] to draw 1', () => {
    const g = table(219, { bfs: ['sunken-temple'] });
    const u = put(g, 'mega-mech', 0, base(0));
    const h = handSize(g);
    moveTo(g, [u], 0);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Veiled Temple: when you conquer here, may ready a friendly gear; an Equipment may be detached', () => {
    const g = table(220, { bfs: ['veiled-temple'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const sw = put(g, 'b-f-sword', 0, base(0));
    equip(g, sw, u);
    setField(g.s, g.s.objects[sw], 'exhausted', true);
    moveTo(g, [u], 0);
    drive(g, ['yes', `t:${sw}`, 'yes']);
    expect(g.s.objects[sw]).toMatchObject({ exhausted: false, attachedTo: null });
  });
});

describe('Spiritforged: Rumble', () => {
  it('Rumble, Mechanized Menace: your Mechs have Shield', () => {
    const g = table(230, { legends: ['rumble-mechanized-menace'] });
    const m = put(g, 'mech', 0, base(0));
    const s = put(g, 'shipyard-skulker', 0, base(0));
    expect([hasKeyword(g.s, m, 'shield'), hasKeyword(g.s, s, 'shield')]).toEqual([true, false]);
  });

  it('Dangerous Duo: Legion: when you play me, a unit +2 this turn', () => {
    const g = table(231);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'dangerous-duo');
    expect(mightOf(g.s, u)).toBe(3);                                   // no other card played yet
    cast(g, 'dangerous-duo', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Gem Jammer: when you play me, give a unit Ganking this turn', () => {
    const g = table(232);
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    cast(g, 'gem-jammer', [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it('Assembly Rig: [1][R], recycle a unit from your trash, [E]: a Mech to your base', () => {
    const g = table(233);
    const rig = put(g, 'assembly-rig', 0, base(0));
    inTrash(g, 'shipyard-skulker');
    reask(g);
    act(g, `act:${rig}#0`);
    drive(g);
    expect(onBoard(g, 'mech', 0)).toHaveLength(1);
    expect(g.s.players[0].trash).toHaveLength(0);
  });

  it('Ferrous Forerunner: Deathknell: two Mechs to your base', () => {
    const g = table(234);
    const f = put(g, 'ferrous-forerunner', 0, base(0));
    cast(g, 'vengeance', [`t:${f}`]);
    expect(onBoard(g, 'mech', 0)).toHaveLength(2);
  });

  it('Rumble, Hotheaded: Mechs have Assault; on conquer, recycle a unit to play a Mech from the trash for less', () => {
    const g = table(235);
    const r = put(g, 'rumble-hotheaded', 0, base(0));
    const fodder = put(g, 'mega-mech', 0, base(0));
    const card = inTrash(g, 'breakneck-mech');
    setField(g.s, g.s.objects[r], 'designation', 'attacker');
    expect(mightOf(g.s, r)).toBe(5);
    setField(g.s, g.s.objects[r], 'designation', null);
    moveTo(g, [r], 0);
    drive(g, ['yes', `t:${fodder}`, `t:${card}`]);
    expect(onBoard(g, 'breakneck-mech', 0)).toHaveLength(1);
    expect(g.s.objects[fodder]).toBeUndefined();
  });

  it('Bubble Bot: when you play me, ready another friendly Mech', () => {
    const g = table(236);
    const m = put(g, 'mech', 0, base(0), { exhausted: true });
    cast(g, 'bubble-bot', [`t:${m}`]);
    expect(g.s.objects[m].exhausted).toBe(false);
  });

  it('Forecaster: your Mechs have Vision (Predict when played)', () => {
    const g = table(237);
    put(g, 'forecaster', 0, base(0));
    cast(g, 'production-surge');
    expect(evs(g, 'look').length).toBeGreaterThan(0);
  });

  it('Frigid Touch: -2 this turn; Repeat [2]', () => {
    const g = table(238);
    const a = put(g, 'mega-mech', 1, base(1));
    const b = put(g, 'mega-mech', 1, base(1));
    cast(g, 'frigid-touch', ['yes', `t:${a}`, `t:${b}`]);
    expect([mightOf(g.s, a), mightOf(g.s, b)]).toEqual([6, 6]);
  });

  it('Plundering Poro: when I conquer, a Gold token exhausted; Gold pays [A]', () => {
    const g = table(239);
    const p = put(g, 'plundering-poro', 0, base(0));
    moveTo(g, [p], 0);
    drive(g);
    const gold = onBoard(g, 'gold', 0);
    expect(gold.map((x) => g.s.objects[x].exhausted)).toEqual([true]);
  });

  it('Wages of Pain: deal 3 to a unit at a battlefield; a Gold token', () => {
    const g = table(240);
    control(g, 1, 1);
    const foe = put(g, 'mega-mech', 1, bf(1));
    cast(g, 'wages-of-pain', [`t:${foe}`]);
    expect([g.s.objects[foe].damage[0].amount, onBoard(g, 'gold', 0).length]).toEqual([3, 1]);
  });

  it('Breakneck Mech: Mechs have Deflect and Ganking; enters ready if you control another Mech', () => {
    const g = table(241);
    const m = put(g, 'mech', 0, base(0));
    cast(g, 'breakneck-mech');
    const b = onBoard(g, 'breakneck-mech', 0)[0];
    expect([hasKeyword(g.s, m, 'deflect'), hasKeyword(g.s, m, 'ganking'), g.s.objects[b].exhausted]).toEqual([true, true, false]);
  });

  it('Production Surge: [2] less if you control a Mech; a Mech to your base; draw 1', () => {
    const g = table(242);
    const id = inHand(g, 'production-surge');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
    drive(g);
    expect(onBoard(g, 'mech', 0)).toHaveLength(1);
    const id2 = inHand(g, 'production-surge');
    reask(g);
    act(g, `play:${id2}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Rumble, Scrapper: Mechs +1; when I hold, a Mech to your base', () => {
    const g = table(243);
    control(g, 0, 0);
    const r = put(g, 'rumble-scrapper', 0, bf(0));
    expect(mightOf(g.s, r)).toBe(5);
    nextTurn(g);
    expect(onBoard(g, 'mech', 0).map((x) => mightOf(g.s, x))).toEqual([4]);
  });

  it('Danger Zone: your Mechs +1 this turn; Repeat [1][A]', () => {
    const g = table(244);
    const m = put(g, 'mech', 0, base(0));
    cast(g, 'danger-zone', ['yes']);
    expect(mightOf(g.s, m)).toBe(5);
  });

  it('Minefield: when you conquer here, put the top 2 cards of your Main Deck into your trash', () => {
    const g = table(245, { bfs: ['minefield'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(g.s.players[0].trash).toHaveLength(2);
  });

  it('Ravenbloom Conservatory: defending here, reveal the top card: a spell to hand, else recycle it', () => {
    const g = table(246, { bfs: [undefined, 'ravenbloom-conservatory'] });
    control(g, 1, 1);
    put(g, 'mega-mech', 1, bf(1));
    const top = g.s.players[1].deck[0];
    const isSpell = g.s.objects[top].def === 'encore' || ['supernova', 'burn-away', 'high-note', 'moonlight-affliction', 'fanfare',
      'raucous-anthem', 'rousing-display', 'for-demacia'].includes(g.s.objects[top].def);
    const att = put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g, 1);
    moveTo(g, [att], 1);
    drive(g);
    expect(evs(g, 'reveal')).toHaveLength(1);
    expect(handSize(g, 1)).toBe(h + (isSpell ? 1 : 0));
  });

  it('Treasure Hoard: when you conquer here, you may pay [1] for a Gold token', () => {
    const g = table(247, { bfs: ['treasure-hoard'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(onBoard(g, 'gold', 0)).toHaveLength(1);
  });

  it('Long Sword: Quick-Draw (a Reaction; attach to a unit you control as it is played), Equip [R], +2', () => {
    const g = table(248);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'long-sword', [`t:${u}`]);
    const sw = onBoard(g, 'long-sword', 0)[0];
    expect([g.s.objects[sw].attachedTo, mightOf(g.s, u)]).toEqual([u, 5]);
  });

  it('Gold: kill this, [E]: add [A]; payment plans use it for Power', () => {
    const g = table(249);
    runes(g, 0, ready('order', 2));
    const gold = put(g, 'gold', 0, base(0));
    const id = inHand(g, 'long-sword');                                // [2][R]: the Power from Gold
    reask(g);
    expect(keys(g)).toContain(`play:${id}`);
    act(g, `play:${id}`);
    drive(g);
    expect(g.s.objects[gold]).toBeUndefined();                         // killed for its [A] [187.5]
    expect(onBoard(g, 'long-sword', 0)).toHaveLength(1);
  });
});
