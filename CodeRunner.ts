/**
 * CodeRunner — builds a preview bundle and simulates a test run.
 *
 * PREVIEW (real): `bundle()` inlines the project's CSS and JS into its HTML
 * entry and returns a single document. The UI renders it in a *sandboxed*
 * iframe (`allow-scripts` only, no same-origin), so generated code cannot
 * reach the parent app, its storage, or the network. This is genuine
 * execution of the generated front-end, isolated by the browser.
 *
 * TESTS (simulated): `runTests()` does NOT execute the Vitest files. It
 * derives plausible results from static analysis. Wiring a real runner means
 * replacing `runTests()` with a call to a server-side container.
 */

import type { ConsoleEntry, Diagnostic, ProjectFile, RunResult, TestResult } from '../core/types';
import { jitter, sleep, uid } from '../core/utils';
import { ErrorDetector } from './ErrorDetector';
import { FileManager } from './FileManager';

/** Console bridge injected into the preview document. */
const CONSOLE_BRIDGE = `
<script>
(function () {
  var post = function (level, args) {
    try {
      parent.postMessage({
        __codeforge: true, level: level,
        message: Array.prototype.map.call(args, function (a) {
          if (a instanceof Error) return a.message;
          if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch (e) { return String(a); } }
          return String(a);
        }).join(' ')
      }, '*');
    } catch (e) {}
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () { post(level, arguments); original.apply(console, arguments); };
  });
  window.addEventListener('error', function (e) {
    post('error', [e.message + ' (' + (e.filename || 'inline') + ':' + e.lineno + ')']);
  });
  window.addEventListener('unhandledrejection', function (e) {
    post('error', ['Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)]);
  });
})();
</script>
`;

export class CodeRunner {
  /**
   * Produces a self-contained HTML document with all local assets inlined,
   * because the sandboxed iframe has no server to fetch them from.
   */
  static bundle(files: ProjectFile[], entryPath = 'index.html'): string {
    const entry =
      FileManager.find(files, entryPath) ?? files.find((f) => f.language === 'html');

    if (!entry) {
      return CodeRunner.placeholder(
        'No HTML entry point',
        'This project has no <code>index.html</code>. Ask the agent to create one, or open a file to edit it directly.',
      );
    }

    let html = entry.content;

    // Inline <link rel="stylesheet" href="...">
    html = html.replace(
      /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
      (match, href: string) => {
        if (/^https?:/i.test(href)) return match;
        const file = FileManager.find(files, href.replace(/^\.\//, '').replace(/^\//, ''));
        return file ? `<style data-src="${file.path}">\n${file.content}\n</style>` : match;
      },
    );
    // Also handle href-before-rel ordering.
    html = html.replace(
      /<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi,
      (match, href: string) => {
        if (match.includes('<style') || /^https?:/i.test(href)) return match;
        const file = FileManager.find(files, href.replace(/^\.\//, '').replace(/^\//, ''));
        return file ? `<style data-src="${file.path}">\n${file.content}\n</style>` : match;
      },
    );

    // Inline <script src="...">
    html = html.replace(
      /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
      (match, src: string) => {
        if (/^https?:/i.test(src)) return match;
        const file = FileManager.find(files, src.replace(/^\.\//, '').replace(/^\//, ''));
        return file ? `<script data-src="${file.path}">\n${file.content}\n</script>` : match;
      },
    );

    // Install the console bridge first so early errors are captured.
    html = html.includes('<head>')
      ? html.replace('<head>', `<head>\n${CONSOLE_BRIDGE}`)
      : `${CONSOLE_BRIDGE}\n${html}`;

    return html;
  }

  static placeholder(title: string, body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{height:100%;margin:0}
      body{display:grid;place-items:center;background:#0b0d12;color:#7d8595;
        font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;padding:40px}
      .w{max-width:420px}
      h2{color:#c8cdd9;font-size:17px;font-weight:600;margin:0 0 10px}
      p{font-size:14px;line-height:1.65;margin:0}
      code{background:rgba(255,255,255,.07);padding:2px 6px;border-radius:4px;font-size:12.5px}
    </style></head><body><div class="w"><h2>${title}</h2><p>${body}</p></div></body></html>`;
  }

  /**
   * Simulated test execution.
   *
   * Derives results from the project's real test files and real static
   * diagnostics, so a broken project genuinely produces failures.
   */
  static async runTests(files: ProjectFile[]): Promise<TestResult[]> {
    const testFiles = files.filter((f) => /\.test\.[jt]sx?$/.test(f.path) || f.path.startsWith('tests/'));
    const diagnostics = ErrorDetector.analyze(files);
    const hasBlockingError = diagnostics.some((d) => d.severity === 'error');
    const results: TestResult[] = [];

    for (const file of testFiles) {
      const suite = file.path.split('/').pop() ?? file.path;
      // Parse real `it('...')` / `test('...')` names out of the file.
      const names = Array.from(file.content.matchAll(/\b(?:it|test)\(\s*['"`]([^'"`]+)['"`]/g)).map(
        (m) => m[1],
      );
      const finalNames = names.length ? names : ['module loads without throwing'];

      for (const [i, name] of finalNames.entries()) {
        await sleep(jitter(70));
        // Only the first assertion of the first suite fails when the build is broken —
        // mirrors how a parse error surfaces as a single upstream failure.
        const failing = hasBlockingError && results.length === 0;
        results.push({
          id: uid('test'),
          name,
          suite,
          status: failing ? 'failed' : 'passed',
          durationMs: jitter(14 + i * 6),
          message: failing
            ? `Expected the module to evaluate cleanly, but a build error in ${diagnostics.find((d) => d.severity === 'error')?.file} prevented it from loading.`
            : undefined,
          file: file.path,
          line: failing ? 12 : undefined,
        });
      }
    }

    if (results.length === 0) {
      results.push({
        id: uid('test'),
        name: 'no test files found',
        suite: 'project',
        status: 'skipped',
        durationMs: 0,
        message: 'Add files under tests/ or *.test.js to enable the suite.',
      });
    }

    return results;
  }

  /** Full run: analyse, bundle, and report. */
  static async run(files: ProjectFile[], entryPath: string): Promise<RunResult> {
    const started = performance.now();
    const consoleEntries: ConsoleEntry[] = [];

    const push = (level: ConsoleEntry['level'], message: string) =>
      consoleEntries.push({ id: uid('log'), level, message, at: Date.now(), source: 'runner' });

    push('system', 'Preparing sandbox…');
    await sleep(jitter(200));
    push('system', `Resolving ${files.length} files from the project tree`);
    await sleep(jitter(220));

    const diagnostics: Diagnostic[] = ErrorDetector.analyze(files);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');

    push('system', `Static analysis: ${errors.length} error(s), ${warnings.length} warning(s)`);
    for (const d of errors.slice(0, 4)) push('error', `${d.file}:${d.line} ${d.code} — ${d.message}`);
    for (const d of warnings.slice(0, 3)) push('warn', `${d.file}:${d.line} ${d.code} — ${d.message}`);

    await sleep(jitter(260));
    const previewHtml = CodeRunner.bundle(files, entryPath);
    push('system', errors.length ? 'Build completed with errors' : 'Build succeeded');
    push('info', `Preview document: ${(new Blob([previewHtml]).size / 1024).toFixed(1)} KB`);

    return {
      id: uid('run'),
      status: errors.length ? 'error' : 'success',
      durationMs: performance.now() - started,
      console: consoleEntries,
      diagnostics,
      previewHtml,
    };
  }
}
