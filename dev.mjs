/**
 * Dev launcher — runs the AI backend and the Vite client together.
 *
 * `npm run dev` starts both, so the app can reach `/api/agent/*` with no extra
 * setup. If the backend has no API key it still runs and simply reports
 * `configured: false`, which makes the frontend fall back to the simulation.
 *
 * Run them separately if you prefer:
 *   npm run server      (API only)
 *   npm run dev:client  (Vite only)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(name, command, args, color) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: process.platform === 'win32',
  });

  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix} ${line}\n`);
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stdout.write(`${prefix} exited with code ${code}\n`);
    }
  });

  children.push(child);
  return child;
}

// Friendly nudge on first run.
if (!existsSync(resolve(root, '.env'))) {
  console.log(
    '\x1b[33m[codeforge]\x1b[0m No .env found — starting in SIMULATED mode.\n' +
      '\x1b[33m[codeforge]\x1b[0m To connect a real model: cp .env.example .env, add a key, restart.\n',
  );
}

run('api', process.execPath, ['server/index.js'], '36');
run('web', process.execPath, ['node_modules/vite/bin/vite.js'], '35');

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
