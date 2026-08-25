/**
 * Minimal typed event bus.
 *
 * Services publish domain events here; the store subscribes and projects them
 * into UI state. This keeps the agent pipeline free of any React dependency
 * and means a future server-driven implementation (SSE / WebSocket) can emit
 * the exact same events without changing consumers.
 */

import type {
  AgentPlan,
  AgentRun,
  AgentStep,
  ChatMessage,
  ConsoleEntry,
  Diagnostic,
  FileChangeSummary,
  Project,
  RepairAttempt,
  RunResult,
  TestResult,
  VersionSnapshot,
} from './types';

export interface EventMap {
  'run:started': { run: AgentRun };
  'run:step': { runId: string; step: AgentStep };
  'run:log': { runId: string; stepId: string; line: string };
  'run:plan': { runId: string; plan: AgentPlan };
  'run:changes': { runId: string; changes: FileChangeSummary[] };
  'run:tests': { runId: string; results: TestResult[] };
  'run:diagnostics': { runId: string; diagnostics: Diagnostic[] };
  'run:repair': { runId: string; repair: RepairAttempt };
  'run:finished': { run: AgentRun };
  'chat:message': { message: ChatMessage };
  'chat:token': { messageId: string; token: string };
  'chat:complete': { messageId: string };
  'project:updated': { project: Project };
  'files:changed': { projectId: string };
  'version:created': { snapshot: VersionSnapshot };
  'console:entry': { entry: ConsoleEntry };
  'runner:result': { result: RunResult };
  'preview:updated': { html: string };
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(event as string) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(event as string, set);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    this.handlers.get(event as string)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        (handler as Handler<K>)(payload);
      } catch (err) {
        // A misbehaving subscriber must never break the pipeline.
        console.error(`[EventBus] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
