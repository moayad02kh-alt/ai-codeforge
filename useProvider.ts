/**
 * Reactive binding to the service registry.
 *
 * The registry lives outside React (services must not import React), so the
 * UI subscribes through `useSyncExternalStore`. This is what makes the
 * "Simulated → Live" badge flip on its own once the async backend probe
 * resolves, with no polling and no prop drilling.
 */

import { useSyncExternalStore } from 'react';
import {
  getBackendStatus,
  getProvider,
  getProviderMode,
  onProviderChange,
  type ProviderMode,
} from '../services/registry';
import type { BackendStatus } from '../services/ai/LLMProvider';

export interface ProviderInfo {
  mode: ProviderMode;
  isLive: boolean;
  label: string;
  id: string;
  status: BackendStatus | null;
}

/**
 * Cached snapshot.
 *
 * useSyncExternalStore requires a referentially stable value between changes,
 * otherwise React re-renders infinitely. We rebuild only when the registry
 * actually notifies.
 */
let snapshot: ProviderInfo = buildSnapshot();

function buildSnapshot(): ProviderInfo {
  const provider = getProvider();
  return {
    mode: getProviderMode(),
    isLive: provider.isLive,
    label: provider.label,
    id: provider.id,
    status: getBackendStatus(),
  };
}

function subscribe(onStoreChange: () => void): () => void {
  return onProviderChange(() => {
    snapshot = buildSnapshot();
    onStoreChange();
  });
}

function getSnapshot(): ProviderInfo {
  return snapshot;
}

export function useProvider(): ProviderInfo {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
