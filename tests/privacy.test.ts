import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertUser, createSession } from '../server/auth.ts';
import { connect, migrate, type Db } from '../server/db.ts';
import { catalogFrom, economy } from '../server/economy.ts';
import { market } from '../server/market.ts';
import { DELETED, deleteAccount, exportAccount, retention } from '../server/privacy.ts';
import type { CardDb } from '../src/data/types.ts';

/* The GDPR rights and retention, against a real Postgres (TEST_DATABASE_URL); a schema of its own. */
const base0 = process.env.TEST_DATABASE_URL;
const url = base0 && `${base0}${base0.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=privacy_test')}`;

describe.skipIf(!url)('privacy', () => {
  let db: Db, me = '', other = '';
  const catalog = catalogFrom(JSON.parse(readFileSync('public/data/cards.json', 'utf8')) as CardDb);
  beforeAll(async () => {
    db = connect(url!);
    await db.query('DROP SCHEMA IF EXISTS privacy_test CASCADE; CREATE SCHEMA privacy_test;');
    await migrate(db);
    me = (await upsertUser(db, { id: '601', username: 'me' })).id;
    other = (await upsertUser(db, { id: '602', username: 'other' })).id;
    const s = [...catalog.starters.values()][0];
    await economy.grantStarter(db, catalog, me, s.id);
    await economy.grant(db, other, other, 500, {}, 'test');
    await createSession(db, me);
    await db.query("UPDATE users SET created_at = now() - interval '30 days'");
    await db.query("INSERT INTO ratings (user_id, mode, games) SELECT id, 'casual', 10 FROM users");
    const card = Object.keys(s.cards)[0];
    await market.list(db, catalog, me, card, false, 1, 10);
    const [l] = (await market.card(db, other, card, false)).listings;
    await market.buy(db, other, l.id, 1);
    await db.query(`INSERT INTO matches (id, mode, players, winner, reason, turns, started_at, record) VALUES
      (gen_random_uuid(), 'casual', ARRAY[$1, $2]::uuid[], 0, 'score', 9, now() - interval '200 days', '{"answers": [1]}'),
      (gen_random_uuid(), 'casual', ARRAY[$2, $1]::uuid[], 1, 'score', 9, now(), '{"answers": [2]}')`, [me, other]);
    await db.query("UPDATE matches SET ended_at = now() - interval '200 days' WHERE started_at < now() - interval '100 days'");
  });
  afterAll(async () => { await db?.end(); });

  it('exports everything kept about the account', async () => {
    const x = await exportAccount(db, me);
    expect(x.user.name).toBe('me');
    expect(Object.keys(x.account.cards).length).toBeGreaterThan(0);
    expect(x.matches).toHaveLength(2);
    expect(x.marketSales[0]).toMatchObject({ sold: true, qty: 1 });
    expect(JSON.stringify(x)).not.toContain('token_hash');
  });

  it('drops old replays and keeps results', async () => {
    await retention(db);
    const rows = (await db.query('SELECT record FROM matches ORDER BY ended_at')).rows;
    expect(rows.map((r) => r.record)).toEqual([{}, { answers: [2] }]);
  });

  it('deletes the account; others keep their history with "Deleted player"', async () => {
    await expect(deleteAccount(db, me, () => true)).rejects.toThrow(/game/);
    await deleteAccount(db, me, () => false);
    expect((await db.query('SELECT 1 FROM users WHERE id = $1', [me])).rowCount).toBe(0);
    for (const t of ['sessions', 'accounts', 'ledger', 'decks', 'ratings']) {
      expect((await db.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [me])).rowCount, t).toBe(0);
    }
    const ms = (await db.query('SELECT players FROM matches')).rows;
    for (const m of ms) expect(m.players).toEqual(expect.arrayContaining([DELETED, other]));
    expect((await db.query('SELECT seller FROM market_sales')).rows[0].seller).toBeNull();
    expect((await exportAccount(db, other)).matches).toHaveLength(2);
  });
});
