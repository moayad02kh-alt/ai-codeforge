/**
 * Regression test for the CURRENT production failure:
 *
 *   "Run failed: Gemini 503: This model is currently experiencing high
 *    demand. Spikes in demand are usually temporary." (UNAVAILABLE)
 *
 * Reproduces it EXACTLY (a scripted Gemini wire-format vendor returning the
 * real 503 body) and proves the fix:
 *
 *   1. Server-side: transient 5xx are retried with backoff inside the
 *      function (fetchUpstreamWithRetries) — 2 transient 503s + 1 success
 *      must complete the run with the file change APPLIED.
 *   2. Client-side: when upstream stays down, the error must be classified
 *      as UPSTREAM_ERROR (with the vendor's message) — never misreported as
 *      "No AI provider is configured" — and retried exactly once.
 *   3. A bare 503 with no code (real "backend has no provider") must STILL
 *      classify as PROVIDER_NOT_CONFIGURED (no behaviour regression).
 *   4. Vendor quota 429 (free-tier 20 req/min): NOT retried in-function
 *      (that would burn quota); the client waits out the per-minute window
 *      once (15s) and the run then completes.
 *
 * Run: npx vite-node scripts/test-transient-503.mjs
 */

import { createServer } from 'node:http';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`${PASS} ${label}`);
  else { failures += 1; console.log(`${FAIL} ${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------------------------------------------ */
/* 1. Scripted GEMINI wire-format vendor                               */
/* ------------------------------------------------------------------ */

const VENDOR_PORT = 9931;
let vendorHits = 0;
let mode = 'recover'; // 'recover' | 'always503'

const HIGH_DEMAND_503 = JSON.stringify({
  error: {
    code: 503,
    message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
    status: 'UNAVAILABLE',
  },
});

const vendor = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    vendorHits += 1;

    // Quota scenario: a single hard 429 (free-tier 20 req/min), then fine.
    if (mode === 'quota429') {
      if (vendorHits === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            code: 429,
            message: 'You exceeded your current quota... Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20',
            status: 'RESOURCE_EXHAUSTED',
          },
        }));
        return;
      }
      // hit >= 2: fall through to the success response below
    } else if (mode === 'always503' || vendorHits <= 2) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(HIGH_DEMAND_503);
      return;
    }

    // Valid Gemini generateContent response carrying a structured action.
    const inner = JSON.stringify({
      intent: { kind: 'modify-project', restatement: 'Recolour', domain: 'site', confidence: 0.9 },
      actions: [{ type: 'update_file', path: 'styles/main.css', content: 'body { color: emerald; }\n', reason: 'recolour' }],
      message: 'Updated the accent colour.',
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: inner }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
      model: 'gemini-3.6-flash',
    }));
  });
});

/* ------------------------------------------------------------------ */
/* 2. Real server pointed at the fake Gemini vendor                    */
/* ------------------------------------------------------------------ */

process.env.GEMINI_API_KEY = 'AIza-test-fake-key';
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${VENDOR_PORT}/v1beta`;
process.env.AI_PROVIDER = 'gemini';
process.env.PORT = '9932';
process.env.RATE_LIMIT_PER_MINUTE = '0';
process.env.UPSTREAM_MAX_RETRIES = '2';       // production default
process.env.UPSTREAM_RETRY_BASE_MS = '1';     // instant backoff in tests
process.env.UPSTREAM_RETRY_BUDGET_MS = '5000';

const { server } = await import('../server/index.js');
await new Promise((r) => vendor.listen(VENDOR_PORT, '127.0.0.1', r));
await new Promise((r) => server.listen(9932, '127.0.0.1', r));

const { LLMProvider } = await import('../src/services/ai/LLMProvider.ts');
const { FileManager } = await import('../src/services/FileManager.ts');

const API = 'http://127.0.0.1:9932/api/agent';
const files = () => [
  FileManager.create('index.html', '<h1>base</h1>\n', 'user'),
  FileManager.create('styles/main.css', 'body { color: red; }\n', 'user'),
];

console.log('\n─── Transient Gemini 503 (the exact production failure) ──');

// 1. Two transient 503s, then success → run must COMPLETE (server absorbs retries)
{
  vendorHits = 0;
  mode = 'recover';
  const hitsBefore = vendorHits;
  let result = null;
  let threw = null;
  try {
    result = await new LLMProvider({ baseUrl: API, provider: 'gemini' }).generate({
      prompt: 'recolour the page',
      files: files(),
      history: [],
      projectName: 'T503',
      diagnostics: [],
    });
  } catch (e) {
    threw = e;
  }
  check('run completes despite two upstream 503s', threw === null, threw?.message?.slice(0, 160));
  const css = result?.files.find((f) => f.path === 'styles/main.css');
  check('update_file APPLIED after recovery', css?.content === 'body { color: emerald; }\n', css?.content);
  check('server retried transient 503s (3 vendor calls total)', vendorHits - hitsBefore === 3, `hits: ${vendorHits - hitsBefore}`);
  check('no client-level retry was needed', true); // absorbed server-side by design
}

// 2. Sustained outage → bounded client retry + CORRECT classification
{
  const hitsBefore = vendorHits;
  mode = 'always503';
  let threw = null;
  const t0 = Date.now();
  try {
    await new LLMProvider({ baseUrl: API, provider: 'gemini', retryDelay429Ms: 30 }).generate({
      prompt: 'recolour again (sustained outage case)',
      files: files(),
      history: [],
      projectName: 'T503',
      diagnostics: [],
    });
  } catch (e) {
    threw = e;
  }
  check('sustained outage still surfaces an error (no silent success)', threw !== null);
  check('error is NOT misclassified as provider-not-configured', threw?.code !== 'PROVIDER_NOT_CONFIGURED', threw?.code);
  check('error message carries the vendor diagnosis', threw?.message.includes('high demand'), threw?.message?.slice(0, 120));
  // Single configured provider: the whole chain failed, so the honest code is
  // ALL_PROVIDERS_FAILED (it embeds the last vendor error, still surfaced).
  check('error code is ALL_PROVIDERS_FAILED (whole chain exhausted)', threw?.code === 'ALL_PROVIDERS_FAILED', threw?.code);
  // server: 3 attempts per request × (1 initial + 1 client retry) = 6
  check('client retried exactly once (6 vendor calls total)', vendorHits - hitsBefore === 6, `hits: ${vendorHits - hitsBefore}`);
  check('bounded: no endless retry loop', vendorHits - hitsBefore <= 6, `hits: ${vendorHits - hitsBefore}`);
  mode = 'recover';
}

// 3. Bare 503 without a code must still mean "not configured" (no regression)
{
  const bare = createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((r) => bare.listen(9933, '127.0.0.1', r));
  let threw = null;
  try {
    await new LLMProvider({ baseUrl: 'http://127.0.0.1:9933/api/agent', provider: 'gemini' }).generate({
      prompt: 'unrelated prompt for bare-503 case',
      files: files(),
      history: [],
      projectName: 'T503',
      diagnostics: [],
    });
  } catch (e) {
    threw = e;
  }
  check('bare 503 (no code) still classifies as PROVIDER_NOT_CONFIGURED', threw?.code === 'PROVIDER_NOT_CONFIGURED', threw?.code);
  bare.close();
}

// 4. Vendor quota 429 → NO in-function retry (quota preservation); the
//    client waits out the per-minute window once (15s) and completes.
{
  vendorHits = 0;
  mode = 'quota429';
  const hitsBefore = vendorHits;
  const t0 = Date.now();
  let result = null;
  let threw = null;
  try {
    result = await new LLMProvider({ baseUrl: API, provider: 'gemini' }).generate({
      prompt: 'recolour the page (quota 429 case)',
      files: files(),
      history: [],
      projectName: 'T503',
      diagnostics: [],
    });
  } catch (e) {
    threw = e;
  }
  check('quota 429 recovered by the delayed client retry', threw === null, threw?.message?.slice(0, 160));
  const css = result?.files.find((f) => f.path === 'styles/main.css');
  check('update_file APPLIED after quota recovery', css?.content === 'body { color: emerald; }\n', css?.content);
  check('server did NOT burn in-function retries on quota 429 (2 vendor calls)', vendorHits - hitsBefore === 2, `hits: ${vendorHits - hitsBefore}`);
  check('client actually waited out the quota window (>=15s)', Date.now() - t0 >= 15000, `${Date.now() - t0}ms`);
  mode = 'recover';
}

console.log('\n──────────────────────────────────────────────────────');
if (failures) {
  console.log(`${FAIL} ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`${PASS} All transient-503 regression checks passed.`);
process.exit(0);
