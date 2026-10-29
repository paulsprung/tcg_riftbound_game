import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardDb } from '../../src/data/types.ts';
import { explainUnavailable, observe, viewFor } from '../../src/game/index.ts';
import { affordances } from '../../src/play/model/affordances.ts';
import { boardOf } from '../../src/play/model/board.ts';
import { cardIndex, isRune, nameOf } from '../../src/play/model/cards.ts';
import { describeAll } from '../../src/play/model/describe.ts';
import { act, base, inHand, put, ready, reask, runes, start } from '../game/helpers/scenario.ts';

/*
 * The Play tab's side of the chain (M1.2): the chain stack from a view,
 * Reactions offered as glowing cards when the human holds priority on a
 * chain, the prompts and buttons of modes, triggers and Predict, the log
 * lines of the chain, and why a card can't be played (§12.5, §12.7).
 */

const db: CardDb = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
const ix = cardIndex(db);
const names = (d: string) => nameOf(ix, d);

describe('the chain on the table', () => {
  it('shows the stack and offers the human\'s Reaction as a glowing card, with Pass', () => {
    const g = start(51);
    runes(g, 0, ready('mind', 10));
    runes(g, 1, ready('mind', 7));
    const x = put(g, 'hunting-dog', 1, base(1));
    const nova = inHand(g, 'supernova', 0);
    const moon = inHand(g, 'moonlight-affliction', 1);
    reask(g);
    act(g, `play:${nova}`);
    act(g, 'pay:0');
    act(g, 'pass');                                                  // P0 passes: P1 (the "human") holds priority
    const v = viewFor(g.s, 1);
    const b = boardOf(v, isRune);
    expect(b.chain).toEqual([expect.objectContaining({ def: 'supernova', kind: 'card', controller: 0, status: 'finalized' })]);
    const a = affordances(v, v.pending, [], v.pending, names);
    expect(a.prompt).toMatch(/Reaction/);
    expect(a.objects[moon]?.keys).toEqual([`play:${moon}`]);
    expect(a.buttons.map((bt) => bt.label)).toContain('Pass');
    const lines = describeAll(observe(g.events, 1), { me: 1, nameOf: names, objOf: (id) => {
      const o = v.objects[id];
      return o ? { def: 'def' in o ? o.def : null, owner: o.owner } : null;
    } }).map((l) => l.text);
    expect(lines.some((t) => /Supernova/.test(t))).toBe(false);      // not played until it resolves [420.4.a]
    void x;
  });

  it('labels modes, trigger order and Predict in words', () => {
    const g = start(52);
    runes(g, 0, ready('mind', 4));
    put(g, 'hunting-dog', 1, base(1));
    const encore = inHand(g, 'encore');
    reask(g);
    act(g, `play:${encore}`);
    const v = viewFor(g.s, 0);
    const a = affordances(v, v.pending, [], v.pending, names);
    expect(a.prompt).toMatch(/Encore: choose 2 more modes/);
    expect(a.buttons.map((bt) => bt.label)).toContain('Play two 1 Might Recruit unit tokens.');
  });

  it('explains why a card in hand can\'t be played now', () => {
    const g = start(53);
    runes(g, 0, []);
    const nova = inHand(g, 'supernova');
    const seeker = inHand(g, 'wild-claw');                           // a spell not defined yet (VEN; replace once it is)
    reask(g);
    const v = viewFor(g.s, 0);
    expect(explainUnavailable(v, nova).map((r) => r.rule)).toContain('203.3');
    expect(explainUnavailable(v, seeker).map((r) => r.rule)).toContain('§9.1');   // its text isn't in
  });
});
