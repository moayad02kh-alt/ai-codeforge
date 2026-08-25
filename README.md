# CodeForge AI

A dark-themed AI coding platform. You describe a project in natural language; an
agent plans it, writes the files, runs checks, detects errors, repairs them, and
shows the result in a live preview.

CodeForge runs in **two modes** and tells you which one you're in at all times:

| | Simulated (default) | Live |
|---|---|---|
| Trigger | No API key present | A key is set in `.env` |
| Code generation | Deterministic blueprint engine | A real LLM (OpenAI / Anthropic / Gemini) |
| Badge in top bar | Amber "Simulated" | Green "Live · \<provider\>" |
| Cost | Free | Billed by your vendor |

Everything else — the editor, preview sandbox, error detection, repair loop,
version history — is identical in both modes, because those parts are real
either way.

---

## Quick start

```bash
npm install
npm run dev          # starts the API server (:8787) and the web app (:5173)
```

Open http://localhost:5173. With no `.env` you get the full app in **simulated**
mode. Nothing is stubbed out or disabled; the generator is just a local blueprint
engine instead of a model.

To connect a real model:

```bash
cp .env.example .env
# edit .env, add ONE key
npm run dev
```

The badge in the top bar flips to green on its own — the frontend probes
`/api/agent/status` at startup. No rebuild, no code change.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API + web together, colour-prefixed logs |
| `npm run dev:client` | Web only (assumes an API is already up) |
| `npm run server` | API only |
| `npm run build` | Production client build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:agent` | End-to-end agent test against a fake vendor |

---

## Configuring a provider

Pick **one** vendor and set its key. The server auto-detects which one is
configured — you don't have to set `AI_PROVIDER` unless you have several keys
present and want to force a specific one.

```bash
cp .env.example .env
```

Then edit `.env` and uncomment one block:

```ini
# --- OpenAI ---
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# --- or Anthropic ---
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# --- or Google Gemini ---
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash
```

Restart the server. That's the whole process — no frontend edits, no rebuild.

> `.env` is gitignored (`.env`, `.env.*`, with `!.env.example` negated), so your
> key cannot be committed by accident. `.env.example` contains placeholders only.

### Starting the server

```bash
npm run dev
```

This runs both processes with colour-prefixed logs:

- `[api]` — the provider server on **:8787** (the only process that sees keys)
- `[web]` — the Vite app on **:5173**, proxying `/api` → `:8787`

Run them separately with `npm run server` and `npm run dev:client` if you prefer.

### Verifying Live mode

Three independent checks, cheapest first:

**1. The server log on startup.**

```
[api] [codeforge] Provider: OpenAI (openai)      ← live
[api] [codeforge] No provider configured …       ← simulated
```

**2. The status endpoint** (safe to curl — it never returns key material):

```bash
curl localhost:5173/api/agent/status
```

```jsonc
{ "configured": true, "activeProvider": "openai", "activeModel": "gpt-4o", … }
```

`"configured": false` means the server didn't find a key. Check that `.env` is
in the project root and that you restarted after editing it.

**3. The badge in the app.** Green **"Live · openai · gpt-4o"** means the
frontend probed the backend and switched providers. Amber **"Simulated"** means
it's on the blueprint engine. The badge is driven by the probe, not by a
setting, so it cannot claim Live while the server is unconfigured.

If the key is present but wrong, you get an honest failure rather than a silent
fallback: the vendor's real status code surfaces in the UI (e.g. `401
UPSTREAM_ERROR`), with the key scrubbed to `sk-***`.

---

## What is real and what is simulated

Being precise about this matters, so here is the honest breakdown.

### Real in every mode

- **Preview execution.** Your generated HTML/CSS/JS is genuinely bundled and
  executed in a sandboxed `iframe`. What you see is the actual code running.
- **Error detection.** `ErrorDetector` is a real static analyser with a
  documented rule set (`CF1001` unbalanced braces, `CF2001` unresolved asset
  references, `CF3005` missing entry point, and so on). Real parse, real spans.
- **The repair loop.** Analyse → suggest → apply → re-run → verify, with a real
  revert when a fix fails to help.
- **File manager, version history, diffs, restore.** Real data structures, real
  snapshots.
- **Project Context selection.** Real token budgeting and relevance ranking.
- **Action validation and the security boundary.** Real, and tested.

### Simulated when no key is set

- **Code generation.** `MockAIProvider` matches your prompt against blueprints
  (restaurant, portfolio, dashboard, landing page…) and applies transforms for
  edits like *"make the accent colour emerald"* or *"add an FAQ section"*. It's
  deterministic and offline. When it can't map a request onto a concrete change
  it says so plainly rather than pretending.
- **Test execution.** Test results in simulated mode are heuristic, not a real
  runner.

### Simulated in *both* modes

- **Persistence.** Projects live in `localStorage`. There is no database, no
  accounts, no server-side project storage.
- **The test runner.** There is no container sandbox executing a real test
  suite. `CodeRunner.runTests` is a heuristic checker. Wiring a real sandbox is
  the natural next step; the interface is already shaped for it.

The UI never claims a model wrote something when one didn't. Simulated turns are
labelled in the chat panel with the exact commands to connect a real provider.

---

## Where the provider is configured

**`src/services/registry.ts`** — this is the connection point. It's the only
file that decides which provider the app uses:

```ts
export async function initProvider(force = false) {
  const status = await LLMProvider.probe(AGENT_API_BASE);
  if (status?.configured) setProvider(new LLMProvider(status));
  else setProvider(new MockAIProvider());
}
```

`probe()` returns `null` if the backend is unreachable, so the app degrades to
simulation instead of throwing. `initProvider()` never rejects.

Both providers implement the same `AIProvider` interface
(`src/services/ai/AIProvider.ts`): `classifyIntent`, `createPlan`, `generate`,
`proposeRepair`, `streamMessage`. Nothing upstream of the interface knows or
cares which one is active.

### Adding a vendor

Add one adapter object to `PROVIDERS` in `server/providers.js`:

```js
myvendor: {
  id: 'myvendor',
  label: 'My Vendor',
  defaultModel: 'my-model-v1',
  isConfigured: () => Boolean(process.env.MYVENDOR_API_KEY),
  async chat({ messages, model, temperature, jsonMode, signal }) {
    // call the vendor, return { text, usage, model }
  },
}
```

That's the whole change. **Zero frontend edits.** The settings modal picks up the
new provider from `/api/agent/status` automatically.

---

## Security

**The browser never holds an API key.** This is enforced structurally, not by
convention.

```
Browser  →  /api/agent/*  →  server/index.js  →  server/providers.js  →  Vendor
(no key)     (same origin)    (reads process.env)      (adds the key)
```

- `server/providers.js` is the **only** file that reads a key. It is a Node
  module; it is never imported by the client bundle.
- Keys are **never** prefixed `VITE_`. Vite inlines `VITE_*` into the bundle —
  that prefix on a secret is how keys leak. `.env.example` warns about this
  explicitly, and `.gitignore` ignores `.env` / `.env.*` while keeping
  `.env.example`.
- `GET /api/agent/status` reports only *whether* a key exists, never any part of
  it. The test suite asserts the response contains no key material.
- `safeErrorMessage()` scrubs `sk-…`, `key=…`, and `Bearer …` patterns from
  errors before they reach the browser, so a vendor error can't echo a key back.
- The build output is scanned: no key patterns, no vendor env-var names, no
  `process.env` access in the client bundle.

### Other hardening

- **Path safety.** Every file path from the model is validated by `isSafePath`.
  Rejected: `../` traversal, absolute paths, drive letters, NUL bytes, and
  writes to `.env`, `.env.local`, `.git/`, `node_modules/`. A malicious action
  is dropped and the user is told, while safe actions in the same turn still
  apply.
- **Action limits.** 40 actions per turn, 512 KB per file, 200-character paths.
- **Request limits.** 8 MB body cap, per-IP rate limit (`RATE_LIMIT_PER_MINUTE`,
  default 30, `0` disables), configurable CORS origin, and a request timeout.
- **Preview sandbox.** The preview `iframe` runs *without* `allow-same-origin`,
  so generated code cannot reach the parent page, its storage, or its cookies.

A caveat worth stating: the preview sandbox protects the host page, but it is
not a substitute for a real execution sandbox for untrusted server-side code.
Don't point this at a hostile model and run the output on a server.

---

## How the repair loop works

The self-healing cycle is **Error → Analyze → Suggest Fix → Apply Fix → Run
Again → Verify**, and every stage is recorded so the timeline shows what the
agent actually did.

1. **Detect.** `ErrorDetector.analyze()` produces diagnostics with a code, file,
   line, severity, and a `repairable` flag.
2. **Prioritise.** `AutoRepair.prioritize()` keeps only repairable diagnostics,
   sorts errors ahead of warnings, and **slices to `maxRepairAttempts`**
   (default 3). This is the hard cap — the loop is bounded by construction and
   cannot spin.
3. **Analyze & suggest.** The diagnostic plus the relevant file goes to
   `proposeRepair`. In live mode that's a focused model call with a repair-
   specific system prompt; in simulated mode it's a rule-based fixer.
4. **Apply.** The fix is applied to an in-memory copy. A version snapshot is
   taken first.
5. **Re-run & verify.** Detection runs again. If the diagnostic is gone the
   attempt is marked `verified`. **If it isn't, the change is reverted** — a
   failed repair never leaves the project worse than it found it.
6. Repeat for the next diagnostic until the cap is reached.

Every attempt is written to version history, so a bad modification is always
one click from being undone.

### Cost control

Intent classification, planning, and generation are fulfilled by **one** model
request per turn, not three. `LLMProvider` runs the call once and serves all
three interface methods from a per-prompt `RunCache`. The test suite asserts
`callCount === 1` so this can't silently regress.

The one place a second call is intentional is `inspect_file`: if the model asks
to see a file that wasn't in context, the loop feeds the contents back and asks
again — bounded by `maxInspectionRounds` (default 2).

---

## What the model receives

Every live request carries the context the agent needs to make a correct edit.
All six are asserted at the wire level in `npm run test:agent`, against the
actual bytes sent to the vendor:

| Input | Source |
|---|---|
| The user's request | `ctx.prompt` |
| Project structure | rendered file tree (`renderTree`) |
| Relevant file contents | `ProjectContextManager`, ranked and budgeted |
| Current diagnostics | `ctx.diagnostics` → `## Active diagnostics` block |
| Previous agent context | `ctx.history`, trimmed to budget |
| Inspected files | `## Files you requested`, on `inspect_file` turns |

Diagnostics do double duty: they're shown to the model *and* they boost the
ranking of the files they point at, so a broken file is far more likely to make
it into the context budget than an unrelated one.

---

## Structured actions

The agent doesn't emit prose that gets regex-scraped. It returns a JSON envelope
of typed actions, each carrying everything needed to apply it safely:

| Action | Purpose |
|---|---|
| `create_file` | New file with full contents |
| `update_file` | Replace contents of an existing file |
| `delete_file` | Remove a file |
| `rename_file` | Move `from` → `to` |
| `inspect_file` | Ask to see a file before deciding (triggers a second turn) |
| `run_check` | Request a named validation |
| `repair_error` | Targeted fix for a specific diagnostic |

Actions go through `validateAction` before anything touches disk, then through a
**pure** `ActionExecutor.execute(files, actions)` that returns new state plus a
log of what applied and what was skipped. Because it's pure, it's trivially
testable — which is most of what the E2E suite exercises.

JSON extraction is deliberately forgiving (`extractJson`): bare JSON, fenced
blocks, and JSON buried in prose all parse, and the brace scanner respects
strings and escapes so a `}` inside a string literal doesn't truncate the parse.

---

## Project Context

Sending an entire project to a model doesn't scale and doesn't work well.
`ProjectContextManager` picks what's relevant:

- Budgets: **24 000 tokens**, **30 files**, **6 000 tokens per file**
  (≈ `chars / 4`).
- Ranking: pinned `+1000`, entry point `+500`, manifests `+300`, prompt-term
  hits, files with diagnostics `+120`, plus recency.
- `node_modules` and friends are excluded outright.
- Oversized files are truncated with an `inspect_file` hint, so the model can
  ask for the rest instead of guessing.

---

## Architecture

```
src/
  core/          types, utils, typed event bus
  services/
    ai/
      AIProvider.ts       the interface both providers implement
      MockAIProvider.ts   offline blueprint engine (fallback)
      LLMProvider.ts      live adapter — talks only to /api/agent/*
      ProjectContext.ts   relevance ranking + token budgeting
      actions.ts          action union, validation, pure executor
      prompts.ts          system prompts, JSON extraction, parsing
      blueprints.ts       simulated project templates
    AgentOrchestrator.ts  the pipeline
    FileManager.ts  VersionManager.ts  ErrorDetector.ts
    CodeRunner.ts   AutoRepair.ts
    registry.ts           ← provider configuration point
  state/         Zustand store + seed data
  hooks/         useProvider() — reactive provider status
  components/    TopBar, Sidebar, ChatPanel, CodeEditor,
                 PreviewPanel, BottomPanel, AgentTimeline, SettingsModal
server/
  index.js       dependency-free Node http server
  providers.js   vendor adapters — the ONLY reader of API keys
scripts/
  dev.mjs        concurrent api + web launcher
  test-agent.mjs end-to-end agent test
```

Pipeline: **Understand → Plan → Generate → Validate → Detect → Repair →
Verify → Preview**, orchestrated by `AgentOrchestrator` and streamed to the UI
through the event bus, which is what drives the live agent timeline.

---

## Testing

```bash
npm run test:agent
```

This is a genuine end-to-end test, not a mock of the thing being tested. It
starts a fake vendor speaking the OpenAI wire format, points the **real**
`server/index.js` at it, and drives the **real** `LLMProvider`:

```
LLMProvider → /api/agent/* → provider adapter → fake vendor
            → parse → validate → ActionExecutor
```

63 checks cover path traversal and `.env` write attempts, JSON extraction edge
cases (fenced, prose-wrapped, braces inside strings, escaped quotes), context
budgeting, action validation, executor semantics, the single-call cost
guarantee, the multi-turn `inspect_file` loop, the repair path, `probe()`
returning `null` when the backend is down, and the assertion that no key
material appears in any response.

The **wire-level context checks** are the ones worth knowing about: they assert
the user request, project structure, file contents, diagnostics, and prior
history are all genuinely present in the payload the vendor receives. Types
alone don't prove this — an optional field can typecheck perfectly and still
never be populated by its caller, which is exactly the bug these caught.

Also verified outside the suite, against a fake vendor over real HTTP:

- **All three adapters** authenticate the way their vendor expects — OpenAI
  `Authorization: Bearer`, Anthropic `x-api-key`, Gemini query param — and none
  of them leak the key back to the client.
- **The repair contract**: a genuine fix ends `verified` and is kept (0 errors
  remaining); a non-fix ends `failed` and the file is **byte-identical to the
  original**; `prioritize(9 diagnostics, max 3)` yields exactly 3 attempts.
- **Honest failure**: a bad key returns the vendor's real `401` with the key
  scrubbed to `sk-***`; no key returns `503 PROVIDER_NOT_CONFIGURED` with a hint
  pointing at `.env`. Neither path invents a response.

---

## Known gaps

Stated plainly rather than buried:

- **No real test sandbox.** `runTests` is heuristic. A container-backed runner is
  the obvious next step.
- **No persistence beyond `localStorage`.** No database, no auth, no
  multi-device sync.
- **No command palette.** `⌘K` is hinted in the UI but not implemented.
- **No token-by-token streaming.** The JSON envelope must be complete before it
  can be validated and applied, so `streamMessage` replays the finished prose.
  This is a deliberate correctness trade-off, not an oversight.

---

## Configuration reference

All server-side. See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | auto | `openai` \| `anthropic` \| `gemini`; auto-detects from whichever key is set |
| `OPENAI_API_KEY` / `_MODEL` / `_BASE_URL` | — / `gpt-4o` / vendor | |
| `ANTHROPIC_API_KEY` / `_MODEL` / `_MAX_TOKENS` | — / `claude-sonnet-4-20250514` / — | |
| `GEMINI_API_KEY` / `_MODEL` | — / `gemini-2.0-flash` | |
| `PORT` | `8787` | Vite proxies `/api` here |
| `AI_TIMEOUT_MS` | `120000` | |
| `RATE_LIMIT_PER_MINUTE` | `30` | `0` disables |
| `CORS_ORIGIN` | `*` | Restrict in production |

Real environment variables win over `.env`, so container and CI injection work
without a file.
