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
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 16384),
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

// Shared JSON schema for structured agent responses. Used when jsonMode=true
// to make Gemini reliably return valid JSON with required fields.
// This is the official Gemini structured output feature.
const GEMINI_AGENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['create-project', 'modify-project', 'fix-error', 'explain'] },
        restatement: { type: 'string' },
        domain: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
    },
    plan: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              detail: { type: 'string' },
              targets: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
          },
        },
      },
    },
    actions: {
      type: 'array',
      description: 'At least one file operation is required. For create-project requests like Todo app, include create_file actions for index.html, styles, and scripts.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['create_file', 'update_file', 'delete_file', 'rename_file', 'inspect_file', 'run_check', 'repair_error'],
            description: 'The type of file operation',
          },
          path: { type: 'string', description: 'Relative file path, e.g. index.html or styles/main.css' },
          content: { type: 'string', description: 'Complete file contents for create_file/update_file' },
          reason: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          check: { type: 'string' },
          diagnosticCode: { type: 'string' },
          analysis: { type: 'string' },
        },
        required: ['type', 'path'],
      },
      minItems: 1,
    },
    message: { type: 'string' },
  },
  required: ['actions', 'message'],
};

const GEMINI_REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    analysis: { type: 'string' },
    suggestion: { type: 'string' },
    path: { type: 'string' },
    content: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['analysis', 'suggestion', 'path', 'content', 'confidence'],
};

const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: 'gemini-2.0-flash',
  // Support both GEMINI_API_KEY and GOOGLE_API_KEY per official docs
  // https://ai.google.dev/gemini-api/docs/api-key
  // New Auth keys (AQ.) and legacy Standard keys (AIza) are both accepted
  // isConfigured checks for any non-empty key, regardless of prefix (AIza, AQ., etc.)
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),

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

    // Detect if this is a repair request by looking for repair-specific system prompt
    const isRepair = system.toLowerCase().includes('automatic repair subsystem');
    const schema = isRepair ? GEMINI_REPAIR_SCHEMA : GEMINI_AGENT_SCHEMA;

    // Support both legacy AIza keys and new AQ. auth keys
    // Official docs: https://ai.google.dev/gemini-api/docs/api-key
    // - Standard keys (AIza) and Auth keys (AQ.) both work with x-goog-api-key header
    // - New Auth keys (AQ.) are default in AI Studio since 2026
    // - Using header avoids "Multiple authentication credentials" error that can occur
    //   when mixing ?key= query param with Bearer tokens on OpenAI-compatible routes
    // - Keep ?key= as fallback for backward compatibility, but prefer header
    // - isConfigured() checks Boolean(GEMINI_API_KEY) so both AIza and AQ. are accepted
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    const res = await fetch(`${base}/models/${encodeURIComponent(chosen)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Current official method per docs: x-goog-api-key header
        // Works for both AIza and new AQ. auth keys
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Continue.' }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature: temperature ?? 0.2,
          maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS || 16384),
          ...(jsonMode
            ? {
                responseMimeType: 'application/json',
                responseSchema: schema,
              }
            : {}),
        },
      }),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`Gemini ${res.status}: ${detail.slice(0, 400)}`), {
        status: res.status,
      });
    }

    const data = await res.json();
    let text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');

    // Production-grade handling for Gemini structured output
    // Even with responseMimeType application/json, Gemini can sometimes return
    // markdown-fenced JSON or surrounding text, especially with large HTML content
    if (jsonMode && text) {
      // If text looks like it contains JSON but is wrapped in fences or prose, extract it
      // Use robust scanner that respects escaped quotes and large content
      const trimmed = text.trim();
      // If already valid JSON, keep as is
      try {
        JSON.parse(trimmed);
      } catch {
        // Try to extract JSON from fences or surrounding text (server-side robust extraction)
        const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch) {
          const inner = fenceMatch[1]?.trim();
          if (inner) {
            try {
              JSON.parse(inner);
              text = inner;
            } catch {
              // Keep original, frontend parser will handle
            }
          }
        }
        // If still not valid JSON but contains {"actions", try to find balanced object
        if (text.includes('"actions"') || text.includes("'actions'")) {
          // Server-side quick validation: check if response might be truncated
          const openBraces = (text.match(/{/g) || []).length;
          const closeBraces = (text.match(/}/g) || []).length;
          if (openBraces > closeBraces) {
            console.warn(`[codeforge] Gemini response may be truncated: ${openBraces} { vs ${closeBraces} } - finishReason: ${data.candidates?.[0]?.finishReason}`);
          }
        }
      }
    }

    if (!text) {
      const finishReason = data.candidates?.[0]?.finishReason || 'unknown';
      throw new Error(`Gemini returned empty response (finishReason: ${finishReason}). Try again with shorter prompt or increase GEMINI_MAX_TOKENS.`);
    }

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
