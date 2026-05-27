import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SelfHeal product UI. Built to web/dist, which the Hono host (src/api/static.ts) serves.
// `base: './'` keeps asset URLs relative so the bundle works under any mount path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Proxy API calls to the Hono backend during `vite dev` (HMR for the UI, live API).
    // The Hono host (scripts/serve.ts) defaults to PORT 5175.
    proxy: {
      '/api': 'http://localhost:5175',
    },
  },
});
