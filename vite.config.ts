import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build can be dropped on any static host
// (Cloudflare Pages, GitHub Pages, a subfolder) without changes.
export default defineConfig({
  base: './',
  plugins: [react()],
});
