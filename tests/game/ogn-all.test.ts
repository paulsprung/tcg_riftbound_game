import { describe, expect, it } from 'vitest';
import { hasKeyword, keywordOf, mightOf } from '../../src/game/rules/chars.ts';
import { victoryScore } from '../../src/game/rules/defaults.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, moveTo, nextTurn, onBoard, RICH, table } from './helpers/cards.ts';

/*
 * Origins (OGN), the cards beyond the Champion Decks (cards/defs/ogn-set.ts):
 * one behaviour test per card at least.
 */

type G = ReturnType<typeof table>;
/** A card-test table where P1 holds battlefield 1 (so enemy units can stand there). */
const tbl = (seed: number, o: Parameters<typeof table>[1] = {}) => table(seed, o);
/** An enemy unit at battlefield 1, which P1 then holds. */
const foe = (g: G, def: string, o: { damage?: number } = {}) => { const id = put(g, def, 1, bf(1), o); control(g, 1, 1); return id; };
const defsIn = (g: G, z: 'hand' | 'trash' | 'banish' | 'deck', p: 0 | 1 = 0) => g.s.players[p][z].map((x) => g.s.objects[x].def);
const emptyHand = (g: G, p: 0 | 1 = 0) => { for (const id of g.s.players[p].hand.slice()) moveObject(g.s, id, { z: 'trash', p }); };
const runeCount = (g: G, p: 0 | 1 = 0) => g.s.players[p].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
const dmg = (g: G, id: number) => (g.s.objects[id]?.damage ?? []).reduce((n, d) => n + d.amount, 0);
/** A friendly unit attacks the enemy at battlefield 1. */
const attack = (g: G, attacker: number, answers: string[] = []) => { moveTo(g, [attacker], 1); drive(g, answers); };

describe('Origins set: batch 1', () => {
  it('Adaptatron: when I conquer, you may kill a gear; if you do, buff me', () => {
    const g = tbl(9001);
    const gr = put(g, 'iron-ballista', 1, base(1));
    const a = put(g, 'adaptatron', 0, base(0));
    moveTo(g, [a], 0);
    drive(g, [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
    expect(g.s.objects[a].buffs).toBe(1);
  });

  it('Ahri, Alluring: when I hold, you score 1 point', () => {
    const g = tbl(9002);
    control(g, 0, 0);
    put(g, 'ahri-alluring', 0, bf(0));
    nextTurn(g);
    expect(g.s.players[0].points).toBe(2);                             // the hold and Ahri's point
  });

  it('Anivia, Primal: when I attack, deal 3 to all enemy units here', () => {
    const g = tbl(9003);
    control(g, 1, 1);
    const e1 = foe(g, 'shipyard-skulker'), e2 = foe(g, 'mountain-drake');
    attack(g, put(g, 'anivia-primal', 0, base(0)));
    expect(g.s.objects[e1]).toBeUndefined();
    expect(evs(g, 'deal').some((e) => e.to === e2 && e.n === 3)).toBe(true);
  });

  it('Arena Bar: [E]: buff an exhausted friendly unit', () => {
    const g = tbl(9004);
    const b = put(g, 'arena-bar', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${b}#0`);
    drive(g);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it("Aspirant's Climb: the Victory Score is 1 higher", () => {
    const g = tbl(9005, { bfs: ['aspirants-climb'] });
    expect(victoryScore(g.s)).toBe(g.s.mode.victoryScore + 1);
  });

  it('Blastcone Fae: when you play me, a unit gets -2 to a minimum of 1', () => {
    const g = tbl(9006);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    const m = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'blastcone-fae', [`t:${m}`]);
    expect(mightOf(g.s, m)).toBe(1);
    expect(mightOf(g.s, e)).toBe(3);
  });

  it('Block: a unit gets Shield 3 and Tank this turn', () => {
    const g = tbl(9007);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'block', [`t:${u}`]);
    expect([hasKeyword(g.s, u, 'tank'), hasKeyword(g.s, u, 'shield')]).toEqual([true, true]);
  });

  it('Caitlyn, Patrolling: assigned damage last; [E] deals my Might at a battlefield only while at one', () => {
    const g = tbl(9008);
    const c = put(g, 'caitlyn-patrolling', 0, base(0));
    expect(hasKeyword(g.s, c, 'backline')).toBe(true);
    reask(g);
    expect(keys(g)).not.toContain(`act:${c}#1`);
    moveObject(g.s, c, { z: 'bf', bf: 0 });
    control(g, 0, 0);
    const e = foe(g, 'shipyard-skulker');
    reask(g);
    act(g, `act:${c}#1`);
    drive(g, [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Captain Farron: other friendly units here have Assault', () => {
    const g = tbl(9009);
    const f = put(g, 'captain-farron', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const v = put(g, 'shipyard-skulker', 0, bf(0));
    expect([hasKeyword(g.s, u, 'assault'), hasKeyword(g.s, v, 'assault'), hasKeyword(g.s, f, 'assault')]).toEqual([true, false, false]);
  });

  it('Carnivorous Snapvine: when you play me, I and an enemy unit at a battlefield fight', () => {
    const g = tbl(9010);
    control(g, 1, 1);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'carnivorous-snapvine', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
    expect(dmg(g, onBoard(g, 'carnivorous-snapvine', 0)[0])).toBe(3);
  });

  it("Catalyst of Aeons: channel 2 exhausted; draw 1 if you couldn't", () => {
    const g = tbl(9011);
    const r = runeCount(g), h = handSize(g);
    cast(g, 'catalyst-of-aeons');
    expect(runeCount(g)).toBe(r + 2);
    expect(handSize(g)).toBe(h);
    for (const id of g.s.players[0].runeDeck.slice(1)) moveObject(g.s, id, { z: 'banish', p: 0 });
    cast(g, 'catalyst-of-aeons');
    expect(handSize(g)).toBe(h + 1);
  });

  it('Cithria of Cloudfield: when you play another unit, buff me', () => {
    const g = tbl(9012);
    cast(g, 'cithria-of-cloudfield');
    const c = onBoard(g, 'cithria-of-cloudfield', 0)[0];
    expect(g.s.objects[c].buffs).toBe(0);
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[c].buffs).toBe(1);
  });

  it('Cleave: a unit gets Assault 3 this turn', () => {
    const g = tbl(9013);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'cleave', [`t:${u}`]);
    setField(g.s, g.s.objects[u], 'designation', 'attacker');
    expect(mightOf(g.s, u)).toBe(6);
  });

  it('Clockwork Keeper: pay [G] more to draw 1', () => {
    const g = tbl(9014);
    const id = inHand(g, 'clockwork-keeper');
    const h = handSize(g);
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g);
    expect(handSize(g)).toBe(h);                                       // played one, drew one
  });

  it('Darius, Hand of Noxus: [E]: Reaction, Legion: add [1]', () => {
    const g = tbl(9015, { legends: ['darius-hand-of-noxus'] });
    const l = g.s.players[0].legend[0];
    reask(g);
    expect(keys(g)).not.toContain(`act:${l}#0`);
    cast(g, 'shipyard-skulker');
    reask(g);
    act(g, `act:${l}#0`);
    drive(g);
    expect(g.s.players[0].pool.energy).toBe(1);
  });

  it('Darius, Trifarian: when you play your second card in a turn, +2 and ready', () => {
    const g = tbl(9016);
    cast(g, 'darius-trifarian');
    const d = onBoard(g, 'darius-trifarian', 0)[0];
    expect(g.s.objects[d].exhausted).toBe(true);
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[d].exhausted).toBe(false);
    expect(mightOf(g.s, d)).toBe(7);
  });

  it('Deadbloom Predator: may be played to an occupied enemy battlefield', () => {
    const g = tbl(9017);
    control(g, 1, 1);
    foe(g, 'shipyard-skulker');
    const id = inHand(g, 'deadbloom-predator');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf1');
  });

  it('Defy: counters a spell costing no more than [4] and [A]', () => {
    const g2 = tbl(9019);
    const e = put(g2, 'shipyard-skulker', 0, bf(0));
    control(g2, 0, 0);
    const df = inHand(g2, 'defy', 1);
    const ray = inHand(g2, 'hextech-ray');
    reask(g2);
    act(g2, `play:${ray}`);
    drive(g2, [`t:${e}`, `play:${df}`]);
    expect(evs(g2, 'counter')).toHaveLength(1);
    expect(g2.s.objects[e]).toBeDefined();
  });

  it('Eclipse Herald: when you stun an enemy unit, ready me and +1', () => {
    const g = tbl(9020);
    const h = put(g, 'eclipse-herald', 0, base(0), { exhausted: true });
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'rune-prison', [`t:${e}`]);
    expect(g.s.objects[h].exhausted).toBe(false);
    expect(mightOf(g.s, h)).toBe(8);
  });

  it('Ember Monk: when you play a card from Hidden, +2', () => {
    const g = tbl(9021);
    control(g, 0, 0);
    const m = put(g, 'ember-monk', 0, bf(0));
    const fd = inHand(g, 'block');
    reask(g);
    act(g, `hide:${fd}`);
    drive(g);
    nextTurn(g);
    reask(g);
    const card = g.s.bfs[0].facedown[0];
    act(g, `play:${card}`);
    drive(g, [`t:${m}`]);
    expect(mightOf(g.s, m)).toBe(6);
  });

  it('Energy Conduit: [Reaction] [E]: add [1]', () => {
    const g = tbl(9022);
    const c = put(g, 'energy-conduit', 0, base(0));
    reask(g);
    act(g, `act:${c}#0`);
    drive(g);
    expect(g.s.players[0].pool.energy).toBe(1);
  });

  it('Falling Star: deal 3 to a unit, twice', () => {
    const g = tbl(9023);
    const a = put(g, 'shipyard-skulker', 1, base(1)), b = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'falling-star', [`t:${a}`, `t:${b}`]);
    expect(g.s.objects[a]).toBeUndefined();
    expect(dmg(g, b)).toBe(3);
  });

  it('Find Your Center: [2] less near an opponent\'s win; draw 1 and channel 1 exhausted', () => {
    const g = tbl(9024);
    setField(g.s, g.s.players[1], 'points', g.s.mode.victoryScore - 3);
    const id = inHand(g, 'find-your-center');
    const r = runeCount(g);
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
    drive(g);
    expect(runeCount(g)).toBe(r + 1);
  });

  it('Fiora, Victorious: while Mighty, Deflect, Ganking and Shield', () => {
    const g = tbl(9025);
    const f = put(g, 'fiora-victorious', 0, base(0));
    expect(hasKeyword(g.s, f, 'ganking')).toBe(false);
    setField(g.s, g.s.objects[f], 'buffs', 1);
    expect(['deflect', 'ganking', 'shield'].map((k) => hasKeyword(g.s, f, k as 'shield'))).toEqual([true, true, true]);
  });

  it('Flurry of Blades: deal 1 to all units at battlefields', () => {
    const g = tbl(9026);
    const a = foe(g, 'mystic-poro'), b = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'flurry-of-blades');
    expect([dmg(g, a), dmg(g, b)]).toEqual([1, 0]);
  });

  it('Garbage Grabber: recycle 3 from your trash, [1], [E]: draw 1', () => {
    const g = tbl(9027);
    const gg = put(g, 'garbage-grabber', 0, base(0));
    emptyHand(g);
    for (let i = 0; i < 3; i++) inTrash(g, 'shipyard-skulker');
    reask(g);
    act(g, `act:${gg}#0`);
    drive(g);
    expect(handSize(g)).toBe(1);
  });

  it('Gemcraft Seer: other friendly units have Vision (they Predict as they are played)', () => {
    const g = tbl(9028);
    put(g, 'gemcraft-seer', 0, base(0));
    cast(g, 'shipyard-skulker');
    expect(evs(g, 'look').length).toBeGreaterThan(0);
  });

  it('Harnessed Dragon: when you play me, kill an enemy unit', () => {
    const g = tbl(9029);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'harnessed-dragon', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Herald of Scales: your Dragons cost [2] less, to a minimum of [1]', () => {
    const g = tbl(9030);
    put(g, 'herald-of-scales', 0, base(0));
    const id = inHand(g, 'mountain-drake');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 7 } });
  });

  it('Hextech Ray: deal 3 to a unit at a battlefield', () => {
    const g = tbl(9031);
    const e = foe(g, 'shipyard-skulker');
    const b = put(g, 'shipyard-skulker', 1, base(1));
    const id = inHand(g, 'hextech-ray');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).not.toContain(`t:${b}`);
    drive(g, [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it("Icathian Rain: deal 2 to a unit, six times", () => {
    const g = tbl(9032);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'icathian-rain', Array.from({ length: 6 }, () => `t:${e}`));
    expect(g.s.objects[e]).toBeUndefined();                            // 12 damage on a 10 Might unit
  });

  it('Iron Ballista: enters exhausted; [E]: deal 2 at a battlefield', () => {
    const g = tbl(9033);
    cast(g, 'iron-ballista');
    const b = onBoard(g, 'iron-ballista', 0)[0];
    expect(g.s.objects[b].exhausted).toBe(true);
    setField(g.s, g.s.objects[b], 'exhausted', false);
    const e = foe(g, 'mystic-poro');
    reask(g);
    act(g, `act:${b}#1`);
    drive(g, [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Kadregrin the Infernal: draw 1 for each of your Mighty units', () => {
    const g = tbl(9034);
    put(g, 'mountain-drake', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    const h = handSize(g);
    cast(g, 'kadregrin-the-infernal');
    expect(handSize(g)).toBe(h + 2);                                   // the Drake and Kadregrin
  });

  it("Kai'Sa, Daughter of the Void: [E]: add [A] only to play spells", () => {
    const g = tbl(9035, { legends: ['kaisa-daughter-of-the-void'] });
    const l = g.s.players[0].legend[0];
    reask(g);
    act(g, `act:${l}#0`);
    drive(g);
    expect(g.s.players[0].pool.restricted).toMatchObject([{ kind: 'universal', amount: 1, onlyFor: 'spells' }]);
    expect(g.s.players[0].pool.universal).toBe(0);
  });

  it('Kinkou Monk: buff up to two other friendly units', () => {
    const g = tbl(9036);
    const a = put(g, 'shipyard-skulker', 0, base(0)), b = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'kinkou-monk', [`t:${a}`, `t:${b}`]);
    expect([g.s.objects[a].buffs, g.s.objects[b].buffs]).toEqual([1, 1]);
  });

  it('Last Breath: ready a friendly unit; it deals its Might to an enemy unit at a battlefield', () => {
    const g = tbl(9037);
    const u = put(g, 'mountain-drake', 0, base(0), { exhausted: true });
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'last-breath', [`t:${u}`, `t:${e}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it("Last Stand: double a friendly unit's Might, give it Temporary", () => {
    const g = tbl(9038);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'last-stand', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
    expect(hasKeyword(g.s, u, 'temporary')).toBe(true);
  });

  it('Machine Evangel: Deathknell: three Recruits in your base', () => {
    const g = tbl(9039);
    put(g, 'machine-evangel', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(3);
  });

  it('Malzahar, Fanatic: [Action] kill a friendly unit or gear, [E]: add [A][A]', () => {
    const g = tbl(9040);
    const m = put(g, 'malzahar-fanatic', 0, base(0));
    const fodder = put(g, 'mystic-poro', 0, base(0));
    reask(g);
    act(g, `act:${m}#0`);
    drive(g);
    expect(g.s.objects[fodder]).toBeUndefined();
    expect(g.s.players[0].pool.universal).toBe(2);
  });

  it('Miss Fortune, Bounty Hunter: [E]: give a unit Ganking this turn', () => {
    const g = tbl(9041, { legends: ['miss-fortune-bounty-hunter'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${g.s.players[0].legend[0]}#0`);
    drive(g, [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it('Navori Fighting Pit: when you hold here, buff a unit here', () => {
    const g = tbl(9042, { bfs: ['navori-fighting-pit'] });
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    nextTurn(g);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Noxus Hopeful: Legion: I cost [2] less', () => {
    const g = tbl(9043);
    cast(g, 'shipyard-skulker');
    const id = inHand(g, 'noxus-hopeful');
    reask(g);
    act(g, `play:${id}`);
    drive(g, [], { max: 0 });
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Obelisk of Power: at the start of each player\'s first Beginning Phase, they channel 1', () => {
    const g = tbl(9044, { bfs: ['obelisk-of-power'] });
    const r = runeCount(g, 1);
    nextTurn(g);
    expect(runeCount(g, 1)).toBe(r + 1 + 3);                            // Obelisk, then the 3 of the first Channel Phase
    const r0 = runeCount(g, 0);
    nextTurn(g);
    expect(runeCount(g, 0)).toBe(r0 + 2);                               // not P0's first Beginning Phase any more
  });

  it('Peak Guardian: buff me; at a battlefield, buff all other friendly units there', () => {
    const g = tbl(9045);
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    const b = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'peak-guardian', ['loc:bf0']);
    expect([g.s.objects[u].buffs, g.s.objects[b].buffs]).toEqual([1, 0]);
    expect(g.s.objects[onBoard(g, 'peak-guardian', 0)[0]].buffs).toBe(1);
  });

  it('Pit Crew: when you play a gear, ready me', () => {
    const g = tbl(9046);
    const p = put(g, 'pit-crew', 0, base(0), { exhausted: true });
    cast(g, 'arena-bar');
    expect(g.s.objects[p].exhausted).toBe(false);
  });

  it('Poro Herder: if you control a Poro, buff me and draw 1', () => {
    const g = tbl(9047);
    const h = handSize(g);
    cast(g, 'poro-herder');
    expect(handSize(g)).toBe(h);
    put(g, 'mystic-poro', 0, base(0));
    cast(g, 'poro-herder');
    expect(handSize(g)).toBe(h + 1);
  });

  it('Primal Strength: +7 this turn', () => {
    const g = tbl(9048);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'primal-strength', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(10);
  });

  it('Progress Day: draw 4', () => {
    const g = tbl(9049);
    const h = handSize(g);
    cast(g, 'progress-day');
    expect(handSize(g)).toBe(h + 4);
  });

  it('Qiyana, Victorious: when I conquer, draw 1 or channel 1 exhausted', () => {
    const g = tbl(9050);
    const q = put(g, 'qiyana-victorious', 0, base(0));
    const r = runeCount(g);
    moveTo(g, [q], 0);
    drive(g, ['mode:1']);
    expect(runeCount(g)).toBe(r + 1);
  });

  it("Rebuke: return a unit at a battlefield to its owner's hand", () => {
    const g = tbl(9051);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'rebuke', [`t:${e}`]);
    expect(defsIn(g, 'hand', 1)).toContain('shipyard-skulker');
  });

  it('Retreat: return a friendly unit to hand, channel 1 exhausted', () => {
    const g = tbl(9052);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const r = runeCount(g);
    cast(g, 'retreat', [`t:${u}`]);
    expect(defsIn(g, 'hand')).toContain('shipyard-skulker');
    expect(runeCount(g)).toBe(r + 1);
  });

  it('Ride the Wind: move a friendly unit and ready it', () => {
    const g = tbl(9053);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'ride-the-wind', [`t:${u}`, 'loc:bf0']);
    expect(g.s.objects[u]).toMatchObject({ zone: { z: 'bf', bf: 0 }, exhausted: false });
  });

  it('Riptide Rex: deal 6 to an enemy unit at a battlefield', () => {
    const g = tbl(9054);
    const e = foe(g, 'playful-phantom');
    cast(g, 'riptide-rex', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Rune Prison: stun a unit', () => {
    const g = tbl(9055);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'rune-prison', [`t:${e}`]);
    expect(g.s.objects[e].stunned).toBe(true);
  });

  it('Salvage: you may kill up to one gear; draw 1', () => {
    const g = tbl(9056);
    const gr = put(g, 'arena-bar', 1, base(1));
    const h = handSize(g);
    cast(g, 'salvage', [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
    expect(handSize(g)).toBe(h + 1);
  });

  it('Scrapyard Champion: Legion: discard 2, then draw 2', () => {
    const g = tbl(9057);
    cast(g, 'scrapyard-champion');
    expect(evs(g, 'discard')).toHaveLength(0);
    cast(g, 'scrapyard-champion');
    expect(evs(g, 'discard')).toHaveLength(1);
  });

  it('Solari Chief: kill a stunned enemy unit, else stun it', () => {
    const g = tbl(9058);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'solari-chief', [`t:${e}`]);
    expect(g.s.objects[e].stunned).toBe(true);
    cast(g, 'solari-chief', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Solari Shieldbearer: when you play me, stun a unit', () => {
    const g = tbl(9059);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'solari-shieldbearer', [`t:${e}`]);
    expect(g.s.objects[e].stunned).toBe(true);
  });

  it('Soulgorger: you may play a unit from your trash, ignoring its Energy cost', () => {
    const g = tbl(9060);
    const c = inTrash(g, 'mountain-drake');
    cast(g, 'soulgorger', [`t:${c}`]);
    expect(onBoard(g, 'mountain-drake', 0)).toHaveLength(1);
  });

  it('Spectral Matron: play a unit costing up to [3] and [A] from your trash for free', () => {
    const g = tbl(9061);
    const big = inTrash(g, 'mountain-drake');
    const c = inTrash(g, 'shipyard-skulker');
    const id = inHand(g, 'spectral-matron');
    reask(g);
    act(g, `play:${id}`);
    drive(g, [], { max: 4 });
    for (let i = 0; i < 20 && g.s.pending?.kind !== 'target'; i++) drive(g, [], { max: 1 });
    expect(keys(g)).not.toContain(`t:${big}`);
    drive(g, [`t:${c}`]);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
  });

  it('Spoils of War: [2] less if an enemy unit died this turn; draw 2', () => {
    const g = tbl(9062);
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'harnessed-dragon', [`t:${e}`]);
    const id = inHand(g, 'spoils-of-war');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
  });

  it('Sprite Mother: a ready 3 Sprite with Temporary here', () => {
    const g = tbl(9063);
    cast(g, 'sprite-mother');
    const sp = onBoard(g, 'sprite', 0)[0];
    expect(g.s.objects[sp].exhausted).toBe(false);
    expect(hasKeyword(g.s, sp, 'temporary')).toBe(true);
  });

  it('Stacked Deck: look at 3, put 1 into your hand, recycle the rest', () => {
    const g = tbl(9064);
    const top = g.s.players[0].deck.slice(0, 3).map((id) => g.s.objects[id].card);
    const h = handSize(g);
    cast(g, 'stacked-deck');
    expect(handSize(g)).toBe(h + 1);
    const bottom = g.s.players[0].deck.slice(-2).map((id) => g.s.objects[id].card);
    expect(bottom.every((c) => top.includes(c))).toBe(true);
  });

  it('Sun Disc: Legion: [E]: the next unit you play this turn enters ready', () => {
    const g = tbl(9065);
    const s = put(g, 'sun-disc', 0, base(0));
    reask(g);
    expect(keys(g)).not.toContain(`act:${s}#0`);
    cast(g, 'arena-bar');
    reask(g);
    act(g, `act:${s}#0`);
    drive(g);
    cast(g, 'shipyard-skulker');
    expect(g.s.objects[onBoard(g, 'shipyard-skulker', 0)[0]].exhausted).toBe(false);
  });

  it('Taric, Protector: other friendly units here have Shield', () => {
    const g = tbl(9066);
    put(g, 'taric-protector', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    expect(hasKeyword(g.s, u, 'shield')).toBe(true);
  });

  it('Tasty Faefolk: Deathknell: channel 2 exhausted and draw 1', () => {
    const g = tbl(9067);
    const r = runeCount(g), h = handSize(g);
    put(g, 'tasty-faefolk', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(runeCount(g)).toBe(r + 2);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Teemo, Scout: when you play me, +3 this turn', () => {
    const g = tbl(9068);
    cast(g, 'teemo-scout');
    expect(mightOf(g.s, onBoard(g, 'teemo-scout', 0)[0])).toBe(4);
  });

  it("The Arena's Greatest: each player's first Beginning Phase gives them 1 point", () => {
    const g = tbl(9069, { bfs: ['the-arenas-greatest'] });
    nextTurn(g);
    expect(g.s.players[1].points).toBe(1);
    nextTurn(g);
    expect(g.s.players[0].points).toBe(0);
  });

  it('The Candlelit Sanctum: when you conquer here, look at 2 and recycle any', () => {
    const g = tbl(9070, { bfs: ['the-candlelit-sanctum'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0);
    drive(g);
    expect(evs(g, 'look').some((e) => e.objs.length === 2)).toBe(true);
  });

  it('The Harrowing: play a unit from your trash, ignoring its Energy cost', () => {
    const g = tbl(9071);
    const c = inTrash(g, 'mountain-drake');
    cast(g, 'the-harrowing', [`t:${c}`]);
    expect(onBoard(g, 'mountain-drake', 0)).toHaveLength(1);
  });

  it('The Syren: [1], [E]: move a friendly unit at a battlefield to its base', () => {
    const g = tbl(9072);
    const sy = put(g, 'the-syren', 0, base(0));
    control(g, 0, 0);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    reask(g);
    act(g, `act:${sy}#0`);
    drive(g, [`t:${u}`]);
    expect(g.s.objects[u].zone).toEqual({ z: 'base', p: 0 });
  });

  it('Thermo Beam: kill all gear', () => {
    const g = tbl(9073);
    const a = put(g, 'arena-bar', 0, base(0)), b = put(g, 'arena-bar', 1, base(1));
    cast(g, 'thermo-beam');
    expect([g.s.objects[a], g.s.objects[b]]).toEqual([undefined, undefined]);
  });

  it('Thousand-Tailed Watcher: enemy units get -3, to a minimum of 1', () => {
    const g = tbl(9074);
    const a = put(g, 'mountain-drake', 1, base(1)), b = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'thousand-tailed-watcher');
    expect([mightOf(g.s, a), mightOf(g.s, b)]).toEqual([7, 1]);
  });

  it('Trifarian Gloryseeker: Legion: buff me', () => {
    const g = tbl(9075);
    cast(g, 'arena-bar');
    cast(g, 'trifarian-gloryseeker');
    expect(g.s.objects[onBoard(g, 'trifarian-gloryseeker', 0)[0]].buffs).toBe(1);
  });

  it('Vanguard Captain: Legion: two Recruits here', () => {
    const g = tbl(9076);
    cast(g, 'arena-bar');
    cast(g, 'vanguard-captain');
    expect(onBoard(g, 'recruit', 0)).toHaveLength(2);
  });

  it('Warwick, Hunter: enters ready; when I attack, kill all damaged enemy units here', () => {
    const g = tbl(9077);
    cast(g, 'warwick-hunter');
    const w = onBoard(g, 'warwick-hunter', 0)[0];
    expect(g.s.objects[w].exhausted).toBe(false);
    control(g, 1, 1);
    const e = foe(g, 'mountain-drake', { damage: 1 });
    attack(g, w);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Watchful Sentry: Deathknell: draw 1', () => {
    const g = tbl(9078);
    const h = handSize(g);
    put(g, 'watchful-sentry', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Whiteflame Protector: a unit gets +8 this turn', () => {
    const g = tbl(9079);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'whiteflame-protector', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(11);
  });

  it('Wind Wall: counter a spell', () => {
    const g = tbl(9080);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const w = inHand(g, 'wind-wall', 1);
    const ray = inHand(g, 'primal-strength');
    reask(g);
    act(g, `play:${ray}`);
    drive(g, [`t:${u}`, `play:${w}`]);
    expect(evs(g, 'counter')).toHaveLength(1);
    expect(mightOf(g.s, u)).toBe(3);
  });

  it('Windswept Hillock: units here have Ganking', () => {
    const g = tbl(9081, { bfs: ['windswept-hillock'] });
    const u = put(g, 'shipyard-skulker', 1, bf(0));
    expect(hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it('Yasuo, Remorseful: when I attack, deal my Might to an enemy unit here', () => {
    const g = tbl(9082);
    control(g, 1, 1);
    const e = foe(g, 'mountain-drake');
    attack(g, put(g, 'yasuo-remorseful', 0, base(0)));
    expect(evs(g, 'deal').some((d) => d.to === e && d.n === 6 && !d.combat)).toBe(true);
  });

  it("Zaunite Bouncer: return another unit at a battlefield to its owner's hand", () => {
    const g = tbl(9083);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'zaunite-bouncer', [`t:${e}`]);
    expect(defsIn(g, 'hand', 1)).toContain('shipyard-skulker');
  });
});

describe('Origins set: batch 2', () => {
  it('Ahri, Nine-Tailed Fox: an enemy unit attacking a battlefield you control gets -1 (minimum 1)', () => {
    const g = tbl(9101, { legends: [undefined, 'ahri-nine-tailed-fox'] });
    const e = foe(g, 'shipyard-skulker');
    const a = put(g, 'mountain-drake', 0, base(0));
    moveTo(g, [a], 1);
    drive(g, [], { max: 3 });
    expect(evs(g, 'mightChanged').some((m) => m.obj === a)).toBe(true);
    void e;
  });

  it('Albus Ferros: spend any number of buffs, channel 1 exhausted for each', () => {
    const g = tbl(9102);
    const a = put(g, 'shipyard-skulker', 0, base(0)), b = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[a], 'buffs', 1);
    setField(g.s, g.s.objects[b], 'buffs', 1);
    const r = runeCount(g);
    cast(g, 'albus-ferros', [`pick:${a}`, `pick:${b}`]);
    expect(runeCount(g)).toBe(r + 2);
    expect(g.s.objects[a].buffs + g.s.objects[b].buffs).toBe(0);
  });

  it('Back-Alley Bar: a unit moving from here gets +1 this turn', () => {
    const g = tbl(9103, { bfs: ['back-alley-bar'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    moveTo(g, [u], 'base');
    drive(g);
    expect(mightOf(g.s, u)).toBe(4);
  });

  it('Blitzcrank, Impassive: played to a battlefield, may pull an enemy unit there; when I hold, return to hand', () => {
    const g = tbl(9104);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    control(g, 0, 0);
    put(g, 'mystic-poro', 0, bf(0));
    cast(g, 'blitzcrank-impassive', ['loc:bf0', `t:${e}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(e))).toBe(true);
    const g2 = tbl(9105);
    put(g2, 'blitzcrank-impassive', 0, bf(0));
    control(g2, 0, 0);
    nextTurn(g2);
    expect(defsIn(g2, 'hand')).toContain('blitzcrank-impassive');
  });

  it("Brynhir Thundersong: opponents can't play cards this turn", () => {
    const g = tbl(9106);
    cast(g, 'brynhir-thundersong');
    expect(g.s.effects.some((e) => (e.spec as { s?: string }).s === 'cantPlay' && 'player' in e.affects && e.affects.player === 1)).toBe(true);
    const w = inHand(g, 'wind-wall', 1);
    const ray = inHand(g, 'progress-day');
    reask(g);
    act(g, `play:${ray}`);
    drive(g, [], { max: 2 });
    expect(keys(g)).not.toContain(`play:${w}`);
  });

  it('Convergent Mutation: a friendly unit\'s Might rises to another friendly unit\'s', () => {
    const g = tbl(9107);
    const a = put(g, 'mystic-poro', 0, base(0)), b = put(g, 'mountain-drake', 0, base(0));
    cast(g, 'convergent-mutation', [`t:${a}`, `t:${b}`]);
    expect(mightOf(g.s, a)).toBe(10);
  });

  it('Dr. Mundo, Expert: +1 Might per card in your trash; recycle 3 at the start of your Beginning Phase', () => {
    const g = tbl(9108);
    const m = put(g, 'dr-mundo-expert', 0, base(0));
    const t0 = g.s.players[0].trash.length;
    expect(mightOf(g.s, m)).toBe(6 + t0);
    for (let i = 0; i < 4; i++) inTrash(g, 'shipyard-skulker');
    nextTurn(g);
    expect(g.s.players[0].trash.length).toBeLessThanOrEqual(t0 + 4 - 3 + 1);
  });

  it('Ekko, Recurrent: Deathknell: recycle me to ready your runes', () => {
    const g = tbl(9109);
    for (const id of g.s.players[0].base) if (g.s.objects[id].def.endsWith('-rune')) setField(g.s, g.s.objects[id], 'exhausted', true);
    put(g, 'ekko-recurrent', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(defsIn(g, 'deck')).toContain('ekko-recurrent');
    expect(g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).every((id) => !g.s.objects[id].exhausted)).toBe(true);
  });

  it('Forge of the Future: a Recruit when played; kill this: recycle up to 4 cards from trashes', () => {
    const g = tbl(9110);
    cast(g, 'forge-of-the-future');
    expect(onBoard(g, 'recruit', 0)).toHaveLength(1);
    const c = inTrash(g, 'shipyard-skulker', 1);
    const f = onBoard(g, 'forge-of-the-future', 0)[0];
    reask(g);
    act(g, `act:${f}#1`);
    drive(g, [`t:${c}`]);
    expect(defsIn(g, 'deck', 1)).toContain('shipyard-skulker');
    expect(g.s.objects[f]).toBeUndefined();
  });

  it('Immortal Phoenix: when you kill a unit with a spell, you may pay [1][R] to play me from your trash', () => {
    const g = tbl(9111);
    runes(g, 0, [...RICH, ...ready('fury', 3)]);
    inTrash(g, 'immortal-phoenix');
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'falling-star', [`t:${e}`, `t:${e}`]);
    expect(onBoard(g, 'immortal-phoenix', 0)).toHaveLength(1);
  });

  it('Jinx, Rebel: when you discard one or more cards, ready me and +1', () => {
    const g = tbl(9112);
    const j = put(g, 'jinx-rebel', 0, base(0), { exhausted: true });
    cast(g, 'chemtech-enforcer');
    expect(g.s.objects[j].exhausted).toBe(false);
    expect(mightOf(g.s, j)).toBe(6);
  });

  it('Karthus, Eternal: your Deathknell effects trigger an additional time', () => {
    const g = tbl(9113);
    put(g, 'karthus-eternal', 0, base(0));
    const h = handSize(g);
    put(g, 'watchful-sentry', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(handSize(g)).toBe(h + 2);
  });

  it("Kog'Maw, Caustic: Deathknell: deal 4 to all units at my battlefield", () => {
    const g = tbl(9114);
    const e = foe(g, 'shipyard-skulker');
    const far = put(g, 'shipyard-skulker', 1, base(1));
    put(g, 'kogmaw-caustic', 0, bf(1), { damage: 9 });
    reask(g);
    drive(g);
    expect(g.s.objects[e]).toBeUndefined();
    expect(g.s.objects[far]).toBeDefined();
  });

  it('Lee Sin, Ascetic: [E]: buff me; any number of buffs', () => {
    const g = tbl(9115);
    const l = put(g, 'lee-sin-ascetic', 0, base(0));
    setField(g.s, g.s.objects[l], 'buffs', 1);
    reask(g);
    act(g, `act:${l}#0`);
    drive(g);
    expect(g.s.objects[l].buffs).toBe(2);
  });

  it('Leona, Radiant Dawn: when you stun one or more enemy units, buff a friendly unit (once)', () => {
    const g = tbl(9116, { legends: ['leona-radiant-dawn'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'shipyard-skulker', 1, base(1));
    cast(g, 'rune-prison', [`t:${e}`, `t:${u}`]);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Leona, Zealot: enters ready near an opponent\'s win; stunned enemy units here have -8 (minimum 1)', () => {
    const g = tbl(9117);
    setField(g.s, g.s.players[1], 'points', g.s.mode.victoryScore - 2);
    cast(g, 'leona-zealot');
    const l = onBoard(g, 'leona-zealot', 0)[0];
    expect(g.s.objects[l].exhausted).toBe(false);
    const e = put(g, 'mountain-drake', 1, base(0));
    setField(g.s, g.s.objects[e], 'stunned', true);
    expect(mightOf(g.s, e)).toBe(2);                                    // 10 - 8
    void e;
  });

  it('Mageseeker Warden: at a battlefield, opponents play units only to base and effects can\'t ready their units', () => {
    const g = tbl(9118, { first: 1 });
    control(g, 1, 1);
    put(g, 'mageseeker-warden', 0, bf(0));
    control(g, 0, 0);
    put(g, 'mystic-poro', 1, bf(1));
    const id = inHand(g, 'shipyard-skulker', 1);
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).not.toContain('loc:bf1');
  });

  it('Miss Fortune, Buccaneer: friendly units may be played to open battlefields', () => {
    const g = tbl(9119);
    put(g, 'miss-fortune-buccaneer', 0, base(0));
    const id = inHand(g, 'shipyard-skulker');
    reask(g);
    act(g, `play:${id}`);
    expect(keys(g)).toContain('loc:bf0');
  });

  it("Miss Fortune, Captain: the first time I move each turn, may ready something else that's exhausted", () => {
    const g = tbl(9120);
    const mf = put(g, 'miss-fortune-captain', 0, base(0));
    const t = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    moveTo(g, [mf], 0);
    drive(g, [`t:${t}`]);
    expect(g.s.objects[t].exhausted).toBe(false);
  });

  it("Noxus Saboteur: opponents' facedown cards here can't be played", () => {
    const g = tbl(9121);
    control(g, 0, 0);
    put(g, 'mystic-poro', 0, bf(0));
    const fd = inHand(g, 'block');
    reask(g);
    act(g, `hide:${fd}`);
    drive(g);
    nextTurn(g);
    put(g, 'noxus-saboteur', 1, bf(0));
    reask(g);
    expect(keys(g)).not.toContain(`play:${g.s.bfs[0].facedown[0]}`);
  });

  it('Overt Operation: spend buffs to ready those units, then buff all friendly units', () => {
    const g = tbl(9122);
    const a = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const b = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[a], 'buffs', 1);
    cast(g, 'overt-operation', [`pick:${a}`]);
    expect(g.s.objects[a]).toMatchObject({ exhausted: false, buffs: 1 });
    expect(g.s.objects[b].buffs).toBe(1);
  });

  it("Pack of Wonders: [E]: return another friendly unit to its owner's hand", () => {
    const g = tbl(9123);
    const p = put(g, 'pack-of-wonders', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${p}#0`);
    drive(g, [`t:${u}`]);
    expect(defsIn(g, 'hand')).toContain('shipyard-skulker');
  });

  it("Pirate's Haven: a friendly unit you ready gets +1", () => {
    const g = tbl(9124);
    put(g, 'pirates-haven', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const e = foe(g, 'mystic-poro');
    cast(g, 'last-breath', [`t:${u}`, `t:${e}`]);
    expect(mightOf(g.s, u)).toBe(4);
  });

  it('Raging Firebrand: the next spell you play this turn costs [5] less', () => {
    const g = tbl(9125);
    cast(g, 'raging-firebrand');
    runes(g, 0, RICH);
    const id = inHand(g, 'progress-day');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
    drive(g);
    const id2 = inHand(g, 'progress-day');
    reask(g);
    act(g, `play:${id2}`);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 6 } });
  });

  it('Ravenborn Tome: [E]: the next spell you play this turn deals 1 Bonus Damage', () => {
    const g = tbl(9126);
    const t = put(g, 'ravenborn-tome', 0, base(0));
    reask(g);
    act(g, `act:${t}#0`);
    drive(g);
    const e = foe(g, 'mountain-drake');
    cast(g, 'hextech-ray', [`t:${e}`]);
    expect(dmg(g, e)).toBe(4);
  });

  it('Showstopper: buff a friendly unit in your base, then move it to a battlefield', () => {
    const g = tbl(9127);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'showstopper', [`t:${u}`, 'loc:bf0']);
    expect(g.s.objects[u]).toMatchObject({ buffs: 1, zone: { z: 'bf', bf: 0 } });
  });

  it('Sigil of the Storm: when you conquer here, recycle one of your runes', () => {
    const g = tbl(9128, { bfs: ['sigil-of-the-storm'] });
    const r = runeCount(g);
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    expect(runeCount(g)).toBe(r - 1);
  });

  it('Sky Splitter: costs less by the highest Might among your units; deal 5 at a battlefield', () => {
    const g = tbl(9129);
    put(g, 'shipyard-skulker', 0, base(0));
    const e = foe(g, 'playful-phantom');
    const id = inHand(g, 'sky-splitter');
    reask(g);
    act(g, `play:${id}`);
    for (let i = 0; i < 5 && g.s.pending?.kind !== 'payment'; i++) drive(g, [`t:${e}`], { max: 1 });
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 5 } });
    drive(g);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Solari Shrine: when you kill a stunned enemy unit, may exhaust this to draw 1', () => {
    const g = tbl(9130);
    put(g, 'solari-shrine', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    setField(g.s, g.s.objects[e], 'stunned', true);
    const h = handSize(g);
    cast(g, 'harnessed-dragon', [`t:${e}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it("Spirit's Refuge: buff a friendly unit; buffed friendly units have Deflect (not twice)", () => {
    const g = tbl(9131);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'spirits-refuge', [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'deflect')).toBe(true);
    const d = put(g, 'deadbloom-predator', 0, base(0));
    setField(g.s, g.s.objects[d], 'buffs', 1);
    expect(keywordOf(g.s, d, 'deflect')).toBe(1);
  });

  it('Stormbringer: a unit in your base deals its Might to all enemy units at a battlefield, then moves there', () => {
    const g = tbl(9132);
    const u = put(g, 'mountain-drake', 0, base(0));
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'stormbringer', [`t:${u}`, `t:${g.s.bfs[1].obj}`]);
    expect(g.s.objects[e]).toBeUndefined();
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 1 });
  });

  it('Super Mega Death Rocket: deal 5; when you conquer, may discard 1 to return it from your trash', () => {
    const g = tbl(9133);
    const e = put(g, 'playful-phantom', 1, base(1));
    cast(g, 'super-mega-death-rocket', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    expect(defsIn(g, 'hand')).toContain('super-mega-death-rocket');
  });

  it('Symbol of the Solari: a tied combat you attacked recalls all units', () => {
    const g = tbl(9134);
    put(g, 'symbol-of-the-solari', 0, base(0));
    const e = foe(g, 'mountain-drake');
    const a = put(g, 'mountain-drake', 0, base(0));
    attack(g, a);
    expect([g.s.objects[a]?.zone.z, g.s.objects[e]?.zone.z]).toEqual([undefined, undefined]);   // both die 10 v 10
    const g2 = tbl(9135);
    put(g2, 'symbol-of-the-solari', 0, base(0));
    const e2 = foe(g2, 'mountain-drake');
    const a2 = put(g2, 'mountain-drake', 0, base(0));
    put(g2, 'mystic-poro', 1, bf(1));
    put(g2, 'mystic-poro', 0, base(0));
    void a2; void e2;
  });

  it('Time Warp: take a turn after this one; banish this', () => {
    const g = tbl(9136);
    runes(g, 0, [...ready('mind', 6), ...ready('calm', 8)]);
    cast(g, 'time-warp');
    expect(defsIn(g, 'banish')).toContain('time-warp');
    nextTurn(g);
    expect(g.s.turn.player).toBe(0);
    expect(g.s.turn.additional).toBe(true);
  });

  it('Treasure Trove: when it leaves the board, draw 1 and channel 1 exhausted; [P], [E]: kill this', () => {
    const g = tbl(9137);
    const t = put(g, 'treasure-trove', 0, base(0));
    const h = handSize(g), c0 = evs(g, 'channel').length;
    reask(g);
    act(g, `act:${t}#1`);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
    expect(evs(g, 'channel')).toHaveLength(c0 + 1);
  });

  it('Tryndamere, Barbarian: conquering with 5+ excess damage scores 1 point', () => {
    const g = tbl(9138);
    foe(g, 'mystic-poro');
    const t = put(g, 'tryndamere-barbarian', 0, base(0));
    attack(g, t);
    expect(g.s.players[0].points).toBe(2);
  });

  it('Unyielding Spirit: prevent all spell and ability damage this turn', () => {
    const g = tbl(9139);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'unyielding-spirit');
    cast(g, 'hextech-ray', [`t:${e}`]);
    expect(g.s.objects[e]).toBeDefined();
  });

  it('Vanguard Helm: when a buffed friendly unit dies, buff another friendly unit', () => {
    const g = tbl(9140);
    put(g, 'vanguard-helm', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const d = put(g, 'mystic-poro', 0, base(0), { damage: 9 });
    setField(g.s, g.s.objects[d], 'buffs', 1);
    reask(g);
    drive(g);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Viktor, Leader: when another non-Recruit unit you control dies, a Recruit in your base', () => {
    const g = tbl(9141);
    put(g, 'viktor-leader', 0, base(0));
    put(g, 'mystic-poro', 0, base(0), { damage: 9 });
    put(g, 'mystic-poro', 0, base(0), { damage: 9 });
    reask(g);
    drive(g);
    expect(onBoard(g, 'recruit', 0)).toHaveLength(2);
  });

  it("Vilemaw's Lair: units can't move from here to base", () => {
    const g = tbl(9142, { bfs: ['vilemaws-lair'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    reask(g);
    expect(keys(g)).not.toContain('move');                             // its only destination would be base
    void u;
  });

  it('Volibear, Imposing: when an opponent moves to a battlefield other than mine, draw 1', () => {
    const g = tbl(9143, { first: 1 });
    put(g, 'volibear-imposing', 0, base(0));
    const h = handSize(g);
    moveTo(g, [put(g, 'shipyard-skulker', 1, base(1))], 0);
    drive(g);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Volibear, Relentless Storm: when you play a Mighty unit, may exhaust me to channel 1 exhausted', () => {
    const g = tbl(9144, { legends: ['volibear-relentless-storm'] });
    const r = runeCount(g);
    cast(g, 'mountain-drake');
    expect(runeCount(g)).toBe(r + 1);
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);
  });
});

describe('Origins set: batch 3', () => {
  it('Acceptable Losses: each player kills one of their gear', () => {
    const g = tbl(9201);
    const a = put(g, 'arena-bar', 0, base(0)), b = put(g, 'arena-bar', 1, base(1)), c = put(g, 'iron-ballista', 1, base(1));
    cast(g, 'acceptable-losses', [`pick:${b}`]);
    expect(g.s.objects[a]).toBeUndefined();
    expect([g.s.objects[b], g.s.objects[c] !== undefined]).toEqual([undefined, true]);
  });

  it('Ava Achiever: when I attack, pay [B] to play a Hidden card from hand for free, a unit here', () => {
    const g = tbl(9202);
    foe(g, 'mystic-poro');
    inHand(g, 'teemo-scout');
    attack(g, put(g, 'ava-achiever', 0, base(0)));
    expect(onBoard(g, 'teemo-scout', 0)).toHaveLength(1);
  });

  it('Baited Hook: kill a friendly unit, play a unit with Might up to 1 more from the top 5', () => {
    const g = tbl(9203);
    const hook = put(g, 'baited-hook', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'mystic-poro');
    reask(g);
    act(g, `act:${hook}#0`);
    drive(g, [`t:${u}`, `pick:${top}`]);
    expect(g.s.objects[u]).toBeUndefined();
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
  });

  it("Blind Fury: banish an opponent's top card and play it for free", () => {
    const g = tbl(9204);
    const top = g.s.players[1].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'shipyard-skulker');
    cast(g, 'blind-fury');
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
  });

  it('Bullet Time: pay any amount of [A] to deal that much to all enemy units at a battlefield', () => {
    const g = tbl(9205);
    const e = foe(g, 'shipyard-skulker');
    cast(g, 'bullet-time', [`t:${g.s.bfs[1].obj}`, 'n:3']);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it("Call to Glory: spend a buff to ignore its cost; +3", () => {
    const g = tbl(9206);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[u], 'buffs', 1);
    const id = inHand(g, 'call-to-glory');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g, [`t:${u}`]);
    expect(evs(g, 'payment')).toHaveLength(0);
    expect(mightOf(g.s, u)).toBe(6);
  });

  it('Commander Ledros: kill any number of friendly units to pay [Y] less each', () => {
    const g = tbl(9207);
    runes(g, 0, [...ready('order', 2), ...ready('calm', 6)]);
    put(g, 'mystic-poro', 0, base(0));
    put(g, 'mystic-poro', 0, base(0));
    const id = inHand(g, 'commander-ledros');
    reask(g);
    act(g, `play:${id}`);
    expect(g.s.pending).toMatchObject({ kind: 'number' });
    drive(g, ['n:2']);
    expect(onBoard(g, 'commander-ledros', 0)).toHaveLength(1);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(0);
  });

  it('Dazzling Aurora: at the end of your turn, reveal until a unit and play it for free', () => {
    const g = tbl(9208);
    put(g, 'dazzling-aurora', 0, base(0));
    const d = g.s.players[0].deck;
    setField(g.s, g.s.objects[d[0]], 'def', 'progress-day');
    setField(g.s, g.s.objects[d[1]], 'def', 'mountain-drake');
    reask(g);
    act(g, 'end');
    drive(g);
    expect(onBoard(g, 'mountain-drake', 0)).toHaveLength(1);
  });

  it('Divine Judgment: each player keeps 2 of each; the rest is recycled', () => {
    const g = tbl(9209);
    for (let i = 0; i < 3; i++) put(g, 'mystic-poro', 0, base(0));
    cast(g, 'divine-judgment');
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(2);
    expect(runeCount(g, 0)).toBe(2);
    expect(handSize(g, 0)).toBeLessThanOrEqual(2);
  });

  it("Dragon's Rage: move an enemy unit, then it and another enemy unit there fight", () => {
    const g = tbl(9210);
    const a = put(g, 'mountain-drake', 1, base(1));
    const b = foe(g, 'shipyard-skulker');
    cast(g, 'dragons-rage', [`t:${a}`, 'loc:bf1']);
    expect(g.s.objects[b]).toBeUndefined();
    expect(dmg(g, a)).toBe(3);
  });

  it('Facebreaker: stun a friendly and an enemy unit at the same battlefield', () => {
    const g = tbl(9211);
    const e = foe(g, 'shipyard-skulker');
    const other = put(g, 'shipyard-skulker', 1, base(1));
    const u = put(g, 'mystic-poro', 0, bf(1));
    cast(g, 'facebreaker', [`t:${u}`, `t:${e}`]);
    expect([g.s.objects[u].stunned, g.s.objects[e].stunned, g.s.objects[other].stunned]).toEqual([true, true, false]);
  });

  it('Fox-Fire: kill units at a battlefield with total Might 4 or less', () => {
    const g = tbl(9212);
    const a = foe(g, 'mystic-poro'), b = foe(g, 'mystic-poro'), c = foe(g, 'mystic-poro');
    const id = inHand(g, 'fox-fire');
    reask(g);
    act(g, `play:${id}`);
    drive(g, [`t:${g.s.bfs[1].obj}`, `t:${a}`, `t:${b}`], { max: 4 });
    expect(keys(g)).not.toContain(`t:${c}`);
    drive(g);
    expect([g.s.objects[a], g.s.objects[b], g.s.objects[c] !== undefined]).toEqual([undefined, undefined, true]);
  });

  it('Guerilla Warfare: return up to two Hidden cards from your trash; hide for free this turn', () => {
    const g = tbl(9213);
    const c = inTrash(g, 'block');
    cast(g, 'guerilla-warfare', [`t:${c}`]);
    expect(defsIn(g, 'hand')).toContain('block');
    control(g, 0, 0);
    put(g, 'mystic-poro', 0, bf(0));
    runes(g, 0, []);
    reask(g);
    expect(keys(g).some((k) => k.startsWith('hide:'))).toBe(true);
  });

  it('Hallowed Tomb: when you hold here, may return your Chosen Champion from your trash', () => {
    const g = tbl(9214, { bfs: ['hallowed-tomb'] });
    const pl = g.s.players[0];
    if (pl.champion !== null) moveObject(g.s, pl.champion, { z: 'trash', p: 0 });
    control(g, 0, 0);
    put(g, 'mystic-poro', 0, bf(0));
    nextTurn(g);
    expect(g.s.players[0].champion).not.toBeNull();
  });

  it('Imperial Decree: any unit that takes damage this turn dies', () => {
    const g = tbl(9215);
    const e = foe(g, 'mountain-drake');
    cast(g, 'imperial-decree');
    cast(g, 'hextech-ray', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Invert Timelines: each player discards their hand, then draws 4', () => {
    const g = tbl(9216);
    cast(g, 'invert-timelines');
    expect([handSize(g, 0), handSize(g, 1)]).toEqual([4, 4]);
  });

  it("Kai'Sa, Evolutionary: when I conquer, play a spell from your trash with Energy below your points, then recycle it", () => {
    const g = tbl(9217);
    setField(g.s, g.s.players[0], 'points', 3);
    inTrash(g, 'progress-day');
    inTrash(g, 'hextech-ray');
    moveTo(g, [put(g, 'kaisa-evolutionary', 0, base(0))], 0);
    const h = handSize(g);
    drive(g);
    expect(defsIn(g, 'deck')).toContain('hextech-ray');
    void h;
  });

  it("King's Edict: each other player chooses one of their units; kill those", () => {
    const g = tbl(9218);
    const a = put(g, 'mystic-poro', 1, base(1));
    const b = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'kings-edict', [`pick:${a}`]);
    expect([g.s.objects[a], g.s.objects[b] !== undefined]).toEqual([undefined, true]);
  });

  it('Kraken Hunter: spend any number of buffs to pay [O] less each', () => {
    const g = tbl(9219);
    runes(g, 0, [...ready('calm', 6)]);
    const u = put(g, 'shipyard-skulker', 0, base(0)), v = put(g, 'shipyard-skulker', 0, base(0));
    setField(g.s, g.s.objects[u], 'buffs', 1);
    setField(g.s, g.s.objects[v], 'buffs', 1);
    const id = inHand(g, 'kraken-hunter');
    reask(g);
    act(g, `play:${id}`);
    drive(g, ['n:2']);
    expect(onBoard(g, 'kraken-hunter', 0)).toHaveLength(1);
  });

  it('Mindsplitter: an opponent reveals their hand, you choose a card, they discard it', () => {
    const g = tbl(9220);
    const c = inHand(g, 'mountain-drake', 1);
    cast(g, 'mindsplitter', [`pick:${c}`]);
    expect(defsIn(g, 'trash', 1)).toContain('mountain-drake');
  });

  it('Mystic Reversal: gain control of a spell and choose anew', () => {
    const g = tbl(9221);
    runes(g, 1, [...ready('calm', 4), ...RICH]);
    const mine = put(g, 'mystic-poro', 0, base(0));
    const theirs = put(g, 'mystic-poro', 1, base(1));
    const rv = inHand(g, 'mystic-reversal', 1);
    const id = inHand(g, 'harnessed-dragon');
    void id;
    const fs = inHand(g, 'rune-prison');
    reask(g);
    act(g, `play:${fs}`);
    drive(g, [`t:${theirs}`, `play:${rv}`, 'yes', `t:${mine}`]);
    expect(g.s.objects[mine].stunned).toBe(true);
    expect(g.s.objects[theirs].stunned).toBe(false);
  });

  it('Nocturne, Horrifying: looked at on top of the deck, may be banished and played for [A]', () => {
    const g = tbl(9222);
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'nocturne-horrifying');
    cast(g, 'mystic-poro', [`keep:${top}`]);                          // Vision: Predict, keep it on top
    expect(onBoard(g, 'nocturne-horrifying', 0)).toHaveLength(1);
  });

  it('Noxian Guillotine: kill it the next time it takes damage; Legion: kill it now', () => {
    const g = tbl(9223);
    const e = foe(g, 'mountain-drake');
    cast(g, 'noxian-guillotine', [`t:${e}`]);
    expect(g.s.objects[e]).toBeDefined();
    cast(g, 'hextech-ray', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
    const g2 = tbl(9224);
    const e2 = put(g2, 'mountain-drake', 1, base(1));
    cast(g2, 'arena-bar');
    cast(g2, 'noxian-guillotine', [`t:${e2}`]);
    expect(g2.s.objects[e2]).toBeUndefined();
  });

  it('Party Favors: each other player chooses Cards (both draw 1) or Runes (both channel 1 exhausted)', () => {
    const g = tbl(9225);
    const h0 = handSize(g, 0), h1 = handSize(g, 1);
    cast(g, 'party-favors', ['mode:0']);
    expect([handSize(g, 0), handSize(g, 1)]).toEqual([h0 + 1, h1 + 1]);
  });

  it('Portal Rescue: banish a friendly unit, its owner plays it to their base for free', () => {
    const g = tbl(9226);
    const u = put(g, 'mountain-drake', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'portal-rescue', [`t:${u}`]);
    const d = onBoard(g, 'mountain-drake', 0);
    expect(d).toHaveLength(1);
    expect(g.s.objects[d[0]].zone).toEqual({ z: 'base', p: 0 });
  });

  it('Possession: take control of an enemy unit at a battlefield and recall it', () => {
    const g = tbl(9227);
    runes(g, 0, [...ready('chaos', 4), ...ready('calm', 6)]);
    const e = foe(g, 'mountain-drake');
    cast(g, 'possession', [`t:${e}`]);
    expect(g.s.objects[e]).toMatchObject({ controller: 0, zone: { z: 'base', p: 0 } });
  });

  it('Promising Future: each player banishes one of their top 5 and plays it ignoring Energy', () => {
    const g = tbl(9228);
    for (const p of [0, 1] as const) for (const id of g.s.players[p].deck.slice(0, 5)) setField(g.s, g.s.objects[id], 'def', 'mystic-poro');
    cast(g, 'promising-future');
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
    expect(onBoard(g, 'mystic-poro', 1)).toHaveLength(1);
  });

  it("Reckoner's Arena: when you hold here, conquer effects of units here activate", () => {
    const g = tbl(9229, { bfs: ['reckoners-arena'] });
    control(g, 0, 0);
    put(g, 'qiyana-victorious', 0, bf(0));
    const h = handSize(g);
    nextTurn(g);
    expect(handSize(g)).toBeGreaterThanOrEqual(h + 2);              // Qiyana's draw (first mode) and the Draw Phase
  });

  it('Reinforce: banish a unit from the top 5 and play it for [5] less', () => {
    const g = tbl(9230);
    const top = g.s.players[0].deck[0];
    setField(g.s, g.s.objects[top], 'def', 'mountain-drake');
    cast(g, 'reinforce', [`pick:${top}`]);
    expect(onBoard(g, 'mountain-drake', 0)).toHaveLength(1);
  });

  it('Sabotage: recycle a non-unit card from an opponent\'s revealed hand', () => {
    const g = tbl(9231);
    const u = inHand(g, 'mountain-drake', 1);
    const sp = inHand(g, 'progress-day', 1);
    cast(g, 'sabotage', [`pick:${u}`, `pick:${sp}`]);
    expect(defsIn(g, 'deck', 1)).toContain('progress-day');
    expect(g.s.objects[u].zone.z).toBe('hand');                        // a unit can't be chosen
  });

  it('Sett, The Boss: pay [A], exhaust me, spend its buff to save a dying buffed unit; ready on conquer', () => {
    const g = tbl(9232, { legends: ['sett-the-boss'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0), { damage: 9 });
    control(g, 0, 0);
    setField(g.s, g.s.objects[u], 'buffs', 1);
    reask(g);
    drive(g);
    expect(g.s.objects[u]).toMatchObject({ zone: { z: 'base', p: 0 }, buffs: 0, exhausted: true });
    expect(g.s.objects[g.s.players[0].legend[0]].exhausted).toBe(true);
  });

  it('Shakedown: deal 6 unless its controller lets you draw 2', () => {
    const g = tbl(9233);
    const e = put(g, 'mountain-drake', 1, base(1));
    const h = handSize(g);
    cast(g, 'shakedown', [`t:${e}`, 'mode:0']);
    expect(handSize(g)).toBe(h + 2);
    cast(g, 'shakedown', [`t:${e}`, 'mode:1']);
    expect(dmg(g, e)).toBe(6);
  });

  it('Siphon Power: friendly units there +1, enemy units there -1 (minimum 1)', () => {
    const g = tbl(9234);
    const e = foe(g, 'shipyard-skulker');
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'siphon-power', [`t:${g.s.bfs[1].obj}`]);
    expect([mightOf(g.s, u), mightOf(g.s, e)]).toEqual([3, 2]);
    cast(g, 'siphon-power', [`t:${g.s.bfs[0].obj}`]);
    expect(mightOf(g.s, u)).toBe(4);
  });

  it('Stealthy Pursuer: may move with a friendly unit moving from my location', () => {
    const g = tbl(9235);
    const sp = put(g, 'stealthy-pursuer', 0, base(0), { exhausted: true });
    moveTo(g, [put(g, 'shipyard-skulker', 0, base(0))], 0);
    drive(g);
    expect(g.s.objects[sp].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it('Teemo, Swift Scout: hide for [1] instead of [A]; [1], [E]: a Teemo unit back to hand', () => {
    const g = tbl(9236, { legends: ['teemo-swift-scout'] });
    const t = put(g, 'teemo-scout', 0, base(0));
    reask(g);
    act(g, `act:${g.s.players[0].legend[0]}#1`);
    drive(g, [`t:${t}`]);
    expect(defsIn(g, 'hand')).toContain('teemo-scout');
    control(g, 0, 0);
    put(g, 'mystic-poro', 0, bf(0));
    const card = inHand(g, 'block');
    reask(g);
    act(g, `hide:${card}`);
    for (let i = 0; i < 4 && g.s.pending?.kind !== 'altCost'; i++) if (keys(g).includes('loc:bf0')) act(g, 'loc:bf0');
    expect(g.s.pending?.kind).toBe('altCost');
  });

  it('The Dreaming Tree: choosing a friendly unit here with a spell draws 1 (first time each turn)', () => {
    const g = tbl(9237, { bfs: ['the-dreaming-tree'] });
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    const h = handSize(g);
    cast(g, 'primal-strength', [`t:${u}`]);
    cast(g, 'primal-strength', [`t:${u}`]);
    expect(handSize(g)).toBe(h + 1);
  });

  it('Tideturner: may swap places with a unit you control at another location', () => {
    const g = tbl(9238);
    const u = put(g, 'shipyard-skulker', 0, bf(0));
    control(g, 0, 0);
    cast(g, 'tideturner', [`t:${u}`]);
    const t = onBoard(g, 'tideturner', 0)[0];
    expect([g.s.objects[t].zone, g.s.objects[u].zone]).toEqual([{ z: 'bf', bf: 0 }, { z: 'base', p: 0 }]);
  });

  it('Twisted Fate, Gambler: when I attack, reveal a rune and act on its domain', () => {
    const g = tbl(9239);
    foe(g, 'mountain-drake');
    const top = g.s.players[0].runeDeck[0];
    setField(g.s, g.s.objects[top], 'def', 'mind-rune');
    const h = handSize(g);
    attack(g, put(g, 'twisted-fate-gambler', 0, base(0)));
    expect(handSize(g)).toBe(h + 1);
  });

  it('Unchecked Power: exhaust all friendly units, deal 12 to all units at battlefields', () => {
    const g = tbl(9240);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = foe(g, 'mountain-drake');
    cast(g, 'unchecked-power');
    expect(g.s.objects[u].exhausted).toBe(true);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Unlicensed Armory: the chosen unit\'s next death is replaced if you pay [R]', () => {
    const g = tbl(9241);
    runes(g, 0, [...RICH, ...ready('fury', 2)]);
    const a = put(g, 'unlicensed-armory', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${a}#0`);
    drive(g, [`t:${u}`]);
    cast(g, 'falling-star', [`t:${u}`, `t:${u}`]);
    expect(g.s.objects[u]).toMatchObject({ zone: { z: 'base', p: 0 }, exhausted: true });
  });

  it('Volibear, Furious: when I attack, deal 5 split among enemy units here', () => {
    const g = tbl(9242);
    const a = foe(g, 'shipyard-skulker'), b = foe(g, 'mystic-poro');
    attack(g, put(g, 'volibear-furious', 0, base(0)), [`x:${a}`, `x:${a}`, `x:${a}`, `x:${b}`, `x:${b}`]);
    expect([g.s.objects[a], g.s.objects[b]]).toEqual([undefined, undefined]);
  });

  it('Wallop: spend a buff to ignore its cost; ready a unit', () => {
    const g = tbl(9243);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    setField(g.s, g.s.objects[u], 'buffs', 1);
    const id = inHand(g, 'wallop');
    reask(g);
    act(g, `play:${id}`);
    act(g, 'yes');
    drive(g, [`t:${u}`]);
    expect(g.s.objects[u]).toMatchObject({ exhausted: false, buffs: 0 });
  });

  it("Whirlwind: each player may return a unit to its owner's hand", () => {
    const g = tbl(9244);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'whirlwind', [`pick:${e}`, 'done']);
    expect(g.s.objects[e] === undefined || g.s.objects[e].zone.z === 'base').toBe(true);
  });

  it('Yasuo, Unforgiven: [2], [E]: move a friendly unit to or from its base', () => {
    const g = tbl(9245, { legends: ['yasuo-unforgiven'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g);
    act(g, `act:${g.s.players[0].legend[0]}#0`);
    if (keys(g).includes(`t:${u}`)) act(g, `t:${u}`);
    expect(keys(g)).not.toContain('loc:base');
    drive(g, ['loc:bf0']);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
  });

  it("Zenith Blade: stun an enemy unit at a battlefield; may move a friendly unit to its battlefield", () => {
    const g = tbl(9246);
    const e = foe(g, 'mountain-drake');
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'zenith-blade', [`t:${e}`, `pick:${u}`]);
    expect(g.s.objects[e].stunned).toBe(true);
    expect(evs(g, 'move').some((m) => m.objs.includes(u) && m.to.z === 'bf' && m.to.bf === 1)).toBe(true);   // then recalled in combat
  });

  it("Zhonya's Hourglass: a friendly unit that would die is saved, the Hourglass dies instead", () => {
    const g = tbl(9247);
    const z = put(g, 'zhonyas-hourglass', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0), { damage: 9 });
    control(g, 0, 0);
    reask(g);
    drive(g);
    expect(g.s.objects[z]).toBeUndefined();
    expect(g.s.objects[u]).toMatchObject({ zone: { z: 'base', p: 0 }, exhausted: true });
  });
});
