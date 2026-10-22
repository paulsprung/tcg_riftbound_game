import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { viewFor } from '../../src/game/index.ts';
import { setField } from '../../src/game/state/mut.ts';
import { affordances } from '../../src/play/model/affordances.ts';
import { botAnswer } from '../../src/play/host/bot.ts';
import { boardOf } from '../../src/play/model/board.ts';
import { cardIndex, isRune, nameOf } from '../../src/play/model/cards.ts';
import { act, base, bf, control, inHand, keys, put, ready, reask, runes, start } from '../game/helpers/scenario.ts';

/*
 * The Play tab and the rest of the Seraphine deck (M1.3): Might after the
 * layers and keyword chips on the table, the prompts and buttons of Show
 * Off, optional costs, cost objects and replacements, and the bot's answers
 * to them (§12.4, §12.5).
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const names = (d: string) => nameOf(ix, d);
const quiet = (g: ReturnType<typeof start>) => {
  setField(g.s, g.s.objects[g.s.bfs[0].obj], 'def', 'abandoned-hall');
  setField(g.s, g.s.objects[g.s.bfs[1].obj], 'def', 'altar-to-unity');
};

describe('the rest of the Seraphine deck on the table', () => {
  it('shows Might after the layers and keywords now (Tank, Shield, Deflect)', () => {
    const g = start(61);
    quiet(g);
    const sera = put(g, 'seraphine-not-alone', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0), { exhausted: true });
    const dune = put(g, 'dune-devourer', 0, base(0));
    reask(g);
    const b = boardOf(viewFor(g.s, 1), isRune);
    const slot = (id: number) => b.opponent.base.find((c) => c.id === id)!;
    expect(slot(sera).might).toBe(2);                                // 1 + one other exhausted unit
    expect(slot(dune).keywords).toEqual({ deflect: 1 });
  });

  it('words Show Off, optional costs, cost objects and replacements; the bot answers them', () => {
    const g = start(62);
    quiet(g);
    runes(g, 0, ready('order', 12));
    const crasher = inHand(g, 'party-crasher');
    const display = inHand(g, 'rousing-display');
    reask(g);
    act(g, `play:${display}`);
    let v = viewFor(g.s, 0);
    let a = affordances(v, v.pending, [], v.pending, names);
    expect(a.prompt).toMatch(/Rousing Display: Show Off\?/);
    expect(a.objects[crasher]?.keys).toEqual([`pick:${crasher}`]);  // the hand card glows
    expect(a.buttons.map((x) => x.label)).toContain('Don\'t show off');
    expect(botAnswer(v, () => 0)).toMatch(/^pick:/);
    act(g, 'back');
    // Dune Devourer with two friendly units and enough runes: the optional cost is asked, then which unit.
    const dog = put(g, 'hunting-dog', 0, base(0));
    put(g, 'shipyard-skulker', 0, base(0));
    const dune = inHand(g, 'dune-devourer');
    reask(g);
    act(g, `play:${dune}`);
    v = viewFor(g.s, 0);
    a = affordances(v, v.pending, [], v.pending, names);
    expect(v.pending?.kind).toBe('optionalCost');
    expect(a.prompt).toMatch(/Dune Devourer: pay its optional additional cost/);
    expect(a.buttons.map((x) => x.label)).toEqual(expect.arrayContaining(['Pay it', 'Don\'t']));
    expect(botAnswer(v, () => 0)).toBe('yes');
    act(g, 'yes');
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    v = viewFor(g.s, 0);
    a = affordances(v, v.pending, [], v.pending, names);
    expect(a.prompt).toMatch(/choose a unit to kill/);
    expect(a.objects[dog]?.keys).toEqual([`pick:${dog}`]);
  });

  it('asks whether Heimerdinger replaces a token, in words', () => {
    const g = start(63);
    quiet(g);
    control(g, 0, 0);
    put(g, 'heimerdinger-academy-instructor', 0, bf(0));
    runes(g, 0, ready('order', 3));
    const maker = inHand(g, 'faithful-manufactor');
    reask(g);
    act(g, `play:${maker}`);
    if (keys(g).includes('loc:base')) act(g, 'loc:base');
    act(g, 'pay:0');
    act(g, 'pass');
    act(g, 'pass');
    const v = viewFor(g.s, 0);
    const a = affordances(v, v.pending, [], v.pending, names);
    expect(a.prompt).toMatch(/Heimerdinger, Academy Instructor: play a Mech instead of the Recruit\?/);
    expect(a.buttons.map((x) => x.label)).toEqual(expect.arrayContaining(['Instead', 'Keep it']));
  });
});
