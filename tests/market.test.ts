import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertUser } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy, readAccount } from '../server/economy.ts';
import { market } from '../server/market.ts';
import type { CardDb } from '../src/data/types.ts';

/* The marketplace against a real Postgres (TEST_DATABASE_URL); a schema of its own. */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=market_test')}`;

describe.skipIf(!url)('marketplace', () => {
  let db: Db, seller = '', buyer = '', other = '', card = '';
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  const raw = async (u: string) => (await readAccount(db, u)).cards[card]?.normal ?? 0;
  const coins = async (u: string) => (await readAccount(db, u)).coins;

  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS market_test CASCADE; CREATE SCHEMA market_test;');
    await migrate(db);
    seller = (await upsertUser(db, { id: '501', username: 'sam' })).id;
    buyer = (await upsertUser(db, { id: '502', username: 'bea' })).id;
    other = (await upsertUser(db, { id: '503', username: 'oli' })).id;
    const s = [...catalog.starters.values()][0];
    await economy.grantStarter(db, catalog, seller, s.id);
    card = Object.entries(s.cards).find(([, n]) => n >= 5)![0];
    await economy.grant(db, seller, buyer, 1000, {}, 'test');
    await economy.grant(db, seller, other, 1000, {}, 'test');
  });
  afterAll(async () => { await db?.end(); });

  it('a listing holds the copies; a buyer takes some, the seller gets the price less 5 %', async () => {
    const had = await raw(seller);
    await expect(market.list(db, catalog, seller, card, false, had + 1, 50)).rejects.toThrow(/copies to sell/);
    await market.list(db, catalog, seller, card, false, 3, 100);
    expect(await raw(seller)).toBe(had - 3);
    const [offer] = await market.browse(db, catalog, catalog.byId.get(card)!.name, 'price');
    expect(offer).toMatchObject({ cardId: card, foil: false, cheapest: 100, copies: 3 });
    const { listings } = await market.card(db, buyer, card, false);
    expect(listings[0]).toMatchObject({ qty: 3, price: 100, mine: false, seller: 'sam' });
    await expect(market.buy(db, seller, listings[0].id, 1)).rejects.toThrow(/own listing/);

    await market.buy(db, buyer, listings[0].id, 2);
    expect(await coins(buyer)).toBe(1000 - 200);
    expect(await coins(seller)).toBe(200 - 10);
    expect(await raw(buyer)).toBe(2);
    const sale = (await db.query('SELECT qty, price, fee FROM market_sales')).rows[0];
    expect(sale).toEqual({ qty: 2, price: 100, fee: 10 });
  });

  it('two buyers at once cannot take the same last copy; nor can someone short of coins', async () => {
    const { listings } = await market.card(db, buyer, card, false);
    const id = listings[0].id;
    const both = await Promise.allSettled([market.buy(db, buyer, id, 1), market.buy(db, other, id, 1)]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT status, qty FROM market_listings WHERE id = $1', [id])).rows[0]).toEqual({ status: 'sold', qty: 0 });

    await market.list(db, catalog, seller, card, false, 1, 5000);
    const pricey = (await market.card(db, buyer, card, false)).listings[0];
    await expect(market.buy(db, other, pricey.id, 1)).rejects.toThrow(/costs/);
  });

  it('cancelling or running out brings the copies back', async () => {
    const mine = await market.mine(db, seller);
    expect(mine.listings).toHaveLength(1);
    expect(mine.sold.length).toBeGreaterThan(0);
    const before = await raw(seller);
    await market.cancel(db, seller, mine.listings[0].id);
    expect(await raw(seller)).toBe(before + 1);
    await expect(market.cancel(db, buyer, mine.listings[0].id)).rejects.toThrow(/No such listing/);

    await market.list(db, catalog, seller, card, false, 1, 10);
    await db.query("UPDATE market_listings SET expires_at = now() - interval '1 minute' WHERE status = 'active'");
    expect(await market.expire(db)).toBe(1);
    expect(await raw(seller)).toBe(before + 1);
    expect(await market.browse(db, catalog, '', 'price')).toEqual([]);
  });
});
