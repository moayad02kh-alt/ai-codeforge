import { useEffect, useRef, useState } from 'react';
import { useModeStore } from '../../state/modeStore';
import { Markdown } from '../Markdown';
import { IconCamera, IconImage, IconPlus, IconSearch, IconSend, IconSparkle, IconTrash, IconX } from '../Icons';
import { useProvider } from '../../hooks/useProvider';
import type { ChatImage } from '../../services/ModeApi';
import './Modes.css';

/** Downscale to keep payloads small for the server (8MB JSON cap) and fast on mobile data. */
const MAX_IMAGE_DIM = 1280;

/** Read + downscale an image file to a base64 JPEG for the chat API. */
function fileToChatImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('not-an-image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode-failed'));
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('canvas-failed');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve({ mimeType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
        } catch {
          reject(new Error('canvas-failed'));
        }
      };
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Chat AI mode — general conversation through the SAME server provider chain
 * as the agent (Gemini → Groq → OpenRouter Free). Shows the active provider
 * and failover notices; never touches keys.
 */
export function ChatMode() {
  const { chat, chatBusy, sendChat, clearChat, chatStyle, setChatStyle } = useModeStore();
  const { label: liveLabel, isLive } = useProvider();
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<ChatImage | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachError, setAttachError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, chatBusy]);

  // Close the "+" menu on outside click or Escape.
  useEffect(() => {
    if (!plusOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!plusWrapRef.current?.contains(e.target as Node)) setPlusOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlusOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [plusOpen]);

  const pickFile = async (file: File | undefined | null) => {
    if (!file) return;
    setPlusOpen(false);
    try {
      setAttachment(await fileToChatImage(file));
      setAttachError('');
    } catch {
      setAttachError("Couldn't read that image — try a different one.");
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if ((!text && !attachment) || chatBusy) return;
    setDraft('');
    setAttachError('');
    const images = attachment ? [attachment] : undefined;
    const search = searchOn || undefined;
    setAttachment(null);
    await sendChat(text || 'Describe this image.', { images, search });
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
            {(entry.providerLabel || entry.failoverNotes?.length || entry.usedSearch) && (
              <div className="mode-chat__meta">
                {entry.failoverNotes?.map((note, i) => (
                  <span key={i} className="mode-note mode-note--warn">⚠️ {note}</span>
                ))}
                {entry.usedSearch && (
                  <span className="mode-note">
                    🌐 Answered with web search
                    {!entry.sources?.length && ' — no sources returned, so this came from the model itself'}
                  </span>
                )}
                {entry.hadImage && <span className="mode-note">📷 Image</span>}
                {entry.providerLabel && !entry.isError && (
                  <span className="mode-note">via {entry.providerLabel}</span>
                )}
                {!!entry.sources?.length && (
                  <div className="chat-sources">
                    {entry.sources.map((s, i) => (
                      <a
                        key={i}
                        className="chat-source"
                        href={s.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={s.uri}
                      >
                        <IconSearch size={10} />
                        {s.title.length > 44 ? `${s.title.slice(0, 44)}…` : s.title}
                      </a>
                    ))}
                  </div>
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

          {attachment && (
            <div className="chat-image-chip">
              <img
                className="chat-image-chip__thumb"
                alt="Attachment preview"
                src={`data:${attachment.mimeType};base64,${attachment.data}`}
              />
              <span className="chat-image-chip__name">Image ready</span>
              <button
                className="chat-image-chip__remove"
                onClick={() => setAttachment(null)}
                aria-label="Remove image"
                title="Remove image"
              >
                <IconX size={12} />
              </button>
            </div>
          )}

          {attachError && (
            <p className="chat-attach__error" role="alert">{attachError}</p>
          )}

          <div className="chat-controls">
            <div className="chat-attach" ref={plusWrapRef}>
              <button
                type="button"
                className={`mode-icon-btn ${plusOpen ? 'is-open' : ''}`}
                onClick={() => setPlusOpen((v) => !v)}
                aria-label="Add photo or toggle web search"
                aria-expanded={plusOpen}
                title="Photo, image or web search"
              >
                <IconPlus size={16} />
              </button>
              {plusOpen && (
                <div className="chat-attach__menu" role="menu">
                  <button
                    type="button"
                    className="chat-attach__item"
                    role="menuitem"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <IconCamera size={14} /> Take photo
                  </button>
                  <button
                    type="button"
                    className="chat-attach__item"
                    role="menuitem"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <IconImage size={14} /> Choose image
                  </button>
                  <button
                    type="button"
                    className={`chat-attach__item ${searchOn ? 'is-active' : ''}`}
                    role="menuitemcheckbox"
                    aria-checked={searchOn}
                    onClick={() => setSearchOn((v) => !v)}
                  >
                    <IconSearch size={14} /> Web search {searchOn ? 'on' : 'off'}
                  </button>
                </div>
              )}
            </div>

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
            </div>

            <button
              type="button"
              className={`chat-search-pill ${searchOn ? 'is-active' : ''}`}
              onClick={() => setSearchOn((v) => !v)}
              aria-pressed={searchOn}
              title="Let the model ground answers with web search"
            >
              🌐 Search
            </button>

            <button
              className="mode-btn mode-btn--primary chat-send"
              onClick={() => void submit()}
              disabled={chatBusy || (!draft.trim() && !attachment)}
              aria-label="Send message"
            >
              {chatBusy ? <IconX size={15} /> : <IconSend size={15} />}
            </button>
          </div>

          {/* Camera capture (system camera app — no in-browser permission prompt)
              and gallery/library picker. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </footer>
    </div>
  );
}
