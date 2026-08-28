/**
 * CodeForge AI — Vercel serverless adapter for the agent API.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS
 *  Render runs ONE long-lived process (`node index.js`) that serves both the
 *  built frontend and the API. Vercel is serverless: there is no persistent
 *  process, so `node index.js` has no equivalent. Vercel instead serves
 *  dist/ as static files and maps /api/* to functions like this one.
 *
 *  This adapter changes NO application logic. It reuses the exact same
 *  `server` request handler from server/index.js, so both deploy targets run
 *  identical code: same routing, same validation, same rate limiting, same
 *  key handling. The API key stays server-side in process.env.
 *
 *  PRODUCTION GEMINI SETUP:
 *  - Set GEMINI_API_KEY in Vercel dashboard (Environment Variables)
 *  - Set AI_PROVIDER=gemini in Vercel dashboard
 *  - Optionally set GEMINI_MODEL=gemini-3.6-flash (default)
 *  - The frontend will auto-detect via GET /api/agent/status and switch
 *    from simulated to live mode when configured
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Routes handled (via the [action] dynamic segment):
 *   GET  /api/agent/status
 *   POST /api/agent/generate
 *   POST /api/agent/repair
 */

// Vercel function config — allow up to 60s for Gemini responses
// (Gemini can take 20-40s for large file generation)
export const config = {
  maxDuration: 60,
};

import { server } from '../../server/index.js';

export default function handler(req, res) {
  // `server` is a node:http Server. Emitting 'request' invokes the same
  // listener the standalone server uses, with Vercel's req/res objects.
  server.emit('request', req, res);
}
