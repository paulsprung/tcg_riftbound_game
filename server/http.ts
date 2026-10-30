import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import {
  createSession, discordAuthorizeUrl, discordUser, endSession, SESSION_COOKIE, sameSecret, STATE_COOKIE,
  upsertUser, userForSession,
} from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { deckStore, economy, loadCatalog, readAccount, Refused, type Catalog } from './economy.ts';
import type { Online } from './games/online.ts';
import { friends } from './friends.ts';
import { LimitedService } from './limited.ts';
import { market } from './market.ts';
import { site } from './site.ts';
import { deleteAccount, exportAccount } from './privacy.ts';
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
  /** Limited pools; made here when not given. */
  limited?: LimitedService;
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // a malformed value (a lone %) is skipped, never thrown: this runs before any try
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ }
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
  // inside the folder, not merely starting like it (dist vs dist-server)
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(400); res.end(); return; }
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
 * Pictures from other hosts, passed through so the browser only ever talks
 * to this site: no visitor's address goes to Riot, the card databases or
 * Discord (GDPR), and the WebGL foil can read the pixels (Riot sends no CORS
 * headers). Each prefix maps to one host and only paths of the given shape;
 * Cloudflare in front caches them.
 */
const IMAGE_HOSTS: { prefix: string; origin: string; path: RegExp }[] = [
  { prefix: '/riot-img', origin: 'https://cmsassets.rgpub.io', path: /^\/sanity\/images\/[\w-]+\/[\w-]+\/[\w-]+\.(png|jpg|webp|svg)$/ },
  { prefix: '/riot-asset', origin: 'https://assetcdn.rgpub.io', path: /^\/public\/live\/[\w/.-]+\.(svg|png|webp)$/ },
  { prefix: '/ext-img/dotgg', origin: 'https://static.dotgg.gg', path: /^\/riftbound\/cards\/[\w.-]+\.(webp|png|jpg)$/ },
  { prefix: '/ext-img/piltover', origin: 'https://cdn.piltoverarchive.com', path: /^\/cards\/[\w.-]+\.(webp|png|jpg)$/ },
  { prefix: '/avatar', origin: 'https://cdn.discordapp.com', path: /^\/avatars\/\d{5,25}\/a?_?[0-9a-f]{16,40}\.png$/ },
];
const IMAGE_TYPES = /^image\/(png|jpeg|webp|svg\+xml|gif)$/;
/** An image from elsewhere: at most this big, and this long to come. */
const IMAGE_MAX = 8 * 1024 * 1024, IMAGE_MS = 10_000;

async function proxyImage(req: IncomingMessage, res: ServerResponse, url: URL, f: typeof fetch, host: (typeof IMAGE_HOSTS)[number]) {
  const rest = url.pathname.slice(host.prefix.length);
  if (!host.path.test(rest) || rest.includes('..')) { res.writeHead(400); res.end(); return; }
  // only the resize parameters of Riot's image server go along
  const q = new URLSearchParams();
  for (const k of ['w', 'fm', 'q', 'accountingTag', 'size']) { const v = url.searchParams.get(k); if (v && /^[\w-]{1,20}$/.test(v)) q.set(k, v); }
  // the other server down or slow: a bad gateway, not an error of ours
  const up = await f(`${host.origin}${rest}${q.size ? `?${q}` : ''}`, { redirect: 'error', signal: AbortSignal.timeout(IMAGE_MS) }).catch(() => null);
  if (!up) { res.writeHead(502); res.end(); return; }
  const type = (up.headers.get('content-type') ?? '').split(';')[0].trim();
  const size = Number(up.headers.get('content-length') ?? 0);
  if (!up.ok || !up.body || !IMAGE_TYPES.test(type) || size > IMAGE_MAX) { res.writeHead(up.status === 404 ? 404 : 502); res.end(); void up.body?.cancel(); return; }
  const body = Buffer.from(await up.arrayBuffer());
  if (body.length > IMAGE_MAX) { res.writeHead(502); res.end(); return; }
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=604800, immutable',
    // an SVG from elsewhere is shown, never run
    ...(type === 'image/svg+xml' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Discord's avatar URL as this site's own path. */
const ownAvatar = (u: string | null) => (u ? u.replace(/^https:\/\/cdn\.discordapp\.com/, '/avatar') : null);

const csp = (publicUrl: string) => [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", `connect-src 'self' ${publicUrl.replace(/^http/, 'ws')}`, "worker-src 'self' blob:", "object-src 'none'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

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

export function handler({ cfg, db, fetch: f = fetch, catalog, online, director, limited: given }: Deps) {
  const secure = cfg.publicUrl.startsWith('https://');
  const authLimit = limiter(20);
  const apiLimit = limiter(240);
  const CSP = csp(cfg.publicUrl);
  let cat: Promise<Catalog> | null = catalog ? Promise.resolve(catalog) : null;
  const getCatalog = () => (cat ??= loadCatalog(cfg.staticDir).catch((err) => { cat = null; throw err; }));
  const limited = given ?? new LimitedService(db, getCatalog);
  const clientIp = (req: IncomingMessage) => {
    // the entries before the last are the visitor's own word: only the one our proxy added counts
    const fwd = cfg.trustProxy === 'forwarded' ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim() : '';
    const cf = cfg.trustProxy === true ? (req.headers['cf-connecting-ip'] as string | undefined) : '';
    return fwd || cf || req.socket.remoteAddress || '?';
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('x-frame-options', 'DENY');
    // only this site's own scripts, styles, pictures and socket (every outside picture is proxied)
    res.setHeader('content-security-policy', CSP);
    if (secure) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    let path = '';
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      path = url.pathname;
      const jar = cookies(req);
      if (path === '/api/site') return json(res, 200, { operator: cfg.operator, cloudflare: cfg.trustProxy === true });
      if (path === '/api/home') {
        // what Home shows: the news and the banner, the same for everyone
        const [news, home] = await Promise.all([site.news(db), site.home(db)]);
        res.setHeader('cache-control', 'no-cache');
        return json(res, 200, { news, home });
      }
      if (path === '/api/health') return json(res, 200, { ok: true, ...(online ? { games: online.stats.games, queued: online.stats.queued } : {}) });

      if (path === '/api/me') {
        const user = await userForSession(db, jar[SESSION_COOKIE]);
        return json(res, 200, { user: user && { id: user.id, name: user.name, avatar: ownAvatar(user.avatar) } });
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
        if (origin !== cfg.publicUrl) return json(res, 403, { error: 'Wrong origin' });
        await endSession(db, jar[SESSION_COOKIE]);
        setCookie(res, SESSION_COOKIE, '', 0, secure);
        return json(res, 200, { ok: true });
      }

      // ---- the signed-in player's account: changes are POST/PUT/DELETE from this site only ----
      if (path.startsWith('/api/account') || path.startsWith('/api/decks') || path.startsWith('/api/admin') || path.startsWith('/api/tournaments') || path.startsWith('/api/market') || path.startsWith('/api/friends') || path.startsWith('/api/limited')) {
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
          // ---- the player's rights (GDPR art. 15, 17, 20) ----
          if (route === 'GET /api/account/export') {
            res.setHeader('content-disposition', 'attachment; filename="riftbound-account.json"');
            return json(res, 200, await exportAccount(db, user.id));
          }
          if (route === 'POST /api/account/delete') {
            if ((await body(req)).confirm !== 'DELETE') return json(res, 400, { error: 'Type DELETE to confirm' });
            await deleteAccount(db, user.id, (u) => online?.inGame(u) ?? false);
            online?.forget(user.id);
            setCookie(res, SESSION_COOKIE, '', 0, secure);
            return json(res, 200, { ok: true });
          }
          if (route === 'GET /api/account/standing') {
            if (!online) return json(res, 404, { error: 'No online play here' });
            const [ranked, casual] = await Promise.all([online.standing(user.id, 'ranked'), online.standing(user.id, 'casual')]);
            const recent = await db.query(`SELECT id, mode, players, winner, reason, turns, ended_at, outcome FROM matches
              WHERE $1 = ANY(players) ORDER BY ended_at DESC LIMIT 10`, [user.id]);
            const won = (await db.query('SELECT count(*)::int AS n FROM tournament_players WHERE user_id = $1 AND final_rank = 1', [user.id])).rows[0].n;
            return json(res, 200, { ranked, casual, tournamentsWon: won, recent: recent.rows.map((m) => {
              const seat = m.players.indexOf(user.id);
              // in 2v2 the teams sit alternately and win together
              const won = m.winner !== null && (m.winner === seat || (m.players.length === 4 && m.winner % 2 === seat % 2));
              return { id: m.id, mode: m.mode, won, draw: m.winner === null, reason: m.reason, turns: m.turns,
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
          if (route === 'POST /api/account/deck') {
            const b = await body(req);
            return json(res, 200, { account: await economy.buyDeck(db, await getCatalog(), user.id, b.id) });
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

          // ---- Limited pools (casual Sealed and Draft) ----
          if (route === 'GET /api/limited') return json(res, 200, { pool: await limited.current(user.id) });
          if (route === 'POST /api/limited') { const b = await body(req); return json(res, 200, { pool: await limited.start(user.id, b.format, b.setId) }); }
          const lim = /^\/api\/limited\/([0-9a-f-]{36})\/(pick|deck)$/.exec(path);
          if (lim && req.method === 'POST' && lim[2] === 'pick') return json(res, 200, { pool: await limited.pick(user.id, lim[1], (await body(req)).card) });
          if (lim && req.method === 'PUT' && lim[2] === 'deck') return json(res, 200, { pool: await limited.saveDeck(user.id, lim[1], (await body(req)).deck) });

          // ---- friends ----
          if (route === 'GET /api/friends') return json(res, 200, await friends.list(db, user.id, (id) => online?.presence(id) ?? 'offline'));
          if (route === 'POST /api/friends/add') {
            const r = await friends.add(db, user.id, (await body(req)).code);
            online?.notify(r.id, 'friends');
            return json(res, 200, r);
          }
          if (route === 'POST /api/friends/accept' || route === 'POST /api/friends/remove') {
            const other = String((await body(req)).id ?? '');
            if (route.endsWith('accept')) await friends.accept(db, user.id, other); else await friends.remove(db, user.id, other);
            online?.notify(other, 'friends');
            return json(res, 200, { ok: true });
          }

          // ---- the marketplace ----
          if (route === 'GET /api/market') {
            const sort = url.searchParams.get('sort');
            return json(res, 200, { offers: await market.browse(db, await getCatalog(), (url.searchParams.get('q') ?? '').slice(0, 60), sort === 'new' || sort === 'name' ? sort : 'price') });
          }
          if (route === 'GET /api/market/card') {
            return json(res, 200, await market.card(db, user.id, String(url.searchParams.get('id') ?? ''), url.searchParams.get('foil') === '1'));
          }
          if (route === 'GET /api/market/mine') return json(res, 200, await market.mine(db, user.id));
          if (route === 'POST /api/market/list') {
            const b = await body(req);
            return json(res, 200, { account: await market.list(db, await getCatalog(), user.id, b.cardId, b.foil, b.qty, b.price) });
          }
          if (route === 'POST /api/market/buy') {
            const b = await body(req);
            const r = await market.buy(db, user.id, b.listingId, b.qty);
            online?.notify(r.seller, 'sale');
            return json(res, 200, { account: r.account });
          }
          if (route === 'POST /api/market/cancel') { const b = await body(req); return json(res, 200, { account: await market.cancel(db, user.id, b.listingId) }); }

          const tour = /^\/api\/tournaments(?:\/([^/]+))?(?:\/(join|leave|pool|pick|deck|ready))?$/.exec(path);
          if (tour && director) {
            if (req.method === 'GET' && !tour[1]) return json(res, 200, { tournaments: await director.list(user.id) });
            if (req.method === 'GET' && !tour[2]) return json(res, 200, { tournament: await director.detail(tour[1], user.id) });
            if (req.method === 'POST' && tour[2] === 'join') { await director.join(user.id, user.name, tour[1], String((await body(req)).deck ?? '')); return json(res, 200, { ok: true }); }
            if (req.method === 'POST' && tour[2] === 'leave') { await director.leave(user.id, tour[1]); return json(res, 200, { ok: true }); }
            // a Limited tournament: your pool, your draft picks, your deck, ready to play
            if (req.method === 'GET' && tour[2] === 'pool') return json(res, 200, { pool: await director.poolOf(user.id, tour[1]) });
            if (req.method === 'POST' && tour[2] === 'pick') return json(res, 200, { pool: await director.pick(user.id, tour[1], (await body(req)).card) });
            if (req.method === 'PUT' && tour[2] === 'deck') return json(res, 200, { pool: await director.saveDeck(user.id, tour[1], (await body(req)).deck) });
            if (req.method === 'POST' && tour[2] === 'ready') { await director.ready(user.id, tour[1]); return json(res, 200, { ok: true }); }
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
            if (route === 'GET /api/admin/news') return json(res, 200, { news: await site.news(db, true), home: await site.home(db) });
            if (route === 'POST /api/admin/news') return json(res, 200, { news: await site.saveNews(db, user.id, await body(req)) });
            if (route === 'POST /api/admin/news/order') { await site.orderNews(db, (await body(req)).ids); return json(res, 200, { ok: true }); }
            const nd = /^\/api\/admin\/news\/([0-9a-f-]{36})$/.exec(path);
            if (nd && req.method === 'DELETE') { await site.deleteNews(db, nd[1]); return json(res, 200, { ok: true }); }
            if (route === 'PUT /api/admin/home') return json(res, 200, { home: await site.setHome(db, user.id, await body(req)) });
            if (route === 'GET /api/admin/users') {
              const q = (url.searchParams.get('q') ?? '').slice(0, 64);
              const r = await db.query(`SELECT u.id, u.discord_id, u.name, coalesce(a.coins, 0) AS coins FROM users u LEFT JOIN accounts a ON a.user_id = u.id
                WHERE (u.name ILIKE $1 OR u.discord_id = $2) AND u.discord_id <> 'deleted' ORDER BY u.last_seen DESC LIMIT 25`, [`%${q.replace(/[%_\\]/g, '\\$&')}%`, q]);
              return json(res, 200, { users: r.rows.map((x) => ({ id: x.id, discordId: x.discord_id, name: x.name, coins: x.coins })) });
            }
            if (route === 'POST /api/admin/grant') {
              const b = await body(req);
              const to = String(b.userId ?? '');
              const exists = await db.query('SELECT 1 FROM users WHERE id::text = $1', [to]);
              if (!exists.rowCount) return json(res, 404, { error: 'No such player' });
              const account = await economy.grant(db, user.id, to, Number(b.coins ?? 0), (b.packs ?? {}) as Record<string, number>, String(b.reason ?? ''));
              online?.notify(to, 'gift');
              return json(res, 200, { account });
            }
          }
          return json(res, 404, { error: 'No such API' });
        } catch (err) {
          if (err instanceof Refused) return json(res, err.status, { error: err.message });
          throw err;
        }
      }

      const img = IMAGE_HOSTS.find((h) => path.startsWith(`${h.prefix}/`));
      if (img) return await proxyImage(req, res, url, f, img);
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
