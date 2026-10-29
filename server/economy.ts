import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import type { CollectionState, ShowcaseItem } from '../src/collection/store.ts';
import type { CardDb } from '../src/data/types.ts';
import { DAILY_COINS, DAY, MAX_BUY, PACK_PRICE, SHOWCASE_SIZE, STARTER_COINS, TUTORIAL_PACKS } from '../src/economy/rules.ts';
import { startersFrom, type StarterChoice } from '../src/economy/starter.ts';
import { findCard, STARTERS } from '../src/game/index.ts';
import { openPack, type Pull } from '../src/pack/generate.ts';
import { BOOSTER_SETS } from '../src/pack/packConfig.ts';
import { gradeCard, type Slab } from '../src/showcase/grading.ts';
import type { Db } from './db.ts';

/*
 * The account's economy, server side. The browser never says how many coins
 * or cards it has: it asks for a change (buy a pack, open one, grade a card)
 * and gets the new state back. Each change is one transaction that locks
 * the account row first, so two tabs (or a scripted burst of requests)
 * cannot spend the same coins twice. Coins and packs that come or go are
 * written to the ledger.
 *
 * Randomness for packs and grades comes from node:crypto.
 */

export class Refused extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** The card data the packs and starters are made from: the app's own cards.json. */
export interface Catalog {
  db: CardDb;
  byId: Map<string, CardDb['cards'][number]>;
  sets: Map<string, { cards: CardDb['cards']; pack: (typeof BOOSTER_SETS)[number]['pack'] }>;
  starters: Map<string, StarterChoice>;
}

export function catalogFrom(db: CardDb): Catalog {
  const sets = new Map(BOOSTER_SETS.map((b) => [b.id, { pack: b.pack, cards: db.cards.filter((c) => c.setId === b.id) }]));
  return {
    db, sets, byId: new Map(db.cards.map((c) => [c.id, c])),
    starters: new Map(startersFrom(db, { STARTERS, findCard }).map((s) => [s.id, s])),
  };
}

export async function loadCatalog(staticDir: string): Promise<Catalog> {
  return catalogFrom(JSON.parse(await readFile(join(staticDir, 'data', 'cards.json'), 'utf8')) as CardDb);
}

/** Math.random's shape, from the crypto source. */
export const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

export type Tx = pg.PoolClient;

/** Runs `fn` in a transaction with the user's account row created and locked. */
const withAccount = <T>(db: Db, userId: string, fn: (c: Tx) => Promise<T>) => withAccounts(db, [userId], fn);

/** The same for several accounts (a sale: buyer and seller), locked in a fixed order so two sales can't deadlock. */
export async function withAccounts<T>(db: Db, userIds: string[], fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    for (const userId of [...new Set(userIds)].sort()) {
      await c.query('INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
      await c.query('SELECT 1 FROM accounts WHERE user_id = $1 FOR UPDATE', [userId]);
    }
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

const ledger = (c: Tx, userId: string, coins: number, packs: Record<string, number> | null, reason: string, actor: string | null = null) =>
  c.query('INSERT INTO ledger (user_id, coins, packs, reason, actor) VALUES ($1, $2, $3, $4, $5)',
    [userId, coins, packs && JSON.stringify(packs), reason, actor]);

const addPacks = async (c: Tx, userId: string, packs: Record<string, number>) => {
  for (const [setId, n] of Object.entries(packs)) {
    await c.query(`INSERT INTO owned_packs (user_id, set_id, n) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, set_id) DO UPDATE SET n = owned_packs.n + EXCLUDED.n`, [userId, setId, n]);
  }
};

type Cards = Record<string, [number, number]>;

/** The raw copies, changed by `fn` and written back (the account row is locked). */
export async function editCards<T>(c: Tx, userId: string, fn: (cards: Cards) => T): Promise<T> {
  const r = await c.query('SELECT cards FROM accounts WHERE user_id = $1', [userId]);
  const cards = (r.rows[0]?.cards ?? {}) as Cards;
  const out = fn(cards);
  await c.query('UPDATE accounts SET cards = $2 WHERE user_id = $1', [userId, JSON.stringify(cards)]);
  return out;
}

export const addCards = (c: Tx, userId: string, add: { id: string; foil: boolean; n: number }[]) => editCards(c, userId, (cards) => {
  for (const x of add) {
    const o = cards[x.id] ?? [0, 0];
    o[x.foil ? 1 : 0] += x.n;
    cards[x.id] = o;
  }
});

/** The account as the app's collection store holds it. */
export async function readAccount(q: Db | Tx, userId: string): Promise<CollectionState> {
  // one after the other: a transaction's client runs one query at a time
  const acc = await q.query('SELECT coins, starter, daily_at, tutorial_done, showcase, cards FROM accounts WHERE user_id = $1', [userId]);
  const packs = await q.query('SELECT set_id, n, opened FROM owned_packs WHERE user_id = $1', [userId]);
  const slabs = await q.query('SELECT data FROM slabs WHERE user_id = $1 ORDER BY graded_at DESC', [userId]);
  const a = acc.rows[0];
  return {
    coins: a?.coins ?? 0,
    starter: a?.starter ?? null,
    dailyAt: a?.daily_at ? new Date(a.daily_at).getTime() : 0,
    tutorialDone: a?.tutorial_done ?? false,
    showcase: (a?.showcase ?? []) as ShowcaseItem[],
    cards: Object.fromEntries(Object.entries((a?.cards ?? {}) as Cards).filter(([, [n, f]]) => n + f > 0)
      .map(([id, [normal, foil]]) => [id, { normal, foil }])),
    packs: Object.fromEntries(packs.rows.filter((r) => r.n > 0).map((r) => [r.set_id, r.n])),
    packsOpened: Object.fromEntries(packs.rows.filter((r) => r.opened > 0).map((r) => [r.set_id, r.opened])),
    slabs: slabs.rows.map((r) => r.data as Slab),
  };
}

/** What a pull is on the wire: the card by id, the rest as the reveal needs it. */
export type WirePull = Pick<Pull, 'foil' | 'finish' | 'slot' | 'hype'> & { id: string };

export const economy = {
  async buyPack(db: Db, userId: string, setId: string, n: number) {
    if (!BOOSTER_SETS.some((b) => b.id === setId)) throw new Refused('No such pack');
    if (!Number.isInteger(n) || n < 1 || n > MAX_BUY) throw new Refused(`Buy 1 to ${MAX_BUY} packs`);
    return withAccount(db, userId, async (c) => {
      const cost = PACK_PRICE * n;
      const r = await c.query('UPDATE accounts SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2', [userId, cost]);
      if (r.rowCount !== 1) throw new Refused('Not enough coins');
      await addPacks(c, userId, { [setId]: n });
      await ledger(c, userId, -cost, { [setId]: n }, 'buy packs');
      return readAccount(c, userId);
    });
  },

  async openPack(db: Db, cat: Catalog, userId: string, setId: string, random = secureRandom) {
    const set = cat.sets.get(setId);
    if (!set) throw new Refused('No such pack');
    return withAccount(db, userId, async (c) => {
      const r = await c.query('UPDATE owned_packs SET n = n - 1, opened = opened + 1 WHERE user_id = $1 AND set_id = $2 AND n > 0', [userId, setId]);
      if (r.rowCount !== 1) throw new Refused('No such pack to open');
      const pulls = openPack(set.cards, set.pack, random);
      await addCards(c, userId, pulls.map((p) => ({ id: p.card.id, foil: p.foil, n: 1 })));
      await ledger(c, userId, 0, { [setId]: -1 }, 'open pack');
      const wire: WirePull[] = pulls.map((p) => ({ id: p.card.id, foil: p.foil, finish: p.finish, slot: p.slot, hype: p.hype }));
      return { pulls: wire, account: await readAccount(c, userId) };
    });
  },

  async claimDaily(db: Db, userId: string, now = Date.now()) {
    return withAccount(db, userId, async (c) => {
      const r = await c.query(`UPDATE accounts SET coins = coins + $2, daily_at = to_timestamp($3 / 1000.0)
        WHERE user_id = $1 AND (daily_at IS NULL OR daily_at <= to_timestamp($3 / 1000.0) - make_interval(secs => $4))`,
      [userId, DAILY_COINS, now, DAY / 1000]);
      if (r.rowCount !== 1) throw new Refused('Not yet: one claim a day');
      await ledger(c, userId, DAILY_COINS, null, 'daily coins');
      return readAccount(c, userId);
    });
  },

  async grantStarter(db: Db, cat: Catalog, userId: string, starterId: string) {
    const s = cat.starters.get(starterId);
    if (!s) throw new Refused('No such starter deck');
    return withAccount(db, userId, async (c) => {
      const r = await c.query('UPDATE accounts SET starter = $2, coins = coins + $3 WHERE user_id = $1 AND starter IS NULL', [userId, s.id, STARTER_COINS]);
      if (r.rowCount !== 1) throw new Refused('You already have a starter deck');
      await addCards(c, userId, Object.entries(s.cards).map(([id, n]) => ({ id, foil: false, n })));
      await addPacks(c, userId, { [s.booster]: 1 });
      await ledger(c, userId, STARTER_COINS, { [s.booster]: 1 }, `starter ${s.id}`);
      return readAccount(c, userId);
    });
  },

  async completeTutorial(db: Db, userId: string) {
    return withAccount(db, userId, async (c) => {
      const r = await c.query('UPDATE accounts SET tutorial_done = true WHERE user_id = $1 AND NOT tutorial_done', [userId]);
      const granted = r.rowCount === 1;
      if (granted) {
        const packs = Object.fromEntries(TUTORIAL_PACKS.map((id) => [id, 1]));
        await addPacks(c, userId, packs);
        await ledger(c, userId, 0, packs, 'tutorial');
      }
      return { granted, account: await readAccount(c, userId) };
    });
  },

  async grade(db: Db, userId: string, cardId: string, foil: boolean, random = secureRandom) {
    if (typeof cardId !== 'string' || typeof foil !== 'boolean') throw new Refused('Which card?');
    return withAccount(db, userId, async (c) => {
      const at = foil ? 1 : 0;
      const left = await editCards(c, userId, (cards) => {
        const o = cards[cardId];
        if (!o || o[at] < 1) throw new Refused('You have no raw copy of that card');
        o[at] -= 1;
        return o[at];
      });
      // certificates are unique across all accounts: draw again on the rare clash
      for (let tries = 0; ; tries++) {
        const slab = gradeCard(cardId, foil, random);
        const ins = await c.query('INSERT INTO slabs (cert, user_id, card_id, data) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [slab.cert, userId, cardId, JSON.stringify(slab)]);
        if (ins.rowCount === 1) {
          // a raw card on show whose last copy went to the grader leaves the stage with it
          if (left === 0) {
            await c.query(`UPDATE accounts SET showcase = (SELECT coalesce(jsonb_agg(i), '[]') FROM jsonb_array_elements(showcase) i
              WHERE NOT (i->>'kind' = 'raw' AND i->>'cardId' = $2 AND (i->>'foil')::boolean = $3)) WHERE user_id = $1`, [userId, cardId, foil]);
          }
          return { slab, account: await readAccount(c, userId) };
        }
        if (tries > 20) throw new Error('no free certificate number');
      }
    });
  },

  /** The showcase as the player arranged it: only what they own, each once, five at most. */
  async setShowcase(db: Db, userId: string, items: unknown) {
    if (!Array.isArray(items) || items.length > SHOWCASE_SIZE) throw new Refused(`At most ${SHOWCASE_SIZE} items`);
    return withAccount(db, userId, async (c) => {
      const cards = ((await c.query('SELECT cards FROM accounts WHERE user_id = $1', [userId])).rows[0]?.cards ?? {}) as Cards;
      const clean: ShowcaseItem[] = [];
      const key = (i: ShowcaseItem) => (i.kind === 'slab' ? `s:${i.cert}` : `r:${i.cardId}:${i.foil}`);
      for (const raw of items as Record<string, unknown>[]) {
        let item: ShowcaseItem;
        if (raw?.kind === 'slab' && typeof raw.cert === 'string') {
          const s = await c.query('SELECT 1 FROM slabs WHERE cert = $1 AND user_id = $2', [raw.cert, userId]);
          if (!s.rowCount) throw new Refused('That slab is not yours');
          item = { kind: 'slab', cert: raw.cert };
        } else if (raw?.kind === 'raw' && typeof raw.cardId === 'string' && typeof raw.foil === 'boolean') {
          if (!((cards[raw.cardId]?.[raw.foil ? 1 : 0] ?? 0) > 0)) throw new Refused('You don\'t own that card');
          item = { kind: 'raw', cardId: raw.cardId, foil: raw.foil };
        } else throw new Refused('Not a showcase item');
        if (!clean.some((x) => key(x) === key(item))) clean.push(item);
      }
      await c.query('UPDATE accounts SET showcase = $2 WHERE user_id = $1', [userId, JSON.stringify(clean)]);
      return readAccount(c, userId);
    });
  },

  /** An admin's gift: coins and packs, with the reason kept in the ledger. */
  async grant(db: Db, adminId: string, userId: string, coins: number, packs: Record<string, number>, reason: string) {
    if (!Number.isInteger(coins) || coins < 0 || coins > 1_000_000) throw new Refused('Coins: 0 to 1,000,000');
    for (const [setId, n] of Object.entries(packs)) {
      if (!BOOSTER_SETS.some((b) => b.id === setId) || !Number.isInteger(n) || n < 1 || n > 100) throw new Refused('Packs: a known set, 1 to 100');
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 200) throw new Refused('Say why (up to 200 characters)');
    return withAccount(db, userId, async (c) => {
      await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [userId, coins]);
      if (Object.keys(packs).length) await addPacks(c, userId, packs);
      await ledger(c, userId, coins, Object.keys(packs).length ? packs : null, `admin: ${reason.trim()}`, adminId);
      return readAccount(c, userId);
    });
  },
};

// ---- decks ----------------------------------------------------------------

const MAX_DECKS = 100;
const MAX_DECK_BYTES = 16_000;

export interface DeckRow { id: string; body: Record<string, unknown>; updatedAt: number }

/** A deck as the client sends it: the DeckList fields, checked for shape and
    size only. Whether it is legal and owned is checked where it is played. */
function cleanDeck(body: unknown): Record<string, unknown> {
  const d = body as Record<string, unknown>;
  const str = (v: unknown, max = 80) => typeof v === 'string' && v.length <= max;
  const entries = (v: unknown) => Array.isArray(v) && v.length <= 60
    && v.every((e) => e && str((e as { def: unknown }).def) && Number.isInteger((e as { n: unknown }).n) && (e as { n: number }).n > 0 && (e as { n: number }).n <= 99);
  if (!d || typeof d !== 'object' || !str(d.name, 40) || !str(d.legend) || !(d.chosenChampion === undefined || str(d.chosenChampion))
    || !entries(d.main) || !entries(d.runes) || !Array.isArray(d.battlefields) || d.battlefields.length > 3 || !d.battlefields.every((b) => str(b))) {
    throw new Refused('Not a deck');
  }
  const out = {
    name: d.name, source: 'custom', legend: d.legend, chosenChampion: d.chosenChampion ?? '', main: d.main, runes: d.runes,
    battlefields: d.battlefields, ...(d.printings && typeof d.printings === 'object' ? { printings: d.printings } : {}),
  };
  if (JSON.stringify(out).length > MAX_DECK_BYTES) throw new Refused('Deck too large');
  return out;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const deckStore = {
  async list(db: Db, userId: string): Promise<DeckRow[]> {
    const r = await db.query('SELECT id, body, updated_at FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
    return r.rows.map((x) => ({ id: x.id, body: x.body, updatedAt: new Date(x.updated_at).getTime() }));
  },
  /** Saves the deck under its id: the app makes the ids (UUIDs), so a deck
      keeps its address from the moment it is made. Another user's id is refused. */
  async save(db: Db, userId: string, id: string, body: unknown): Promise<DeckRow> {
    if (!uuid.test(id)) throw new Refused('No such deck', 404);
    const clean = cleanDeck(body);
    const n = await db.query('SELECT count(*)::int AS n, bool_or(id = $2) AS has FROM decks WHERE user_id = $1', [userId, id]);
    if (!n.rows[0].has && n.rows[0].n >= MAX_DECKS) throw new Refused(`At most ${MAX_DECKS} decks`);
    const r = await db.query(`INSERT INTO decks (id, user_id, body) VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = now() WHERE decks.user_id = EXCLUDED.user_id
      RETURNING updated_at`, [id, userId, clean]);
    if (!r.rowCount) throw new Refused('No such deck', 404);
    return { id, body: clean, updatedAt: new Date(r.rows[0].updated_at).getTime() };
  },
  async remove(db: Db, userId: string, id: string) {
    if (!uuid.test(id)) throw new Refused('No such deck', 404);
    await db.query('DELETE FROM decks WHERE id = $1 AND user_id = $2', [id, userId]);
  },
};
