import { randomInt } from 'node:crypto';
import type { Card } from '../../src/data/types.ts';
import { defOfPrinting } from '../../src/game/cards/oracle.ts';
import type { DeckList, GameSetup } from '../../src/game/index.ts';
import { autoBuild, botPick, draftDone, limitedIssues, newDraft, pick, POD, sealedPool, type Draft, type LimitedFormat } from '../../src/limited/limited.ts';
import { BOOSTER_SETS } from '../../src/pack/packConfig.ts';
import type { Db } from '../db.ts';
import { Refused, secureRandom } from '../economy.ts';
import { cleanDeck, viewOf, type LimitedService, type PoolView } from '../limited.ts';
import type { Finished, Online } from '../games/online.ts';
import { pairRound, standings, swissRounds, topCutPairs, type MatchResult, type Standing } from './swiss.ts';

/*
 * Runs tournaments (swiss.ts has the pairing and the standings). An admin
 * makes one with its settings; players sign up with a deck, which is locked
 * from then on (a decklist), and pay the entry fee, which comes back if they
 * leave before the start or the tournament is cancelled. At the start time
 * (or when an admin starts it) the rounds run by themselves: each match is
 * played as online games (Bo1 or Bo3; who plays first by TR 407), byes count
 * as 2-0 wins, and a player who doesn't come within the no-show time loses
 * the match and is dropped (TR 703.8.d). The tiebreakers are TR 409's. After the Swiss rounds the best 4 or 8 play
 * a single-elimination top cut. At the end the prizes go out by final place.
 *
 * A Limited tournament (Sealed or Draft, TR 602) signs players up without a
 * deck. At the start each gets six boosters (Sealed), or the field drafts in
 * pods of eight, computer seats filling a pod, a pick clock on every pick
 * (a seat out of time picks the computer's pick). Then everyone builds until
 * the build time is up (or all are ready); the deck each has then is their
 * decklist for the rounds, a first build of their pool if they made none.
 *
 * Everything lives in the database (tournaments, tournament_players,
 * tournament_matches); a restart picks up where it was. One change at a
 * time: every step runs in order on one chain.
 */

export interface Prize { coins: number; packs?: Record<string, number> }

export interface Settings {
  bestOf: 1 | 3;
  maxPlayers: number;
  entryFee: number;
  /** 0 for none. */
  topCut: 0 | 4 | 8;
  /** Swiss rounds; null: as many as the field needs. */
  rounds: number | null;
  /** By final place: prizes[0] for the winner. */
  prizes: Prize[];
  noShowMinutes: number;
  /** Constructed (your own deck) or a Limited format (TR 602). */
  format: 'constructed' | LimitedFormat;
  /** Limited: the boosters' set. */
  setId: string | null;
  /** Limited: minutes to build, seconds for each draft pick. */
  buildMinutes: number;
  pickSeconds: number;
}

/** A draft pod: which player sits in each seat (null: a computer seat) and its draft. */
interface Pod { seats: (string | null)[]; draft: Draft; deadline: number }

export interface TournamentInput { name: string; startsAt: number; settings: Partial<Settings> }

const DEFAULTS: Settings = { bestOf: 1, maxPlayers: 32, entryFee: 0, topCut: 0, rounds: null, prizes: [], noShowMinutes: 10,
  format: 'constructed', setId: null, buildMinutes: 20, pickSeconds: 40 };

interface Row { id: string; name: string; status: string; settings: Settings; starts_at: Date; round: number; stage: 'swiss' | 'top';
  draft: { pods: Pod[] } | null; build_until: Date | null }
interface MatchRow { id: string; round: number; stage: string; tbl: number; a: string; b: string | null; wins: number[]; games: number; status: string; game_id: string | null }

export function cleanSettings(s: Partial<Settings>): Settings {
  const out = { ...DEFAULTS, ...s };
  const int = (v: unknown, lo: number, hi: number, what: string) => {
    if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Refused(`${what}: ${lo} to ${hi}`);
  };
  if (out.bestOf !== 1 && out.bestOf !== 3) throw new Refused('Best of 1 or 3');
  if (![0, 4, 8].includes(out.topCut)) throw new Refused('Top cut: none, 4 or 8');
  int(out.maxPlayers, 2, 256, 'Players');
  int(out.entryFee, 0, 100_000, 'Entry fee');
  int(out.noShowMinutes, 1, 30, 'No-show minutes');
  if (out.rounds !== null) int(out.rounds, 1, 12, 'Rounds');
  if (!['constructed', 'sealed', 'draft'].includes(out.format)) throw new Refused('Format: constructed, sealed or draft');
  if (out.format === 'constructed') out.setId = null;
  else if (!BOOSTER_SETS.some((b) => b.id === out.setId)) throw new Refused('Limited needs a set of boosters');
  int(out.buildMinutes, 5, 60, 'Build minutes');
  int(out.pickSeconds, 15, 120, 'Pick seconds');
  if (!Array.isArray(out.prizes) || out.prizes.length > 64) throw new Refused('Prizes: up to 64 places');
  out.prizes = out.prizes.map((p) => {
    int(p?.coins ?? 0, 0, 1_000_000, 'Prize coins');
    const packs = p?.packs ?? {};
    for (const [set, n] of Object.entries(packs)) {
      if (!BOOSTER_SETS.some((b) => b.id === set)) throw new Refused(`No pack ${set}`);
      int(n, 1, 100, 'Prize packs');
    }
    return { coins: p?.coins ?? 0, ...(Object.keys(packs).length ? { packs } : {}) };
  });
  return out;
}

const roundName = (stage: string, round: number, cutLeft: number) =>
  (stage === 'swiss' ? `Round ${round}` : cutLeft === 2 ? 'Final' : cutLeft === 4 ? 'Semifinal' : 'Quarterfinal');

export class Director {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(private readonly db: Db, private readonly online: Online, private readonly limited: LimitedService | null = null,
    private readonly now: () => number = Date.now) {
    online.onFinish((f) => (f.meta ? this.serial(() => this.gameOver(f)) : undefined));
    this.ticker = setInterval(() => { void this.tick(); }, 5000);
    this.ticker.unref?.();
  }

  stop() { clearInterval(this.ticker); }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ---- what admins do ----

  async create(adminId: string, input: TournamentInput): Promise<string> {
    const name = String(input?.name ?? '').trim();
    if (!name || name.length > 60) throw new Refused('A name, up to 60 characters');
    const at = Number(input?.startsAt);
    if (!Number.isFinite(at) || at < this.now() - 60_000) throw new Refused('A start time in the future');
    const settings = cleanSettings(input?.settings ?? {});
    const r = await this.db.query('INSERT INTO tournaments (name, settings, starts_at, created_by) VALUES ($1, $2, to_timestamp($3 / 1000.0), $4) RETURNING id',
      [name, JSON.stringify(settings), at, adminId]);
    return r.rows[0].id as string;
  }

  start(id: string) { return this.serial(() => this.begin(id)); }

  cancel(id: string) {
    return this.serial(async () => {
      const t = await this.get(id);
      if (t.status === 'done' || t.status === 'cancelled') throw new Refused('It is over already');
      await this.refundAll(t, 'cancelled');
      await this.db.query("UPDATE tournaments SET status = 'cancelled', ended_at = now() WHERE id = $1", [id]);
    });
  }

  // ---- what players do ----

  join(userId: string, name: string, id: string, deckRef: string) {
    return this.serial(async () => {
      const t = await this.get(id);
      if (t.status !== 'open') throw new Refused('Sign-up is closed');
      // a Limited tournament makes the decks from the pools it hands out
      const limited = t.settings.format !== 'constructed';
      const deck = limited ? {} : await this.online.deckFor(userId, String(deckRef));
      if (limited) deckRef = 'limited';
      const c = await this.db.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE', [id]);
        const n = (await c.query('SELECT count(*)::int AS n, bool_or(user_id = $2) AS mine FROM tournament_players WHERE tournament_id = $1', [id, userId])).rows[0];
        if (n.mine) throw new Refused('You are signed up already');
        if (n.n >= t.settings.maxPlayers) throw new Refused('The tournament is full');
        if (t.settings.entryFee > 0) {
          await c.query('INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
          const r = await c.query('UPDATE accounts SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2', [userId, t.settings.entryFee]);
          if (r.rowCount !== 1) throw new Refused(`The entry fee is ${t.settings.entryFee} coins`);
          await c.query('INSERT INTO ledger (user_id, coins, reason) VALUES ($1, $2, $3)', [userId, -t.settings.entryFee, `tournament entry ${t.id}`]);
        }
        await c.query('INSERT INTO tournament_players (tournament_id, user_id, name, deck_ref, deck) VALUES ($1, $2, $3, $4, $5)',
          [id, userId, name, deckRef, JSON.stringify(deck)]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally { c.release(); }
    });
  }

  leave(userId: string, id: string) {
    return this.serial(async () => {
      const t = await this.get(id);
      if (t.status === 'open') {
        const c = await this.db.connect();
        try {
          await c.query('BEGIN');
          const r = await c.query('DELETE FROM tournament_players WHERE tournament_id = $1 AND user_id = $2', [id, userId]);
          if (r.rowCount !== 1) throw new Refused('You are not signed up');
          if (t.settings.entryFee > 0) await this.refund(c, userId, t, 'left');
          await c.query('COMMIT');
        } catch (err) { await c.query('ROLLBACK').catch(() => undefined); throw err; } finally { c.release(); }
        return;
      }
      if (t.status !== 'running') throw new Refused('It is over');
      // a drop: no more pairings; a match in progress is played out
      const r = await this.db.query('UPDATE tournament_players SET dropped = true WHERE tournament_id = $1 AND user_id = $2 AND NOT dropped', [id, userId]);
      if (r.rowCount !== 1) throw new Refused('You are not in it');
    });
  }

  // ---- the running ----

  /** Starts what is due, runs the draft clocks and build times, picks up matches whose game was lost
      in a restart: one tick at a time, in line with everything else. */
  tick() { return this.serial(() => this.due()); }

  private async due() {
    const due = await this.db.query("SELECT id FROM tournaments WHERE status = 'open' AND starts_at <= now()");
    for (const r of due.rows) await this.begin(r.id).catch((err) => console.error(`tournament ${r.id}:`, err instanceof Error ? err.message : err));
    // the pick clock of the drafts, the end of the build time
    const limited = await this.db.query("SELECT id FROM tournaments WHERE status IN ('drafting', 'building')");
    for (const r of limited.rows) await this.limitedTick(await this.get(r.id)).catch((err) => console.error(`tournament ${r.id}:`, err instanceof Error ? err.message : err));
    const stuck = await this.db.query(`SELECT m.*, t.name AS tname, t.settings FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.status = 'playing' AND t.status = 'running'`);
    for (const m of stuck.rows) if (!m.game_id || !this.online.isLive(m.game_id)) await this.playGame(await this.get(m.tournament_id), m);
  }

  private async begin(id: string) {
    const t = await this.get(id);
    if (t.status !== 'open') throw new Refused('Not open');
    const n = (await this.db.query('SELECT count(*)::int AS n FROM tournament_players WHERE tournament_id = $1', [id])).rows[0].n;
    if (n < 2) {
      await this.refundAll(t, 'not enough players');
      await this.db.query("UPDATE tournaments SET status = 'cancelled', ended_at = now() WHERE id = $1", [id]);
      return;
    }
    if (t.settings.format !== 'constructed') { await this.beginLimited(t); return; }
    await this.db.query("UPDATE tournaments SET status = 'running', starts_at = least(starts_at, now()) WHERE id = $1", [id]);
    await this.nextRound(await this.get(id));
  }

  // ---- Limited: the pools, the draft, the build ----

  private async catalog() {
    if (!this.limited) throw new Refused('Limited play is not set up');
    return this.limited.cards();
  }

  /** Sealed: everyone's six boosters and a first build; Draft: the pods. */
  private async beginLimited(t: Row) {
    const cat = await this.catalog();
    const ps = (await this.players(t.id)).map((p) => p.user_id);
    const setId = t.settings.setId!;
    if (t.settings.format === 'sealed') {
      for (const u of ps) {
        const cards = sealedPool(cat.db, setId, secureRandom);
        await this.db.query(`INSERT INTO limited_pools (user_id, format, set_id, cards, deck, tournament_id) VALUES ($1, 'sealed', $2, $3, $4, $5)`,
          [u, setId, JSON.stringify(cards), JSON.stringify(autoBuild(cards, 'sealed', cat.byId)), t.id]);
      }
      await this.db.query(`UPDATE tournaments SET status = 'building', starts_at = least(starts_at, now()),
        build_until = now() + make_interval(mins => $2) WHERE id = $1`, [t.id, t.settings.buildMinutes]);
    } else {
      // pods of up to eight, as even as they come; computer seats fill each
      const order = [...ps].sort(() => secureRandom() - 0.5);
      const pods = Math.ceil(order.length / POD);
      const list: Pod[] = [];
      for (let i = 0; i < pods; i++) {
        const humans = order.filter((_, k) => k % pods === i);
        const seats: (string | null)[] = Array.from({ length: POD }, (_, k) => humans[k] ?? null);
        list.push(this.botsPick({ seats, draft: newDraft(cat.db, setId, secureRandom), deadline: this.now() + t.settings.pickSeconds * 1000 }, cat.byId));
      }
      for (const u of ps) {
        await this.db.query(`INSERT INTO limited_pools (user_id, format, set_id, tournament_id) VALUES ($1, 'draft', $2, $3)`, [u, setId, t.id]);
      }
      await this.db.query(`UPDATE tournaments SET status = 'drafting', starts_at = least(starts_at, now()), draft = $2 WHERE id = $1`,
        [t.id, JSON.stringify({ pods: list })]);
    }
    for (const u of ps) this.online.notify(u, 'tournament');
  }

  /** The computer seats of a pod pick from the packs in front of them. */
  private botsPick(pod: Pod, cards: Map<string, Card>): Pod {
    let d = pod.draft;
    for (const [s, who] of pod.seats.entries()) if (who === null && !d.picked[s] && !draftDone(d)) d = pick(d, s, botPick(cards, d.packs[s], d.picks[s]));
    return { ...pod, draft: d };
  }

  /** A player's pick in a tournament draft. */
  pick(userId: string, id: string, card: unknown) {
    return this.serial(async () => {
      const t = await this.get(id);
      if (t.status !== 'drafting' || !t.draft) throw new Refused('Not drafting');
      if (!t.draft.pods.some((p) => p.seats.includes(userId))) throw new Refused('Not in this draft', 404);
      const cat = await this.catalog();
      const pods = t.draft.pods.map((p) => {
        const seat = p.seats.indexOf(userId);
        if (seat < 0) return p;
        if (p.draft.picked[seat] || draftDone(p.draft)) throw new Refused('Wait for the next pack');
        return this.advance({ ...p, draft: pick(p.draft, seat, String(card)) }, p.draft, t, cat.byId);
      });
      await this.saveDraft(t, pods);
      return this.poolOf(userId, id);
    });
  }

  /** After picks: when the turn changed, the computer seats pick and the clock starts again. */
  private advance(pod: Pod, before: Draft, t: Row, cards: Map<string, Card>): Pod {
    // every seat picked: the packs passed, a new turn
    if (!pod.draft.picked.every((x) => !x) || pod.draft === before) return pod;
    const next = this.botsPick({ ...pod, deadline: this.now() + t.settings.pickSeconds * 1000 }, cards);
    return next;
  }

  private async saveDraft(t: Row, pods: Pod[]) {
    await this.db.query('UPDATE tournaments SET draft = $2 WHERE id = $1', [t.id, JSON.stringify({ pods })]);
    for (const p of pods) for (const u of p.seats) if (u) this.online.notify(u, 'tournament');
    if (!pods.every((p) => draftDone(p.draft))) return;
    // the draft is over: each player's picks are their pool, with a first build
    const cat = await this.catalog();
    for (const p of pods) {
      for (const [s, u] of p.seats.entries()) {
        if (!u) continue;
        const cards = p.draft.picks[s];
        await this.db.query('UPDATE limited_pools SET cards = $3, deck = $4 WHERE tournament_id = $1 AND user_id = $2',
          [t.id, u, JSON.stringify(cards), JSON.stringify(autoBuild(cards, 'draft', cat.byId))]);
      }
    }
    await this.db.query(`UPDATE tournaments SET status = 'building', build_until = now() + make_interval(mins => $2) WHERE id = $1`, [t.id, t.settings.buildMinutes]);
  }

  /** The pick clock: a seat out of time takes the computer's pick; the build time's end starts the rounds. */
  private async limitedTick(t: Row) {
    if (t.status === 'drafting' && t.draft) {
      const late = t.draft.pods.some((p) => !draftDone(p.draft) && this.now() >= p.deadline);
      if (!late) return;
      const cat = await this.catalog();
      const pods = t.draft.pods.map((p) => {
        if (draftDone(p.draft) || this.now() < p.deadline) return p;
        // the seats late in this turn, fixed before any pick: the last of them passes the packs,
        // and nobody picks from the next ones before the computer seats have
        const late = p.seats.flatMap((who, s) => (who && !p.draft.picked[s] ? [s] : []));
        let d = p.draft;
        for (const s of late) d = pick(d, s, botPick(cat.byId, d.packs[s], d.picks[s]));
        return this.advance({ ...p, draft: d }, p.draft, t, cat.byId);
      });
      await this.saveDraft(t, pods);
    } else if (t.status === 'building' && t.build_until && this.now() >= new Date(t.build_until).getTime()) {
      await this.lockDecks(t);
    }
  }

  /** The build is over: each player's deck is their decklist for the rounds (TR 602.4.a.7). */
  private async lockDecks(t: Row) {
    const cat = await this.catalog();
    const pools = (await this.db.query('SELECT * FROM limited_pools WHERE tournament_id = $1', [t.id])).rows;
    for (const p of pools) {
      const legal = p.deck && limitedIssues(p.deck, p.cards, p.format).length === 0;
      const deck = legal ? p.deck : autoBuild(p.cards, p.format, cat.byId);
      const printings: Record<string, string[]> = {};
      for (const id of p.cards as string[]) { const def = defOfPrinting(id); if (def) (printings[def] ??= []).push(id); }
      await this.db.query('UPDATE tournament_players SET deck = $3 WHERE tournament_id = $1 AND user_id = $2', [t.id, p.user_id, JSON.stringify({ ...deck, printings })]);
    }
    await this.db.query("UPDATE tournaments SET status = 'running', build_until = NULL WHERE id = $1", [t.id]);
    await this.nextRound(await this.get(t.id));
  }

  /** Everyone is done building: the rounds start before the time is up. */
  ready(userId: string, id: string) {
    return this.serial(async () => {
      const t = await this.get(id);
      if (t.status !== 'building') throw new Refused('Not building');
      await this.db.query('UPDATE tournament_players SET deck_ref = $3 WHERE tournament_id = $1 AND user_id = $2', [t.id, userId, 'limited:ready']);
      const waiting = await this.db.query("SELECT 1 FROM tournament_players WHERE tournament_id = $1 AND NOT dropped AND deck_ref <> 'limited:ready'", [t.id]);
      if (!waiting.rowCount) await this.lockDecks(t);
    });
  }

  /** A player's deck from their tournament pool, while the build is on. */
  saveDeck(userId: string, id: string, raw: unknown) {
    return this.serial(async () => {
      const t = await this.get(id);
      if (t.status !== 'building') throw new Refused('Decks can only change while building');
      const r = await this.db.query('SELECT * FROM limited_pools WHERE tournament_id = $1 AND user_id = $2', [t.id, userId]);
      if (!r.rowCount) throw new Refused('You have no pool here', 404);
      const deck = cleanDeck(raw);
      const issues = limitedIssues(deck, r.rows[0].cards, r.rows[0].format);
      if (issues.length) throw new Refused(issues[0].message);
      await this.db.query('UPDATE limited_pools SET deck = $3 WHERE tournament_id = $1 AND user_id = $2', [t.id, userId, JSON.stringify(deck)]);
      return this.poolOf(userId, id);
    });
  }

  /** What a player sees of their pool: the draft at their seat, or the pool and their deck. */
  async poolOf(userId: string, id: string): Promise<PoolView & { status: string; buildUntil: number | null }> {
    const t = await this.get(id);
    const r = await this.db.query('SELECT * FROM limited_pools WHERE tournament_id = $1 AND user_id = $2', [t.id, userId]);
    if (!r.rowCount) throw new Refused('You have no pool here', 404);
    const pod = t.draft?.pods.find((p) => p.seats.includes(userId));
    const row = pod ? { ...r.rows[0], draft: pod.draft } : r.rows[0];
    const view = viewOf(row, pod ? pod.seats.indexOf(userId) : 0, pod?.deadline);
    return { ...view, status: t.status, buildUntil: t.build_until ? new Date(t.build_until).getTime() : null };
  }

  private async players(id: string) {
    return (await this.db.query('SELECT user_id, name, deck, dropped FROM tournament_players WHERE tournament_id = $1', [id])).rows as
      { user_id: string; name: string; deck: DeckList; dropped: boolean }[];
  }

  private async swissResults(id: string): Promise<MatchResult[]> {
    const r = await this.db.query("SELECT round, a, b, wins FROM tournament_matches WHERE tournament_id = $1 AND stage = 'swiss' AND status = 'done'", [id]);
    return r.rows.map((m) => ({ round: m.round, a: m.a, b: m.b, wins: m.wins as number[] }));
  }

  async standings(id: string): Promise<Standing[]> {
    const ps = await this.players(id);
    return standings(ps.map((p) => p.user_id), await this.swissResults(id));
  }

  private async nextRound(t: Row) {
    // the cards must still be theirs: a deck sold or graded away since sign-up drops its player (a Limited deck is the pool's)
    const own = t.settings.format === 'constructed' ? await this.db.query('SELECT user_id, deck_ref FROM tournament_players WHERE tournament_id = $1 AND NOT dropped', [t.id]).then((r) => r.rows) : [];
    for (const p of own) {
      const ok = await this.online.deckFor(p.user_id, p.deck_ref).then(() => true, () => false);
      if (!ok) await this.db.query('UPDATE tournament_players SET dropped = true WHERE tournament_id = $1 AND user_id = $2', [t.id, p.user_id]);
    }
    const ps = await this.players(t.id);
    const active = ps.filter((p) => !p.dropped).map((p) => p.user_id);
    const swissTotal = t.settings.rounds ?? swissRounds(ps.length);
    let pairs: { a: string; b: string | null }[];
    let stage: 'swiss' | 'top' = t.stage;
    if (t.stage === 'swiss' && t.round < swissTotal && active.length >= 2) {
      pairs = pairRound(active, await this.swissResults(t.id), () => randomInt(0, 2 ** 32) / 2 ** 32);
    } else {
      // the top cut: first its seeds from the standings, then the winners of the last round
      const cut = t.settings.topCut;
      if (t.stage === 'swiss') {
        const st = (await this.standings(t.id)).filter((s) => active.includes(s.player));
        if (cut === 0 || st.length < cut) { await this.finish(t); return; }
        stage = 'top';
        pairs = topCutPairs(st.slice(0, cut).map((s) => s.player)).map(([a, b]) => ({ a, b }));
      } else {
        const last = (await this.db.query("SELECT a, b, wins FROM tournament_matches WHERE tournament_id = $1 AND stage = 'top' AND round = $2 ORDER BY tbl", [t.id, t.round])).rows;
        if (last.length <= 1) { await this.finish(t); return; }
        const winners = last.map((m) => (m.wins[1] > m.wins[0] ? m.b : m.a) as string);
        pairs = [];
        for (let i = 0; i < winners.length; i += 2) pairs.push({ a: winners[i], b: winners[i + 1] });
      }
    }
    const round = t.round + 1;
    await this.db.query('UPDATE tournaments SET round = $2, stage = $3 WHERE id = $1', [t.id, round, stage]);
    const t2 = await this.get(t.id);
    for (const [i, p] of pairs.entries()) {
      const r = await this.db.query(`INSERT INTO tournament_matches (tournament_id, round, stage, tbl, a, b, wins, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [t.id, round, stage, i + 1, p.a, p.b, p.b === null ? [2, 0] : [0, 0], p.b === null ? 'done' : 'playing']);
      if (p.b !== null) await this.playGame(t2, r.rows[0]);
    }
    await this.roundDone(t2);
  }

  /** The next game of a match. Who plays first (TR 407): in the first game a random
      designated player chooses, in a playoff the higher seed (a) does (407.2.a); after
      that the loser of the last game chooses, and a draw keeps the order (407.4). */
  private async playGame(t: Row, m: MatchRow, firstPlayer: GameSetup['firstPlayer'] | null = null) {
    if (firstPlayer === null && m.games === 0 && m.stage === 'top') firstPlayer = { designee: 0 };
    const ps = await this.players(t.id);
    const pa = ps.find((p) => p.user_id === m.a)!, pb = ps.find((p) => p.user_id === m.b)!;
    const cutLeft = m.stage === 'top' ? 2 * (await this.db.query("SELECT count(*)::int AS n FROM tournament_matches WHERE tournament_id = $1 AND stage = 'top' AND round = $2", [t.id, m.round])).rows[0].n : 0;
    const limited = t.settings.format === 'constructed' ? undefined : t.settings.format;
    const gameId = await this.online.startPaired(
      { userId: pa.user_id, name: pa.name, deck: pa.deck, limited }, { userId: pb.user_id, name: pb.name, deck: pb.deck, limited },
      { id: t.id, name: t.name, round: roundName(m.stage, m.round, cutLeft), game: m.games + 1, score: m.wins, match: m.id },
      firstPlayer, t.settings.noShowMinutes * 60_000,
    );
    await this.db.query('UPDATE tournament_matches SET game_id = $2 WHERE id = $1', [m.id, gameId]);
  }

  private async gameOver(f: Finished) {
    const m = (await this.db.query('SELECT * FROM tournament_matches WHERE id = $1', [f.meta!.match])).rows[0] as MatchRow | undefined;
    if (!m || m.status !== 'playing' || m.game_id !== f.gameId) return;
    const t = await this.get(f.meta!.id);
    if (t.status !== 'running') return;
    const wins: number[] = [m.wins[0], m.wins[1]];
    if (f.winner !== null) wins[f.winner]++;
    const games = m.games + 1;
    const need = Math.ceil(t.settings.bestOf / 2);
    // a player who never came loses the match and is dropped (TR 703.8.d, 414.4)
    if (f.noShow !== null) {
      wins[f.noShow] = 0;
      wins[1 - f.noShow] = need;
      await this.db.query('UPDATE tournament_players SET dropped = true WHERE tournament_id = $1 AND user_id = $2', [t.id, f.players[f.noShow]]);
    }
    const over = f.noShow !== null || wins[0] >= need || wins[1] >= need || games >= t.settings.bestOf + 2;
    // a top-cut match can't end level: the higher seed (a) goes on
    if (over && m.stage === 'top' && wins[0] === wins[1]) wins[0]++;
    await this.db.query('UPDATE tournament_matches SET wins = $2, games = $3, status = $4 WHERE id = $1', [m.id, wins, games, over ? 'done' : 'playing']);
    if (!over) {
      const next: GameSetup['firstPlayer'] = f.winner === null ? (f.first ?? 'random-designee-chooses') : { designee: (1 - f.winner) as 0 | 1 };
      await this.playGame(t, { ...m, wins, games }, next);
      return;
    }
    await this.roundDone(t);
  }

  private async roundDone(t: Row) {
    const open = (await this.db.query("SELECT count(*)::int AS n FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND status <> 'done'", [t.id, t.round])).rows[0].n;
    if (open === 0) await this.nextRound(await this.get(t.id));
  }

  private async finish(t: Row) {
    const st = await this.standings(t.id);
    let order = st.map((s) => s.player);
    if (t.stage === 'top') {
      // the cut by how far each got, the rest by the Swiss standings
      const top = (await this.db.query("SELECT round, a, b, wins FROM tournament_matches WHERE tournament_id = $1 AND stage = 'top' ORDER BY round DESC, tbl", [t.id])).rows;
      const placed: string[] = [];
      for (const m of top) {
        const [w, l] = m.wins[1] > m.wins[0] ? [m.b, m.a] : [m.a, m.b];
        if (placed.length === 0) placed.push(w);
        placed.push(l);
      }
      order = [...placed, ...order.filter((p) => !placed.includes(p))];
    }
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      // the winners' accounts locked in one fixed order first, as every transfer does (no deadlocks)
      for (const u of order.filter((_, i) => t.settings.prizes[i]).sort()) {
        await c.query('INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
        await c.query('SELECT 1 FROM accounts WHERE user_id = $1 FOR UPDATE', [u]);
      }
      for (const [i, userId] of order.entries()) {
        await c.query('UPDATE tournament_players SET final_rank = $3 WHERE tournament_id = $1 AND user_id = $2', [t.id, userId, i + 1]);
        const prize = t.settings.prizes[i];
        if (!prize || (prize.coins === 0 && !prize.packs)) continue;
        await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [userId, prize.coins]);
        for (const [set, n] of Object.entries(prize.packs ?? {})) {
          await c.query(`INSERT INTO owned_packs (user_id, set_id, n) VALUES ($1, $2, $3)
            ON CONFLICT (user_id, set_id) DO UPDATE SET n = owned_packs.n + EXCLUDED.n`, [userId, set, n]);
        }
        await c.query('INSERT INTO ledger (user_id, coins, packs, reason) VALUES ($1, $2, $3, $4)',
          [userId, prize.coins, prize.packs ? JSON.stringify(prize.packs) : null, `tournament prize #${i + 1} ${t.id}`]);
      }
      await c.query("UPDATE tournaments SET status = 'done', ended_at = now() WHERE id = $1", [t.id]);
      await c.query('COMMIT');
    } catch (err) { await c.query('ROLLBACK').catch(() => undefined); throw err; } finally { c.release(); }
    for (const [i, userId] of order.entries()) if (t.settings.prizes[i]) this.online.notify(userId, 'prize');
  }

  // ---- money back ----

  private async refund(c: { query: Db['query'] }, userId: string, t: Row, why: string) {
    await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [userId, t.settings.entryFee]);
    await c.query('INSERT INTO ledger (user_id, coins, reason) VALUES ($1, $2, $3)', [userId, t.settings.entryFee, `tournament refund (${why}) ${t.id}`]);
  }

  private async refundAll(t: Row, why: string) {
    if (t.settings.entryFee <= 0) return;
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const ps = await c.query('SELECT user_id FROM tournament_players WHERE tournament_id = $1', [t.id]);
      for (const p of ps.rows) await this.refund(c, p.user_id, t, why);
      await c.query('COMMIT');
    } catch (err) { await c.query('ROLLBACK').catch(() => undefined); throw err; } finally { c.release(); }
  }

  // ---- reading ----

  private async get(id: string): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new Refused('No such tournament', 404);
    const r = await this.db.query('SELECT * FROM tournaments WHERE id = $1', [id]);
    if (!r.rowCount) throw new Refused('No such tournament', 404);
    return r.rows[0] as Row;
  }

  async list(userId: string) {
    const r = await this.db.query(`SELECT t.id, t.name, t.status, t.settings, t.starts_at, t.round, t.stage,
        (SELECT count(*)::int FROM tournament_players p WHERE p.tournament_id = t.id) AS players,
        EXISTS (SELECT 1 FROM tournament_players p WHERE p.tournament_id = t.id AND p.user_id = $1) AS joined
      FROM tournaments t WHERE t.status IN ('open', 'running') OR t.ended_at > now() - interval '14 days'
      ORDER BY (t.status = 'running') DESC, (t.status = 'open') DESC, t.starts_at DESC LIMIT 50`, [userId]);
    return r.rows.map((t) => ({ id: t.id, name: t.name, status: t.status, settings: t.settings, startsAt: new Date(t.starts_at).getTime(),
      round: t.round, stage: t.stage, players: t.players, joined: t.joined }));
  }

  async detail(id: string, userId: string) {
    const t = await this.get(id);
    const ps = await this.db.query('SELECT user_id, name, dropped, final_rank, deck_ref FROM tournament_players WHERE tournament_id = $1 ORDER BY joined_at', [id]);
    const ms = await this.db.query('SELECT id, round, stage, tbl, a, b, wins, games, status FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, tbl', [id]);
    const names = Object.fromEntries(ps.rows.map((p) => [p.user_id, p.name]));
    const st = await this.standings(id);
    // other players are shown by name: their ids stay on the server
    const who = (u: string | null) => (u === null ? null : { name: names[u] ?? '?', me: u === userId });
    return {
      id: t.id, name: t.name, status: t.status, settings: t.settings, startsAt: new Date(t.starts_at).getTime(), round: t.round, stage: t.stage,
      joined: ps.rows.some((p) => p.user_id === userId),
      players: ps.rows.map((p) => ({ ...who(p.user_id)!, dropped: p.dropped, rank: p.final_rank })),
      standings: st.map((s) => ({ ...who(s.player)!, rank: s.rank, points: s.points, record: `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}`,
        omw: Math.round(s.omw * 1000) / 10, gw: Math.round(s.gw * 1000) / 10, ogw: Math.round(s.ogw * 1000) / 10 })),
      matches: ms.rows.map((m) => ({ round: m.round, stage: m.stage, table: m.tbl, a: who(m.a), b: who(m.b), wins: m.wins, games: m.games, status: m.status })),
    };
  }
}
