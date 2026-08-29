/**
 * Core-flow regression tests: version history + rollback, error detection,
 * preview bundling — the platform features that must never silently break.
 * Run: npx vite-node scripts/test-core-flows.mjs
 */

const { FileManager } = await import('/home/user/ai-codeforge/src/services/FileManager.ts');
const { VersionManager } = await import('/home/user/ai-codeforge/src/services/VersionManager.ts');
const { ErrorDetector } = await import('/home/user/ai-codeforge/src/services/ErrorDetector.ts');
const { CodeRunner } = await import('/home/user/ai-codeforge/src/services/CodeRunner.ts');
const PASS='\x1b[32m✓\x1b[0m', FAIL='\x1b[31m✗\x1b[0m'; let fails=0;
const check=(l,c,d='')=>{ if(c) console.log(`${PASS} ${l}`); else { fails++; console.log(`${FAIL} ${l} ${d}`);} };

let files = [FileManager.create('index.html', '<h1>v1</h1>', 'user')];
const v1 = VersionManager.snapshot({ projectId: 'proj1', label: 'initial', description: 'first', origin: 'agent', files });
files = FileManager.applyChanges(files, [{ path: 'index.html', content: '<h1>v2</h1>' }]).files;
const v2 = VersionManager.snapshot({ projectId: 'proj1', label: 'second', description: 'edit', origin: 'agent', files });
const history = VersionManager.append([], v1);
const restored = VersionManager.restore([...history, v2], v1.id);
check('rollback (VersionManager.restore) returns prior file content', restored?.[0]?.content === '<h1>v1</h1>', restored?.[0]?.content);
check('unknown version id restores null (honest failure)', VersionManager.restore(history, 'ver-nope') === null);

// CF2001 unbalanced braces — one of the detector's documented real checks.
const broken = FileManager.create('scripts/bad.js', 'function f() {\n  return 1;\n', 'agent');
const clean = FileManager.create('scripts/ok.js', 'function g() {\n  return 2;\n}\n', 'user');
const diags = ErrorDetector.analyze([broken, clean]);
check('error detector flags unbalanced braces (CF2001)', diags.some(d => d.severity === 'error' && d.file === 'scripts/bad.js' && d.code === 'CF2001'), JSON.stringify(diags).slice(0,140));
check('error detector stays quiet on clean files', !diags.some(d => d.file === 'scripts/ok.js' && d.severity === 'error'));

const run = CodeRunner.bundle([
  FileManager.create('index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"></head><body><div id=app></div><script src="scripts/main.js"></script></body></html>', 'user'),
  FileManager.create('styles/main.css', 'body{color:#333}', 'user'),
  FileManager.create('scripts/main.js', 'console.log("preview");', 'user'),
], 'index.html');
check('preview bundle inlines css+js into one html', run.includes('<style') && run.includes('<script') && !run.includes('styles/main.css"></'), run.slice(0,120));

console.log(fails ? `${FAIL} ${fails} core-flow check(s) failed` : `${PASS} All core-flow checks passed.`);
process.exit(fails?1:0);
