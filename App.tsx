import { useEffect } from 'react';
import { BottomPanel } from './components/BottomPanel';
import { ChatPanel } from './components/ChatPanel';
import { CodeEditor } from './components/CodeEditor';
import { IconCode, IconEye, IconSparkle } from './components/Icons';
import { PreviewPanel } from './components/PreviewPanel';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { initProvider } from './services/registry';
import { useStore } from './state/store';
import './App.css';

export default function App() {
  const init = useStore((s) => s.init);
  const mainTab = useStore((s) => s.mainTab);
  const chatOpen = useStore((s) => s.chatOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const mobilePane = useStore((s) => s.mobilePane);

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

  return (
    <div
      className={`app ${sidebarOpen ? 'has-sidebar' : ''} ${chatOpen ? 'has-chat' : ''}`}
      data-mobile-pane={mobilePane}
    >
      <TopBar />
      <Sidebar />
      <ChatPanel />

      {/* Floating re-open button when the chat is collapsed (desktop only). */}
      {!chatOpen && (
        <button
          className="chat-reopen"
          onClick={() => setChatOpen(true)}
          title="Show chat panel"
          aria-label="Show chat panel"
        >
          <IconSparkle size={15} />
        </button>
      )}

      <main className={`workspace workspace--${mainTab}`}>
        <div className="workspace__panes">
          {mainTab !== 'preview' && <CodeEditor />}
          {mainTab === 'split' && <div className="workspace__divider" aria-hidden="true" />}
          {mainTab !== 'code' && <PreviewPanel />}
        </div>
        <BottomPanel />
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
