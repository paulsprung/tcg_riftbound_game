import { randomInt, randomUUID } from 'node:crypto';
import { FIRST_WIN_COINS, LOSS_COINS, MIN_REWARD_TURNS, WIN_COINS } from '../../src/economy/rules.ts';
import { missingCards, ownedDefs, ownPrintings } from '../../src/decks/ownership.ts';
import { STARTERS, validateDeck, type DeckList, type GameRecord, type PlayerId, type PlayerView } from '../../src/game/index.ts';
import type { Db } from '../db.ts';
import { readAccount } from '../economy.ts';
import type { LimitedService } from '../limited.ts';
import { ladderPoints, PLACEMENT_GAMES, rate, START, tierOf, type Rating } from '../rating.ts';
import type { ClientMsg, LobbyMode, LobbyView, Mode, Presence, QueueMode, RatingInfo, ServerMsg } from '../../src/net/protocol.ts';
import type { Answer, Update } from './engine.ts';
import type { EnginePool } from './pool.ts';

/*
 * Online play: the queues, matchmaking, the games in progress and their end.
 *
 * A game lives in an engine thread (pool.ts); this side only routes. Each
 * player gets their own view after every change, never the other's. Each
 * player has a chess clock: every decision gets a free grace time, and what
 * it takes beyond that comes off the player's time bank for the game. When
 * both are used up the server answers for the player (pass, done, no, or
 * the first option) and counts a strike; the third strike concedes. A
 * player whose last connection drops has three minutes to come back. A
 * pass-only priority is passed for the player at once.
 *
 * The record so far (setup and every answer) is written to live_games every
 * few seconds, so a restart replays the games and carries on. At the end the
 * match goes to `matches` with its record, ratings move (Glicko-2, per
 * mode) and both players get coins, the day's first win a bonus on top.
 */

const MODES: QueueMode[] = ['ranked', 'casual', 'sealed', 'draft'];

/** Free time for every decision; then the player's time bank runs. */
export const GRACE_MS = 30_000;
export const BANK_MS = 15 * 60_000;
export const RECONNECT_MS = 180_000;
const STRIKES = 3;
const AUTO_PASS_MS = 300;
const FLUSH_MS = 3_000;
/** The rating window a queue opens with, and how much it widens each second of waiting. */
const WINDOW = 100, WIDEN = 10;

export type { ClientMsg, Mode, QueueMode, RatingInfo, ServerMsg };

/** A tournament game: whose match it is, for the director (tournament/director.ts). */
export type GameMeta = NonNullable<Extract<ServerMsg, { t: 'start' }>['tournament']> & { match: string };

/** How a game ended, for whoever ran it. */
export interface Finished {
  gameId: string; mode: Mode; players: [string, string]; winner: PlayerId | null; reason: string; meta: GameMeta | null;
  /** Who played first: the next game of a drawn match keeps it (TR 407.4). */
  first: PlayerId | null;
  /** The seat that never came (it lost by the no-show time): a match loss (TR 703.8.d). */
  noShow: PlayerId | null;
}

export interface Transport { send(userId: string, msg: ServerMsg): void; online(userId: string): boolean }

interface Queued { userId: string; name: string; deck: DeckList; rating: number; since: number; limited?: 'sealed' | 'draft' }

interface Live {
  id: string; mode: Mode; players: [string, string]; names: [string, string]; decks: [DeckList, DeckList];
  started: number; answers: Answer[]; setup: GameRecord['setup'];
  pending: Update['pending']; deadline: number | null; lastView: [PlayerView, PlayerView] | null;
  /** Each player's time bank left, and when the decision on the clock was asked (and of whom). */
  bank: [number, number]; asked: { seat: PlayerId; at: number } | null;
  strikes: [number, number]; timer: ReturnType<typeof setTimeout> | null; away: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null];
  dirty: boolean; over: boolean; turn: number; busy: Promise<void>;
  /** The engine and card set the game runs on: a record replays only on the same. */
  head: { engine: string; defsHash: string };
  meta: GameMeta | null;
  first: PlayerId | null;
  /** A tournament seat that hasn't connected since the game began; set when its no-show time ran out. */
  noShow: PlayerId | null;
  showed: [boolean, boolean];
}

type LobbyMsg = Extract<ClientMsg, { t: `lobby-${string}` }>;
const isLobbyMsg = (m: ClientMsg): m is LobbyMsg => m.t.startsWith('lobby-');

interface Lobby {
  id: string; mode: LobbyMode; host: string; inGame: boolean;
  members: { id: string; name: string; ready: boolean; deck: { ref: string; list: DeckList } | null }[];
  invites: Map<string, { id: string; name: string; timer: ReturnType<typeof setTimeout> }>;
}

export const infoOf = (x: Rating, games: number): RatingInfo => {
  const points = ladderPoints(x);
  const t = tierOf(points);
  return { points, tier: t.tier, division: t.division, games, placement: games < PLACEMENT_GAMES };
};

/** What the server answers when a player's time runs out: the safest option there is. */
export function timeoutAnswer(v: PlayerView): string {
  const real = (v.pending?.options ?? []).filter((o) => !o.ui).map((o) => o.key);
  return ['pass', 'done', 'no', 'keep'].find((k) => real.includes(k)) ?? real[0];
}

export class Online {
  private readonly queues = new Map<QueueMode, Queued[]>(MODES.map((m) => [m, []]));
  private readonly finishHooks = new Set<(f: Finished) => void | Promise<void>>();
  private readonly hellos = new Map<string, number>();
  private readonly presenceHooks = new Set<(userId: string) => void>();
  /** Lobbies by id, and which one each player is in. */
  private readonly lobbies = new Map<string, Lobby>();
  private readonly lobbyOf = new Map<string, string>();
  /** Checks that two players are friends (server/friends.ts); everyone, in tests. */
  areFriends: (a: string, b: string) => Promise<boolean> = async () => true;
  /** Limited pools (server/limited.ts), for the sealed and draft queues. */
  limited: LimitedService | null = null;
  /** Players whose queue request is being checked: a second one waits its turn. */
  private readonly joining = new Set<string>();
  private readonly games = new Map<string, Live>();
  private readonly byUser = new Map<string, string>();
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly flusher: ReturnType<typeof setInterval>;

  private readonly t: { grace: number; bank: number; reconnect: number; autoPass: number };

  constructor(private readonly db: Db, private readonly pool: EnginePool, private readonly net: Transport,
    private readonly clock: { now(): number } = Date, times: Partial<{ grace: number; bank: number; reconnect: number; autoPass: number }> = {}) {
    this.t = { grace: GRACE_MS, bank: BANK_MS, reconnect: RECONNECT_MS, autoPass: AUTO_PASS_MS, ...times };
    this.ticker = setInterval(() => { void this.matchmake(); }, 1000);
    this.flusher = setInterval(() => { void this.flush(); }, FLUSH_MS);
    this.ticker.unref?.(); this.flusher.unref?.();
  }

  stop() { clearInterval(this.ticker); clearInterval(this.flusher); for (const g of this.games.values()) this.clearTimers(g); }

  /** What friends see: offline, online, looking for a match, in a game. */
  presence(userId: string): Presence {
    if (!this.net.online(userId)) return 'offline';
    if (this.byUser.has(userId)) return 'game';
    for (const q of this.queues.values()) if (q.some((x) => x.userId === userId)) return 'queue';
    return 'online';
  }
  /** Called when a player's presence may have changed (friends are told). */
  onPresence(h: (userId: string) => void) { this.presenceHooks.add(h); }
  private changed(...userIds: string[]) { for (const u of userIds) for (const h of this.presenceHooks) h(u); }

  /** Called after every game's end (tournaments hang their matches on it). */
  onFinish(h: (f: Finished) => void | Promise<void>) { this.finishHooks.add(h); }
  isLive(gameId: string) { return this.games.has(gameId); }
  /** Tells a player their account changed (a sale, a gift, a prize), if they are connected. */
  notify(userId: string, why: string) { this.net.send(userId, why === 'friends' ? { t: 'friends' } : { t: 'account', why }); }
  inGame(userId: string) { return this.byUser.has(userId); }
  /** A deleted account: out of every queue. */
  forget(userId: string) { for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); } }

  get stats() { return { games: this.games.size, queued: [...this.queues.values()].reduce((n, q) => n + q.length, 0) }; }

  // ---- connections ----

  /** A player's socket opened (or another tab): tell them where they are; a game they left waits for them. */
  async connected(userId: string) {
    const gameId = this.byUser.get(userId);
    const queued = MODES.flatMap((m) => this.queues.get(m)!.filter((q) => q.userId === userId).map((q) => ({ mode: m, since: q.since })))[0] ?? null;
    this.net.send(userId, { t: 'state', queue: queued, game: gameId ?? null });
    this.sendLobby(userId);
    this.changed(userId);
    if (!gameId) return;
    const g = this.games.get(gameId)!;
    const seat = g.players.indexOf(userId) as PlayerId;
    g.showed[seat] = true;
    const t = g.away[seat];
    if (t) { clearTimeout(t); g.away[seat] = null; }
    await this.sendStart(g, seat, true);
  }

  /** Their last socket closed: out of the queue; in a game, three minutes to come back. */
  disconnected(userId: string) {
    for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); }
    this.changed(userId);
    // gone from the site: out of their lobby (as in the League client), their invites lapse
    if (!this.net.online(userId)) this.leaveLobby(userId);
    const gameId = this.byUser.get(userId);
    const g = gameId ? this.games.get(gameId) : undefined;
    if (!g || g.over) return;
    const seat = g.players.indexOf(userId) as PlayerId;
    g.away[seat] = setTimeout(() => { if (!this.net.online(userId)) void this.concede(g, seat); }, this.t.reconnect);
    g.away[seat].unref?.();
  }

  async message(userId: string, name: string, m: ClientMsg) {
    try {
      if (m.t === 'hello') {
        // a reconnect replays the game for its log: once every few seconds is plenty
        const last = this.hellos.get(userId) ?? 0;
        if (this.clock.now() - last < 3000) return;
        this.hellos.set(userId, this.clock.now());
        if (this.hellos.size > 50_000) this.hellos.clear();
        return await this.connected(userId);
      }
      if (m.t === 'queue') return await this.enqueue(userId, name, m.mode, m.deck);
      if (m.t === 'leave') {
        for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); }
        this.changed(userId);
        return this.net.send(userId, { t: 'left' });
      }
      if (isLobbyMsg(m)) return await this.lobbyMessage(userId, name, m);
      const g = this.games.get(m.gameId);
      if (!g || !g.players.includes(userId)) throw new Error('No such game');
      const seat = g.players.indexOf(userId) as PlayerId;
      if (m.t === 'concede') return await this.concede(g, seat);
      if (m.t === 'choose') {
        if (!Array.isArray(m.keys)) throw new Error('No keys');
        return await this.answer(g, seat, m.keys.map(String), false);
      }
    } catch (err) {
      // our own refusals keep their words; anything else (the database, a bug) is logged, not shown
      const own = err instanceof Error && !('code' in err) && err.message.length < 200;
      if (!own) console.error('online:', err);
      this.net.send(userId, { t: 'error', message: own ? (err as Error).message : 'Something went wrong' });
    }
  }

  // ---- the queue ----

  /** A deck the player may bring: their starter, or a deck they built, legal and made of cards they own. */
  async deckFor(userId: string, ref: string): Promise<DeckList> {
    const account = await readAccount(this.db, userId);
    let deck: DeckList | undefined;
    if (ref.startsWith('my:')) {
      const id = ref.slice(3);
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('No such deck');
      const r = await this.db.query('SELECT body FROM decks WHERE id = $1 AND user_id = $2', [id, userId]);
      deck = r.rows[0]?.body as DeckList | undefined;
    } else if (ref === account.starter) {
      deck = STARTERS.find((s) => s.id === ref)?.deck;
    }
    if (!deck) throw new Error('No such deck');
    const errors = validateDeck(deck, 'sanctioned', { format: 'standard' }).filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(`This deck can't be played: ${errors[0].message}`);
    if (missingCards(deck, ownedDefs(account)).length) throw new Error('This deck has cards you don\'t own');
    return { ...deck, printings: ownPrintings(deck, account) };
  }

  private async rating(userId: string, mode: Mode): Promise<{ rating: Rating; games: number; wins: number }> {
    const r = await this.db.query('SELECT r, rd, vol, games, wins FROM ratings WHERE user_id = $1 AND mode = $2', [userId, mode]);
    const x = r.rows[0];
    return x ? { rating: { r: x.r, rd: x.rd, vol: x.vol }, games: x.games, wins: x.wins } : { rating: START, games: 0, wins: 0 };
  }

  private async enqueue(userId: string, name: string, mode: QueueMode, ref: string) {
    if (!MODES.includes(mode)) throw new Error('No such mode');
    if (this.byUser.has(userId)) throw new Error('You are in a game');
    if (this.joining.has(userId)) throw new Error('One moment');
    this.joining.add(userId);
    let entry: Queued;
    try {
      const rating = (await this.rating(userId, mode)).rating.r;
      if (mode === 'sealed' || mode === 'draft') {
        // a deck from the player's Limited pool of that format
        const id = String(ref).replace(/^limited:/, '');
        if (!this.limited) throw new Error('No such mode');
        const { deck, format } = await this.limited.deckFor(userId, id);
        if (format !== mode) throw new Error(`That pool is ${format}`);
        entry = { userId, name, deck, rating, since: this.clock.now(), limited: format };
      } else {
        entry = { userId, name, deck: await this.deckFor(userId, String(ref)), rating, since: this.clock.now() };
      }
    } finally { this.joining.delete(userId); }
    // matched meanwhile (another tab): stay out of the queue
    if (this.byUser.has(userId)) throw new Error('You are in a game');
    for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === userId); if (i >= 0) q.splice(i, 1); }
    const since = entry.since;
    this.queues.get(mode)!.push(entry);
    this.net.send(userId, { t: 'queued', mode, since });
    this.changed(userId);
    await this.matchmake();
  }

  /** Pairs the longest-waiting players whose ratings are close; the window widens while they wait. */
  async matchmake() {
    const now = this.clock.now();
    for (const mode of MODES) {
      const q = this.queues.get(mode)!;
      q.sort((a, b) => a.since - b.since);
      for (let i = 0; i < q.length; i++) {
        const a = q[i];
        const reach = (x: Queued) => WINDOW + WIDEN * ((now - x.since) / 1000);
        const j = q.findIndex((b, k) => k > i && b.userId !== a.userId && Math.abs(a.rating - b.rating) <= Math.min(reach(a), reach(b)));
        if (j < 0) continue;
        const b = q[j];
        q.splice(j, 1); q.splice(i, 1); i--;
        await this.start(mode, a, b).catch((err) => console.error('match start failed:', err));
      }
    }
  }

  // ---- a game ----

  private start(mode: Mode, a: Pick<Queued, 'userId' | 'name' | 'deck' | 'limited'>, b: Pick<Queued, 'userId' | 'name' | 'deck' | 'limited'>) {
    // who sits first is random; who plays first the engine settles (TR 407)
    return randomInt(2) === 0 ? this.begin(mode, a, b, null) : this.begin(mode, b, a, null);
  }

  /** A game between two given players (a tournament's): a in seat 0. `firstPlayer` fixes who plays first
      (the loser of the match's last game); a player not connected has `noShowMs` to come. */
  async startPaired(a: Pick<Queued, 'userId' | 'name' | 'deck' | 'limited'>, b: Pick<Queued, 'userId' | 'name' | 'deck' | 'limited'>, meta: GameMeta,
    firstPlayer: GameRecord['setup']['firstPlayer'] | null, noShowMs: number): Promise<string> {
    for (const u of [a.userId, b.userId]) for (const q of this.queues.values()) { const i = q.findIndex((x) => x.userId === u); if (i >= 0) q.splice(i, 1); }
    const id = await this.begin('tournament', a, b, meta, firstPlayer);
    const g = this.games.get(id);
    if (g) {
      for (const seat of [0, 1] as const) {
        if (this.net.online(g.players[seat])) { g.showed[seat] = true; continue; }
        g.away[seat] = setTimeout(() => {
          if (this.net.online(g.players[seat])) return;
          if (!g.showed[seat]) g.noShow = seat;
          void this.concede(g, seat);
        }, noShowMs);
        g.away[seat].unref?.();
      }
    }
    return id;
  }

  private async begin(mode: Mode, p0: Pick<Queued, 'userId' | 'name' | 'deck' | 'limited'>, p1: Pick<Queued, 'userId' | 'name' | 'deck' | 'limited'>,
    meta: GameMeta | null, firstPlayer: GameRecord['setup']['firstPlayer'] | null = null): Promise<string> {
    const id = randomUUID();
    const limited = p0.limited ?? p1.limited;
    const setup: GameRecord['setup'] = { seed: randomInt(0, 2 ** 31), decks: [p0.deck, p1.deck] as [DeckList, DeckList],
      ...(firstPlayer !== null ? { firstPlayer } : {}), ...(limited ? { limited } : {}) };
    const g: Live = {
      id, mode, players: [p0.userId, p1.userId], names: [p0.name, p1.name], decks: setup.decks, started: this.clock.now(),
      answers: [], setup, pending: null, deadline: null, lastView: null, bank: [this.t.bank, this.t.bank], asked: null,
      strikes: [0, 0], timer: null, away: [null, null],
      dirty: true, over: false, turn: 0, busy: Promise.resolve(), head: { engine: '', defsHash: '' }, meta,
      first: null, noShow: null, showed: [false, false],
    };
    this.games.set(id, g);
    this.byUser.set(p0.userId, id); this.byUser.set(p1.userId, id);
    this.changed(p0.userId, p1.userId);
    const u = await this.pool.engine.create(id, setup);
    const rec = await this.pool.engine.record(id);
    g.head = { engine: rec.engine, defsHash: rec.defsHash };
    await this.db.query('INSERT INTO live_games (id, mode, players, data) VALUES ($1, $2, $3, $4)', [id, mode, g.players, this.liveData(g)]);
    for (const seat of [0, 1] as const) this.net.send(g.players[seat], this.startMsg(g, seat));
    await this.after(g, u, false);
    return id;
  }

  private startMsg(g: Live, seat: PlayerId): ServerMsg {
    const meta = g.meta ? { id: g.meta.id, name: g.meta.name, round: g.meta.round, game: g.meta.game, score: g.meta.score } : undefined;
    // decklists are private (TR 401.5): your own list, and of theirs only what the table shows anyway
    const theirs = g.decks[1 - seat];
    const shown: DeckList = { name: theirs.name, source: theirs.source, legend: theirs.legend, chosenChampion: '' as DeckList['chosenChampion'], main: [], runes: [], battlefields: [],
      printings: theirs.printings?.[theirs.legend] ? { [theirs.legend]: theirs.printings[theirs.legend] } : {} };
    const decks = (seat === 0 ? [g.decks[0], shown] : [shown, g.decks[1]]) as [DeckList, DeckList];
    return { t: 'start', gameId: g.id, seat, mode: g.mode, names: g.names, decks, ...(meta ? { tournament: meta } : {}) };
  }

  /** The start of a game again, for a player who comes back: their view and what they saw so far. */
  private async sendStart(g: Live, seat: PlayerId, full: boolean) {
    this.net.send(g.players[seat], this.startMsg(g, seat));
    const [cur, events] = await Promise.all([this.pool.engine.current(g.id), this.pool.engine.history(g.id, seat)]);
    this.net.send(g.players[seat], { t: 'update', gameId: g.id, view: cur.seats[seat].view, events, full, ...this.deadlines(g, seat) });
  }

  /** The clock as one seat sees it: when the decision times out, when its grace ends, both banks. */
  private deadlines(g: Live, seat: PlayerId) {
    const mine = g.pending && g.pending.player === seat && !g.pending.passOnly ? g.deadline : null;
    const theirs = g.pending && g.pending.player !== seat && !g.pending.passOnly ? g.deadline : null;
    const grace = g.asked ? g.asked.at + this.t.grace : null;
    return { deadline: mine, theirDeadline: theirs, clock: { grace, banks: [g.bank[seat], g.bank[1 - seat]] as [number, number] } };
  }

  /** One change at a time per game: answers that arrive together queue up. */
  private serial(g: Live, fn: () => Promise<void>) {
    g.busy = g.busy.then(fn, fn);
    return g.busy;
  }

  private answer(g: Live, seat: PlayerId, keys: string[], auto: boolean) {
    return this.serial(g, async () => {
      if (g.over) throw new Error('The game is over');
      if (!g.pending || g.pending.player !== seat) throw new Error('It is not your decision.');
      const u = await this.pool.engine.choose(g.id, seat, keys, auto);
      if (!auto) g.strikes[seat] = 0;
      await this.after(g, u, false);
    });
  }

  private concede(g: Live, seat: PlayerId) {
    return this.serial(g, async () => {
      if (g.over) return;
      const u = await this.pool.engine.concede(g.id, seat);
      await this.after(g, u, false);
    });
  }

  /** After every change: both views out, the clock for the next decision, the end. */
  private async after(g: Live, u: Update, full: boolean) {
    g.answers.push(...u.answers);
    g.dirty = g.dirty || u.answers.length > 0;
    g.pending = u.pending;
    g.turn = u.turn;
    g.first = u.first;
    g.lastView = [u.seats[0].view, u.seats[1].view];
    this.clearTimers(g, false);
    // the decision that was on the clock: what it took past its grace comes off the bank
    const now = this.clock.now();
    if (g.asked) {
      const { seat, at } = g.asked;
      g.bank[seat] = Math.max(0, g.bank[seat] - Math.max(0, now - at - this.t.grace));
      g.asked = null;
    }
    const timed = u.pending && !u.pending.passOnly ? u.pending.player : null;
    if (timed !== null) g.asked = { seat: timed, at: now };
    g.deadline = timed !== null ? now + this.t.grace + g.bank[timed] : null;
    for (const seat of [0, 1] as const) {
      this.net.send(g.players[seat], { t: 'update', gameId: g.id, view: u.seats[seat].view, events: u.seats[seat].events, full, ...this.deadlines(g, seat) });
    }
    if (u.result) { await this.finish(g, u); return; }
    const p = u.pending;
    if (!p) return;
    if (p.passOnly) {
      g.timer = setTimeout(() => { void this.answer(g, p.player, ['pass'], true).catch(() => undefined); }, this.t.autoPass);
    } else {
      g.timer = setTimeout(() => { void this.timeout(g, p.player, p.id); }, g.deadline! - now);
    }
    g.timer.unref?.();
  }

  private async timeout(g: Live, seat: PlayerId, decision: number) {
    if (g.over || g.pending?.id !== decision || !g.lastView) return;
    g.strikes[seat]++;
    if (g.strikes[seat] >= STRIKES) { await this.concede(g, seat); return; }
    await this.answer(g, seat, [timeoutAnswer(g.lastView[seat])], true).catch(() => undefined);
  }

  private clearTimers(g: Live, away = true) {
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
    if (away) for (const s of [0, 1] as const) { const t = g.away[s]; if (t) clearTimeout(t); g.away[s] = null; }
  }

  private liveData(g: Live) {
    return JSON.stringify({ ...g.head, setup: g.setup, answers: g.answers, names: g.names, started: g.started, strikes: g.strikes, bank: g.bank, meta: g.meta });
  }

  /** The records so far into live_games, for the games that changed. */
  async flush() {
    for (const g of this.games.values()) {
      if (!g.dirty || g.over) continue;
      g.dirty = false;
      await this.db.query('UPDATE live_games SET data = $2, updated_at = now() WHERE id = $1', [g.id, this.liveData(g)]).catch(() => { g.dirty = true; });
    }
  }

  /** After a restart: every game in live_games replayed and going again; the decision on the clock starts again, the banks as saved. */
  async recover() {
    const r = await this.db.query('SELECT id, mode, players, data FROM live_games');
    for (const row of r.rows) {
      const d = row.data as { engine: string; defsHash: string; setup: GameRecord['setup']; answers: Answer[]; names: [string, string]; started: number; strikes?: [number, number]; bank?: [number, number]; meta?: GameMeta | null };
      const g: Live = {
        id: row.id, mode: row.mode, players: row.players, names: d.names, decks: d.setup.decks as [DeckList, DeckList], started: d.started,
        answers: d.answers.slice(), setup: d.setup, pending: null, deadline: null, lastView: null,
        bank: d.bank ?? [this.t.bank, this.t.bank], asked: null, strikes: d.strikes ?? [0, 0], timer: null,
        away: [null, null], dirty: false, over: false, turn: 0, busy: Promise.resolve(), head: { engine: d.engine, defsHash: d.defsHash },
        meta: d.meta ?? null, first: null, noShow: null, showed: [true, true],
      };
      try {
        // an update of the engine or the cards in between: the record no longer replays, and the game is dropped
        const u = await this.pool.engine.resume(g.id, {
          engine: d.engine, defsHash: d.defsHash, setup: d.setup, answers: d.answers,
          meta: { started: '', difficulty: 'online', humanSeat: 'hotseat', aiKnowsList: false },
        } as GameRecord);
        this.games.set(g.id, g);
        for (const p of g.players) this.byUser.set(p, g.id);
        // the restart is nobody's fault: whoever is not back in time concedes
        for (const seat of [0, 1] as const) if (!this.net.online(g.players[seat])) this.disconnected(g.players[seat]);
        await this.after(g, { ...u, answers: [] }, true);
      } catch (err) {
        console.error(`live game ${g.id} could not be resumed, dropped:`, err instanceof Error ? err.message : err);
        await this.db.query('DELETE FROM live_games WHERE id = $1', [g.id]);
      }
    }
    return this.games.size;
  }

  // ---- lobbies (as in the League client) ----

  private lobbyView(l: Lobby): LobbyView {
    return {
      id: l.id, mode: l.mode, max: 2, inGame: l.inGame,
      members: l.members.map((m) => ({ id: m.id, name: m.name, host: m.id === l.host, ready: m.ready, deck: m.deck && { ref: m.deck.ref, name: m.deck.list.name, legend: m.deck.list.legend } })),
      invited: [...l.invites.values()].map((i) => ({ id: i.id, name: i.name })),
    };
  }

  private tellLobby(l: Lobby) {
    const v = this.lobbyView(l);
    for (const m of l.members) this.net.send(m.id, { t: 'lobby', lobby: v });
  }

  /** The player's lobby now (on connect, a reload). */
  sendLobby(userId: string) {
    const l = this.lobbies.get(this.lobbyOf.get(userId) ?? '');
    this.net.send(userId, { t: 'lobby', lobby: l ? this.lobbyView(l) : null });
  }

  private leaveLobby(userId: string) {
    const l = this.lobbies.get(this.lobbyOf.get(userId) ?? '');
    if (!l) return;
    this.lobbyOf.delete(userId);
    l.members = l.members.filter((m) => m.id !== userId);
    this.net.send(userId, { t: 'lobby', lobby: null });
    if (l.members.length === 0) {
      for (const i of l.invites.values()) { clearTimeout(i.timer); this.net.send(i.id, { t: 'lobby-invite-gone', lobby: l.id, why: 'the lobby closed' }); }
      this.lobbies.delete(l.id);
      return;
    }
    // the host gone: the longest-standing member leads
    if (l.host === userId) l.host = l.members[0].id;
    this.tellLobby(l);
  }

  private async lobbyMessage(userId: string, name: string, m: LobbyMsg) {
    const mine = this.lobbies.get(this.lobbyOf.get(userId) ?? '');
    const member = mine?.members.find((x) => x.id === userId);
    switch (m.t) {
      case 'lobby-invite': {
        const to = String(m.to);
        if (to === userId || !/^[0-9a-f-]{36}$/.test(to)) throw new Error('No such friend');
        if (m.mode !== 'custom' && m.mode !== 'casual') throw new Error('Invites are for the custom game or casual');
        if (!(await this.areFriends(userId, to))) throw new Error('Only friends can be invited');
        if (this.presence(to) === 'offline') throw new Error('Your friend is offline');
        if (this.byUser.has(userId)) throw new Error('You are in a game');
        // your lobby, or a new one with you as host
        let l = mine;
        if (!l) {
          l = { id: randomUUID(), mode: m.mode, host: userId, members: [{ id: userId, name, ready: false, deck: null }], invites: new Map(), inGame: false };
          this.lobbies.set(l.id, l);
          this.lobbyOf.set(userId, l.id);
        }
        if (l.host !== userId) throw new Error('Only the host invites');
        if (l.members.some((x) => x.id === to)) throw new Error('Already in your lobby');
        if (l.members.length + l.invites.size >= 2) throw new Error('The lobby is full');
        const lobby = l;
        const timer = setTimeout(() => {
          lobby.invites.delete(to);
          this.net.send(to, { t: 'lobby-invite-gone', lobby: lobby.id, why: 'no answer' });
          this.tellLobby(lobby);
        }, 60_000);
        timer.unref?.();
        clearTimeout(l.invites.get(to)?.timer);
        const toName = (await this.db.query('SELECT name FROM users WHERE id = $1', [to])).rows[0]?.name ?? 'Friend';
        l.invites.set(to, { id: to, name: toName, timer });
        this.net.send(to, { t: 'lobby-invite', lobby: l.id, mode: l.mode, from: { id: userId, name } });
        this.tellLobby(l);
        return;
      }
      case 'lobby-answer': {
        const l = this.lobbies.get(String(m.lobby));
        const inv = l?.invites.get(userId);
        if (!l || !inv) throw new Error('That invite is gone');
        clearTimeout(inv.timer);
        l.invites.delete(userId);
        if (!m.accept) { this.tellLobby(l); return; }
        if (this.byUser.has(userId)) throw new Error('You are in a game');
        if (l.members.length >= 2) throw new Error('The lobby is full');
        this.leaveLobby(userId);
        this.forget(userId);
        l.members.push({ id: userId, name, ready: false, deck: null });
        this.lobbyOf.set(userId, l.id);
        this.tellLobby(l);
        return;
      }
      case 'lobby-leave': this.leaveLobby(userId); return;
    }
    if (!mine || !member) throw new Error('You are in no lobby');
    switch (m.t) {
      case 'lobby-deck': {
        if (member.ready) throw new Error('Not ready first, then change your deck');
        const ref = String(m.deck);
        member.deck = { ref, list: await this.deckFor(userId, ref) };
        this.tellLobby(mine);
        return;
      }
      case 'lobby-ready': {
        if (mine.host === userId) throw new Error('The host starts the game');
        if (m.ready && !member.deck) throw new Error('Pick a deck first');
        member.ready = !!m.ready;
        this.tellLobby(mine);
        return;
      }
      case 'lobby-kick': {
        if (mine.host !== userId) throw new Error('Only the host');
        const who = String(m.who);
        if (who === userId || !mine.members.some((x) => x.id === who)) return;
        this.leaveLobby(who);
        return;
      }
      case 'lobby-start': {
        if (mine.host !== userId) throw new Error('Only the host starts');
        if (mine.mode === 'casual') throw new Error('Casual 2v2 comes with the 2v2 rules');
        if (mine.members.length < 2) throw new Error('Invite a friend first');
        if (!member.deck) throw new Error('Pick a deck first');
        if (mine.members.some((x) => x.id !== mine.host && !x.ready)) throw new Error('Not everyone is ready');
        if (mine.members.some((x) => this.byUser.has(x.id) || !this.net.online(x.id))) throw new Error('Someone is busy');
        // the decks again, in case a card was sold in between
        const [a, b] = mine.members;
        const [da, db] = await Promise.all([this.deckFor(a.id, a.deck!.ref), this.deckFor(b.id, b.deck!.ref)]);
        for (const x of mine.members) this.forget(x.id);
        mine.inGame = true;
        this.tellLobby(mine);
        await this.start('friendly', { userId: a.id, name: a.name, deck: da }, { userId: b.id, name: b.name, deck: db });
        return;
      }
    }
  }

  /** After a friendly game the lobby is back, nobody ready (as in the League client). */
  private lobbyAfterGame(players: string[]) {
    const l = this.lobbies.get(this.lobbyOf.get(players[0]) ?? '');
    if (!l || !l.inGame) return;
    l.inGame = false;
    for (const m of l.members) m.ready = false;
    this.tellLobby(l);
  }

  // ---- the end ----

  private async finish(g: Live, u: Update) {
    if (g.over) return;
    g.over = true;
    this.clearTimers(g);
    const res = u.result!;
    const record = await this.pool.engine.record(g.id, u.conceded);
    const rewarded = res.turn >= MIN_REWARD_TURNS;
    const c = await this.db.connect();
    const outcome: { coins: [number, number]; bonus: [number, number]; rating: [{ before: RatingInfo; after: RatingInfo } | null, { before: RatingInfo; after: RatingInfo } | null] } = { coins: [0, 0], bonus: [0, 0], rating: [null, null] };
    try {
      await c.query('BEGIN');
      // both accounts first, then the ratings, each in one fixed order (as every transfer does):
      // games, sales and prizes that touch the same players at once can't deadlock
      for (const u of [...g.players].sort()) {
        await c.query('INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u]);
        await c.query('SELECT 1 FROM accounts WHERE user_id = $1 FOR UPDATE', [u]);
      }
      const rated = g.mode === 'ranked' || g.mode === 'casual' || g.mode === 'sealed' || g.mode === 'draft';
      const order = (rated ? [0, 1].sort((x, y) => (g.players[x] < g.players[y] ? -1 : 1)) : []) as PlayerId[];
      const before: Record<number, { rating: Rating; games: number; wins: number }> = {};
      for (const s of order) {
        await c.query('INSERT INTO ratings (user_id, mode) VALUES ($1, $2) ON CONFLICT DO NOTHING', [g.players[s], g.mode]);
        const x = (await c.query('SELECT r, rd, vol, games, wins FROM ratings WHERE user_id = $1 AND mode = $2 FOR UPDATE', [g.players[s], g.mode])).rows[0];
        before[s] = { rating: { r: x.r, rd: x.rd, vol: x.vol }, games: x.games, wins: x.wins };
      }
      // a tournament or friendly game moves no rating and pays no coins (a tournament's prizes do)
      for (const s of rated ? [0, 1] as const : []) {
        const score = res.winner === null ? 0.5 : res.winner === s ? 1 : 0;
        const me = before[s], opp = before[1 - s];
        const next = rate(me.rating, opp.rating, score as 0 | 0.5 | 1);
        await c.query('UPDATE ratings SET r = $3, rd = $4, vol = $5, games = games + 1, wins = wins + $6 WHERE user_id = $1 AND mode = $2',
          [g.players[s], g.mode, next.r, next.rd, next.vol, score === 1 ? 1 : 0]);
        if (g.mode === 'ranked') outcome.rating[s] = { before: infoOf(me.rating, me.games), after: infoOf(next, me.games + 1) };
        // coins for every game that went on long enough
        if (rewarded) {
          const coins = score === 1 ? WIN_COINS : LOSS_COINS;
          await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [g.players[s], coins]);
          await c.query('INSERT INTO ledger (user_id, coins, reason) VALUES ($1, $2, $3)', [g.players[s], coins, `match ${score === 1 ? 'win' : 'played'} ${g.id}`]);
          outcome.coins[s] = coins;
          // the first win of the day pays extra
          if (score === 1) {
            const won = (await c.query(`SELECT 1 FROM ledger WHERE user_id = $1 AND reason LIKE 'first win %'
              AND created_at > now() - interval '1 day' LIMIT 1`, [g.players[s]])).rowCount;
            if (!won) {
              await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [g.players[s], FIRST_WIN_COINS]);
              await c.query('INSERT INTO ledger (user_id, coins, reason) VALUES ($1, $2, $3)', [g.players[s], FIRST_WIN_COINS, `first win ${g.id}`]);
              outcome.bonus[s] = FIRST_WIN_COINS;
            }
          }
        }
      }
      await c.query(`INSERT INTO matches (id, mode, players, winner, reason, turns, started_at, record, outcome)
        VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9)`,
      [g.id, g.mode, g.players, res.winner, res.reason, res.turn, g.started, JSON.stringify(record), JSON.stringify(outcome)]);
      await c.query('DELETE FROM live_games WHERE id = $1', [g.id]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      console.error(`match ${g.id} could not be saved:`, err);
    } finally {
      c.release();
    }
    for (const s of [0, 1] as const) {
      this.net.send(g.players[s], { t: 'end', gameId: g.id, winner: res.winner, reason: res.reason, coins: outcome.coins[s], bonus: outcome.bonus[s], rating: outcome.rating[s] });
      if (this.byUser.get(g.players[s]) === g.id) this.byUser.delete(g.players[s]);
    }
    this.games.delete(g.id);
    this.changed(...g.players);
    if (g.mode === 'friendly') this.lobbyAfterGame(g.players);
    await this.pool.engine.drop(g.id);
    const done: Finished = { gameId: g.id, mode: g.mode, players: g.players, winner: res.winner, reason: res.reason, meta: g.meta,
      first: g.first, noShow: g.noShow };
    for (const h of this.finishHooks) await Promise.resolve(h(done)).catch((err) => console.error('after a game:', err));
  }

  /** A player's ranked standing, for the Play page. */
  async standing(userId: string, mode: QueueMode = 'ranked'): Promise<RatingInfo & { wins: number }> {
    const x = await this.rating(userId, mode);
    return { ...infoOf(x.rating, x.games), wins: x.wins };
  }
}
