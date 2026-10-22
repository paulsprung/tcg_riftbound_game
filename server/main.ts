import { createServer } from 'node:http';
import { pruneSessions } from './auth.ts';
import { loadConfig } from './config.ts';
import { connect, migrate } from './db.ts';
import { handler } from './http.ts';

/* Entry point: settings, database migrations, then the HTTP server. */
const cfg = loadConfig();
const db = connect(cfg.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);

const server = createServer(handler({ cfg, db }));
server.listen(cfg.port, () => console.log(`Riftbound server on :${cfg.port} (${cfg.publicUrl})`));

setInterval(() => { pruneSessions(db).catch(() => undefined); }, 6 * 3600_000).unref();

const stop = () => { server.close(); db.end().finally(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
