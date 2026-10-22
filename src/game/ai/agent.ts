/*
 * The computer opponent (§11): given its own view and nothing else, it
 * answers its pending decision with one of the decision's own option keys
 * (legal by construction, §11.1). It is a pure function of the view, its
 * configuration and its seed: the same game asks the same questions and
 * gets the same answers, in a worker or on the main thread alike, so a
 * game against the computer replays from its seed (and from its record,
 * which stores every answer anyway). Budgets are counts, never clocks.
 *
 *   beginner   the rule-based policy (policy.ts) on its view, softmax noise
 *              (T = 0.7), and Reactions considered only half the time
 *   normal     greedy simulate-and-evaluate (§11.4): each option (a whole
 *              Standard Move as one macro) is played out on a few
 *              determinizations of the view, both seats answered by the
 *              cheap policy until the next Main-Phase priority (the chain
 *              and any showdown or combat it caused are over), then
 *              evaluated (evaluate.ts). The same samples serve every option
 *              (common random numbers). Ending the turn is the position as
 *              it stands. Payment keeps runes for a Reaction in hand.
 *
 * "Hard" (ISMCTS, §11.6) is M3.
 */
// The rules' procedures register themselves on import; a worker that holds
// only the agent must load them before it can simulate anything.
import '../procedures.ts';
import type { DeckList } from '../decks/decklist.ts';
import { parseKey, type Decision, type Option } from '../core/decisions.ts';
import { choose } from '../core/run.ts';
import { blankFill, type PlayerView } from '../core/view.ts';
import { findCard } from '../cards/oracle.ts';
import { keywordsOf } from '../cards/registry.ts';
import { mightOf } from '../rules/chars.ts';
import { cloneState } from '../state/clone.ts';
import { mulberry32 } from '../state/rng.ts';
import type { GameState, Loc, ObjId, PlayerId } from '../state/types.ts';
import { determinize } from './determinize.ts';
import { evaluate } from './evaluate.ts';
import { argmax, cheapAnswer, heuristicScores, moveGain, readyUnits, realOptions } from './policy.ts';

export type AiLevel = 'beginner' | 'normal';

export interface AgentConfig {
  level: AiLevel;
  me: PlayerId;
  /** The AI's own seed, unrelated to the engine's (§11.2). */
  seed: number;
  /** Both players' lists: its own, and the opponent's open list (TR 401.5, §11.7). */
  decks: readonly DeckList[];
  /** Normal: determinizations per decision (default 3). */
  samples?: number;
  /** Normal: decisions a rollout may take before it is evaluated (default 80). */
  horizon?: number;
}

export interface AgentStats {
  level: AiLevel;
  options: number;
  rollouts: number;
  /** The options it weighed, best first, with their mean value. */
  top: { key: string; value: number }[];
}

export interface AgentReply {
  key: string;
  /** For a macro (a whole Standard Move): the keys that follow, to answer
      the same play's next decisions with while they are still offered. */
  plan?: string[];
  stats: AgentStats;
}

/** A seeded generator for one decision: the seed, the seat and the decision id. */
export function rngFor(seed: number, me: PlayerId, decision: number): () => number {
  let st = (Math.imul(seed ^ 0x9e3779b9, 31) + Math.imul(decision + 1, 0x85ebca6b) + me * 0x27d4eb2f) >>> 0;
  return () => {
    const r = mulberry32(st);
    st = r.next;
    return r.value;
  };
}

/** Answers p's pending decision in the view. */
export function decide(cfg: AgentConfig, v: PlayerView): AgentReply {
  const d = v.pending;
  if (!d || d.player !== cfg.me) throw new Error(`P${cfg.me} has no decision to answer`);
  const opts = realOptions(d);
  if (opts.length === 0) throw new Error(`decision ${d.id} has no real option`);
  const stats: AgentStats = { level: cfg.level, options: opts.length, rollouts: 0, top: [] };
  if (opts.length === 1) return { key: opts[0].key, stats };
  const rand = rngFor(cfg.seed, cfg.me, d.id);
  return cfg.level === 'beginner' ? beginner(v, d, rand, stats) : normal(cfg, v, d, rand, stats);
}

// ---------------------------------------------------------------- beginner --

function softmaxPick(scores: number[], t: number, rand: () => number): number {
  const max = Math.max(...scores);
  const w = scores.map((x) => Math.exp((x - max) / t));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
  return w.length - 1;
}

function beginner(v: PlayerView, d: Decision, rand: () => number, stats: AgentStats): AgentReply {
  const s = blankFill(v);
  const opts = realOptions(d);
  const scores = heuristicScores(s, d);
  // Misses Reactions: in a chain or a showdown it looks at its cards only half the time.
  if (d.kind === 'priority' && d.prompt.window !== 'main' && rand() < 0.5) {
    const pass = opts.findIndex((o) => o.key === 'pass');
    if (pass >= 0) return { key: 'pass', stats: { ...stats, top: [{ key: 'pass', value: 0 }] } };
  }
  const i = softmaxPick(scores, 0.7, rand);
  stats.top = opts.map((o, j) => ({ key: o.key, value: scores[j] })).sort((a, b) => b.value - a.value).slice(0, 5);
  return { key: opts[i].key, stats };
}

// ------------------------------------------------------------------ normal --

/** A candidate: the keys it sends, the first being an option of d; a
    Standard Move is an intent (these units to that place) whose keys
    follow from the decisions the engine actually asks, since it applies
    single options by itself. */
interface Candidate { keys: string[]; move?: { units: ObjId[]; dest: string } }

/** Answers decisions with the cheap policy until the horizon (§11.4). */
function rollout(s: GameState, turn: number, limit: number, rand: () => number): void {
  for (let n = 0; n < limit; n++) {
    const d = s.pending;
    if (!d || s.result) return;
    if (s.turn.n !== turn) return;
    if (d.kind === 'priority' && d.prompt.window === 'main') return;   // the chain and any showdown are over
    step(s, cheapAnswer(s, d, rand));
  }
}

/** One answer, in place, without presentation or the feasibility probe. */
function step(s: GameState, key: string): void {
  choose(s, { decision: s.pending!.id, key }, { inPlace: true, present: false, feasibility: 'cheap' });
}

const offered = (d: Decision, key: string) => d.options.some((o) => o.key === key);

const sameLoc = (l: Loc, dest: string, me: PlayerId) =>
  dest === 'loc:base' ? l.z === 'base' && l.p === me : l.z === 'bf' && `loc:bf${l.bf}` === dest;

/** Plays a candidate; returns the keys it sent, or null when this sample
    doesn't allow it. */
function playCandidate(s: GameState, me: PlayerId, c: Candidate): string[] | null {
  if (!c.move) {
    for (const key of c.keys) {
      const d = s.pending;
      if (!d || d.player !== me || !offered(d, key)) return null;
      step(s, key);
    }
    return c.keys;
  }
  const sent: string[] = [];
  const movesBefore = s.log.moves.length;
  for (let guard = 0; guard < 24; guard++) {
    const d = s.pending;
    if (!d || d.player !== me) break;
    let key: string | null = null;
    if (sent.length === 0 && c.keys[0] === 'move' && d.kind === 'priority') key = offered(d, 'move') ? 'move' : null;
    else if (d.kind === 'moveUnits') {
      const want = c.move.units.find((u) => offered(d, `u:${u}`));
      key = want !== undefined ? `u:${want}` : offered(d, 'done') ? 'done' : null;
    } else if (d.kind === 'moveDest') key = offered(d, c.move.dest) ? c.move.dest : null;
    else break;
    if (key === null) return null;
    step(s, key);
    sent.push(key);
  }
  const moved = s.log.moves.slice(movesBefore);
  const ok = c.move.units.every((u) => moved.some((m) => m.obj === u && sameLoc(m.to, c.move!.dest, me)))
    && moved.length === c.move.units.length;
  return ok ? sent : null;
}

/** Whole Standard Moves as macros (§11.6): per destination, every ready
    unit that can go, the strongest one alone, the strongest two, and each
    unit alone (up to 4). */
function moveMacros(s: GameState, me: PlayerId, d: Decision, prefix: string[]): Candidate[] {
  const out: Candidate[] = [];
  const picked = s.frames.find((f) => f.f === 'move');
  const already = picked && picked.f === 'move' ? picked.units : [];
  const units = d.kind === 'moveUnits' ? realOptions(d).filter((o) => o.key.startsWith('u:')).map((o) => parseKey(o.key)!.obj!)
    : readyUnits(s, me);
  if (units.length === 0 && already.length === 0) return out;
  const byMight = units.slice().sort((a, b) => mightOf(s, b) - mightOf(s, a) || a - b);
  const sets: ObjId[][] = [units];
  if (units.length > 1) sets.push([byMight[0]]);
  if (units.length > 1 && units.length <= 4) for (const u of byMight.slice(1)) sets.push([u]);
  if (units.length > 2) sets.push(byMight.slice(0, 2));
  if (already.length > 0) sets.push([]);
  const dests = [...s.bfs.map((_, bf) => `loc:bf${bf}`), 'loc:base'];
  const seen = new Set<string>();
  for (const set of sets) {
    const all = [...already, ...set].sort((a, b) => a - b);
    for (const dest of dests) {
      const id = `${all.join(',')}>${dest}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ keys: [...prefix, ...set.map((u) => `u:${u}`), 'done', dest], move: { units: all, dest } });
    }
  }
  return out;
}

/** The candidates for a decision: its real options, a Standard Move as
    whole macros, without the ways out (decline, back). */
function candidates(s: GameState, d: Decision): Candidate[] {
  const opts = realOptions(d).filter((o) => o.key !== 'decline' || realOptions(d).length === 1);
  const out: Candidate[] = [];
  if (d.kind === 'moveUnits') return moveMacros(s, d.player, d, []);
  if (d.kind === 'moveDest') {
    const f = s.frames.find((fr) => fr.f === 'move');
    const units = f && f.f === 'move' ? f.units : [];
    return opts.map((o) => ({ keys: [o.key], move: { units, dest: o.key } }));
  }
  for (const o of opts) {
    if (o.key === 'move' && d.kind === 'priority') out.push(...moveMacros(s, d.player, d, ['move']));
    else out.push({ keys: [o.key] });
  }
  return out;
}

/** Payment (§11.4): the engine's ranking, but keeping a Reaction in hand castable. */
function payment(v: PlayerView, d: Decision): string | null {
  const plans = realOptions(d).filter((o) => o.key.startsWith('pay:'));
  if (plans.length <= 1) return plans[0]?.key ?? null;
  const me = v.players[v.me];
  const reactions = me.hand.map((id) => v.objects[id]).filter((o) => o && 'def' in o
    && keywordsOf(o.def).some((k) => k.kw === 'reaction'));
  if (reactions.length === 0) return plans[0].key;
  const keeps = (o: Option) => {
    const plan = o.meta?.plan;
    if (!plan) return 0;
    let n = 0;
    for (const r of reactions) {
      const c = 'def' in r ? findCard(r.def)?.cost : undefined;
      if (!c) continue;
      const okEnergy = plan.leaves.readyRunes >= c.energy;
      const okPower = c.power.every((p) => p.k !== 'domain' || (plan.leaves.byDomain[p.d] ?? 0) > 0);
      if (okEnergy && okPower) n++;
    }
    return n * 10 - plan.attrition * 15;
  };
  let best = plans[0];
  for (const p of plans.slice(1)) if (keeps(p) > keeps(best)) best = p;
  return best.key;
}

function normal(cfg: AgentConfig, v: PlayerView, d: Decision, rand: () => number, stats: AgentStats): AgentReply {
  // Setup and bookkeeping that needs no lookahead.
  if (d.kind === 'playOrder' || d.kind === 'mulligan' || d.kind === 'orderTriggers' || d.kind === 'assignExcess'
    || d.kind === 'assignTier') {
    const s = blankFill(v);
    const scores = heuristicScores(s, d);
    const opts = realOptions(d);
    return { key: opts[argmax(scores)].key, stats };
  }
  if (d.kind === 'payment') {
    const k = payment(v, d);
    if (k) return { key: k, stats };
  }
  const k = cfg.samples ?? 3;
  const limit = cfg.horizon ?? 80;
  const samples: GameState[] = [];
  for (let i = 0; i < k; i++) samples.push(determinize(v, cfg.decks, rand));
  const cands = candidates(samples[0], d);
  if (cands.length === 0) return { key: realOptions(d)[0].key, stats };
  const turn = v.turn.n;
  const sentBy: (string[] | undefined)[] = [];
  const values = cands.map((c, i) => {
    let sum = 0, n = 0;
    for (const base of samples) {
      const s = cloneState(base);
      try {
        if (c.keys[0] === 'end' && d.kind === 'priority') {
          sum += evaluate(s, cfg.me);
          n++;
          continue;
        }
        const sent = playCandidate(s, cfg.me, c);
        if (!sent) continue;                                    // not a macro this sample allows
        sentBy[i] ??= sent;
        rollout(s, turn, limit, rand);
        stats.rollouts++;
        sum += evaluate(s, cfg.me);
        n++;
      } catch {
        // a simulation the sample can't finish (an S0-less rollback in a
        // play already under way): that candidate is not chosen on its basis
      }
    }
    return n === 0 ? -Infinity : sum / n;
  });
  // Moving must beat staying put by a margin, so it doesn't wander.
  const best = argmax(values.map((x, i) => x - (cands[i].keys[0] === 'move' || d.kind === 'moveUnits' ? 0.3 : 0)));
  stats.options = cands.length;
  stats.top = cands.map((c, i) => ({ key: c.keys.join(' '), value: Math.round(values[i] * 100) / 100 }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  const chosen = cands[best];
  const simulated = cands.some((c, i) => Number.isFinite(values[i]) && !(c.keys[0] === 'end' && d.kind === 'priority'));
  if (!Number.isFinite(values[best]) || (!simulated && cands.length > 1)) {
    // nothing could be simulated: fall back on the rule-based answer
    const s = blankFill(v);
    return { key: realOptions(d)[argmax(heuristicScores(s, d))].key, stats };
  }
  const keys = sentBy[best] ?? chosen.keys;
  return keys.length > 1 ? { key: keys[0], plan: keys.slice(1), stats } : { key: keys[0], stats };
}

/** Used by the combat preview later (§11.9); exported for tests. */
export const estimateMove = moveGain;

/** The card definitions the agent simulates with: a worker built from a
    different bundle must refuse to answer (§11.2). */
export { defsHash } from '../cards/registry.ts';
