/**
 * Server-side vendor adapters.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS IS THE ONLY PLACE IN THE CODEBASE THAT TOUCHES AN API KEY.
 *  Keys are read from process.env and NEVER sent to the browser.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Each adapter converts the app's neutral message array into one vendor's
 * wire format and normalises the reply back to plain text. The agent logic
 * lives in the shared code — adapters only translate.
 *
 * To add a provider: implement { id, isConfigured, chat } and register it in
 * PROVIDERS below. Nothing else in the application changes.
 */

/* ------------------------------------------------------------------ */
/* OpenAI (also covers Azure OpenAI + any OpenAI-compatible endpoint)  */
/* ------------------------------------------------------------------ */

const openai = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-4o',
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),

  async chat({ messages, model, temperature, jsonMode, signal }) {
    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || process.env.OPENAI_MODEL || openai.defaultModel,
        messages,
        temperature: temperature ?? 0.3,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`OpenAI ${res.status}: ${detail.slice(0, 400)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      model: data.model,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Anthropic                                                           */
/* ------------------------------------------------------------------ */

const anthropic = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),

  async chat({ messages, model, temperature, signal }) {
    const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';

    // Anthropic takes the system prompt as a top-level field, not a message.
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || process.env.ANTHROPIC_MODEL || anthropic.defaultModel,
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 8192),
        temperature: temperature ?? 0.3,
        ...(system ? { system } : {}),
        messages: rest.length ? rest : [{ role: 'user', content: 'Continue.' }],
      }),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Anthropic ${res.status}: ${detail.slice(0, 400)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
      },
      model: data.model,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Google Gemini                                                       */
/* ------------------------------------------------------------------ */

const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: 'gemini-2.0-flash',
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),

  async chat({ messages, model, temperature, jsonMode, signal }) {
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const chosen = model || process.env.GEMINI_MODEL || gemini.defaultModel;

    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const res = await fetch(
      `${base}/models/${encodeURIComponent(chosen)}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Continue.' }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            temperature: temperature ?? 0.3,
            maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS || 8192),
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal,
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Gemini ${res.status}: ${detail.slice(0, 400)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');

    return {
      text,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: chosen,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const PROVIDERS = { openai, anthropic, gemini };

/**
 * Resolves the active provider.
 * Explicit AI_PROVIDER wins; otherwise the first configured provider is used.
 */
export function resolveProvider(requested) {
  const wanted = requested || process.env.AI_PROVIDER;
  if (wanted && PROVIDERS[wanted]) {
    return PROVIDERS[wanted].isConfigured() ? PROVIDERS[wanted] : null;
  }
  return Object.values(PROVIDERS).find((p) => p.isConfigured()) ?? null;
}

export function providerStatus() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    defaultModel: p.defaultModel,
  }));
}
