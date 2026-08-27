#!/usr/bin/env node
/**
 * CodeForge AI — resilient preview launcher.
 *
 * Starting the production server is normally just `node index.js`, but that
 * assumes `node_modules/` and `dist/` exist. Both are excluded from workspace
 * snapshots, so after the workspace is restored the source is intact while the
 * runtime is gone and `node index.js` fails immediately — the preview then
 * reports that it cannot connect.
 *
 * This script makes startup self-healing: it restores whatever is missing and
 * only then boots the real entrypoint. Safe to run when everything is already
 * in place, in which case it does nothing but start the server.
 *
 *     node scripts/serve.mjs            # PORT defaults to 4173
 *     PORT=8080 node scripts/serve.mjs
 */

import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || '4173';

function log(msg) {
  console.log(`[serve] ${msg}`);
}

/** Runs a command synchronously, inheriting stdio, and exits on failure. */
function run(cmd, args, label) {
  log(label);
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  if (res.status !== 0) {
    console.error(`[serve] ${label} failed (exit ${res.status}).`);
    process.exit(res.status ?? 1);
  }
}

// 1. Dependencies. `npm ci` would be stricter but is far slower and fails
//    outright when the lockfile and package.json drift, which is not a useful
//    failure mode for a preview launcher.
if (!existsSync(join(root, 'node_modules', 'vite'))) {
  run('npm', ['install', '--no-audit', '--no-fund'], 'node_modules missing — installing dependencies');
} else {
  log('dependencies present');
}

// 2. Build output. index.js serves dist/, so it must exist before boot.
if (!existsSync(join(root, 'dist', 'index.html'))) {
  run('npm', ['run', 'build'], 'dist/ missing — building production bundle');
} else {
  log('production build present');
}

// 3. Boot the real entrypoint. Bind 0.0.0.0 (handled inside server/index.js)
//    so the preview proxy can reach it from outside the sandbox.
log(`starting production server on port ${PORT}`);
const child = spawn(process.execPath, [join(root, 'index.js')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT },
});

// Forward termination so the port is released promptly on stop.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code) => process.exit(code ?? 0));
