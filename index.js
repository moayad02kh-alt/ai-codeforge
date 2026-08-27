/**
 * CodeForge AI — production entrypoint.
 *
 * This is what a single-service host (Render, Railway, Fly, a plain VM) runs:
 *
 *     Build Command:  npm install && npm run build
 *     Start Command:  npm start          → node index.js
 *
 * One process serves BOTH:
 *   • the built Vite frontend from dist/   (GET /, assets, SPA fallback)
 *   • the existing JSON API                (/api/agent/*)
 *
 * ...so the browser talks to the API same-origin at /api/agent/* with no CORS
 * and no hardcoded host. It binds process.env.PORT on 0.0.0.0, as Render needs.
 *
 * All application logic lives in server/index.js — this file only boots it, so
 * there is exactly one implementation of the server.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS DEFENSIVE
 *
 * A previous deploy paired this entrypoint with an OLDER server/index.js that
 * exported `server` but not `start`, producing:
 *
 *     SyntaxError: The requested module './server/index.js'
 *                  does not provide an export named 'start'
 *
 * A named ESM import is resolved at link time, so that mismatch crashes the
 * process before any code runs — no try/catch can rescue it. Importing the
 * module namespace instead keeps linking successful, letting us pick whichever
 * entrypoint the module actually provides and fail with a clear message rather
 * than an opaque SyntaxError.
 * ---------------------------------------------------------------------------
 */

import * as backend from './server/index.js';

const PORT = Number(process.env.PORT) || 8787;

/**
 * Boots the backend, supporting both module shapes:
 *
 *   1. `export function start(port)`  — current server/index.js. Binds
 *      0.0.0.0, serves dist/ plus /api/agent/*, and logs build status.
 *   2. `export const server`          — older API-only server. We listen here,
 *      still on 0.0.0.0 and process.env.PORT.
 */
function boot() {
  if (typeof backend.start === 'function') {
    return backend.start(PORT);
  }

  const server = backend.server ?? backend.default;

  if (server && typeof server.listen === 'function') {
    // Older module: it only self-listens when run directly, so importing it
    // leaves the server idle and we start it ourselves.
    if (!server.listening) {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`[codeforge] Listening on http://0.0.0.0:${PORT}`);
      });
    }
    return server;
  }

  console.error(
    '[codeforge] server/index.js exported neither `start()` nor `server`.\n' +
      '            The deployed server/index.js is probably out of date or\n' +
      '            incomplete — redeploy the full project tree.\n' +
      `            Exports found: ${Object.keys(backend).join(', ') || '(none)'}`,
  );
  process.exit(1);
}

boot();
