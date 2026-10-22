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

/*
 * The whole HTTP surface: the built app (with index.html for client
 * routes), sign-in, and a small JSON API. No framework: a handful of routes
 * read better as one function.
 */

export interface Deps { cfg: Config; db: Db; fetch?: typeof fetch }

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

export function handler({ cfg, db, fetch: f = fetch }: Deps) {
  const secure = cfg.publicUrl.startsWith('https://');
  const authLimit = limiter(20);
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
      if (path === '/api/health') return json(res, 200, { ok: true });

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
