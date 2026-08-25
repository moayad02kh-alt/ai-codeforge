/**
 * ErrorDetector — static analysis over the project file tree.
 *
 * These are REAL checks (brace balance, unguarded DOM access, dangling asset
 * references, duplicate ids), not random noise — so the Auto Repair loop has
 * genuine faults to analyse and fix. They run entirely in the browser.
 *
 * Backend swap: point this at a real language server / ESLint / tsc process in
 * the sandbox and return the same `Diagnostic[]` shape.
 */

import type { Diagnostic, ProjectFile } from '../core/types';
import { uid } from '../core/utils';

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function columnOf(content: string, index: number): number {
  const nl = content.lastIndexOf('\n', index - 1);
  return index - nl;
}

export class ErrorDetector {
  static analyze(files: ProjectFile[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const paths = new Set(files.map((f) => f.path));

    for (const file of files) {
      switch (file.language) {
        case 'css':
          diagnostics.push(...ErrorDetector.checkCss(file));
          break;
        case 'javascript':
        case 'typescript':
        case 'jsx':
        case 'tsx':
          diagnostics.push(...ErrorDetector.checkScript(file));
          break;
        case 'html':
          diagnostics.push(...ErrorDetector.checkHtml(file, paths));
          break;
        case 'json':
          diagnostics.push(...ErrorDetector.checkJson(file));
          break;
        default:
          break;
      }
    }

    return diagnostics;
  }

  /* ---------------- CSS ---------------- */
  private static checkCss(file: ProjectFile): Diagnostic[] {
    const out: Diagnostic[] = [];
    const src = file.content;

    const opens = (src.match(/{/g) ?? []).length;
    const closes = (src.match(/}/g) ?? []).length;
    if (opens !== closes) {
      out.push({
        id: uid('diag'),
        severity: 'error',
        code: 'CF1001',
        message: `Unbalanced braces: ${opens} opening vs ${closes} closing. Rules after the fault are dropped by the parser.`,
        file: file.path,
        line: src.split('\n').length,
        column: 1,
        source: 'static-analysis',
        repairable: true,
      });
    }

    // Declarations missing a terminating semicolon before the next property.
    const missingSemi = /:\s*[^;{}\n]+\n\s*[a-z-]+\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = missingSemi.exec(src))) {
      out.push({
        id: uid('diag'),
        severity: 'warning',
        code: 'CF1002',
        message: 'Declaration appears to be missing a terminating semicolon.',
        file: file.path,
        line: lineOf(src, m.index),
        column: columnOf(src, m.index),
        source: 'static-analysis',
        repairable: true,
      });
      if (out.length > 12) break;
    }

    return out;
  }

  /* ---------------- Scripts ---------------- */
  private static checkScript(file: ProjectFile): Diagnostic[] {
    const out: Diagnostic[] = [];
    const src = file.content;

    // Unguarded DOM dereference: document.getElementById('x').value
    const unguarded = /document\.getElementById\((['"])[^'"]+\1\)\s*\.\s*(?!addEventListener)\w+/g;
    let m: RegExpExecArray | null;
    while ((m = unguarded.exec(src))) {
      out.push({
        id: uid('diag'),
        severity: 'warning',
        code: 'CF2003',
        message: 'DOM lookup is dereferenced without a null check; throws a TypeError if the element is absent.',
        file: file.path,
        line: lineOf(src, m.index),
        column: columnOf(src, m.index),
        source: 'static-analysis',
        repairable: true,
      });
      if (out.length > 8) break;
    }

    // Bracket balance (ignores occurrences inside strings only loosely).
    const pairs: Array<[string, string, string]> = [
      ['{', '}', 'braces'],
      ['(', ')', 'parentheses'],
      ['[', ']', 'brackets'],
    ];
    for (const [open, close, label] of pairs) {
      const o = src.split(open).length - 1;
      const c = src.split(close).length - 1;
      if (o !== c) {
        out.push({
          id: uid('diag'),
          severity: 'error',
          code: 'CF2001',
          message: `Unbalanced ${label}: ${o} "${open}" vs ${c} "${close}". The file will fail to parse.`,
          file: file.path,
          line: src.split('\n').length,
          column: 1,
          source: 'static-analysis',
          repairable: true,
        });
      }
    }

    if (/\bconsole\.(log|debug)\(/.test(src)) {
      const idx = src.search(/\bconsole\.(log|debug)\(/);
      out.push({
        id: uid('diag'),
        severity: 'info',
        code: 'CF2010',
        message: 'Debug logging left in source.',
        file: file.path,
        line: lineOf(src, idx),
        column: columnOf(src, idx),
        source: 'static-analysis',
        repairable: false,
      });
    }

    return out;
  }

  /* ---------------- HTML ---------------- */
  private static checkHtml(file: ProjectFile, paths: Set<string>): Diagnostic[] {
    const out: Diagnostic[] = [];
    const src = file.content;

    // Local asset references that don't resolve in the project tree.
    const assetRe = /(?:href|src)=["'](?!https?:|data:|#|mailto:)([^"']+\.(?:css|js))["']/g;
    let m: RegExpExecArray | null;
    while ((m = assetRe.exec(src))) {
      const ref = m[1].replace(/^\.\//, '').replace(/^\//, '');
      if (!paths.has(ref)) {
        out.push({
          id: uid('diag'),
          severity: 'error',
          code: 'CF3002',
          message: `Referenced asset "${m[1]}" does not exist in the project. The browser will return 404.`,
          file: file.path,
          line: lineOf(src, m.index),
          column: columnOf(src, m.index),
          source: 'build',
          repairable: true,
        });
      }
    }

    // Duplicate element ids break getElementById and label associations.
    const idRe = /\sid=["']([^"']+)["']/g;
    const seen = new Map<string, number>();
    while ((m = idRe.exec(src))) {
      const id = m[1];
      if (seen.has(id)) {
        out.push({
          id: uid('diag'),
          severity: 'warning',
          code: 'CF3005',
          message: `Duplicate element id "${id}" (first defined on line ${seen.get(id)}).`,
          file: file.path,
          line: lineOf(src, m.index),
          column: columnOf(src, m.index),
          source: 'static-analysis',
          repairable: true,
        });
      } else {
        seen.set(id, lineOf(src, m.index));
      }
    }

    // Images without alt text — accessibility.
    const imgRe = /<img(?![^>]*\salt=)[^>]*>/g;
    while ((m = imgRe.exec(src))) {
      out.push({
        id: uid('diag'),
        severity: 'warning',
        code: 'CF3007',
        message: 'Image element is missing an alt attribute.',
        file: file.path,
        line: lineOf(src, m.index),
        column: columnOf(src, m.index),
        source: 'static-analysis',
        repairable: true,
      });
    }

    return out;
  }

  /* ---------------- JSON ---------------- */
  private static checkJson(file: ProjectFile): Diagnostic[] {
    try {
      JSON.parse(file.content);
      return [];
    } catch (err) {
      return [
        {
          id: uid('diag'),
          severity: 'error',
          code: 'CF5001',
          message: `Invalid JSON: ${(err as Error).message}`,
          file: file.path,
          line: 1,
          column: 1,
          source: 'build',
          repairable: true,
        },
      ];
    }
  }

  static errorCount(diagnostics: Diagnostic[]): number {
    return diagnostics.filter((d) => d.severity === 'error').length;
  }

  static warningCount(diagnostics: Diagnostic[]): number {
    return diagnostics.filter((d) => d.severity === 'warning').length;
  }
}
