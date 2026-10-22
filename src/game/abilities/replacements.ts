/*
 * Replacement effects (§6.5, Spec E §3, [367–375]): abilities that change
 * an event before it happens. The deck's one replaceable event besides the
 * rules' own Burn Out [432.5] (rules/actions.ts) is playing a token
 * [440.2.c]: Heimerdinger, Academy Instructor's "If you would play a unit
 * token to a location while I'm at a battlefield, you may play a 3 [M]
 * Mech unit token to that same location instead."
 *
 * The token's play is the event. Its location is fixed by the instruction
 * or chosen in step 2 [440.2.b.1], so the replacement applies once the
 * location is known and before anything else of the play happens
 * [370.1.c]: the token on the chain is replaced by the other one, at the
 * same location (inheriting what the event said of it [375]). An optional
 * replacement asks its controller, the affected player [371.2], [372];
 * declining is "not applied this time" [371.2.b]. Each replacement applies
 * once per chain of replacing events: the replacing play's lineage holds
 * it [370.2], so the Mech is not replaced again. A replacement that would
 * make no difference (a Mech for a Mech) is not offered.
 */
import { abilitiesOf } from '../cards/registry.ts';
import type { ReplacementAst } from '../dsl/ast.ts';
import { isBoard } from '../state/zones.ts';
import type { ChainItem, GameState, ObjId } from '../state/types.ts';
import { TOKENS } from '../cards/tokens.ts';
import { evalCond } from '../rules/conditions.ts';
import { isType } from '../rules/chars.ts';

export interface ReplacementOffer { source: ObjId; a: ReplacementAst }

/** The replacements that would apply to a token item's play now, in board
    order; none already in its lineage [370.2]. */
export function tokenReplacements(s: GameState, it: ChainItem): ReplacementOffer[] {
  if (it.kind !== 'token') return [];
  const tok = s.objects[it.obj!];
  const lineage = (it.play.choices.asPlayed.lineage ?? []) as string[];
  const out: ReplacementOffer[] = [];
  for (const o of Object.values(s.objects)) {
    if (!isBoard(o.zone.z) || o.zone.z === 'facedown' || o.controller === null) continue;
    for (const a of abilitiesOf(o.def)) {
      if (a.kind !== 'replacement' || a.ev.ev !== 'playToken' || lineage.includes(a.id)) continue;
      if (a.ev.by === 'you' && o.controller !== it.controller) continue;
      if (!isType(tok, a.ev.type)) continue;
      if (a.while && !evalCond(s, a.while, { controller: o.controller, source: o.id })) continue;
      if (a.instead.playToken === tok.def || !Object.hasOwn(TOKENS, a.instead.playToken)) continue;   // no difference
      out.push({ source: o.id, a });
    }
  }
  return out.sort((x, y) => x.source - y.source);
}
