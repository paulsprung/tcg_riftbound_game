/*
 * Feasibility: offering only options that can finish (§4.6, [355.16],
 * [357.3]). A priority decision's options have passed the cheap stage
 * already (zone, timing, a payment plan, a candidate for every slot that
 * must be filled: play/playCard.ts, play/playAbility.ts). This filter is
 * the second stage, for the plays and activations whose choices interact
 * (modes, several slots): it plays the option out on a copy, answering
 * every later decision of the play with its first real option and payment
 * plan 0, and keeps the option if the play finishes without a rollback
 * (greedy completion). An option the probe can't settle within the budget
 * is kept: step 5's rollback [358.5] is the safety net.
 *
 * The probe runs on the decider's own information (§4.6): with
 * StepOptions.feasibility 'private' (real games) on blankFill(viewFor(s,
 * decider)), the view with every unknown object a vanilla placeholder, so
 * an option never vanishes because of a card the decider can't see; with
 * 'direct' (AI rollouts, whose state is already the AI's sample) on the
 * state itself; 'cheap' skips this stage.
 */
import { cardDef, abilityById } from '../cards/registry.ts';
import { cloneState } from '../state/clone.ts';
import { setPending } from '../state/mut.ts';
import type { Frame, GameState } from '../state/types.ts';
import type { ProgAst } from '../dsl/ast.ts';
import { K, parseKey, type AskSpec, type Option } from './decisions.ts';
import { defineFeasibility, top, type RunCtx } from './frames.ts';
import { run } from './run.ts';
import { blankFill, viewFor } from './view.ts';

/** The choices of a program interact when there are modes or several
    slots; a single slot is settled by the cheap stage. */
const interacting = (p: ProgAst | undefined) => !!p && (p.modes !== undefined || (p.choose ?? []).length > 1);

/** Whether an option needs the probe. */
function needsProbe(s: GameState, key: string): boolean {
  const k = parseKey(key);
  if (!k || k.obj === undefined) return false;
  const o = s.objects[k.obj];
  if (!o) return false;
  if (k.head === 'play') return interacting(cardDef(o.def)?.spell);
  if (k.head === 'act') {
    const a = abilityById(`${o.def}#${k.sub}`);
    return a?.kind === 'activated' && interacting(a.effect);
  }
  return false;
}

const SKIP: string[] = [K.decline, K.back, K.manualPay];

/** Plays one option out greedily on a copy; true if it finishes. */
function probe(base: GameState, key: string, x: RunCtx): boolean | 'unknown' {
  const s = cloneState(base);
  const depth = s.frames.length;
  const f = top(s)!;
  f.answer = key;
  const px: RunCtx = { steps: 0, limit: 20_000, present: false, check: false, feasibility: 'cheap', budget: x.budget,
    rollbacks: 0, stopDepth: depth };
  for (let nodes = 0; nodes <= x.budget; nodes++) {
    run(s, px);
    if (px.rollbacks! > 0) return false;
    if (s.frames.length < depth || s.result) return true;
    const d = s.pending;
    if (!d) return true;
    const pick = d.options.find((o) => !o.ui && !SKIP.includes(o.key));
    if (!pick) return false;
    setPending(s, null);
    top(s)!.answer = pick.key;
  }
  return 'unknown';
}

defineFeasibility((s: GameState, f: Frame, x: RunCtx, spec: AskSpec, options: Option[]): Option[] => {
  const probes = options.filter((o) => needsProbe(s, o.key));
  if (probes.length === 0) return options;
  if (s.frames[s.frames.length - 1] !== f) return options;
  const base = x.feasibility === 'direct' ? s : blankFill(viewFor(s, spec.player));
  const drop = new Set<string>();
  for (const o of probes) if (probe(base, o.key, x) === false) drop.add(o.key);
  return drop.size === 0 ? options : options.filter((o) => !drop.has(o.key));
});
