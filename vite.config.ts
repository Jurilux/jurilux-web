import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy DEV local : `npm run dev` route /api et /docs vers le backend,
// exactement comme Caddy le fait en production (same-origin partout).
// Cible configurable via API_TARGET (défaut = backend jurilux-api local sur :8088).
// Repointer vers l'ancien backend : API_TARGET=https://dev.juriscope.trustena.lu npm run dev
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8088';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/docs': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
