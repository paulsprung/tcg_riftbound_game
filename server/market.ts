import { LISTING_DAYS, MARKET_FEE, MARKET_MIN_DAYS, MARKET_MIN_MATCHES, MAX_LISTINGS, MAX_PRICE } from '../src/economy/rules.ts';
import type { Db } from './db.ts';
import { addCards, editCards, readAccount, Refused, withAccounts, type Catalog, type Tx } from './economy.ts';

/*
 * The marketplace. A seller lists raw copies of a printing at a price per
 * copy; the copies leave their collection at once and are held by the
 * listing, so they can't be sold twice or played meanwhile. A buyer takes
 * some or all of them: in one transaction, with both accounts and the
 * listing locked, the coins go from buyer to seller (less the market's
 * 5 %), the cards to the buyer, and the sale into the history. Cancelling
 * or running out after 14 days brings the copies back.
 */

export interface Listing { id: string; cardId: string; foil: boolean; qty: number; price: number; mine: boolean; seller: string; expiresAt: number }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const count = (v: unknown, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Refused(`${what}: ${lo} to ${hi.toLocaleString('en-US')}`);
  return v as number;
};

const row = (r: Record<string, unknown>, me: string): Listing => ({
  id: r.id as string, cardId: r.card_id as string, foil: r.foil as boolean, qty: r.qty as number, price: r.price as number,
  mine: r.seller === me, seller: (r.seller_name as string) ?? '?', expiresAt: new Date(r.expires_at as string).getTime(),
});

/** Fresh accounts don't trade yet (alt accounts would pass their free packs and coins on). */
async function mayTrade(c: Tx, userId: string) {
  const r = (await c.query(`SELECT u.created_at < now() - make_interval(days => $2) AS old,
      (SELECT coalesce(sum(games), 0)::int FROM ratings WHERE user_id = u.id) AS games
    FROM users u WHERE u.id = $1`, [userId, MARKET_MIN_DAYS])).rows[0];
  if (!r?.old || r.games < MARKET_MIN_MATCHES) {
    throw new Refused(`Trading opens once your account is ${MARKET_MIN_DAYS} days old and has played ${MARKET_MIN_MATCHES} online matches`);
  }
}

/** The copies of a listing back to its seller (cancelled or expired). */
async function giveBack(c: Tx, l: { seller: string; card_id: string; foil: boolean; qty: number }) {
  if (l.qty > 0) await addCards(c, l.seller, [{ id: l.card_id, foil: l.foil, n: l.qty }]);
}

export const market = {
  async list(db: Db, cat: Catalog, userId: string, cardId: unknown, foil: unknown, qty: unknown, price: unknown) {
    if (typeof cardId !== 'string' || !cat.byId.has(cardId)) throw new Refused('No such card');
    if (typeof foil !== 'boolean') throw new Refused('Foil or not?');
    const n = count(qty, 1, 99, 'Copies');
    const p = count(price, 1, MAX_PRICE, 'Price');
    return withAccounts(db, [userId], async (c) => {
      await mayTrade(c, userId);
      const active = (await c.query("SELECT count(*)::int AS n FROM market_listings WHERE seller = $1 AND status = 'active'", [userId])).rows[0].n;
      if (active >= MAX_LISTINGS) throw new Refused(`At most ${MAX_LISTINGS} listings at a time`);
      await editCards(c, userId, (cards) => {
        const o = cards[cardId];
        const at = foil ? 1 : 0;
        if (!o || o[at] < n) throw new Refused(`You have ${o?.[at] ?? 0} ${foil ? 'foil ' : ''}copies to sell`);
        o[at] -= n;
      });
      await c.query(`INSERT INTO market_listings (seller, card_id, foil, qty, price, expires_at)
        VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`, [userId, cardId, foil, n, p, LISTING_DAYS]);
      return readAccount(c, userId);
    });
  },

  async buy(db: Db, userId: string, listingId: unknown, qty: unknown) {
    if (typeof listingId !== 'string' || !uuid.test(listingId)) throw new Refused('No such listing', 404);
    const n = count(qty, 1, 99, 'Copies');
    // the seller first, outside the lock, so both accounts can be locked in order; checked again inside
    const peek = (await db.query('SELECT seller FROM market_listings WHERE id = $1', [listingId])).rows[0];
    if (!peek) throw new Refused('No such listing', 404);
    if (peek.seller === userId) throw new Refused('That is your own listing');
    return withAccounts(db, [userId, peek.seller], async (c) => {
      await mayTrade(c, userId);
      const l = (await c.query("SELECT * FROM market_listings WHERE id = $1 AND status = 'active' AND expires_at > now() FOR UPDATE", [listingId])).rows[0];
      if (!l) throw new Refused('That listing is gone');
      if (l.qty < n) throw new Refused(`Only ${l.qty} left`);
      const total = l.price * n;
      const fee = Math.ceil(total * MARKET_FEE);
      const paid = await c.query('UPDATE accounts SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2', [userId, total]);
      if (paid.rowCount !== 1) throw new Refused(`That costs ${total.toLocaleString('en-US')} coins`);
      await c.query('UPDATE accounts SET coins = coins + $2 WHERE user_id = $1', [l.seller, total - fee]);
      await addCards(c, userId, [{ id: l.card_id, foil: l.foil, n }]);
      await c.query("UPDATE market_listings SET qty = qty - $2, status = CASE WHEN qty - $2 = 0 THEN 'sold' ELSE status END WHERE id = $1", [listingId, n]);
      await c.query('INSERT INTO market_sales (listing_id, buyer, seller, card_id, foil, qty, price, fee) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [listingId, userId, l.seller, l.card_id, l.foil, n, l.price, fee]);
      await c.query('INSERT INTO ledger (user_id, coins, reason) VALUES ($1, $2, $3), ($4, $5, $6)',
        [userId, -total, `market buy ${n}x ${l.card_id}`, l.seller, total - fee, `market sale ${n}x ${l.card_id}`]);
      return { account: await readAccount(c, userId), seller: l.seller as string };
    });
  },

  async cancel(db: Db, userId: string, listingId: unknown) {
    if (typeof listingId !== 'string' || !uuid.test(listingId)) throw new Refused('No such listing', 404);
    return withAccounts(db, [userId], async (c) => {
      const l = (await c.query("SELECT * FROM market_listings WHERE id = $1 AND seller = $2 AND status = 'active' FOR UPDATE", [listingId, userId])).rows[0];
      if (!l) throw new Refused('No such listing of yours');
      await c.query("UPDATE market_listings SET status = 'cancelled', qty = 0 WHERE id = $1", [listingId]);
      await giveBack(c, l);
      return readAccount(c, userId);
    });
  },

  /** Listings past their time: copies back to their sellers. */
  async expire(db: Db) {
    const due = await db.query("SELECT id, seller FROM market_listings WHERE status = 'active' AND expires_at <= now() LIMIT 200");
    for (const d of due.rows) {
      await withAccounts(db, [d.seller], async (c) => {
        const l = (await c.query("SELECT * FROM market_listings WHERE id = $1 AND status = 'active' FOR UPDATE", [d.id])).rows[0];
        if (!l) return;
        await c.query("UPDATE market_listings SET status = 'expired', qty = 0 WHERE id = $1", [d.id]);
        await giveBack(c, l);
      });
    }
    return due.rowCount ?? 0;
  },

  /** What is for sale: one entry per printing and finish, cheapest first. `q` matches card names. */
  async browse(db: Db, cat: Catalog, q: string, sort: 'price' | 'new' | 'name') {
    const needle = q.trim().toLowerCase();
    const ids = needle ? cat.db.cards.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle)).map((c) => c.id) : null;
    if (ids && ids.length === 0) return [];
    const r = await db.query(`SELECT card_id, foil, min(price)::int AS cheapest, sum(qty)::int AS copies, count(*)::int AS listings, max(created_at) AS newest
      FROM market_listings WHERE status = 'active' AND expires_at > now() ${ids ? 'AND card_id = ANY($1)' : ''}
      GROUP BY card_id, foil ORDER BY ${sort === 'new' ? 'newest DESC' : 'cheapest ASC'} LIMIT 120`, ids ? [ids] : []);
    const out = r.rows.map((x) => ({ cardId: x.card_id, foil: x.foil, cheapest: x.cheapest, copies: x.copies, listings: x.listings }));
    if (sort === 'name') out.sort((a, b) => (cat.byId.get(a.cardId)?.name ?? '').localeCompare(cat.byId.get(b.cardId)?.name ?? ''));
    return out;
  },

  /** One printing: its listings, cheapest first, and its last sales. */
  async card(db: Db, userId: string, cardId: string, foil: boolean) {
    const [ls, sales] = await Promise.all([
      db.query(`SELECT l.*, u.name AS seller_name FROM market_listings l JOIN users u ON u.id = l.seller
        WHERE l.card_id = $1 AND l.foil = $2 AND l.status = 'active' AND l.expires_at > now() ORDER BY l.price, l.created_at LIMIT 50`, [cardId, foil]),
      db.query('SELECT qty, price, at FROM market_sales WHERE card_id = $1 AND foil = $2 ORDER BY at DESC LIMIT 20', [cardId, foil]),
    ]);
    return {
      listings: ls.rows.map((x) => row(x, userId)),
      sales: sales.rows.map((x) => ({ qty: x.qty, price: x.price, at: new Date(x.at).getTime() })),
    };
  },

  /** The player's own: listings up, and what they lately sold and bought. */
  async mine(db: Db, userId: string) {
    const [ls, sold, bought] = await Promise.all([
      db.query("SELECT l.*, '' AS seller_name FROM market_listings l WHERE seller = $1 AND status = 'active' ORDER BY created_at DESC", [userId]),
      db.query('SELECT card_id, foil, qty, price, fee, at FROM market_sales WHERE seller = $1 ORDER BY at DESC LIMIT 30', [userId]),
      db.query('SELECT card_id, foil, qty, price, at FROM market_sales WHERE buyer = $1 ORDER BY at DESC LIMIT 30', [userId]),
    ]);
    const sale = (x: Record<string, unknown>) => ({ cardId: x.card_id, foil: x.foil, qty: x.qty, price: x.price, fee: x.fee ?? 0, at: new Date(x.at as string).getTime() });
    return { listings: ls.rows.map((x) => row(x, userId)), sold: sold.rows.map(sale), bought: bought.rows.map(sale) };
  },
};
