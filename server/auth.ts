import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

/*
 * Sign-in with Discord (OAuth2 authorization-code flow) and sessions.
 *
 * The browser gets a random token in an HttpOnly cookie; the database keeps
 * its SHA-256 only. The OAuth `state` is a random value in a short-lived
 * cookie, compared on the way back, so no other site can complete a login
 * for you. We only ask Discord for `identify`: id, name and avatar.
 */

export const SESSION_COOKIE = 'rift_session';
export const STATE_COOKIE = 'rift_oauth_state';
const SESSION_DAYS = 30;

export interface User { id: string; discordId: string; name: string; avatar: string | null }

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const redirectUri = (cfg: Config) => `${cfg.publicUrl}/auth/discord/callback`;

/** Where to send the browser to sign in, and the state to remember. */
export function discordAuthorizeUrl(cfg: Config): { url: string; state: string } {
  const state = token();
  const q = new URLSearchParams({
    client_id: cfg.discordClientId,
    redirect_uri: redirectUri(cfg),
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return { url: `https://discord.com/oauth2/authorize?${q}`, state };
}

interface DiscordUser { id: string; username: string; global_name?: string | null; avatar?: string | null }

/** Trades the code for an access token, then reads who signed in. */
export async function discordUser(cfg: Config, code: string, f: typeof fetch = fetch): Promise<DiscordUser> {
  const res = await f('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.discordClientId,
      client_secret: cfg.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(cfg),
    }),
  });
  if (!res.ok) throw new Error(`Discord token exchange failed (${res.status})`);
  const { access_token: at } = await res.json() as { access_token?: string };
  if (!at) throw new Error('Discord gave no access token');
  const me = await f('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${at}` } });
  if (!me.ok) throw new Error(`Discord user lookup failed (${me.status})`);
  const u = await me.json() as DiscordUser;
  if (!u.id || !/^\d+$/.test(u.id)) throw new Error('Discord gave no user id');
  return u;
}

const avatarUrl = (u: DiscordUser) => (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null);

export async function upsertUser(db: Db, u: DiscordUser): Promise<User> {
  const name = (u.global_name || u.username || 'Player').slice(0, 64);
  const r = await db.query(
    `INSERT INTO users (discord_id, name, avatar) VALUES ($1, $2, $3)
     ON CONFLICT (discord_id) DO UPDATE SET name = EXCLUDED.name, avatar = EXCLUDED.avatar, last_seen = now()
     RETURNING id, discord_id, name, avatar`,
    [u.id, name, avatarUrl(u)],
  );
  const row = r.rows[0];
  return { id: row.id, discordId: row.discord_id, name: row.name, avatar: row.avatar };
}

export async function createSession(db: Db, userId: string): Promise<{ token: string; maxAge: number }> {
  const t = token();
  const maxAge = SESSION_DAYS * 86400;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [hashToken(t), userId, maxAge],
  );
  return { token: t, maxAge };
}

export async function userForSession(db: Db, t: string | undefined): Promise<User | null> {
  if (!t || t.length > 100) return null;
  const r = await db.query(
    `SELECT u.id, u.discord_id, u.name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(t)],
  );
  const row = r.rows[0];
  return row ? { id: row.id, discordId: row.discord_id, name: row.name, avatar: row.avatar } : null;
}

export async function endSession(db: Db, t: string | undefined): Promise<void> {
  if (t) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(t)]);
}

export async function pruneSessions(db: Db): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}
