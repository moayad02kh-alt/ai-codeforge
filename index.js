/**
 * CodeForge AI — production entrypoint.
 *
 * This is what a single-service host (Render, Railway, Fly, a plain VM) runs:
 *
 *     Build Command:  npm install && npm run build
 *     Start Command:  node index.js
 *
 * One process serves BOTH:
 *   • the built Vite frontend from dist/   (GET /, assets, SPA fallback)
 *   • the existing JSON API                (/api/agent/*)
 *
 * …so the browser talks to the API same-origin at /api/agent/* with no CORS
 * and no hardcoded host. It binds process.env.PORT, which Render provides.
 *
 * All application logic lives in server/index.js — this file only boots it,
 * so there is exactly one implementation of the server.
 */

import { start } from './server/index.js';

start();
