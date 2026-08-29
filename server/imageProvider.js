/**
 * Server-side IMAGE generation providers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SECURITY: same model as the chat providers — API keys are read from
 *  process.env HERE, inside the server(less) function, and are NEVER sent
 *  to the browser, logged, or embedded in responses.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Architecture: a registry of adapters with one uniform contract:
 *
 *   { id, label, defaultModel, keyNames,
 *     isConfigured(), generate({ prompt, n, size, signal }) }
 *
 * The UI never knows which adapter is active — it only renders whatever
 * /api/agent/image returns. Adding or swapping an image provider later
 * (e.g. Imagen, Flux, DALL·E) means adding ONE adapter object here; zero
 * UI changes.
 *
 * Config via env:
 *   IMAGE_PROVIDER   preferred adapter id (default: first configured)
 *   IMAGE_MODEL      per-adapter model override (IMAGE_MODEL or <ID>_MODEL)
 *   GEMINI_API_KEY   powers the default 'gemini' image adapter
 *   OPENAI_API_KEY   powers the optional 'openai' image adapter
 */

import { readEnvSecret } from './providers.js';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // per-image sanity cap (base64)

/** Extracts inline image parts from a Gemini generateContent response. */
function geminiInlineImages(data) {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const images = [];
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    if (inline?.data) {
      images.push({
        base64: inline.data,
        mime: inline.mimeType ?? inline.mime_type ?? 'image/png',
      });
    }
  }
  return images;
}

/* ------------------------------------------------------------------ */
/* Adapter: Google Gemini (default — works with the existing key)      */
/* ------------------------------------------------------------------ */

const geminiImage = {
  id: 'gemini',
  label: 'Google Gemini',
  // Gemini image generation model (nano-banana family). Override: IMAGE_MODEL.
  defaultModel: 'gemini-2.5-flash-image',
  keyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  isConfigured: () => Boolean(readEnvSecret(...geminiImage.keyNames)),

  async generate({ prompt, n = 1, signal }) {
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const chosen =
      process.env.IMAGE_MODEL ||
      process.env.GEMINI_IMAGE_MODEL ||
      geminiImage.defaultModel;
    const apiKey = readEnvSecret(...geminiImage.keyNames);
    const images = [];

    // The Gemini image model returns one image per call, so n variations are
    // n bounded sequential calls (n is capped by the route to <= 4).
    for (let i = 0; i < n; i += 1) {
      const res = await fetch(
        `${base}/models/${encodeURIComponent(chosen)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      i === 0
                        ? prompt
                        : `${prompt}\n\nVariation ${i + 1}: keep the subject and intent, explore a clearly different composition/style interpretation.`,
                  },
                ],
              },
            ],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          signal,
        },
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw Object.assign(
          new Error(`Gemini Image ${res.status}: ${detail.slice(0, 900)}`),
          { status: res.status },
        );
      }

      const data = await res.json();
      const got = geminiInlineImages(data);
      if (!got.length) {
        throw Object.assign(
          new Error('Gemini Image returned no image data (possibly safety-blocked or quota-limited).'),
          { status: 502 },
        );
      }
      for (const img of got) {
        if (img.base64.length <= MAX_IMAGE_BYTES) images.push(img);
      }
    }

    return { images, model: chosen };
  },
};

/* ------------------------------------------------------------------ */
/* Adapter: OpenAI Images (optional, used if configured)               */
/* ------------------------------------------------------------------ */

const openaiImage = {
  id: 'openai',
  label: 'OpenAI Images',
  defaultModel: 'gpt-image-1',
  keyNames: ['OPENAI_API_KEY'],
  isConfigured: () => Boolean(readEnvSecret(...openaiImage.keyNames)),

  async generate({ prompt, n = 1, size = '1024x1024', signal }) {
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const chosen = process.env.IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || openaiImage.defaultModel;

    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readEnvSecret(...openaiImage.keyNames)}`,
      },
      body: JSON.stringify({ model: chosen, prompt, n, size }),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`OpenAI Images ${res.status}: ${detail.slice(0, 900)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    const images = (data.data ?? [])
      .filter((d) => d.b64_json)
      .map((d) => ({ base64: d.b64_json, mime: 'image/png' }));

    if (!images.length) {
      throw Object.assign(new Error('OpenAI Images returned no image data.'), { status: 502 });
    }
    return { images, model: chosen };
  },
};

/* ------------------------------------------------------------------ */
/* Registry & resolution (mirrors the chat provider chain pattern)     */
/* ------------------------------------------------------------------ */

export const IMAGE_PROVIDERS = { gemini: geminiImage, openai: openaiImage };

const IMAGE_ORDER = [geminiImage, openaiImage];

/** Ordered chain of CONFIGURED image providers: preferred first. */
export function imageProviderChain(preferred) {
  const wanted = preferred || process.env.IMAGE_PROVIDER;
  const chain = [];
  const push = (p) => {
    if (p && p.isConfigured() && !chain.includes(p)) chain.push(p);
  };
  if (wanted && IMAGE_PROVIDERS[wanted]) push(IMAGE_PROVIDERS[wanted]);
  for (const p of IMAGE_ORDER) push(p);
  return chain;
}

export function resolveImageProvider(preferred) {
  return imageProviderChain(preferred)[0] ?? null;
}

/** Non-secret status for the UI (ids/labels only — never keys). */
export function imageProviderStatus() {
  const active = resolveImageProvider();
  return {
    configured: Boolean(active),
    provider: active?.id ?? null,
    label: active?.label ?? null,
    model: active
      ? process.env.IMAGE_MODEL || active.defaultModel
      : null,
    providers: IMAGE_ORDER.map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      defaultModel: p.defaultModel,
    })),
  };
}
