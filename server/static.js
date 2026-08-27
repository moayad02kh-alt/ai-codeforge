/**
 * CodeForge AI — static file serving for production (single-service deploy).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS
 *  In development, Vite serves the frontend on :5173 and proxies /api to the
 *  Node API on :8787 — two processes. On a single Render Web Service there is
 *  only ONE process and ONE port, so this module lets the existing Node API
 *  also serve the built Vite frontend from dist/.
 *
 *  This file adds serving only. It does not alter API behaviour: the router in
 *  index.js handles /api/* first and only falls through to here for non-API
 *  requests, so API routes can never be swallowed by the SPA fallback.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Absolute path to the built frontend. */
export function distDir(rootDir) {
  return resolve(rootDir, 'dist');
}

/** True when `npm run build` has produced a serveable frontend. */
export function hasBuild(rootDir) {
  return existsSync(join(distDir(rootDir), 'index.html'));
}

/**
 * Resolves a URL pathname to a real file inside dist/, or null.
 * Rejects traversal: the resolved path must stay within dist/.
 */
function resolveAsset(rootDir, pathname) {
  const root = distDir(rootDir);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;

  const candidate = resolve(root, '.' + normalize(decoded));
  // Must remain inside dist/ — blocks ../ traversal.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  if (!existsSync(candidate)) return null;

  const stat = statSync(candidate);
  if (!stat.isFile()) return null;
  return { path: candidate, size: stat.size, mtime: stat.mtimeMs };
}

function headersFor(filePath, size, immutable) {
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  return {
    'Content-Type': type,
    'Content-Length': size,
    // Vite emits content-hashed filenames under /assets, so those are safe to
    // cache forever. Everything else (index.html especially) must revalidate,
    // otherwise users get a stale shell after a deploy.
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    /*
     * Allow the bundle to load inside a sandboxed iframe.
     *
     * Preview panels embed the app with `sandbox="allow-scripts"` and without
     * `allow-same-origin`, which gives the document an opaque origin that
     * serialises to "null". Sub-resource requests then carry `Origin: null`,
     * and a response with no Access-Control-Allow-Origin is rejected by CORS.
     * The API already sent this header; static assets did not, so the HTML
     * arrived but its CSS and JS were both blocked — the app never booted and
     * the panel showed only the page background.
     *
     * These are public build artefacts served with no cookies or credentials,
     * so a wildcard exposes nothing that GET /assets/... does not already.
     */
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  };
}

function sendFile(res, filePath, size, immutable, method) {
  res.writeHead(200, headersFor(filePath, size, immutable));
  if (method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

/**
 * Serves the built frontend.
 *
 * Returns true when the request was handled, false when the caller should
 * continue (e.g. to its own 404). Only call this AFTER API routing.
 */
export function serveStatic(req, res, rootDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!hasBuild(rootDir)) return false;

  const pathname = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).pathname;

  // Never let the SPA fallback answer for API paths.
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;

  // 1. Real file on disk (/assets/index-abc123.js, /favicon.ico, …).
  const asset = resolveAsset(rootDir, pathname);
  if (asset) {
    const immutable = pathname.startsWith('/assets/');
    sendFile(res, asset.path, asset.size, immutable, req.method);
    return true;
  }

  // 2. SPA fallback — client-side routes resolve to the app shell.
  //    Skipped for paths that look like missing files (e.g. /foo.js) so a
  //    broken asset 404s honestly instead of returning HTML.
  const looksLikeFile = /\.[a-z0-9]+$/i.test(pathname);
  if (!looksLikeFile) {
    const shell = join(distDir(rootDir), 'index.html');
    const { size } = statSync(shell);
    sendFile(res, shell, size, false, req.method);
    return true;
  }

  return false;
}
