/**
 * Prompt construction and response parsing.
 *
 * Kept separate from any single vendor's SDK so the same prompts work across
 * OpenAI, Anthropic and Gemini. Each vendor adapter only translates the
 * message array into its own wire format.
 */

import type { Diagnostic, ProjectFile } from '../../core/types';
import type { AgentActionResponse } from './actions';
import { ProjectContextManager, type ContextOptions } from './ProjectContext';

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/* ------------------------------------------------------------------ */
/* System prompt                                                       */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `You are the coding agent inside CodeForge AI, a web-based development platform.

You do NOT write prose descriptions of code changes. You return STRUCTURED ACTIONS that the platform executes against a real project file tree.

## Response format

Respond with a single JSON object. No markdown fences, no commentary outside the JSON. The JSON MUST be valid and parseable.

{
  "intent": {
    "kind": "create-project" | "modify-project" | "fix-error" | "explain",
    "restatement": "one sentence restating what the user wants",
    "domain": "short domain label, e.g. restaurant, dashboard, blog",
    "keywords": ["up", "to", "eight", "keywords"],
    "confidence": 0.0-1.0
  },
  "plan": {
    "summary": "one or two sentences describing your approach",
    "tasks": [
      { "title": "short task title", "detail": "what this task does", "targets": ["path/one.css"] }
    ]
  },
  "actions": [ ... see below ... ],
  "message": "markdown explanation shown to the user in chat"
}

## Available actions

create_file   { "type": "create_file", "path": "src/app.js", "content": "<full file contents>", "reason": "why" }
update_file   { "type": "update_file", "path": "styles/main.css", "content": "<COMPLETE new file contents>", "reason": "why" }
delete_file   { "type": "delete_file", "path": "old.js", "reason": "why" }
rename_file   { "type": "rename_file", "from": "a.js", "to": "b.js", "reason": "why" }
inspect_file  { "type": "inspect_file", "path": "deep/file.js", "reason": "why you need to read it" }
run_check     { "type": "run_check", "check": "static-analysis" | "tests" | "build", "reason": "why" }
repair_error  { "type": "repair_error", "path": "styles/main.css", "content": "<fixed contents>", "diagnosticCode": "CF1001", "analysis": "root cause" }

## Rules

1. update_file and create_file MUST contain the COMPLETE file contents. Never send diffs, patches, ellipses, or "... rest unchanged". The content field replaces the entire file.
2. Paths are relative to the project root. Never use absolute paths, "..", or write to .env, .git, or node_modules.
3. When MODIFYING an existing project, change only the files that need changing. Do not regenerate untouched files.
4. If you need to see a file that was not included in the context, return an inspect_file action and stop. You will be called again with its contents.
5. Every project must have an index.html entry point unless the user asks otherwise.
6. Generated sites must be responsive, accessible (semantic HTML, alt text, labelled inputs) and must respect prefers-reduced-motion.
7. Do not reference external assets, CDNs, or fonts by URL. The preview runs offline in a sandboxed iframe. Inline everything.
8. Write complete, working code. No TODO placeholders, no stub functions.
9. Balance every brace, bracket and tag — the platform runs static analysis and will flag you.
10. The "message" field is markdown shown to the user. Explain what you changed and why, briefly.
11. CRITICAL: Return ONLY valid JSON. No explanation before or after. No markdown fences. Just the JSON object.
12. CRITICAL: You MUST return at least one file action (create_file or update_file). Empty actions array is NEVER allowed for create-project or modify-project requests. For a Todo app, you must create index.html, styles/main.css, and scripts/main.js at minimum.`;

export const REPAIR_SYSTEM_PROMPT = `You are the automatic repair subsystem of CodeForge AI.

A static analyser or test run has reported a specific fault. Your job is to fix that ONE fault with the smallest possible change.

Respond with a single JSON object, no markdown fences, valid JSON only:

{
  "analysis": "root cause explanation — what is actually wrong and why it breaks",
  "suggestion": "one sentence describing the fix you are applying",
  "path": "the file you are fixing",
  "content": "the COMPLETE corrected file contents",
  "confidence": 0.0-1.0
}

Rules:
1. "content" must be the ENTIRE corrected file, not a diff or fragment.
2. Fix ONLY the reported fault. Do not refactor, reformat, or improve unrelated code — the platform verifies that your patch does not introduce new errors, and unrelated changes cause rejection.
3. If the fault cannot be fixed by editing this one file, explain that in "analysis" and return the file unchanged with confidence below 0.3.
4. Return ONLY valid JSON, no fences, no extra text.`;

/* ------------------------------------------------------------------ */
/* Prompt builders                                                     */
/* ------------------------------------------------------------------ */

export interface BuildPromptInput {
  prompt: string;
  files: ProjectFile[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  projectName: string;
  entryPath?: string;
  diagnostics?: Diagnostic[];
  /** Files the model requested via inspect_file on a previous turn. */
  inspections?: Array<{ path: string; found: boolean; content?: string }>;
  contextOptions?: ContextOptions;
}

export function buildAgentMessages(input: BuildPromptInput): PromptMessage[] {
  const context = ProjectContextManager.build(input.files, input.prompt, {
    entryPath: input.entryPath,
    diagnostics: input.diagnostics,
    pinned: input.inspections?.map((i) => i.path),
    ...input.contextOptions,
  });

  const messages: PromptMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  // Prior conversation, already trimmed by the caller.
  for (const turn of input.history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  const sections: string[] = [
    `# Project: ${input.projectName}`,
    '',
    '## Current file tree',
    ProjectContextManager.renderTree(input.files),
    '',
    '## File contents',
    context.render(),
  ];

  if (input.diagnostics?.length) {
    sections.push(
      '',
      '## Active diagnostics',
      ...input.diagnostics
        .slice(0, 20)
        .map((d) => `  [${d.severity}] ${d.code} ${d.file}:${d.line} — ${d.message}`),
    );
  }

  if (input.inspections?.length) {
    sections.push('', '## Files you requested');
    for (const i of input.inspections) {
      sections.push(
        i.found
          ? `--- ${i.path} ---\n${i.content ?? ''}`
          : `--- ${i.path} --- (does not exist)`,
      );
    }
  }

  sections.push('', '## User request', input.prompt);

  messages.push({ role: 'user', content: sections.join('\n') });
  return messages;
}

export function buildRepairMessages(input: {
  projectName: string;
  file: ProjectFile | undefined;
  diagnostic: { message: string; file: string; line: number; code: string };
  allFiles: ProjectFile[];
}): PromptMessage[] {
  const { diagnostic, file } = input;

  const body = [
    `# Project: ${input.projectName}`,
    '',
    '## Reported fault',
    `Code:     ${diagnostic.code}`,
    `Location: ${diagnostic.file}:${diagnostic.line}`,
    `Message:  ${diagnostic.message}`,
    '',
    `## Current contents of ${diagnostic.file}`,
    '```',
    file?.content ?? '(file not found in project)',
    '```',
    '',
    '## Other files in the project (names only)',
    input.allFiles
      .filter((f) => f.path !== diagnostic.file)
      .map((f) => `  ${f.path}`)
      .join('\n') || '  (none)',
  ].join('\n');

  return [
    { role: 'system', content: REPAIR_SYSTEM_PROMPT },
    { role: 'user', content: body },
  ];
}

/* ------------------------------------------------------------------ */
/* Response parsing - ROBUST PRODUCTION VERSION                        */
/* ------------------------------------------------------------------ */

/**
 * Extracts all balanced JSON objects from text, respecting string literals.
 * Returns them sorted by length descending (largest/most complete first).
 */
function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }

  // Longest first - most likely to be the full response
  return results.sort((a, b) => b.length - a.length);
}

/**
 * Cleans common JSON mistakes LLMs make:
 * - trailing commas in objects/arrays
 * - single quotes instead of double (only when safe)
 */
function cleanJsonString(str: string): string {
  // Remove trailing commas: ,} -> } and ,] -> ]
  return str.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Extracts a JSON object from a model response.
 *
 * Production-robust: handles:
 * - Direct valid JSON
 * - Markdown fenced blocks (```json ... ``` or ``` ... ```)
 * - Multiple fenced blocks (tries each)
 * - JSON wrapped in surrounding prose (extracts balanced objects)
 * - Trailing commas
 * - First { to last } slice
 * - Validation that result looks like expected structure
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  if (!text) {
    throw new Error('Model response did not contain parseable JSON');
  }

  const attempts: string[] = [];

  // 1. Direct attempt
  attempts.push(text);

  // 2. All fenced code blocks (```json ... ``` or ``` ... ```)
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    const inner = fenceMatch[1]?.trim();
    if (inner) attempts.push(inner);
  }

  // 3. First { to last } - common when model adds intro/outro text
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(text.slice(firstBrace, lastBrace + 1));
  }

  // 4. Balanced objects scan (handles nested structures correctly)
  attempts.push(...extractBalancedJsonObjects(text));

  // Try each candidate with and without cleaning
  for (const candidate of attempts) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    // Try cleaned version first (fixes trailing commas)
    const cleaned = cleanJsonString(trimmed);
    try {
      const parsed = JSON.parse(cleaned);
      // Basic validation that it's an object
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // Continue
    }

    // Try original without cleaning
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // Continue to next candidate
    }
  }

  // If we reach here, no valid JSON found
  throw new Error('Model response did not contain parseable JSON');
}

/** Validates that parsed JSON looks like an agent response */
function isValidAgentResponse(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  // Must have actions array and message string (core required fields)
  if (!Array.isArray(o.actions)) return false;
  if (typeof o.message !== 'string') return false;
  return true;
}

/** Normalises a parsed response into the shape the pipeline expects. */
export function parseAgentResponse(raw: string): AgentActionResponse {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    // Include snippet for debugging but truncate to avoid huge logs
    const snippet = raw.slice(0, 500).replace(/\n/g, '\\n');
    console.error('[CodeForge] Failed to parse agent response:', snippet);
    throw new Error(`Model response did not contain parseable JSON. Snippet: ${snippet.slice(0, 200)}...`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Model response JSON is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  // If model returned array directly (just actions), wrap it
  if (Array.isArray(parsed)) {
    return {
      intent: undefined,
      plan: undefined,
      actions: parsed as AgentActionResponse['actions'],
      message: 'Changes applied.',
    };
  }

  // Validate required structure
  if (!Array.isArray(obj.actions)) {
    // Try to recover: maybe actions is under different key or missing
    // If we have a valid object but no actions, treat as error with helpful message
    if (isValidAgentResponse(obj)) {
      // Valid structure but we already checked actions, so this shouldn't happen
    } else {
      // Check if it's actually a repair response or other shape
      const hasContent = typeof obj.content === 'string' || typeof obj.text === 'string';
      if (hasContent) {
        throw new Error('Model returned file content directly instead of structured actions JSON');
      }
      throw new Error('Model response JSON missing required "actions" array');
    }
  }

  const actions = Array.isArray(obj.actions) ? obj.actions : [];
  const message =
    typeof obj.message === 'string' && obj.message.trim()
      ? obj.message
      : typeof (obj as any).explanation === 'string'
        ? (obj as any).explanation
        : 'Changes applied.';

  return {
    intent: (obj.intent as AgentActionResponse['intent']) ?? undefined,
    plan: (obj.plan as AgentActionResponse['plan']) ?? undefined,
    actions: actions as AgentActionResponse['actions'],
    message,
  };
}

export interface ParsedRepair {
  analysis: string;
  suggestion: string;
  path: string;
  content: string;
  confidence: number;
}

export function parseRepairResponse(raw: string, fallbackPath: string): ParsedRepair {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    const snippet = raw.slice(0, 500).replace(/\n/g, '\\n');
    console.error('[CodeForge] Failed to parse repair response:', snippet);
    throw new Error(`Repair response did not contain parseable JSON. Snippet: ${snippet.slice(0, 200)}...`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Repair response JSON is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  return {
    analysis: typeof obj.analysis === 'string' ? obj.analysis : 'No analysis provided.',
    suggestion: typeof obj.suggestion === 'string' ? obj.suggestion : 'No suggestion provided.',
    path: typeof obj.path === 'string' && obj.path ? obj.path : fallbackPath,
    content: typeof obj.content === 'string' ? obj.content : '',
    confidence:
      typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
  };
}
