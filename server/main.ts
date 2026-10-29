import { createServer } from 'node:http';
import { pruneSessions } from './auth.ts';
import { loadConfig } from './config.ts';
import { connect, migrate } from './db.ts';
import { Online } from './games/online.ts';
import { EnginePool } from './games/pool.ts';
import { handler } from './http.ts';
import { Director } from './tournament/director.ts';
import { Sockets } from './ws.ts';

/* Entry point: settings, database migrations, then the HTTP server. */
const cfg = loadConfig();
const db = connect(cfg.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);

// online play: the engine threads, the sockets, the games (picked up again after a restart)
const pool = new EnginePool();
const sockets = new Sockets();
const online = new Online(db, pool, sockets);
const director = new Director(db, online);
const server = createServer(handler({ cfg, db, online, director }));
sockets.attach(server, cfg, db, () => online);
const resumed = await online.recover();
server.listen(cfg.port, () => console.log(`Riftbound server on :${cfg.port} (${cfg.publicUrl}), ${pool.threads} engine thread(s)${resumed ? `, ${resumed} game(s) resumed` : ''}`));

setInterval(() => { pruneSessions(db).catch(() => undefined); }, 6 * 3600_000).unref();

const stop = () => {
  server.close();
  // the games' records so far are kept: they go on after the restart
  void online.flush().finally(() => { online.stop(); director.stop(); void pool.close(); db.end().finally(() => process.exit(0)); });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
