import type { Db } from './db.ts';
import { readAccount, Refused } from './economy.ts';

/*
 * The player's rights under the GDPR, and how long things are kept.
 *
 *   export (art. 15, 20)  everything stored about the account, as JSON
 *   delete (art. 17)      the account and all that hangs off it; in other
 *                         players' history (tournament pairings, match
 *                         lists) the player becomes "Deleted player"
 *   retention             session rows go when they expire (auth.ts);
 *                         a finished match keeps its full record (the
 *                         replay) for 90 days, then only the result; market
 *                         sales forget buyer and seller after a year; the
 *                         ledger is kept two years, for disputes and fraud
 *
 * Nothing else is stored: no e-mail, no IP address (rate limits are counted
 * in memory), no tracking. Discord gives us only the account id, the name
 * and the avatar (scope `identify`).
 */

export const DELETED = '00000000-0000-0000-0000-000000000000';
const RECORD_DAYS = 90, SALE_DAYS = 365, LEDGER_DAYS = 730;

export async function exportAccount(db: Db, userId: string) {
  const q = (sql: string) => db.query(sql, [userId]).then((r) => r.rows);
  const [user] = await q('SELECT discord_id, name, avatar, created_at, last_seen, is_admin FROM users WHERE id = $1');
  return {
    exportedAt: new Date().toISOString(),
    user,
    account: await readAccount(db, userId),
    decks: await q('SELECT id, body, updated_at FROM decks WHERE user_id = $1'),
    ratings: await q('SELECT mode, r, rd, vol, games, wins FROM ratings WHERE user_id = $1'),
    ledger: await q('SELECT coins, packs, reason, created_at FROM ledger WHERE user_id = $1 ORDER BY id'),
    matches: await q(`SELECT id, mode, (players[1] = $1) AS seat0, winner, reason, turns, started_at, ended_at, outcome
      FROM matches WHERE $1 = ANY(players) ORDER BY ended_at`),
    tournaments: await q(`SELECT t.name, t.status, t.starts_at, p.deck_ref, p.dropped, p.final_rank FROM tournament_players p
      JOIN tournaments t ON t.id = p.tournament_id WHERE p.user_id = $1`),
    marketListings: await q('SELECT card_id, foil, qty, price, status, created_at, expires_at FROM market_listings WHERE seller = $1'),
    marketSales: await q('SELECT card_id, foil, qty, price, fee, at, (seller = $1) AS sold FROM market_sales WHERE seller = $1 OR buyer = $1'),
  };
}

/** Deletes the account. Not while in a running tournament or a game: finish or drop first. */
export async function deleteAccount(db: Db, userId: string, busy: (userId: string) => boolean) {
  if (busy(userId)) throw new Refused('Finish your game first');
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const running = await c.query(`SELECT 1 FROM tournament_players p JOIN tournaments t ON t.id = p.tournament_id
      WHERE p.user_id = $1 AND t.status = 'running' AND NOT p.dropped`, [userId]);
    if (running.rowCount) throw new Refused('Drop out of your running tournament first');
    // other players keep their history, with this player as "Deleted player"
    await c.query('UPDATE tournament_matches SET a = $2 WHERE a = $1', [userId, DELETED]);
    await c.query('UPDATE tournament_matches SET b = $2 WHERE b = $1', [userId, DELETED]);
    await c.query('UPDATE matches SET players = array_replace(players, $1::uuid, $2::uuid) WHERE $1 = ANY(players)', [userId, DELETED]);
    await c.query('UPDATE tournaments SET created_by = NULL WHERE created_by = $1', [userId]);
    // the rest goes with the user row (ON DELETE CASCADE / SET NULL)
    await c.query('DELETE FROM users WHERE id = $1', [userId]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally { c.release(); }
}

/** Runs daily: what is past its time goes. */
export async function retention(db: Db) {
  await db.query(`UPDATE matches SET record = '{}'::jsonb WHERE ended_at < now() - make_interval(days => $1) AND record <> '{}'::jsonb`, [RECORD_DAYS]);
  await db.query('UPDATE market_sales SET buyer = NULL, seller = NULL WHERE at < now() - make_interval(days => $1) AND (buyer IS NOT NULL OR seller IS NOT NULL)', [SALE_DAYS]);
  await db.query('DELETE FROM ledger WHERE created_at < now() - make_interval(days => $1)', [LEDGER_DAYS]);
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}
