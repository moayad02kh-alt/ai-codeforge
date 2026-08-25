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
    try {
      const res = await fetch(`${baseUrl}/status`, { signal });
      if (!res.ok) return null;
      return (await res.json()) as BackendStatus;
    } catch {
      // Backend not running — caller falls back to the simulation.
      return null;
    }
  }

  private async chat(
    route: 'generate' | 'repair',
    messages: PromptMessage[],
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.options.headers ?? {}) },
      body: JSON.stringify({
        messages,
        model: this.options.model,
        temperature: this.options.temperature ?? 0.3,
        provider: this.options.provider,
      }),
      signal,
    });

    const data = (await res.json().catch(() => ({}))) as ChatResponse & {
      error?: string;
      code?: string;
    };

    if (!res.ok) {
      throw new Error(data.error || `Backend returned ${res.status}`);
    }
    if (!data.text) {
      throw new Error('Model returned an empty response');
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
        const parsed = parseAgentResponse(response.text);
        const { valid, rejected } = validateActions(parsed.actions);

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
    const kind = allowed.includes(raw?.kind as (typeof allowed)[number])
      ? (raw!.kind as AgentIntent['kind'])
      : ctx.files.length === 0
        ? 'create-project'
        : 'modify-project';

    return {
      kind,
      restatement: raw?.restatement ?? ctx.prompt,
      domain: raw?.domain ?? 'software project',
      keywords: Array.isArray(raw?.keywords) ? raw!.keywords!.slice(0, 12) : [],
      confidence: typeof raw?.confidence === 'number' ? raw!.confidence! : 0.85,
    };
  }

  private toPlan(
    raw: { summary?: string; tasks?: Array<{ title: string; detail?: string; targets?: string[] }> } | undefined,
    intent: AgentIntent,
    actions: CodingAction[],
  ): AgentPlan {
    const tasks: AgentPlanTask[] = (raw?.tasks ?? []).slice(0, 12).map((t) => ({
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

    const touched = new Set(
      actions.filter(isMutating).map((a) => ('path' in a ? a.path : a.to)),
    );

    return {
      id: uid('plan'),
      summary:
        raw?.summary ??
        `Apply ${touched.size} file change(s) in response to the request.`,
      intent,
      tasks,
      estimatedFiles: touched.size,
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
