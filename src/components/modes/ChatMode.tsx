import { useEffect, useRef, useState } from 'react';
import { useModeStore } from '../../state/modeStore';
import { Markdown } from '../Markdown';
import { IconSend, IconSparkle, IconTrash, IconX } from '../Icons';
import { useProvider } from '../../hooks/useProvider';
import './Modes.css';

/**
 * Chat AI mode — general conversation through the SAME server provider chain
 * as the agent (Gemini → Groq → OpenRouter Free). Shows the active provider
 * and failover notices; never touches keys.
 */
export function ChatMode() {
  const { chat, chatBusy, sendChat, clearChat, chatStyle, setChatStyle } = useModeStore();
  const { label: liveLabel, isLive } = useProvider();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, chatBusy]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || chatBusy) return;
    setDraft('');
    await sendChat(text);
  };

  return (
    <div className="mode-panel mode-panel--chat">
      <header className="mode-panel__header">
        <div>
          <h2 className="mode-panel__title">Chat AI</h2>
          <p className="mode-panel__subtitle">
            General conversation &amp; coding questions — powered by {isLive ? liveLabel : 'offline simulation'}
          </p>
        </div>
        {chat.length > 0 && (
          <button className="mode-btn mode-btn--ghost" onClick={clearChat} title="Clear conversation">
            <IconTrash size={14} /> Clear
          </button>
        )}
      </header>

      <div className="mode-chat__thread" ref={scrollRef}>
        {chat.length === 0 && (
          <div className="mode-empty">
            <IconSparkle size={22} />
            <p>Ask anything — concepts, code explanations, ideas, debugging help.</p>
            <p className="mode-empty__hint">For building or modifying the project, use the Agent or Build App modes.</p>
          </div>
        )}
        {chat.map((entry) => (
          <div key={entry.id} className={`mode-chat__entry mode-chat__entry--${entry.role}`}>
            <div className="mode-chat__bubble">
              {entry.role === 'assistant' ? <Markdown content={entry.content} /> : entry.content}
            </div>
            {(entry.providerLabel || entry.failoverNotes?.length) && (
              <div className="mode-chat__meta">
                {entry.failoverNotes?.map((note, i) => (
                  <span key={i} className="mode-note mode-note--warn">⚠️ {note}</span>
                ))}
                {entry.providerLabel && !entry.isError && (
                  <span className="mode-note">via {entry.providerLabel}</span>
                )}
              </div>
            )}
          </div>
        ))}
        {chatBusy && (
          <div className="mode-chat__entry mode-chat__entry--assistant">
            <div className="mode-chat__bubble mode-chat__bubble--pending">
              {chatStyle === 'think' ? 'Thinking deeply…' : 'Thinking…'}
            </div>
          </div>
        )}
      </div>

      <footer className="mode-panel__footer">
        <div className="mode-composer mode-composer--stacked">
          <div className="chat-style-toggle" role="group" aria-label="Chat style">
            <button
              type="button"
              className={`chat-style-toggle__btn ${chatStyle === 'fast' ? 'is-active' : ''}`}
              onClick={() => setChatStyle('fast')}
              aria-pressed={chatStyle === 'fast'}
              title="Quick answers, shown as they arrive"
            >
              ⚡ Fast
            </button>
            <button
              type="button"
              className={`chat-style-toggle__btn ${chatStyle === 'think' ? 'is-active' : ''}`}
              onClick={() => setChatStyle('think')}
              aria-pressed={chatStyle === 'think'}
              title="Deeper step-by-step reasoning — takes a little longer"
            >
              🧠 Think
            </button>
            <span className="chat-style-toggle__hint">
              {chatStyle === 'think'
                ? 'Reasons step by step before answering'
                : 'Answers stream in as they arrive'}
            </span>
          </div>
          <div className="mode-composer">
          <textarea
            className="mode-composer__input"
            placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button
            className="mode-btn mode-btn--primary"
            onClick={() => void submit()}
            disabled={chatBusy || !draft.trim()}
            aria-label="Send message"
          >
            {chatBusy ? <IconX size={15} /> : <IconSend size={15} />}
          </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
