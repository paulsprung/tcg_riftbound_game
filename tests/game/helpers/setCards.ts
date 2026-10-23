import { moveObject, setField } from '../../../src/game/state/mut.ts';
import { base, bf, control, put } from './scenario.ts';
import { drive, moveTo, table } from './cards.ts';
import type { ObjId } from '../../../src/game/index.ts';

/* Helpers of the whole-set card tests (tests/game/*-all.test.ts). */

export type G = ReturnType<typeof table>;
export const tbl = (seed: number, o: Parameters<typeof table>[1] = {}) => table(seed, o);
/** An enemy unit at battlefield 1, which P1 then holds. */
export const foe = (g: G, def: string, o: { damage?: number } = {}) => { const id = put(g, def, 1, bf(1), o); control(g, 1, 1); return id; };
export const defsIn = (g: G, z: 'hand' | 'trash' | 'banish' | 'deck', p: 0 | 1 = 0) => g.s.players[p][z].map((x) => g.s.objects[x].def);
export const emptyHand = (g: G, p: 0 | 1 = 0) => { for (const id of g.s.players[p].hand.slice()) moveObject(g.s, id, { z: 'trash', p }); };
export const runeCount = (g: G, p: 0 | 1 = 0) => g.s.players[p].base.filter((id) => g.s.objects[id].def.endsWith('-rune')).length;
export const dmg = (g: G, id: number) => (g.s.objects[id]?.damage ?? []).reduce((n, d) => n + d.amount, 0);
/** A friendly unit attacks the enemy at battlefield 1. */
export const attack = (g: G, attacker: number, answers: string[] = []) => { moveTo(g, [attacker], 1); drive(g, answers); };
/** Puts an Equipment of p's on the board attached to a unit. */
export function equip(g: G, def: string, unit: ObjId): ObjId {
  const u = g.s.objects[unit];
  const loc = u.zone.z === 'base' ? base(u.zone.p) : bf((u.zone as { bf: number }).bf);
  const e = put(g, def, u.controller!, loc);
  setField(g.s, g.s.objects[e], 'attachedTo', unit);
  return e;
}
/** The P0 golds on the board. */
export const golds = (g: G, p: 0 | 1 = 0) => Object.values(g.s.objects).filter((o) => o.def === 'gold' && o.controller === p
  && (o.zone.z === 'base' || o.zone.z === 'bf')).length;
