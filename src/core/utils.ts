import type { FileLanguage } from './types';

let counter = 0;

/** Collision-resistant id that is stable enough for a client-side prototype. */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function now(): number {
  return Date.now();
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Deterministic-ish jitter so mock timings feel organic without being random noise. */
export function jitter(base: number, spread = 0.35): number {
  return Math.round(base * (1 - spread / 2 + Math.random() * spread));
}

export function languageFromPath(path: string): FileLanguage {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'js':
    case 'mjs':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'jsx':
      return 'jsx';
    case 'tsx':
      return 'tsx';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    default:
      return 'text';
  }
}

export function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function dirName(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

/** Cheap line-based diff stats — enough for +/- badges. */
export function diffStats(before: string, after: string): { additions: number; deletions: number } {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const setA = new Map<string, number>();
  for (const line of a) setA.set(line, (setA.get(line) ?? 0) + 1);
  let additions = 0;
  for (const line of b) {
    const n = setA.get(line) ?? 0;
    if (n > 0) setA.set(line, n - 1);
    else additions += 1;
  }
  let deletions = 0;
  for (const n of setA.values()) deletions += n;
  return { additions, deletions };
}

export function formatRelativeTime(ts: number, from = Date.now()): string {
  const diff = Math.max(0, from - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function titleCase(input: string): string {
  return input.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Escapes text for safe interpolation into generated HTML documents. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
