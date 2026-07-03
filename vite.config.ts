import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy DEV local : `npm run dev` route /api et /docs vers le backend,
// exactement comme Caddy le fait en production (same-origin partout).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://dev.juriscope.trustena.lu',
        changeOrigin: true,
      },
      '/docs': {
        target: 'https://dev.juriscope.trustena.lu',
        changeOrigin: true,
      },
    },
  },
});
