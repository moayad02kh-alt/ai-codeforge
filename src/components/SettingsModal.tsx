import { useEffect, useState } from 'react';
import { useProvider } from '../hooks/useProvider';
import { useLiveProvider, useSimulatedProvider } from '../services/registry';
import { useStore } from '../state/store';
import { IconShield, IconX } from './Icons';
import './SettingsModal.css';

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="setting setting--toggle">
      <span className="setting__text">
        <span className="setting__label">{label}</span>
        <span className="setting__hint">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </label>
  );
}

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setSettingsOpen]);

  if (!open) return null;

  const { isLive: live, label: providerLabel, status: backendStatus } = useProvider();

  return (
    <div className="modal__scrim" onClick={() => setSettingsOpen(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2>Settings</h2>
          <button onClick={() => setSettingsOpen(false)} aria-label="Close settings">
            <IconX size={15} />
          </button>
        </header>

        <div className="modal__body">
          {/* ---- Backend status ---- */}
          <div className={`connect-notice ${live ? 'is-live' : ''}`}>
            <IconShield size={15} />
            <div>
              <strong>{live ? 'Live model connected' : 'No AI backend connected'}</strong>
              <p>
                {live ? (
                  <>
                    Requests are proxied through the server-side route at{' '}
                    <code className="mono">/api/agent</code> using{' '}
                    <strong>{providerLabel}</strong>. The API key stays in the server process and is
                    never sent to the browser.
                  </>
                ) : (
                  <>
                    The agent is running an offline simulation: prompts route to local blueprints
                    and test results are mocked. No inference occurs. The live preview does still
                    run your generated front-end, sandboxed in the browser.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* ---- Provider ---- */}
          <section className="modal__section">
            <h3>AI provider</h3>

            {/* Live detection results from GET /api/agent/status */}
            <div className="provider-grid">
              {(backendStatus?.providers ?? []).length === 0 ? (
                <p className="provider-grid__empty">
                  Backend unreachable. Start it with <code className="mono">npm run dev</code> (which
                  runs the API route alongside Vite) or <code className="mono">npm run server</code>.
                </p>
              ) : (
                backendStatus!.providers.map((p) => (
                  <div
                    key={p.id}
                    className={`provider-chip ${p.configured ? 'is-configured' : ''} ${
                      backendStatus?.activeProvider === p.id ? 'is-active' : ''
                    }`}
                  >
                    <span className="provider-chip__dot" />
                    <span className="provider-chip__name">{p.label}</span>
                    <span className="provider-chip__state">
                      {backendStatus?.activeProvider === p.id
                        ? 'Active'
                        : p.configured
                          ? 'Key set'
                          : 'No key'}
                    </span>
                  </div>
                ))
              )}
            </div>

            <label className="setting">
              <span className="setting__text">
                <span className="setting__label">Mode</span>
                <span className="setting__hint">
                  Force the offline simulation, or retry connecting to the live backend. The vendor
                  itself is chosen server-side via <code className="mono">AI_PROVIDER</code> in{' '}
                  <code className="mono">.env</code>.
                </span>
              </span>
              <div className="setting__actions">
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    useSimulatedProvider();
                    updateSettings({ provider: 'mock' });
                  }}
                  disabled={!live}
                >
                  Use simulation
                </button>
                <button
                  className="btn btn--primary"
                  onClick={async () => {
                    setChecking(true);
                    const ok = await useLiveProvider();
                    setChecking(false);
                    notify(
                      ok
                        ? 'Connected to the live model backend'
                        : 'No provider configured — staying on the simulation',
                      ok ? 'ok' : 'warn',
                    );
                  }}
                  disabled={checking}
                >
                  {checking ? 'Checking…' : live ? 'Re-check' : 'Connect'}
                </button>
              </div>
            </label>

            <label className="setting">
              <span className="setting__text">
                <span className="setting__label">Model</span>
                <span className="setting__hint">
                  {live && backendStatus?.activeModel ? (
                    <>
                      Server is using <strong>{backendStatus.activeModel}</strong>. Change it via{' '}
                      <code className="mono">OPENAI_MODEL</code> /{' '}
                      <code className="mono">ANTHROPIC_MODEL</code> /{' '}
                      <code className="mono">GEMINI_MODEL</code> in <code className="mono">.env</code>.
                    </>
                  ) : (
                    'Identifier passed through to the provider.'
                  )}
                </span>
              </span>
              <input
                className="input"
                value={live && backendStatus?.activeModel ? backendStatus.activeModel : settings.model}
                onChange={(e) => updateSettings({ model: e.target.value })}
                disabled={live}
              />
            </label>

            <label className="setting">
              <span className="setting__text">
                <span className="setting__label">Temperature</span>
                <span className="setting__hint">
                  Lower values produce more deterministic code. Currently{' '}
                  <strong>{settings.temperature.toFixed(2)}</strong>.
                </span>
              </span>
              <input
                type="range"
                className="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.temperature}
                onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
              />
            </label>

            <div className="setting">
              <span className="setting__text">
                <span className="setting__label">API key</span>
                <span className="setting__hint">
                  Deliberately not editable here. Keys live only in the server process, read from{' '}
                  <code className="mono">.env</code> by <code className="mono">server/providers.js</code>.
                  A key entered in a browser field would be visible to anyone using the app.
                </span>
              </span>
              <span className={`key-state ${backendStatus?.configured ? 'is-set' : ''}`}>
                {backendStatus?.configured ? 'Configured server-side' : 'Not configured'}
              </span>
            </div>
          </section>

          {/* ---- Agent behaviour ---- */}
          <section className="modal__section">
            <h3>Agent behaviour</h3>

            <Toggle
              label="Auto Repair"
              hint="When a run produces errors, analyse, patch, re-run and verify automatically. Failed repairs roll back."
              checked={settings.autoRepair}
              onChange={(v) => updateSettings({ autoRepair: v })}
            />

            <label className="setting">
              <span className="setting__text">
                <span className="setting__label">Max repair attempts</span>
                <span className="setting__hint">
                  How many distinct faults Auto Repair will try to fix per run.
                </span>
              </span>
              <select
                className="select select--sm"
                value={settings.maxRepairAttempts}
                onChange={(e) => updateSettings({ maxRepairAttempts: Number(e.target.value) })}
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <Toggle
              label="Run tests after generation"
              hint="Execute the project's test suite at the end of each agent run."
              checked={settings.runTestsAfterGeneration}
              onChange={(v) => updateSettings({ runTestsAfterGeneration: v })}
            />

            <Toggle
              label="Stream responses"
              hint="Render the agent's reply token by token as it arrives."
              checked={settings.streamResponses}
              onChange={(v) => updateSettings({ streamResponses: v })}
            />
          </section>

          {/* ---- Execution ---- */}
          <section className="modal__section">
            <h3>Code execution</h3>

            <label className="setting">
              <span className="setting__text">
                <span className="setting__label">Sandbox</span>
                <span className="setting__hint">
                  The browser iframe sandbox runs generated front-end code with{' '}
                  <code className="mono">allow-scripts</code> and no same-origin access. A remote
                  container is required to run server-side code or real test suites.
                </span>
              </span>
              <select
                className="select"
                value={settings.sandbox}
                onChange={(e) =>
                  updateSettings({ sandbox: e.target.value as typeof settings.sandbox })
                }
              >
                <option value="iframe">Browser iframe (active)</option>
                <option value="remote-container">Remote container (not configured)</option>
              </select>
            </label>
          </section>

          {/* ---- Architecture reference ---- */}
          <section className="modal__section">
            <h3>Architecture</h3>
            <p className="modal__note">
              Each subsystem is an isolated module with a stable interface, so it can be swapped for
              a production implementation without touching the UI.
            </p>
            <ul className="arch-list">
              {[
                ['AI Provider (abstraction)', 'services/ai/AIProvider.ts'],
                ['Live LLM client', 'services/ai/LLMProvider.ts'],
                ['Server API route', 'server/index.js'],
                ['Vendor adapters', 'server/providers.js'],
                ['Coding Agent', 'services/AgentOrchestrator.ts'],
                ['Structured actions', 'services/ai/actions.ts'],
                ['Project Context', 'services/ai/ProjectContext.ts'],
                ['Prompt builder', 'services/ai/prompts.ts'],
                ['File Operations', 'services/FileManager.ts'],
                ['Validation', 'services/ErrorDetector.ts'],
                ['Repair Loop', 'services/AutoRepair.ts'],
                ['Version History', 'services/VersionManager.ts'],
                ['Preview', 'components/PreviewPanel.tsx'],
                ['Provider config ▶', 'services/registry.ts'],
              ].map(([name, path]) => (
                <li key={path}>
                  <span className="arch-list__name">{name}</span>
                  <code className="mono">{path}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="modal__footer">
          <span className="modal__version mono">CodeForge AI · v0.1.0 · frontend preview</span>
          <button className="btn btn--primary" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
