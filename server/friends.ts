import { randomInt } from 'node:crypto';
import type { Db } from './db.ts';
import { Refused } from './economy.ts';

/*
 * Friends. Each player has a friend code (eight letters and digits, no look-
 * alikes); entering someone's code sends them a request, which they accept
 * or decline. Entering the code of someone who already asked you accepts.
 * What friends see of each other: name, avatar and presence (online, looking
 * for a match, in a game, offline), nothing else.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_FRIENDS = 200, MAX_PENDING = 50;

export type Presence = 'online' | 'queue' | 'game' | 'offline';
export interface FriendRow { id: string; name: string; avatar: string | null; presence: Presence }

const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const cleanCode = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export async function friendCode(db: Db, userId: string): Promise<string> {
  const r = await db.query('SELECT friend_code FROM users WHERE id = $1', [userId]);
  if (r.rows[0]?.friend_code) return r.rows[0].friend_code;
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    const u = await db.query('UPDATE users SET friend_code = $2 WHERE id = $1 AND friend_code IS NULL RETURNING friend_code', [userId, code]).catch(() => null);
    if (u?.rowCount) return code;
    const again = await db.query('SELECT friend_code FROM users WHERE id = $1', [userId]);
    if (again.rows[0]?.friend_code) return again.rows[0].friend_code;
  }
  throw new Error('no free friend code');
}

export const friends = {
  /** Everyone the player is friends with, and the requests both ways. */
  async list(db: Db, userId: string, presence: (id: string) => Presence) {
    const r = await db.query(`SELECT f.status, f.requested_by, u.id, u.name, u.avatar FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
      WHERE f.user_a = $1 OR f.user_b = $1 ORDER BY lower(u.name)`, [userId]);
    const own = (u: string | null) => (u ? u.replace(/^https:\/\/cdn\.discordapp\.com/, '/avatar') : null);
    const row = (x: Record<string, string>) => ({ id: x.id, name: x.name, avatar: own(x.avatar) });
    return {
      code: await friendCode(db, userId),
      friends: r.rows.filter((x) => x.status === 'accepted').map((x) => ({ ...row(x), presence: presence(x.id) })),
      incoming: r.rows.filter((x) => x.status === 'pending' && x.requested_by !== userId).map(row),
      outgoing: r.rows.filter((x) => x.status === 'pending' && x.requested_by === userId).map(row),
    };
  },

  /** A request by code; returns who it went to and whether that made you friends. */
  async add(db: Db, userId: string, code: unknown): Promise<{ id: string; name: string; accepted: boolean }> {
    const c = cleanCode(code);
    if (c.length !== 8) throw new Refused('A friend code has 8 letters and digits');
    const to = (await db.query('SELECT id, name FROM users WHERE friend_code = $1', [c])).rows[0];
    if (!to) throw new Refused('No player with that code');
    if (to.id === userId) throw new Refused('That is your own code');
    const [a, b] = pair(userId, to.id);
    const have = (await db.query('SELECT status, requested_by FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b])).rows[0];
    if (have?.status === 'accepted') throw new Refused(`You are friends with ${to.name} already`);
    if (have && have.requested_by === userId) throw new Refused(`Request already sent to ${to.name}`);
    if (have) {
      await db.query("UPDATE friendships SET status = 'accepted' WHERE user_a = $1 AND user_b = $2", [a, b]);
      return { id: to.id, name: to.name, accepted: true };
    }
    const counts = (await db.query(`SELECT count(*) FILTER (WHERE status = 'accepted')::int AS friends,
      count(*) FILTER (WHERE status = 'pending' AND requested_by = $1)::int AS pending FROM friendships WHERE user_a = $1 OR user_b = $1`, [userId])).rows[0];
    if (counts.friends >= MAX_FRIENDS) throw new Refused(`At most ${MAX_FRIENDS} friends`);
    if (counts.pending >= MAX_PENDING) throw new Refused('Too many open requests');
    await db.query('INSERT INTO friendships (user_a, user_b, requested_by) VALUES ($1, $2, $3)', [a, b, userId]);
    return { id: to.id, name: to.name, accepted: false };
  },

  async accept(db: Db, userId: string, other: unknown) {
    const o = String(other ?? '');
    if (!/^[0-9a-f-]{36}$/.test(o)) throw new Refused('No such request');
    const [a, b] = pair(userId, o);
    const r = await db.query("UPDATE friendships SET status = 'accepted' WHERE user_a = $1 AND user_b = $2 AND status = 'pending' AND requested_by <> $3", [a, b, userId]);
    if (!r.rowCount) throw new Refused('No such request');
  },

  /** Declines a request, takes back your own, or ends a friendship. */
  async remove(db: Db, userId: string, other: unknown) {
    const o = String(other ?? '');
    if (!/^[0-9a-f-]{36}$/.test(o)) throw new Refused('No such friend');
    const [a, b] = pair(userId, o);
    await db.query('DELETE FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
  },

  async areFriends(db: Db, x: string, y: string) {
    const [a, b] = pair(x, y);
    return !!(await db.query("SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2 AND status = 'accepted'", [a, b])).rowCount;
  },

  /** The accepted friends' ids, to tell them when the player's presence changes. */
  async ids(db: Db, userId: string): Promise<string[]> {
    const r = await db.query(`SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS id FROM friendships
      WHERE (user_a = $1 OR user_b = $1) AND status = 'accepted'`, [userId]);
    return r.rows.map((x) => x.id);
  },
};
