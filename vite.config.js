import { defineConfig } from 'vite';
// GitHub Pages project sites are served from /<repo>/, so the build needs that as its base path.
// Local dev and `vite preview` stay at '/'. Set by the deploy workflow: VITE_BASE=/Cities/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // Dev port: 5188 by default (moved off Vite's 5173 so it never collides with another dev session); override with CITY_PORT.
  server: { port: Number(process.env.CITY_PORT || 5188), strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { include: ['three'] },
});
