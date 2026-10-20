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
      '/riot-img': {
        target: 'https://cmsassets.rgpub.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/riot-img/, ''),
      },
    },
  },
});
