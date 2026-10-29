/**
 * Bundles the server (server/main.ts) into dist-server/main.mjs with its
 * migrations next to it. Only `pg` and `ws` stay external packages.
 */
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist-server', { recursive: true, force: true });
await build({
  // the server, and the engine thread it starts (server/games/pool.ts finds worker.mjs next to it)
  entryPoints: { main: 'server/main.ts', worker: 'server/games/worker.ts' },
  outdir: 'dist-server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg', 'ws'],
  sourcemap: true,
  logLevel: 'info',
});
await cp('server/migrations', 'dist-server/migrations', { recursive: true });
