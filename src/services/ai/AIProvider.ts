/**
 * AI provider contract.
 *
 * The agent orchestrator depends ONLY on this interface. Today the app ships
 * with `MockAIProvider`, which produces deterministic template-driven output
 * and never contacts a network. To go live you implement this interface
 * against a real model (see `LLMProvider` for the live adapter) and
 * register it in `src/services/registry.ts`.
 *
 * IMPORTANT: nothing in this codebase currently performs real inference or
 * executes untrusted code on a server. The UI labels all output as simulated.
 */

import type { AgentIntent, AgentPlan, Diagnostic, ProjectFile } from '../../core/types';

export interface GenerationContext {
  /** The user's raw request. */
  prompt: string;
  /** Existing files, so the model can modify rather than recreate. */
  files: ProjectFile[];
  /** Prior turns, already trimmed to the provider's context budget. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  projectName: string;
  signal?: AbortSignal;
  /**
   * Diagnostics from the previous run, when the caller already knows the
   * project is broken. The Project Context manager boosts the ranking of the
   * files these point at so the model sees the code it actually needs to fix.
   */
  diagnostics?: Diagnostic[];
}

export interface GeneratedFile {
  path: string;
  content: string;
  /** Why the agent produced this file — surfaced in the UI. */
  rationale?: string;
}

export interface GenerationResult {
  files: GeneratedFile[];
  /** Paths the model decided to delete. */
  deletions: string[];
  /** Prose reply shown in the chat panel. */
  message: string;
  usage?: { promptTokens: number; completionTokens: number; costUsd: number };
}

export interface RepairSuggestion {
  analysis: string;
  suggestion: string;
  path: string;
  /** Full replacement content for `path`. */
  content: string;
  confidence: number;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  /** False for the mock provider — the UI uses this to show the "simulated" badge. */
  readonly isLive: boolean;

  classifyIntent(ctx: GenerationContext): Promise<AgentIntent>;
  createPlan(ctx: GenerationContext, intent: AgentIntent): Promise<AgentPlan>;
  generate(ctx: GenerationContext, plan: AgentPlan): Promise<GenerationResult>;
  proposeRepair(
    ctx: GenerationContext,
    diagnostic: { message: string; file: string; line: number; code: string },
  ): Promise<RepairSuggestion>;

  /** Optional token streaming for the chat panel. */
  streamMessage?(text: string, onToken: (t: string) => void, signal?: AbortSignal): Promise<void>;
}
