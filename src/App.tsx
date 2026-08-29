import { useEffect } from 'react';
import { BottomPanel } from './components/BottomPanel';
import { ChatPanel } from './components/ChatPanel';
import { CodeEditor } from './components/CodeEditor';
import { ErrorBoundary } from './components/ErrorBoundary';
import { IconCode, IconEye, IconSparkle } from './components/Icons';
import { PreviewPanel } from './components/PreviewPanel';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { BuildAppMode } from './components/modes/BuildAppMode';
import { ChatMode } from './components/modes/ChatMode';
import { ImageMode } from './components/modes/ImageMode';
import { VideoMode } from './components/modes/VideoMode';
import { initProvider } from './services/registry';
import { useModeStore } from './state/modeStore';
import { useStore } from './state/store';
import './App.css';

const MOBILE_PANES: ReadonlyArray<'chat' | 'code' | 'preview'> = ['chat', 'code', 'preview'];

export default function App() {
  const init = useStore((s) => s.init);
  const mainTab = useStore((s) => s.mainTab);
  const mode = useModeStore((s) => s.mode);
  const chatOpen = useStore((s) => s.chatOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const mobilePane = useStore((s) => s.mobilePane);

  /*
   * The mobile layout hides panes by matching [data-mobile-pane] exactly, so
   * an unrecognised value must never reach the DOM. TypeScript constrains the
   * union at compile time, but this value can also arrive from rehydrated or
   * older persisted state at runtime, so it is validated here too. Falling
   * back to 'chat' guarantees a visible pane instead of a blank screen.
   */
  const safeMobilePane = MOBILE_PANES.includes(mobilePane) ? mobilePane : 'chat';

  const setChatOpen = useStore((s) => s.setChatOpen);
  const setMobilePane = useStore((s) => s.setMobilePane);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const saveProject = useStore((s) => s.saveProject);
  const runProject = useStore((s) => s.runProject);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  /* Bootstrap: seed state and wire the event bus to the store. */
  useEffect(() => {
    init();
    // Collapse the sidebar by default on small screens.
    if (window.innerWidth <= 1024) setSidebarOpen(false);

    /*
     * Detect whether a real model backend is available. Resolves to the
     * LLMProvider when the server reports a configured API key, otherwise
     * keeps the offline simulation. Never throws — the app stays usable
     * either way, and the UI badge updates reactively via useProvider().
     */
    void initProvider();
  }, [init, setSidebarOpen]);

  /* Global keyboard shortcuts. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 's') {
        e.preventDefault();
        saveProject();
      } else if (e.key === 'r') {
        e.preventDefault();
        void runProject();
      } else if (e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(!useStore.getState().sidebarOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveProject, runProject, setSettingsOpen, setSidebarOpen]);

  /* Multi-mode workspace: the coding agent keeps the full existing layout;
     the new modes (Chat/Image/Video/Build App) render in a focused view.
     Nothing below changes for the default 'agent' mode. */
  const agentLike = mode === 'agent' || mode === 'buildapp';

  return (
    <div
      className={`app ${sidebarOpen && agentLike ? 'has-sidebar' : ''} ${chatOpen && agentLike ? 'has-chat' : ''}`}
      data-mobile-pane={safeMobilePane}
    >
      <ErrorBoundary label="Top bar">
        <TopBar />
      </ErrorBoundary>
      {agentLike && (
        <ErrorBoundary label="Sidebar">
          <Sidebar />
        </ErrorBoundary>
      )}
      {!agentLike && (
        <main className="mode-host">
          <ErrorBoundary label={mode === 'chat' ? 'Chat mode' : mode === 'image' ? 'Image mode' : 'Video mode'}>
            {mode === 'chat' && <ChatMode />}
            {mode === 'image' && <ImageMode />}
            {mode === 'video' && <VideoMode />}
          </ErrorBoundary>
        </main>
      )}
      {mode === 'buildapp' && (
        <main className="mode-host">
          <ErrorBoundary label="Build App mode">
            <BuildAppMode />
          </ErrorBoundary>
        </main>
      )}
      {agentLike && (
      <ErrorBoundary label="Chat panel">
        <ChatPanel />
      </ErrorBoundary>
      )}

      {/* Floating re-open button when the chat is collapsed (desktop only). */}
      {agentLike && !chatOpen && (
        <button
          className="chat-reopen"
          onClick={() => setChatOpen(true)}
          title="Show chat panel"
          aria-label="Show chat panel"
        >
          <IconSparkle size={15} />
        </button>
      )}

      <main className={`workspace workspace--${mainTab}`} style={agentLike ? undefined : { display: 'none' }}>
        <div className="workspace__panes">
          {mainTab !== 'preview' && (
            <ErrorBoundary label="Code editor">
              <CodeEditor />
            </ErrorBoundary>
          )}
          {mainTab === 'split' && <div className="workspace__divider" aria-hidden="true" />}
          {mainTab !== 'code' && (
            <ErrorBoundary label="Preview">
              <PreviewPanel />
            </ErrorBoundary>
          )}
        </div>
        <ErrorBoundary label="Bottom panel">
          <BottomPanel />
        </ErrorBoundary>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav" aria-label="Panel switcher">
        {(
          [
            { id: 'chat', label: 'Agent', Icon: IconSparkle },
            { id: 'code', label: 'Code', Icon: IconCode },
            { id: 'preview', label: 'Preview', Icon: IconEye },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`mobile-nav__item ${mobilePane === id ? 'is-active' : ''}`}
            onClick={() => {
              setMobilePane(id);
              if (id === 'chat') setChatOpen(true);
            }}
            aria-current={mobilePane === id}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <SettingsModal />
      <Toast />
    </div>
  );
}
