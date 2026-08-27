/**
 * Application store (Zustand).
 *
 * The store is a THIN projection layer: it holds UI state and subscribes to
 * the event bus, but contains no agent logic of its own. All domain work
 * happens in `src/services`. This keeps the swap-in-a-real-backend story
 * simple — replace the services, and the store keeps working unchanged.
 */

import { create } from 'zustand';
import { bus } from '../core/events';
import type {
  AgentRun,
  AgentSettings,
  ChatMessage,
  ConsoleEntry,
  Diagnostic,
  Project,
  ProjectFile,
  TestResult,
  VersionSnapshot,
  Viewport,
} from '../core/types';
import { now, uid } from '../core/utils';
import { CodeRunner } from '../services/CodeRunner';
import { ErrorDetector } from '../services/ErrorDetector';
import { FileManager } from '../services/FileManager';
import { getOrchestrator, getProvider } from '../services/registry';
import { VersionManager } from '../services/VersionManager';
import { SEED_MESSAGES, SEED_PROJECTS, SEED_VERSIONS } from './seed';

export type BottomTab = 'console' | 'tests' | 'problems' | 'history';
export type MainTab = 'code' | 'preview' | 'split';

const STORAGE_KEY = 'codeforge.state.v1';

/**
 * Bumped whenever the persisted shape changes in a way older data cannot
 * satisfy. State written by a different schema is discarded on load instead
 * of being merged, so a browser holding data from an earlier build recovers
 * on its own rather than rendering against a shape the code no longer
 * understands.
 */
const SCHEMA_VERSION = 2;

/** Keys from superseded builds, removed on load so they cannot accumulate. */
const LEGACY_STORAGE_KEYS = ['codeforge.state', 'codeforge.state.v0'];

interface PersistedShape {
  schemaVersion?: number;
  projects: Project[];
  messages: Record<string, ChatMessage[]>;
  versions: VersionSnapshot[];
  activeProjectId: string;
  settings: AgentSettings;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  provider: 'mock',
  model: 'codeforge-sim-1',
  temperature: 0.3,
  autoRepair: true,
  maxRepairAttempts: 3,
  runTestsAfterGeneration: true,
  streamResponses: true,
  apiKeySet: false,
  sandbox: 'iframe',
};

interface AppState {
  /* data */
  projects: Project[];
  activeProjectId: string;
  messages: Record<string, ChatMessage[]>;
  versions: VersionSnapshot[];
  settings: AgentSettings;

  /* run state */
  activeRun: AgentRun | null;
  isAgentBusy: boolean;
  abortController: AbortController | null;

  /* editor + preview */
  openFilePaths: string[];
  activeFilePath: string | null;
  previewHtml: string;
  previewKey: number;
  viewport: Viewport;
  mainTab: MainTab;
  bottomTab: BottomTab;
  bottomOpen: boolean;

  /* diagnostics */
  consoleEntries: ConsoleEntry[];
  testResults: TestResult[];
  diagnostics: Diagnostic[];

  /* ui chrome */
  sidebarOpen: boolean;
  chatOpen: boolean;
  settingsOpen: boolean;
  commandOpen: boolean;
  toast: { id: string; message: string; tone: 'ok' | 'warn' | 'error' } | null;
  mobilePane: 'chat' | 'code' | 'preview';
  unsaved: boolean;

  /* actions */
  init: () => void;
  selectProject: (id: string) => void;
  createProject: (name?: string) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;

  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  createFile: (path: string) => void;
  deleteFile: (path: string) => void;

  sendPrompt: (prompt: string) => Promise<void>;
  cancelRun: () => void;

  runProject: () => Promise<void>;
  runTests: () => Promise<void>;
  refreshPreview: () => void;
  saveProject: () => void;

  revertToVersion: (versionId: string) => void;

  setViewport: (v: Viewport) => void;
  setMainTab: (t: MainTab) => void;
  setBottomTab: (t: BottomTab) => void;
  toggleBottom: (open?: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setMobilePane: (p: 'chat' | 'code' | 'preview') => void;
  updateSettings: (patch: Partial<AgentSettings>) => void;
  clearConsole: () => void;
  notify: (message: string, tone?: 'ok' | 'warn' | 'error') => void;
  dismissToast: () => void;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/**
 * Reads persisted state, discarding anything that is not structurally sound.
 *
 * The stored blob is user-writable and survives deploys, so a shape from an
 * older build can outlive the code that wrote it. Every field is therefore
 * checked independently and a bad one is dropped rather than allowed to
 * propagate a malformed value into the store — a single wrong type here can
 * leave the UI with nothing to render.
 */
function loadPersisted(): Partial<PersistedShape> | null {
  try {
    /* Remove keys from superseded builds so they cannot be read again. */
    for (const legacy of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(legacy);
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const candidate = parsed as Record<string, unknown>;

    /*
     * Anything written by a different schema is dropped wholesale. Merging it
     * field by field is what lets a half-understood shape reach the UI, so the
     * safer move is to fall back to seed data and let the app re-persist.
     */
    if (candidate.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const clean: Partial<PersistedShape> = {};

    if (Array.isArray(candidate.projects)) {
      clean.projects = candidate.projects as PersistedShape['projects'];
    }
    if (Array.isArray(candidate.versions)) {
      clean.versions = candidate.versions as PersistedShape['versions'];
    }
    if (
      typeof candidate.messages === 'object' &&
      candidate.messages !== null &&
      !Array.isArray(candidate.messages)
    ) {
      clean.messages = candidate.messages as PersistedShape['messages'];
    }
    if (typeof candidate.activeProjectId === 'string') {
      clean.activeProjectId = candidate.activeProjectId;
    }
    if (
      typeof candidate.settings === 'object' &&
      candidate.settings !== null &&
      !Array.isArray(candidate.settings)
    ) {
      clean.settings = candidate.settings as PersistedShape['settings'];
    }

    return clean;
  } catch {
    /* Unparseable or storage blocked (private mode) — fall back to seeds. */
    return null;
  }
}

/**
 * Guards against duplicate event-bus subscriptions. React StrictMode invokes
 * effects twice in development, which would otherwise double every console
 * line and step update.
 */
let wired = false;

let saveTimer: number | undefined;
function persist(state: AppState) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const payload: PersistedShape = {
        schemaVersion: SCHEMA_VERSION,
        projects: state.projects,
        messages: state.messages,
        versions: state.versions.slice(0, 30),
        activeProjectId: state.activeProjectId,
        settings: state.settings,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota exceeded — non-fatal for a prototype */
    }
  }, 400);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const persisted = loadPersisted();

export const useStore = create<AppState>((set, get) => ({
  projects: persisted?.projects ?? SEED_PROJECTS,
  activeProjectId: persisted?.activeProjectId ?? SEED_PROJECTS[0].id,
  messages: persisted?.messages ?? SEED_MESSAGES,
  versions: persisted?.versions ?? SEED_VERSIONS,
  settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}) },

  activeRun: null,
  isAgentBusy: false,
  abortController: null,

  openFilePaths: [],
  activeFilePath: null,
  previewHtml: '',
  previewKey: 0,
  viewport: 'desktop',
  mainTab: 'split',
  bottomTab: 'console',
  bottomOpen: false,

  consoleEntries: [],
  testResults: [],
  diagnostics: [],

  sidebarOpen: true,
  chatOpen: true,
  settingsOpen: false,
  commandOpen: false,
  toast: null,
  mobilePane: 'chat',
  unsaved: false,

  /* ---------------- lifecycle ---------------- */

  init: () => {
    const state = get();
    const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
    if (!project) return;

    const entry = FileManager.find(project.files, project.entryPath) ?? project.files[0];
    set({
      activeProjectId: project.id,
      openFilePaths: entry ? [entry.path] : [],
      activeFilePath: entry?.path ?? null,
      previewHtml: project.files.length
        ? CodeRunner.bundle(project.files, project.entryPath)
        : CodeRunner.placeholder(
            'Nothing to preview yet',
            'Describe what you want to build in the chat panel and the agent will scaffold it here.',
          ),
      diagnostics: ErrorDetector.analyze(project.files),
    });

    /* --- bus subscriptions: services → UI state (wire exactly once) --- */
    if (wired) return;
    wired = true;

    bus.on('console:entry', ({ entry: e }) =>
      set((s) => ({ consoleEntries: [...s.consoleEntries.slice(-299), e] })),
    );
    bus.on('run:started', ({ run }) =>
      set(() => ({
        activeRun: run,
        isAgentBusy: true,
      })),
    );
    bus.on('run:step', ({ step }) =>
      set((s) =>
        s.activeRun
          ? {
              activeRun: {
                ...s.activeRun,
                steps: s.activeRun.steps.map((x) => (x.id === step.id ? step : x)),
                phase: step.status === 'active' ? step.phase : s.activeRun.phase,
              },
            }
          : {},
      ),
    );
    bus.on('run:log', ({ stepId, line }) =>
      set((s) => {
        if (!s.activeRun) return {};
        return {
          activeRun: {
            ...s.activeRun,
            steps: s.activeRun.steps.map((st) =>
              st.id === stepId ? { ...st, logs: [...st.logs, line] } : st,
            ),
          },
        };
      }),
    );
    bus.on('run:plan', ({ plan }) =>
      set((s) => (s.activeRun ? { activeRun: { ...s.activeRun, plan } } : {})),
    );
    bus.on('run:tests', ({ results }) =>
      set((s) => ({
        testResults: results,
        activeRun: s.activeRun ? { ...s.activeRun, testResults: results } : s.activeRun,
      })),
    );
    bus.on('run:diagnostics', ({ diagnostics }) =>
      set((s) => ({
        diagnostics,
        activeRun: s.activeRun ? { ...s.activeRun, diagnostics } : s.activeRun,
      })),
    );
    bus.on('run:repair', ({ repair }) =>
      set((s) => {
        if (!s.activeRun) return {};
        const repairs = [...s.activeRun.repairs];
        const i = repairs.findIndex((r) => r.id === repair.id);
        if (i === -1) repairs.push(repair);
        else repairs[i] = repair;
        return { activeRun: { ...s.activeRun, repairs } };
      }),
    );
    bus.on('run:changes', ({ changes }) =>
      set((s) => (s.activeRun ? { activeRun: { ...s.activeRun, changes } } : {})),
    );
    bus.on('run:finished', ({ run }) =>
      set((s) => ({
        // Keep the finished run visible so timeline shows completed state
        activeRun: s.activeRun?.id === run.id ? run : s.activeRun,
      })),
    );
    bus.on('preview:updated', ({ html }) =>
      set((s) => ({ previewHtml: html, previewKey: s.previewKey + 1 })),
    );

    // Capture console output forwarded from the sandboxed preview iframe.
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { __codeforge?: boolean; level?: string; message?: string };
      if (!data?.__codeforge) return;
      set((s) => ({
        consoleEntries: [
          ...s.consoleEntries.slice(-299),
          {
            id: uid('log'),
            level: (data.level as ConsoleEntry['level']) ?? 'log',
            message: data.message ?? '',
            at: now(),
            source: 'preview',
          },
        ],
      }));
    });
  },

  /* ---------------- projects ---------------- */

  selectProject: (id) => {
    const project = get().projects.find((p) => p.id === id);
    if (!project) return;
    const entry = FileManager.find(project.files, project.entryPath) ?? project.files[0];
    set({
      activeProjectId: id,
      openFilePaths: entry ? [entry.path] : [],
      activeFilePath: entry?.path ?? null,
      previewHtml: project.files.length
        ? CodeRunner.bundle(project.files, project.entryPath)
        : CodeRunner.placeholder(
            'Nothing to preview yet',
            'Describe what you want to build in the chat panel and the agent will scaffold it here.',
          ),
      previewKey: get().previewKey + 1,
      diagnostics: ErrorDetector.analyze(project.files),
      testResults: [],
      consoleEntries: [],
      activeRun: null,
      mobilePane: 'chat',
    });
    persist(get());
  },

  createProject: (name) => {
    const project: Project = {
      id: uid('proj'),
      name: name?.trim() || 'Untitled Project',
      description: 'Empty workspace — describe what you want to build.',
      template: 'blank',
      status: 'draft',
      files: [],
      entryPath: 'index.html',
      createdAt: now(),
      updatedAt: now(),
      icon: '＋',
    };
    set((s) => ({
      projects: [project, ...s.projects],
      messages: { ...s.messages, [project.id]: [] },
    }));
    get().selectProject(project.id);
    get().notify('Project created');
  },

  deleteProject: (id) => {
    const { projects } = get();
    if (projects.length <= 1) {
      get().notify('You need at least one project', 'warn');
      return;
    }
    const remaining = projects.filter((p) => p.id !== id);
    set((s) => {
      const messages = { ...s.messages };
      delete messages[id];
      return {
        projects: remaining,
        messages,
        versions: s.versions.filter((v) => v.projectId !== id),
      };
    });
    if (get().activeProjectId === id) get().selectProject(remaining[0].id);
    persist(get());
    get().notify('Project deleted');
  },

  renameProject: (id, name) => {
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, name, updatedAt: now() } : p)),
    }));
    persist(get());
  },

  /* ---------------- files ---------------- */

  openFile: (path) =>
    set((s) => ({
      openFilePaths: s.openFilePaths.includes(path) ? s.openFilePaths : [...s.openFilePaths, path],
      activeFilePath: path,
      mainTab: s.mainTab === 'preview' ? 'split' : s.mainTab,
      mobilePane: 'code',
    })),

  closeFile: (path) =>
    set((s) => {
      const openFilePaths = s.openFilePaths.filter((p) => p !== path);
      return {
        openFilePaths,
        activeFilePath:
          s.activeFilePath === path ? (openFilePaths.at(-1) ?? null) : s.activeFilePath,
      };
    }),

  updateFileContent: (path, content) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === s.activeProjectId
          ? {
              ...p,
              updatedAt: now(),
              files: p.files.map((f) => (f.path === path ? { ...f, content, updatedAt: now() } : f)),
            }
          : p,
      ),
      unsaved: true,
    }));
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (project) set({ diagnostics: ErrorDetector.analyze(project.files) });
  },

  createFile: (path) => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) return;
    if (FileManager.find(project.files, path)) {
      get().notify('That file already exists', 'warn');
      return;
    }
    const { files } = FileManager.applyChanges(project.files, [{ path, content: '' }], [], 'user');
    set((s) => ({
      projects: s.projects.map((p) => (p.id === project.id ? { ...p, files, updatedAt: now() } : p)),
      unsaved: true,
    }));
    get().openFile(FileManager.normalize(path));
  },

  deleteFile: (path) => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) return;
    const { files } = FileManager.applyChanges(project.files, [], [path]);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === project.id ? { ...p, files, updatedAt: now() } : p)),
      unsaved: true,
    }));
    get().closeFile(path);
    get().notify(`Deleted ${path}`);
  },

  /* ---------------- agent ---------------- */

  sendPrompt: async (prompt) => {
    const state = get();
    if (state.isAgentBusy || !prompt.trim()) return;

    const project = state.projects.find((p) => p.id === state.activeProjectId);
    if (!project) return;

    const userMessage: ChatMessage = {
      id: uid('msg'),
      role: 'user',
      content: prompt.trim(),
      createdAt: now(),
    };

    // Snapshot BEFORE the run — this is the Auto Repair rollback target.
    const preRun = VersionManager.snapshot({
      projectId: project.id,
      label: 'Before: ' + (prompt.trim().slice(0, 40) || 'agent run'),
      description: 'Automatic checkpoint captured before the agent run.',
      origin: 'initial',
      files: project.files,
    });

    const controller = new AbortController();

    set((s) => ({
      messages: { ...s.messages, [project.id]: [...(s.messages[project.id] ?? []), userMessage] },
      isAgentBusy: true,
      abortController: controller,
      versions: VersionManager.append(s.versions, preRun),
      consoleEntries: [],
      bottomOpen: true,
      bottomTab: 'console',
      projects: s.projects.map((p) => (p.id === project.id ? { ...p, status: 'generating' } : p)),
    }));

    const history = (get().messages[project.id] ?? [])
      .filter((m) => m.role !== 'system')
      .slice(-8)
      .map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content }));

    const output = await getOrchestrator().execute({
      projectId: project.id,
      projectName: project.name,
      prompt: prompt.trim(),
      files: project.files,
      entryPath: project.entryPath,
      history,
      settings: get().settings,
      rollbackVersionId: preRun.id,
      signal: controller.signal,
    });

    // Persist the resulting file tree.
    const wasBlank = project.files.length === 0;
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === project.id
          ? {
              ...p,
              files: output.files,
              status: output.run.status === 'failed' ? 'error' : 'ready',
              updatedAt: now(),
              // Name a blank project after its first prompt.
              name:
                wasBlank && p.name === 'Untitled Project'
                  ? prompt.trim().replace(/^(build|create|make)\s+(me\s+)?(a|an|the)?\s*/i, '').slice(0, 34) ||
                    p.name
                  : p.name,
              icon: wasBlank ? '◆' : p.icon,
              description: wasBlank ? prompt.trim().slice(0, 120) : p.description,
            }
          : p,
      ),
      previewHtml: output.previewHtml,
      previewKey: s.previewKey + 1,
      activeRun: output.run,
      isAgentBusy: false,
      abortController: null,
      unsaved: false,
    }));

    // Post-run version snapshot.
    if (output.changes.length) {
      const snapshot = VersionManager.snapshot({
        projectId: project.id,
        label: prompt.trim().slice(0, 48),
        description: `${output.changes.length} file(s) changed by the agent.`,
        origin: output.run.repairs.some((r) => r.outcome === 'verified') ? 'auto-repair' : 'agent',
        files: output.files,
        changes: output.changes,
        runId: output.run.id,
      });
      set((s) => ({ versions: VersionManager.append(s.versions, snapshot) }));
    }

    // Open the most relevant generated file.
    const primary =
      output.changes.find((c) => c.path.endsWith('.html'))?.path ?? output.changes[0]?.path;
    if (primary) {
      set((s) => ({
        openFilePaths: Array.from(new Set([...s.openFilePaths, primary])).slice(-6),
        activeFilePath: primary,
      }));
    }

    // Stream the agent's reply into the chat.
    const agentMessage: ChatMessage = {
      id: uid('msg'),
      role: 'agent',
      content: '',
      createdAt: now(),
      runId: output.run.id,
      pending: true,
    };
    set((s) => ({
      messages: { ...s.messages, [project.id]: [...(s.messages[project.id] ?? []), agentMessage] },
    }));

    const provider = getProvider();
    const finalize = () =>
      set((s) => ({
        messages: {
          ...s.messages,
          [project.id]: (s.messages[project.id] ?? []).map((m) =>
            m.id === agentMessage.id ? { ...m, content: output.message, pending: false } : m,
          ),
        },
      }));

    if (get().settings.streamResponses && provider.streamMessage) {
      let buffer = '';
      await provider.streamMessage(output.message, (token) => {
        buffer += token;
        set((s) => ({
          messages: {
            ...s.messages,
            [project.id]: (s.messages[project.id] ?? []).map((m) =>
              m.id === agentMessage.id ? { ...m, content: buffer } : m,
            ),
          },
        }));
      });
      finalize();
    } else {
      finalize();
    }

    persist(get());
  },

  cancelRun: () => {
    get().abortController?.abort();
    set({ isAgentBusy: false });
    get().notify('Run cancelled', 'warn');
  },

  /* ---------------- runner ---------------- */

  runProject: async () => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) return;
    if (!project.files.length) {
      get().notify('Nothing to run — the project is empty', 'warn');
      return;
    }
    set({ bottomOpen: true, bottomTab: 'console', consoleEntries: [] });
    const result = await CodeRunner.run(project.files, project.entryPath);
    set((s) => ({
      consoleEntries: [...s.consoleEntries, ...result.console],
      diagnostics: result.diagnostics,
      previewHtml: result.previewHtml ?? s.previewHtml,
      previewKey: s.previewKey + 1,
      projects: s.projects.map((p) =>
        p.id === project.id ? { ...p, status: result.status === 'error' ? 'error' : 'ready' } : p,
      ),
    }));
    get().notify(
      result.status === 'success' ? 'Build succeeded' : 'Build finished with errors',
      result.status === 'success' ? 'ok' : 'error',
    );
  },

  runTests: async () => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) return;
    set({ bottomOpen: true, bottomTab: 'tests' });
    const results = await CodeRunner.runTests(project.files);
    set({ testResults: results });
    const failed = results.filter((r) => r.status === 'failed').length;
    get().notify(
      failed ? `${failed} test(s) failed` : 'All tests passed',
      failed ? 'error' : 'ok',
    );
  },

  refreshPreview: () => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) return;
    set((s) => ({
      previewHtml: project.files.length
        ? CodeRunner.bundle(project.files, project.entryPath)
        : CodeRunner.placeholder(
            'Nothing to preview yet',
            'Describe what you want to build in the chat panel and the agent will scaffold it here.',
          ),
      previewKey: s.previewKey + 1,
    }));
  },

  saveProject: () => {
    const project = get().projects.find((p) => p.id === get().activeProjectId);
    if (!project) return;
    const snapshot = VersionManager.snapshot({
      projectId: project.id,
      label: 'Manual save',
      description: 'Checkpoint saved from the editor.',
      origin: 'user',
      files: project.files,
    });
    set((s) => ({ versions: VersionManager.append(s.versions, snapshot), unsaved: false }));
    persist(get());
    get().refreshPreview();
    get().notify('Saved · checkpoint added to history');
  },

  /* ---------------- history ---------------- */

  revertToVersion: (versionId) => {
    const { versions, activeProjectId, projects } = get();
    const files = VersionManager.restore(versions, versionId);
    const snapshot = VersionManager.get(versions, versionId);
    if (!files || !snapshot) return;

    const current = projects.find((p) => p.id === activeProjectId);
    if (!current) return;

    // Capture the pre-revert state so a revert is itself reversible.
    const backup = VersionManager.snapshot({
      projectId: activeProjectId,
      label: 'Before revert',
      description: `State captured before reverting to "${snapshot.label}".`,
      origin: 'revert',
      files: current.files,
    });

    set((s) => ({
      projects: s.projects.map((p) => (p.id === activeProjectId ? { ...p, files, updatedAt: now() } : p)),
      versions: VersionManager.append(s.versions, backup),
      diagnostics: ErrorDetector.analyze(files),
    }));
    get().refreshPreview();
    persist(get());
    get().notify(`Reverted to "${snapshot.label}"`);
  },

  /* ---------------- ui ---------------- */

  setViewport: (viewport) => set({ viewport }),
  setMainTab: (mainTab) => set({ mainTab }),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
  toggleBottom: (open) => set((s) => ({ bottomOpen: open ?? !s.bottomOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setMobilePane: (mobilePane) => set({ mobilePane }),

  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    persist(get());
  },

  clearConsole: () => set({ consoleEntries: [] }),

  notify: (message, tone = 'ok') => {
    const toast = { id: uid('toast'), message, tone };
    set({ toast });
    window.setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null });
    }, 3200);
  },

  dismissToast: () => set({ toast: null }),
}));

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export const selectActiveProject = (s: AppState): Project | undefined =>
  s.projects.find((p) => p.id === s.activeProjectId);

export const selectActiveFile = (s: AppState): ProjectFile | undefined => {
  const project = selectActiveProject(s);
  if (!project || !s.activeFilePath) return undefined;
  return FileManager.find(project.files, s.activeFilePath);
};

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  DERIVED SELECTORS MUST RETURN A STABLE REFERENCE.
 *
 *  Zustand v5 reads state through React's useSyncExternalStore, which
 *  compares snapshots with Object.is. A selector that derives a value with
 *  .filter(), .map() or `?? []` builds a NEW array on every call, so the
 *  comparison always fails, React re-renders, calls getSnapshot again, gets
 *  yet another new array — an infinite loop that ends in
 *  "Maximum update depth exceeded" and unmounts the whole tree.
 *
 *  The helpers below therefore memoise on their inputs and return the very
 *  same array reference until those inputs actually change.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Shared empty array so "no results" is always the same reference. */
const EMPTY: readonly never[] = Object.freeze([]);

function memoizeOne<A extends unknown[], R>(fn: (...args: A) => R) {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A): R => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => Object.is(a, args[i]))) {
      return lastResult;
    }
    lastArgs = args;
    lastResult = fn(...args);
    return lastResult;
  };
}

const messagesFor = memoizeOne(
  (byProject: Record<string, ChatMessage[]>, projectId: string): ChatMessage[] =>
    byProject[projectId] ?? (EMPTY as unknown as ChatMessage[]),
);

const versionsFor = memoizeOne((versions: VersionSnapshot[], projectId: string): VersionSnapshot[] => {
  const found = VersionManager.forProject(versions, projectId);
  return found.length ? found : (EMPTY as unknown as VersionSnapshot[]);
});

export const selectMessages = (s: AppState): ChatMessage[] =>
  messagesFor(s.messages, s.activeProjectId);

export const selectProjectVersions = (s: AppState): VersionSnapshot[] =>
  versionsFor(s.versions, s.activeProjectId);
