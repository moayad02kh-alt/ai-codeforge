import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTime } from '../core/utils';
import { useProvider } from '../hooks/useProvider';
import { EXAMPLE_PROMPTS } from '../state/seed';
import { selectActiveProject, selectMessages, useStore } from '../state/store';
import { AgentTimeline } from './AgentTimeline';
import { Dots, IconSend, IconShield, IconSparkle, IconStop, IconX } from './Icons';
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

  const { isLive: live, label: providerLabel, status: backendStatus } = useProvider();
  const isEmpty = messages.length === 0;

  return (
    <section className={`chat ${chatOpen ? '' : 'is-collapsed'}`} aria-label="AI chat">
      <header className="chat__header">
        <div className="chat__header-left">
          <span className="chat__avatar" aria-hidden="true">
            <IconSparkle size={13} />
            {isBusy && <span className="chat__avatar-ring" />}
          </span>
          <div className="chat__heading">
            <span className="chat__title">Coding Agent</span>
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
          <IconShield size={13} />
          <p>
            <strong>Simulated agent.</strong> No AI model is connected. Responses and file output
            come from a local blueprint engine, and test results are mocked — the preview, however,
            runs your real generated code in a sandboxed iframe. To connect a real model:{' '}
            <code className="mono">cp .env.example .env</code>, add an API key, then{' '}
            <code className="mono">npm run dev</code>.
          </p>
          <button onClick={() => setDismissedNotice(true)} aria-label="Dismiss">
            <IconX size={12} />
          </button>
        </div>
      )}

      {live && !dismissedNotice && (
        <div className="chat__notice chat__notice--live" role="note">
          <IconShield size={13} />
          <p>
            <strong>Live model connected.</strong> {providerLabel}
            {backendStatus?.activeProvider ? ` · via ${backendStatus.activeProvider}` : ''}. Requests
            are proxied through the server-side API route — no API key is present in the browser.
          </p>
          <button onClick={() => setDismissedNotice(true)} aria-label="Dismiss">
            <IconX size={12} />
          </button>
        </div>
      )}

      <div className="chat__scroll" ref={scrollRef} onScroll={handleScroll}>
        {isEmpty && !activeRun ? (
          <div className="chat__empty">
            <span className="chat__empty-mark" aria-hidden="true">
              <IconSparkle size={22} />
            </span>
            <h2>What are we building?</h2>
            <p>
              Describe a project in plain language. The agent will plan it, generate the files, run
              checks and show you a live preview.
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
                  <IconSparkle size={11} />
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
                  <div className="msg__meta">
                    <span className="msg__author">{isUser ? 'You' : 'Agent'}</span>
                    <span className="msg__time mono">{formatTime(message.createdAt)}</span>
                  </div>
                  <div className="msg__bubble">
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
                <AgentTimeline run={activeRun} />
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
                ? 'Describe a change — "make the accent colour emerald", "add an FAQ section"…'
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
              <IconSend size={15} />
            </button>
          )}
        </div>
        <p className="composer__hint">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </p>
      </footer>
    </section>
  );
}
