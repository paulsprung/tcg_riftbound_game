import { describe, expect, it } from 'vitest';
import { choose, createGame, hashState, viewFor, type GameState, type PlayerId } from '../../src/game/index.ts';
import { decide, type AgentConfig, type AiLevel } from '../../src/game/ai/agent.ts';
import { determinize, unknownPools } from '../../src/game/ai/determinize.ts';
import { evaluate } from '../../src/game/ai/evaluate.ts';
import { mulberry32 } from '../../src/game/state/rng.ts';
import { SERAPHINE } from './helpers/decks.ts';

/*
 * The computer opponent (§11, §14.10): legal by construction (every answer
 * and every key of a plan it hands the host is an option of the decision it
 * answers), deterministic for a seed (worker and main thread alike), fair
 * (it gets a view; its samples agree with that view), and Normal beats
 * Beginner.
 */

const DECKS = [SERAPHINE, SERAPHINE];

interface Played { s: GameState; answers: number; illegal: string[] }

/** A game between two agents; plans are followed while they fit, as the host does. */
async function aiGame(seed: number, levels: [AiLevel, AiLevel], check: (cfg: AgentConfig, s: GameState) => void = () => {}): Promise<Played> {
  let s = createGame({ seed, decks: [SERAPHINE, SERAPHINE] }).state;
  const plans: string[][] = [[], []];
  const illegal: string[] = [];
  let answers = 0;
  while (s.pending && answers < 4000) {
    // let the worker answer vitest now and then (its RPC times out otherwise)
    if (answers % 50 === 0) await new Promise((r) => setTimeout(r, 0));
    const d = s.pending, p = d.player;
    const real = d.options.filter((o) => !o.ui).map((o) => o.key);
    let key: string;
    const plan = plans[p];
    if (plan.length > 0 && ['moveUnits', 'moveDest'].includes(d.kind) && real.includes(plan[0])) key = plan.shift()!;
    else {
      plans[p] = [];
      const cfg: AgentConfig = { level: levels[p], me: p, seed, decks: DECKS };
      check(cfg, s);
      const r = decide(cfg, viewFor(s, p));
      key = r.key;
      plans[p] = r.plan ?? [];
    }
    if (!real.includes(key)) illegal.push(`${d.kind}: '${key}' not in ${real.join(' ')}`);
    s = choose(s, { decision: d.id, key }, { check: answers % 25 === 0 }).state;
    answers++;
  }
  return { s, answers, illegal };
}

describe('§11 the computer opponent', () => {
  it('never answers with anything but a real option of its decision (Beginner and Normal, plans included)', async () => {
    for (const seed of [101, 102]) {
      const g = await aiGame(seed, seed % 2 ? ['normal', 'beginner'] : ['beginner', 'normal']);
      expect(g.illegal, `seed ${seed}`).toEqual([]);
      expect(g.s.result, `seed ${seed}`).not.toBeNull();
    }
  }, 120_000);

  it('is deterministic: the same view, seed and level give the same answer and the same game', async () => {
    let calls = 0;
    const g1 = await aiGame(7, ['normal', 'normal'], (cfg, s) => {
      if (calls++ % 15 !== 0) return;
      const v = viewFor(s, cfg.me);
      expect(decide(cfg, v)).toEqual(decide(cfg, structuredClone(v)));
    });
    const g2 = await aiGame(7, ['normal', 'normal']);
    expect(hashState(g2.s)).toBe(hashState(g1.s));
  }, 120_000);

  it('samples hidden cards from what its view leaves unknown, and its sample agrees with the view', () => {
    let s = createGame({ seed: 3, decks: [SERAPHINE, SERAPHINE] }).state;
    for (let i = 0; i < 60 && s.pending; i++) {
      s = choose(s, { decision: s.pending.id, key: s.pending.options.filter((o) => !o.ui)[0].key }).state;
    }
    const me: PlayerId = s.pending!.player;
    const v = viewFor(s, me);
    let st = 99;
    const rand = () => { const r = mulberry32(st); st = r.next; return r.value; };
    const sim = determinize(v, DECKS, rand);
    // the same zones, the same known cards, every unknown card from the owner's list
    for (const pl of v.players) {
      expect(sim.players[pl.id].hand).toEqual(pl.hand);
      expect(sim.players[pl.id].deck.length).toBe(pl.deck.length);
    }
    for (const [id, o] of Object.entries(v.objects)) {
      if ('def' in o) expect(sim.objects[Number(id)].def).toBe(o.def);
      else expect(sim.objects[Number(id)].def).not.toBe('placeholder');
    }
    const left = unknownPools(v, DECKS);
    const stubs = Object.values(v.objects).filter((o) => !('def' in o));
    expect(stubs.length).toBe(left.reduce((n, p) => n + p.main.length + p.runes.length, 0));
    // the sample is a game the engine can run on
    const d = sim.pending!;
    const after = choose(sim, { decision: d.id, key: d.options.filter((o) => !o.ui)[0].key }, { feasibility: 'direct' }).state;
    expect(after).toBeDefined();
    expect(Number.isFinite(evaluate(after, me))).toBe(true);
  });

  it('Normal beats Beginner in most of 8 seeded games, from either seat', async () => {
    let normalWins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      // let the worker answer vitest between games (its RPC times out otherwise)
      await new Promise((r) => setTimeout(r, 0));
      const normalSeat: PlayerId = seed % 2 ? 0 : 1;
      const levels: [AiLevel, AiLevel] = normalSeat === 0 ? ['normal', 'beginner'] : ['beginner', 'normal'];
      const g = await aiGame(seed, levels);
      expect(g.illegal).toEqual([]);
      if (g.s.result?.winner === normalSeat) normalWins++;
    }
    expect(normalWins).toBeGreaterThanOrEqual(5);
  }, 240_000);
});
