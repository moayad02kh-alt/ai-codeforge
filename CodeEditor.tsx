import { useEffect, useMemo, useRef, useState } from 'react';
import { fileName } from '../core/utils';
import { highlightLine } from '../lib/highlight';
import { selectActiveFile, selectActiveProject, useStore } from '../state/store';
import { FileGlyph, IconCode, IconCopy, IconX } from './Icons';
import './CodeEditor.css';

export function CodeEditor() {
  const project = useStore(selectActiveProject);
  const file = useStore(selectActiveFile);
  const openFilePaths = useStore((s) => s.openFilePaths);
  const activeFilePath = useStore((s) => s.activeFilePath);
  const diagnostics = useStore((s) => s.diagnostics);

  const openFile = useStore((s) => s.openFile);
  const closeFile = useStore((s) => s.closeFile);
  const updateFileContent = useStore((s) => s.updateFileContent);
  const notify = useStore((s) => s.notify);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const guttersRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const content = file?.content ?? '';
  const lines = useMemo(() => content.split('\n'), [content]);

  /* Diagnostics for the open file, indexed by line for the gutter markers. */
  const lineIssues = useMemo(() => {
    const map = new Map<number, 'error' | 'warning' | 'info'>();
    if (!file) return map;
    for (const d of diagnostics) {
      if (d.file !== file.path) continue;
      const current = map.get(d.line);
      // Errors outrank warnings outrank info.
      if (!current || (current !== 'error' && d.severity === 'error')) map.set(d.line, d.severity);
    }
    return map;
  }, [diagnostics, file]);

  /* Keep the highlight layer and gutter in lockstep with the textarea. */
  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
    if (guttersRef.current) guttersRef.current.scrollTop = ta.scrollTop;
  };

  useEffect(() => {
    syncScroll();
  }, [activeFilePath]);

  const updateCursor = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const upto = ta.value.slice(0, ta.selectionStart);
    const split = upto.split('\n');
    setCursor({ line: split.length, col: (split.at(-1)?.length ?? 0) + 1 });
  };

  /* Tab inserts two spaces rather than moving focus. */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = ta;
    const next = `${content.slice(0, start)}  ${content.slice(end)}`;
    if (file) updateFileContent(file.path, next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2;
    });
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(content);
      notify('File copied to clipboard');
    } catch {
      notify('Clipboard unavailable', 'warn');
    }
  };

  return (
    <section className="editor" aria-label="Code editor">
      {/* ---- Tabs ---- */}
      <div className="editor__tabs" role="tablist">
        <div className="editor__tabs-scroll">
          {openFilePaths.length === 0 ? (
            <span className="editor__no-tabs">No file open</span>
          ) : (
            openFilePaths.map((path) => {
              const f = project?.files.find((x) => x.path === path);
              const isActive = path === activeFilePath;
              const hasError = diagnostics.some((d) => d.file === path && d.severity === 'error');
              return (
                <div
                  key={path}
                  className={`etab ${isActive ? 'is-active' : ''} ${hasError ? 'has-error' : ''}`}
                  role="tab"
                  aria-selected={isActive}
                >
                  <button className="etab__main" onClick={() => openFile(path)} title={path}>
                    <FileGlyph language={f?.language ?? 'text'} />
                    <span className="truncate">{fileName(path)}</span>
                  </button>
                  <button
                    className="etab__close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(path);
                    }}
                    aria-label={`Close ${fileName(path)}`}
                  >
                    <IconX size={10} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {file && (
          <button className="editor__tab-action" onClick={copyAll} title="Copy file contents">
            <IconCopy size={13} />
          </button>
        )}
      </div>

      {/* ---- Surface ---- */}
      {!file ? (
        <div className="editor__empty">
          <IconCode size={30} />
          <p>Select a file from the explorer to start editing.</p>
          <span>
            Or ask the agent to build something — generated files open here automatically.
          </span>
        </div>
      ) : (
        <div className="editor__surface">
          <div className="editor__gutter" ref={guttersRef} aria-hidden="true">
            {lines.map((_, i) => {
              const n = i + 1;
              const issue = lineIssues.get(n);
              return (
                <div
                  key={n}
                  className={`gutter__line ${cursor.line === n ? 'is-current' : ''} ${
                    issue ? `has-${issue}` : ''
                  }`}
                >
                  {issue && <span className={`gutter__mark gutter__mark--${issue}`} />}
                  <span className="gutter__num mono">{n}</span>
                </div>
              );
            })}
          </div>

          <div className="editor__code">
            {/* Highlight layer sits underneath a transparent textarea. */}
            <div className="editor__highlight mono" ref={highlightRef} aria-hidden="true">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={`code__line ${cursor.line === i + 1 ? 'is-current' : ''}`}
                >
                  {line ? highlightLine(line, file.language, `${file.id}-${i}`) : '\u00A0'}
                </div>
              ))}
            </div>

            <textarea
              ref={textareaRef}
              className="editor__input mono"
              value={content}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              wrap="off"
              onChange={(e) => {
                updateFileContent(file.path, e.target.value);
                updateCursor();
              }}
              onScroll={syncScroll}
              onKeyDown={handleKeyDown}
              onKeyUp={updateCursor}
              onClick={updateCursor}
              onSelect={updateCursor}
              aria-label={`Edit ${file.path}`}
            />
          </div>
        </div>
      )}

      {/* ---- Status strip ---- */}
      {file && (
        <div className="editor__status">
          <span className="mono truncate">{file.path}</span>
          <div className="editor__status-right">
            <span>{file.language.toUpperCase()}</span>
            <span className="mono">
              Ln {cursor.line}, Col {cursor.col}
            </span>
            <span>{lines.length} lines</span>
            <span className={file.generatedBy === 'agent' ? 'is-agent' : ''}>
              {file.generatedBy === 'agent' ? 'AI-generated' : 'User-created'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
