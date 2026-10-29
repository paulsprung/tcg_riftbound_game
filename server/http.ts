import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import {
  createSession, discordAuthorizeUrl, discordUser, endSession, SESSION_COOKIE, sameSecret, STATE_COOKIE,
  upsertUser, userForSession,
} from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { deckStore, economy, loadCatalog, readAccount, Refused, type Catalog } from './economy.ts';
import type { Online } from './games/online.ts';
import type { Director } from './tournament/director.ts';

/*
 * The whole HTTP surface: the built app (with index.html for client
 * routes), sign-in, and a small JSON API. No framework: a handful of routes
 * read better as one function.
 */

export interface Deps {
  cfg: Config; db: Db; fetch?: typeof fetch;
  /** The card data packs and starters come from; read from the built app when not given. */
  catalog?: Catalog;
  /** Online play, for the standings. */
  online?: Online;
  director?: Director;
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res: ServerResponse, name: string, value: string, maxAge: number, secure: boolean) {
  const prev = res.getHeader('set-cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  list.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  res.setHeader('set-cookie', list);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, to: string) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  res.end();
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

async function serveStatic(cfg: Config, req: IncomingMessage, res: ServerResponse, path: string) {
  const root = resolve(cfg.staticDir);
  let file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(root)) { res.writeHead(400); res.end(); return; }
  let info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) {
    // client routes (#hash routes never reach here, but /some/path might): the app
    file = join(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) { res.writeHead(404); res.end('Not built: run npm run build'); return; }
  }
  // hashed build assets never change; everything else is checked each time
  const immutable = /\/assets\//.test(file);
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}

/**
 * Riot's card images, passed through so they are same-origin: the WebGL
 * foil can then read their pixels (Riot sends no CORS headers). Only card
 * images from Riot's own CDN; Cloudflare in front caches them.
 */
async function riotImage(req: IncomingMessage, res: ServerResponse, url: URL, f: typeof fetch) {
  const rest = url.pathname.slice('/riot-img'.length);
  if (!/^\/sanity\/images\/[\w-]+\/[\w-]+\/[\w-]+\.(png|jpg|webp)$/.test(rest)) { res.writeHead(400); res.end(); return; }
  const up = await f(`https://cmsassets.rgpub.io${rest}${url.search}`);
  if (!up.ok || !up.body) { res.writeHead(up.status === 404 ? 404 : 502); res.end(); return; }
  res.writeHead(200, {
    'content-type': up.headers.get('content-type') ?? 'image/png',
    'cache-control': 'public, max-age=604800, immutable',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(Buffer.from(await up.arrayBuffer()));
}

/** A JSON request body, 64 KB at most. */
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Refused('Send JSON', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const ch of req) {
    size += (ch as Buffer).length;
    if (size > 65_536) throw new Refused('Too large', 413);
    chunks.push(ch as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new Refused('Not JSON');
  }
}

/** A few tries a minute per address, for the sign-in routes. */
function limiter(perMinute: number) {
  const hits = new Map<string, { n: number; t: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.t > 60_000) { hits.set(key, { n: 1, t: now }); return true; }
    if (hits.size > 10_000) hits.clear();
    return ++h.n <= perMinute;
  };
}

export function handler({ cfg, db, fetch: f = fetch, catalog, online, director }: Deps) {
  const secure = cfg.publicUrl.startsWith('https://');
  const authLimit = limiter(20);
  const apiLimit = limiter(240);
  let cat: Promise<Catalog> | null = catalog ? Promise.resolve(catalog) : null;
  const getCatalog = () => (cat ??= loadCatalog(cfg.staticDir).catch((err) => { cat = null; throw err; }));
  const clientIp = (req: IncomingMessage) =>
    (cfg.trustProxy && (req.headers['cf-connecting-ip'] as string)) || req.socket.remoteAddress || '?';

  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const jar = cookies(req);
    try {
      if (path === '/api/health') return json(res, 200, { ok: true, ...(online ? { games: online.stats.games, queued: online.stats.queued } : {}) });

      if (path === '/api/me') {
        const user = await userForSession(db, jar[SESSION_COOKIE]);
        return json(res, 200, { user: user && { id: user.id, name: user.name, avatar: user.avatar } });
      }

      if (path === '/auth/discord') {
        if (!authLimit(clientIp(req))) return json(res, 429, { error: 'Too many tries, wait a minute.' });
        const { url: to, state } = discordAuthorizeUrl(cfg);
        setCookie(res, STATE_COOKIE, state, 600, secure);
        return redirect(res, to);
      }

      if (path === '/auth/discord/callback') {
        if (!authLimit(clientIp(req))) return json(res, 429, { error: 'Too many tries, wait a minute.' });
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state') ?? '';
        const expected = jar[STATE_COOKIE] ?? '';
        setCookie(res, STATE_COOKIE, '', 0, secure);
        if (!code || !expected || !sameSecret(state, expected)) return redirect(res, '/#login-failed');
        const du = await discordUser(cfg, code, f);
        const user = await upsertUser(db, du);
        const s = await createSession(db, user.id);
        setCookie(res, SESSION_COOKIE, s.token, s.maxAge, secure);
        return redirect(res, '/');
      }

      if (path === '/auth/logout') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        // same-site only: a form on another site must not log you out
        const origin = req.headers.origin;
        if (origin && origin !== cfg.publicUrl) return json(res, 403, { error: 'Wrong origin' });
        await endSession(db, jar[SESSION_COOKIE]);
        setCookie(res, SESSION_COOKIE, '', 0, secure);
        return json(res, 200, { ok: true });
      }

      // ---- the signed-in player's account: changes are POST/PUT/DELETE from this site only ----
      if (path.startsWith('/api/account') || path.startsWith('/api/decks') || path.startsWith('/api/admin') || path.startsWith('/api/tournaments')) {
        const user = await userForSession(db, jar[SESSION_COOKIE]);
        if (!user) return json(res, 401, { error: 'Sign in first' });
        if (!apiLimit(user.id)) return json(res, 429, { error: 'Slow down a little' });
        const write = req.method !== 'GET' && req.method !== 'HEAD';
        if (write && req.headers.origin !== cfg.publicUrl) return json(res, 403, { error: 'Wrong origin' });
        const route = `${req.method} ${path}`;
        try {
          if (route === 'GET /api/account') {
            const [account, decks, admin] = await Promise.all([
              readAccount(db, user.id), deckStore.list(db, user.id),
              db.query('SELECT is_admin FROM users WHERE id = $1', [user.id]).then((r) => !!r.rows[0]?.is_admin),
            ]);
            return json(res, 200, { account, decks, admin });
          }
          if (route === 'GET /api/account/standing') {
            if (!online) return json(res, 404, { error: 'No online play here' });
            const [ranked, casual] = await Promise.all([online.standing(user.id, 'ranked'), online.standing(user.id, 'casual')]);
            const recent = await db.query(`SELECT id, mode, players, winner, reason, turns, ended_at, outcome FROM matches
              WHERE players[1] = $1 OR players[2] = $1 ORDER BY ended_at DESC LIMIT 10`, [user.id]);
            return json(res, 200, { ranked, casual, recent: recent.rows.map((m) => {
              const seat = m.players[0] === user.id ? 0 : 1;
              return { id: m.id, mode: m.mode, won: m.winner === seat, draw: m.winner === null, reason: m.reason, turns: m.turns,
                endedAt: new Date(m.ended_at).getTime(), coins: m.outcome?.coins?.[seat] ?? 0 };
            }) });
          }
          if (route === 'POST /api/account/buy') {
            const b = await body(req);
            return json(res, 200, { account: await economy.buyPack(db, user.id, String(b.setId), Number(b.n ?? 1)) });
          }
          if (route === 'POST /api/account/open') {
            const b = await body(req);
            return json(res, 200, await economy.openPack(db, await getCatalog(), user.id, String(b.setId)));
          }
          if (route === 'POST /api/account/daily') return json(res, 200, { account: await economy.claimDaily(db, user.id) });
          if (route === 'POST /api/account/starter') {
            const b = await body(req);
            return json(res, 200, { account: await economy.grantStarter(db, await getCatalog(), user.id, String(b.id)) });
          }
          if (route === 'POST /api/account/tutorial') return json(res, 200, await economy.completeTutorial(db, user.id));
          if (route === 'POST /api/account/grade') {
            const b = await body(req);
            return json(res, 200, await economy.grade(db, user.id, b.cardId as string, b.foil as boolean));
          }
          if (route === 'PUT /api/account/showcase') {
            const b = await body(req);
            return json(res, 200, { account: await economy.setShowcase(db, user.id, b.items) });
          }
          const deck = /^\/api\/decks\/([^/]+)$/.exec(path);
          if (deck && req.method === 'PUT') return json(res, 200, { deck: await deckStore.save(db, user.id, deck[1], (await body(req)).deck) });
          if (deck && req.method === 'DELETE') { await deckStore.remove(db, user.id, deck[1]); return json(res, 200, { ok: true }); }

          const tour = /^\/api\/tournaments(?:\/([^/]+))?(?:\/(join|leave))?$/.exec(path);
          if (tour && director) {
            if (req.method === 'GET' && !tour[1]) return json(res, 200, { tournaments: await director.list(user.id) });
            if (req.method === 'GET' && !tour[2]) return json(res, 200, { tournament: await director.detail(tour[1], user.id) });
            if (req.method === 'POST' && tour[2] === 'join') { await director.join(user.id, user.name, tour[1], String((await body(req)).deck ?? '')); return json(res, 200, { ok: true }); }
            if (req.method === 'POST' && tour[2] === 'leave') { await director.leave(user.id, tour[1]); return json(res, 200, { ok: true }); }
          }

          if (path.startsWith('/api/admin/')) {
            const admin = await db.query('SELECT is_admin FROM users WHERE id = $1', [user.id]);
            if (!admin.rows[0]?.is_admin) return json(res, 403, { error: 'Admins only' });
            if (route === 'GET /api/admin/ledger') {
              const r = await db.query(`SELECT l.coins, l.packs, l.reason, l.created_at, a.name AS actor FROM ledger l LEFT JOIN users a ON a.id = l.actor
                WHERE l.user_id::text = $1 ORDER BY l.id DESC LIMIT 50`, [url.searchParams.get('userId') ?? '']);
              return json(res, 200, { ledger: r.rows.map((x) => ({ coins: x.coins, packs: x.packs, reason: x.reason, at: new Date(x.created_at).getTime(), actor: x.actor })) });
            }
            const at = /^\/api\/admin\/tournaments(?:\/([^/]+)\/(start|cancel))?$/.exec(path);
            if (at && director && req.method === 'POST') {
              if (!at[1]) {
                const b = await body(req);
                return json(res, 200, { id: await director.create(user.id, b as never) });
              }
              if (at[2] === 'start') await director.start(at[1]); else await director.cancel(at[1]);
              return json(res, 200, { ok: true });
            }
            if (route === 'GET /api/admin/users') {
              const q = (url.searchParams.get('q') ?? '').slice(0, 64);
              const r = await db.query(`SELECT u.id, u.discord_id, u.name, coalesce(a.coins, 0) AS coins FROM users u LEFT JOIN accounts a ON a.user_id = u.id
                WHERE u.name ILIKE $1 OR u.discord_id = $2 ORDER BY u.last_seen DESC LIMIT 25`, [`%${q.replace(/[%_\\]/g, '\\$&')}%`, q]);
              return json(res, 200, { users: r.rows.map((x) => ({ id: x.id, discordId: x.discord_id, name: x.name, coins: x.coins })) });
            }
            if (route === 'POST /api/admin/grant') {
              const b = await body(req);
              const to = String(b.userId ?? '');
              const exists = await db.query('SELECT 1 FROM users WHERE id::text = $1', [to]);
              if (!exists.rowCount) return json(res, 404, { error: 'No such player' });
              const account = await economy.grant(db, user.id, to, Number(b.coins ?? 0), (b.packs ?? {}) as Record<string, number>, String(b.reason ?? ''));
              return json(res, 200, { account });
            }
          }
          return json(res, 404, { error: 'No such API' });
        } catch (err) {
          if (err instanceof Refused) return json(res, err.status, { error: err.message });
          throw err;
        }
      }

      if (path.startsWith('/riot-img/')) return await riotImage(req, res, url, f);
      if (path.startsWith('/api/')) return json(res, 404, { error: 'No such API' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      return await serveStatic(cfg, req, res, path);
    } catch (err) {
      console.error(`${req.method} ${path}:`, err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        if (path.startsWith('/auth/')) return redirect(res, '/#login-failed');
        json(res, 500, { error: 'Server error' });
      }
    }
  };
}
