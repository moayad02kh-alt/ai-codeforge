/**
 * ProjectContextManager — decides WHICH files the model sees.
 *
 * Sending an entire project on every turn is expensive and, past a few dozen
 * files, impossible. This module scores each file for relevance against the
 * user's request and packs the best ones into a token budget.
 *
 * Strategy (cheap, deterministic, no embedding service required):
 *   1. Always include the entry point and small config/manifest files.
 *   2. Score remaining files on filename matches, content matches, recency,
 *      and whether a diagnostic currently points at them.
 *   3. Pack highest-scoring files until the budget is exhausted.
 *   4. Summarise anything that didn't fit, so the model knows it exists and
 *      can request it with an `inspect_file` action.
 *
 * Scaling path: swap `scoreFile` for vector similarity over a per-file
 * embedding index. The interface and the rest of the pipeline stay identical.
 */

import type { Diagnostic, ProjectFile } from '../../core/types';

export interface ContextOptions {
  /** Approximate token ceiling for file contents. */
  maxTokens?: number;
  /** Never include more than this many whole files. */
  maxFiles?: number;
  /** Files above this size are truncated rather than dropped. */
  maxFileTokens?: number;
  /** Current diagnostics — files with errors get priority. */
  diagnostics?: Diagnostic[];
  /** Paths the model explicitly asked to see via `inspect_file`. */
  pinned?: string[];
  entryPath?: string;
}

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
  /** Why this file made the cut — useful for debugging context selection. */
  score: number;
}

export interface ProjectContextPayload {
  /** Files whose full (or truncated) contents are included. */
  files: ContextFile[];
  /** Path + size only, for files that didn't fit. */
  omitted: Array<{ path: string; lines: number; language: string }>;
  totalFiles: number;
  estimatedTokens: number;
  /** Rendered block ready to drop into a prompt. */
  render: () => string;
}

/**
 * Rough token estimate. ~4 chars per token is the standard approximation for
 * English + code across GPT/Claude/Gemini tokenizers — close enough for
 * budgeting, and it avoids shipping a 2 MB tokenizer to the client.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const DEFAULTS: Required<Omit<ContextOptions, 'diagnostics' | 'pinned' | 'entryPath'>> = {
  maxTokens: 24_000,
  maxFiles: 30,
  maxFileTokens: 6_000,
};

/** Config/manifest files that are small and almost always relevant. */
const ALWAYS_INCLUDE = /^(package\.json|tsconfig\.json|vite\.config\.[jt]s|index\.html)$/i;

/** Generated or vendored files that are never worth spending tokens on. */
const NEVER_INCLUDE = /(^|\/)(node_modules|dist|build|coverage|\.git)(\/|$)|\.(lock|log|map|png|jpe?g|gif|webp|ico|woff2?|ttf)$/i;

const STOP_WORDS = new Set([
  'the','a','an','and','or','to','of','in','on','for','with','it','is','be','make','build',
  'create','add','change','update','please','my','me','can','you','i','want','need','that',
  'this','into','from','use','using','some','new','file','files','project','app',
]);

function keywords(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s./_-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    ),
  );
}

export class ProjectContextManager {
  /**
   * Scores one file's relevance to the request.
   * Higher is better; files scoring 0 are only included if budget remains.
   */
  private static scoreFile(
    file: ProjectFile,
    terms: string[],
    options: ContextOptions,
    newestTimestamp: number,
  ): number {
    let score = 0;
    const path = file.path.toLowerCase();
    const name = path.split('/').pop() ?? path;

    // Explicitly requested by the model — highest priority.
    if (options.pinned?.some((p) => p.toLowerCase() === path)) score += 1000;

    // Entry point anchors the whole project.
    if (options.entryPath && file.path === options.entryPath) score += 500;
    if (ALWAYS_INCLUDE.test(name)) score += 300;

    // Filename matches are a strong signal ("update the header styles").
    for (const term of terms) {
      if (name.includes(term)) score += 60;
      else if (path.includes(term)) score += 40;
    }

    // Content matches are weaker but still meaningful; cap so one huge file
    // full of a common word cannot dominate the ranking.
    const haystack = file.content.toLowerCase();
    for (const term of terms) {
      if (term.length < 4) continue;
      const hits = haystack.split(term).length - 1;
      if (hits > 0) score += Math.min(hits * 4, 40);
    }

    // Files with active errors are almost always what needs changing.
    const errors = options.diagnostics?.filter((d) => d.file === file.path) ?? [];
    for (const d of errors) score += d.severity === 'error' ? 120 : 30;

    // Recently touched files correlate with what the user is working on.
    if (newestTimestamp > 0) {
      const age = newestTimestamp - file.updatedAt;
      const dayMs = 86_400_000;
      if (age < dayMs) score += 40;
      else if (age < 7 * dayMs) score += 15;
    }

    // Prefer source over docs when budget is tight.
    if (/\.(html|css|js|ts|jsx|tsx)$/.test(path)) score += 20;
    if (/\.md$/.test(path)) score -= 10;
    if (/(^|\/)tests?\//.test(path) || /\.test\./.test(path)) score += 10;

    return score;
  }

  /** Builds the context payload for a request. */
  static build(
    files: ProjectFile[],
    prompt: string,
    options: ContextOptions = {},
  ): ProjectContextPayload {
    const opts = { ...DEFAULTS, ...options };
    const terms = keywords(prompt);
    const candidates = files.filter((f) => !NEVER_INCLUDE.test(f.path));
    const newest = candidates.reduce((max, f) => Math.max(max, f.updatedAt), 0);

    const ranked = candidates
      .map((file) => ({ file, score: ProjectContextManager.scoreFile(file, terms, options, newest) }))
      .sort((a, b) => b.score - a.score);

    const included: ContextFile[] = [];
    const omitted: ProjectContextPayload['omitted'] = [];
    let used = 0;

    for (const { file, score } of ranked) {
      if (included.length >= opts.maxFiles) {
        omitted.push({
          path: file.path,
          lines: file.content.split('\n').length,
          language: file.language,
        });
        continue;
      }

      const fileTokens = estimateTokens(file.content);
      const remaining = opts.maxTokens - used;

      if (remaining <= 200) {
        omitted.push({
          path: file.path,
          lines: file.content.split('\n').length,
          language: file.language,
        });
        continue;
      }

      // Truncate oversized files rather than dropping them entirely — the
      // model can request the rest with `inspect_file`.
      const allowance = Math.min(fileTokens, opts.maxFileTokens, remaining);
      if (fileTokens <= allowance) {
        included.push({ path: file.path, content: file.content, truncated: false, score });
        used += fileTokens;
      } else {
        const chars = allowance * 4;
        included.push({
          path: file.path,
          content: `${file.content.slice(0, chars)}\n\n/* … truncated (${
            file.content.split('\n').length
          } lines total). Use inspect_file to request the full contents. */`,
          truncated: true,
          score,
        });
        used += allowance;
      }
    }

    // Keep a stable, readable order in the prompt.
    included.sort((a, b) => a.path.localeCompare(b.path));

    return {
      files: included,
      omitted,
      totalFiles: files.length,
      estimatedTokens: used,
      render() {
        if (files.length === 0) {
          return 'The project is currently EMPTY. No files exist yet — you must create them from scratch.';
        }

        const parts: string[] = [
          `The project contains ${files.length} file(s). ${included.length} are shown in full below.`,
          '',
        ];

        for (const f of included) {
          const fence = f.path.split('.').pop() ?? '';
          parts.push(`--- FILE: ${f.path}${f.truncated ? ' (TRUNCATED)' : ''} ---`);
          parts.push('```' + fence);
          parts.push(f.content);
          parts.push('```');
          parts.push('');
        }

        if (omitted.length) {
          parts.push(
            `--- NOT SHOWN (${omitted.length} file(s)) — request with inspect_file if needed ---`,
          );
          for (const o of omitted) parts.push(`  ${o.path} (${o.lines} lines, ${o.language})`);
        }

        return parts.join('\n');
      },
    };
  }

  /** Compact tree view — cheap orientation for the model. */
  static renderTree(files: ProjectFile[]): string {
    if (!files.length) return '(empty project)';
    return files
      .map((f) => `  ${f.path} — ${f.content.split('\n').length} lines`)
      .sort()
      .join('\n');
  }
}
