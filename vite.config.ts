import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Allow the sandboxed preview host (e.g. https://5173-xxxx.e2b.app)
    allowedHosts: true,
    cors: true,
    /*
     * Proxy AI requests to the backend that holds the API key.
     *
     * The browser only ever calls same-origin `/api/...`, so no credential is
     * exposed to client code and there is no CORS surface in development.
     * If the backend is not running the probe simply fails and the app falls
     * back to the offline simulation.
     */
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});
