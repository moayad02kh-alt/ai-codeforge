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

export const SYSTEM_PROMPT = `You are the coding agent inside CodeForge AI, a web-based development platform. You are also a helpful, knowledgeable software engineering assistant the user can talk to naturally.

You handle TWO kinds of turns, and you decide which based on the user's message:

A) CONVERSATION / QUESTIONS — greetings, general chat, ideas, advice, explanations, or coding help that does NOT require changing the project right now.
   Respond as a normal AI assistant: put a clear, helpful markdown answer in "message", set "intent.kind" to "chat" (or "explain" when explaining the current project), and return an EMPTY "actions" array: []. Do NOT create, edit, or touch files, and never invent file changes just to return an action.

B) CODING REQUESTS — the user asks to build, create, scaffold, edit, fix, refactor, or modify the project.
   Return STRUCTURED ACTIONS the platform executes against the real project file tree, plus a short "message" describing what you changed and why.

MIXED turns (a question AND a change): briefly answer in "message" AND return the actions that make the change. If they only ask "should I / how would you" and have not committed to a change yet, prefer conversation (empty actions) with your recommendation.

## Response format

Respond with a single JSON object. No markdown fences, no commentary outside the JSON. The JSON MUST be valid and parseable.

{
  "intent": {
    "kind": "create-project" | "modify-project" | "fix-error" | "explain" | "chat",
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
12. ACTIONS BY TURN TYPE:
   - For CODING requests (create-project / modify-project / fix-error) you MUST return at least one file action (create_file or update_file). An empty actions array is NEVER acceptable for those. For a Todo app, create index.html, styles/main.css, and scripts/main.js at minimum.
   - For CONVERSATION (intent.kind = "chat" or "explain") you MUST return "actions": [] and put your answer in "message". Do not modify files unless the user explicitly asked for a change.
13. STORAGE SAFETY: The preview runs in a sandboxed iframe WITHOUT allow-same-origin, so direct window.localStorage access throws SecurityError. NEVER use localStorage directly. ALWAYS use this safe wrapper that handles SecurityError and falls back to in-memory storage:

const safeStorage = (() => {
  let memory = {};
  let useMemory = false;
  try {
    const test = '__cf_test__';
    window.localStorage.setItem(test, '1');
    window.localStorage.removeItem(test);
  } catch (e) { useMemory = true; }
  return {
    getItem(k) { if (useMemory) return memory[k] ?? null; try { return window.localStorage.getItem(k); } catch { return memory[k] ?? null; } },
    setItem(k,v) { if (useMemory) { memory[k]=String(v); return; } try { window.localStorage.setItem(k,String(v)); } catch { memory[k]=String(v); } },
    removeItem(k) { if (useMemory) { delete memory[k]; return; } try { window.localStorage.removeItem(k); } catch { delete memory[k]; } },
    clear() { if (useMemory) { memory={}; return; } try { window.localStorage.clear(); } catch {} memory={}; },
    key(i) { if (useMemory) return Object.keys(memory)[i]||null; try { return window.localStorage.key(i); } catch { return Object.keys(memory)[i]||null; } },
    get length() { if (useMemory) return Object.keys(memory).length; try { return window.localStorage.length; } catch { return Object.keys(memory).length; } }
  };
})();

Use safeStorage.getItem/setItem/removeItem instead of localStorage. Include this wrapper at the top of any JS file that needs persistence. This prevents SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.`;

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
/* Response parsing - PRODUCTION-GRADE STRUCTURED PARSER               */
/* ------------------------------------------------------------------ */

/**
 * Counts backslashes immediately preceding position `pos` in `str`.
 * If odd, the char at `pos` is escaped; if even, not escaped.
 * This correctly handles \\, \\\", \\\" etc inside JSON strings.
 */
function isEscaped(str: string, pos: number): boolean {
  let count = 0;
  let i = pos - 1;
  while (i >= 0 && str[i] === '\\') {
    count++;
    i--;
  }
  return count % 2 === 1;
}

/**
 * Finds the matching closing brace for a JSON object starting at `start`.
 * `start` must point at `{`. Returns index of matching `}` or -1 if not found.
 * Correctly handles:
 *  - quoted strings with escaped quotes
 *  - escaped backslashes, newlines, etc.
 *  - nested objects/arrays
 *  - never truncates content inside strings
 */
function findObjectEnd(text: string, start: number): number {
  if (text[start] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let inSingleString = false; // tolerate single-quoted (some models)

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    // Handle string boundaries
    if (!inSingleString && ch === '"' && !isEscaped(text, i)) {
      inString = !inString;
      continue;
    }
    if (!inString && ch === "'" && !isEscaped(text, i)) {
      // Single quotes are not valid JSON but some models use them
      inSingleString = !inSingleString;
      continue;
    }
    if (inString || inSingleString) continue;

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        // Ensure we started with { and are closing with }
        // For object, we want matching } for the initial {
        // Depth includes both { and [, so check we are at object close
        // Actually depth counts both, so when depth hits 0, we've closed outermost
        return i;
      }
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Extracts all balanced JSON objects from text, respecting string literals,
 * escaped quotes, backslashes, and nested structures.
 * Returns candidates sorted by length descending (largest first) and
 * by whether they look like agent responses (have "actions").
 */
function extractBalancedJsonObjects(text: string): string[] {
  const results: Array<{ json: string; score: number; start: number }> = [];
  let i = 0;

  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;

    // Skip if this { is inside a string (check by scanning from 0 to start for unclosed string)
    // Instead, we just try to find end; if inside string, findObjectEnd will handle
    // but we need to ensure start is not escaped and not inside string
    // Quick check: count if we're inside string at start by scanning from last candidate end
    // Simpler: attempt to find end regardless; if it returns -1, move past start

    const end = findObjectEnd(text, start);
    if (end !== -1) {
      const candidate = text.slice(start, end + 1);
      // Score: +1000 if contains "actions", + length
      let score = candidate.length;
      if (candidate.includes('"actions"') || candidate.includes("'actions'")) score += 10000;
      if (candidate.includes('"message"')) score += 1000;
      results.push({ json: candidate, score, start });
      // Move past this object to find next, but also allow overlapping by moving 1 char
      // To avoid O(n^2) on huge files, jump to end
      i = end + 1;
    } else {
      // No matching end found — maybe truncated. Try next {
      i = start + 1;
    }
  }

  // Sort by score descending, then length descending
  results.sort((a, b) => b.score - a.score || b.json.length - a.json.length);

  // Deduplicate by content
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const r of results) {
    if (!seen.has(r.json)) {
      seen.add(r.json);
      deduped.push(r.json);
    }
  }

  return deduped;
}

/**
 * Removes trailing commas outside of strings.
 * This fixes common LLM mistake: {"a":1,} or [1,2,]
 * String-aware: never touches commas inside quoted strings.
 */
function removeTrailingCommasOutsideStrings(jsonStr: string): string {
  let result = '';
  let inString = false;
  let inSingleString = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (!inSingleString && ch === '"' && !isEscaped(jsonStr, i)) {
      inString = !inString;
      result += ch;
      continue;
    }
    if (!inString && ch === "'" && !isEscaped(jsonStr, i)) {
      inSingleString = !inSingleString;
      result += ch;
      continue;
    }

    if (inString || inSingleString) {
      result += ch;
      continue;
    }

    // Outside string: check for trailing comma before } or ]
    if (ch === ',') {
      let j = i + 1;
      while (j < jsonStr.length && /\s/.test(jsonStr[j])) j++;
      if (j < jsonStr.length && (jsonStr[j] === '}' || jsonStr[j] === ']')) {
        // Skip this comma (trailing comma)
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/**
 * Scrubs potential secrets from text before including in diagnostics.
 * Prevents API keys from leaking in error messages.
 */
function scrubSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, 'AIza***')
    .replace(/key=[A-Za-z0-9_-]{8,}/gi, 'key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
    .replace(/"apiKey"\s*:\s*"[^"]+"/gi, '"apiKey":"***"')
    .replace(/'apiKey'\s*:\s*'[^']+'/gi, "'apiKey':'***'");
}

/**
 * Returns a safe snippet for diagnostics: first `max` chars, newlines escaped,
 * secrets scrubbed, and truncated safely.
 */
function safeSnippet(text: string, max = 400): string {
  const scrubbed = scrubSecrets(text);
  const sliced = scrubbed.slice(0, max);
  // Escape newlines for one-line display, but keep some structure
  return sliced.replace(/\n/g, '\\n').replace(/\r/g, '\\r').slice(0, max);
}

/**
 * Tries to parse a candidate JSON string, collecting detailed error info.
 * Returns { parsed, error, candidate }.
 */
function tryParseCandidate(candidate: string): { parsed?: unknown; error?: string; candidate: string } {
  const trimmed = candidate.trim();
  if (!trimmed) return { error: 'Empty candidate', candidate };

  // Attempt 1: direct parse
  try {
    const parsed = JSON.parse(trimmed);
    return { parsed, candidate };
  } catch (e1) {
    const err1 = (e1 as Error).message;

    // Attempt 2: remove trailing commas outside strings (common LLM error)
    try {
      const cleaned = removeTrailingCommasOutsideStrings(trimmed);
      if (cleaned !== trimmed) {
        const parsed = JSON.parse(cleaned);
        return { parsed, candidate: cleaned };
      }
    } catch (e2) {
      // Continue
    }

    // Attempt 3: try to handle single quotes around keys (some models)
    // Only if it looks like it might be single-quoted JSON
    if (trimmed.includes("'") && trimmed.includes('"actions"') === false) {
      try {
        // Very conservative: replace single-quoted keys with double-quoted
        // This is risky, so only attempt if it looks like JSON with single quotes
        const singleToDouble = trimmed.replace(/'([^']+)'\s*:/g, '"$1":');
        const parsed = JSON.parse(singleToDouble);
        return { parsed, candidate: singleToDouble };
      } catch {
        // Continue
      }
    }

    return { error: err1, candidate };
  }
}

/**
 * Extracts a JSON object from a model response.
 *
 * Production-grade:
 * - Prefers direct JSON
 * - Extracts from markdown fences
 * - Uses character-by-character scanner understanding quoted strings and escaped quotes
 * - Handles HTML/CSS/JS inside string values without truncating
 * - Removes trailing commas only outside strings
 * - Validates structure
 * - Returns diagnostic with exact failure if all attempts fail
 *
 * CRITICAL FIX for Gemini truncation bug:
 * When outer JSON is truncated, inner action objects like {"type":"update_file","path":"...","content":":root {...}"}
 * may still be valid JSON. Previously we returned the first valid JSON (inner action), which has content field
 * but no actions array, causing false "file content directly" error even though raw contains {"actions":[...]}.
 * Now we prioritize candidates with "actions" array and skip inner action objects when raw contains actions keyword.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  if (!text) {
    throw new Error(
      `Model response did not contain parseable JSON. Diagnostic: empty response. Snippet: ${safeSnippet(raw, 200)}`,
    );
  }

  const candidates: string[] = [];
  const diagnostics: Array<{ candidatePreview: string; error: string }> = [];

  // Detect if raw contains actions keyword - used to avoid returning inner action objects
  const rawContainsActions =
    text.includes('"actions"') || text.includes("'actions'") || text.includes('"actions" :') || text.includes('actions');

  // 1. Direct attempt: if entire response looks like JSON object
  if (text.startsWith('{') && text.endsWith('}')) {
    candidates.push(text);
  }

  // 2. All fenced code blocks (```json ... ``` or ``` ... ```)
  // This handles markdown-wrapped responses
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    const inner = fenceMatch[1]?.trim();
    if (inner && inner.includes('{') && inner.includes('}')) {
      candidates.push(inner);
    }
  }

  // 3. Balanced objects scan (production-grade scanner) - already scored by actions
  const balanced = extractBalancedJsonObjects(text);
  candidates.push(...balanced);

  // 4. First { to last } as fallback (for surrounding prose)
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = text.slice(firstBrace, lastBrace + 1);
    // Only add if not already in candidates (avoid duplicates)
    if (!candidates.includes(slice)) {
      candidates.push(slice);
    }
  }

  // Deduplicate candidates while preserving order, but also sort by actions priority
  // We want candidates containing "actions" to be tried first
  const seen = new Set<string>();
  const uniqueCandidates: Array<{ json: string; score: number }> = [];
  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      let score = c.length;
      if (c.includes('"actions"') || c.includes("'actions'")) score += 10000;
      if (c.includes('"message"')) score += 1000;
      // Penalize candidates that look like single file actions (type + path + content but no actions)
      // These are likely inner objects extracted from truncated outer JSON
      const looksLikeSingleAction =
        (c.includes('"type"') || c.includes("'type'")) &&
        (c.includes('"path"') || c.includes("'path'")) &&
        (c.includes('"content"') || c.includes("'content'")) &&
        !c.includes('"actions"') &&
        !c.includes("'actions'");
      if (looksLikeSingleAction && rawContainsActions) {
        score -= 5000; // Deprioritize inner actions when outer should exist
      }
      uniqueCandidates.push({ json: c, score });
    }
  }

  // Sort by score descending - ensures actions-containing candidates tried first
  uniqueCandidates.sort((a, b) => b.score - a.score);

  // Try each candidate in score order
  for (const { json: candidate, score } of uniqueCandidates) {
    const result = tryParseCandidate(candidate);
    if (result.parsed !== undefined) {
      // Validate it's an object
      if (typeof result.parsed === 'object' && result.parsed !== null) {
        const parsedObj = result.parsed as Record<string, unknown>;

        // CRITICAL: If raw contains actions keyword but this candidate doesn't have actions array,
        // it's likely an inner action object from truncated JSON. Don't return it immediately.
        // Instead, record diagnostic and continue searching for a candidate with actions.
        const hasActionsArray = Array.isArray(parsedObj.actions);
        const isSingleAction =
          typeof parsedObj.type === 'string' && typeof parsedObj.path === 'string' && typeof parsedObj.content === 'string';

        if (!hasActionsArray && rawContainsActions && isSingleAction) {
          diagnostics.push({
            candidatePreview: safeSnippet(candidate, 200),
            error: `Skipped inner action object (type=${parsedObj.type}, path=${parsedObj.path}) - raw contains actions keyword but candidate missing actions array, likely truncated outer JSON`,
          });
          continue; // Try next candidate that might have actions array
        }

        // If candidate has actions array, return immediately (highest priority)
        if (hasActionsArray) {
          return result.parsed;
        }

        // If raw does NOT contain actions, it's okay to return candidate without actions
        // (will be handled as file-content-directly or missing-actions in parseAgentResponse)
        if (!rawContainsActions) {
          return result.parsed;
        }

        // Raw contains actions but candidate doesn't have actions and isn't single action
        // (e.g., candidate is {"content": "..."}), still don't return if we haven't exhausted actions candidates
        // Collect diagnostic and continue
        diagnostics.push({
          candidatePreview: safeSnippet(candidate, 200),
          error: `Candidate missing actions array but raw contains actions keyword`,
        });
        // If this candidate is not a single action, we still might want to return it as last resort
        // But only after trying all higher-scored candidates
        // For now, continue to next candidate
        continue;
      }
    } else if (result.error) {
      diagnostics.push({
        candidatePreview: safeSnippet(candidate, 200),
        error: result.error,
      });
    }
  }

  // If we reach here, no candidate with actions array succeeded
  // Check if we skipped inner action objects due to truncation - if so, report truncation
  const hasSkippedInnerAction = diagnostics.some((d) => d.error.includes('Skipped inner action object'));

  // All attempts failed — build diagnostic
  const snippet = safeSnippet(raw, 500);
  const diagDetails = diagnostics
    .slice(0, 3)
    .map((d, i) => `#${i + 1} ${d.error} | preview: ${d.candidatePreview.slice(0, 100)}`)
    .join('; ');

  if (hasSkippedInnerAction || rawContainsActions) {
    throw new Error(
      `Model response did not contain parseable JSON. ` +
        `Tried ${uniqueCandidates.length} candidate(s) but outer JSON with actions array failed to parse (likely truncated). ` +
        `Failures: ${diagDetails || 'no candidates found'}. ` +
        `Snippet: ${snippet.slice(0, 300)}... ` +
        `Hint: Response may be truncated (check maxOutputTokens, finishReason) or contain unescaped quotes/newlines inside content string. ` +
        `Raw contains actions keyword but no valid outer JSON was found - inner action objects were skipped to avoid false file-content error.`,
    );
  }

  throw new Error(
    `Model response did not contain parseable JSON. ` +
      `Tried ${uniqueCandidates.length} candidate(s). ` +
      `Failures: ${diagDetails || 'no candidates found'}. ` +
      `Snippet: ${snippet.slice(0, 300)}... ` +
      `Hint: Response may be truncated or contain unescaped quotes/newlines inside content string. ` +
      `Ensure content is properly JSON-escaped.`,
  );
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

/** Normalises a parsed response into the shape the pipeline expects.
 *
 * CRITICAL FIX: Validates STRUCTURE first (object, actions array, supported type, path, content, message)
 * and ONLY rejects as raw file content if TOP-LEVEL response itself is raw file, not when content field
 * contains file. The content field of update_file action is SUPPOSED to contain complete HTML/CSS/JS.
 *
 * If response parses into {actions:[{type, path, content}], message} it MUST be accepted.
 * Never classify content of update_file action as file content directly.
 * Remove/fix any heuristic detecting ":root {", "<!doctype html>", "function..." as raw file.
 */
export function parseAgentResponse(raw: string): AgentActionResponse {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    // Include safe snippet, scrubbed
    const snippet = safeSnippet(raw, 500);
    console.error('[CodeForge] Failed to parse agent response:', snippet, 'Error:', (err as Error).message);
    // Re-throw with safe diagnostic (already scrubbed in extractJson)
    throw err;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      `Model response JSON is not an object. Snippet: ${safeSnippet(JSON.stringify(parsed), 200)}`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  // If model returned array directly (just actions), wrap it - accept as valid
  if (Array.isArray(parsed)) {
    // Validate each action in array has required structure
    for (let i = 0; i < parsed.length; i++) {
      const a = parsed[i] as Record<string, unknown>;
      if (typeof a !== 'object' || a === null) continue;
      if (typeof a.type !== 'string') {
        throw new Error(`Action #${i} missing required "type". Snippet: ${safeSnippet(JSON.stringify(a), 150)}`);
      }
    }
    return {
      intent: undefined,
      plan: undefined,
      actions: parsed as AgentActionResponse['actions'],
      message: 'Changes applied.',
    };
  }

  // STRUCTURE VALIDATION FIRST: Check if actions array exists
  // This is the primary validation - if actions array exists, MUST accept regardless of content
  if (Array.isArray(obj.actions)) {
    const actions = obj.actions;
    const message =
      typeof obj.message === 'string' && obj.message.trim()
        ? obj.message
        : typeof (obj as Record<string, unknown>).explanation === 'string'
          ? ((obj as Record<string, unknown>).explanation as string)
          : 'Changes applied.';

    // Validate each action conforms to expected schema (type, path, content)
    // NOTE: content field is SUPPOSED to contain complete HTML/CSS/JS file, including
    // ":root {", "<!doctype html>", "function..." etc. Never reject based on content containing those.
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i] as Record<string, unknown>;
      if (typeof a !== 'object' || a === null) {
        throw new Error(`Action #${i} is not an object. Snippet: ${safeSnippet(JSON.stringify(a), 100)}`);
      }
      if (typeof a.type !== 'string') {
        throw new Error(`Action #${i} missing required "type". Got: ${safeSnippet(JSON.stringify(a), 150)}`);
      }
      const allowedTypes = ['create_file', 'update_file', 'delete_file', 'rename_file', 'inspect_file', 'run_check', 'repair_error'];
      if (!allowedTypes.includes(a.type as string)) {
        // Allow but warn - don't reject unknown types strictly
        console.warn(`[CodeForge] Unknown action type: ${a.type}`);
      }
      if ((a.type === 'create_file' || a.type === 'update_file' || a.type === 'repair_error') && typeof a.path !== 'string') {
        throw new Error(`Action #${i} (${a.type}) missing required "path". Snippet: ${safeSnippet(JSON.stringify(a), 150)}`);
      }
      // content can be large HTML/CSS/JS - validate it's string if present, but NEVER check its value
      // for file patterns like :root, doctype, function - content is SUPPOSED to be file content
      if ((a.type === 'create_file' || a.type === 'update_file' || a.type === 'repair_error') && a.content !== undefined && typeof a.content !== 'string') {
        throw new Error(`Action #${i} content must be string for ${a.type}. Got ${typeof a.content}`);
      }
      // message is optional string
    }

    // Message validation: optional string
    if (obj.message !== undefined && typeof obj.message !== 'string') {
      console.warn(`[CodeForge] message field should be string, got ${typeof obj.message}, using default`);
    }

    return {
      intent: (obj.intent as AgentActionResponse['intent']) ?? undefined,
      plan: (obj.plan as AgentActionResponse['plan']) ?? undefined,
      actions: actions as AgentActionResponse['actions'],
      message,
    };
  }

  // At this point, actions array is missing - need to determine if this is:
  // 1. Truncated JSON where raw contains actions but we extracted inner object (should be parse error, not file content directly)
  // 2. Genuine file content directly (model returned file without actions wrapper)
  // 3. Missing actions array entirely

  // CRITICAL: Check if raw contains actions keyword - if yes, this is NOT file content directly
  // It's a parsing failure where outer JSON with actions failed to parse and we got inner object
  const rawContainsActions = raw.includes('"actions"') || raw.includes("'actions'");
  if (rawContainsActions) {
    throw new Error(
      `Model response did not contain parseable JSON. Diagnostic: extracted object missing actions array but raw contains actions keyword - likely truncated or inner extraction. ` +
        `Got keys: ${Object.keys(obj).join(', ')}. Snippet: ${safeSnippet(raw, 300)}... ` +
        `Hint: This often happens when outer JSON is truncated (check maxOutputTokens) - inner action objects were found but outer failed.`,
    );
  }

  // Only now check if top-level response itself is raw file content
  // Top-level is raw file if it has content/text field but no actions, AND raw does NOT contain actions keyword
  // This is the ONLY case where we should throw file content directly error
  const hasContent = typeof obj.content === 'string' || typeof obj.text === 'string';
  if (hasContent) {
    // This is genuine file content directly case: JSON like {"content": ":root {...}"} or {"text": "<html>..."}
    // without actions array and without actions keyword in raw
    throw new Error(
      `Model returned file content directly instead of structured actions JSON. Snippet: ${safeSnippet(raw, 200)}`,
    );
  }

  // Check if raw itself looks like raw file (CSS/HTML/JS) without JSON wrapper
  // This handles case where model returned ":root {...}" or "<!doctype html>..." directly
  const trimmedLower = raw.trim().toLowerCase();
  const looksLikeRawFile =
    trimmedLower.startsWith(':root') ||
    trimmedLower.startsWith('<!doctype') ||
    trimmedLower.startsWith('<html') ||
    trimmedLower.startsWith('body {') ||
    trimmedLower.startsWith('function ') ||
    trimmedLower.startsWith('const ') ||
    trimmedLower.startsWith('import ') ||
    trimmedLower.startsWith('@import') ||
    trimmedLower.startsWith('/*');

  if (looksLikeRawFile) {
    throw new Error(
      `Model returned file content directly instead of structured actions JSON. Snippet: ${safeSnippet(raw, 200)}`,
    );
  }

  throw new Error(
    `Model response JSON missing required "actions" array. Got keys: ${Object.keys(obj).join(', ')}. Snippet: ${safeSnippet(raw, 200)}`,
  );
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
    const snippet = safeSnippet(raw, 500);
    console.error('[CodeForge] Failed to parse repair response:', snippet, 'Error:', (err as Error).message);
    throw err;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Repair response JSON is not an object. Snippet: ${safeSnippet(raw, 200)}`);
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
