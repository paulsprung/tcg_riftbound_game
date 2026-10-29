import { describe, expect, it } from 'vitest';
import { hasKeyword, mightOf } from '../../src/game/rules/chars.ts';
import { moveObject, setField } from '../../src/game/state/mut.ts';
import { act, base, bf, control, evs, inHand, inTrash, keys, put, ready, reask, runes } from './helpers/scenario.ts';
import { cast, drive, handSize, moveTo, nextTurn, onBoard, opt } from './helpers/cards.ts';
import { attack, defsIn, dmg, emptyHand, equip, foe, golds, tbl } from './helpers/setCards.ts';

/*
 * Radiance (RAD), the cards beyond the Showdown Deck (cards/defs/rad-set.ts):
 * one behaviour test per card at least.
 */

const xp = (g: ReturnType<typeof tbl>, n: number, p: 0 | 1 = 0) => setField(g.s, g.s.players[p], 'xp', n);
void xp;

describe('Radiance set: batch 1', () => {
  it('Ahri, Confident: reducing the Might of an enemy unit here gives me +1', () => {
    const g = tbl(9801);
    foe(g, 'mountain-drake');
    const a = put(g, 'ahri-confident', 0, base(0));
    attack(g, a);
    expect(evs(g, 'mightChanged').filter((e) => e.obj === a)).toHaveLength(1);
  });

  it('Amateur Demolitionist: a Bomb at a battlefield; a dying Bomb deals 2 to an enemy unit there', () => {
    const g = tbl(9802);
    cast(g, 'amateur-demolitionist', ['loc:bf1']);
    const b = onBoard(g, 'bomb', 0);
    expect(b).toHaveLength(1);
    expect(g.s.objects[b[0]].zone).toEqual({ z: 'bf', bf: 1 });
    const e = foe(g, 'mountain-drake');
    cast(g, 'an-offer-you-cant-refuse', [`t:${b[0]}`, `t:${e}`]);
    expect(dmg(g, e)).toBe(2);
  });

  it("An Offer You Can't Refuse: kill a gear; its controller plays an exhausted Gold", () => {
    const g = tbl(9803);
    const gr = put(g, 'sumpworks-map', 1, base(1));
    cast(g, 'an-offer-you-cant-refuse', [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
    expect(golds(g, 1)).toBe(1);
    expect(golds(g, 0)).toBe(0);
  });

  it('Angler Wyrm: [E]: the opponent moves one of their units to my battlefield', () => {
    const g = tbl(9804);
    const w = put(g, 'angler-wyrm', 0, bf(0)); control(g, 0, 0);
    const e = put(g, 'shipyard-skulker', 1, base(1));
    reask(g); act(g, `act:${w}#0`); drive(g);
    expect(evs(g, 'move').some((m) => m.objs.includes(e) && m.to.z === 'bf')).toBe(true);
  });

  it('Antagonistic Apparatus: enters ready; a ready Mech here', () => {
    const g = tbl(9805);
    cast(g, 'antagonistic-apparatus');
    expect(g.s.objects[onBoard(g, 'antagonistic-apparatus', 0)[0]].exhausted).toBe(false);
    const m = onBoard(g, 'mech', 0);
    expect(m).toHaveLength(1);
    expect(g.s.objects[m[0]].exhausted).toBe(false);
  });

  it('Aphelios, Exalted: an Equipment attached to me: a mode not chosen this turn', () => {
    const g = tbl(9806);
    const a = put(g, 'aphelios-exalted', 0, base(0));
    const n = g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
    cast(g, 'shepherds-heirloom');
    const h = onBoard(g, 'shepherds-heirloom', 0)[0];
    reask(g); act(g, `act:${h}#kwequip`); drive(g, [`t:${a}`, 'mode:1']);
    expect(g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length).toBe(n + 1);
  });

  it('Armored Tusker: moving, may deal damage equal to my Shield to a unit at a battlefield', () => {
    const g = tbl(9807);
    const e = foe(g, 'mountain-drake');
    const t = put(g, 'armored-tusker', 0, base(0));
    moveTo(g, [t], 0); drive(g, [`t:${e}`]);
    expect(dmg(g, e)).toBe(3);
  });

  it('Avalanche: deal 3 to all units in bases', () => {
    const g = tbl(9808);
    const a = put(g, 'mountain-drake', 1, base(1));
    const b = put(g, 'mountain-drake', 0, base(0));
    const c = foe(g, 'mountain-drake');
    cast(g, 'avalanche');
    expect([dmg(g, a), dmg(g, b), dmg(g, c)]).toEqual([3, 3, 0]);
  });

  it('Banner of Conquest: friendly units here have Assault', () => {
    const g = tbl(9809);
    put(g, 'banner-of-conquest', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    expect(hasKeyword(g.s, u, 'assault')).toBe(true);
  });

  it('Battle Preparations: +2; showing off a gear readies up to 2 runes', () => {
    const g = tbl(9810);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const gr = inHand(g, 'sumpworks-map');
    for (const id of g.s.players[0].base.filter((x) => g.s.objects[x].def.endsWith('-rune')).slice(0, 4)) setField(g.s, g.s.objects[id], 'exhausted', true);
    const id = inHand(g, 'battle-preparations');
    reask(g); act(g, `play:${id}`); act(g, `pick:${gr}`); drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
    expect(evs(g, 'ready').length).toBeGreaterThan(0);
  });

  it("Battlefield Armorer: a friendly gear at a battlefield dies: may pay [1] to return it to hand", () => {
    const g = tbl(9811);
    put(g, 'battlefield-armorer', 0, base(0));
    const gr = put(g, 'banner-of-conquest', 0, bf(0));
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    cast(g, 'an-offer-you-cant-refuse', [`t:${gr}`]);
    expect(defsIn(g, 'hand')).toContain('banner-of-conquest');
  });

  it('Bedeviling Stranger: 4 or more units at the chosen battlefield: may return an enemy unit there', () => {
    const g = tbl(9812);
    const e = foe(g, 'mountain-drake');
    put(g, 'mystic-poro', 1, bf(1)); put(g, 'mystic-poro', 1, bf(1)); put(g, 'mystic-poro', 1, bf(1));
    cast(g, 'bedeviling-stranger', [`t:${g.s.bfs[1].obj}`, `pick:${e}`]);
    expect(defsIn(g, 'hand', 1)).toContain('mountain-drake');
  });

  it('Bilgewater Tracker: 1 to each of up to 2 units', () => {
    const g = tbl(9813);
    const a = put(g, 'mountain-drake', 1, base(1));
    const b = put(g, 'vanguard-sergeant', 1, base(1));
    cast(g, 'bilgewater-tracker', [`t:${a}`, `t:${b}`]);
    expect([dmg(g, a), dmg(g, b)]).toEqual([1, 1]);
  });

  it("Black Market: [A][A]: draw 1, once by each player on their turn, controller or not", () => {
    const g = tbl(9814, { bfs: [undefined, 'black-market'] });
    foe(g, 'shipyard-skulker');
    const m = g.s.bfs[1].obj;
    const n = handSize(g);
    reask(g); act(g, `act:${m}#0`); drive(g);
    expect(handSize(g)).toBe(n + 1);
    reask(g);
    expect(keys(g)).not.toContain(`act:${m}#0`);
  });

  it("Bloodscent Swarm: [2] less for each battlefield you've conquered this turn", () => {
    const g = tbl(9815);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0); drive(g);
    const id = inHand(g, 'bloodscent-swarm');
    reask(g); act(g, `play:${id}`);
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 6 } });
  });

  it('Blossoming Dreamroot: win a combat here, draw 1', () => {
    const g = tbl(9816);
    foe(g, 'mystic-poro');
    put(g, 'blossoming-dreamroot', 0, bf(1));
    const n = handSize(g);
    attack(g, put(g, 'mountain-drake', 0, base(0)));
    expect(handSize(g)).toBe(n + 1);
  });

  it('Brawl: Assault equal to its Might this turn', () => {
    const g = tbl(9817);
    const u = put(g, 'vanguard-sergeant', 0, base(0));
    cast(g, 'brawl', [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'assault')).toBe(true);
    expect(g.s.effects.some((e) => (e.spec as { kw?: string; value?: number }).kw === 'assault' && (e.spec as { value?: number }).value === 4)).toBe(true);
  });

  it("Cataclysm: opponents can't play spells; move a friendly unit to an occupied enemy battlefield", () => {
    const g = tbl(9818);
    foe(g, 'mystic-poro');
    const u = put(g, 'mountain-drake', 0, base(0));
    cast(g, 'cataclysm', [`t:${u}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(u) && m.to.z === 'bf' && (m.to as { bf: number }).bf === 1)).toBe(true);
    expect(g.s.effects.some((e) => (e.spec as { s?: string }).s === 'cantPlayTypes' && 'player' in e.affects && e.affects.player === 1)).toBe(true);
  });

  it('Chronobreak: pay X Power, banish X of your units and play them back, free', () => {
    const g = tbl(9819);
    const a = put(g, 'mountain-drake', 0, bf(0)); control(g, 0, 0);
    setField(g.s, g.s.objects[a], 'damage', [{ amount: 5, by: null, sources: [], combat: false, group: 0 }]);
    const id = inHand(g, 'chronobreak');
    reask(g); act(g, `play:${id}`); act(g, 'n:1');
    drive(g, ['loc:bf0']);
    const d = onBoard(g, 'mountain-drake', 0);
    expect(d).toHaveLength(1);
    expect(g.s.objects[d[0]].zone).toEqual({ z: 'bf', bf: 0 });
    expect(dmg(g, d[0])).toBe(0);
  });

  it('Clanging Sentry: your Mechs have Disarm', () => {
    const g = tbl(9820);
    const s0 = put(g, 'clanging-sentry', 0, base(0));
    const m = put(g, 'mech', 0, base(0));
    setField(g.s, g.s.objects[m], 'token', true);
    expect(hasKeyword(g.s, s0, 'disarm') && hasKeyword(g.s, m, 'disarm')).toBe(true);
  });
});

describe('Radiance set: batch 2', () => {
  it('Clocktower Guardian: Predict 3 as played; Deathknell: banish the top card and may play it, Energy ignored', () => {
    const g = tbl(9821);
    runes(g, 0, [...ready('mind', 4), ...ready('body', 14)]);
    cast(g, 'clocktower-guardian');
    expect(evs(g, 'look').length).toBeGreaterThan(0);
    const c = onBoard(g, 'clocktower-guardian', 0)[0];
    moveObject(g.s, inHand(g, 'mountain-drake'), { z: 'deck', p: 0 }, { pos: 'top' });
    cast(g, 'clash-of-giants', [`t:${c}`, `t:${put(g, 'mountain-drake', 1, base(1))}`]);
    expect(onBoard(g, 'mountain-drake', 0)).toHaveLength(1);
  });

  it('Coalesced Energy: at the end of your turn, recycle your runes, channel 4 exhausted', () => {
    const g = tbl(9822);
    put(g, 'coalesced-energy', 0, base(0));
    reask(g); act(g, 'end'); drive(g, [], { max: 3 });
    const runesNow = g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune'));
    expect(runesNow).toHaveLength(4);
  });

  it('Command Attack: move a Deploy gear to a battlefield, or draw a gear of the top 5', () => {
    const g = tbl(9823);
    const b = put(g, 'banner-of-conquest', 0, bf(0));
    cast(g, 'command-attack', ['mode:0', `t:${b}`, 'loc:bf1']);
    expect(g.s.objects[b].zone).toEqual({ z: 'bf', bf: 1 });
    const v = moveObject(g.s, inHand(g, 'sumpworks-map'), { z: 'deck', p: 0 }, { pos: 'top' });
    cast(g, 'command-attack', ['mode:1', `pick:${v}`]);
    expect(defsIn(g, 'hand')).toContain('sumpworks-map');
  });

  it('Consult the Heavens: Shield 2 this turn; Predict', () => {
    const g = tbl(9824);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'consult-the-heavens', [`t:${u}`]);
    expect(hasKeyword(g.s, u, 'shield')).toBe(true);
  });

  it('Cosmic Vista: holding here with an empty Rune Deck scores 1 point', () => {
    const g = tbl(9825, { bfs: ['cosmic-vista'] });
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    for (const id of g.s.players[0].runeDeck.slice()) moveObject(g.s, id, { z: 'trash', p: 0 });
    const pts = g.s.players[0].points;
    nextTurn(g);
    expect(g.s.players[0].points).toBe(pts + 2);
  });

  it('Demacian Illuminators: one or more friendly units die: buff a friendly unit', () => {
    const g = tbl(9826);
    const i = put(g, 'demacian-illuminators', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    cast(g, 'soul-harvest', [`t:${u}`]);
    expect(g.s.objects[i].buffs).toBe(1);
  });

  it('Demacian Standard: attacking here, one attacker gets +2; holding, may return it to hand', () => {
    const g = tbl(9827);
    foe(g, 'mountain-drake');
    put(g, 'demacian-standard', 0, bf(1));
    const u = put(g, 'vanguard-sergeant', 0, base(0));
    moveTo(g, [u], 1); drive(g, [], { max: 2 });
    expect(evs(g, 'mightChanged').some((e) => e.obj === u)).toBe(true);
  });

  it('Detonation Amplifier: may kill another friendly unit or gear to draw 1; Deathknells here trigger twice', () => {
    const g = tbl(9828);
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const c = put(g, 'mystic-poro', 0, base(0));
    const n = handSize(g);
    cast(g, 'detonation-amplifier', ['loc:bf0', 'yes', `pick:${c}`]);
    expect(handSize(g)).toBe(n + 1);
    const l = put(g, 'lonely-poro', 0, bf(0));
    void l;
    const r = put(g, 'black-rose-dignitary', 0, bf(0));
    const before = evs(g, 'channel').length;
    cast(g, 'soul-harvest', [`t:${r}`]);
    expect(evs(g, 'channel').length).toBe(before + 2);
  });

  it('Disposal Expert: enters ready if you control no other units', () => {
    const g = tbl(9829);
    cast(g, 'disposal-expert');
    expect(g.s.objects[onBoard(g, 'disposal-expert', 0)[0]].exhausted).toBe(false);
    cast(g, 'disposal-expert');
    expect(onBoard(g, 'disposal-expert', 0).filter((id) => g.s.objects[id].exhausted)).toHaveLength(1);
  });

  it('Dockside Lock-Up: banish a unit here; holding, kill this to play the banished card free', () => {
    const g = tbl(9830);
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const v = put(g, 'vanguard-sergeant', 0, bf(0));
    cast(g, 'dockside-lock-up', ['loc:bf0', `t:${v}`]);
    expect(defsIn(g, 'banish')).toContain('vanguard-sergeant');
    nextTurn(g);
    expect(onBoard(g, 'dockside-lock-up', 0)).toHaveLength(0);
    expect(onBoard(g, 'vanguard-sergeant', 0)).toHaveLength(1);
  });

  it("Drakehound Packmaster: banish the top card of the opponent's deck and play it free", () => {
    const g = tbl(9831);
    runes(g, 0, [...ready('fury', 4), ...ready('body', 8)]);
    moveObject(g.s, inHand(g, 'vanguard-sergeant', 1), { z: 'deck', p: 1 }, { pos: 'top' });
    cast(g, 'drakehound-packmaster');
    expect(onBoard(g, 'vanguard-sergeant', 0)).toHaveLength(1);
  });

  it('Durand Memorial: defending here, a unit of yours here gets Tank this combat', () => {
    const g = tbl(9832, { bfs: [undefined, 'durand-memorial'] });
    const d = foe(g, 'shipyard-skulker');
    put(g, 'mystic-poro', 1, bf(1));
    attack(g, put(g, 'mountain-drake', 0, base(0)), [`t:${d}`]);
    expect(evs(g, 'keywordsChanged').some((e) => e.obj === d)).toBe(true);
  });

  it('Ekko, Boy Who Shattered Time: Empower for [1]; disempower: next unit [2][A] less and killed at end of turn', () => {
    const g = tbl(9833, { legends: ['ekko-boy-who-shattered-time'] });
    const l = g.s.players[0].legend[0];
    reask(g); act(g, `act:${l}#kwempower`); drive(g);
    expect(g.s.objects[l].empowered).toBe(1);
    setField(g.s, g.s.objects[l], 'exhausted', false);
    reask(g); act(g, `act:${l}#0`); drive(g);
    expect(g.s.objects[l].empowered).toBe(0);
    const id = inHand(g, 'vanguard-sergeant');
    reask(g); act(g, `play:${id}`);
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 2 } });
    drive(g);
    expect(onBoard(g, 'vanguard-sergeant', 0)).toHaveLength(1);
    reask(g); act(g, 'end'); drive(g, [], { max: 2 });
    expect(onBoard(g, 'vanguard-sergeant', 0)).toHaveLength(0);
  });

  it("Ekko, Ingenious: return a friendly unit to its owner's hand as an additional cost", () => {
    const g = tbl(9834);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'ekko-ingenious', [`pick:${u}`]);
    expect(defsIn(g, 'hand')).toContain('shipyard-skulker');
    expect(onBoard(g, 'ekko-ingenious', 0)).toHaveLength(1);
    const g2 = tbl(9835);
    const id = inHand(g2, 'ekko-ingenious');
    reask(g2);
    expect(keys(g2)).not.toContain(`play:${id}`);
  });

  it('Ekko, Revolutionary: enters ready; Discard 1, [1][R]: banish me and play me to base free', () => {
    const g = tbl(9836);
    cast(g, 'ekko-revolutionary');
    const e = onBoard(g, 'ekko-revolutionary', 0)[0];
    expect(g.s.objects[e].exhausted).toBe(false);
    moveTo(g, [e], 0); drive(g);
    reask(g); act(g, `act:${e}#1`); drive(g);
    const now = onBoard(g, 'ekko-revolutionary', 0);
    expect(now).toHaveLength(1);
    expect(g.s.objects[now[0]].zone).toEqual({ z: 'base', p: 0 });
    expect(g.s.objects[now[0]].exhausted).toBe(false);
  });

  it("Entrenched Boar: may enter ready; then it can't move this turn", () => {
    const g = tbl(9837);
    const id = inHand(g, 'entrenched-boar');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g);
    const b = onBoard(g, 'entrenched-boar', 0)[0];
    expect(g.s.objects[b].exhausted).toBe(false);
    reask(g);
    expect(keys(g)).not.toContain('move');
  });

  it('Ephemeral Ward: your units +2; playing a unit kills it', () => {
    const g = tbl(9838);
    put(g, 'ephemeral-ward', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    expect(mightOf(g.s, u)).toBe(5);
    cast(g, 'mystic-poro');
    expect(onBoard(g, 'ephemeral-ward', 0)).toHaveLength(0);
    expect(mightOf(g.s, u)).toBe(3);
  });

  it('Explosimian: holding, three Bombs to a single battlefield', () => {
    const g = tbl(9839);
    put(g, 'explosimian', 0, bf(0)); control(g, 0, 0);
    nextTurn(g);
    const b = onBoard(g, 'bomb', 0);
    expect(b).toHaveLength(3);
    expect(new Set(b.map((id) => JSON.stringify(g.s.objects[id].zone))).size).toBe(1);
  });

  it("Ezreal, Dashing: attacking, deal my Might to an enemy unit here; no combat damage; [B]: move to base", () => {
    const g = tbl(9840);
    const e = foe(g, 'mountain-drake');
    const z = put(g, 'ezreal-dashing', 0, base(0));
    attack(g, z, [`t:${e}`]);
    expect(evs(g, 'deal').filter((d) => d.to === e && !d.combat).map((d) => d.n)).toEqual([3]);
    expect(evs(g, 'deal').some((d) => d.to === e && d.combat)).toBe(false);
  });

  it("Firebrand Raider: enters ready; readies enemy units; others enter ready; no readying in the Awaken Phase", () => {
    const g = tbl(9841);
    const e = put(g, 'shipyard-skulker', 1, base(1), { exhausted: true });
    const m = put(g, 'mystic-poro', 0, base(0), { exhausted: true });
    cast(g, 'firebrand-raider');
    expect(g.s.objects[onBoard(g, 'firebrand-raider', 0)[0]].exhausted).toBe(false);
    expect(g.s.objects[e].exhausted).toBe(false);
    cast(g, 'shipyard-skulker');
    expect(onBoard(g, 'shipyard-skulker', 0).every((id) => !g.s.objects[id].exhausted)).toBe(true);
    nextTurn(g);
    expect(g.s.objects[m].exhausted).toBe(true);
  });
});

void opt; void equip; void emptyHand; void inTrash; void control;

describe('Radiance set: batch 3', () => {
  it('Firelights Hideout: conquering here, the next unit you play has Accelerate', () => {
    const g = tbl(9851, { bfs: ['firelights-hideout'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 0); drive(g);
    const id = inHand(g, 'vanguard-sergeant');
    reask(g); act(g, `play:${id}`);
    expect(g.s.pending?.kind).toBe('optionalCost');
    act(g, 'yes'); drive(g);
    expect(g.s.objects[onBoard(g, 'vanguard-sergeant', 0)[0]].exhausted).toBe(false);
  });

  it('Forbidden Technique: ready a unit; replayed from the trash after a [7]+ card, then banished', () => {
    const g = tbl(9852);
    runes(g, 0, [...ready('fury', 6), ...ready('body', 10)]);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    cast(g, 'forbidden-technique', [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
    setField(g.s, g.s.objects[u], 'exhausted', true);
    cast(g, 'mountain-drake', ['yes', `t:${u}`]);
    expect(defsIn(g, 'banish')).toContain('forbidden-technique');
    expect(g.s.objects[u].exhausted).toBe(false);
  });

  it('Graves, Blasting Through: attacking, my Might to all enemy units here; no combat damage', () => {
    const g = tbl(9853);
    const a = foe(g, 'mountain-drake');
    const b = put(g, 'mountain-drake', 1, bf(1));
    const gv = put(g, 'graves-blasting-through', 0, base(0));
    attack(g, gv);
    expect(evs(g, 'deal').filter((d) => (d.to === a || d.to === b) && !d.combat).map((d) => d.n)).toEqual([4, 4]);
    expect(evs(g, 'deal').some((d) => d.combat && d.sources.includes(gv))).toBe(false);
  });

  it('Gravity Field: opponents pay [1][A] to move units here; Deathknell: draw 1', () => {
    const g = tbl(9854);
    put(g, 'gravity-field', 1, bf(1));
    foe(g, 'mystic-poro');
    const u = put(g, 'shipyard-skulker', 0, base(0));
    moveTo(g, [u], 1);
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 1 } });
  });

  it('Heartening Soul: ready a friendly legend; friendly legends have [E]: +3', () => {
    const g = tbl(9855);
    const l = g.s.players[0].legend[0];
    setField(g.s, g.s.objects[l], 'exhausted', true);
    cast(g, 'heartening-soul', [`t:${l}`]);
    expect(g.s.objects[l].exhausted).toBe(false);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g); act(g, `act:${l}#g0`); drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
  });

  it('Hexplosive Minefield: kill your Bombs; at end of turn as many Bombs to one battlefield', () => {
    const g = tbl(9856);
    cast(g, 'amateur-demolitionist', ['loc:bf0']);
    cast(g, 'amateur-demolitionist', ['loc:bf0']);
    const bombs = onBoard(g, 'bomb', 0);
    cast(g, 'hexplosive-minefield', bombs.map((b) => `pick:${b}`));
    expect(onBoard(g, 'bomb', 0)).toHaveLength(0);
    reask(g); act(g, 'end'); drive(g, [`t:${g.s.bfs[1].obj}`], { max: 4 });
    const now = onBoard(g, 'bomb', 0);
    expect(now).toHaveLength(2);
  });

  it("Hunker Down: ready a friendly unit, it can't move; draw 1", () => {
    const g = tbl(9857);
    const u = put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const n = handSize(g);
    cast(g, 'hunker-down', [`t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
    expect(handSize(g)).toBe(n + 1);
    reask(g);
    expect(keys(g)).not.toContain('move');
  });

  it("Hunters' Circle: the first unit you play here on your turn costs [1] less", () => {
    const g = tbl(9858, { bfs: ['hunters-circle'] });
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    const id = inHand(g, 'vanguard-sergeant');
    reask(g); act(g, `play:${id}`); act(g, 'loc:bf0');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
    drive(g);
    const id2 = inHand(g, 'vanguard-sergeant');
    reask(g); act(g, `play:${id2}`); act(g, 'loc:bf0');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
  });

  it('Hunting Blind: may move an enemy unit here; friendly units here have Shield 2', () => {
    const g = tbl(9859);
    const u = put(g, 'mountain-drake', 0, bf(0)); control(g, 0, 0);
    const e = put(g, 'mystic-poro', 1, base(1));
    cast(g, 'hunting-blind', ['loc:bf0', `t:${e}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(e))).toBe(true);
    expect(hasKeyword(g.s, u, 'shield')).toBe(true);
  });

  it('Hush: counter a spell with Power cost [A][A] or more', () => {
    const g = tbl(9860, { first: 1 });
    const h = inHand(g, 'hush', 0);
    const fs = inHand(g, 'falling-star', 1);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g); act(g, `play:${fs}`); drive(g, [`t:${u}`, `t:${u}`, `play:${h}`]);
    expect(evs(g, 'counter')).toHaveLength(1);
  });

  it('Improvised Projectile: damage equal to a friendly gear’s Energy cost', () => {
    const g = tbl(9861);
    const gr = put(g, 'gravity-field', 0, base(0));
    const e = foe(g, 'mountain-drake');
    cast(g, 'improvised-projectile', [`t:${gr}`, `t:${e}`]);
    expect(dmg(g, e)).toBe(5);
  });

  it('Incorrigible Construct: showing off a Mech, enters ready', () => {
    const g = tbl(9862);
    const m = inHand(g, 'clanging-sentry');
    const id = inHand(g, 'incorrigible-construct');
    reask(g); act(g, `play:${id}`); act(g, `pick:${m}`); drive(g);
    expect(g.s.objects[onBoard(g, 'incorrigible-construct', 0)[0]].exhausted).toBe(false);
  });

  it('Invigorating Bloom: +3 to a friendly unit; exhaust a Mighty unit, [E]: draw 1', () => {
    const g = tbl(9863);
    const u = put(g, 'mountain-drake', 0, base(0));
    cast(g, 'invigorating-bloom', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(13);
    const b = onBoard(g, 'invigorating-bloom', 0)[0];
    const n = handSize(g);
    reask(g); act(g, `act:${b}#1`); drive(g);
    expect(handSize(g)).toBe(n + 1);
    expect(g.s.objects[u].exhausted).toBe(true);
  });

  it('Iridescent Avian: [E]: buff a unit, or +2 if it is already buffed', () => {
    const g = tbl(9864);
    const a = put(g, 'iridescent-avian', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    reask(g); act(g, `act:${a}#0`); drive(g, [`t:${u}`]);
    expect(g.s.objects[u].buffs).toBe(1);
    setField(g.s, g.s.objects[a], 'exhausted', false);
    reask(g); act(g, `act:${a}#0`); drive(g, [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(6);
  });

  it('Jarvan IV, Exemplar: playing a Deploy gear, may exhaust me and pay [A] to move a friendly unit there', () => {
    const g = tbl(9865, { legends: ['jarvan-iv-exemplar-of-demacia'] });
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'banner-of-conquest', ['loc:bf1', `t:${u}`]);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 1 });
  });

  it('Jarvan IV, Martial Paragon: Deploy gear have Action; conquering with one here channels 1', () => {
    const g = tbl(9866);
    put(g, 'jarvan-iv-martial-paragon', 0, bf(0)); control(g, 0, 0);
    const e = put(g, 'mountain-drake', 1, bf(0));
    void e;
    const b = inHand(g, 'banner-of-conquest');
    reask(g);
    if (g.s.pending?.player === 1) act(g, 'pass');
    expect(keys(g)).toContain(`play:${b}`);
  });

  it('Jarvan IV, Royal Heir: attacking, may move a unit of mine to my battlefield', () => {
    const g = tbl(9867);
    foe(g, 'mystic-poro');
    const j = put(g, 'jarvan-iv-royal-heir', 0, base(0));
    const o = put(g, 'shipyard-skulker', 0, base(0));
    attack(g, j, [`t:${o}`]);
    expect(evs(g, 'move').some((m) => m.objs.includes(o) && m.to.z === 'bf')).toBe(true);
  });

  it("Kai'Sa, Rebel: in a showdown, your spells have Reaction", () => {
    const g = tbl(9868);
    put(g, 'kaisa-rebel', 0, bf(0)); control(g, 0, 0);
    put(g, 'mountain-drake', 1, bf(0));
    const sp = inHand(g, 'avalanche');
    reask(g);
    if (g.s.pending?.player === 1) act(g, 'pass');
    expect(keys(g)).toContain(`play:${sp}`);
  });

  it("Kayn, Unleashed: having moved twice this turn, I don't take damage", () => {
    const g = tbl(9869);
    const k = put(g, 'kayn-unleashed', 0, base(0));
    setField(g.s, g.s.objects[k], 'moves', 2);
    cast(g, 'avalanche');
    expect(dmg(g, k)).toBe(0);
  });

  it('Ki Burst: exhaust a friendly unit as an additional cost; stun a unit', () => {
    const g = tbl(9870);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'ki-burst', [`t:${e}`, `pick:${u}`]);
    expect(g.s.objects[e].stunned).toBe(true);
    expect(g.s.objects[u].exhausted).toBe(true);
  });

  it("K'Sante, Dauntless: attacking, double the Shield of a unit of mine here", () => {
    const g = tbl(9871);
    foe(g, 'mystic-poro');
    const k = put(g, 'ksante-dauntless', 0, base(0));
    attack(g, k);
    expect(evs(g, 'keywordsChanged').some((e) => e.obj === k)).toBe(true);
  });

  it("K'Sante, Pride of Nazumah: [1], [E]: a friendly unit has Assault equal to its Shield this turn", () => {
    const g = tbl(9872, { legends: ['ksante-pride-of-nazumah'] });
    const t = put(g, 'armored-tusker', 0, base(0));
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g, [`t:${t}`]);
    expect(hasKeyword(g.s, t, 'assault')).toBe(true);
  });

  it('Life from Stone: exhaust a friendly unit: draw 1, channel 1 exhausted', () => {
    const g = tbl(9873);
    put(g, 'shipyard-skulker', 0, base(0));
    const n = handSize(g);
    cast(g, 'life-from-stone');
    expect(handSize(g)).toBe(n + 1);
  });

  it('Lingering Animus: enters ready if a friendly unit or gear died this turn', () => {
    const g = tbl(9874);
    const gr = put(g, 'gravity-field', 0, base(0));
    cast(g, 'an-offer-you-cant-refuse', [`t:${gr}`]);
    cast(g, 'lingering-animus');
    expect(g.s.objects[onBoard(g, 'lingering-animus', 0)[0]].exhausted).toBe(false);
  });

  it('Lost to the Sands: deal 4 to a unit at a battlefield, or kill a gear', () => {
    const g = tbl(9875);
    const e = foe(g, 'mountain-drake');
    cast(g, 'lost-to-the-sands', ['mode:0', `t:${e}`]);
    expect(dmg(g, e)).toBe(4);
    const gr = put(g, 'gravity-field', 1, base(1));
    cast(g, 'lost-to-the-sands', ['mode:1', `t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
  });
});

describe('Radiance set: batch 4', () => {
  it("Lulu, Whimsical: moving, may make another unit's base Might 4 this turn", () => {
    const g = tbl(9876);
    const l = put(g, 'lulu-whimsical', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    moveTo(g, [l], 0); drive(g, [`t:${e}`]);
    expect(mightOf(g.s, e)).toBe(4);
  });

  it('Mechanical Bandit: each player reveals their top card; the lowest Energy cost draws', () => {
    const g = tbl(9877);
    put(g, 'mechanical-bandit', 0, base(0));
    nextTurn(g);
    moveObject(g.s, inHand(g, 'mystic-poro'), { z: 'deck', p: 0 }, { pos: 'top' });
    moveObject(g.s, inHand(g, 'mountain-drake', 1), { z: 'deck', p: 1 }, { pos: 'top' });
    moveObject(g.s, inHand(g, 'mountain-drake', 1), { z: 'deck', p: 1 }, { pos: 'top' });   // P1 draws one in their turn
    const n = handSize(g);
    nextTurn(g);
    expect(defsIn(g, 'hand')).toContain('mystic-poro');
    expect(handSize(g)).toBe(n + 2);
    expect(defsIn(g, 'hand', 1).filter((d) => d === 'mountain-drake')).toHaveLength(1);
  });

  it('Mordekaiser, Dominating: may discard 1 to kill a unit or gear', () => {
    const g = tbl(9878);
    runes(g, 0, [...ready('order', 4), ...ready('fury', 8)]);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'mordekaiser-dominating', [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Mordekaiser, Iron Revenant: banish a unit or gear from your trash, [E]: [A] for units or gear', () => {
    const g = tbl(9879, { legends: ['mordekaiser-iron-revenant'] });
    inTrash(g, 'mystic-poro');
    runes(g, 0, ready('chaos', 2));
    const l = g.s.players[0].legend[0];
    reask(g); act(g, `act:${l}#0`); drive(g);
    expect(g.s.players[0].pool.restricted).toMatchObject([{ kind: 'universal', amount: 1, onlyFor: 'permanents' }]);
    expect(defsIn(g, 'banish')).toContain('mystic-poro');
  });

  it('Mordekaiser, Twice-Slain: once each turn, a friendly unit dies instead of me', () => {
    const g = tbl(9880);
    const m = put(g, 'mordekaiser-twice-slain', 0, bf(0)); control(g, 0, 0);
    const o = put(g, 'mystic-poro', 0, base(0));
    cast(g, 'void-seeker', [`t:${m}`]);
    cast(g, 'void-seeker', [`t:${m}`]);
    expect(g.s.objects[o]).toBeUndefined();
    expect(g.s.objects[m]).toBeDefined();
  });

  it('Mournful Spirit: Deathknell: may kill a unit or gear here', () => {
    const g = tbl(9881);
    const s0 = put(g, 'mournful-spirit', 0, bf(0)); control(g, 0, 0);
    const gr = put(g, 'banner-of-conquest', 0, bf(0));
    cast(g, 'soul-harvest', [`t:${s0}`, `t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
  });

  it('Mysterious Chronomancer: Predict 2', () => {
    const g = tbl(9882);
    cast(g, 'mysterious-chronomancer');
    expect(evs(g, 'look').some((e) => e.objs.length === 2)).toBe(true);
  });

  it("N'Tofo Strikes: Shield 2, then damage equal to its Shield to an enemy unit", () => {
    const g = tbl(9883);
    const t = put(g, 'armored-tusker', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'ntofo-strikes', [`t:${t}`, `t:${e}`]);
    expect(dmg(g, e)).toBe(5);
  });

  it('One-Two Punch: buff a friendly unit and stun an enemy unit', () => {
    const g = tbl(9884);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'one-two-punch', [`t:${u}`, `t:${e}`]);
    expect(g.s.objects[u].buffs).toBe(1);
    expect(g.s.objects[e].stunned).toBe(true);
  });

  it("Orianna, Exquisite: no combat damage unless there's a friendly gear here", () => {
    const g = tbl(9885);
    foe(g, 'mystic-poro');
    const o = put(g, 'orianna-exquisite', 0, base(0));
    attack(g, o);
    expect(evs(g, 'deal').some((d) => d.combat && d.sources.includes(o))).toBe(false);
  });

  it('Orianna, Mechanical Marvel: once each turn at a battlefield, a gear for [1][A] less', () => {
    const g = tbl(9886);
    put(g, 'orianna-mechanical-marvel', 0, bf(0)); control(g, 0, 0);
    const id = inHand(g, 'gravity-field');
    reask(g); act(g, `play:${id}`);
    opt(g, 'yes');
    if (keys(g).includes('loc:bf0')) act(g, 'loc:bf0');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 4 } });
  });

  it('Overloaded Traveler: +1 while a friendly Deploy gear is at my battlefield', () => {
    const g = tbl(9887);
    const t = put(g, 'overloaded-traveler', 0, bf(0)); control(g, 0, 0);
    expect(mightOf(g.s, t)).toBe(2);
    put(g, 'banner-of-conquest', 0, bf(0));
    expect(mightOf(g.s, t)).toBe(3);
  });

  it('Packed Amphitheater: champion units here have +1', () => {
    const g = tbl(9888, { bfs: ['packed-amphitheater'] });
    const c = put(g, 'poppy-paragon', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    expect([mightOf(g.s, c), mightOf(g.s, u)]).toEqual([6, 3]);
  });

  it("Parallel Convergence: return a friendly unit as an additional cost; deal 5", () => {
    const g = tbl(9889);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const e = foe(g, 'mountain-drake');
    cast(g, 'parallel-convergence', [`t:${e}`, `pick:${u}`]);
    expect(dmg(g, e)).toBe(5);
    expect(defsIn(g, 'hand')).toContain('shipyard-skulker');
  });

  it('Pillaged Armory: buff a friendly unit as played and when you conquer here', () => {
    const g = tbl(9890);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'pillaged-armory', ['loc:bf0', `t:${u}`]);
    expect(g.s.objects[u].buffs).toBe(1);
  });

  it('Portable Portal: may pay [O] to ready a unit here; friendly units here have Ganking', () => {
    const g = tbl(9891);
    const u = put(g, 'shipyard-skulker', 0, bf(0), { exhausted: true }); control(g, 0, 0);
    cast(g, 'portable-portal', ['loc:bf0', `t:${u}`]);
    expect(g.s.objects[u].exhausted).toBe(false);
    expect(hasKeyword(g.s, u, 'ganking')).toBe(true);
  });

  it("Primordial Roar: showing off a unit deals its Might to a unit", () => {
    const g = tbl(9892);
    const m = put(g, 'mountain-drake', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    const id = inHand(g, 'primordial-roar');
    reask(g); act(g, `play:${id}`); act(g, `pick:${m}`); drive(g, [`t:${e}`]);
    expect(g.s.objects[e]).toBeUndefined();
  });

  it('Rally for War: three Recruits at an occupied enemy battlefield', () => {
    const g = tbl(9893);
    foe(g, 'mountain-drake');
    cast(g, 'rally-for-war');
    expect(evs(g, 'enter').filter((e) => g.events.length > 0 && e.at.z === 'bf')).not.toHaveLength(0);
    expect(evs(g, 'enter').filter((e) => e.at.z === 'bf' && (e.at as { bf: number }).bf === 1).length).toBe(3);
  });

  it('Raving Witness: moving, reveal the top card; draw it if Mighty, else recycle it', () => {
    const g = tbl(9894);
    const w = put(g, 'raving-witness', 0, base(0));
    moveObject(g.s, inHand(g, 'mountain-drake'), { z: 'deck', p: 0 }, { pos: 'top' });
    moveTo(g, [w], 0); drive(g);
    expect(defsIn(g, 'hand')).toContain('mountain-drake');
  });

  it('Realm of Death: -2 to an enemy unit, +2 to a friendly one, then they fight', () => {
    const g = tbl(9895);
    const e = put(g, 'vanguard-sergeant', 1, base(1));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'realm-of-death', [`t:${e}`, `t:${u}`]);
    expect(g.s.objects[e]).toBeUndefined();
    expect(dmg(g, u)).toBe(2);
  });

  it('Remember the Fallen: up to 3 cheap units and gear from your trash, free', () => {
    const g = tbl(9896);
    runes(g, 0, [...ready('order', 4), ...ready('fury', 8)]);
    const a = inTrash(g, 'mystic-poro'), b = inTrash(g, 'shipyard-skulker'), c = inTrash(g, 'banner-of-conquest');
    cast(g, 'remember-the-fallen', [`pick:${a}`, `pick:${b}`, `pick:${c}`]);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
    expect(onBoard(g, 'shipyard-skulker', 0)).toHaveLength(1);
    expect(onBoard(g, 'banner-of-conquest', 0)).toHaveLength(1);
  });

  it('Resource Extractor: end of your turn, if you control this battlefield, a Gold', () => {
    const g = tbl(9897);
    put(g, 'resource-extractor', 0, bf(0));
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    reask(g); act(g, 'end'); drive(g, [], { max: 3 });
    expect(golds(g)).toBe(1);
  });

  it('Resplendent Rostrum: [E]: draw 1, channel 1; becoming exhausted, +3 to a friendly unit', () => {
    const g = tbl(9898);
    const r = put(g, 'resplendent-rostrum', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const n = handSize(g);
    reask(g); act(g, `act:${r}#0`); drive(g, [`t:${u}`]);
    expect(handSize(g)).toBe(n + 1);
    expect(mightOf(g.s, u)).toBe(6);
  });

  it('Riptide Mage: an enemy unit -3 this turn', () => {
    const g = tbl(9899);
    const e = put(g, 'mountain-drake', 1, base(1));
    cast(g, 'riptide-mage', [`t:${e}`]);
    expect(mightOf(g.s, e)).toBe(7);
  });

  it('Riven, Broken Blade: becoming exhausted, a mode not chosen this turn', () => {
    const g = tbl(9900);
    foe(g, 'mystic-poro');
    const r = put(g, 'riven-broken-blade', 0, base(0));
    moveTo(g, [r], 0); drive(g, ['mode:0']);
    expect(g.s.objects[r].buffs).toBe(1);
  });
});

describe('Radiance set: batch 5', () => {
  it('Riven, Deserter: another friendly unit exhausted: +1; exhaust a friendly unit: ready a unit, once a turn', () => {
    const g = tbl(9901);
    const r = put(g, 'riven-deserter', 0, base(0));
    const u = put(g, 'shipyard-skulker', 0, base(0));
    const v = put(g, 'vanguard-sergeant', 0, base(0), { exhausted: true });
    reask(g); act(g, `act:${r}#1`); drive(g, [`pick:${u}`, `t:${v}`]);
    expect(g.s.objects[v].exhausted).toBe(false);
    expect(mightOf(g.s, r)).toBe(6);
    reask(g);
    expect(keys(g)).not.toContain(`act:${r}#1`);
  });

  it('Riven, the Exile: units you play to battlefields you control enter ready', () => {
    const g = tbl(9902, { legends: ['riven-the-exile'] });
    put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    cast(g, 'vanguard-sergeant', ['loc:bf0']);
    cast(g, 'mystic-poro', ['loc:base']);
    expect(g.s.objects[onBoard(g, 'vanguard-sergeant', 0)[0]].exhausted).toBe(false);
    expect(g.s.objects[onBoard(g, 'mystic-poro', 0)[0]].exhausted).toBe(true);
  });

  it('Sanctum Conservator: a [7]+ card readies me', () => {
    const g = tbl(9903);
    runes(g, 0, [...ready('body', 12)]);
    const c = put(g, 'sanctum-conservator', 0, base(0), { exhausted: true });
    cast(g, 'mountain-drake');
    expect(g.s.objects[c].exhausted).toBe(false);
  });

  it('Satchel Charge: move a friendly unit, then a Bomb to a battlefield', () => {
    const g = tbl(9904);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'satchel-charge', [`t:${u}`, 'loc:bf0', 'loc:bf1']);
    expect(g.s.objects[u].zone).toEqual({ z: 'bf', bf: 0 });
    expect(onBoard(g, 'bomb', 0)).toHaveLength(1);
  });

  it('Scorched Earth: 5 damage split among units at a single battlefield', () => {
    const g = tbl(9905);
    const e = foe(g, 'mountain-drake');
    cast(g, 'scorched-earth', [`t:${g.s.bfs[1].obj}`]);
    expect(dmg(g, e)).toBe(5);
  });

  it('Scrutinizing Scope: the opponent guesses a type; a wrong guess draws the top card', () => {
    const g = tbl(9906);
    const sc = put(g, 'scrutinizing-scope', 0, base(0));
    moveObject(g.s, inHand(g, 'mountain-drake'), { z: 'deck', p: 0 }, { pos: 'top' });
    reask(g); act(g, `act:${sc}#0`); drive(g, ['mode:1']);
    expect(defsIn(g, 'hand')).toContain('mountain-drake');
  });

  it('Seraphic Wyvern: channelling, one more rune exhausted', () => {
    const g = tbl(9907);
    put(g, 'seraphic-wyvern', 0, base(0));
    const n = g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
    cast(g, 'sacrifice', [`pick:${put(g, 'mountain-drake', 0, base(0))}`]);
    expect(g.s.players[0].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length).toBe(n + 2);
  });

  it('Sett, Kingpin: +1 for each buffed friendly unit at my battlefield', () => {
    const g = tbl(9908);
    const k = put(g, 'sett-kingpin', 0, bf(0));
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    setField(g.s, g.s.objects[u], 'buffs', 1);
    expect(mightOf(g.s, k)).toBe(6);
  });

  it('Shimmering Swimmer: killing a friendly unit or gear as it is played deals 2', () => {
    const g = tbl(9909);
    const gr = put(g, 'banner-of-conquest', 0, base(0));
    const e = put(g, 'mountain-drake', 1, base(1));
    const id = inHand(g, 'shimmering-swimmer');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g, [`pick:${gr}`, `t:${e}`]);
    expect(dmg(g, e)).toBe(2);
  });

  it('Skystrike Squadron: return a friendly gear for [2] less', () => {
    const g = tbl(9910);
    put(g, 'banner-of-conquest', 0, base(0));
    const id = inHand(g, 'skystrike-squadron');
    reask(g); act(g, `play:${id}`); act(g, 'yes');
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    expect(g.s.pending).toMatchObject({ kind: 'payment', prompt: { energy: 3 } });
  });

  it('Spirit of the Forge: returning a gear readies me with +its Energy cost', () => {
    const g = tbl(9911);
    put(g, 'gravity-field', 0, base(0));
    const id = inHand(g, 'spirit-of-the-forge');
    reask(g); act(g, `play:${id}`); act(g, 'yes'); drive(g);
    const sp = onBoard(g, 'spirit-of-the-forge', 0)[0];
    expect(g.s.objects[sp].exhausted).toBe(false);
    expect(mightOf(g.s, sp)).toBe(9);
    expect(defsIn(g, 'hand')).toContain('gravity-field');
  });

  it('Stalwart Goatherd: may kill a gear costing [4] or less', () => {
    const g = tbl(9912);
    const gr = put(g, 'banner-of-conquest', 1, base(1));
    cast(g, 'stalwart-goatherd', [`t:${gr}`]);
    expect(g.s.objects[gr]).toBeUndefined();
  });

  it('Stoic Ferryman: played to a battlefield, may move another unit of mine here to base', () => {
    const g = tbl(9913);
    const u = put(g, 'shipyard-skulker', 0, bf(0)); control(g, 0, 0);
    cast(g, 'stoic-ferryman', ['loc:bf0', `t:${u}`]);
    expect(g.s.objects[u].zone).toEqual({ z: 'base', p: 0 });
  });

  it('Storm Raptor: a stunned enemy unit dies here: draw 1', () => {
    const g = tbl(9914);
    put(g, 'storm-raptor', 0, bf(0)); control(g, 0, 0);
    const e = put(g, 'mystic-poro', 1, bf(0));
    setField(g.s, g.s.objects[e], 'stunned', true);
    const n = handSize(g);
    reask(g); drive(g);
    expect(g.s.objects[e]).toBeUndefined();
    expect(handSize(g)).toBe(n + 1);
  });

  it('Titanic Shrine: playing the mightiest unit, exhaust me to draw 1', () => {
    const g = tbl(9915);
    runes(g, 0, [...ready('body', 12)]);
    put(g, 'titanic-shrine', 0, base(0));
    const n = handSize(g);
    cast(g, 'mountain-drake');
    expect(handSize(g)).toBe(n + 1);
  });

  it('Transpositionist: return a friendly unit; may play a weaker unit from hand, free', () => {
    const g = tbl(9916);
    const t = put(g, 'transpositionist', 0, base(0));
    const u = put(g, 'vanguard-sergeant', 0, base(0));
    emptyHand(g);
    const p = inHand(g, 'mystic-poro');
    reask(g); act(g, `act:${t}#0`); drive(g, [`t:${u}`, `pick:${p}`]);
    expect(onBoard(g, 'mystic-poro', 0)).toHaveLength(1);
    expect(defsIn(g, 'hand')).toContain('vanguard-sergeant');
  });

  it('Trifarian Captain: may draw a cheap unit or gear of the top 4', () => {
    const g = tbl(9917);
    const v = moveObject(g.s, inHand(g, 'banner-of-conquest'), { z: 'deck', p: 0 }, { pos: 'top' });
    cast(g, 'trifarian-captain', [`pick:${v}`]);
    expect(defsIn(g, 'hand')).toContain('banner-of-conquest');
  });

  it('War Scout: a unit +2 this turn', () => {
    const g = tbl(9918);
    const u = put(g, 'shipyard-skulker', 0, base(0));
    cast(g, 'war-scout', [`t:${u}`]);
    expect(mightOf(g.s, u)).toBe(5);
  });

  it('Watchful Curator: your gear have Deflect', () => {
    const g = tbl(9919);
    put(g, 'watchful-curator', 0, base(0));
    const gr = put(g, 'banner-of-conquest', 0, base(0));
    expect(hasKeyword(g.s, gr, 'deflect')).toBe(true);
  });

  it('Whirling Twirligig: [E]: a Gold; kill a gear: a Recruit; kill a unit: a Mech', () => {
    const g = tbl(9920);
    const w = put(g, 'whirling-twirligig', 0, base(0));
    const u = put(g, 'mystic-poro', 0, base(0));
    reask(g); act(g, `act:${w}#2`); drive(g, [`pick:${u}`]);
    expect(onBoard(g, 'mech', 0)).toHaveLength(1);
  });

  it('Zero-Point Inflection: playing a card draws 2; drawing with 9 others in hand ends it', () => {
    const g = tbl(9921);
    put(g, 'zero-point-inflection', 0, base(0));
    emptyHand(g);
    const n = handSize(g);
    cast(g, 'mystic-poro');
    expect(handSize(g)).toBe(n + 2);
    for (let i = 0; i < 9; i++) inHand(g, 'mystic-poro');
    const pts = g.s.players[1].points;
    cast(g, 'mystic-poro');
    expect(onBoard(g, 'zero-point-inflection', 0)).toHaveLength(0);
    expect(handSize(g)).toBe(0);
    expect(g.s.players[1].points).toBe(pts + 1);
  });

  it('Ziggs, Explosive: [1], [E]: a Bomb; defending, may kill a friendly gear for +2', () => {
    const g = tbl(9922);
    const z = put(g, 'ziggs-explosive', 0, base(0));
    reask(g); act(g, `act:${z}#0`); drive(g, ['loc:bf1']);
    expect(onBoard(g, 'bomb', 0)).toHaveLength(1);
  });

  it('Ziggs, Hexplosives Expert: [1][A], [E]: a Bomb', () => {
    const g = tbl(9923, { legends: ['ziggs-hexplosives-expert'] });
    reask(g); act(g, `act:${g.s.players[0].legend[0]}#0`); drive(g);
    expect(onBoard(g, 'bomb', 0)).toHaveLength(1);
  });

  it('Ziggs, Short Fuse: a Bomb; abilities of friendly gear deal 1 Bonus Damage', () => {
    const g = tbl(9924);
    cast(g, 'ziggs-short-fused', ['loc:bf1']);
    const b = onBoard(g, 'bomb', 0)[0];
    const e = foe(g, 'mountain-drake');
    cast(g, 'an-offer-you-cant-refuse', [`t:${b}`, `t:${e}`]);
    expect(dmg(g, e)).toBe(3);
  });
});
