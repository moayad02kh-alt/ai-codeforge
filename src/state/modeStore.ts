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
  type ChatImage,
  type ModeProviderStatus,
  type ProviderFailoverAttempt,
} from '../services/ModeApi';
import { PROVIDER_LABELS } from '../services/ai/LLMProvider';
import { safeStorage } from '../lib/safeStorage';

export type WorkspaceMode = 'agent' | 'chat' | 'image' | 'video' | 'buildapp';

/**
 * Chat AI answer style, chosen next to the composer.
 *  - fast  ⚡ quick answers, revealed progressively as they arrive
 *  - think 🧠 deeper step-by-step reasoning through the same provider chain
 * Purely a Chat-AI concern — the coding agent never reads this.
 */
export type ChatStyle = 'fast' | 'think';

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Provider that served an assistant reply (e.g. "Gemini"). */
  providerLabel?: string;
  /** Failover notices, e.g. "Gemini unavailable — using Groq". */
  failoverNotes?: string[];
  /** Real web citations returned by the provider's grounding (search on). */
  sources?: Array<{ title: string; uri: string }>;
  /** The message was asked with web search enabled. */
  usedSearch?: boolean;
  /** The message was asked with an image attached. */
  hadImage?: boolean;
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

/**
 * Think-mode instruction sent as an extra system message on the SAME
 * /api/agent/chat endpoint. Prompt-level reasoning steer only — it does not
 * change providers, models, keys, or the server.
 */
const THINK_SYSTEM_PROMPT =
  'You are in deep-thinking mode. Reason through the question step by step before answering: ' +
  'break the problem down, weigh alternatives, check your own reasoning for mistakes, and then ' +
  'give one clear, well-structured final answer. Prefer substance over speed; take the time you need.';

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
  chatStyle: ChatStyle;
  setChatStyle: (style: ChatStyle) => void;
  sendChat: (
    prompt: string,
    opts?: { images?: ChatImage[]; search?: boolean },
  ) => Promise<void>;
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
  chatStyle: 'fast',
  setChatStyle: (chatStyle) => set({ chatStyle }),
  sendChat: async (prompt, opts) => {
    const text = prompt.trim();
    if (!text || get().chatBusy) return;

    const userEntry: ChatEntry = { id: ModeApi.newId(), role: 'user', content: text, at: Date.now() };
    const history = [...get().chat, userEntry];
    set({ chat: history, chatBusy: true });
    // Which style is active for THIS message (switching mid-flight only
    // affects the next message).
    const style = get().chatStyle;
    try {
      // Think mode rides the SAME chat endpoint; the reasoning instruction is
      // an extra system message, which every provider adapter merges into its
      // system field. No second backend, no provider/config changes.
      const outgoing = history.map((e) => ({ role: e.role, content: e.content }) as const);
      const payload =
        style === 'think'
          ? [
              { role: 'system' as const, content: THINK_SYSTEM_PROMPT },
              ...outgoing.slice(-15),
            ]
          : outgoing;
      const result = await ModeApi.chat(payload, undefined, {
        images: opts?.images,
        search: opts?.search,
      });
      const reply: ChatEntry = {
        id: ModeApi.newId(),
        role: 'assistant',
        content: '',
        at: Date.now(),
        providerLabel: PROVIDER_LABELS[result.provider ?? ''] ?? result.provider ?? 'AI',
        failoverNotes: failoverNotes(result.failover, result.provider),
        // Honest search metadata straight from the provider's grounding.
        usedSearch: opts?.search === true,
        sources: result.grounded ? (result.sources ?? []) : [],
        hadImage: Boolean(opts?.images?.length),
      };
      set({ chat: [...history, reply] });

      if (style === 'think') {
        // Present the finished answer in one clear block.
        set({ chatBusy: false, chat: [...history, { ...reply, content: result.text }] });
        return;
      }

      // Fast mode: reveal progressively (the chat path's existing streaming
      // behaviour). Aborts naturally if the entry is cleared mid-reveal.
      const tokens = result.text.match(/\S+\s*/g) ?? [result.text];
      for (const token of tokens) {
        const live = get().chat;
        if (!live.some((e) => e.id === reply.id)) {
          set({ chatBusy: false });
          return;
        }
        const last = live[live.length - 1];
        set({
          chat: [...live.slice(0, -1), { ...last, content: last.content + token }],
        });
        await new Promise((r) => setTimeout(r, 8));
      }
      const done = get().chat;
      if (done.some((e) => e.id === reply.id)) {
        const last = done[done.length - 1];
        set({ chatBusy: false, chat: [...done.slice(0, -1), { ...last, content: result.text }] });
      } else {
        set({ chatBusy: false });
      }
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
