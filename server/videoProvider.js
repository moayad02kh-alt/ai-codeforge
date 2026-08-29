/**
 * Server-side VIDEO generation providers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HONESTY POLICY: video generation is NEVER faked. When no provider is
 *  configured, /api/agent/video/status says so and /api/agent/video returns
 *  a clear VIDEO_PROVIDER_NOT_CONFIGURED error — the UI shows a setup
 *  message instead of pretending.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Architecture: the same registry/adapter pattern as chat and image, so a
 * real provider can be connected later WITHOUT touching the UI:
 *
 *   { id, label, defaultModel, isConfigured(),
 *     start({ prompt, imageBase64?, imageMime?, signal }) -> { operation },
 *     poll({ operation, signal }) -> { done, video?|error?, operation? } }
 *
 * Video generation is long-running (minutes), which exceeds serverless time
 * limits, so the flow is stateless two-phase: `start()` returns an opaque
 * operation token; the client polls `poll()` (the token round-trips, no
 * server-side job state needed).
 *
 * Config (all optional):
 *   VIDEO_PROVIDER   adapter id — must be set EXPLICITLY (e.g. "veo") to
 *                    activate video generation.
 *   VEO_MODEL        model override (default veo-3.0-generate-001)
 *   VEO_API_KEY / GEMINI_API_KEY   credential for the veo adapter
 */

import { readEnvSecret } from './providers.js';

/* ------------------------------------------------------------------ */
/* Adapter: Google Veo (text-to-video, image-to-video)                 */
/* ------------------------------------------------------------------ */

const veo = {
  id: 'veo',
  label: 'Google Veo',
  defaultModel: 'veo-3.0-generate-001',
  keyNames: ['VEO_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],

  // Deliberately conservative: video stays DISABLED until the operator opts
  // in via VIDEO_PROVIDER=veo AND a key exists. No silent enablement.
  isConfigured: () => {
    const wanted = (process.env.VIDEO_PROVIDER || '').toLowerCase();
    if (wanted !== 'veo' && wanted !== 'gemini-veo') return false;
    return Boolean(readEnvSecret(...veo.keyNames));
  },

  async start({ prompt, imageBase64, imageMime, signal }) {
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const chosen = process.env.VIDEO_MODEL || process.env.VEO_MODEL || veo.defaultModel;
    const apiKey = readEnvSecret(...veo.keyNames);

    const instance = { prompt };
    // Image-to-video: the reference image rides on the instance when given.
    if (imageBase64) {
      instance.image = { bytesBase64Encoded: imageBase64, mimeType: imageMime || 'image/png' };
    }

    const res = await fetch(`${base}/models/${encodeURIComponent(chosen)}:predictLongRunning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ instances: [instance], parameters: {} }),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Veo ${res.status}: ${detail.slice(0, 900)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    if (!data.name) {
      throw Object.assign(new Error('Veo did not return an operation name.'), { status: 502 });
    }
    return { operation: data.name, model: chosen };
  },

  async poll({ operation, signal }) {
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const apiKey = readEnvSecret(...veo.keyNames);

    const res = await fetch(`${base}/${operation.replace(/^\/+/, '')}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Veo ${res.status}: ${detail.slice(0, 900)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    if (!data.done) return { done: false, operation: data.name ?? operation };

    if (data.error) {
      return { done: true, error: String(data.error.message ?? 'Video generation failed.') };
    }

    // Response shapes have varied across Veo versions — check them all.
    const resp = data.response ?? {};
    const sample =
      resp.generateVideoResponse?.generatedSamples?.[0] ??
      resp.generatedSamples?.[0] ??
      (resp.videos?.length ? { video: resp.videos[0] } : null) ??
      (resp.generatedVideos?.length ? { video: resp.generatedVideos[0] } : null);

    const video = sample?.video ?? sample;
    if (video?.bytesBase64Encoded) {
      return { done: true, video: { base64: video.bytesBase64Encoded, mime: 'video/mp4' } };
    }
    if (video?.uri) {
      // File URI — download server-side with the key (never expose the URI,
      // which embeds access in query params on some versions).
      const fileRes = await fetch(video.uri, {
        headers: { 'x-goog-api-key': apiKey },
        signal,
      });
      if (!fileRes.ok) {
        return { done: true, error: `Could not download generated video (HTTP ${fileRes.status}).` };
      }
      const buf = Buffer.from(await fileRes.arrayBuffer());
      return {
        done: true,
        video: { base64: buf.toString('base64'), mime: fileRes.headers.get('content-type') ?? 'video/mp4' },
      };
    }

    // Some filter blocked the generation — surface it honestly.
    const reason =
      resp.raiMediaFilteredReasons?.[0] ?? sample?.raiMediaFilteredReasons?.[0] ?? 'No video was returned.';
    return { done: true, error: reason };
  },
};

/* ------------------------------------------------------------------ */
/* Registry & status                                                   */
/* ------------------------------------------------------------------ */

export const VIDEO_PROVIDERS = { veo };

export function resolveVideoProvider(preferred) {
  const wanted = preferred || process.env.VIDEO_PROVIDER;
  if (wanted && VIDEO_PROVIDERS[wanted]?.isConfigured()) return VIDEO_PROVIDERS[wanted];
  return null;
}

/** Non-secret status for the UI (ids/labels only — never keys). */
export function videoProviderStatus() {
  const active = resolveVideoProvider();
  return {
    configured: Boolean(active),
    provider: active?.id ?? null,
    label: active?.label ?? null,
    model: active ? process.env.VIDEO_MODEL || process.env.VEO_MODEL || active.defaultModel : null,
    providers: Object.values(VIDEO_PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      defaultModel: p.defaultModel,
    })),
    // Setup hint so the UI can show something actionable.
    hint: 'Set VIDEO_PROVIDER=veo and provide VEO_API_KEY (or GEMINI_API_KEY) to enable video generation.',
  };
}
