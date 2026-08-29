/**
 * CodeForge AI — backend API route for model requests.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SECURITY MODEL
 *  The browser NEVER holds an API key. It calls these routes; this process
 *  holds the credential in process.env and talks to the vendor. If this
 *  server is not running, or no key is configured, the frontend
 *  automatically falls back to the offline simulation.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Routes
 *   GET  /api/agent/status    → which providers are configured (no secrets)
 *   POST /api/agent/generate  → structured coding actions for a request
 *   POST /api/agent/repair    → a targeted fix for one diagnostic
 *
 * Run standalone:  node server/index.js
 * Run with Vite:   npm run dev   (Vite proxies /api → this process)
 *
 * This is a dependency-free Node http server so the project keeps zero
 * production dependencies. Port it to Express/Fastify/Next.js API routes or
 * a serverless function without changing the contract.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerStatus, resolveProvider, providerChain } from './providers.js';
import { hasBuild, serveStatic } from './static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root (one level above server/). dist/ is resolved from here.
const ROOT_DIR = resolve(__dirname, '..');

/* ------------------------------------------------------------------ */
/* Minimal .env loader (no dependency on dotenv)                       */
/* ------------------------------------------------------------------ */

function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables always win over the file.
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 8 * 1024 * 1024; // generous for large project context
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 120_000);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Scrubs vendor error text before it reaches the browser.
 * Prevents an upstream error from echoing a key fragment or internal URL.
 */
function safeErrorMessage(err) {
  const raw = String(err?.message ?? 'Unknown error');
  return raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/key=[A-Za-z0-9_-]{8,}/g, 'key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
    .slice(0, 1000);
}

/** Naive in-memory rate limit — replace with Redis for multi-instance deploys. */
const hits = new Map();
function rateLimited(ip) {
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 30);
  if (limit <= 0) return false;

  const now = Date.now();
  const window = 60_000;
  const record = hits.get(ip) ?? { count: 0, start: now };

  if (now - record.start > window) {
    record.count = 0;
    record.start = now;
  }
  record.count += 1;
  hits.set(ip, record);

  return record.count > limit;
}

/* ------------------------------------------------------------------ */
/* Route handlers                                                      */
/* ------------------------------------------------------------------ */

async function handleStatus(res) {
  const active = resolveProvider();
  send(res, 200, {
    // Never leak the key itself — only whether one exists.
    configured: Boolean(active),
    activeProvider: active?.id ?? null,
    activeModel: active
      ? process.env[`${active.id.toUpperCase()}_MODEL`] || active.defaultModel
      : null,
    providers: providerStatus(),
    // Ordered failover chain (ids only): Gemini -> Groq -> OpenRouter Free,
    // filtered to configured providers. Lets the UI explain fallbacks.
    chain: providerChain().map((p) => p.id),
  });
}

async function handleChat(req, res, { jsonMode }) {
  const body = await readBody(req);
  const { messages, model, temperature } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return send(res, 400, { error: 'Body must include a non-empty "messages" array' });
  }

  // Ordered failover chain of CONFIGURED providers (bounded: at most one
  // round of attempts): preferred provider (explicit request or AI_PROVIDER)
  // first, then the product default Gemini → Groq → OpenRouter Free, then
  // any other configured provider as a last resort.
  const chain = providerChain(body.provider);
  if (!chain.length) {
    return send(res, 503, {
      error: 'No AI provider is configured on the server.',
      hint: 'Set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY (or another provider key) and redeploy.',
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Wall-clock budget for the WHOLE chain so the worst case (every provider
  // failing) still answers well inside the 60s function limit.
  const chainDeadline = Date.now() + Number(process.env.PROVIDER_CHAIN_BUDGET_MS || 50_000);
  const attempts = [];

  try {
    const started = Date.now();
    for (const provider of chain) {
      if (controller.signal.aborted) break;
      // Never start a provider attempt without a realistic time budget.
      if (attempts.length > 0 && Date.now() > chainDeadline) {
        console.warn('[codeforge] provider chain budget exhausted — stopping failover');
        break;
      }

      try {
        const result = await provider.chat({
          messages,
          // A client/model preference is only meaningful for the preferred
          // provider — fallbacks use their own configured default models.
          model: provider === chain[0] ? model : undefined,
          temperature,
          jsonMode,
          signal: controller.signal,
        });

        if (attempts.length) result.failover = attempts;
        send(res, 200, {
          text: result.text,
          usage: result.usage,
          model: result.model,
          provider: provider.id,
          failover: result.failover,
          durationMs: Date.now() - started,
        });
        return;
      } catch (err) {
        // A client abort is not a provider failure — stop immediately.
        if (err?.name === 'AbortError') throw err;
        attempts.push({ provider: provider.id, status: err?.status ?? 0, error: safeErrorMessage(err) });
        console.error(
          `[codeforge] ${provider.id} failed (failover ${attempts.length}/${chain.length}):`,
          safeErrorMessage(err),
        );
      }
    }

    // Every configured provider failed — one clear, honest error.
    const summary = attempts.map((a) => `${a.provider} (${a.status})`).join(', ');
    const lastError = attempts[attempts.length - 1]?.error ?? 'unknown error';
    send(res, 502, {
      error:
        `All configured AI providers are temporarily unavailable. ` +
        `Tried: ${summary || 'none'}. Last error: ${lastError}`,
      code: 'ALL_PROVIDERS_FAILED',
      attempts,
    });
  } catch (err) {
    const status = err?.name === 'AbortError' ? 504 : (err?.status ?? 502);
    console.error(`[codeforge] provider chain aborted:`, safeErrorMessage(err));
    send(res, status, {
      error: safeErrorMessage(err),
      code: err?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
      attempts,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  const ip = req.socket.remoteAddress ?? 'unknown';
  if (url.pathname.startsWith('/api/') && rateLimited(ip)) {
    return send(res, 429, { error: 'Too many requests', code: 'RATE_LIMITED' });
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/agent/status') {
      return await handleStatus(res);
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/generate') {
      return await handleChat(req, res, { jsonMode: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/repair') {
      return await handleChat(req, res, { jsonMode: true });
    }
    // ---- Static frontend (production single-service deploy) --------------
    // Runs only AFTER every /api/* route above, so API requests are never
    // swallowed by the SPA fallback. No-ops when dist/ has not been built,
    // which keeps the dev setup (Vite on :5173) behaving exactly as before.
    if (serveStatic(req, res, ROOT_DIR)) return;

    // Unbuilt frontend: explain instead of returning a bare "no route".
    // Only when dist/ is actually missing — missing assets (e.g. /foo.js)
    // should 404 honestly, not claim the whole build is missing.
    if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !hasBuild(ROOT_DIR)) {
      return send(res, 404, {
        error: 'Frontend build not found.',
        hint: 'Run `npm run build` to generate dist/, then restart the server.',
        code: 'FRONTEND_NOT_BUILT',
      });
    }

    send(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  } catch (err) {
    send(res, err?.status ?? 500, { error: safeErrorMessage(err) });
  }
});

/**
 * Starts the HTTP server.
 *
 * Exported so the root `index.js` entrypoint (what Render runs) can boot the
 * exact same server. Binds 0.0.0.0 and uses process.env.PORT, which is what
 * Render requires.
 */
export function start(port = PORT) {
  return server.listen(port, '0.0.0.0', () => {
    const active = resolveProvider();
    console.log(`[codeforge] Listening on http://0.0.0.0:${port}`);

    if (hasBuild(ROOT_DIR)) {
      console.log('[codeforge] Serving built frontend from dist/ (single-service mode).');
    } else {
      console.log('[codeforge] No dist/ build found — API only.');
      console.log('[codeforge] Run `npm run build` to serve the UI from this server.');
    }

    if (active) {
      console.log(`[codeforge] Provider: ${active.label} (${active.id})`);
    } else {
      console.log('[codeforge] No provider configured — frontend will use the offline simulation.');
      console.log('[codeforge] To connect one: cp .env.example .env && add a key && restart.');
    }
  });
}

// Only listen when executed directly, so tests can import the server.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  start();
}
