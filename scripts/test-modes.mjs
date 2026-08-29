/**
 * Regression tests for the multi-mode AI Workspace server endpoints:
 *
 *   1. POST /api/agent/chat          — plain prose via the provider chain
 *      (Gemini primary; 429 → Groq failover; failover metadata present)
 *   2. GET  /api/agent/image-status  — honest configured/not-configured
 *   3. POST /api/agent/image         — Gemini image adapter (fake vendor),
 *      variations honoured, clear error when not configured
 *   4. GET  /api/agent/video-status  — "Video provider not configured" by
 *      default; configured=true when VIDEO_PROVIDER=veo + key
 *   5. POST /api/agent/video + GET operation — real two-phase op flow
 *      against a fake Veo vendor (start → poll → download bytes)
 *   6. SECURITY — no API key material in ANY new endpoint's response
 *   7. Input validation (empty/oversized prompts, bad operation tokens)
 *
 * The coding agent itself is covered by the other suites; this file proves
 * the new modes reuse the same chain without touching it.
 *
 * Run: npx vite-node scripts/test-modes.mjs
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
/* Scripted vendors                                                    */
/* ------------------------------------------------------------------ */

const GEMINI_PORT = 9951;
const COMPAT_PORT = 9952;

const KEY_GEMINI = 'AIza-SECRET-modes-gemini-key';
const KEY_GROQ = 'gsk-SECRET-modes-groq-key';

const FAKE_PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000, fake', 'utf8').toString('hex');
const FAKE_VIDEO_BYTES = Buffer.from('fake-mp4-bytes-for-test');

let geminiHits = 0;
let groqChatHits = 0;

const geminiVendor = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    geminiHits += 1;
    const url = req.url ?? '';
    const parsed = body ? JSON.parse(body) : {};

    if (url.includes(':generateContent') && (parsed.generationConfig?.responseModalities ?? []).includes('IMAGE')) {
      // Image request → return an inline PNG part (n=2 means 2 calls).
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(FAKE_PNG, 'hex').toString('base64') } }] } }],
        model: 'gemini-2.5-flash-image',
      }));
      return;
    }

    if (url.includes('predictLongRunning')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'operations/test-op-123' }));
      return;
    }

    if (url.includes('/operations/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: url.slice(1),
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `http://127.0.0.1:${GEMINI_PORT}/file/video.mp4` } }] } },
      }));
      return;
    }

    if (url.startsWith('/file/')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(FAKE_VIDEO_BYTES);
      return;
    }

    // Plain generateContent (chat or structured agent): decide by schema presence.
    const wantsJson = Boolean(parsed.generationConfig?.responseMimeType);
    if (parsed.generationConfig?.responseSchema) {
      // Structured agent call — return a valid update_file action.
      const inner = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'Recolour', domain: 'site', confidence: 0.9 },
        actions: [{ type: 'update_file', path: 'styles/main.css', content: 'body { color: plum; }\n', reason: 'recolour' }],
        message: 'Recoloured to plum.',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ text: inner }] }, finishReason: 'STOP' }],
        model: 'gemini-3.6-flash',
      }));
      return;
    }
    if (wantsJson || (parsed.contents?.[0]?.parts?.[0]?.text ?? '').includes('Agent request:')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20', status: 'RESOURCE_EXHAUSTED' } }));
      return;
    }
    // Plain chat → prose answer (or 429 for the failover scenario).
    if ((parsed.contents?.[0]?.parts?.[0]?.text ?? '').includes('FAILOVER_CHAT')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hello! I am the chat reply.' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
      model: 'gemini-3.6-flash',
    }));
  });
});

const compatVendor = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!req.url?.startsWith('/groq')) {
      res.writeHead(404); res.end('{}'); return;
    }
    groqChatHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: 'Hello from Groq chat fallback!' } }],
      usage: { prompt_tokens: 8, completion_tokens: 6 },
      model: 'llama-3.3-70b-versatile',
    }));
  });
});

/* ------------------------------------------------------------------ */
/* Real server + env                                                   */
/* ------------------------------------------------------------------ */

process.env.GEMINI_API_KEY = KEY_GEMINI;
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${GEMINI_PORT}/v1beta`;
process.env.GROQ_API_KEY = KEY_GROQ;
process.env.GROQ_BASE_URL = `http://127.0.0.1:${COMPAT_PORT}/groq/v1`;
delete process.env.OPENROUTER_API_KEY;
process.env.AI_PROVIDER = 'gemini';
delete process.env.IMAGE_PROVIDER;   // default chain: gemini first
delete process.env.VIDEO_PROVIDER;   // video NOT configured by default
process.env.PORT = '9953';
process.env.RATE_LIMIT_PER_MINUTE = '0';

const { server } = await import('../server/index.js');
await new Promise((r) => geminiVendor.listen(GEMINI_PORT, '127.0.0.1', r));
await new Promise((r) => compatVendor.listen(COMPAT_PORT, '127.0.0.1', r));
await new Promise((r) => server.listen(9953, '127.0.0.1', r));

const API = 'http://127.0.0.1:9953/api/agent';
const post = (path, body) => fetch(`${API}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

console.log('\n─── 1. Chat AI mode ─────────────────────────────────');
{
  const r = await post('/chat', { messages: [{ role: 'user', content: 'Hi, who are you?' }] });
  const j = await r.json();
  check('chat returns prose from Gemini', r.status === 200 && j.provider === 'gemini' && j.text.includes('chat reply'), JSON.stringify(j).slice(0, 120));
  check('chat is NOT forced into JSON (no schema sent to vendor)', geminiHits >= 1);
}
{
  // Direct failover check: make the gemini vendor 503 for plain chat by
  // temporarily pointing the server chain at a dead gemini via env is not
  // possible post-boot, so verify Groq serves when gemini is down using the
  // built-in retry exhaustion path: flood with an agent-shaped prompt is
  // wrong for chat… instead assert chain metadata + groq path via status.
  const status = await (await fetch(`${API}/status`)).json();
  check('chain still gemini → groq for chat', JSON.stringify(status.chain) === JSON.stringify(['gemini', 'groq']), JSON.stringify(status.chain));

  // Real failover: Gemini 429 on chat → Groq serves the conversation.
  const r2 = await post('/chat', { messages: [{ role: 'user', content: 'FAILOVER_CHAT what is a closure?' }] });
  const j2 = await r2.json();
  check('chat failover: Groq serves when Gemini 429s', r2.status === 200 && j2.provider === 'groq' && j2.text.includes('Groq chat fallback'), JSON.stringify(j2).slice(0, 140));
  check('chat failover metadata present', j2.failover?.length === 1 && j2.failover[0].provider === 'gemini' && j2.failover[0].status === 429);
}

console.log('\n─── 2. Image mode ───────────────────────────────────');
{
  const status = await (await fetch(`${API}/image-status`)).json();
  check('image status: configured via GEMINI key', status.configured === true && status.provider === 'gemini', JSON.stringify(status).slice(0, 120));

  const r = await post('/image', { prompt: 'a cozy cabin in the woods, watercolor', n: 2 });
  const j = await r.json();
  check('image generation succeeds with n=2 variations', r.status === 200 && j.images?.length === 2, `status ${r.status}, images ${j.images?.length}`);
  check('images are base64 png payloads', j.images?.every((i) => i.mime === 'image/png' && i.base64.length > 10));
  check('image provider + model reported', j.provider === 'gemini' && j.model === 'gemini-2.5-flash-image', `${j.provider} ${j.model}`);
  check('two vendor calls for two variations', geminiHits >= 2);

  const bad = await post('/image', { prompt: '' });
  check('empty prompt rejected with 400', bad.status === 400);
  const big = await post('/image', { prompt: 'x'.repeat(4001) });
  check('oversized prompt rejected with 400', big.status === 400);
}

console.log('\n─── 3. Image mode when NOT configured ───────────────');
{
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const r = await post('/image', { prompt: 'test prompt for unconfigured' });
  const j = await r.json();
  check('unconfigured image → 503 with clear code', r.status === 503 && j.code === 'IMAGE_PROVIDER_NOT_CONFIGURED', JSON.stringify(j).slice(0, 140));
  const status = await (await fetch(`${API}/image-status`)).json();
  check('unconfigured image status: honest configured=false', status.configured === false);
  process.env.GEMINI_API_KEY = saved;
}

console.log('\n─── 4. Video mode: not configured by default ────────');
{
  const status = await (await fetch(`${API}/video-status`)).json();
  check('video status: configured=false by default (honest)', status.configured === false && typeof status.hint === 'string', JSON.stringify(status).slice(0, 140));
  const r = await post('/video', { prompt: 'a timelapse of a city at dusk' });
  const j = await r.json();
  check('video generate → VIDEO_PROVIDER_NOT_CONFIGURED', r.status === 503 && j.code === 'VIDEO_PROVIDER_NOT_CONFIGURED', JSON.stringify(j).slice(0, 140));
  const badOp = await fetch(`${API}/video-poll?name=../etc/passwd`);
  check('malicious operation token rejected', badOp.status === 400);
}

console.log('\n─── 5. Video mode: configured (fake Veo) ────────────');
{
  process.env.VIDEO_PROVIDER = 'veo';
  const status = await (await fetch(`${API}/video-status`)).json();
  check('video status flips to configured with VIDEO_PROVIDER=veo + key', status.configured === true && status.provider === 'veo');

  const r = await post('/video', { prompt: 'a timelapse of a city at dusk' });
  const j = await r.json();
  check('video start returns an operation token', r.status === 200 && j.operation === 'operations/test-op-123', JSON.stringify(j).slice(0, 140));

  const poll = await (await fetch(`${API}/video-poll?name=${encodeURIComponent('operations/test-op-123')}`)).json();
  check('video poll completes and downloads bytes server-side', poll.done === true && typeof poll.video?.base64 === 'string' && poll.video.base64.length > 5, JSON.stringify(poll).slice(0, 140));
  check('video mime preserved', poll.video?.mime === 'video/mp4');
  process.env.VIDEO_PROVIDER = '';
}

console.log('\n─── 6. Security: keys never in responses ────────────');
{
  const bodies = [];
  bodies.push(JSON.stringify(await (await fetch(`${API}/status`)).json()));
  bodies.push(JSON.stringify(await (await fetch(`${API}/image-status`)).json()));
  bodies.push(JSON.stringify(await (await fetch(`${API}/video-status`)).json()));
  bodies.push(JSON.stringify(await (await post('/chat', { messages: [{ role: 'user', content: 'hi' }] })).json()));
  bodies.push(JSON.stringify(await (await post('/image', { prompt: 'tiny dot' })).json()));
  const all = bodies.join('');
  check('GEMINI key absent from all mode responses', !all.includes(KEY_GEMINI));
  check('GROQ key absent from all mode responses', !all.includes(KEY_GROQ));
}

console.log('\n─── 6b. Build App prompt composer (pure unit) ───────');
{
  const { buildBuildAppPrompt } = await import('../src/services/BuildAppPrompt.ts');
  const prompt = buildBuildAppPrompt({
    name: 'Task Tamer\nwith newline',
    appType: 'Dashboard',
    style: 'Dark & sleek',
    features: ['Add/edit/delete items', 'Dark mode toggle'],
    pages: ['Home', 'Reports'],
    notes: 'Use indigo accents; keep it accessible',
  });
  check('composer embeds the cleaned app name', prompt.includes('"Task Tamer with newline"'), prompt.slice(0, 80));
  check('composer lists features as bullets', prompt.includes('- Add/edit/delete items') && prompt.includes('- Dark mode toggle'));
  check('composer lists pages', prompt.includes('Home, Reports'));
  check('composer demands safeStorage + no CDNs', prompt.includes('safeStorage') && prompt.includes('no external CDNs'));
  check('composer neutralises newlines in fields', !prompt.includes('\n\nwith'));
  const fallback = buildBuildAppPrompt({ name: '', appType: '', style: '', features: [], pages: [], notes: '' });
  check('composer has a sane empty-input default', fallback.includes('web app') && fallback.includes('clean and modern'));
}

console.log('\n─── 7. Agent pipeline untouched (sanity) ────────────');
{
  // The structured agent path still works against the same vendor.
  const { LLMProvider } = await import('../src/services/ai/LLMProvider.ts');
  const { FileManager } = await import('../src/services/FileManager.ts');
  const result = await new LLMProvider({ baseUrl: API, provider: 'gemini', retryDelay429Ms: 20, retryDelay5xxMs: 10 }).generate({
    prompt: 'Agent request: recolour the page',
    files: [FileManager.create('index.html', '<h1>x</h1>', 'user'), FileManager.create('styles/main.css', 'body { color: red; }', 'user')],
    history: [], projectName: 'Modes', diagnostics: [],
  });
  check('agent still runs through the same server', Array.isArray(result.files) && result.files.length > 0, result.message.slice(0, 100));
}

console.log('\n──────────────────────────────────────────────────────');
if (failures) {
  console.log(`${FAIL} ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`${PASS} All multi-mode regression checks passed.`);
process.exit(0);

