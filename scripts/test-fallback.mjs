/**
 * Regression tests for the multi-provider fallback chain:
 *   Gemini (primary) → Groq → OpenRouter Free → other configured
 *
 * Boots THREE scripted fake vendors (Gemini wire + a shared OpenAI-compatible
 * wire for Groq/OpenRouter paths) and the REAL server, then drives the REAL
 * client pipeline (LLMProvider → parse → normalise → validate → execute):
 *
 *   1. Gemini succeeds            → Gemini only (no failover, no extra calls)
 *   2. Gemini 429                 → Groq succeeds, UI note shown, file applied
 *   3. Gemini 503 (exhausted)     → Groq succeeds, in-function retries bounded
 *   4. Gemini 503 + Groq 429      → OpenRouter succeeds, both notes shown
 *   5. All providers fail         → one clear ALL_PROVIDERS_FAILED error
 *   6. API keys never appear in any client-visible response
 *   7. Fallback responses flow through the SAME validation/execution pipeline
 *
 * Run: npx vite-node scripts/test-fallback.mjs
 */

import { createServer } from 'node:http';

let lastAllFailError = '';
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`${PASS} ${label}`);
  else { failures += 1; console.log(`${FAIL} ${label}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------------------------------------------ */
/* Scripted vendors                                                    */
/* ------------------------------------------------------------------ */

const GEMINI_PORT = 9941;
const COMPAT_PORT = 9942;

let geminiMode = 'ok';        // 'ok' | '429' | '503'
let geminiHits = 0;
let groqHits = 0;
let orHits = 0;

const KEY_GEMINI = 'AIza-SECRET-gemini-test-key';
const KEY_GROQ = 'gsk-SECRET-groq-test-key';
const KEY_OR = 'sk-or-SECRET-openrouter-test-key';

function agentJson(color, from) {
  return JSON.stringify({
    intent: { kind: 'modify-project', restatement: 'Recolour', domain: 'site', confidence: 0.9 },
    actions: [{ type: 'update_file', path: 'styles/main.css', content: `body { color: ${color}; } /* ${from} */\n`, reason: 'recolour' }],
    message: `Recoloured by ${from}.`,
  });
}

const geminiVendor = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    geminiHits += 1;
    if (geminiMode === '429') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20', status: 'RESOURCE_EXHAUSTED' } }));
      return;
    }
    if (geminiMode === '503') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.', status: 'UNAVAILABLE' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: agentJson('gemini-green', 'gemini') }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      model: 'gemini-3.6-flash',
    }));
  });
});

const compatVendor = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const isGroq = req.url?.startsWith('/groq');
    if (isGroq) groqHits += 1; else orHits += 1;
    const mode = isGroq ? groqMode : orMode;

    if (mode === '429') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: isGroq ? 'Rate limit reached for model' : 'Free-tier rate limit' } }));
      return;
    }
    if (mode === '500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'internal upstream error' } }));
      return;
    }

    const from = isGroq ? 'groq' : 'openrouter';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: agentJson(`${from}-blue`, from) } }],
      usage: { prompt_tokens: 90, completion_tokens: 40 },
      model: isGroq ? 'llama-3.3-70b-versatile' : 'meta-llama/llama-3.3-70b-instruct:free',
    }));
  });
});

/* ------------------------------------------------------------------ */
/* Real server pointed at the fake vendors                             */
/* ------------------------------------------------------------------ */

let groqMode = 'ok';   // 'ok' | '429' | '500'
let orMode = 'ok';

process.env.GEMINI_API_KEY = KEY_GEMINI;
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${GEMINI_PORT}/v1beta`;
process.env.GROQ_API_KEY = KEY_GROQ;
process.env.GROQ_BASE_URL = `http://127.0.0.1:${COMPAT_PORT}/groq/v1`;
process.env.OPENROUTER_API_KEY = KEY_OR;
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${COMPAT_PORT}/or/v1`;
process.env.AI_PROVIDER = 'gemini';
process.env.PORT = '9943';
process.env.RATE_LIMIT_PER_MINUTE = '0';
process.env.UPSTREAM_MAX_RETRIES = '2';
process.env.UPSTREAM_RETRY_BASE_MS = '1';
process.env.UPSTREAM_RETRY_BUDGET_MS = '3000';

const { server } = await import('../server/index.js');
await new Promise((r) => geminiVendor.listen(GEMINI_PORT, '127.0.0.1', r));
await new Promise((r) => compatVendor.listen(COMPAT_PORT, '127.0.0.1', r));
await new Promise((r) => server.listen(9943, '127.0.0.1', r));

const API = 'http://127.0.0.1:9943/api/agent';

globalThis.fetch = globalThis.fetch ?? (await import('node-fetch')).default;
const { LLMProvider } = await import('../src/services/ai/LLMProvider.ts');
const { FileManager } = await import('../src/services/FileManager.ts');

const files = () => [
  FileManager.create('index.html', '<h1>base</h1>\n', 'user'),
  FileManager.create('styles/main.css', 'body { color: red; }\n', 'user'),
];
const runGenerate = (overrides = {}) => new LLMProvider({
  baseUrl: API,
  provider: 'gemini',
  retryDelay5xxMs: 30,
  retryDelay429Ms: 60,
  ...overrides,
}).generate({
  prompt: 'recolour the page',
  files: files(),
  history: [],
  projectName: 'Fallback Test',
  diagnostics: [],
});
const reset = () => { geminiHits = 0; groqHits = 0; orHits = 0; geminiMode = 'ok'; groqMode = 'ok'; orMode = 'ok'; };

console.log('\n─── Chain configuration ─────────────────────────────');

const status = await (await fetch(`${API}/status`)).json();
check('chain order is gemini → groq → openrouter', JSON.stringify(status.chain) === JSON.stringify(['gemini', 'groq', 'openrouter']), JSON.stringify(status.chain));
check('all three providers reported configured', status.providers.filter((p) => p.configured).map((p) => p.id).join(',') === 'gemini,groq,openrouter');

console.log('\n─── 1. Gemini succeeds → Gemini only ────────────────');
{
  reset();
  const result = await runGenerate();
  check('response came from Gemini', geminiHits === 1 && groqHits === 0 && orHits === 0, `gemini:${geminiHits} groq:${groqHits} or:${orHits}`);
  check('no failover note in message', !result.message.includes('unavailable'));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('update applied by the normal pipeline', css?.content.includes('gemini-green'), css?.content);
}

console.log('\n─── 2. Gemini 429 → Groq succeeds ───────────────────');
{
  reset();
  geminiMode = '429';
  const result = await runGenerate();
  check('Gemini attempted exactly once (429 not in-function retried)', geminiHits === 1, `gemini:${geminiHits}`);
  check('Groq served the request', groqHits === 1 && orHits === 0, `groq:${groqHits} or:${orHits}`);
  check('UI note: "Gemini unavailable — using Groq"', result.message.includes('Gemini unavailable — using Groq'), result.message.slice(0, 120));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('Groq action validated and APPLIED', css?.content.includes('groq-blue'), css?.content);

  // Server-level contract: provider + failover exposed on the raw response
  const raw = await (await fetch(`${API}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'recolour again' }], provider: 'gemini' }),
  })).json();
  check('raw response names provider=groq', raw.provider === 'groq', raw.provider);
  check('raw response carries failover attempts', raw.failover?.length === 1 && raw.failover[0].provider === 'gemini' && raw.failover[0].status === 429);
}

console.log('\n─── 3. Gemini 503 (in-function retries exhausted) → Groq ──');
{
  reset();
  geminiMode = '503';
  const result = await runGenerate();
  check('Gemini bounded to 3 in-function attempts', geminiHits === 3, `gemini:${geminiHits}`);
  check('Groq served the request', groqHits === 1 && orHits === 0, `groq:${groqHits} or:${orHits}`);
  check('UI note shown', result.message.includes('Gemini unavailable — using Groq'));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('Groq action APPLIED', css?.content.includes('groq-blue'), css?.content);
}

console.log('\n─── 4. Gemini 503 + Groq 429 → OpenRouter Free ──────');
{
  reset();
  geminiMode = '503';
  groqMode = '429';
  const result = await runGenerate();
  check('OpenRouter served the request', orHits === 1, `or:${orHits}`);
  check('note: "Gemini unavailable — using Groq"', result.message.includes('Gemini unavailable — using Groq'));
  check('note: "Groq unavailable — using OpenRouter Free"', result.message.includes('Groq unavailable — using OpenRouter Free'));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('OpenRouter action validated and APPLIED', css?.content.includes('openrouter-blue'), css?.content);
}

console.log('\n─── 5. All providers fail → one clear error ─────────');
{
  reset();
  geminiMode = '503';
  groqMode = '429';
  orMode = '500';
  let threw = null;
  try {
    await runGenerate();
  } catch (e) {
    threw = e;
    lastAllFailError = e?.message ?? '';
  }
  check('run fails honestly (no silent success)', threw !== null);
  check('error code is ALL_PROVIDERS_FAILED', threw?.code === 'ALL_PROVIDERS_FAILED', threw?.code);
  check(
    'error explains all providers are temporarily unavailable',
    threw?.message.includes('All configured AI providers are temporarily unavailable'),
    threw?.message?.slice(0, 140),
  );
  check('error lists every attempted provider', threw?.message.includes('gemini (503)') && threw?.message.includes('groq (429)') && threw?.message.includes('openrouter (500)'), threw?.message?.slice(0, 200));
  check('failover is bounded (no endless retries)', geminiHits === 6 && groqHits === 2 && orHits === 6, `gemini:${geminiHits} groq:${groqHits} or:${orHits} (2 client attempts × chain; 500/503 retried in-function, 429 not)`);
}

console.log('\n─── 6. Security: keys never leave the server ────────');
{
  const statusText = JSON.stringify(status);
  const raw = await (await fetch(`${API}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], provider: 'gemini' }),
  }));
  const rawText = await raw.text();
  check('GEMINI key absent from /status', !statusText.includes(KEY_GEMINI));
  check('GROQ key absent from /status', !statusText.includes(KEY_GROQ));
  check('OPENROUTER key absent from /status', !statusText.includes(KEY_OR));
  check('keys absent from generate response', !rawText.includes(KEY_GEMINI) && !rawText.includes(KEY_GROQ) && !rawText.includes(KEY_OR));
  check('keys absent from all-providers-fail error text', !lastAllFailError.includes(KEY_GROQ) && !lastAllFailError.includes(KEY_OR) && !lastAllFailError.includes(KEY_GEMINI));
}

console.log('\n──────────────────────────────────────────────────────');
if (failures) {
  console.log(`${FAIL} ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`${PASS} All fallback regression checks passed.`);
process.exit(0);
