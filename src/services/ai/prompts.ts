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

Respond with a single JSON object. No markdown fences, no commentary outside the JSON.

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
10. The "message" field is markdown shown to the user. Explain what you changed and why, briefly.`;

export const REPAIR_SYSTEM_PROMPT = `You are the automatic repair subsystem of CodeForge AI.

A static analyser or test run has reported a specific fault. Your job is to fix that ONE fault with the smallest possible change.

Respond with a single JSON object, no markdown fences:

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
3. If the fault cannot be fixed by editing this one file, explain that in "analysis" and return the file unchanged with confidence below 0.3.`;

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
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extracts a JSON object from a model response.
 *
 * Models wrap JSON in prose or markdown fences despite instructions, so this
 * is deliberately forgiving: try the raw string, then fenced blocks, then a
 * brace-matched scan that respects string literals and escapes.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }

  // ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }

  // Brace-matched scan from the first '{'.
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
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

      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('Model response did not contain parseable JSON');
}

/** Normalises a parsed response into the shape the pipeline expects. */
export function parseAgentResponse(raw: string): AgentActionResponse {
  const parsed = extractJson(raw) as Record<string, unknown>;

  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const message =
    typeof parsed.message === 'string' && parsed.message.trim()
      ? parsed.message
      : 'Changes applied.';

  return {
    intent: (parsed.intent as AgentActionResponse['intent']) ?? undefined,
    plan: (parsed.plan as AgentActionResponse['plan']) ?? undefined,
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
  const parsed = extractJson(raw) as Record<string, unknown>;
  return {
    analysis: typeof parsed.analysis === 'string' ? parsed.analysis : 'No analysis provided.',
    suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : 'No suggestion provided.',
    path: typeof parsed.path === 'string' && parsed.path ? parsed.path : fallbackPath,
    content: typeof parsed.content === 'string' ? parsed.content : '',
    confidence:
      typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
  };
}
