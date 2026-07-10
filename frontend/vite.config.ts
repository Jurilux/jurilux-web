import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev local : /api est proxifié vers le backend LexKYC (même origine en production,
// derrière le reverse proxy — aucun secret côté navigateur).
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
