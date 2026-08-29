/**
 * Mode store — state for the multi-mode AI Workspace (Chat, Image, Video).
 *
 * Deliberately SEPARATE from the agent store (`state/store.ts`): the coding
 * agent's state shape, persistence and pipeline are untouched — zero
 * regression surface. This store holds only the new modes' session state
 * (plus lightweight prompt-history persistence through the sandbox-safe
 * safeStorage wrapper).
 */

import { create } from 'zustand';
import {
  ModeApi,
  ModeApiError,
  type ModeProviderStatus,
  type ProviderFailoverAttempt,
} from '../services/ModeApi';
import { PROVIDER_LABELS } from '../services/ai/LLMProvider';
import { safeStorage } from '../lib/safeStorage';

export type WorkspaceMode = 'agent' | 'chat' | 'image' | 'video' | 'buildapp';

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Provider that served an assistant reply (e.g. "Gemini"). */
  providerLabel?: string;
  /** Failover notices, e.g. "Gemini unavailable — using Groq". */
  failoverNotes?: string[];
  isError?: boolean;
}

export interface ImageItem {
  id: string;
  dataUrl: string;
  prompt: string;
  providerLabel: string;
  model?: string;
  at: number;
}

export type VideoStage = 'idle' | 'starting' | 'rendering' | 'downloading' | 'done' | 'error';

const PROMPT_HISTORY_KEY = 'cf.imagePrompts';
const PROMPT_HISTORY_MAX = 12;

function loadPromptHistory(): string[] {
  try {
    const raw = safeStorage.getItem(PROMPT_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(0, PROMPT_HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function savePromptHistory(items: string[]): void {
  try {
    safeStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(items.slice(0, PROMPT_HISTORY_MAX)));
  } catch {
    /* storage unavailable — history stays session-only */
  }
}

/** "Gemini unavailable — using Groq" style notes from failover attempts. */
function failoverNotes(failover: ProviderFailoverAttempt[] | undefined, usedProvider?: string): string[] {
  if (!failover?.length) return [];
  return failover.map((a, i) => {
    const next = failover[i + 1]?.provider ?? usedProvider ?? 'a fallback provider';
    return `${PROVIDER_LABELS[a.provider] ?? a.provider} unavailable — using ${PROVIDER_LABELS[next] ?? next}`;
  });
}

interface ModeState {
  /* mode switching */
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;

  /* chat mode */
  chat: ChatEntry[];
  chatBusy: boolean;
  sendChat: (prompt: string) => Promise<void>;
  clearChat: () => void;

  /* image mode */
  imagePrompt: string;
  imageCount: 1 | 2 | 4;
  imageBusy: boolean;
  imageError: string | null;
  images: ImageItem[];
  promptHistory: string[];
  imageStatus: ModeProviderStatus | null;
  imageStatusLoaded: boolean;
  setImagePrompt: (v: string) => void;
  setImageCount: (n: 1 | 2 | 4) => void;
  loadImageStatus: () => Promise<void>;
  generateImages: () => Promise<void>;
  removeImage: (id: string) => void;
  clearImages: () => void;

  /* video mode */
  videoStatus: ModeProviderStatus | null;
  videoStatusLoaded: boolean;
  videoPrompt: string;
  videoStage: VideoStage;
  videoBusy: boolean;
  videoError: string | null;
  videoUrl: string | null;
  videoProviderLabel: string | null;
  videoImageName: string | null;
  videoImageB64: string | null;
  videoImageMime: string | null;
  setVideoPrompt: (v: string) => void;
  setVideoImage: (b64: string | null, mime?: string, name?: string) => void;
  loadVideoStatus: () => Promise<void>;
  generateVideo: () => Promise<void>;
  cancelVideo: () => void;

  /* build-app wizard draft (survives mode switches within the session) */
  buildAppDraft: { name: string; appType: string; style: string; features: string; pages: string; notes: string };
  setBuildAppDraft: (patch: Partial<ModeState['buildAppDraft']>) => void;
}

let videoAbort: AbortController | null = null;

export const useModeStore = create<ModeState>((set, get) => ({
  mode: 'agent',
  setMode: (mode) => set({ mode }),

  /* ---------------- chat ---------------- */
  chat: [],
  chatBusy: false,
  sendChat: async (prompt) => {
    const text = prompt.trim();
    if (!text || get().chatBusy) return;

    const userEntry: ChatEntry = { id: ModeApi.newId(), role: 'user', content: text, at: Date.now() };
    const history = [...get().chat, userEntry];
    set({ chat: history, chatBusy: true });
    try {
      const result = await ModeApi.chat(
        history.map((e) => ({ role: e.role, content: e.content })),
      );
      set({
        chatBusy: false,
        chat: [
          ...history,
          {
            id: ModeApi.newId(),
            role: 'assistant',
            content: result.text,
            at: Date.now(),
            providerLabel: PROVIDER_LABELS[result.provider ?? ''] ?? result.provider ?? 'AI',
            failoverNotes: failoverNotes(result.failover, result.provider),
          },
        ],
      });
    } catch (err) {
      const message =
        err instanceof ModeApiError && err.code === 'ALL_PROVIDERS_FAILED'
          ? 'All configured AI providers are temporarily unavailable. Please try again in a minute.'
          : (err as Error).message;
      set({
        chatBusy: false,
        chat: [
          ...history,
          { id: ModeApi.newId(), role: 'assistant', content: message, at: Date.now(), isError: true },
        ],
      });
    }
  },
  clearChat: () => set({ chat: [] }),

  /* ---------------- image ---------------- */
  imagePrompt: '',
  imageCount: 1,
  imageBusy: false,
  imageError: null,
  images: [],
  promptHistory: loadPromptHistory(),
  imageStatus: null,
  imageStatusLoaded: false,
  setImagePrompt: (v) => set({ imagePrompt: v }),
  setImageCount: (n) => set({ imageCount: n }),
  loadImageStatus: async () => {
    try {
      const status = await ModeApi.imageStatus();
      set({ imageStatus: status, imageStatusLoaded: true });
    } catch {
      set({
        imageStatus: { configured: false, provider: null, label: null, model: null, providers: [] },
        imageStatusLoaded: true,
      });
    }
  },
  generateImages: async () => {
    const { imagePrompt, imageCount, imageBusy } = get();
    const prompt = imagePrompt.trim();
    if (!prompt || imageBusy) return;
    set({ imageBusy: true, imageError: null });
    try {
      const result = await ModeApi.generateImage({ prompt, n: imageCount });
      const items: ImageItem[] = result.images.map((img) => ({
        id: ModeApi.newId(),
        dataUrl: ModeApi.toDataUrl(img.mime, img.base64),
        prompt,
        providerLabel: PROVIDER_LABELS[result.provider ?? ''] ?? result.label ?? result.provider ?? 'AI',
        model: result.model,
        at: Date.now(),
      }));
      const history = [prompt, ...get().promptHistory.filter((p) => p !== prompt)].slice(0, PROMPT_HISTORY_MAX);
      savePromptHistory(history);
      set({ images: [...items, ...get().images], promptHistory: history, imageBusy: false });
    } catch (err) {
      const message =
        err instanceof ModeApiError && err.code === 'IMAGE_PROVIDER_NOT_CONFIGURED'
          ? (err as ModeApiError).message
          : `Image generation failed: ${(err as Error).message}`;
      set({ imageBusy: false, imageError: message });
    }
  },
  removeImage: (id) => set({ images: get().images.filter((i) => i.id !== id) }),
  clearImages: () => set({ images: [] }),

  /* ---------------- video ---------------- */
  videoStatus: null,
  videoStatusLoaded: false,
  videoPrompt: '',
  videoStage: 'idle',
  videoBusy: false,
  videoError: null,
  videoUrl: null,
  videoProviderLabel: null,
  videoImageName: null,
  videoImageB64: null,
  videoImageMime: null,
  setVideoPrompt: (v) => set({ videoPrompt: v }),
  setVideoImage: (b64, mime, name) =>
    set({
      videoImageName: b64 ? (name ?? 'reference image') : null,
      videoImageB64: b64,
      videoImageMime: b64 ? (mime ?? 'image/png') : null,
    }),
  loadVideoStatus: async () => {
    try {
      const status = await ModeApi.videoStatus();
      set({ videoStatus: status, videoStatusLoaded: true });
    } catch {
      set({
        videoStatus: { configured: false, provider: null, label: null, model: null, providers: [] },
        videoStatusLoaded: true,
      });
    }
  },
  generateVideo: async () => {
    const { videoPrompt, videoBusy } = get();
    const prompt = videoPrompt.trim();
    if (!prompt || videoBusy) return;

    const { videoImageB64, videoImageMime } = get();
    videoAbort = new AbortController();
    set({ videoBusy: true, videoError: null, videoUrl: null, videoStage: 'starting' });
    try {
      const start = await ModeApi.startVideo(
        { prompt, imageBase64: videoImageB64 ?? undefined, imageMime: videoImageMime ?? undefined },
        videoAbort.signal,
      );
      if (!get().videoBusy) return; // cancelled during start
      set({ videoStage: 'rendering', videoProviderLabel: PROVIDER_LABELS[start.provider ?? ''] ?? start.label ?? start.provider ?? 'Video AI' });

      // Bounded polling: every 5s for up to ~10 minutes. Honest errors only.
      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        if (videoAbort.signal.aborted) return;
        const state = await ModeApi.pollVideo(start.operation, videoAbort.signal);
        if (videoAbort.signal.aborted) return;
        if (!state.done) continue;
        if (state.error) {
          set({ videoStage: 'error', videoError: state.error, videoBusy: false });
          return;
        }
        if (state.video) {
          set({
            videoStage: 'done',
            videoUrl: ModeApi.toDataUrl(state.video.mime, state.video.base64),
            videoBusy: false,
          });
          return;
        }
      }
      set({ videoStage: 'error', videoError: 'Video generation is taking longer than expected — try again later.', videoBusy: false });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      const message =
        err instanceof ModeApiError && err.code === 'VIDEO_PROVIDER_NOT_CONFIGURED'
          ? 'Video provider not configured. ' + (get().videoStatus?.hint ?? '')
          : `Video generation failed: ${(err as Error).message}`;
      set({ videoStage: 'error', videoError: message, videoBusy: false });
    } finally {
      videoAbort = null;
    }
  },
  cancelVideo: () => {
    videoAbort?.abort();
    videoAbort = null;
    set({ videoBusy: false, videoStage: 'idle' });
  },

  /* ---------------- build-app wizard ---------------- */
  buildAppDraft: { name: '', appType: 'Landing page', style: 'Clean & modern', features: '', pages: '', notes: '' },
  setBuildAppDraft: (patch) => set({ buildAppDraft: { ...get().buildAppDraft, ...patch } }),
}));
