/**
 * Service registry — the single place where the AI provider is chosen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ▶ THIS IS WHERE THE AI PROVIDER IS CONFIGURED.
 *
 *  On startup `initProvider()` asks the backend (`GET /api/agent/status`)
 *  whether a real model is available:
 *
 *    • Backend reachable AND a key is configured
 *        → LLMProvider  (real model, badge shows "Live")
 *    • Backend missing, or no key configured
 *        → MockAIProvider (offline simulation, badge shows "Simulated")
 *
 *  The API key itself NEVER reaches this file or any other browser code.
 *  It lives only in the server process (see server/providers.js and .env).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * To force a specific vendor, set AI_PROVIDER in .env, or pass
 * `{ provider: 'anthropic' }` when constructing LLMProvider below.
 */

import { AgentOrchestrator } from './AgentOrchestrator';
import type { AIProvider } from './ai/AIProvider';
import { LLMProvider, type BackendStatus } from './ai/LLMProvider';
import { MockAIProvider } from './ai/MockAIProvider';

export type ProviderMode = 'simulated' | 'live';

/** Where the backend routes live. Change if you mount them elsewhere. */
export const AGENT_API_BASE = '/api/agent';

let provider: AIProvider = new MockAIProvider();
let orchestrator = new AgentOrchestrator(provider);
let backendStatus: BackendStatus | null = null;
let initialized = false;

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Subscribe to provider changes (used by the UI badge). */
export function onProviderChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getProvider(): AIProvider {
  return provider;
}

export function setProvider(next: AIProvider): void {
  provider = next;
  orchestrator = new AgentOrchestrator(next);
  notify();
}

export function getOrchestrator(): AgentOrchestrator {
  return orchestrator;
}

/** True only when a real model backend is connected. Drives the UI badge. */
export function isLiveBackend(): boolean {
  return provider.isLive;
}

/**
 * User's preferred live vendor (Settings ▸ AI provider). Module-level so the
 * registry stays decoupled from the app store (which imports this module).
 * null = automatic: the server's own Gemini → Groq → OpenRouter Free chain.
 */
let preferredProvider: string | null = null;

/**
 * Set the preferred live vendor and apply it immediately when a live backend
 * is connected. Persisting the choice is the caller's job (settings store).
 * Pass null to return to automatic selection. The value is a non-secret
 * provider id ('gemini' | 'groq' | 'openrouter') — never a key.
 */
export function setPreferredProvider(id: string | null): void {
  preferredProvider = id;
  // Apply now if we're live: rebuild the LLM client with the new preference.
  // The server treats the id as a chain preference (bounded failover still
  // applies), and unknown/unconfigured ids simply fall back safely.
  if (provider.isLive) void initProvider(true);
}

export function getBackendStatus(): BackendStatus | null {
  return backendStatus;
}

export function getProviderMode(): ProviderMode {
  return provider.isLive ? 'live' : 'simulated';
}

/**
 * Detects the backend and selects a provider.
 *
 * Safe to call repeatedly; only the first call probes unless `force` is set.
 * Never throws — any failure falls back to the offline simulation so the app
 * always remains usable.
 *
 * Includes a quick retry for cold-start platforms like Render where the
 * first probe can fail with "Failed to fetch" while the service wakes.
 */
export async function initProvider(force = false): Promise<ProviderMode> {
  if (initialized && !force) return getProviderMode();
  initialized = true;

  let status: Awaited<ReturnType<typeof LLMProvider.probe>> = null;
  try {
    status = await LLMProvider.probe(AGENT_API_BASE);
    // Cold-start retry: Render free tier can take 20-30s to wake, first fetch may fail
    if (!status) {
      await new Promise((r) => setTimeout(r, 1200));
      status = await LLMProvider.probe(AGENT_API_BASE);
    }
  } catch {
    status = null;
  }

  backendStatus = status;

  if (status?.configured) {
    const wants = preferredProvider ?? (status.activeProvider as string | null);
    setProvider(
      new LLMProvider({
        baseUrl: AGENT_API_BASE,
        label: status.activeModel
          ? `${wants ?? status.activeProvider} · ${status.activeModel}`
          : 'Live model',
        provider: (wants as 'openai' | 'anthropic' | 'gemini' | 'groq' | 'openrouter') ?? undefined,
      }),
    );
    return 'live';
  }

  // No backend or no credentials — keep the fully functional simulation.
  if (provider.isLive) setProvider(new MockAIProvider());
  else notify();
  return 'simulated';
}

/** Forces the offline simulation (used by the Settings toggle). */
export function useSimulatedProvider(): void {
  setProvider(new MockAIProvider());
}

/** Attempts to (re)connect to the live backend. Returns false if unavailable. */
export async function useLiveProvider(): Promise<boolean> {
  const mode = await initProvider(true);
  return mode === 'live';
}
