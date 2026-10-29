import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build can be dropped on any static host
// (Cloudflare Pages, GitHub Pages, a subfolder) without changes.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // Riot's image server sends no CORS headers, so a WebGL foil cannot read
    // its pictures directly. In development they are fetched through the dev
    // server instead, which makes them same-origin.
    proxy: {
      // the same paths the server proxies (server/http.ts IMAGE_HOSTS, src/data/hosts.ts)
      ...Object.fromEntries(([
        ['/riot-img', 'https://cmsassets.rgpub.io'], ['/riot-asset', 'https://assetcdn.rgpub.io'],
        ['/ext-img/dotgg', 'https://static.dotgg.gg'], ['/ext-img/piltover', 'https://cdn.piltoverarchive.com'],
      ] as const).map(([prefix, target]) => [prefix, { target, changeOrigin: true, rewrite: (path: string) => path.slice(prefix.length) }])),
      // RIFT_API=http://localhost:8080 npm run dev: talk to a local server
      ...(process.env.RIFT_API ? {
        '/api': { target: process.env.RIFT_API },
        '/auth': { target: process.env.RIFT_API },
      } : {}),
    },
  },
});
