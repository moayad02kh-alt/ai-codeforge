/**
 * End-to-end verification of the live-LLM architecture — WITHOUT a real key.
 *
 * Starts a fake vendor that speaks the OpenAI wire format and returns
 * hand-written structured-action responses. This exercises the real code path:
 *
 *   LLMProvider → /api/agent/* → server adapter → (fake vendor)
 *     → JSON parse → action validation → ActionExecutor → file tree
 *
 * Everything except the model itself is production code. Run: npm run test:agent
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
/* 1. Fake vendor speaking the OpenAI wire format                      */
/* ------------------------------------------------------------------ */

let lastRequestBody = null;
let callCount = 0;

const FAKE_VENDOR_PORT = 9911;

const vendor = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastRequestBody = JSON.parse(body);
    callCount += 1;

    const userMsg = lastRequestBody.messages.find((m) => m.role === 'user')?.content ?? '';
    const isRepair = lastRequestBody.messages.some((m) =>
      m.content.includes('automatic repair subsystem'),
    );

    let payload;

    if (isRepair) {
      payload = JSON.stringify({
        analysis: 'The stylesheet has an unterminated rule block.',
        suggestion: 'Append the missing closing brace.',
        path: 'styles/main.css',
        content: 'body { color: red; }\n',
        confidence: 0.92,
      });
    } else if (userMsg.includes('NEEDS_INSPECT')) {
      // Turn 1: ask to read a file. Turn 2 (once the platform has fed the
      // contents back) : return the real edit. Keyed off whether the prompt
      // now carries the inspected file section.
      const gotInspection = userMsg.includes('Files you requested');
      payload = gotInspection
        ? JSON.stringify({
            intent: { kind: 'modify-project', restatement: 'Recolour', domain: 'site', confidence: 0.9 },
            plan: { summary: 'Update the accent colour.', tasks: [{ title: 'Recolour', targets: ['styles/main.css'] }] },
            actions: [
              { type: 'update_file', path: 'styles/main.css', content: 'body { color: emerald; }\n', reason: 'recolour' },
            ],
            message: 'Updated the accent colour.',
          })
        : JSON.stringify({
            intent: { kind: 'modify-project', restatement: 'Need to look first', domain: 'site', confidence: 0.8 },
            actions: [{ type: 'inspect_file', path: 'styles/main.css', reason: 'need current colours' }],
            message: 'Inspecting.',
          });
    } else if (userMsg.includes('MALICIOUS')) {
      // Path traversal + oversized + unknown type must all be rejected.
      payload = JSON.stringify({
        intent: { kind: 'modify-project', restatement: 'bad', domain: 'x', confidence: 0.5 },
        actions: [
          { type: 'update_file', path: '../../etc/passwd', content: 'pwned' },
          { type: 'create_file', path: '.env', content: 'OPENAI_API_KEY=stolen' },
          { type: 'create_file', path: '.git/config', content: 'x' },
          { type: 'delete_file', path: '/absolute/path' },
          { type: 'launch_missiles', path: 'x' },
          { type: 'create_file', path: 'good.js', content: 'console.info("ok");\n' },
        ],
        message: 'Attempted several actions.',
      });
    } else if (userMsg.includes('FENCED')) {
      // Model wraps JSON in a markdown fence + prose despite instructions.
      payload =
        'Sure! Here is the plan:\n\n```json\n' +
        JSON.stringify({
          intent: { kind: 'create-project', restatement: 'build', domain: 'site', confidence: 0.9 },
          actions: [{ type: 'create_file', path: 'index.html', content: '<h1>Hi</h1>\n' }],
          message: 'Created the page.',
        }) +
        '\n```\n\nLet me know if you need changes!';
    } else {
      payload = JSON.stringify({
        intent: { kind: 'create-project', restatement: 'Build a site', domain: 'site', confidence: 0.95 },
        plan: {
          summary: 'Create a minimal site.',
          tasks: [{ title: 'Create index.html', targets: ['index.html'] }],
        },
        actions: [
          { type: 'create_file', path: 'index.html', content: '<!doctype html><h1>Hello</h1>\n', reason: 'entry point' },
          { type: 'create_file', path: 'styles/main.css', content: 'body { margin: 0; }\n', reason: 'styles' },
          { type: 'run_check', check: 'static-analysis', reason: 'verify' },
        ],
        message: 'Created **2 files**.',
      });
    }

    const response = {
      choices: [{ message: { content: payload } }],
      usage: { prompt_tokens: 1200, completion_tokens: 340 },
      model: 'fake-model-1',
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
process.env.PORT = '9912';
process.env.RATE_LIMIT_PER_MINUTE = '0';

const { server } = await import('../server/index.js');

await new Promise((r) => vendor.listen(FAKE_VENDOR_PORT, '127.0.0.1', r));
await new Promise((r) => server.listen(9912, '127.0.0.1', r));

const API = 'http://127.0.0.1:9912/api/agent';

/* ------------------------------------------------------------------ */
/* 3. Import the real client-side modules                              */
/* ------------------------------------------------------------------ */

globalThis.fetch = globalThis.fetch ?? (await import('node-fetch')).default;

const { validateActions, ActionExecutor, isSafePath } = await import(
  '../src/services/ai/actions.ts'
);
const { ProjectContextManager } = await import('../src/services/ai/ProjectContext.ts');
const { parseAgentResponse, extractJson } = await import('../src/services/ai/prompts.ts');
const { LLMProvider } = await import('../src/services/ai/LLMProvider.ts');
const { FileManager } = await import('../src/services/FileManager.ts');

console.log('\n─── Backend & security ───────────────────────────────');

const status = await (await fetch(`${API}/status`)).json();
check('GET /status reports configured provider', status.configured === true);
check('Status names the active provider', status.activeProvider === 'openai');
check(
  'Status response contains NO api key',
  !JSON.stringify(status).includes('sk-test-fake-key'),
  JSON.stringify(status),
);

console.log('\n─── Path safety (validation layer) ───────────────────');

check('rejects parent traversal', !isSafePath('../../etc/passwd'));
check('rejects absolute path', !isSafePath('/etc/passwd'));
check('rejects .env', !isSafePath('.env'));
check('rejects nested .env', !isSafePath('config/.env.local'));
check('rejects .git internals', !isSafePath('.git/config'));
check('rejects node_modules', !isSafePath('node_modules/x/index.js'));
check('rejects windows drive', !isSafePath('C:\\evil.txt'));
check('rejects NUL byte', !isSafePath('a\0b.js'));
check('accepts normal path', isSafePath('src/components/App.tsx'));

console.log('\n─── JSON extraction robustness ───────────────────────');

check('parses bare JSON', extractJson('{"a":1}').a === 1);
check('parses fenced JSON', extractJson('```json\n{"a":2}\n```').a === 2);
check('parses JSON with prose around it', extractJson('Sure!\n{"a":3}\nDone.').a === 3);
check(
  'handles braces inside strings',
  extractJson('{"code":"function(){ return {}; }","a":4}').a === 4,
);
check(
  'handles escaped quotes',
  extractJson('{"s":"he said \\"hi\\"","a":5}').a === 5,
);

console.log('\n─── Project context manager ──────────────────────────');

const files = [
  FileManager.create('index.html', '<html>\n<body>x</body>\n</html>', 'agent'),
  FileManager.create('styles/main.css', 'body{color:red}\n'.repeat(50), 'agent'),
  FileManager.create('scripts/app.js', 'console.info(1)\n', 'agent'),
  FileManager.create('README.md', '# docs\n'.repeat(200), 'agent'),
  FileManager.create('node_modules/dep/index.js', 'junk\n'.repeat(500), 'agent'),
];

const ctx = ProjectContextManager.build(files, 'change the css colours', {
  entryPath: 'index.html',
});
const paths = ctx.files.map((f) => f.path);
check('excludes node_modules', !paths.some((p) => p.includes('node_modules')));
check('includes the prompt-relevant css file', paths.includes('styles/main.css'));
check('includes the entry point', paths.includes('index.html'));
check('renders a prompt block', ctx.render().includes('--- FILE: index.html'));

const tiny = ProjectContextManager.build(files, 'css', { maxTokens: 120, entryPath: 'index.html' });
check(
  'respects a tight token budget',
  tiny.estimatedTokens <= 200 && tiny.omitted.length > 0,
  `tokens=${tiny.estimatedTokens} omitted=${tiny.omitted.length}`,
);

const empty = ProjectContextManager.build([], 'build a site');
check('describes an empty project', empty.render().includes('EMPTY'));

console.log('\n─── Action validation ────────────────────────────────');

const { valid, rejected } = validateActions([
  { type: 'create_file', path: 'a.js', content: 'x' },
  { type: 'update_file', path: '../escape.js', content: 'x' },
  { type: 'create_file', path: 'huge.js', content: 'x'.repeat(600 * 1024) },
  { type: 'nonsense', path: 'a.js' },
  { type: 'rename_file', from: 'a.js', to: 'b.js' },
  { type: 'run_check', check: 'tests' },
  { type: 'run_check', check: 'rm -rf /' },
]);
check('accepts 3 valid actions', valid.length === 3, `got ${valid.length}`);
check('rejects 4 bad actions', rejected.length === 4, `got ${rejected.length}`);
check('rejects oversized content', rejected.some((r) => r.reason.includes('byte limit')));
check('rejects unknown check value', rejected.some((r) => r.reason.includes('Unknown check')));

console.log('\n─── Action executor ──────────────────────────────────');

const base = [FileManager.create('old.js', 'let a = 1;\n', 'agent')];
const exec = ActionExecutor.execute(base, [
  { type: 'create_file', path: 'new.js', content: 'let b = 2;\n' },
  { type: 'rename_file', from: 'old.js', to: 'renamed.js' },
  { type: 'update_file', path: 'renamed.js', content: 'let a = 99;\n' },
  { type: 'inspect_file', path: 'new.js' },
  { type: 'run_check', check: 'build' },
  { type: 'delete_file', path: 'ghost.js' },
]);
const execPaths = exec.files.map((f) => f.path).sort();
check('created the new file', execPaths.includes('new.js'));
check('renamed the old file', execPaths.includes('renamed.js') && !execPaths.includes('old.js'));
check(
  'updated content after rename',
  exec.files.find((f) => f.path === 'renamed.js')?.content === 'let a = 99;\n',
);
check('recorded the inspection', exec.inspections[0]?.path === 'new.js' && exec.inspections[0].found);
check('recorded the requested check', exec.checks.includes('build'));
check('skipped deleting a nonexistent file', exec.skipped.length === 1);

console.log('\n─── LLMProvider: full round trip ─────────────────────');

const provider = new LLMProvider({ baseUrl: API });

const probe = await LLMProvider.probe(API);
check('probe detects configured backend', probe?.configured === true);

const genCtx = { prompt: 'Build a site', files: [], history: [], projectName: 'Test' };
const intent = await provider.classifyIntent(genCtx);
const plan = await provider.createPlan(genCtx, intent);
const result = await provider.generate(genCtx, plan);

check('intent parsed from model', intent.kind === 'create-project');
check('plan parsed from model', plan.tasks.length >= 1);
check('generated 2 files', result.files.length === 2, `got ${result.files.length}`);
check('usage telemetry surfaced', result.usage?.promptTokens === 1200);
check(
  'ONE model call for intent+plan+generate',
  callCount === 1,
  `made ${callCount} calls — caching is broken`,
);
check(
  'system prompt was actually sent',
  lastRequestBody.messages.some(
    (m) => m.role === 'system' && m.content.includes('STRUCTURED ACTIONS'),
  ),
);
check(
  'project context block was sent',
  lastRequestBody.messages.some((m) => m.role === 'user' && m.content.includes('## Current file tree')),
);

console.log('\n─── Malicious action rejection (live path) ───────────');

callCount = 0;
const evilResult = await provider.generate({
  prompt: 'MALICIOUS',
  files: [],
  history: [],
  projectName: 'Test',
});
check('only the safe file was written', evilResult.files.length === 1, JSON.stringify(evilResult.files.map((f) => f.path)));
check('safe file is the expected one', evilResult.files[0]?.path === 'good.js');
check('user is told actions were rejected', evilResult.message.includes('rejected'));
check('no traversal path present', !JSON.stringify(evilResult.files).includes('etc/passwd'));
check('no .env written', !evilResult.files.some((f) => f.path.includes('.env')));

console.log('\n─── inspect_file multi-turn loop ─────────────────────');

callCount = 0;
const inspectResult = await provider.generate({
  prompt: 'NEEDS_INSPECT',
  files: [FileManager.create('styles/main.css', 'body { color: red; }\n', 'agent')],
  history: [],
  projectName: 'Test',
});
check('looped after inspect_file', callCount === 2, `made ${callCount} calls`);
check('applied edits from the second turn', inspectResult.files.length === 1);
check(
  'second turn received inspected contents',
  lastRequestBody.messages.some((m) => m.content.includes('Files you requested')),
);

console.log('\n─── Fenced-JSON tolerance (live path) ────────────────');

const fenced = await provider.generate({
  prompt: 'FENCED',
  files: [],
  history: [],
  projectName: 'Test',
});
check('parsed JSON wrapped in prose + fence', fenced.files.length === 1);
check('extracted correct content', fenced.files[0]?.content.includes('<h1>Hi</h1>'));

console.log('\n─── Repair path ──────────────────────────────────────');

const repair = await provider.proposeRepair(
  {
    prompt: 'fix',
    files: [FileManager.create('styles/main.css', 'body { color: red;\n', 'agent')],
    history: [],
    projectName: 'Test',
  },
  { message: 'Unbalanced braces', file: 'styles/main.css', line: 1, code: 'CF1001' },
);
check('repair returns analysis', repair.analysis.includes('unterminated'));
check('repair returns fixed content', repair.content === 'body { color: red; }\n');
check('repair reports confidence', repair.confidence === 0.92);

console.log('\n─── Agent receives full context (wire-level) ─────────');

// Everything the coding agent is required to send the model must be visible in
// the bytes that actually reach the vendor, not merely present in the types.
const brokenCss = FileManager.create('styles/main.css', 'body { color: red;\n', 'agent');
const entry = FileManager.create('index.html', '<link rel="stylesheet" href="styles/main.css">', 'agent');
await provider.generate({
  prompt: 'tidy up the stylesheet',
  files: [entry, brokenCss],
  history: [{ role: 'user', content: 'EARLIER_TURN_MARKER' }],
  projectName: 'Test',
  diagnostics: [
    { id: 'd1', code: 'CF1001', severity: 'error', message: 'Unbalanced braces', file: 'styles/main.css', line: 1, column: 1, repairable: true, source: 'static' },
  ],
});

const wire = JSON.stringify(lastRequestBody.messages);
check('user request reached the model', wire.includes('tidy up the stylesheet'));
check('project structure reached the model', wire.includes('index.html') && wire.includes('styles/main.css'));
check('relevant file CONTENTS reached the model', wire.includes('body { color: red;'));
check('diagnostics reached the model', wire.includes('Active diagnostics') && wire.includes('CF1001'));
check('diagnostic message reached the model', wire.includes('Unbalanced braces'));
check('previous agent context reached the model', wire.includes('EARLIER_TURN_MARKER'));
check('no secret material on the wire', !/sk-[A-Za-z0-9_-]{10,}/.test(wire));

console.log('\n─── Error handling / fallback ────────────────────────');

const deadProbe = await LLMProvider.probe('http://127.0.0.1:9999/nope');
check('probe returns null when backend is down', deadProbe === null);

const noKeyRes = await fetch(`${API}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [] }),
});
check('rejects empty messages array with 400', noKeyRes.status === 400);

/* ------------------------------------------------------------------ */

vendor.close();
server.close();

console.log(
  failures === 0
    ? `\n\x1b[32mAll checks passed.\x1b[0m\n`
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
