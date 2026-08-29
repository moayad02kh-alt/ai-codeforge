import { useModeStore, type WorkspaceMode } from '../state/modeStore';
import { IconBolt, IconCode, IconFilm, IconImage, IconSparkle } from './Icons';
import './ModeSwitcher.css';

const MODES: ReadonlyArray<{ id: WorkspaceMode; label: string; icon: typeof IconCode }> = [
  { id: 'agent', label: 'Agent', icon: IconCode },
  { id: 'buildapp', label: 'Build App', icon: IconBolt },
  { id: 'chat', label: 'Chat AI', icon: IconSparkle },
  { id: 'image', label: 'Image', icon: IconImage },
  { id: 'video', label: 'Video', icon: IconFilm },
];

/** Top-level mode switcher for the unified AI Workspace. */
export function ModeSwitcher() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const isAgentBusy = useStoreAgentBusy();

  return (
    <nav className="mode-switcher" aria-label="Workspace mode">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`mode-switcher__btn ${mode === id ? 'is-active' : ''}`}
          onClick={() => setMode(id)}
          title={`Switch to ${label} mode`}
          aria-current={mode === id ? 'page' : undefined}
        >
          <Icon size={13} />
          <span className="mode-switcher__label">{label}</span>
          {id === 'agent' && isAgentBusy && <span className="mode-switcher__busy" aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}

/* Small helper so the switcher can show the agent's busy dot without
   re-rendering on every agent state change. */
import { useStore } from '../state/store';
function useStoreAgentBusy(): boolean {
  return useStore((s) => s.isAgentBusy);
}
