import { useState } from 'react';
import { useModeStore } from '../../state/modeStore';
import { useStore } from '../../state/store';
import { buildBuildAppPrompt } from '../../services/BuildAppPrompt';
import { IconBolt } from '../Icons';
import './Modes.css';

const APP_TYPES = ['Landing page', 'Dashboard', 'Todo app', 'Portfolio', 'Blog', 'Store front', 'Quiz game', 'Web app'];
const STYLES = ['Clean & modern', 'Playful & colorful', 'Dark & sleek', 'Corporate', 'Minimal', 'Retro'];
const FEATURE_IDEAS = [
  'Add/edit/delete items', 'LocalStorage persistence (safeStorage)', 'Search & filtering',
  'Dark mode toggle', 'Charts/stats summary', 'Form with validation', 'Responsive navigation',
  'Animated hero section', 'Image gallery', 'Countdown timer',
];

/**
 * Build App mode — a structured wizard that composes ONE prompt and hands it
 * to the EXISTING coding agent. No separate execution path: everything flows
 * through sendPrompt() → AgentOrchestrator → normalise → validate → execute,
 * so validation, version history, rollback, preview and auto-repair all
 * apply exactly as in the Website Builder.
 */
export function BuildAppMode() {
  const draft = useModeStore((s) => s.buildAppDraft);
  const setBuildAppDraft = useModeStore((s) => s.setBuildAppDraft);
  const setMode = useModeStore((s) => s.setMode);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const isAgentBusy = useStore((s) => s.isAgentBusy);
  const notify = useStore((s) => s.notify);
  const [submitting, setSubmitting] = useState(false);

  const toggleFeature = (f: string) => {
    const list = draft.features.split('\n').map((s) => s.trim()).filter(Boolean);
    const next = list.includes(f) ? list.filter((x) => x !== f) : [...list, f];
    setBuildAppDraft({ features: next.join('\n') });
  };
  const selectedFeatures = draft.features.split('\n').map((s) => s.trim()).filter(Boolean);

  const launch = async () => {
    const prompt = buildBuildAppPrompt({
      name: draft.name,
      appType: draft.appType,
      style: draft.style,
      features: selectedFeatures,
      pages: draft.pages.split(',').map((s) => s.trim()).filter(Boolean),
      notes: draft.notes,
    });
    setSubmitting(true);
    setMode('agent');
    await sendPrompt(prompt);
    notify('Build App request handed to the agent', 'ok');
    setSubmitting(false);
  };

  return (
    <div className="mode-panel">
      <header className="mode-panel__header">
        <div>
          <h2 className="mode-panel__title">Build App</h2>
          <p className="mode-panel__subtitle">
            Describe your app once — the CodeForge agent plans, builds, previews and auto-repairs it
          </p>
        </div>
      </header>

      <div className="mode-form">
        <label className="mode-field">
          <span>App name</span>
          <input
            className="mode-composer__input"
            placeholder="e.g. Task Tamer"
            value={draft.name}
            onChange={(e) => setBuildAppDraft({ name: e.target.value })}
          />
        </label>

        <div className="mode-field">
          <span>Type</span>
          <div className="mode-segment mode-segment--wrap">
            {APP_TYPES.map((t) => (
              <button
                key={t}
                className={`mode-segment__btn ${draft.appType === t ? 'is-active' : ''}`}
                onClick={() => setBuildAppDraft({ appType: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mode-field">
          <span>Style</span>
          <div className="mode-segment mode-segment--wrap">
            {STYLES.map((s) => (
              <button
                key={s}
                className={`mode-segment__btn ${draft.style === s ? 'is-active' : ''}`}
                onClick={() => setBuildAppDraft({ style: s })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="mode-field">
          <span>Features (click to toggle)</span>
          <div className="mode-segment mode-segment--wrap">
            {FEATURE_IDEAS.map((f) => (
              <button
                key={f}
                className={`mode-chip ${selectedFeatures.includes(f) ? 'is-active' : ''}`}
                onClick={() => toggleFeature(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mode-field-row">
          <label className="mode-field">
            <span>Pages / screens (comma-separated)</span>
            <input
              className="mode-composer__input"
              placeholder="Home, About, Pricing"
              value={draft.pages}
              onChange={(e) => setBuildAppDraft({ pages: e.target.value })}
            />
          </label>
        </div>

        <label className="mode-field">
          <span>Anything else? (optional)</span>
          <textarea
            className="mode-composer__input"
            rows={3}
            placeholder="Specific colors, content, interactions…"
            value={draft.notes}
            onChange={(e) => setBuildAppDraft({ notes: e.target.value })}
          />
        </label>

        <button
          className="mode-btn mode-btn--primary mode-btn--lg"
          onClick={() => void launch()}
          disabled={submitting || isAgentBusy || !draft.name.trim()}
        >
          <IconBolt size={15} />
          {submitting || isAgentBusy ? 'Agent is working…' : 'Build it with the Agent'}
        </button>
        <p className="mode-empty__hint">
          You'll land in the Agent workspace with live preview, file tree, version history and
          auto-repair — refine it afterwards with plain-language edits.
        </p>
      </div>
    </div>
  );
}
