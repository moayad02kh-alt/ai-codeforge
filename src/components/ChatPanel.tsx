import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTime } from '../core/utils';
import { useProvider } from '../hooks/useProvider';
import { EXAMPLE_PROMPTS } from '../state/seed';
import { selectActiveProject, selectMessages, useStore } from '../state/store';
import { AgentTimeline } from './AgentTimeline';
import { Dots, IconChevron, IconSend, IconShield, IconSparkle, IconStop, IconX } from './Icons';
import { Markdown } from './Markdown';
import './ChatPanel.css';

export function ChatPanel() {
  const messages = useStore(selectMessages);
  const project = useStore(selectActiveProject);
  const activeRun = useStore((s) => s.activeRun);
  const isBusy = useStore((s) => s.isAgentBusy);
  const chatOpen = useStore((s) => s.chatOpen);

  const sendPrompt = useStore((s) => s.sendPrompt);
  const cancelRun = useStore((s) => s.cancelRun);
  const setChatOpen = useStore((s) => s.setChatOpen);

  const [draft, setDraft] = useState('');
  const [dismissedNotice, setDismissedNotice] = useState(false);
  /* Run details stay collapsed — the conversation is the focus. Presentational only. */
  const [timelineOpen, setTimelineOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pinnedToBottom = useRef(true);

  /* Keep the transcript pinned to the bottom unless the user scrolled up. */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeRun]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  /* Auto-grow the composer. */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  const submit = () => {
    const value = draft.trim();
    if (!value || isBusy) return;
    pinnedToBottom.current = true;
    setDraft('');
    void sendPrompt(value);
  };

  const { isLive: live, label: providerLabel } = useProvider();
  const isEmpty = messages.length === 0;

  const doneSteps = activeRun?.steps.filter((s) => s.status === 'success').length ?? 0;

  return (
    <section className={`chat ${chatOpen ? '' : 'is-collapsed'}`} aria-label="AI chat">
      <header className="chat__header">
        <div className="chat__header-left">
          <span className="chat__avatar" aria-hidden="true">
            <IconSparkle size={12} />
            {isBusy && <span className="chat__avatar-ring" />}
          </span>
          <div className="chat__heading">
            <span className="chat__title">Agent</span>
            <span className="chat__subtitle">
              {isBusy ? (
                <>
                  Working <Dots />
                </>
              ) : (
                `${project?.files.length ?? 0} files in context`
              )}
            </span>
          </div>
        </div>
        {!live && (
          <span className="chat__mode-pill" title="No model connected — output is simulated">
            sim
          </span>
        )}
        <button
          className="chat__close"
          onClick={() => setChatOpen(false)}
          aria-label="Hide chat panel"
          title="Hide chat panel"
        >
          <IconX size={14} />
        </button>
      </header>

      {!live && !dismissedNotice && (
        <div className="chat__notice" role="note">
          <IconShield size={12} />
          <p>
            <strong>Simulated agent.</strong> Blueprint engine, no model. Connect one via{' '}
            <code className="mono">.env</code>.
          </p>
          <button onClick={() => setDismissedNotice(true)} aria-label="Dismiss">
            <IconX size={11} />
          </button>
        </div>
      )}

      {live && !dismissedNotice && (
        <div className="chat__notice chat__notice--live" role="note">
          <IconShield size={12} />
          <p>
            <strong>{providerLabel}</strong> proxied server-side — no key in the browser.
          </p>
          <button onClick={() => setDismissedNotice(true)} aria-label="Dismiss">
            <IconX size={11} />
          </button>
        </div>
      )}

      <div className="chat__scroll" ref={scrollRef} onScroll={handleScroll}>
        {isEmpty && !activeRun ? (
          <div className="chat__empty">
            <span className="chat__empty-mark" aria-hidden="true">
              <IconSparkle size={20} />
            </span>
            <h2>What are we building?</h2>
            <p>
              Describe a project in plain language. The agent plans it, generates the files, runs
              checks and shows a live preview.
            </p>
            <div className="chat__examples">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="chat__example"
                  onClick={() => {
                    setDraft(prompt);
                    textareaRef.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat__messages">
            {messages.map((message) => {
              if (message.role === 'system') {
                return (
                  <div className="msg msg--system" key={message.id}>
                    <Markdown content={message.content} />
                  </div>
                );
              }

              const isUser = message.role === 'user';
              return (
                <article className={`msg ${isUser ? 'msg--user' : 'msg--agent'}`} key={message.id}>
                  {!isUser && (
                    <span className="msg__who" aria-hidden="true">
                      <IconSparkle size={10} />
                    </span>
                  )}
                  <div
                    className="msg__bubble"
                    title={formatTime(message.createdAt)}
                  >
                    {message.content ? (
                      <Markdown content={message.content} />
                    ) : (
                      <span className="msg__typing">
                        <Dots />
                      </span>
                    )}
                    {message.pending && message.content && <span className="msg__caret" />}
                  </div>
                </article>
              );
            })}

            {activeRun && (
              <div className="chat__timeline">
                <button
                  className={`run-details ${timelineOpen ? 'is-open' : ''}`}
                  onClick={() => setTimelineOpen((o) => !o)}
                  aria-expanded={timelineOpen}
                >
                  <span className="run-details__label">
                    {activeRun.status === 'running' ? 'Working' : 'Run details'}
                  </span>
                  <span className="run-details__meta mono">
                    {doneSteps}/{activeRun.steps.length} steps
                    {activeRun.changes.length > 0 && ` · ${activeRun.changes.length} file(s)`}
                  </span>
                  <IconChevron size={12} className={`run-details__chev ${timelineOpen ? 'is-open' : ''}`} />
                </button>
                {timelineOpen && (
                  <div className="run-details__body">
                    <AgentTimeline run={activeRun} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="chat__composer">
        <div className={`composer ${isBusy ? 'is-busy' : ''}`}>
          <textarea
            ref={textareaRef}
            className="composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              project?.files.length
                ? 'Describe a change — "make the accent colour emerald"…'
                : 'Describe the project you want to build…'
            }
            rows={1}
            disabled={isBusy}
            aria-label="Message the coding agent"
          />
          {isBusy ? (
            <button className="composer__send composer__send--stop" onClick={cancelRun} title="Stop">
              <IconStop size={13} />
            </button>
          ) : (
            <button
              className="composer__send"
              onClick={submit}
              disabled={!draft.trim()}
              title="Send (Enter)"
              aria-label="Send message"
            >
              <IconSend size={14} />
            </button>
          )}
        </div>
        <p className="composer__hint" aria-hidden="true">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </p>
      </footer>
    </section>
  );
}
