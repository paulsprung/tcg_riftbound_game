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
