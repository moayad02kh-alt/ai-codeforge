import { useEffect, useRef, useState } from 'react';
import { selectActiveProject, useStore } from '../state/store';
import { useProvider } from '../hooks/useProvider';
import {
  IconBolt,
  IconEye,
  IconMenu,
  IconPlay,
  IconSave,
  IconSettings,
  IconSparkle,
  IconStop,
} from './Icons';
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

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = () => {
    if (project && draft.trim()) renameProject(project.id, draft.trim());
    setEditing(false);
  };

  const { isLive: live, label: providerLabel, status: backendStatus } = useProvider();

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
            <IconSparkle size={15} />
          </span>
          <span className="brand__name">
            CodeForge<span className="brand__ai"> AI</span>
          </span>
        </div>

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

        {isBusy ? (
          <button className="btn btn--danger" onClick={cancelRun}>
            <IconStop size={13} />
            <span className="btn__label">Stop</span>
          </button>
        ) : (
          <button className="btn btn--ghost" onClick={runProject} title="Build and run (⌘R)">
            <IconPlay size={13} />
            <span className="btn__label">Run</span>
          </button>
        )}

        <button
          className="btn btn--ghost"
          onClick={() => setMainTab('preview')}
          title="Open the live preview"
        >
          <IconEye size={14} />
          <span className="btn__label">Preview</span>
        </button>

        <button className="btn btn--ghost" onClick={saveProject} title="Save checkpoint (⌘S)">
          <IconSave size={14} />
          <span className="btn__label">Save</span>
        </button>

        <button
          className="topbar__icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
        >
          <IconSettings size={16} />
        </button>
      </div>
    </header>
  );
}
