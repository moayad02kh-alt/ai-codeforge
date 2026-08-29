/**
 * CodeForge AI — Core domain model.
 *
 * This file is intentionally framework-agnostic. Nothing here imports React.
 * Every service in `src/services` speaks these types, which makes it possible
 * to swap the mock implementations for real backends (LLM API, database,
 * container sandbox) without touching the UI layer.
 */

/* ------------------------------------------------------------------ */
/* Files & projects                                                    */
/* ------------------------------------------------------------------ */

export type FileLanguage =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'markdown'
  | 'text';

export interface ProjectFile {
  id: string;
  /** POSIX-style path relative to project root, e.g. `src/App.tsx`. */
  path: string;
  content: string;
  language: FileLanguage;
  /** Marks files the agent authored (vs. user-created). */
  generatedBy: 'agent' | 'user' | 'template';
  createdAt: number;
  updatedAt: number;
}

export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'running' | 'error';

export type ProjectTemplate =
  | 'static-site'
  | 'landing-page'
  | 'dashboard'
  | 'api-service'
  | 'blank';

export interface Project {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplate;
  status: ProjectStatus;
  files: ProjectFile[];
  /** Entry file used by the preview runtime. */
  entryPath: string;
  createdAt: number;
  updatedAt: number;
  /** Emoji/glyph shown in the sidebar. */
  icon: string;
}

/* ------------------------------------------------------------------ */
/* Chat & agent                                                        */
/* ------------------------------------------------------------------ */

export type ChatRole = 'user' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Agent run this message belongs to, if any. */
  runId?: string;
  /** Streaming placeholder still being written to. */
  pending?: boolean;
  attachments?: MessageAttachment[];
}

export type MessageAttachment =
  | { kind: 'plan'; plan: AgentPlan }
  | { kind: 'files'; files: FileChangeSummary[] }
  | { kind: 'tests'; results: TestResult[] }
  | { kind: 'diagnostics'; diagnostics: Diagnostic[] }
  | { kind: 'repair'; repair: RepairAttempt };

export interface FileChangeSummary {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  /** Rough line delta, used for the +/- badges in the UI. */
  additions: number;
  deletions: number;
}

/* ------------------------------------------------------------------ */
/* Agent pipeline                                                      */
/* ------------------------------------------------------------------ */

/**
 * The canonical agent pipeline. The UI renders these as the live
 * "agent timeline"; the orchestrator drives them in order.
 * Expanded to 10 stages for transparent real-time progress.
 */
export type AgentPhase =
  | 'understand'
  | 'inspect'
  | 'plan'
  | 'generate'
  | 'apply'
  | 'test'
  | 'detect'
  | 'repair'
  | 'preview'
  | 'done'
  | 'failed'
  | 'modify';

export type StepStatus = 'pending' | 'active' | 'success' | 'warning' | 'failed' | 'skipped';

export interface AgentStep {
  id: string;
  phase: AgentPhase;
  title: string;
  detail?: string;
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
  /** Free-form log lines streamed into the step's disclosure panel. */
  logs: string[];
}

export interface AgentPlanTask {
  id: string;
  title: string;
  detail: string;
  /** Files this task is expected to touch. */
  targets: string[];
  status: StepStatus;
}

export interface AgentPlan {
  id: string;
  summary: string;
  /** Short interpretation of what the user asked for. */
  intent: AgentIntent;
  tasks: AgentPlanTask[];
  estimatedFiles: number;
}

export type AgentIntentKind =
  | 'create-project'
  | 'modify-project'
  | 'fix-error'
  | 'explain'
  | 'chat'
  | 'unknown';

export interface AgentIntent {
  kind: AgentIntentKind;
  /** Human-readable restatement of the request. */
  restatement: string;
  /** Detected domain, e.g. "restaurant", "dashboard". */
  domain: string;
  keywords: string[];
  confidence: number;
}

export type AgentRunStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentRun {
  id: string;
  projectId: string;
  prompt: string;
  status: AgentRunStatus;
  phase: AgentPhase;
  steps: AgentStep[];
  plan?: AgentPlan;
  changes: FileChangeSummary[];
  testResults: TestResult[];
  diagnostics: Diagnostic[];
  repairs: RepairAttempt[];
  startedAt: number;
  finishedAt?: number;
  /** Token/cost telemetry — populated for real providers. */
  usage?: { promptTokens: number; completionTokens: number; costUsd: number };
}

/* ------------------------------------------------------------------ */
/* Testing, diagnostics, repair                                        */
/* ------------------------------------------------------------------ */

export interface TestResult {
  id: string;
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  message?: string;
  /** Where the failure occurred, for jump-to-source. */
  file?: string;
  line?: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  /** Source that produced it. */
  source: 'static-analysis' | 'runtime' | 'test' | 'build';
  /** Whether Auto Repair believes it can fix this. */
  repairable: boolean;
}

export type RepairStage = 'analyze' | 'suggest' | 'apply' | 'rerun' | 'verify';

export interface RepairStageResult {
  stage: RepairStage;
  status: StepStatus;
  detail: string;
  at: number;
}

export interface RepairAttempt {
  id: string;
  diagnosticId: string;
  diagnostic: Diagnostic;
  /** Root-cause explanation produced during Analyze. */
  analysis: string;
  /** Proposed change produced during Suggest. */
  suggestion: string;
  patch?: FilePatch;
  stages: RepairStageResult[];
  outcome: 'pending' | 'verified' | 'reverted' | 'failed';
  /** Snapshot to roll back to if verification fails. */
  rollbackVersionId?: string;
  attempt: number;
}

export interface FilePatch {
  path: string;
  before: string;
  after: string;
}

/* ------------------------------------------------------------------ */
/* Version history                                                     */
/* ------------------------------------------------------------------ */

export type VersionOrigin = 'agent' | 'user' | 'auto-repair' | 'revert' | 'initial';

export interface VersionSnapshot {
  id: string;
  projectId: string;
  label: string;
  description: string;
  origin: VersionOrigin;
  createdAt: number;
  /** Full file snapshot — simple and reliable for a client-side prototype. */
  files: ProjectFile[];
  changes: FileChangeSummary[];
  runId?: string;
  /** True when this snapshot is the currently checked-out state. */
  isCurrent?: boolean;
}

/* ------------------------------------------------------------------ */
/* Runner / sandbox                                                    */
/* ------------------------------------------------------------------ */

export type RunStatus = 'idle' | 'installing' | 'building' | 'running' | 'passed' | 'failed';

export interface ConsoleEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'system';
  message: string;
  at: number;
  source?: string;
}

export interface RunResult {
  id: string;
  status: 'success' | 'error';
  durationMs: number;
  console: ConsoleEntry[];
  diagnostics: Diagnostic[];
  /** Bundled document served to the preview iframe. */
  previewHtml?: string;
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export type Viewport = 'desktop' | 'tablet' | 'mobile';

export interface AgentSettings {
  provider: 'mock' | 'openai' | 'anthropic' | 'custom';
  model: string;
  temperature: number;
  autoRepair: boolean;
  maxRepairAttempts: number;
  runTestsAfterGeneration: boolean;
  streamResponses: boolean;
  apiKeySet: boolean;
  sandbox: 'iframe' | 'remote-container';
  /**
   * Preferred live vendor id (Settings ▸ AI provider). null/undefined =
   * automatic — the server's default Gemini → Groq → OpenRouter Free
   * failover chain. A non-secret provider id only; API keys never live here.
   */
  providerPreference?: string | null;
}
