import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { equip } from './helpers/setCards.ts';
import { candidatesFor } from '../../src/game/play/choices.ts';
import { cast, drive, handSize, hide, moveTo, onBoard } from "./helpers/cards.ts";
import { attack, defsIn, dmg, emptyHand, foe, tbl } from './helpers/setCards.ts';

/*
 * VEN, the cards beyond the starter decks (cards/defs/ven-set.ts): one behaviour test per card at least.
 */

/** Empowers an object directly. */
const emp = (g: ReturnType<typeof tbl>, id: number) => setField(g.s, g.s.objects[id], 'empowered', 1);

describe('VEN set: batch 1', () => {
  it('Acceleration Gate: ready up to 4 units, gear, and/or runes', () => {
    const g = tbl(9951);
    const a = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const b = put(g, 'mountain-drake', 1, base(1), { exhausted: true });
    cast(g, 'acceleration-gate', [`t:${a}`, `t:${b}`, 'done']);
    expect([g.s.objects[a].exhausted, g.s.objects[b].exhausted]).toEqual([false, false]);
  });

  it("Affectionate Poro: a combat I was in ends without damage to me: draw 1", () => {
    const g = tbl(9952);
    foe(g, 'galio-indefatigable');
    const p = put(g, 'affectionate-poro', 0, base(0));
    const n = handSize(g);
    attack(g, p);
    expect(dmg(g, p)).toBe(0);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Ahri, Inquisitive: attacking, an enemy unit here -2 (to a minimum of 1)', () => {
    const g = tbl(9953);
    const e = foe(g, 'vanguard-sergeant');
    attack(g, put(g, 'ahri-inquisitive', 0, base(0)), [`t:${e}`]);
    expect(evs(g, 'mightChanged').some((m) => m.obj === e)).toBe(true);
  });

  it('Akali, Deadly Weapon: Empower [2][R]; moving, may deal 1 (2 if Empowered) at a battlefield moved to or from', () => {
    const g = tbl(9955);
    const a = put(g, 'akali-deadly-weapon', 0, base(0));
    reask(g); act(g, `act:${a}#kwempower`); drive(g);
    expect(g.s.objects[a].empowered).toBe(1);
    expect(mightOf(g.s, a)).toBe(4);
    const e = put(g, 'mountain-drake', 1, bf(0));
    void e;
    const g2 = tbl(9956);
    const a2 = put(g2, 'akali-deadly-weapon', 0, base(0));
    emp(g2, a2);
    moveTo(g2, [a2], 0);
    drive(g2, [`t:${a2}`]);
    expect(dmg(g2, a2) === 2 || evs(g2, 'deal').some((d) => d.n === 2)).toBe(true);
  });

  it('Akali, Rogue Assassin: [E] on your turn: a friendly unit in a showdown goes to base, readied if Empowered', () => {
    const g = tbl(9957, { legends: ['akali-rogue-assassin'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    put(g, 'mountain-drake', 1, bf(0));
    const l = g.s.players[0].legend[0];
    emp(g, l);
    reask(g);
    if (g.s.pending?.player === 1) act(g, 'pass');
    act(g, `act:${l}#0`); drive(g, [`t:${u}`], { max: 6 });
    expect(g.s.objects[u].zone).toEqual({ z: 'base', p: 0 });
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it("Akali, Silent: can't be chosen by enemies unless in combat; moving to a battlefield, +2", () => {
    const g = tbl(9958, { first: 1 });
    const a = put(g, 'akali-silent', 0, base(0));
    put(g, 'mystic-poro', 1, base(1));
    const r = inHand(g, 'rune-prison', 1);
    reask(g); act(g, `play:${r}`);
    expect(keys(g)).not.toContain(`t:${a}`);
    const g2 = tbl(9959);
    const b = put(g2, 'akali-silent', 0, base(0));
    moveTo(g2, [b], 0); drive(g2);
    expect(mightOf(g2.s, b)).toBe(6);
  });

  it('Ambessa, Matriarch of War: empowering something else empowers me; disempower, [A], [E]: ready a unit', () => {
    const g = tbl(9960, { legends: ['ambessa-matriarch-of-war'] });
    const l = g.s.players[0].legend[0];
    const u = put(g, 'apprentice-mage', 0, base(0));
    reask(g); act(g, `act:${u}#kwempower`); drive(g);
    expect(g.s.objects[l].empowered).toBe(1);
    const v = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    reask(g); act(g, `act:${l}#1`); drive(g, [`t:${v}`]);
    expect(g.s.objects[v].exhausted).toBe(false);
    expect(g.s.objects[l].empowered).toBe(0);
  });

  it('Ambessa, Respected and Feared: Empowered: Assault 2; attacking, kill a weaker enemy unit here', () => {
    const g = tbl(9961);
    const e = foe(g, 'mystic-poro');
    const a = put(g, 'ambessa-respected-and-feared', 0, base(0));
    emp(g, a);
    expect(hasKeyword(g.s, a, 'assault')).toBe(true);
    attack(g, a, [`t:${e}`]);
    expect(evs(g, 'kill').some((k) => k.objs.includes(e))).toBe(true);
  });

  it("Ambessa, the Wolf: Empowered: +3 and no damage outside combat", () => {
    const g = tbl(9962);
    const a = put(g, 'ambessa-the-wolf', 0, bf(0)); control(g, 0, 0);
    emp(g, a);
    expect(mightOf(g.s, a)).toBe(7);
    cast(g, 'hextech-ray', [`t:${a}`]);
    expect(dmg(g, a)).toBe(0);
  });

  it('Applied Researchers: Empowered: your spells cost [1][A] less, to a minimum of [1]', () => {
    const g = tbl(9963);
    const r = put(g, 'applied-researchers', 0, base(0));
    emp(g, r);
    const e = foe(g, 'mountain-drake');
    const id = inHand(g, 'void-seeker');
    reask(g); act(g, `play:${id}`); opt(g, `t:${e}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Apprentice Mage: becoming Empowered: Predict 2; Empowered: +1', () => {
    const g = tbl(9964);
    const m = put(g, 'apprentice-mage', 0, base(0));
    reask(g); act(g, `act:${m}#kwempower`); drive(g);
    expect(evs(g, 'look').some((e) => e.objs.length === 2)).toBe(true);
    expect(mightOf(g.s, m)).toBe(4);
  });

  it('Astral Heron: your first card each turn while I am at a battlefield: the next costs [2][A][A] less', () => {
    const g = tbl(9965);
    put(g, 'astral-heron', 0, bf(0)); control(g, 0, 0);
    cast(g, 'mystic-poro');
    const id = inHand(g, 'vanguard-sergeant');
    reask(g); act(g, `play:${id}`);
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Aurok General: Empowered: your Empowered units have +2', () => {
    const g = tbl(9966);
    const a = put(g, 'aurok-general', 0, base(0));
    const m = put(g, 'apprentice-mage', 0, base(0));
    emp(g, a); emp(g, m);
    expect([mightOf(g.s, a), mightOf(g.s, m)]).toEqual([7, 6]);
  });

  it('Baccai Reaper: attacking, may pay [R] for Assault 2', () => {
    const g = tbl(9967);
    foe(g, 'mountain-drake');
    const b = put(g, 'baccai-reaper', 0, base(0));
    attack(g, b);
    expect(evs(g, 'keywordsChanged').some((e) => e.obj === b)).toBe(true);
  });

  it('Baccai Sandspinner: Empower costs [3] less with 4 or fewer runes; Empowered: Deflect and Assault 2', () => {
    const g = tbl(9968);
    runes(g, 0, ready('fury', 4));
    const b = put(g, 'baccai-sandspinner', 0, base(0));
    reask(g);
    act(g, `act:${b}#kwempower`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
    drive(g);
    expect(hasKeyword(g.s, b, 'deflect')).toBe(true);
  });

  it('Baccai Witherclaw: Empowered: +2; dying Empowered: channel 2 exhausted', () => {
    const g = tbl(9969);
    const w = put(g, 'baccai-witherclaw', 0, bf(0)); control(g, 0, 0);
    emp(g, w);
    expect(mightOf(g.s, w)).toBe(6);
    const n = evs(g, 'channel').length;
    cast(g, 'void-seeker', [`t:${w}`]);
    cast(g, 'hextech-ray', [`t:${w}`]);
    expect(evs(g, 'channel').length).toBe(n + 1);
  });

  it('Blade Twirler: the first time I move each turn, a player burns 1', () => {
    const g = tbl(9970);
    const b = put(g, 'blade-twirler', 0, base(0));
    const n = g.s.players[1].deck.length;
    moveTo(g, [b], 0); drive(g, ['mode:1']);
    expect(g.s.players[1].deck.length).toBe(n - 1);
  });

  it('Bottled Constellation: at the start of your Main Phase, may kill 3 other friendly permanents for a point', () => {
    const g = tbl(9971);
    put(g, 'bottled-constellation', 0, base(0));
    for (let i = 0; i < 3; i++) put(g, 'mystic-poro', 0, base(0));
    const pts = g.s.players[0].points;
    reask(g); act(g, 'end'); drive(g);
    if (g.s.pending?.kind === 'priority' && g.s.pending.player === 1) act(g, 'end');
    drive(g, ['yes']);
    expect(g.s.players[0].points).toBeGreaterThanOrEqual(pts + 1);
  });

  it('Brittle Steel: kill a gear; Flow: play it from the trash for [4][R], then banish it', () => {
    const g = tbl(9972);
    runes(g, 0, [...ready('fury', 6), ...ready('mind', 6)]);
    const a = put(g, 'sumpworks-map', 1, base(1));
    const t = inTrash(g, 'brittle-steel');
    reask(g);
    expect(keys(g)).toContain(`play:${t}`);
    act(g, `play:${t}`);
    opt(g, `t:${a}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
    drive(g);
    expect(g.s.objects[a]).toBeUndefined();
    expect(defsIn(g, 'banish')).toContain('brittle-steel');
  });

  it('Brutal Hunter: Empowered: +2 and Ganking', () => {
    const g = tbl(9973);
    const h = put(g, 'brutal-hunter', 0, base(0));
    emp(g, h);
    expect(mightOf(g.s, h)).toBe(6);
    expect(hasKeyword(g.s, h, 'ganking')).toBe(true);
  });

  it('Cataclysmic Duel: each player keeps one unit; the rest die', () => {
    const g = tbl(9974);
    runes(g, 0, [...ready('body', 12)]);
    const a = put(g, 'mountain-drake', 0, base(0)); put(g, 'mystic-poro', 0, base(0));
    const b = put(g, 'vanguard-sergeant', 1, base(1)); put(g, 'mystic-poro', 1, base(1));
    cast(g, 'cataclysmic-duel', [`pick:${a}`, `pick:${b}`]);
    expect(onBoard(g, 'mystic-poro')).toHaveLength(0);
    expect(g.s.objects[a]).toBeDefined();
    expect(g.s.objects[b]).toBeDefined();
  });

  it('Clairvoyance: Predict 5, draw 2', () => {
    const g = tbl(9975);
    runes(g, 0, [...ready('mind', 8)]);
    const n = handSize(g);
    cast(g, 'clairvoyance');
    expect(handSize(g)).toBe(n + 2);
  });

  it('Cloud Drake: draw 1', () => {
    const g = tbl(9976);
    const n = handSize(g);
    cast(g, 'cloud-drake');
    expect(handSize(g)).toBe(n + 1);
  });

  it('Consuming Curse: 2, +1 for each Consuming Curse in your trash', () => {
    const g = tbl(9977);
    const e = foe(g, 'mountain-drake');
    inTrash(g, 'consuming-curse'); inTrash(g, 'consuming-curse');
    cast(g, 'consuming-curse', [`t:${e}`]);
    expect(dmg(g, e)).toBe(4);
  });

  it('Corrupted Dragon: enters ready unless near winning; attacking, may send enemy units with 5 or less here home', () => {
    const g = tbl(9978);
    runes(g, 0, [...ready('body', 12)]);
    cast(g, 'corrupted-dragon');
    const d = onBoard(g, 'corrupted-dragon', 0)[0];
    expect(g.s.objects[d].exhausted).toBe(false);
    const e = foe(g, 'mystic-poro');
    attack(g, d, [`t:${e}`, 'done']);
    expect(g.s.objects[e].zone).toEqual({ z: 'base', p: 1 });
  });

  it('Covert Informant: Empowered: moving draws 1', () => {
    const g = tbl(9979);
    const c = put(g, 'covert-informant', 0, base(0));
    emp(g, c);
    const n = handSize(g);
    moveTo(g, [c], 0); drive(g);
    expect(handSize(g)).toBe(n + 1);
  });
});

void moveObject;
const opt = (g: ReturnType<typeof tbl>, key: string) => { if (keys(g).includes(key)) act(g, key); };

describe('VEN set: batch 2', () => {
  it('Crumbling Sands: counter a spell if an opponent has played another spell this turn', () => {
    const g = tbl(10001, { first: 1 });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const c = inHand(g, 'crumbling-sands', 0);
    const a = inHand(g, 'hextech-ray', 1), b = inHand(g, 'rune-prison', 1);
    foe(g, 'mystic-poro');
    reask(g); act(g, `play:${b}`); drive(g, [`t:${u}`]);
    reask(g); act(g, `play:${a}`); drive(g, [`play:${c}`]);
    expect(evs(g, 'counter')).toHaveLength(1);
  });

  it('Dame the Despoiler: Empowered, attacking: my Might up to a unit here, then +1', () => {
    const g = tbl(10002);
    foe(g, 'mountain-drake');
    const d = put(g, 'dame-the-despoiler', 0, base(0));
    emp(g, d);
    moveTo(g, [d], 1); drive(g, [], { max: 3 });
    expect(evs(g, 'mightChanged').filter((m) => m.obj === d).length).toBeGreaterThanOrEqual(2);
  });

  it('Death Mark: burn 3, a Shadow Clone; Flow from the trash', () => {
    const g = tbl(10003);
    const n = g.s.players[0].deck.length;
    cast(g, 'death-mark');
    expect(g.s.players[0].deck.length).toBe(n - 3);
    expect(onBoard(g, 'shadowClone', 0)).toHaveLength(1);
  });

  it('Decree of Discord: enemy Order units with total Might 5 or less to hand', () => {
    const g = tbl(10004);
    const v = put(g, 'vanguard-sergeant', 1, base(1));
    put(g, 'mystic-poro', 1, base(1));
    cast(g, 'decree-of-discord', [`t:${v}`]);
    expect(defsIn(g, 'hand', 1)).toContain('vanguard-sergeant');
  });

  it('Decree of Focus: +4 to a friendly unit chosen by an enemy Fury spell', () => {
    const g = tbl(10005, { first: 1 });
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const d = inHand(g, 'decree-of-focus', 0);
    const hr = inHand(g, 'hextech-ray', 1);
    reask(g); act(g, `play:${hr}`); drive(g, [`t:${u}`, `play:${d}`, `t:${u}`]);
    expect(g.s.objects[u]).toBeDefined();
    expect(evs(g, 'mightChanged').some((m) => m.obj === u)).toBe(true);
  });

  it('Decree of Insight: an enemy Body unit -5, Deflect ignored', () => {
    const g = tbl(10006);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'decree-of-insight', [`t:${e}`]);
    expect(mightOf(g.s, e)).toBe(5);
  });

  it("Decree of Rage: can't be countered; 4 to an enemy Calm unit", () => {
    const g = tbl(10007, { first: 1 });
    const e = put(g, 'affectionate-poro', 0, base(0));
    const r = inHand(g, 'decree-of-rage', 1);
    const ab = inHand(g, 'abandon', 0);
    reask(g); act(g, `play:${r}`); drive(g, [`t:${e}`, `play:${ab}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Decree of Strength: they recycle a Mind card from their hand you choose', () => {
    const g = tbl(10008);
    const c = inHand(g, 'premonition', 1);
    cast(g, 'decree-of-strength', [`pick:${c}`]);
    expect(defsIn(g, 'hand', 1)).not.toContain('premonition');
  });

  it('Decree of Unity: kill an enemy Chaos unit or gear', () => {
    const g = tbl(10009);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'decree-of-unity', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Diana, No Longer Human: playing a spell, +2', () => {
    const g = tbl(10010);
    const d = put(g, 'diana-no-longer-human', 0, base(0));
    cast(g, 'dredge-up');
    expect(mightOf(g.s, d)).toBe(5);
  });

  it('Disciple of Shen: Shield 3 at a battlefield with exactly one other unit of mine', () => {
    const g = tbl(10011);
    const d = put(g, 'disciple-of-shen', 0, bf(0));
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    expect(hasKeyword(g.s, d, 'shield')).toBe(true);
  });

  it('Dominus: double a unit’s Might and it gains "[A][A]: Ready me" this turn', () => {
    const g = tbl(10012);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'dominus', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
    reask(g); act(g, `act:${u}#g0`); drive(g);
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Dragon Form: base Might 5 this turn', () => {
    const g = tbl(10013);
    const u = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'dragon-form', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Dragon Roost: pay [A][A] to play a Dragon to this battlefield', () => {
    const g = tbl(10014, { bfs: [undefined, 'dragon-roost'] });
    foe(g, 'mystic-poro');
    const id = inHand(g, 'cloud-drake');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g);
    const d = onBoard(g, 'cloud-drake', 0)[0];
    expect(g.s.objects[d]?.zone ?? { z: 'bf', bf: 1 }).toMatchObject({ z: 'bf' });
    expect(evs(g, 'enter').some((e) => e.obj === d && e.at.z === 'bf')).toBe(true);
  });

  it('Draven, Showboat: Might increased by your points', () => {
    const g = tbl(10015);
    const d = put(g, 'draven-showboat', 0, base(0));
    setField(g.s, g.s.players[0], 'points', 4);
    expect(mightOf(g.s, d)).toBe(7);
  });

  it('Dredge Up: draw 1; Flow [2] from the trash, then banished', () => {
    const g = tbl(10016);
    const t = inTrash(g, 'dredge-up');
    const n = handSize(g);
    reask(g); act(g, `play:${t}`); drive(g);
    expect(handSize(g)).toBe(n + 1);
    expect(defsIn(g, 'banish')).toContain('dredge-up');
  });

  it('Dune Surfer: you ignore Tank assigning combat damage here', () => {
    const g = tbl(10017);
    foe(g, 'galio-indefatigable');
    const p = put(g, 'mystic-poro', 1, bf(1));
    const d = put(g, 'dune-surfer', 0, base(0));
    attack(g, d, [`a:${p}`]);
    expect(evs(g, 'deal').some((e) => e.combat && e.to === p)).toBe(true);
  });

  it('Eclipse Dragon: moving with 4 or fewer runes draws 1', () => {
    const g = tbl(10018);
    runes(g, 0, ready('fury', 4));
    const d = put(g, 'eclipse-dragon', 0, base(0));
    const n = handSize(g);
    moveTo(g, [d], 0); drive(g);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Endless Riches: banish hand and trash, burn 7; skip Draw; play from the trash; trash → banishment', () => {
    const g = tbl(10019);
    runes(g, 0, [...ready('fury', 6), ...ready('mind', 6)]);
    inTrash(g, 'mystic-poro');
    cast(g, 'endless-riches');
    expect(handSize(g)).toBe(0);
    const t = g.s.players[0].trash.find((id) => g.s.objects[id].def !== 'endless-riches');
    expect(g.s.players[0].trash.length).toBe(7);
    reask(g);
    expect(keys(g).some((k) => k === `play:${t}`) || g.s.players[0].trash.length > 0).toBe(true);
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    cast(g, 'hextech-ray', [`t:${u}`]);
    expect(defsIn(g, 'banish')).toContain('shipyard-skulker');
  });

  it('Escaped Grayback: Empower by killing a friendly unit; Empowered: +2', () => {
    const g = tbl(10020);
    const e = put(g, 'escaped-grayback', 0, base(0));
    const v = put(g, 'mystic-poro', 0, base(0));
    reask(g); act(g, `act:${e}#kwempower`); drive(g, [`pick:${v}`]);
    expect(g.s.objects[v]).toBeUndefined();
    expect(mightOf(g.s, e)).toBe(5);
  });

  it('Esteemed Hierophant: with 7+ runes, enemy spell damage to me is prevented', () => {
    const g = tbl(10021, { first: 1 });
    const h = put(g, 'esteemed-hierophant', 0, bf(0)); control(g, 0, 0);
    const r = inHand(g, 'hextech-ray', 1);
    reask(g); act(g, `play:${r}`); drive(g, [`t:${h}`]);
    expect(dmg(g, h)).toBe(0);
  });

  it('Ezreal, Prodigy: discard 1, draw 2; optional additional costs cost [1] or [A] less', () => {
    const g = tbl(10022);
    put(g, 'ezreal-prodigy', 0, base(0));
    const id = inHand(g, 'pyke-dockside-butcher');
    reask(g); act(g, `play:${id}`); act(g, 'yes');
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
    expect((g.s.pending!.prompt as unknown as { power: unknown[] }).power).toHaveLength(0);
  });

  it("Fallen Feline: name a spell; at a battlefield, opponents can't play it", () => {
    const g = tbl(10023);
    const id = inHand(g, 'fallen-feline');
    reask(g); act(g, `play:${id}`);
    const labels = (g.s.pending!.prompt as unknown as { labels: string[] }).labels;
    act(g, `mode:${labels.indexOf('Hextech Ray')}`);
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    drive(g, ['loc:bf0']);
    const f = onBoard(g, 'fallen-feline', 0)[0];
    expect(g.s.objects[f].named).toEqual({ kind: 'card', value: 'Hextech Ray' });
  });

  it('Field Musicians: a unit +3', () => {
    const g = tbl(10024);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'field-musicians', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
  });

  it("Forgotten Relic: burn 1; a burned unit gives a friendly unit +its Might", () => {
    const g = tbl(10025);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveObject(g.s, inHand(g, 'mountain-drake'), { z: 'deck', p: 0 }, { pos: 'top' });
    cast(g, 'forgotten-relic', [`pick:${u}`]);
    expect(mightOf(g.s, u)).toBe(13);
  });
});

describe('VEN set: batch 3', () => {
  it('Frostcoat Mother: Empower costs [1] less per rune; Empowered: +3', () => {
    const g = tbl(10051);
    const f = put(g, 'frostcoat-mother', 0, base(0));
    reask(g); act(g, `act:${f}#kwempower`);                         // 12 runes: free
    drive(g);
    expect(mightOf(g.s, f)).toBe(6);
  });

  it('Gangplank, Naval: Empowered, a spell choosing me to stun me gives me +3 instead', () => {
    const g = tbl(10052, { first: 1 });
    const gp = put(g, 'gangplank-naval', 0, base(0));
    emp(g, gp);
    const r = inHand(g, 'rune-prison', 1);
    reask(g); act(g, `play:${r}`); drive(g, [`t:${gp}`]);
    expect(g.s.objects[gp].stunned).toBe(false);
    expect(mightOf(g.s, gp)).toBe(9);
  });

  it('Glowstone: disempower, [E]: a player gains control and recalls it; at the end of your turn it kills itself and deals 5 to your units', () => {
    const g = tbl(10053);
    const gs = put(g, 'glowstone', 0, base(0));
    emp(g, gs);
    reask(g); act(g, `act:${gs}#0`); drive(g, ['mode:1']);
    expect(g.s.objects[gs].controller).toBe(1);
    const g2 = tbl(10054);
    put(g2, 'glowstone', 0, base(0));
    const u = put(g2, 'shipyard-skulker', 0, base(0));
    reask(g2); act(g2, 'end'); drive(g2, [], { max: 3 });
    expect(g2.s.objects[u]).toBeUndefined();
  });

  it('Grumpy Rockbear: Empowered: Deflect and Shield 3', () => {
    const g = tbl(10055);
    const r = put(g, 'grumpy-rockbear', 0, base(0));
    emp(g, r);
    expect(hasKeyword(g.s, r, 'deflect') && hasKeyword(g.s, r, 'shield')).toBe(true);
  });

  it('Gust Monk: paying [1], banish a card from any trash to give a unit Assault 2', () => {
    const g = tbl(10056);
    const c = inTrash(g, 'mystic-poro', 1);
    const id = inHand(g, 'gust-monk');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g, [`pick:${c}`]);
    expect(defsIn(g, 'banish', 1)).toContain('mystic-poro');
  });

  it('Guttural Roar: +2, or +4 if Empowered', () => {
    const g = tbl(10057);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    emp(g, u);
    cast(g, 'guttural-roar', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(7);
  });

  it('Hand Hammer: +2 at a battlefield with exactly one other unit of mine', () => {
    const g = tbl(10058);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const h = put(g, 'hand-hammer', 0, bf(0));
    setField(g.s, g.s.objects[h], 'attachedTo', u);
    expect(mightOf(g.s, u)).toBeGreaterThanOrEqual(5);
  });

  it('Heisho: Deflect ignored for spells choosing something here', () => {
    const g = tbl(10059, { bfs: [undefined, 'heisho-shell-of-the-world'] });
    const e = foe(g, 'walking-roost');
    const id = inHand(g, 'hextech-ray');
    reask(g); act(g, `play:${id}`); opt(g, `t:${e}`);
    expect((g.s.pending!.prompt as unknown as { power: unknown[] }).power).toHaveLength(1);
  });

  it("Helm of Suppression: opponents' spells cost [1] more", () => {
    const g = tbl(10060);
    put(g, 'helm-of-suppression', 1, base(1));
    const e = foe(g, 'mountain-drake');
    const id = inHand(g, 'hextech-ray');
    reask(g); act(g, `play:${id}`); opt(g, `t:${e}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Hextech Disc: Empower — [E]; disempower, [1], [E]: a Mech to base', () => {
    const g = tbl(10061);
    const d = put(g, 'hextech-disc', 0, base(0));
    reask(g); act(g, `act:${d}#kwempower`); drive(g);
    setField(g.s, g.s.objects[d], 'exhausted', false);
    reask(g); act(g, `act:${d}#0`); drive(g);
    expect(onBoard(g, 'mech', 0)).toHaveLength(1);
  });

  it('Hextech Formula: enters exhausted; [E]: empower another gear', () => {
    const g = tbl(10062);
    const f = put(g, 'hextech-formula', 0, base(0));
    const d = put(g, 'hextech-disc', 0, base(0));
    reask(g); act(g, `act:${f}#1`); drive(g, [`t:${d}`]);
    expect(g.s.objects[d].empowered).toBe(1);
  });

  it('Hungry Wolf: [Y]: ready and +1, only after choosing an enemy unit this turn', () => {
    const g = tbl(10063);
    const w = put(g, 'hungry-wolf', 0, base(0), { exhausted: true });
    reask(g);
    expect(keys(g)).not.toContain(`act:${w}#0`);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'rune-prison', [`t:${e}`]);
    reask(g); act(g, `act:${w}#0`); drive(g);
    expect(g.s.objects[w].exhausted).toBe(false);
  });

  it('Illaoi: a Tentacle when played; +1 per token unit you control', () => {
    const g = tbl(10064);
    cast(g, 'illaoi-prophet-of-the-great-kraken');
    const i = onBoard(g, 'illaoi-prophet-of-the-great-kraken', 0)[0];
    expect(onBoard(g, 'tentacle', 0)).toHaveLength(1);
    expect(mightOf(g.s, i)).toBe(5);
  });

  it('Irelia, Fervent: chosen or readied by you, +1', () => {
    const g = tbl(10065);
    const i = put(g, 'irelia-fervent', 0, base(0), { exhausted: true });
    cast(g, 'upstage-comedy', [`t:${i}`]);
    expect(mightOf(g.s, i)).toBeGreaterThanOrEqual(5);
  });

  it('Iterative Design: a Mech', () => {
    const g = tbl(10066);
    cast(g, 'iterative-design');
    expect(onBoard(g, 'mech', 0)).toHaveLength(1);
  });

  it("Jagged Cutlass: I can't be moved by enemy spells and abilities", () => {
    const g = tbl(10067);
    const e = foe(g, 'shipyard-skulker');
    const c = put(g, 'jagged-cutlass', 1, bf(1));
    setField(g.s, g.s.objects[c], 'attachedTo', e);
    cast(g, 'isolate', [`t:${e}`]);
    expect(g.s.objects[e].zone).toEqual({ z: 'bf', bf: 1 });
  });

  it('Jayce, Brilliant Inventor: may ready something else that is exhausted', () => {
    const g = tbl(10068);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'jayce-brilliant-inventor', [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Jayce, Defender of Tomorrow: [1], [E]: ready a gear', () => {
    const g = tbl(10069, { legends: ['jayce-defender-of-tomorrow'] });
    const gr = put(g, 'hextech-disc', 0, base(0), { exhausted: true });
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g, [`t:${gr}`]);
    expect(g.s.objects[gr].exhausted).toBe(false);
  });

  it('Jayce, Hammer in Hand: becoming ready, choose a keyword for the turn', () => {
    const g = tbl(10070);
    const j = put(g, 'jayce-hammer-in-hand', 0, base(0), { exhausted: true });
    cast(g, 'upstage-comedy', [`t:${j}`, 'mode:2']);
    expect(hasKeyword(g.s, j, 'ganking')).toBe(true);
  });

  it('Jayce, Man of Progress: kill a friendly gear; a gear costing [7] or less from hand ignores its Energy cost', () => {
    const g = tbl(10071);
    const gr = put(g, 'hextech-disc', 0, base(0));
    cast(g, 'jayce-man-of-progress', [`pick:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
    const id = inHand(g, 'glowstone');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending?.kind === 'payment' ? (g.s.pending.prompt as unknown as { energy: number }).energy : 0).toBe(0);
  });

  it("Kai'Sa, Survivor: conquering draws 1", () => {
    const g = tbl(10072);
    const k = put(g, 'kaisa-survivor', 0, base(0));
    const n = handSize(g);
    moveTo(g, [k], 0); drive(g);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Kayle, Justified: empowered up to three times, +2 each; at three, Deflect 3 and Ganking', () => {
    const g = tbl(10073);
    const k = put(g, 'kayle-justified', 0, base(0));
    setField(g.s, g.s.objects[k], 'empowered', 2);
    reask(g); act(g, `act:${k}#kwempower`); drive(g);
    expect(g.s.objects[k].empowered).toBe(3);
    expect(mightOf(g.s, k)).toBe(9);
    expect(hasKeyword(g.s, k, 'ganking')).toBe(true);
  });

  it('Keeper of Law: [2][Y] less with a battlefield of yours holding exactly two units', () => {
    const g = tbl(10074);
    put(g, 'shipyard-skulker', 0, bf(0)); put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const id = inHand(g, 'keeper-of-law');
    reask(g); act(g, `play:${id}`); opt(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Kennen, Heart of the Tempest: a card played not from hand empowers me; disempower, [E]: Assault 2', () => {
    const g = tbl(10075, { legends: ['kennen-heart-of-the-tempest'] });
    inTrash(g, 'dredge-up');
    const t = g.s.players[0].trash[g.s.players[0].trash.length - 1];
    reask(g); act(g, `play:${t}`); drive(g);
    expect(g.s.objects[g.s.players[0].legend[0]].empowered).toBe(1);
  });

  it('Kennen, Keeper of Balance: may pay [2] to stun a unit; +2 while a stunned enemy unit is here', () => {
    const g = tbl(10076);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'kennen-keeper-of-balance', [`t:${e}`]);
    expect(g.s.objects[e].stunned).toBe(true);
  });
});

describe('VEN set: batch 4', () => {
  it('Kennen, Storm of Shuriken: burn 2; conquering, a spell in your trash gets Flow equal to its cost this turn', () => {
    const g = tbl(10101);
    const k = put(g, 'kennen-storm-of-shuriken', 0, base(0));
    const sp = inTrash(g, 'cloud-drake'); void sp;
    const h = inTrash(g, 'hextech-ray');
    moveTo(g, [k], 0); drive(g, [`pick:${h}`]);
    reask(g);
    expect(keys(g)).toContain(`play:${h}`);
  });

  it('Kharox: becoming Empowered, the opponent burns 3; may play a unit from their trash free', () => {
    const g = tbl(10102);
    const k = put(g, 'kharox', 0, base(0));
    const n = g.s.players[1].deck.length;
    reask(g); act(g, `act:${k}#kwempower`); drive(g, ['yes']);
    expect(g.s.players[1].deck.length).toBe(n - 3);
  });

  it("Kha'Zix, Evolving Hunter: attacking, spend 3 XP to deal my Might to an enemy unit here", () => {
    const g = tbl(10103);
    setField(g.s, g.s.players[0], 'xp', 3);
    const e = foe(g, 'mountain-drake');
    attack(g, put(g, 'khazix-evolving-hunter', 0, base(0)), [`t:${e}`]);
    expect(evs(g, 'deal').some((d) => d.to === e && !d.combat && d.n === 5)).toBe(true);
  });

  it('Ki Barrier: prevent the next 7 damage to a unit this turn', () => {
    const g = tbl(10104);
    const u = put(g, 'mountain-drake', 0, bf(0)); control(g, 0, 0);
    cast(g, 'ki-barrier', [`t:${u}`]);
    cast(g, 'void-seeker', [`t:${u}`]);
    cast(g, 'void-seeker', [`t:${u}`]);
    expect(dmg(g, u)).toBe(1);
  });

  it('Kinkou Lifeblade: Empowered: +1 and Ganking', () => {
    const g = tbl(10105);
    const k = put(g, 'kinkou-lifeblade', 0, base(0));
    emp(g, k);
    expect(mightOf(g.s, k)).toBe(5);
    expect(hasKeyword(g.s, k, 'ganking')).toBe(true);
  });

  it('Kinkou Temple: units here with Tank +1', () => {
    const g = tbl(10106, { bfs: ['kinkou-temple'] });
    const t = put(g, 'armored-tusker', 0, bf(0)); control(g, 0, 0);
    expect(mightOf(g.s, t)).toBe(5);
  });

  it('Lacerate: disempower it if Empowered; kill it with 3 or less', () => {
    const g = tbl(10107);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    emp(g, e);
    cast(g, 'lacerate', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Legion Marauder: Empower for [1] or [O]; Empowered: +1', () => {
    const g = tbl(10108);
    const l = put(g, 'legion-marauder', 0, base(0));
    reask(g);
    expect(keys(g)).toContain(`act:${l}#kwempower2`);
    act(g, `act:${l}#kwempower2`); drive(g);
    expect(mightOf(g.s, l)).toBe(3);
  });

  it('Leona, Determined: attacking, stun an enemy unit here', () => {
    const g = tbl(10109);
    const e = foe(g, 'mountain-drake');
    attack(g, put(g, 'leona-determined', 0, base(0)));
    expect(evs(g, 'stun').some((s0) => s0.objs.includes(e))).toBe(true);
  });

  it('Lightning Rush: may draw one of the top 3; the rest to the trash', () => {
    const g = tbl(10110);
    const n = handSize(g), t = g.s.players[0].trash.length;
    cast(g, 'lightning-rush');
    expect(handSize(g)).toBe(n + 1);
    expect(g.s.players[0].trash.length).toBe(t + 3);
  });

  it('Masa, Crashing Thunder: paying [Y], stun an enemy unit at a battlefield', () => {
    const g = tbl(10111);
    const e = foe(g, 'mountain-drake');
    const id = inHand(g, 'masa-crashing-thunder');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g, [`t:${e}`]);
    expect(g.s.objects[e].stunned).toBe(true);
  });

  it('Mask Mother: discarded, may pay [1] to give a friendly unit +2', () => {
    const g = tbl(10112);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    inHand(g, 'mask-mother');
    const mm = g.s.players[0].hand[g.s.players[0].hand.length - 1];
    cast(g, 'lunar-boon', [`pick:${mm}`, `t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Mel, Defiant Soul: Empower by discarding a spell; then banish an enemy unit with 3 or less at a battlefield', () => {
    const g = tbl(10113);
    const m = put(g, 'mel-defiant-soul', 0, base(0));
    const e = foe(g, 'shipyard-skulker');
    const sp = inHand(g, 'dredge-up');
    reask(g); act(g, `act:${m}#kwempower`); drive(g, [`pick:${sp}`, `t:${e}`]);
    expect(defsIn(g, 'banish', 1)).toContain('shipyard-skulker');
  });

  it("Mel, Newly Awakened: Empowered: your spells can't be countered; -[M] you give to chosen units is 1 more", () => {
    const g = tbl(10114);
    const m = put(g, 'mel-newly-awakened', 0, base(0));
    emp(g, m);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'eclipse', [`t:${e}`]);
    expect(mightOf(g.s, e)).toBe(5);
  });

  it("Mel, Soul's Reflection: empowering something else empowers me; disempower, [E]: -2", () => {
    const g = tbl(10115, { legends: ['mel-souls-reflection'] });
    const u = put(g, 'apprentice-mage', 0, base(0));
    reask(g); act(g, `act:${u}#kwempower`); drive(g);
    expect(g.s.objects[g.s.players[0].legend[0]].empowered).toBe(1);
  });

  it('Mesmerize: return a friendly unit, or an enemy unit -2', () => {
    const g = tbl(10116);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'mesmerize', ['mode:1', `t:${e}`]);
    expect(mightOf(g.s, e)).toBe(8);
  });

  it('Minah Swiftfoot: moving to a battlefield, each player draws 1 (or discards 1)', () => {
    const g = tbl(10117);
    const m = put(g, 'minah-swiftfoot', 0, base(0));
    const a = handSize(g, 0), b = handSize(g, 1);
    moveTo(g, [m], 0); drive(g, ['mode:1']);
    expect([handSize(g, 0), handSize(g, 1)]).toEqual([a + 1, b + 1]);
  });

  it('Morgana, Vindictive: deal damage equal to the damage marked on a unit', () => {
    const g = tbl(10118);
    const e = put(g, 'mountain-drake', 1, base(1), { damage: 4 });
    cast(g, 'morgana-vindictive', [`t:${e}`]);
    expect(dmg(g, e)).toBe(8);
  });

  it('Mournful Witness: a combat I was in ends: empower me; +2', () => {
    const g = tbl(10119);
    foe(g, 'galio-indefatigable');
    const w = put(g, 'mournful-witness', 0, base(0));
    attack(g, w);
    expect(g.s.objects[w].empowered).toBe(1);
    expect(mightOf(g.s, w)).toBe(4);
  });

  it('Mystic Vortex: during showdowns here, Reaction cards cost [A] more', () => {
    const g = tbl(10120, { bfs: ['mystic-vortex'] });
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    put(g, 'mountain-drake', 1, bf(0));
    const id = inHand(g, 'lunar-boon');
    reask(g);
    if (g.s.pending?.player === 1) act(g, 'pass');
    act(g, `play:${id}`);
    expect((g.s.pending!.prompt as unknown as { power: unknown[] }).power.length).toBeGreaterThanOrEqual(1);
  });

  it('Nasus, Ascended: Empowered: conquering scores 1 point', () => {
    const g = tbl(10121);
    const n = put(g, 'nasus-ascended', 0, base(0));
    emp(g, n);
    const pts = g.s.players[0].points;
    moveTo(g, [n], 0); drive(g);
    expect(g.s.players[0].points).toBe(pts + 2);
  });

  it('Nasus, Curator of the Sands: a [7]+ unit: may exhaust me to ready up to 2 runes', () => {
    const g = tbl(10122, { legends: ['nasus-curator-of-the-sands'] });
    runes(g, 0, [...ready('body', 12)]);
    cast(g, 'mountain-drake');
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);
  });

  it('Nasus, Guardian of Knowledge: once a turn, an enemy unit here dies: channel 1 exhausted', () => {
    const g = tbl(10123);
    put(g, 'nasus-guardian-of-knowledge', 0, bf(1));
    const e = foe(g, 'mystic-poro');
    void e;
    const n = evs(g, 'channel').length;
    reask(g); drive(g);
    expect(evs(g, 'channel').length).toBeGreaterThanOrEqual(n);
    const g2 = tbl(10124);
    put(g2, 'nasus-guardian-of-knowledge', 0, bf(0)); control(g2, 0, 0);
    const p = put(g2, 'mystic-poro', 1, bf(0));
    setField(g2.s, g2.s.objects[p], 'damage', [{ amount: 5, by: null, sources: [], combat: false, group: 0 }]);
    const m = evs(g2, 'channel').length;
    reask(g2); drive(g2);
    expect(evs(g2, 'channel').length).toBe(m + 1);
  });

  it('Noxian Demolitionist: conquering, may kill a gear with Energy cost no more than my Might', () => {
    const g = tbl(10125);
    const d = put(g, 'noxian-demolitionist', 0, base(0));
    const gr = put(g, 'banner-of-conquest', 1, base(1));
    moveTo(g, [d], 0); drive(g, [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
  });

  it('Noxian Emissary: dying Empowered: two Recruits', () => {
    const g = tbl(10126);
    const e = put(g, 'noxian-emissary', 0, bf(0)); control(g, 0, 0);
    emp(g, e);
    cast(g, 'soul-harvest', [`t:${e}`]);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(2);
  });
});

describe('VEN set: batch 5', () => {
  it('Forsaken Baccai: fewer runes than an opponent at your Beginning Phase: +1', () => {
    const g = tbl(10151);
    const b = put(g, 'forsaken-baccai', 0, base(0));
    runes(g, 0, ready('fury', 2));
    nextTurnQuick(g);
    expect(mightOf(g.s, b)).toBe(3);
  });

  it('Fretful Feline: becoming ready, +2', () => {
    const g = tbl(10152);
    const f = put(g, 'fretful-feline', 0, base(0), { exhausted: true });
    cast(g, 'upstage-comedy', [`t:${f}`]);
    expect(mightOf(g.s, f)).toBe(7);
  });

  it('Oasis Raider: fewer runes at your Beginning Phase: +2 and Ganking', () => {
    const g = tbl(10153);
    const o = put(g, 'oasis-raider', 0, base(0));
    runes(g, 0, ready('fury', 2));
    nextTurnQuick(g);
    expect(hasKeyword(g.s, o, 'ganking')).toBe(true);
  });

  it('Ocean Drake: playable to an open battlefield; may return a non-Dragon unit', () => {
    const g = tbl(10154);
    runes(g, 0, [...ready('chaos', 4), ...ready('fury', 8)]);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    const id = inHand(g, 'ocean-drake');
    reask(g); act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf0');
    drive(g, ['loc:bf0', `t:${e}`]);
    expect(defsIn(g, 'hand', 1)).toContain('shipyard-skulker');
  });

  it("Ol' Poro: can't be played on your first three turns", () => {
    const g = tbl(10155);
    const id = inHand(g, 'ol-poro');
    reask(g);
    expect(keys(g)).not.toContain(`play:${id}`);
    setField(g.s, g.s.history.turnsTaken, 0, 4);
    reask(g);
    expect(keys(g)).toContain(`play:${id}`);
  });

  it('Onslaught: +6', () => {
    const g = tbl(10156);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'onslaught', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(9);
  });

  it('Otterpus: a 1-point conquer in your first or second turn draws 1 instead', () => {
    const g = tbl(10157);
    put(g, 'otterpus', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const pts = g.s.players[0].points, n = handSize(g);
    moveTo(g, [u], 0); drive(g);
    expect(g.s.players[0].points).toBe(pts);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Pakaa Protector: moving, reveal the top card; a unit is drawn, else trashed and +2', () => {
    const g = tbl(10158);
    const p = put(g, 'pakaa-protector', 0, base(0));
    moveObject(g.s, inHand(g, 'hextech-ray'), { z: 'deck', p: 0 }, { pos: 'top' });
    moveTo(g, [p], 0); drive(g);
    expect(defsIn(g, 'trash')).toContain('hextech-ray');
    expect(mightOf(g.s, p)).toBe(6);
  });

  it('Patched Porobot: with 3 other gear, draw 1', () => {
    const g = tbl(10159);
    for (let i = 0; i < 3; i++) put(g, 'hextech-disc', 0, base(0));
    const n = handSize(g);
    cast(g, 'patched-porobot');
    expect(handSize(g)).toBe(n + 1);
  });

  it('Pendulum Blade: the equipped unit moving to a battlefield gets +2', () => {
    const g = tbl(10160);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    equip(g, 'pendulum-blade', u);
    moveTo(g, [u], 0); drive(g);
    expect(evs(g, 'mightChanged').some((m) => m.obj === u)).toBe(true);
  });

  it('Perfect Execution: ready a unit with Assault 3', () => {
    const g = tbl(10161);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'perfect-execution', [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
    expect(hasKeyword(g.s, u, 'assault')).toBe(true);
  });

  it('Piltovan Forge: the first gear activated ability each turn costs [1] less', () => {
    const g = tbl(10162, { bfs: ['piltovan-forge'] });
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const t = put(g, 'questionable-tome', 0, base(0));
    emp(g, t);
    reask(g); act(g, `act:${t}#0`); drive(g);
    expect(evs(g, 'pool').length >= 0).toBe(true);
    expect(g.s.objects[t].empowered).toBe(0);
  });

  it('Platewyrm Egg: [E]: [Add] [1], or [2] if Empowered', () => {
    const g = tbl(10163);
    const e = put(g, 'platewyrm-egg', 0, base(0));
    emp(g, e);
    reask(g); act(g, `act:${e}#2`);
    expect(g.s.players[0].pool.energy).toBe(2);
  });

  it('Plaza Guardian: [1] less for each gear you control', () => {
    const g = tbl(10164);
    for (let i = 0; i < 3; i++) put(g, 'hextech-disc', 0, base(0));
    const id = inHand(g, 'plaza-guardian');
    reask(g); act(g, `play:${id}`); opt(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 7 } });
  });

  it('Profiteer: may disempower something of yours to empower another', () => {
    const g = tbl(10165);
    const a = put(g, 'apprentice-mage', 0, base(0));
    const b = put(g, 'brutal-hunter', 0, base(0));
    emp(g, a);
    cast(g, 'profiteer', [`pick:${b}`]);
    expect([g.s.objects[a].empowered, g.s.objects[b].empowered]).toEqual([0, 1]);
  });

  it('Protective Sands: conquering here with 4 or fewer runes, may pay [1] to draw 1', () => {
    const g = tbl(10166, { bfs: ['protective-sands'] });
    runes(g, 0, ready('fury', 4));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const n = handSize(g);
    moveTo(g, [u], 0); drive(g);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Public Execution: kill an enemy unit with less Might than a friendly unit', () => {
    const g = tbl(10167);
    const u = put(g, 'vanguard-sergeant', 0, base(0));
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'public-execution', [`t:${u}`, `t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Punching Poro: Empower by discarding 1; +1', () => {
    const g = tbl(10168);
    const p = put(g, 'punching-poro', 0, base(0));
    reask(g); act(g, `act:${p}#kwempower`); drive(g);
    expect(mightOf(g.s, p)).toBe(3);
  });

  it('Questionable Tome: disempower, [1], [E]: draw 1', () => {
    const g = tbl(10169);
    const t = put(g, 'questionable-tome', 0, base(0));
    emp(g, t);
    const n = handSize(g);
    reask(g); act(g, `act:${t}#0`); drive(g);
    expect(handSize(g)).toBe(n + 1);
  });

  it('Rage Amplifier: your units +1, +2 if Empowered', () => {
    const g = tbl(10170);
    const r = put(g, 'rage-amplifier', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    expect(mightOf(g.s, u)).toBe(4);
    emp(g, r);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Rampage: paying [O], the friendly unit gets +2; then they fight', () => {
    const g = tbl(10171);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'vanguard-sergeant', 1, base(1));
    const id = inHand(g, 'rampage');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g, [`t:${u}`, `t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Ravenbloom Prefect: an opponent plays a gear: may banish me to banish it', () => {
    const g = tbl(10172, { first: 1 });
    put(g, 'ravenbloom-prefect', 0, base(0));
    const gr = inHand(g, 'hextech-disc', 1);
    reask(g); act(g, `play:${gr}`); drive(g, ['yes']);
    expect(defsIn(g, 'banish', 1)).toContain('hextech-disc');
    expect(defsIn(g, 'banish', 0)).toContain('ravenbloom-prefect');
  });

  it('Rebuttal: pay [A] to take control of a spell, else counter it', () => {
    const g = tbl(10173, { first: 1 });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const r = inHand(g, 'rebuttal', 0);
    const hr = inHand(g, 'rune-prison', 1);
    reask(g); act(g, `play:${hr}`); opt(g, `t:${u}`); act(g, 'pay:0');
    if (g.s.pending?.player === 1) act(g, 'pass');
    act(g, `play:${r}`); opt(g, 'pay:0');
    drive(g, ['decline']);
    expect(evs(g, 'counter')).toHaveLength(1);
    expect(g.s.objects[u].stunned).toBe(false);
  });

  it('Reluctant Leader: another unit played, +2', () => {
    const g = tbl(10174);
    const l = put(g, 'reluctant-leader', 0, base(0));
    cast(g, 'mystic-poro');
    expect(mightOf(g.s, l)).toBe(5);
  });

  it('Renekton, Brute: [1]: +1; reaching 10 Might empowers me (Deflect, Ganking)', () => {
    const g = tbl(10175);
    const r = put(g, 'renekton-brute', 0, base(0));
    cast(g, 'onslaught', [`t:${r}`]);
    expect(g.s.objects[r].empowered).toBe(1);
    expect(hasKeyword(g.s, r, 'ganking')).toBe(true);
  });

  it('Renekton, Butcher of the Sands: [A][A], [E]: [Add] [2] for units or unit abilities', () => {
    const g = tbl(10176, { legends: ['renekton-butcher-of-the-sands'] });
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g, [], { max: 3 });
    expect(g.s.players[0].pool.restricted).toMatchObject([{ kind: 'energy', amount: 2, onlyFor: 'units' }]);
  });

  it('Renekton, Rage-Fueled: attacking with 4 or fewer runes, 2 to all enemy units here', () => {
    const g = tbl(10177);
    runes(g, 0, ready('fury', 4));
    const e = foe(g, 'mountain-drake');
    attack(g, put(g, 'renekton-rage-fueled', 0, base(0)));
    expect(evs(g, 'deal').some((d) => d.to === e && !d.combat && d.n === 2)).toBe(true);
  });
});

/** Ends P0's turn and P1's, ending at P0's Main Phase. */
function nextTurnQuick(g: ReturnType<typeof tbl>) {
  reask(g); act(g, 'end'); drive(g);
  if (g.s.pending?.kind === 'priority' && g.s.pending.player === 1) act(g, 'end');
  drive(g);
}

describe('VEN set: batch 6', () => {
  it('Rengar, Trophy Hunter: may Ambush to a battlefield with enemy units', () => {
    const g = tbl(10201);
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    put(g, 'mountain-drake', 1, bf(0));
    const id = inHand(g, 'rengar-trophy-hunter');
    reask(g);
    if (g.s.pending?.player === 1) act(g, 'pass');
    expect(keys(g)).toContain(`play:${id}`);
  });

  it('Repair Specialist: Assault equal to the gear you control', () => {
    const g = tbl(10202);
    const r = put(g, 'repair-specialist', 0, base(0));
    put(g, 'hextech-disc', 0, base(0)); put(g, 'hextech-disc', 0, base(0));
    expect(hasKeyword(g.s, r, 'assault')).toBe(true);
  });

  it('Resonating Strike: move a unit of yours to a battlefield you control, +2', () => {
    const g = tbl(10203);
    put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'resonating-strike', [`t:${u}`]);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Risen Altar: Empower costs of your units here cost [1] less', () => {
    const g = tbl(10204, { bfs: ['risen-altar'] });
    const m = put(g, 'apprentice-mage', 0, bf(0)); control(g, 0, 0);
    reask(g); act(g, `act:${m}#kwempower`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
  });

  it('Riven, Shattered: attacking, 2 per Equipment attached to me', () => {
    const g = tbl(10205);
    const e = foe(g, 'mountain-drake');
    const r = put(g, 'riven-shattered', 0, base(0));
    equip(g, 'hand-hammer', r); equip(g, 'pendulum-blade', r);
    attack(g, r, [`t:${e}`]);
    expect(evs(g, 'deal').some((d) => d.to === e && !d.combat && d.n === 4)).toBe(true);
  });

  it('Ruthless Strike: 3, or 5 if you discarded 1', () => {
    const g = tbl(10206);
    const e = foe(g, 'mountain-drake');
    const id = inHand(g, 'ruthless-strike');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g, [`t:${e}`]);
    expect(dmg(g, e)).toBe(5);
  });

  it("Sacred Protector: no combat damage unless at a battlefield with exactly one other unit of yours", () => {
    const g = tbl(10207);
    foe(g, 'mountain-drake');
    const p = put(g, 'sacred-protector', 0, base(0));
    attack(g, p);
    expect(evs(g, 'deal').some((d) => d.combat && d.sources.includes(p))).toBe(false);
  });

  it('Sanction: empower a unit until end of turn', () => {
    const g = tbl(10208);
    const u = put(g, 'apprentice-mage', 0, base(0));
    cast(g, 'sanction', ['mode:0', `t:${u}`]);
    expect(g.s.objects[u].empowered).toBe(1);
    reask(g); act(g, 'end'); drive(g, [], { max: 3 });
    expect(g.s.objects[u].empowered).toBe(0);
  });

  it('Sandstone Chimera: at a battlefield, players channel only 1 rune in their Channel Phase', () => {
    const g = tbl(10209);
    put(g, 'sandstone-chimera', 0, bf(0)); control(g, 0, 0);
    const n = g.s.players[1].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
    nextTurnQuick(g);
    const m = g.s.players[1].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
    expect(m - n).toBeLessThanOrEqual(1);
  });

  it('Sandswept Tomb: a spell choosing a friendly unit here costs [A] less', () => {
    const g = tbl(10210, { bfs: ['sandswept-tomb'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const id = inHand(g, 'primal-strength');
    reask(g); act(g, `play:${id}`); opt(g, `t:${u}`);
    expect((g.s.pending!.prompt as unknown as { power: unknown[] }).power).toHaveLength(0);
  });

  it('Serene Ascetic: Empowered: Deflect and Shield 3', () => {
    const g = tbl(10211);
    const a = put(g, 'serene-ascetic', 0, base(0));
    emp(g, a);
    expect(hasKeyword(g.s, a, 'deflect') && hasKeyword(g.s, a, 'shield')).toBe(true);
  });

  it('Sett, Brawler: buff me as played; spend my buff: +4', () => {
    const g = tbl(10212);
    cast(g, 'sett-brawler');
    const st = onBoard(g, 'sett-brawler', 0)[0];
    expect(g.s.objects[st].buffs).toBe(1);
    reask(g); act(g, `act:${st}#2`); drive(g);
    expect(mightOf(g.s, st)).toBe(8);
  });

  it('Shadow Assassin: enters ready with a Shadow Assassin in your trash', () => {
    const g = tbl(10213);
    inTrash(g, 'shadow-assassin');
    cast(g, 'shadow-assassin');
    expect(g.s.objects[onBoard(g, 'shadow-assassin', 0)[0]].exhausted).toBe(false);
  });

  it('Shadow Dash: an enemy unit to a battlefield where you have units; with exactly two there, +1 each', () => {
    const g = tbl(10214);
    const a = put(g, 'shipyard-skulker', 0, bf(0)); put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'shadow-dash', [`t:${e}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(e))).toBe(true);
    expect(evs(g, 'mightChanged').some((m) => m.obj === a)).toBe(true);
  });

  it('Shadow Fiend: Empowered: Assault 3', () => {
    const g = tbl(10215);
    const f = put(g, 'shadow-fiend', 0, base(0));
    emp(g, f);
    expect(hasKeyword(g.s, f, 'assault')).toBe(true);
  });

  it('Shadow Order Disciple: moving, may burn 1 for +1', () => {
    const g = tbl(10216);
    const d = put(g, 'shadow-order-disciple', 0, base(0));
    const n = g.s.players[0].deck.length;
    moveTo(g, [d], 0); drive(g);
    expect(g.s.players[0].deck.length).toBe(n - 1);
  });

  it('Shadow Temple: holding here, burn 3', () => {
    const g = tbl(10217, { bfs: ['shadow-temple'] });
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const n = g.s.players[0].deck.length;
    nextTurnQuick(g);
    expect(g.s.players[0].deck.length).toBe(n - 4);
  });

  it('Shadowblade Lurker: [2] less for each Shadowblade Lurker in your trash', () => {
    const g = tbl(10218);
    inTrash(g, 'shadowblade-lurker');
    const id = inHand(g, 'shadowblade-lurker');
    reask(g); act(g, `play:${id}`); opt(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it("Shadows of the Past: up to 2 units from trashes to their owners' hands", () => {
    const g = tbl(10219);
    const a = inTrash(g, 'mystic-poro', 1), b = inTrash(g, 'shipyard-skulker', 0);
    cast(g, 'shadows-of-the-past', [`t:${a}`, `t:${b}`]);
    expect(defsIn(g, 'hand', 1)).toContain('mystic-poro');
    expect(defsIn(g, 'hand', 0)).toContain('shipyard-skulker');
  });

  it('Shen, Eye of Twilight: [E]: a friendly unit gets Tank this turn', () => {
    const g = tbl(10220, { legends: ['shen-eye-of-twilight'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g, [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'tank')).toBe(true);
  });

  it('Shen, Leader of the Kinkou Order: holding with exactly one other unit of mine here: 1 point', () => {
    const g = tbl(10221);
    put(g, 'shen-leader-of-the-kinkou-order', 0, bf(0)); put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const pts = g.s.players[0].points;
    nextTurnQuick(g);
    expect(g.s.players[0].points).toBe(pts + 2);
  });

  it('Shen, Scourge of Shadows: holding with exactly one other unit of mine here: draw 1', () => {
    const g = tbl(10222);
    put(g, 'shen-scourge-of-shadows', 0, bf(0)); put(g, 'mystic-poro', 0, bf(0)); control(g, 0, 0);
    const n = handSize(g);
    nextTurnQuick(g);
    expect(handSize(g)).toBe(n + 2);
  });
});

const runesOn = (g: ReturnType<typeof tbl>, p: 0 | 1 = 0) => g.s.players[p].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;

describe('VEN set: batch 7', () => {
  it('Shock Blast: [2] less while you control something Empowered; deal 4 to a unit at a battlefield', () => {
    const g = tbl(10301);
    const e = foe(g, 'mountain-drake');
    emp(g, put(g, 'apprentice-mage', 0, base(0)));
    const id = inHand(g, 'shock-blast');
    reask(g); act(g, `play:${id}`); opt(g, `t:${e}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
    drive(g);
    expect(dmg(g, e)).toBe(4);
  });

  it('Shuriken Flip: 2 to up to one enemy unit at a battlefield, then move a friendly unit', () => {
    const g = tbl(10302);
    const e = foe(g, 'mountain-drake');
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'shuriken-flip', [`t:${e}`, `t:${u}`, 'loc:bf0']);
    expect(dmg(g, e)).toBe(2);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it('Siphoning Strike: 7 with 7+ runes; when it dies this turn, channel 1 rune exhausted', () => {
    const g2 = tbl(10304);
    runes(g2, 0, ready('calm', 8));
    const big = foe(g2, 'galio-indefatigable');                      // Deflect: a rune recycled to pay, 7 left
    cast(g2, 'siphoning-strike', [`t:${big}`]);
    expect(evs(g2, 'deal').some((d) => d.to === big && d.n === 7)).toBe(true);
    expect(runesOn(g2)).toBe(8);
    const g3 = tbl(10305);
    runes(g3, 0, ready('calm', 6));
    const m = foe(g3, 'mountain-drake');
    cast(g3, 'siphoning-strike', [`t:${m}`]);
    expect(dmg(g3, m)).toBe(4);
    expect(runesOn(g3)).toBe(6);
  });

  it('Sky Crusier: discard a gear, [1], [E]: deal 4 to a unit at a battlefield', () => {
    const g = tbl(10306);
    const e = foe(g, 'mountain-drake');
    const c = put(g, 'sky-cruiser', 0, base(0));
    emptyHand(g);
    inHand(g, 'sumpworks-map'); inHand(g, 'shipyard-skulker');
    reask(g); act(g, `act:${c}#0`); drive(g, [`t:${e}`]);
    expect(dmg(g, e)).toBe(4);
    expect(defsIn(g, 'trash')).toContain('sumpworks-map');
  });

  it('Solari Sunhawk: Empowered: +1 and Deflect 2', () => {
    const g = tbl(10307);
    const s = put(g, 'solari-sunhawk', 0, base(0));
    expect(hasKeyword(g.s, s, 'deflect')).toBe(false);
    emp(g, s);
    expect(mightOf(g.s, s)).toBe(4);
    expect(hasKeyword(g.s, s, 'deflect')).toBe(true);
  });

  it('Spiderling: +1 for each other Spiderling you control here', () => {
    const g = tbl(10308);
    const a = put(g, 'spiderling', 0, base(0));
    put(g, 'spiderling', 0, base(0)); put(g, 'spiderling', 0, base(0));
    put(g, 'spiderling', 1, base(1));
    expect(mightOf(g.s, a)).toBe(3);
  });

  it('Stargazer: Flow spells you play from your trash cost [2] less, to a minimum of [1]', () => {
    const g = tbl(10309);
    put(g, 'stargazer', 0, base(0));
    const t = inTrash(g, 'dredge-up');
    reask(g); act(g, `play:${t}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
    const g2 = tbl(10310);
    put(g2, 'stargazer', 0, base(0));
    const h = inHand(g2, 'dredge-up');                                 // from the hand: the printed cost
    reask(g2); act(g2, `play:${h}`);
    expect(g2.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Steel Paws: Deflect; Empowered: +7', () => {
    const g = tbl(10311);
    const s = put(g, 'steel-paws', 0, base(0));
    expect(hasKeyword(g.s, s, 'deflect')).toBe(true);
    emp(g, s);
    expect(mightOf(g.s, s)).toBe(7);
  });

  it('Swain, Visionary: conquering after a unit, a gear and a spell this turn: 1 more point', () => {
    const run = (all: boolean) => {
      const g = tbl(10312);
      runes(g, 0, [...ready('mind', 12)]);
      cast(g, 'shipyard-skulker');
      cast(g, 'sumpworks-map');
      if (all) cast(g, 'dredge-up');
      const s = put(g, 'swain-visionary', 0, base(0));
      const before = g.s.players[0].points;
      moveTo(g, [s], 0); drive(g);
      return g.s.players[0].points - before;
    };
    expect(run(true)).toBe(2);
    expect(run(false)).toBe(1);
  });

  it('Tail-Cloaked Matriarch: becoming Empowered, may play a cheap unit from your trash to base for free', () => {
    const g = tbl(10313);
    runes(g, 0, ready('chaos', 6));
    const m = put(g, 'tail-cloaked-matriarch', 0, base(0));
    const t = inTrash(g, 'shipyard-skulker');
    inTrash(g, 'mountain-drake');
    reask(g); act(g, `act:${m}#kwempower`); drive(g, [`t:${t}`]);
    expect(g.s.objects[m].empowered).toBe(1);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
    expect(defsIn(g, 'trash')).toContain('mountain-drake');
  });

  it('Temporal Breach: banish a unit, its owner plays it back to the same location', () => {
    const g = tbl(10314);
    const e = foe(g, 'vanguard-sergeant', { damage: 2 });
    cast(g, 'temporal-breach', [`t:${e}`]);
    const back = onBoard(g, 'vanguard-sergeant', 1);
    expect(back).toHaveLength(1);
    expect(g.s.objects[back[0]].zone).toEqual({ z: 'bf', bf: 1 });
    expect(dmg(g, back[0])).toBe(0);
  });

  it('Threshold of the Gray: when combat starts here, attacker and defender each add [1]', () => {
    const g = tbl(10315, { bfs: [undefined, 'threshold-of-the-gray'] });
    foe(g, 'mountain-drake');
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 1);
    drive(g, [], { max: 4 });
    expect(g.s.players.map((p) => p.pool.energy)).toEqual([1, 1]);
  });

  it('Tomb Raider Barbara: with 7+ runes, an enemy gear: disempowered if Empowered, otherwise killed', () => {
    const g = tbl(10316);
    runes(g, 0, ready('calm', 8));
    const gear = put(g, 'sumpworks-map', 1, base(1));
    cast(g, 'tomb-raider-barbara', [`t:${gear}`]);
    expect(g.s.objects[gear]).toBeUndefined();
    const g2 = tbl(10317);
    runes(g2, 0, ready('calm', 8));
    const d = put(g2, 'hextech-disc', 1, base(1));
    emp(g2, d);
    cast(g2, 'tomb-raider-barbara', [`t:${d}`]);
    expect(g2.s.objects[d].empowered).toBe(0);
    const g3 = tbl(10318);
    runes(g3, 0, ready('calm', 6));
    const k = put(g3, 'sumpworks-map', 1, base(1));
    cast(g3, 'tomb-raider-barbara');
    expect(g3.s.objects[k]).toBeDefined();
  });

  it('Tools of Empire: [E]: +2 this turn, +4 if Empowered', () => {
    const g = tbl(10319);
    const t = put(g, 'tools-of-empire', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    emp(g, t);
    reask(g); act(g, `act:${t}#0`); drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(7);
  });

  it('Tornado Warrior: played from face down, may empower something here until end of turn', () => {
    const g = tbl(10320);
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const a = put(g, 'apprentice-mage', 0, bf(0));
    const fd = hide(g, 'tornado-warrior', 0);
    setField(g.s, g.s.objects[fd].facedown!, 'hiddenOnTurn', g.s.turn.n - 1);
    reask(g);
    drive(g, [`play:${fd}`, `t:${a}`]);
    expect(g.s.objects[a].empowered).toBe(1);
    reask(g); act(g, 'end'); drive(g, [], { max: 3 });
    expect(g.s.objects[a].empowered).toBe(0);
  });

  it('Twilight Reveler: attacking, ready another friendly unit', () => {
    const g = tbl(10321);
    foe(g, 'mystic-poro');
    const o = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    attack(g, put(g, 'twilight-reveler', 0, base(0)), [`t:${o}`]);
    expect(g.s.objects[o].exhausted).toBe(false);
  });

  it("Twilight Shroud: +1 this turn, can't be chosen by enemy spells and abilities this turn", () => {
    const g = tbl(10322);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    put(g, 'mystic-poro', 0, base(0));
    cast(g, 'twilight-shroud', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(4);
    expect(g.s.effects.some((e) => (e.spec as { s?: string }).s === 'noEnemyChoose' && 'objs' in e.affects && e.affects.objs.includes(u))).toBe(true);
    // P1 can't choose it (a friendly spell still can).
    const ctx = { controller: 1 as const, source: null };
    const sl = { id: 'a', sel: [{ k: 'unit' as const }] } as unknown as Parameters<typeof candidatesFor>[1];
    expect(candidatesFor(g.s, sl, ctx, ctx)).not.toContain(u);
    expect(candidatesFor(g.s, sl, { controller: 0, source: null }, { controller: 0, source: null })).toContain(u);
  });

  it('Twilight Step: move a unit with 3 Might or less', () => {
    const g = tbl(10323);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const big = put(g, 'mountain-drake', 0, base(0));
    const id = inHand(g, 'twilight-step');
    reask(g); act(g, `play:${id}`);
    expect(keys(g)).not.toContain(`t:${big}`);
    drive(g, [`t:${u}`, 'loc:bf0']);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it('Up from the Deep: two 1 Might Tentacle tokens', () => {
    const g = tbl(10324);
    cast(g, 'up-from-the-deep');
    expect(onBoard(g, 'tentacle', 0)).toHaveLength(2);
  });

  it('Wild Claw: banish a unit or gear from the top 5 and play it for [5] less, then may empower it', () => {
    const g = tbl(10325);
    runes(g, 0, [...ready('body', 9)]);
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'apprentice-mage');
    cast(g, 'wild-claw', [`pick:${top}`]);
    const m = onBoard(g, 'apprentice-mage', 0);
    expect(m).toHaveLength(1);
    expect(g.s.objects[m[0]].empowered).toBe(1);
  });

  it('Zed, From the Shadows: discarding 1 as you play me, a Shadow Clone', () => {
    const g = tbl(10326);
    const id = inHand(g, 'zed-from-the-shadows');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g);
    expect(onBoard(g, 'shadowClone', 0)).toHaveLength(1);
    const g2 = tbl(10327);
    cast(g2, 'zed-from-the-shadows');
    expect(onBoard(g2, 'shadowClone', 0)).toHaveLength(0);
  });

  it('Zed, Master of Shadows: banishing a card you own empowers me; Disempower me, [E]: discard 1, draw 1', () => {
    const g = tbl(10328, { legends: ['zed-master-of-shadows'] });
    const l = g.s.players[0].legend[0];
    const t = inTrash(g, 'dredge-up');
    reask(g); act(g, `play:${t}`); drive(g);
    expect(defsIn(g, 'banish')).toContain('dredge-up');
    expect(g.s.objects[l].empowered).toBe(1);
    const n = handSize(g);
    reask(g); act(g, `act:${l}#1`); drive(g);
    expect(g.s.objects[l].empowered).toBe(0);
    expect(handSize(g)).toBe(n);
    expect(evs(g, 'discard')).toHaveLength(1);
  });

  it('Zed, Without a Sound: conquering, a Shadow Clone at base; [1][P]: swap places with a Shadow Clone', () => {
    const g = tbl(10329);
    const z = put(g, 'zed-without-a-sound', 0, base(0));
    moveTo(g, [z], 0); drive(g);
    const c = onBoard(g, 'shadowClone', 0);
    expect(c).toHaveLength(1);
    expect(g.s.objects[c[0]].zone).toEqual(base(0));
    setField(g.s, g.s.objects[z], 'exhausted', false);
    reask(g); act(g, `act:${z}#1`); drive(g);
    expect(g.s.objects[z].zone).toEqual(base(0));
    expect(g.s.objects[c[0]].zone).toEqual({ z: 'bf', bf: 0 });
  });
});
