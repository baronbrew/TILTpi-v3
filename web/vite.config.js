import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard is served by the Tilt Pi server at /ui. During `npm run dev` API and WebSocket
// calls are proxied to a server running on localhost:1880 (cd server && npm run dev).
export default defineConfig({
  base: '/ui/',
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:1880', ws: true },
      '/log.csv': 'http://localhost:1880',
    },
  },
});
