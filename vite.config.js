import { defineConfig } from 'vite';
// GitHub Pages project sites are served from /<repo>/, so the build needs that as its base path.
// Local dev and `vite preview` stay at '/'. Set by the deploy workflow: VITE_BASE=/Cities/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { include: ['three'] },
});
