import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, moveTo, onBoard } from './helpers/cards.ts';
import { attack, defsIn, dmg, foe, tbl } from './helpers/setCards.ts';

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
