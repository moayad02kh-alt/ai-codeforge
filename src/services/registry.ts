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
 */
export async function initProvider(force = false): Promise<ProviderMode> {
  if (initialized && !force) return getProviderMode();
  initialized = true;

  const status = await LLMProvider.probe(AGENT_API_BASE);
  backendStatus = status;

  if (status?.configured) {
    setProvider(
      new LLMProvider({
        baseUrl: AGENT_API_BASE,
        label: status.activeModel
          ? `${status.activeProvider} · ${status.activeModel}`
          : 'Live model',
        provider: (status.activeProvider as 'openai' | 'anthropic' | 'gemini') ?? undefined,
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
