import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { SESSION_COOKIE, userForSession } from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { cookies } from './http.ts';
import type { ClientMsg, Online, ServerMsg, Transport } from './games/online.ts';

/*
 * The socket of online play, at /ws. Only a signed-in player from this site
 * gets one (session cookie and Origin checked on the upgrade). A player may
 * have several (tabs): every message to them goes to all. Messages are
 * small JSON; views go out compressed (permessage-deflate: 27 KB become
 * about 4, docs/CAPACITY.md). Dead connections are found by ping.
 */

const MAX_MSG = 16_384;
const PER_SECOND = 30;

export class Sockets implements Transport {
  private readonly conns = new Map<string, Set<WebSocket>>();
  readonly wss = new WebSocketServer({
    noServer: true, maxPayload: MAX_MSG,
    perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 6 }, serverNoContextTakeover: false },
  });
  online = (userId: string) => (this.conns.get(userId)?.size ?? 0) > 0;
  send(userId: string, msg: ServerMsg) {
    const set = this.conns.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
  }
  get count() { let n = 0; for (const s of this.conns.values()) n += s.size; return n; }

  attach(server: Server, cfg: Config, db: Db, online: () => Online) {
    const alive = new WeakSet<WebSocket>();
    const ping = setInterval(() => {
      for (const set of this.conns.values()) for (const ws of set) {
        if (!alive.has(ws)) { ws.terminate(); continue; }
        alive.delete(ws);
        ws.ping();
      }
    }, 30_000);
    ping.unref();

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const refuse = (code: number) => { socket.write(`HTTP/1.1 ${code} No\r\nConnection: close\r\n\r\n`); socket.destroy(); };
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return refuse(404);
      if (req.headers.origin !== cfg.publicUrl) return refuse(403);
      void userForSession(db, cookies(req)[SESSION_COOKIE]).then((user) => {
        if (!user) return refuse(401);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          alive.add(ws);
          ws.on('pong', () => alive.add(ws));
          const set = this.conns.get(user.id) ?? new Set();
          set.add(ws);
          this.conns.set(user.id, set);
          let window = Date.now(), n = 0;
          ws.on('message', (raw) => {
            const now = Date.now();
            if (now - window > 1000) { window = now; n = 0; }
            if (++n > PER_SECOND) return;
            let m: ClientMsg;
            try { m = JSON.parse(String(raw)) as ClientMsg; } catch { return; }
            if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
            void online().message(user.id, user.name, m);
          });
          ws.on('close', () => {
            set.delete(ws);
            if (set.size === 0) { this.conns.delete(user.id); online().disconnected(user.id); }
          });
          void online().connected(user.id);
        });
      }).catch(() => refuse(500));
    });
  }
}
