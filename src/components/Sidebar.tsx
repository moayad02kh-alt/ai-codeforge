import { useMemo, useState } from 'react';
import { FileManager, type TreeNode } from '../services/FileManager';
import { selectActiveProject, useStore } from '../state/store';
import { formatRelativeTime } from '../core/utils';
import { useProvider } from '../hooks/useProvider';
import {
  FileGlyph,
  IconChevron,
  IconFolder,
  IconPlay,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from './Icons';
import './Sidebar.css';

export function Sidebar() {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const project = useStore(selectActiveProject);

  const selectProject = useStore((s) => s.selectProject);
  const createProject = useStore((s) => s.createProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const openFile = useStore((s) => s.openFile);
  const createFile = useStore((s) => s.createFile);
  const deleteFile = useStore((s) => s.deleteFile);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const runProject = useStore((s) => s.runProject);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const isAgentBusy = useStore((s) => s.isAgentBusy);
  const { isLive: providerLive, label: providerLabel, status: backendStatus } = useProvider();

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [projectsOpen, setProjectsOpen] = useState(true);

  const files = project?.files ?? [];

  /** Newest first for the "Recent projects" list — display order only. */
  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );

  /** Configured providers other than the active one — shown as fallbacks. */
  const fallbacks = useMemo(
    () =>
      (backendStatus?.providers ?? []).filter(
        (pr) => pr.configured && pr.id !== backendStatus?.activeProvider,
      ),
    [backendStatus],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return files;
    const q = query.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  const tree = useMemo(() => FileManager.buildTree(filtered), [filtered]);

  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleNewFile = () => {
    const path = window.prompt('New file path (e.g. src/utils.js)');
    if (path?.trim()) createFile(path.trim());
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const indent = { paddingLeft: `${10 + depth * 13}px` };

    if (node.type === 'folder') {
      const isCollapsed = collapsed.has(node.path) && !query.trim();
      return (
        <li key={node.path}>
          <button
            className="tree__row tree__row--folder"
            style={indent}
            onClick={() => toggleFolder(node.path)}
            aria-expanded={!isCollapsed}
          >
            <IconChevron
              size={12}
              className={`tree__caret ${isCollapsed ? '' : 'is-open'}`}
            />
            <IconFolder size={13} className="tree__folder-icon" />
            <span className="truncate">{node.name}</span>
          </button>
          {!isCollapsed && node.children && (
            <ul className="tree__children">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </ul>
          )}
        </li>
      );
    }

    const isActive = node.path === activeFilePath;
    return (
      <li key={node.path}>
        <div className={`tree__row tree__row--file ${isActive ? 'is-active' : ''}`} style={indent}>
          <button className="tree__file-btn" onClick={() => openFile(node.path)} title={node.path}>
            <FileGlyph language={node.file?.language ?? 'text'} />
            <span className="truncate">{node.name}</span>
          </button>
          <button
            className="tree__delete"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete ${node.path}?`)) deleteFile(node.path);
            }}
            aria-label={`Delete ${node.name}`}
            title="Delete file"
          >
            <IconX size={11} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <>
      {sidebarOpen && (
        <div className="sidebar__scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Projects and files">
        {/* ---- Projects ---- */}
        <section className="sidebar__section">
          <header className="sidebar__header">
            <button
              className="sidebar__collapse"
              onClick={() => setProjectsOpen(!projectsOpen)}
              aria-expanded={projectsOpen}
            >
              <IconChevron size={11} className={`tree__caret ${projectsOpen ? 'is-open' : ''}`} />
              <span>Recent projects</span>
              <span className="sidebar__count">{projects.length}</span>
            </button>
            <button
              className="sidebar__action"
              onClick={() => createProject()}
              aria-label="New project"
              title="New project"
            >
              <IconPlus size={13} />
            </button>
          </header>

          {projectsOpen && (
            <ul className="project-list">
              {recentProjects.map((p) => (
                <li key={p.id}>
                  <div className={`project ${p.id === activeProjectId ? 'is-active' : ''}`}>
                    <button className="project__main" onClick={() => selectProject(p.id)}>
                      <span className="project__icon" aria-hidden="true">
                        {p.icon}
                      </span>
                      <span className="project__text">
                        <span className="project__name truncate">{p.name}</span>
                        <span className="project__meta">
                          {p.files.length} file{p.files.length === 1 ? '' : 's'} ·{' '}
                          {formatRelativeTime(p.updatedAt)}
                        </span>
                      </span>
                      <span
                        className={`project__status project__status--${p.status}`}
                        title={p.status}
                        aria-hidden="true"
                      />
                    </button>
                    {p.id === activeProjectId && !isAgentBusy && (
                      <button
                        className="project__run"
                        onClick={() => runProject()}
                        aria-label={`Run ${p.name}`}
                        title="Build and run this project (⌘R)"
                      >
                        <IconPlay size={12} />
                      </button>
                    )}
                    <button
                      className="project__delete"
                      onClick={() => {
                        if (window.confirm(`Delete project "${p.name}"?`)) deleteProject(p.id);
                      }}
                      aria-label={`Delete ${p.name}`}
                      title="Delete project"
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="sidebar__rule" />

        {/* ---- Files ---- */}
        <section className="sidebar__section sidebar__section--grow">
          <header className="sidebar__header">
            <span className="sidebar__title">
              Files
              <span className="sidebar__count">{files.length}</span>
            </span>
            <button
              className="sidebar__action"
              onClick={handleNewFile}
              aria-label="New file"
              title="New file"
            >
              <IconPlus size={13} />
            </button>
          </header>

          <div className="sidebar__search">
            <IconSearch size={12} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              aria-label="Search files"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <IconX size={11} />
              </button>
            )}
          </div>

          <nav className="tree">
            {tree.length === 0 ? (
              <p className="sidebar__empty">
                {files.length === 0
                  ? 'No files yet. Describe your project in the chat panel and the agent will scaffold it.'
                  : 'No files match your search.'}
              </p>
            ) : (
              <ul>{tree.map((node) => renderNode(node, 0))}</ul>
            )}
          </nav>
        </section>

        {/* ---- AI provider status (real backend state, click to configure) ---- */}
        <section className="sidebar__section">
          <button
            className={`provider-card ${providerLive ? 'provider-card--live' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="Open provider settings"
          >
            <span
              className={`provider-card__dot ${providerLive ? 'is-live' : ''}`}
              aria-hidden="true"
            />
            <span className="provider-card__text">
              <span className="provider-card__label">
                {providerLive ? 'AI provider · active' : 'Simulated mode'}
              </span>
              <span className="provider-card__value">
                {providerLive
                  ? providerLabel
                  : 'Connect a provider in Settings'}
              </span>
              {providerLive && fallbacks.length > 0 && (
                <span className="provider-card__fallback">
                  Fallback ready: {fallbacks.map((f) => f.label).join(', ')}
                </span>
              )}
            </span>
            <IconChevron size={12} className="provider-card__chev" />
          </button>
        </section>

        {/* ---- Footer stats (real workspace data) ---- */}
        <footer className="sidebar__footer">
          <div className="stat">
            <span className="stat__value">{FileManager.totalLines(files).toLocaleString()}</span>
            <span className="stat__label">lines</span>
          </div>
          <div className="stat">
            <span className="stat__value">{(FileManager.totalBytes(files) / 1024).toFixed(1)}</span>
            <span className="stat__label">KB</span>
          </div>
          <div className="stat">
            <span className="stat__value">{files.length}</span>
            <span className="stat__label">files</span>
          </div>
        </footer>
      </aside>
    </>
  );
}
