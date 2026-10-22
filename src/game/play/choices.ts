/*
 * The choices of step 2 that cards and abilities share [355.3], [355.5–
 * 355.13], [403.2]: modes, then each target slot in order, every pick its
 * own decision. A slot's picks form one batch (§4.7): "up to two units" is
 * pick, pick, or Done once the minimum is met [355.13].
 *
 * The step is re-entrant (gather, then commit): what to ask next follows
 * from the choices recorded so far on the item, so an answer always belongs
 * to the question that is open now.
 */
import type { ModeAst, ProgAst, SlotAst } from '../dsl/ast.ts';
import { K, parseKey, type Option } from '../core/decisions.ts';
import { answer, ask, type RunCtx, type StepOut } from '../core/frames.ts';
import { setField } from '../state/mut.ts';
import type { ChainItem, Frame, GameState, ObjId, PlayerId, TargetRef } from '../state/types.ts';
import { slotCandidates, slotMax, slotMin, targetRef } from '../rules/targets.ts';

/** The slots an item chooses: its program's own, then each chosen mode's,
    modes in printed order [355.3]. */
export function slotsOf(prog: ProgAst | undefined, modes: readonly number[]): SlotAst[] {
  if (!prog) return [];
  const chosen: ModeAst[] = (prog.modes?.of ?? []).filter((_, i) => modes.includes(i));
  return [...(prog.choose ?? []), ...chosen.flatMap((m) => m.choose ?? [])];
}

/** Whether a mode can be chosen: every slot it must fill has a candidate
    [355.16]. */
export function modeLegal(s: GameState, m: ModeAst, it: { controller: PlayerId; source?: ObjId | null }): boolean {
  return (m.choose ?? []).every((sl) => slotMin(sl) === 0
    || slotCandidates(s, sl, { controller: it.controller, source: it.source ?? null }).length >= slotMin(sl));
}

/** Whether a program's choices can all be made now (the cheap stage of
    §4.6): enough legal modes, and a candidate for every slot that must be
    filled. */
export function choicesPossible(s: GameState, prog: ProgAst | undefined, it: { controller: PlayerId; source?: ObjId | null }):
  boolean {
  if (!prog) return true;
  const c = { controller: it.controller, source: it.source ?? null };
  if (!(prog.choose ?? []).every((sl) => slotMin(sl) === 0 || slotCandidates(s, sl, c).length >= slotMin(sl))) return false;
  if (prog.modes) return prog.modes.of.filter((m) => modeLegal(s, m, it)).length >= prog.modes.pick;
  return true;
}

const doneKey = (slot: string) => `slot:${slot}`;

export interface ChooseOpts {
  /** Offer 'back' (a discretionary play or activation, §4.4). */
  back: boolean;
  onBack: () => StepOut;
  /** No legal choice is left for something that must be chosen. */
  onImpossible: () => StepOut;
  /** For the prompt: the card or ability. */
  what: string;
  /** Whether the cost stays payable with this target chosen (a Deflect
      target adds [A] [809.1.c]); targets that make it unpayable are not
      offered (§4.6). */
  affordable?: (t: TargetRef) => boolean;
  /** The [A]s a target adds (OptionMeta.deflect). */
  deflect?: (t: TargetRef) => number;
}

/**
 * Asks the next open choice of the item's program, or returns 'complete'
 * once modes and targets are all chosen.
 */
export function chooseNext(s: GameState, f: Frame, x: RunCtx, it: ChainItem, prog: ProgAst | undefined, o: ChooseOpts):
  StepOut | 'complete' {
  if (!prog) return 'complete';
  const key = answer(f);
  if (key === K.back) return o.onBack();
  const ex = it.play.choices.executions[0];
  const c = { controller: it.controller, source: it.source ?? null };

  // Modes [355.3].
  if (prog.modes && ex.modes.length < prog.modes.pick) {
    const open = prog.modes.of.map((m, i) => ({ m, i })).filter(({ m, i }) => !ex.modes.includes(i) && modeLegal(s, m, it));
    if (open.length < prog.modes.pick - ex.modes.length) return o.onImpossible();
    if (key === undefined) {
      const options: Option[] = open.map(({ i }) => ({ key: K.mode(i) }));
      return ask(s, f, x, {
        player: it.controller, kind: 'mode',
        prompt: { t: 'mode', card: o.what, pick: prog.modes.pick, chosen: ex.modes.slice(),
          labels: prog.modes.of.map((m) => m.label) },
        ctx: { item: it.id, ...(it.obj !== undefined ? { source: it.obj } : {}), rule: '355.3' }, options,
        privateOptions: false, back: o.back, batch: `mode:item${it.id}`,
      });
    }
    const n = parseKey(key)!.n!;
    setField(s, ex, 'modes', [...ex.modes, n].sort((a, b) => a - b));
    return 'continue';
  }

  // Targets, slot by slot [355.5–355.13].
  for (const slot of slotsOf(prog, ex.modes)) {
    if (it.play.choices.asPlayed[doneKey(slot.id)] === true) continue;
    const chosen = (ex.targets[slot.id] ?? []).map((t) => (t.k === 'obj' ? t.id : -1));
    const others = (slot.distinctFrom ?? []).flatMap((sl) => (ex.targets[sl] ?? []).map((t) => (t.k === 'obj' ? t.id : -1)));
    const cands = slotCandidates(s, slot, c).filter((id) => !chosen.includes(id) && !others.includes(id)
      && (!o.affordable || o.affordable(targetRef(s, id))));
    const enough = chosen.length >= slotMin(slot);
    if (chosen.length >= slotMax(slot) || (enough && cands.length === 0)) {
      setField(s, it.play.choices.asPlayed, doneKey(slot.id), true);
      return 'continue';
    }
    if (!enough && cands.length === 0) return o.onImpossible();
    if (key === undefined) {
      const options: Option[] = cands.map((id: ObjId) => {
        const d = o.deflect?.(targetRef(s, id)) ?? 0;
        return { key: K.t(id), refs: [{ obj: id }], ...(d > 0 ? { meta: { deflect: d } } : {}) };
      });
      if (enough) options.push({ key: K.done });
      return ask(s, f, x, {
        player: it.controller, kind: 'target',
        prompt: { t: 'target', card: o.what, slot: slot.id, chosen: chosen.length, min: slotMin(slot), max: slotMax(slot),
          harm: slot.harm ?? false },
        ctx: { item: it.id, ...(it.obj !== undefined ? { source: it.obj } : {}), slot: slot.id, rule: '355.5' }, options,
        privateOptions: false, back: o.back, batch: `target:item${it.id}:slot:${slot.id}`,
      });
    }
    if (key === K.done) {
      setField(s, it.play.choices.asPlayed, doneKey(slot.id), true);
      return 'continue';
    }
    const id = parseKey(key)!.obj!;
    setField(s, ex.targets, slot.id, [...(ex.targets[slot.id] ?? []), targetRef(s, id)]);
    return 'continue';
  }
  return 'complete';
}
