/**
 * Bundles the server (server/main.ts) into dist-server/main.mjs with its
 * migrations next to it. Only `pg` stays an external package.
 */
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist-server', { recursive: true, force: true });
await build({
  entryPoints: ['server/main.ts'],
  outfile: 'dist-server/main.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg'],
  sourcemap: true,
  logLevel: 'info',
});
await cp('server/migrations', 'dist-server/migrations', { recursive: true });
