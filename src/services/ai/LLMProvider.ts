/**
 * LLMProvider — the real, provider-agnostic coding agent client.
 *
 * Implements the SAME `AIProvider` interface the app already depended on, so
 * the orchestrator, store and UI are untouched. It talks only to our own
 * backend (`/api/agent/*`) — never directly to a vendor, and never with an
 * API key in the browser.
 *
 * Flow:
 *   buildAgentMessages (with budgeted project context)
 *     → POST /api/agent/generate
 *       → parse JSON response
 *         → validate structured actions
 *           → if the model asked to inspect files, loop with those contents
 *             → return files + prose message
 *
 * The vendor (OpenAI / Anthropic / Gemini) is chosen server-side, so adding
 * a provider requires zero frontend changes.
 */

import type { AgentIntent, AgentPlan, AgentPlanTask, Diagnostic, ProjectFile } from '../../core/types';
import { uid } from '../../core/utils';
import {
  ActionExecutor,
  isMutating,
  validateActions,
  type CodingAction,
} from './actions';
import type {
  AIProvider,
  GenerationContext,
  GenerationResult,
  RepairSuggestion,
} from './AIProvider';
import {
  buildAgentMessages,
  buildRepairMessages,
  parseAgentResponse,
  parseRepairResponse,
  type PromptMessage,
} from './prompts';

export interface LLMProviderOptions {
  /** Base path of the backend routes. */
  baseUrl?: string;
  /** Overrides the server's default model. */
  model?: string;
  temperature?: number;
  /** Forces a specific server-side vendor. */
  provider?: 'openai' | 'anthropic' | 'gemini';
  /** Extra headers, e.g. a session token from your auth system. */
  headers?: Record<string, string>;
  /** Max inspect_file round-trips before giving up. */
  maxInspectionRounds?: number;
  label?: string;
}

export interface BackendStatus {
  configured: boolean;
  activeProvider: string | null;
  activeModel: string | null;
  providers: Array<{ id: string; label: string; configured: boolean; defaultModel: string }>;
}

interface ChatResponse {
  text: string;
  usage?: { promptTokens: number; completionTokens: number };
  model?: string;
  provider?: string;
}

/**
 * Per-run scratch state.
 *
 * `classifyIntent` → `createPlan` → `generate` are three separate interface
 * calls, but a real model should only be invoked ONCE for all three. So the
 * first call performs the request and caches intent/plan/actions here; the
 * later calls read from the cache. This is what keeps cost and latency sane.
 */
interface RunCache {
  prompt: string;
  intent?: AgentIntent;
  plan?: AgentPlan;
  result?: GenerationResult;
  error?: Error;
}

export class LLMProvider implements AIProvider {
  readonly id: string;
  readonly label: string;
  readonly isLive = true;

  private readonly baseUrl: string;
  private readonly maxInspectionRounds: number;
  private cache: RunCache | null = null;

  /** Populated by `probe()`; drives the UI badge and settings display. */
  status: BackendStatus | null = null;

  constructor(private readonly options: LLMProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/agent';
    this.maxInspectionRounds = options.maxInspectionRounds ?? 2;
    this.id = options.provider ?? 'llm';
    this.label = options.label ?? 'Live model';
  }

  /* ---------------- backend plumbing ---------------- */

  /** Checks whether the backend has a provider configured. */
  static async probe(baseUrl = '/api/agent', signal?: AbortSignal): Promise<BackendStatus | null> {
    // Use a short timeout for the probe so the UI doesn't hang on "Failed to fetch"
    const timeout = 6000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const combinedSignal = signal
      ? (() => {
          // Merge external signal with our timeout signal
          if (signal.aborted) ctrl.abort();
          else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
          return ctrl.signal;
        })()
      : ctrl.signal;

    try {
      const res = await fetch(`${baseUrl}/status`, {
        signal: combinedSignal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 404/503 means backend reachable but not configured -> treat as not live, fallback to sim
        // 5xx or 4xx still means backend exists, just not ready
        return null;
      }
      const json = (await res.json().catch(() => null)) as BackendStatus | null;
      return json && typeof json.configured === 'boolean' ? json : null;
    } catch (err) {
      clearTimeout(timer);
      const e = err as Error;
      // Network errors, timeouts, CORS, offline -> fallback to simulation silently
      // Log only in dev for debugging
      if (e?.name !== 'AbortError') {
        console.debug('[CodeForge] Backend probe failed, using simulated mode:', e?.message);
      }
      return null;
    }
  }

  private isNetworkError(err: unknown): boolean {
    const msg = (err as Error)?.message?.toLowerCase() ?? '';
    const name = (err as Error)?.name ?? '';
    return (
      name === 'TypeError' ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('fetch') ||
      name === 'NetworkError'
    );
  }

  private async chat(
    route: 'generate' | 'repair',
    messages: PromptMessage[],
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const makeRequest = async (): Promise<Response> => {
      return await fetch(`${this.baseUrl}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.options.headers ?? {}) },
        body: JSON.stringify({
          messages,
          model: this.options.model,
          temperature: this.options.temperature ?? 0.3,
          provider: this.options.provider,
        }),
        signal,
      });
    };

    let res: Response;
    try {
      res = await makeRequest();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      if (this.isNetworkError(err)) {
        throw Object.assign(
          new Error(
            `Cannot reach AI backend at ${this.baseUrl}/${route} — the server may be down, restarting, or blocked by network/CORS. ` +
              `If you're on Render, wait 20-30s for the service to wake up and try again. The app will continue in simulated mode if the backend stays unreachable. ` +
              `Original: ${(err as Error).message}`,
          ),
          { code: 'NETWORK_ERROR', cause: err },
        );
      }
      throw err;
    }

    let data: ChatResponse & { error?: string; code?: string; hint?: string };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      data = {} as typeof data;
    }

    if (!res.ok) {
      const code = (data as { code?: string })?.code ?? '';
      // Provider not configured -> clear message so orchestrator can fallback or show hint
      if (res.status === 503 || code === 'PROVIDER_NOT_CONFIGURED') {
        throw Object.assign(
          new Error(
            data.error ||
              'No AI provider is configured on the server. The app is running in simulated mode. Set an API key in .env (or Render env vars) to enable live mode.',
          ),
          { code: 'PROVIDER_NOT_CONFIGURED', status: 503 },
        );
      }
      if (res.status === 429 || code === 'RATE_LIMITED') {
        throw Object.assign(
          new Error(
            data.error || 'Too many requests — the AI backend is rate-limited. Please wait a minute and try again.',
          ),
          { code: 'RATE_LIMITED', status: 429 },
        );
      }
      if (res.status === 504 || code === 'UPSTREAM_TIMEOUT') {
        throw Object.assign(
          new Error(
            data.error ||
              'The AI model took too long to respond and the request timed out. Please try again with a shorter prompt or try again in a moment.',
          ),
          { code: 'UPSTREAM_TIMEOUT', status: 504 },
        );
      }
      throw Object.assign(new Error(data.error || `Backend returned ${res.status}: ${res.statusText}`), {
        code: code || `HTTP_${res.status}`,
        status: res.status,
      });
    }
    if (!data.text) {
      throw Object.assign(new Error('Model returned an empty response — please try again.'), {
        code: 'EMPTY_RESPONSE',
      });
    }
    return data;
  }

  /* ---------------- the single real request ---------------- */

  /**
   * Runs the full agent turn, including the inspect_file loop.
   * Cached per prompt so the three interface methods share one model call.
   */
  private async run(ctx: GenerationContext): Promise<RunCache> {
    if (this.cache && this.cache.prompt === ctx.prompt) return this.cache;

    const cache: RunCache = { prompt: ctx.prompt };
    this.cache = cache;

    try {
      const diagnostics = ctx.diagnostics;
      let inspections: Array<{ path: string; found: boolean; content?: string }> = [];
      let files = ctx.files;
      let round = 0;

      for (;;) {
        const messages = buildAgentMessages({
          prompt: ctx.prompt,
          files,
          history: ctx.history,
          projectName: ctx.projectName,
          diagnostics,
          inspections,
          entryPath: 'index.html',
        });

        const response = await this.chat('generate', messages, ctx.signal);
        let parsed;
        try {
          parsed = parseAgentResponse(response.text);
        } catch (parseErr) {
          console.error('[CodeForge] Parse failed, raw snippet:', response.text.slice(0, 800));
          throw parseErr;
        }

        const { valid, rejected } = validateActions(parsed.actions);

        // Log validation results for debugging pipeline issues
        if (rejected.length > 0) {
          console.warn(`[CodeForge] ${rejected.length} actions rejected:`, rejected.map(r => r.reason).join('; '));
        }

        // Critical fix: If model returned no valid actions at all, don't silently succeed with 0 files
        // This was causing "Plan: 0 tasks, 0 files" for valid requests like Todo app
        if (valid.length === 0 && !parsed.actions.some((a: any) => a.type === 'inspect_file')) {
          const rejectedInfo = rejected.length ? ` Rejected: ${rejected.map(r => r.reason).join(', ')}` : '';
          const rawSnippet = response.text.slice(0, 600).replace(/\n/g, '\\n');
          // If model returned empty array, throw informative error so orchestrator shows failure
          // rather than silent 0-file success
          if (parsed.actions.length === 0) {
            throw new Error(
              `Model returned no file actions for request "${ctx.prompt.slice(0, 80)}...". ` +
              `This usually means the model needs more specific instructions or the response was truncated.${rejectedInfo} ` +
              `Raw snippet: ${rawSnippet.slice(0, 200)}...`
            );
          }
          // If all actions were rejected, also throw with details
          if (rejected.length > 0) {
            throw new Error(
              `All ${rejected.length} actions were rejected by validation: ${rejected.map(r => r.reason).join('; ')}. ` +
              `Raw: ${rawSnippet.slice(0, 200)}...`
            );
          }
        }

        // The model asked to read files and made no changes yet — feed them
        // back and let it try again. Bounded to avoid an infinite loop.
        const inspectOnly =
          valid.length > 0 && valid.every((a) => a.type === 'inspect_file');

        if (inspectOnly && round < this.maxInspectionRounds) {
          const exec = ActionExecutor.execute(files, valid);
          inspections = exec.inspections;
          round += 1;
          continue;
        }

        cache.intent = this.toIntent(parsed.intent, ctx);
        cache.plan = this.toPlan(parsed.plan, cache.intent, valid);
        cache.result = this.toResult(files, valid, rejected, parsed.message, response);
        return cache;
      }
    } catch (err) {
      cache.error = err instanceof Error ? err : new Error(String(err));
      return cache;
    }
  }

  /* ---------------- normalisation ---------------- */

  private toIntent(
    raw: { kind?: string; restatement?: string; domain?: string; keywords?: string[]; confidence?: number } | undefined,
    ctx: GenerationContext,
  ): AgentIntent {
    const allowed = ['create-project', 'modify-project', 'fix-error', 'explain'] as const;
    
    // Enhanced detection for create-project requests
    // The old logic used only files.length, which caused "Build a Todo app" to be
    // classified as modify-project when files already exist, leading to 0 actions
    const lowerPrompt = ctx.prompt.toLowerCase();
    const isExplicitCreate =
      /\b(build|create|make|scaffold|generate)\b/.test(lowerPrompt) &&
      /\b(app|project|website|site|todo|dashboard|blog|store|landing|portfolio)\b/.test(lowerPrompt);
    const isFromScratch = lowerPrompt.includes('from scratch') || lowerPrompt.includes('new project') || lowerPrompt.includes('simple todo');

    let kind: AgentIntent['kind'];
    if (raw?.kind && allowed.includes(raw.kind as (typeof allowed)[number])) {
      kind = raw.kind as AgentIntent['kind'];
      // Override: if user explicitly asks to build/create an app, force create-project
      // even if model returned modify-project, when files exist but request is clearly for new app
      if (isExplicitCreate && (kind === 'modify-project' || kind === 'explain')) {
        kind = 'create-project';
      }
    } else {
      // Fallback logic: if explicit create request, treat as create-project regardless of existing files
      if (isExplicitCreate || isFromScratch) {
        kind = 'create-project';
      } else {
        kind = ctx.files.length === 0 ? 'create-project' : 'modify-project';
      }
    }

    return {
      kind,
      restatement: raw?.restatement ?? ctx.prompt,
      domain: raw?.domain ?? (lowerPrompt.includes('todo') ? 'todo' : 'software project'),
      keywords: Array.isArray(raw?.keywords) ? raw!.keywords!.slice(0, 12) : [],
      confidence: typeof raw?.confidence === 'number' ? raw!.confidence! : 0.85,
    };
  }

  private toPlan(
    raw: { summary?: string; tasks?: Array<{ title: string; detail?: string; targets?: string[] }> } | undefined,
    intent: AgentIntent,
    actions: CodingAction[],
  ): AgentPlan {
    let tasks: AgentPlanTask[] = (raw?.tasks ?? []).slice(0, 12).map((t) => ({
      id: uid('task'),
      title: t.title,
      detail: t.detail ?? '',
      targets: Array.isArray(t.targets) ? t.targets : [],
      status: 'pending',
    }));

    // If the model gave no plan, derive one from the actions it returned.
    if (!tasks.length) {
      for (const action of actions.filter(isMutating).slice(0, 8)) {
        const path = 'path' in action ? action.path : `${action.from} → ${action.to}`;
        tasks.push({
          id: uid('task'),
          title: `${action.type.replace('_', ' ')} ${path}`,
          detail: action.reason ?? '',
          targets: 'path' in action ? [action.path] : [action.to],
          status: 'pending',
        });
      }
    }

    // Critical fix: Ensure we always have at least one task for create-project
    // Previously, if actions was empty, tasks stayed empty -> "Plan: 0 tasks"
    // Now we create fallback tasks based on intent so UI shows progress
    if (!tasks.length) {
      if (intent.kind === 'create-project') {
        tasks = [
          {
            id: uid('task'),
            title: 'Create index.html entry point',
            detail: 'Main HTML structure for the application',
            targets: ['index.html'],
            status: 'pending',
          },
          {
            id: uid('task'),
            title: 'Create styles and layout',
            detail: 'Responsive styling for the app',
            targets: ['styles/main.css'],
            status: 'pending',
          },
          {
            id: uid('task'),
            title: 'Implement core functionality',
            detail: 'JavaScript logic for the requested features',
            targets: ['scripts/main.js'],
            status: 'pending',
          },
        ];
      } else if (intent.kind === 'modify-project') {
        tasks = [
          {
            id: uid('task'),
            title: `Apply changes for: ${intent.restatement.slice(0, 60)}`,
            detail: intent.domain,
            targets: [],
            status: 'pending',
          },
        ];
      }
    }

    const touched = new Set(
      actions.filter(isMutating).map((a) => ('path' in a ? a.path : a.to)),
    );

    // If no files touched but we have tasks, estimate from tasks
    const estimatedFiles = touched.size > 0 ? touched.size : tasks.length > 0 ? Math.min(tasks.length, 5) : 0;

    return {
      id: uid('plan'),
      summary:
        raw?.summary ??
        (intent.kind === 'create-project'
          ? `Build a new ${intent.domain} project with ${estimatedFiles} files`
          : `Apply ${touched.size || estimatedFiles} file change(s) in response to the request.`),
      intent,
      tasks,
      estimatedFiles,
    };
  }

  private toResult(
    files: ProjectFile[],
    actions: CodingAction[],
    rejected: Array<{ action: unknown; reason: string }>,
    message: string,
    response: ChatResponse,
  ): GenerationResult {
    const exec = ActionExecutor.execute(files, actions);

    // Convert the executed tree back into the interface's file/deletion shape,
    // so AgentOrchestrator keeps working exactly as before.
    const before = new Map(files.map((f) => [f.path, f.content]));
    const after = new Map(exec.files.map((f) => [f.path, f.content]));

    const changedFiles = exec.files
      .filter((f) => before.get(f.path) !== f.content)
      .map((f) => ({
        path: f.path,
        content: f.content,
        rationale: actions.find((a) => 'path' in a && a.path === f.path)?.reason,
      }));

    const deletions = [...before.keys()].filter((p) => !after.has(p));

    let finalMessage = message;

    if (rejected.length) {
      finalMessage += `\n\n> ⚠️ ${rejected.length} action(s) were rejected by validation and not applied:\n${rejected
        .map((r) => `> - ${r.reason}`)
        .join('\n')}`;
    }
    if (exec.skipped.length) {
      finalMessage += `\n\n> ℹ️ ${exec.skipped.length} action(s) were skipped:\n${exec.skipped
        .map((s) => `> - ${s.reason}`)
        .join('\n')}`;
    }

    return {
      files: changedFiles,
      deletions,
      message: finalMessage,
      usage: response.usage
        ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            costUsd: 0,
          }
        : undefined,
    };
  }

  /* ---------------- AIProvider interface ---------------- */

  async classifyIntent(ctx: GenerationContext): Promise<AgentIntent> {
    const cache = await this.run(ctx);
    if (cache.error) throw cache.error;
    return cache.intent!;
  }

  async createPlan(ctx: GenerationContext): Promise<AgentPlan> {
    const cache = await this.run(ctx);
    if (cache.error) throw cache.error;
    return cache.plan!;
  }

  async generate(ctx: GenerationContext): Promise<GenerationResult> {
    const cache = await this.run(ctx);
    if (cache.error) throw cache.error;
    const result = cache.result!;
    // Clear so the next user turn triggers a fresh request.
    this.cache = null;
    return result;
  }

  async proposeRepair(
    ctx: GenerationContext,
    diagnostic: { message: string; file: string; line: number; code: string },
  ): Promise<RepairSuggestion> {
    const target = ctx.files.find((f) => f.path === diagnostic.file);

    const messages = buildRepairMessages({
      projectName: ctx.projectName,
      file: target,
      diagnostic,
      allFiles: ctx.files,
    });

    const response = await this.chat('repair', messages, ctx.signal);
    const parsed = parseRepairResponse(response.text, diagnostic.file);

    // Never let a repair write outside the project or blank a file.
    const { valid } = validateActions([
      { type: 'repair_error', path: parsed.path, content: parsed.content },
    ]);

    if (!valid.length || !parsed.content.trim()) {
      return {
        analysis: parsed.analysis,
        suggestion: parsed.suggestion,
        path: diagnostic.file,
        content: target?.content ?? '',
        confidence: 0,
      };
    }

    return {
      analysis: parsed.analysis,
      suggestion: parsed.suggestion,
      path: parsed.path,
      content: parsed.content,
      confidence: parsed.confidence,
    };
  }

  /**
   * Reveals the already-generated message progressively.
   *
   * The structured-action protocol requires a complete JSON document before
   * anything can be applied, so true token streaming of the final prose is not
   * possible without a second call. This keeps the UI's streaming feel without
   * pretending tokens are arriving live.
   */
  async streamMessage(
    text: string,
    onToken: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const tokens = text.match(/\S+\s*/g) ?? [text];
    for (const token of tokens) {
      if (signal?.aborted) return;
      onToken(token);
      await new Promise((r) => setTimeout(r, 8));
    }
  }
}
