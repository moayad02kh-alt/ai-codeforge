import { useEffect, useRef, useState } from 'react';
import type { Viewport } from '../core/types';
import { selectActiveProject, useStore } from '../state/store';
import {
  IconDesktop,
  IconExternal,
  IconMobile,
  IconRefresh,
  IconTablet,
} from './Icons';
import './PreviewPanel.css';

const VIEWPORTS: Array<{ id: Viewport; label: string; width: number; Icon: typeof IconDesktop }> = [
  { id: 'desktop', label: 'Desktop', width: 0, Icon: IconDesktop },
  { id: 'tablet', label: 'Tablet · 834px', width: 834, Icon: IconTablet },
  { id: 'mobile', label: 'Mobile · 390px', width: 390, Icon: IconMobile },
];

export function PreviewPanel() {
  const previewHtml = useStore((s) => s.previewHtml);
  const previewKey = useStore((s) => s.previewKey);
  const viewport = useStore((s) => s.viewport);
  const project = useStore(selectActiveProject);
  const isBusy = useStore((s) => s.isAgentBusy);

  const setViewport = useStore((s) => s.setViewport);
  const refreshPreview = useStore((s) => s.refreshPreview);
  const notify = useStore((s) => s.notify);

  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(timer);
  }, [previewKey, previewHtml]);

  const active = VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[0];

  const openInNewTab = () => {
    try {
      const blob = new Blob([previewHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      notify('Could not open a new tab', 'warn');
    }
  };

  return (
    <section className="preview" aria-label="Live preview">
      <header className="preview__bar">
        <div className="preview__viewports" role="group" aria-label="Preview viewport">
          {VIEWPORTS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`preview__vp ${viewport === id ? 'is-active' : ''}`}
              onClick={() => setViewport(id)}
              title={label}
              aria-label={label}
              aria-pressed={viewport === id}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <div className="preview__url" title={`${project?.entryPath ?? 'index.html'} — sandboxed`}>
          <span className="preview__lock" aria-hidden="true" />
          <span className="mono truncate">
            localhost:3000/{project?.entryPath === 'index.html' ? '' : (project?.entryPath ?? '')}
          </span>
          <span className="preview__sandbox-tag">sandboxed</span>
        </div>

        <div className="preview__actions">
          <button onClick={refreshPreview} title="Reload preview" aria-label="Reload preview">
            <IconRefresh size={13} className={loading ? 'is-spinning' : ''} />
          </button>
          <button onClick={openInNewTab} title="Open in new tab" aria-label="Open in new tab">
            <IconExternal size={13} />
          </button>
        </div>
      </header>

      <div className={`preview__stage preview__stage--${viewport}`}>
        {(loading || isBusy) && (
          <div className="preview__loading" aria-hidden="true">
            <span className="preview__loading-bar" />
          </div>
        )}

        <div
          className="preview__frame-wrap"
          style={active.width ? { width: active.width, maxWidth: '100%' } : undefined}
        >
          <iframe
            key={previewKey}
            ref={iframeRef}
            className="preview__frame"
            title="Project preview"
            srcDoc={previewHtml}
            /*
             * Security: `allow-scripts` WITHOUT `allow-same-origin`.
             * Generated code runs in an opaque origin, so it cannot read the
             * parent document, cookies, or localStorage. Console output is
             * relayed back through postMessage only.
             */
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            loading="eager"
          />
        </div>
      </div>
    </section>
  );
}
