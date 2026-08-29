/**
 * ModeApi — client bindings for the multi-mode endpoints (chat, image,
 * video). Same-origin calls only; API keys stay server-side and never pass
 * through this module. Error classification mirrors LLMProvider.chat so the
 * UI can show honest, actionable messages.
 */

import { uid } from '../core/utils';

/** One failed provider attempt reported by the server's failover chain. */
export interface ProviderFailoverAttempt {
  provider: string;
  status: number;
  error: string;
}

export interface ModeFailover {
  provider?: string;
  failover?: ProviderFailoverAttempt[];
}

export interface ChatResult extends ModeFailover {
  text: string;
  model?: string;
}

export interface ModeProviderStatus {
  configured: boolean;
  provider: string | null;
  label: string | null;
  model: string | null;
  providers: Array<{ id: string; label: string; configured: boolean; defaultModel: string }>;
  hint?: string;
}

export interface GeneratedImage {
  base64: string;
  mime: string;
}

export interface ImageResult extends ModeFailover {
  images: GeneratedImage[];
  label?: string;
  model?: string;
}

export interface VideoOpState {
  done: boolean;
  video: { base64: string; mime: string } | null;
  error: string | null;
  operation: string;
  provider?: string;
}

/** Error carrying the server's machine-readable code for UI branching. */
export class ModeApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly failover?: ProviderFailoverAttempt[];
  constructor(message: string, code: string, status: number, failover?: ProviderFailoverAttempt[]) {
    super(message);
    this.name = 'ModeApiError';
    this.code = code;
    this.status = status;
    this.failover = failover;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ModeApiError(
      `Cannot reach the CodeForge backend (${path}). It may be waking up or unavailable.`,
      'NETWORK_ERROR',
      0,
    );
  }

  interface ErrorBody {
    error?: string;
    code?: string;
    attempts?: ProviderFailoverAttempt[];
  }
  let data: T | ErrorBody | null = null;
  try {
    data = (await res.json()) as T | ErrorBody;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const body = (data ?? {}) as ErrorBody;
    const code = body.code ?? `HTTP_${res.status}`;
    throw new ModeApiError(
      body.error ?? `Request failed (${res.status} ${res.statusText}).`,
      code,
      res.status,
      body.attempts,
    );
  }
  return data as T;
}

const CHAT_PATH = '/api/agent/chat';

export const ModeApi = {
  /** General conversation — plain prose through the provider chain. */
  async chat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const data = await request<ChatResult>(CHAT_PATH, {
      method: 'POST',
      body: JSON.stringify({ messages: messages.slice(-16) }),
      signal,
    });
    if (!data.text) {
      throw new ModeApiError('The model returned an empty response — please try again.', 'EMPTY_RESPONSE', 200);
    }
    return data;
  },

  imageStatus(): Promise<ModeProviderStatus> {
    return request<ModeProviderStatus>('/api/agent/image/status');
  },

  async generateImage(input: { prompt: string; n?: number }, signal?: AbortSignal): Promise<ImageResult> {
    return request<ImageResult>('/api/agent/image', {
      method: 'POST',
      body: JSON.stringify({ prompt: input.prompt, n: input.n ?? 1 }),
      signal,
    });
  },

  videoStatus(): Promise<ModeProviderStatus> {
    return request<ModeProviderStatus>('/api/agent/video/status');
  },

  startVideo(
    input: { prompt: string; imageBase64?: string; imageMime?: string },
    signal?: AbortSignal,
  ): Promise<{ operation: string; provider?: string; label?: string; model?: string }> {
    return request('/api/agent/video', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
  },

  pollVideo(operation: string, signal?: AbortSignal): Promise<VideoOpState> {
    return request<VideoOpState>(`/api/agent/video/operation?name=${encodeURIComponent(operation)}`, {
      signal,
    });
  },

  /** data URL helper for rendering/downloading returned binaries. */
  toDataUrl(mime: string, base64: string): string {
    return `data:${mime};base64,${base64}`;
  },

  newId: () => uid('mode'),
};
