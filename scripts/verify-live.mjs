/**
 * verify-live.mjs — real end-to-end production verification.
 *
 * Drives the REAL client pipeline (LLMProvider -> parse -> normalise ->
 * validate -> execute) against a DEPLOYED CodeForge backend, which calls the
 * real vendor server-side. Verifies a simple, harmless file modification is
 * accepted and actually applied — i.e. the Agent completes without
 * "Run failed".
 *
 * Usage:
 *   LIVE_BASE=https://ai-codeforge-ruby.vercel.app/api/agent \
 *   npx vite-node scripts/verify-live.mjs
 *
 * NOTE: run sparingly — each attempt consumes vendor quota (Gemini free tier
 * allows only 20 requests/min). If you hit a 429, wait for the quota window.
 */

globalThis.fetch = globalThis.fetch ?? (await import('node-fetch')).default;
const { LLMProvider } = await import('../src/services/ai/LLMProvider.ts');
const { FileManager } = await import('../src/services/FileManager.ts');
const files = [
  FileManager.create('index.html', '<!doctype html>\n<html><body>\n  <p>greeting: hello world</p>\n</body></html>\n', 'user'),
  FileManager.create('styles/main.css', 'p { color: black; }\n', 'user'),
];
try {
  const r = await new LLMProvider({ baseUrl: 'https://ai-codeforge-ruby.vercel.app/api/agent', provider: 'gemini' }).generate({
    prompt: 'In index.html, change the text "hello world" to "hello forge". Change nothing else. Keep the file small.',
    files, history: [], projectName: 'Final E2E', diagnostics: [],
  });
  const html = r.files.find((f) => f.path === 'index.html');
  console.log('E2E OK — no "Run failed"');
  console.log('changed files:', r.files.map((f) => f.path).join(', '));
  console.log('update applied:', html ? (html.content.includes('hello forge') && !html.content.includes('hello world') ? 'YES' : 'NO — ' + html.content.slice(0, 120)) : 'MISSING');
  console.log('agent message:', r.message.slice(0, 120).replace(/\n/g, ' '));
  process.exit(0);
} catch (e) {
  console.log('E2E FAILED:', (e.code ?? '') , e.message.slice(0, 150).replace(/\n/g, ' '));
  process.exit(1);
}
