/*
 * Conditions (§9.2 CondAst): the "if" of an instruction [359.3.e], an
 * intervening "if" of a trigger [383.2.a.1], the "while" of a static
 * ability [365] or a replacement [367]. A condition reads the state now,
 * the facts of the play that made the item [135.2.b.7] and the outcomes of
 * the item's earlier instructions [359.3.e.14].
 */
import type { CondAst } from '../dsl/ast.ts';
import { locOf } from '../state/zones.ts';
import type { GameState, ObjId, Outcome, PlayedRecord, PlayerId } from '../state/types.ts';
import { selectAll } from './targets.ts';

export interface CondCtx {
  controller: PlayerId;
  /** "I/me": the ability's source, or the card being played. */
  source: ObjId | null;
  /** What was performed while the card was played ("if you showed off"). */
  facts?: PlayedRecord | null;
  /** The item's outcomes so far, by instruction id (`id:<name>`). */
  outcomes?: Record<string, Outcome>;
}

const cmp = (a: number, op: string, b: number) =>
  op === '<' ? a < b : op === '<=' ? a <= b : op === '=' ? a === b : op === '>=' ? a >= b : a > b;

/** Whether an outcome counts as "you do" [359.3.e.14.b]: the instruction
    did what it said, in full or in part. */
export const didIt = (o: Outcome | undefined) => o !== undefined && (o.o === 'executed' || o.o === 'partial');

export function evalCond(s: GameState, c: CondAst, x: CondCtx): boolean {
  switch (c.c) {
    case 'showedOff': return (x.facts?.showOff ?? []).some((r) => r.picks.length > 0);   // [832.1.c.1]
    case 'did': return didIt(x.outcomes?.[`id:${c.instr}`]);
    case 'not': return !evalCond(s, c.of, x);
    case 'and': return c.of.every((d) => evalCond(s, d, x));
    case 'yourTurn': return s.turn.player === x.controller;
    case 'selfAt': {
      const o = x.source === null ? undefined : s.objects[x.source];
      const loc = o ? locOf(o) : null;
      return loc !== null && (c.at === 'battlefield' ? loc.z === 'bf' : loc.z === 'base');
    }
    case 'count': return cmp(selectAll(s, c.of, { controller: x.controller, source: x.source }).length, c.op, c.n);
  }
}
