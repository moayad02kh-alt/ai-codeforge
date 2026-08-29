import { useEffect, useRef, useState } from 'react';
import { selectActiveProject, useStore } from '../state/store';
import { useProvider } from '../hooks/useProvider';
import {
  IconBolt,
  IconChevron,
  IconEye,
  IconFilm,
  IconImage,
  IconMenu,
  IconPlay,
  IconSave,
  IconSettings,
  IconSparkle,
  IconStop,
} from './Icons';
import { ModeSwitcher } from './ModeSwitcher';
import { useModeStore } from '../state/modeStore';
import './TopBar.css';

export function TopBar() {
  const project = useStore(selectActiveProject);
  const isBusy = useStore((s) => s.isAgentBusy);
  const unsaved = useStore((s) => s.unsaved);
  const mainTab = useStore((s) => s.mainTab);
  const sidebarOpen = useStore((s) => s.sidebarOpen);

  const renameProject = useStore((s) => s.renameProject);
  const runProject = useStore((s) => s.runProject);
  const saveProject = useStore((s) => s.saveProject);
  const setMainTab = useStore((s) => s.setMainTab);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const cancelRun = useStore((s) => s.cancelRun);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project?.name ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  /* Overflow menu — presentational state only; every action keeps its handler. */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const commitRename = () => {
    if (project && draft.trim()) renameProject(project.id, draft.trim());
    setEditing(false);
  };

  const { isLive: live, label: providerLabel } = useProvider();
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          className="topbar__icon-btn topbar__hamburger"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          <IconMenu size={17} />
        </button>

        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <IconSparkle size={14} />
          </span>
          <span className="brand__name">
            CodeForge<span className="brand__ai"> AI</span>
          </span>
        </div>

        <ModeSwitcher />

        <span className="topbar__divider" aria-hidden="true" />

        {editing ? (
          <input
            ref={inputRef}
            className="topbar__rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label="Project name"
          />
        ) : (
          <button
            className="topbar__project"
            onClick={() => {
              setDraft(project?.name ?? '');
              setEditing(true);
            }}
            title="Click to rename"
          >
            <span className="truncate">{project?.name ?? 'No project'}</span>
            {unsaved && <span className="topbar__dot" title="Unsaved changes" />}
          </button>
        )}

        <span
          className={`badge ${live ? 'badge--live' : 'badge--sim'}`}
          title={
            live
              ? `Connected to a live model: ${providerLabel}. Requests are proxied through the server-side API route; no key is present in the browser.`
              : 'No AI backend connected. Output comes from an offline simulation, not a real model. Start the server and set an API key in .env to go live.'
          }
        >
          <IconBolt size={10} />
          {live ? 'Live' : 'Simulated'}
        </span>
      </div>

      <div className="topbar__right">
        {/* Agent-only view switcher. Non-agent modes have no workspace views,
            and on phones it folds into the ⋯ menu below (CSS hides this bar
            ≤640px) — it was wide enough to push Chat AI off-screen. */}
        {mode === 'agent' && (
        <div className="segmented" role="tablist" aria-label="Workspace view">
          {(['code', 'split', 'preview'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={mainTab === tab}
              className={`segmented__item ${mainTab === tab ? 'is-active' : ''}`}
              onClick={() => setMainTab(tab)}
            >
              {tab === 'code' ? 'Code' : tab === 'split' ? 'Split' : 'Preview'}
            </button>
          ))}
        </div>
        )}

        {isBusy ? (
          <button className="btn btn--danger" onClick={cancelRun}>
            <IconStop size={13} />
            <span className="btn__label">Stop</span>
          </button>
        ) : (
          <button className="btn btn--primary" onClick={runProject} title="Build and run (⌘R)">
            <IconPlay size={13} />
            <span className="btn__label">Run</span>
          </button>
        )}

        <div className="topbar__menu" ref={menuRef}>
          <button
            className="topbar__icon-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            title="More actions"
          >
            <IconChevron size={15} className={menuOpen ? 'is-open' : ''} />
          </button>

          {menuOpen && (
            <div className="topbar__menu-list" role="menu">
              <button
                className="topbar__menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setMainTab('preview');
                }}
              >
                {mode === 'agent' && (
                  <>
                    {(['code', 'split'] as const).map((tab) => (
                      <button
                        key={tab}
                        className={`topbar__menu-item ${mainTab === tab ? 'is-active' : ''}`}
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setMainTab(tab);
                        }}
                      >
                        <IconEye size={14} />
                        <span>{tab === 'code' ? 'Code view' : 'Split view'}</span>
                      </button>
                    ))}
                  </>
                )}
                <IconEye size={14} />
                <span>Open preview</span>
              </button>
              {/* On phones the Image/Video switcher buttons are folded into
                  this menu so every mode stays reachable without overflowing
                  the top bar (Agent · Build App · Chat AI stay inline). */}
              <button
                className={`topbar__menu-item ${mode === 'image' ? 'is-active' : ''}`}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setMode('image');
                }}
              >
                <IconImage size={14} />
                <span>Image mode</span>
              </button>
              <button
                className={`topbar__menu-item ${mode === 'video' ? 'is-active' : ''}`}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setMode('video');
                }}
              >
                <IconFilm size={14} />
                <span>Video mode</span>
              </button>
              <button
                className="topbar__menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  saveProject();
                }}
              >
                <IconSave size={14} />
                <span>Save checkpoint</span>
                <kbd className="topbar__menu-kbd mono">⌘S</kbd>
              </button>
              <div className="topbar__menu-sep" aria-hidden="true" />
              <button
                className="topbar__menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <IconSettings size={14} />
                <span>Settings</span>
                <kbd className="topbar__menu-kbd mono">⌘,</kbd>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
