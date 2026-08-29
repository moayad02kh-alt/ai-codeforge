/**
 * Structured coding actions — the contract between the model and the app.
 *
 * The LLM never writes to the project directly. It returns a JSON array of
 * actions, which are then validated and executed by `ActionExecutor`. This is
 * the security boundary: a malformed, malicious, or hallucinated action is
 * rejected here rather than corrupting the file tree.
 *
 * The same validator runs on the server (before the response is returned) and
 * on the client (before actions are applied) — defence in depth.
 */

import type { ProjectFile } from '../../core/types';
import { FileManager } from '../FileManager';

/* ------------------------------------------------------------------ */
/* Action types                                                        */
/* ------------------------------------------------------------------ */

export type ActionType =
  | 'create_file'
  | 'update_file'
  | 'delete_file'
  | 'rename_file'
  | 'inspect_file'
  | 'run_check'
  | 'repair_error';

interface BaseAction {
  /** Why the agent took this step — surfaced in the UI timeline. */
  reason?: string;
}

export interface CreateFileAction extends BaseAction {
  type: 'create_file';
  path: string;
  content: string;
}

export interface UpdateFileAction extends BaseAction {
  type: 'update_file';
  path: string;
  /** Full replacement content. */
  content: string;
}

export interface DeleteFileAction extends BaseAction {
  type: 'delete_file';
  path: string;
}

export interface RenameFileAction extends BaseAction {
  type: 'rename_file';
  from: string;
  to: string;
}

/** Read-only: asks the app to return a file's contents on the next turn. */
export interface InspectFileAction extends BaseAction {
  type: 'inspect_file';
  path: string;
}

/** Read-only: asks the app to run validation and report back. */
export interface RunCheckAction extends BaseAction {
  type: 'run_check';
  check: 'static-analysis' | 'tests' | 'build';
}

/** Targeted fix for a known diagnostic. */
export interface RepairErrorAction extends BaseAction {
  type: 'repair_error';
  path: string;
  content: string;
  diagnosticCode?: string;
  analysis?: string;
}

export type CodingAction =
  | CreateFileAction
  | UpdateFileAction
  | DeleteFileAction
  | RenameFileAction
  | InspectFileAction
  | RunCheckAction
  | RepairErrorAction;

/** Actions that change the file tree (vs. read-only requests). */
export type MutatingAction =
  | CreateFileAction
  | UpdateFileAction
  | DeleteFileAction
  | RenameFileAction
  | RepairErrorAction;

export const MUTATING_ACTIONS: ActionType[] = [
  'create_file',
  'update_file',
  'delete_file',
  'rename_file',
  'repair_error',
];

/** Type guard, so callers can narrow to actions that carry a path. */
export function isMutating(action: CodingAction): action is MutatingAction {
  return MUTATING_ACTIONS.includes(action.type);
}

/* ------------------------------------------------------------------ */
/* Model response envelope                                             */
/* ------------------------------------------------------------------ */

export interface AgentActionResponse {
  /** Short restatement of what the user asked for. */
  intent?: {
    kind?: string;
    restatement?: string;
    domain?: string;
    keywords?: string[];
    confidence?: number;
  };
  plan?: {
    summary?: string;
    tasks?: Array<{ title: string; detail?: string; targets?: string[] }>;
  };
  actions: CodingAction[];
  /** Prose explanation rendered in the chat panel. */
  message: string;
}

/**
 * Normalises raw model actions BEFORE validation.
 *
 * Gemini (and other models) sometimes emit structurally imperfect actions:
 *
 *   - content under an alias key (`code`, `newContent`, `fileContents`, …)
 *   - content wrapped in an object (`{ "content": { "text": "…" } }`)
 *   - content as an array of lines
 *   - paths under aliases (`filePath`, `oldPath`, `destination`, …)
 *   - action types under near-miss names (`write_file`, `edit_file`, …)
 *   - update_file with NO recoverable content at all (truncation)
 *
 * Rather than letting the validator reject the whole run, we repair what is
 * safely repairable and convert an unfixable content-bearing action into an
 * `inspect_file`, which the agent loop already knows how to satisfy: the file
 * contents are fed back on the next round and the model retries with complete
 * content. Validation still runs afterwards — this layer never bypasses the
 * security checks, it only makes well-intentioned actions pass them.
 */
export const CONTENT_BEARING_TYPES = ['create_file', 'update_file', 'repair_error'];

/** Keys under which models sometimes hide the full file content. */
const CONTENT_ALIAS_KEYS = [
  'newContent', 'new_content', 'updatedContent', 'updated_content',
  'fileContents', 'file_contents', 'fileContent', 'file_content',
  'fullContent', 'full_content', 'contents', 'source', 'code',
  'body', 'text', 'value', 'data',
];

/** Keys used to unwrap object-shaped content, in priority order. */
const CONTENT_OBJECT_KEYS = ['text', 'code', 'content', 'value', 'body', 'source', 'html', 'css', 'js'];

/** Path aliases per canonical field. */
const PATH_ALIAS_KEYS: Record<'path' | 'from' | 'to', string[]> = {
  path: ['path', 'filePath', 'file_path', 'filename', 'fileName', 'file', 'target'],
  from: ['from', 'source', 'sourcePath', 'source_path', 'oldPath', 'old_path', 'oldName'],
  to: ['to', 'destination', 'dest', 'targetPath', 'target_path', 'newPath', 'new_path', 'newName'],
};

/** Near-miss action type names mapped to the canonical ones. */
const TYPE_ALIASES: Record<string, ActionType> = {
  write_file: 'update_file',
  write: 'update_file',
  edit_file: 'update_file',
  edit: 'update_file',
  modify_file: 'update_file',
  modify: 'update_file',
  patch_file: 'update_file',
  add_file: 'create_file',
  new_file: 'create_file',
  add: 'create_file',
  create: 'create_file',
  remove_file: 'delete_file',
  remove: 'delete_file',
  destroy_file: 'delete_file',
  move_file: 'rename_file',
  move: 'rename_file',
  copy_file: 'rename_file',
  read_file: 'inspect_file',
  view_file: 'inspect_file',
  open_file: 'inspect_file',
  read: 'inspect_file',
};

/** First string value found under any of `keys`, or undefined. */
function firstStringIn(a: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Best-effort extraction of a usable content string from any shape. */
function coerceContent(v: unknown): string | undefined {
  if (typeof v === 'string') return v.length > 0 ? v : undefined;
  if (Array.isArray(v)) {
    // Some models stream content as an array of lines/chunks.
    if (v.every((s) => typeof s === 'string')) return v.join('\n');
    return undefined;
  }
  if (v && typeof v === 'object') {
    const inner = firstStringIn(v as Record<string, unknown>, CONTENT_OBJECT_KEYS);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

export interface NormalizationResult {
  /** Repaired candidate actions — still unvalidated. */
  actions: unknown[];
  /** Human-readable notes about repairs, surfaced in the run timeline. */
  notes: string[];
}

/**
 * Repairs a batch of candidate actions. `existingFiles` (just paths are read)
 * lets an unfixable update_file become an inspect_file for the file that was
 * actually targeted, so the model sees it on the next round.
 */
export function normalizeActions(
  input: unknown,
  existingFiles: Array<{ path: string }> = [],
): NormalizationResult {
  const notes: string[] = [];
  if (!Array.isArray(input)) return { actions: Array.isArray(input) ? input : [], notes };

  const actions = input.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const a = { ...(candidate as Record<string, unknown>) };

    // --- action type aliases -------------------------------------------
    const rawType = typeof a.type === 'string' ? a.type.trim() : '';
    const mapped = TYPE_ALIASES[rawType.toLowerCase()];
    if (mapped && mapped !== rawType) {
      a.type = mapped;
      notes.push(`action #${index}: type "${rawType}" interpreted as "${mapped}"`);
    }
    const type = typeof a.type === 'string' ? a.type : '';

    // --- path aliases ----------------------------------------------------
    if (CONTENT_BEARING_TYPES.includes(type as (typeof CONTENT_BEARING_TYPES)[number]) || type === 'inspect_file') {
      if (typeof a.path !== 'string' || !a.path.trim()) {
        const alias = firstStringIn(a, PATH_ALIAS_KEYS.path.slice(1));
        if (alias !== undefined) {
          a.path = alias;
          notes.push(`action #${index}: recovered path from alias key`);
        }
      }
    }
    if (type === 'rename_file') {
      if (typeof a.from !== 'string' || !a.from.trim()) {
        const alias = firstStringIn(a, PATH_ALIAS_KEYS.from.slice(1));
        if (alias !== undefined) {
          a.from = alias;
          notes.push(`action #${index}: recovered rename "from" from alias key`);
        }
      }
      if (typeof a.to !== 'string' || !a.to.trim()) {
        const alias = firstStringIn(a, PATH_ALIAS_KEYS.to.filter((k) => k !== 'target').slice(1));
        if (alias !== undefined) {
          a.to = alias;
          notes.push(`action #${index}: recovered rename "to" from alias key`);
        }
      }
    }

    // --- content recovery ------------------------------------------------
    if (CONTENT_BEARING_TYPES.includes(type as (typeof CONTENT_BEARING_TYPES)[number])) {
      let content = coerceContent(a.content);

      // Try alias keys only when content itself is missing/unusable.
      if (content === undefined) {
        content = firstStringIn(a, CONTENT_ALIAS_KEYS);
        if (content !== undefined) {
          notes.push(
            `action #${index} (${a.path ?? 'unknown path'}): content recovered from "${CONTENT_ALIAS_KEYS.find((k) => typeof a[k] === 'string' && (a[k] as string).length > 0)}" key`,
          );
        }
      }

      if (content !== undefined) {
        a.content = content;
      } else {
        // Nothing recoverable. An update/repair on an existing (or even
        // missing) file is safely convertible to inspect_file: the agent
        // loop feeds the file (or "does not exist") back and the model
        // retries with complete content. A create_file without content has
        // no meaningful fallback — leave it for the validator + retry.
        if (type === 'update_file' || type === 'repair_error') {
          const target = typeof a.path === 'string' ? a.path : 'unknown path';
          const exists = existingFiles.some((f) => f.path === target || FileManager.normalize(target) === f.path);
          notes.push(
            `action #${index}: ${type} for "${target}" had no content${
              exists ? '' : ' (target not in project)'
            } — converted to inspect_file so the model can retry with complete contents`,
          );
          return {
            type: 'inspect_file',
            path: a.path,
            reason:
              (typeof a.reason === 'string' && a.reason ? `${a.reason} — ` : '') +
              `original ${type} omitted "content"; requesting file contents to retry safely`,
          };
        }
        // create_file without content: leave as-is; validator rejects with a
        // precise reason and the corrective retry asks for full contents.
      }
    }

    return a;
  });

  return { actions, notes };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  valid: CodingAction[];
  rejected: Array<{ action: unknown; reason: string }>;
}

/** Hard limits — a runaway model must not be able to exhaust memory. */
export const LIMITS = {
  maxActions: 40,
  maxFileBytes: 512 * 1024,
  maxPathLength: 200,
} as const;

/**
 * Rejects paths that escape the project root or target sensitive locations.
 * This is the single most important check in the file: without it, a model
 * could write to `../../etc/...` or overwrite `.env`.
 */
export function isSafePath(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const path = raw.trim();
  if (!path || path.length > LIMITS.maxPathLength) return false;

  // No absolute paths, no traversal, no Windows drive letters, no NUL bytes.
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (path.includes('\0')) return false;
  if (path.split('/').some((seg) => seg === '..')) return false;

  // Block dotfiles that carry secrets or VCS state.
  const blocked = [/(^|\/)\.env($|\.)/i, /(^|\/)\.git(\/|$)/i, /(^|\/)\.ssh(\/|$)/i, /(^|\/)node_modules(\/|$)/i];
  if (blocked.some((re) => re.test(path))) return false;

  return true;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Validates one candidate action, returning it typed or an error reason. */
export function validateAction(input: unknown): { action?: CodingAction; reason?: string } {
  if (!input || typeof input !== 'object') return { reason: 'Action is not an object' };
  const a = input as Record<string, unknown>;
  const type = a.type;

  const checkContent = (): string | null => {
    if (typeof a.content !== 'string') return 'Missing "content" string';
    if (a.content.length > LIMITS.maxFileBytes) {
      return `Content exceeds ${LIMITS.maxFileBytes} byte limit`;
    }
    return null;
  };

  switch (type) {
    case 'create_file':
    case 'update_file':
    case 'repair_error': {
      if (!isSafePath(a.path)) return { reason: `Unsafe or missing path: ${String(a.path)}` };
      const err = checkContent();
      if (err) return { reason: err };
      return { action: input as CodingAction };
    }

    case 'delete_file': {
      if (!isSafePath(a.path)) return { reason: `Unsafe or missing path: ${String(a.path)}` };
      return { action: input as CodingAction };
    }

    case 'rename_file': {
      if (!isSafePath(a.from)) return { reason: `Unsafe or missing "from": ${String(a.from)}` };
      if (!isSafePath(a.to)) return { reason: `Unsafe or missing "to": ${String(a.to)}` };
      return { action: input as CodingAction };
    }

    case 'inspect_file': {
      if (!isSafePath(a.path)) return { reason: `Unsafe or missing path: ${String(a.path)}` };
      return { action: input as CodingAction };
    }

    case 'run_check': {
      if (!isNonEmptyString(a.check)) return { reason: 'Missing "check"' };
      if (!['static-analysis', 'tests', 'build'].includes(a.check)) {
        return { reason: `Unknown check "${a.check}"` };
      }
      return { action: input as CodingAction };
    }

    default:
      return { reason: `Unknown action type: ${String(type)}` };
  }
}

/** Validates a batch, dropping bad actions instead of failing the whole turn. */
export function validateActions(input: unknown): ValidationResult {
  const valid: CodingAction[] = [];
  const rejected: Array<{ action: unknown; reason: string }> = [];

  if (!Array.isArray(input)) {
    return { valid, rejected: [{ action: input, reason: 'Actions payload is not an array' }] };
  }

  for (const candidate of input.slice(0, LIMITS.maxActions)) {
    const { action, reason } = validateAction(candidate);
    if (action) valid.push(action);
    else rejected.push({ action: candidate, reason: reason ?? 'Unknown validation failure' });
  }

  if (input.length > LIMITS.maxActions) {
    rejected.push({
      action: null,
      reason: `Response contained ${input.length} actions; only the first ${LIMITS.maxActions} were applied`,
    });
  }

  return { valid, rejected };
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface ExecutionResult {
  files: ProjectFile[];
  /** Human-readable log of what was applied, for the run timeline. */
  log: string[];
  /** Files the model asked to read — fed back on the next turn. */
  inspections: Array<{ path: string; found: boolean; content?: string }>;
  /** Checks the model requested. */
  checks: Array<'static-analysis' | 'tests' | 'build'>;
  applied: number;
  skipped: Array<{ action: CodingAction; reason: string }>;
}

/**
 * Applies validated actions to a file tree.
 *
 * Pure: returns a new array rather than mutating, so the caller can snapshot
 * before/after for version history and rollback.
 */
export class ActionExecutor {
  static execute(files: ProjectFile[], actions: CodingAction[]): ExecutionResult {
    let next = [...files];
    const log: string[] = [];
    const inspections: ExecutionResult['inspections'] = [];
    const checks: ExecutionResult['checks'] = [];
    const skipped: ExecutionResult['skipped'] = [];
    let applied = 0;

    for (const action of actions) {
      switch (action.type) {
        case 'create_file': {
          const path = FileManager.normalize(action.path);
          if (FileManager.find(next, path)) {
            // Treat create-on-existing as an update rather than failing.
            next = FileManager.applyChanges(next, [{ path, content: action.content }]).files;
            log.push(`update ${path} (create_file on existing path)`);
          } else {
            next = FileManager.applyChanges(next, [{ path, content: action.content }]).files;
            log.push(`create ${path}`);
          }
          applied += 1;
          break;
        }

        case 'update_file':
        case 'repair_error': {
          const path = FileManager.normalize(action.path);
          if (!FileManager.find(next, path)) {
            // Creating a missing file is safer than dropping the change.
            log.push(`create ${path} (target did not exist)`);
          } else {
            log.push(`${action.type === 'repair_error' ? 'repair' : 'update'} ${path}`);
          }
          next = FileManager.applyChanges(next, [{ path, content: action.content }]).files;
          applied += 1;
          break;
        }

        case 'delete_file': {
          const path = FileManager.normalize(action.path);
          if (!FileManager.find(next, path)) {
            skipped.push({ action, reason: 'File does not exist' });
            break;
          }
          next = FileManager.applyChanges(next, [], [path]).files;
          log.push(`delete ${path}`);
          applied += 1;
          break;
        }

        case 'rename_file': {
          const from = FileManager.normalize(action.from);
          const to = FileManager.normalize(action.to);
          if (!FileManager.find(next, from)) {
            skipped.push({ action, reason: `Source "${from}" does not exist` });
            break;
          }
          if (FileManager.find(next, to)) {
            skipped.push({ action, reason: `Destination "${to}" already exists` });
            break;
          }
          next = FileManager.rename(next, from, to);
          log.push(`rename ${from} → ${to}`);
          applied += 1;
          break;
        }

        case 'inspect_file': {
          const path = FileManager.normalize(action.path);
          const file = FileManager.find(next, path);
          inspections.push({ path, found: Boolean(file), content: file?.content });
          log.push(`inspect ${path}${file ? '' : ' (not found)'}`);
          break;
        }

        case 'run_check': {
          checks.push(action.check);
          log.push(`run_check ${action.check}`);
          break;
        }
      }
    }

    return { files: next, log, inspections, checks, applied, skipped };
  }
}
