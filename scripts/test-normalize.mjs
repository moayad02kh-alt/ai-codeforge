/**
 * Regression tests for the "All actions were rejected by validation:
 * Missing 'content' string." bug.
 *
 * Boots a scripted fake vendor + the REAL server, then drives the REAL
 * client pipeline (LLMProvider → parse → normalise → validate → execute)
 * against malformed model responses:
 *
 *   1. update_file with NO content            → inspect_file retry → applied
 *   2. content under alias key ("code")       → recovered → applied
 *   3. content as object ({text})             → unwrapped → applied
 *   4. content as array of lines              → joined → applied
 *   5. write_file / filePath aliases          → mapped → applied
 *   6. create_file without content            → one corrective retry → applied
 *   7. hopeless actions                       → bounded retry then informative throw
 *   8. security: unsafe paths still rejected (with bounded retry)
 *   9. conversational turn: empty actions never triggers a retry
 *
 * Run: npx vite-node scripts/test-normalize.mjs
 */

import { createServer } from 'node:http';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`${PASS} ${label}`);
  } else {
    failures += 1;
    console.log(`${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Scripted fake vendor (OpenAI wire format)                        */
/* ------------------------------------------------------------------ */

const FAKE_VENDOR_PORT = 9921;
const calls = []; // markers of what the vendor was asked per call

const vendor = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body);
    const userMsg = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
    const gotInspection = userMsg.includes('Files you requested');
    const gotCorrection = userMsg.includes('Correction required for your previous response');

    let payload;
    let marker = 'unknown';

    if (userMsg.includes('VENDOR:MISSING_CONTENT')) {
      // The EXACT production bug: update_file with no content field at all.
      // Turn 1 → malformed update. Turn 2 (file fed back) → proper update.
      marker = gotCorrection ? 'retry' : gotInspection ? 'second' : 'first';
      payload =
        marker === 'first'
          ? JSON.stringify({
              intent: { kind: 'modify-project', restatement: 'Recolour', domain: 'site', confidence: 0.9 },
              actions: [{ type: 'update_file', path: 'styles/main.css', reason: 'recolour the page' }],
              message: 'Updating the colour.',
            })
          : JSON.stringify({
              intent: { kind: 'modify-project', restatement: 'Recolour', domain: 'site', confidence: 0.9 },
              actions: [{ type: 'update_file', path: 'styles/main.css', content: 'body { color: emerald; }\n', reason: 'recolour' }],
              message: 'Updated the accent colour.',
            });
    } else if (userMsg.includes('VENDOR:ALIAS_CODE')) {
      payload = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'Add log', domain: 'site', confidence: 0.9 },
        actions: [{ type: 'update_file', path: 'scripts/main.js', code: 'console.warn("alias works");\n' }],
        message: 'Updated the script.',
      });
      marker = 'first';
    } else if (userMsg.includes('VENDOR:OBJ_CONTENT')) {
      payload = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'Edit css', domain: 'site', confidence: 0.9 },
        actions: [{ type: 'update_file', path: 'styles/main.css', content: { text: 'body { color: teal; }\n' } }],
        message: 'Updated the css.',
      });
      marker = 'first';
    } else if (userMsg.includes('VENDOR:ARR_CONTENT')) {
      payload = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'Edit css', domain: 'site', confidence: 0.9 },
        actions: [{ type: 'update_file', path: 'styles/main.css', content: ['body {', '  color: purple;', '}\n'] }],
        message: 'Updated the css.',
      });
      marker = 'first';
    } else if (userMsg.includes('VENDOR:TYPE_ALIAS')) {
      payload = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'Edit js', domain: 'site', confidence: 0.9 },
        actions: [{ type: 'write_file', filePath: 'scripts/main.js', content: 'export const ok = true;\n' }],
        message: 'Updated the js.',
      });
      marker = 'first';
    } else if (userMsg.includes('VENDOR:RETRY_FIX')) {
      marker = gotCorrection ? 'retry' : 'first';
      payload =
        marker === 'first'
          ? JSON.stringify({
              intent: { kind: 'create-project', restatement: 'New page', domain: 'site', confidence: 0.9 },
              actions: [{ type: 'create_file', path: 'about.html', reason: 'new page' }],
              message: 'Creating the page.',
            })
          : JSON.stringify({
              intent: { kind: 'create-project', restatement: 'New page', domain: 'site', confidence: 0.9 },
              actions: [{ type: 'create_file', path: 'about.html', content: '<h1>About</h1>\n', reason: 'new page' }],
              message: 'Created the page.',
            });
    } else if (userMsg.includes('VENDOR:HOPELESS')) {
      payload = JSON.stringify({
        intent: { kind: 'create-project', restatement: 'New page', domain: 'site', confidence: 0.9 },
        actions: [{ type: 'create_file', path: 'broken.html', reason: 'no content, ever' }],
        message: 'Still refusing to include content.',
      });
      marker = gotCorrection ? 'retry' : 'first';
    } else if (userMsg.includes('VENDOR:MALICIOUS')) {
      payload = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'bad', domain: 'x', confidence: 0.5 },
        actions: [{ type: 'update_file', path: '../../etc/passwd', content: 'pwned' }],
        message: 'Attempted traversal.',
      });
      marker = gotCorrection ? 'retry' : 'first';
    } else if (userMsg.includes('VENDOR:CHAT')) {
      payload = JSON.stringify({
        intent: { kind: 'chat', restatement: 'hello', domain: 'chat', confidence: 0.9 },
        actions: [],
        message: 'Hello! How can I help?',
      });
      marker = 'first';
    }

    calls.push(marker);
    const response = {
      choices: [{ message: { content: payload } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      model: 'fake-model-normalize',
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
});

/* ------------------------------------------------------------------ */
/* 2. Point the real server at the fake vendor                         */
/* ------------------------------------------------------------------ */

process.env.OPENAI_API_KEY = 'sk-test-fake-key-for-local-verification';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${FAKE_VENDOR_PORT}/v1`;
process.env.AI_PROVIDER = 'openai';
process.env.PORT = '9922';
process.env.RATE_LIMIT_PER_MINUTE = '0';

const { server } = await import('../server/index.js');
await new Promise((r) => vendor.listen(FAKE_VENDOR_PORT, '127.0.0.1', r));
await new Promise((r) => server.listen(9922, '127.0.0.1', r));

const API = 'http://127.0.0.1:9922/api/agent';

/* ------------------------------------------------------------------ */
/* 3. Real client modules                                              */
/* ------------------------------------------------------------------ */

globalThis.fetch = globalThis.fetch ?? (await import('node-fetch')).default;

const { validateActions, normalizeActions, ActionExecutor } = await import('../src/services/ai/actions.ts');
const { parseAgentResponse } = await import('../src/services/ai/prompts.ts');
const { LLMProvider } = await import('../src/services/ai/LLMProvider.ts');
const { FileManager } = await import('../src/services/FileManager.ts');

const baseFiles = () => [
  FileManager.create('index.html', '<!doctype html><html><body>base</body></html>\n', 'user'),
  FileManager.create('styles/main.css', 'body { color: red; }\n', 'user'),
  FileManager.create('scripts/main.js', 'console.log("base");\n', 'user'),
];

const ctxFor = (prompt) => ({
  prompt,
  files: baseFiles(),
  history: [],
  projectName: 'Normalize Test',
  diagnostics: [],
});

const provider = () => new LLMProvider({ baseUrl: API, provider: 'openai', label: 'fake' });

console.log('\n─── Unit: normalizeActions ───────────────────────────');

// Alias recovery
let n = normalizeActions([{ type: 'update_file', path: 'a.js', code: 'x()' }]);
check('recovers content from "code" alias key', n.actions[0].content === 'x()');
check('notes alias recovery', n.notes.some((s) => s.includes('code')));

// Object content unwrap
n = normalizeActions([{ type: 'create_file', path: 'a.html', content: { text: '<b>hi</b>' } }]);
check('unwraps object content {text}', n.actions[0].content === '<b>hi</b>');

// Array content join
n = normalizeActions([{ type: 'create_file', path: 'a.css', content: ['a{', 'b:c', '}'] }]);
check('joins array content with newlines', n.actions[0].content === 'a{\nb:c\n}');

// Type + path aliases
n = normalizeActions([{ type: 'write_file', filePath: 'x.js', content: 'let a;' }]);
check('maps write_file → update_file', n.actions[0].type === 'update_file');
check('maps filePath → path', n.actions[0].path === 'x.js');

// Missing content on update → inspect_file conversion
n = normalizeActions(
  [{ type: 'update_file', path: 'styles/main.css', reason: 'recolour' }],
  [{ path: 'styles/main.css' }],
);
check('converts contentless update_file → inspect_file', n.actions[0].type === 'inspect_file');
check('conversion keeps the target path', n.actions[0].path === 'styles/main.css');

// create_file without content is left for validation (no safe fallback)
n = normalizeActions([{ type: 'create_file', path: 'new.html' }]);
check('create_file without content left for validator', n.actions[0].type === 'create_file' && n.actions[0].content === undefined);

// Normal actions pass through untouched
const good = { type: 'update_file', path: 'a.js', content: 'ok' };
n = normalizeActions([{ ...good }]);
check('valid action unchanged', n.actions[0].content === 'ok' && n.notes.length === 0);

// Parser tolerance: object content no longer throws
let parsedOk = true;
try {
  parseAgentResponse(
    JSON.stringify({ intent: { kind: 'modify-project' }, actions: [{ type: 'update_file', path: 'a.js', content: { text: 'x' } }], message: 'm' }),
  );
} catch {
  parsedOk = false;
}
check('parseAgentResponse no longer throws on object content', parsedOk);

console.log('\n─── End-to-end: malformed Gemini responses ───────────');

// 1. The exact reported bug: update_file without content.
{
  const p = provider();
  const result = await p.generate(ctxFor('VENDOR:MISSING_CONTENT recolour the page'));
  check('missing-content run completes without error', !result.message.includes('rejected by validation'), result.message.slice(0, 120));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('missing-content update_file eventually APPLIED', css?.content === 'body { color: emerald; }\n', css?.content);
  check('run notes explain the recovery', result.message.includes('inspect_file'), '');
}

// 2. Alias key content
{
  const result = await provider().generate(ctxFor('VENDOR:ALIAS_CODE add a warning log'));
  const js = result.files.find((f) => f.path === 'scripts/main.js');
  check('alias "code" content recovered and APPLIED', js?.content === 'console.warn("alias works");\n', js?.content);
}

// 3. Object content
{
  const result = await provider().generate(ctxFor('VENDOR:OBJ_CONTENT make it teal'));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('object content unwrapped and APPLIED', css?.content === 'body { color: teal; }\n', css?.content);
}

// 4. Array content
{
  const result = await provider().generate(ctxFor('VENDOR:ARR_CONTENT make it purple'));
  const css = result.files.find((f) => f.path === 'styles/main.css');
  check('array content joined and APPLIED', css?.content === 'body {\n  color: purple;\n}\n', JSON.stringify(css?.content));
}

// 5. Type + path aliases
{
  const result = await provider().generate(ctxFor('VENDOR:TYPE_ALIAS export a flag'));
  const js = result.files.find((f) => f.path === 'scripts/main.js');
  check('write_file/filePath aliases mapped and APPLIED', js?.content === 'export const ok = true;\n', js?.content);
}

// 6. Unrecoverable first response → corrective retry succeeds
{
  const before = calls.length;
  const result = await provider().generate(ctxFor('VENDOR:RETRY_FIX create an about page'));
  const html = result.files.find((f) => f.path === 'about.html');
  check('corrective retry recovers create_file without content', html?.content === '<h1>About</h1>\n', html?.content);
  check('corrective retry used exactly one extra model call', calls.length - before === 2, `calls: ${calls.length - before}`);
}

// 7. Hopeless responses → bounded (2 calls), informative error
{
  const before = calls.length;
  let threw = null;
  try {
    await provider().generate(ctxFor('VENDOR:HOPELESS make a broken page'));
  } catch (e) {
    threw = e;
  }
  check('hopeless run still fails (no silent success)', threw !== null);
  check('error mentions corrective retry was attempted', threw?.message.includes('corrective retry'), threw?.message?.slice(0, 120));
  check('retry is bounded to one extra call', calls.length - before === 2, `calls: ${calls.length - before}`);
}

// 8. Security regression: unsafe paths still rejected, never applied
{
  let threw = null;
  try {
    await provider().generate(ctxFor('VENDOR:MALICIOUS do bad things'));
  } catch (e) {
    threw = e;
  }
  check('unsafe path still rejected after normalisation', threw !== null);
  check('unsafe path error mentions validation', threw?.message.includes('rejected by validation'), threw?.message?.slice(0, 120));
}

// 9. Conversational turns: no retry, single call, no error
{
  const before = calls.length;
  const result = await provider().generate(ctxFor('VENDOR:CHAT hello there'));
  check('conversational turn succeeds with empty actions', result.message === 'Hello! How can I help?');
  check('conversational turn made exactly one model call', calls.length - before === 1, `calls: ${calls.length - before}`);
}

// 10. Validation layer untouched: direct validator still rejects missing content
{
  const { valid, rejected } = validateActions([{ type: 'update_file', path: 'a.js' }]);
  check('validator still rejects un-normalised missing content', valid.length === 0 && rejected[0].reason.includes('content'));
}

console.log('\n──────────────────────────────────────────────────────');
if (failures) {
  console.log(`${FAIL} ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log(`${PASS} All normalisation checks passed.`);
}
process.exit(0);
