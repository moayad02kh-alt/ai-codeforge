import { useEffect, useRef } from 'react';
import { useModeStore } from '../../state/modeStore';
import { IconImage, IconRefresh, IconTrash, IconWrench } from '../Icons';
import './Modes.css';

/**
 * Image Generator mode. Prompts go to the server-side image provider
 * registry (/api/agent/image) — keys stay server-side. Provider-agnostic:
 * the UI renders whatever the active provider returns and shows a clear
 * setup message when none is configured.
 */
export function ImageMode() {
  const {
    imagePrompt, imageCount, imageBusy, imageError, images, promptHistory,
    imageStatus, imageStatusLoaded,
    setImagePrompt, setImageCount, loadImageStatus, generateImages, removeImage, clearImages,
  } = useModeStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!imageStatusLoaded) void loadImageStatus();
  }, [imageStatusLoaded, loadImageStatus]);

  const configured = imageStatus?.configured ?? false;

  const download = (item: { dataUrl: string; id: string }) => {
    const a = document.createElement('a');
    a.href = item.dataUrl;
    a.download = `codeforge-${item.id}.png`;
    a.click();
  };

  return (
    <div className="mode-panel">
      <header className="mode-panel__header">
        <div>
          <h2 className="mode-panel__title">Image Generator</h2>
          <p className="mode-panel__subtitle">
            {configured
              ? `Powered by ${imageStatus?.label ?? 'server provider'}${imageStatus?.model ? ` · ${imageStatus.model}` : ''}`
              : 'Server-side image generation'}
          </p>
        </div>
        {images.length > 0 && (
          <button className="mode-btn mode-btn--ghost" onClick={clearImages}>
            <IconTrash size={14} /> Clear gallery
          </button>
        )}
      </header>

      {imageStatusLoaded && !configured ? (
        <div className="mode-setup">
          <IconWrench size={22} />
          <h3>No image provider is configured</h3>
          <p>
            Add an image provider key to the server environment and redeploy — for example{' '}
            <code>GEMINI_API_KEY</code> (used automatically), or set <code>IMAGE_PROVIDER</code> to a
            specific adapter. Providers available here:{' '}
            {imageStatus?.providers.map((p) => `${p.label} (${p.configured ? 'configured' : 'not configured'})`).join(', ') || 'none registered'}.
          </p>
          <button className="mode-btn" onClick={() => void loadImageStatus()}>
            <IconRefresh size={14} /> Re-check
          </button>
        </div>
      ) : (
        <>
          <div className="mode-composer mode-composer--stacked">
            <textarea
              ref={inputRef}
              className="mode-composer__input"
              rows={3}
              placeholder="Describe the image you want — subject, style, mood, colors…"
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              disabled={imageBusy}
            />
            <div className="mode-composer__row">
              <div className="mode-segment" role="group" aria-label="Number of variations">
                {([1, 2, 4] as const).map((n) => (
                  <button
                    key={n}
                    className={`mode-segment__btn ${imageCount === n ? 'is-active' : ''}`}
                    onClick={() => setImageCount(n)}
                    disabled={imageBusy}
                  >
                    {n} {n === 1 ? 'image' : 'variations'}
                  </button>
                ))}
              </div>
              <button
                className="mode-btn mode-btn--primary"
                onClick={() => void generateImages()}
                disabled={imageBusy || !imagePrompt.trim()}
              >
                {imageBusy ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>

          {imageError && <div className="mode-alert mode-alert--error">{imageError}</div>}

          {promptHistory.length > 0 && (
            <div className="mode-history">
              <span className="mode-history__label">Recent prompts</span>
              <div className="mode-history__chips">
                {promptHistory.slice(0, 8).map((p) => (
                  <button key={p} className="mode-chip" onClick={() => setImagePrompt(p)} disabled={imageBusy}>
                    {p.length > 48 ? `${p.slice(0, 48)}…` : p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mode-gallery">
            {images.map((item) => (
              <figure key={item.id} className="mode-gallery__item">
                <img src={item.dataUrl} alt={item.prompt} />
                <figcaption className="mode-gallery__meta">
                  <span title={item.prompt}>
                    {item.prompt.length > 40 ? `${item.prompt.slice(0, 40)}…` : item.prompt}
                  </span>
                  <span className="mode-gallery__actions">
                    <button className="mode-btn mode-btn--small" onClick={() => download(item)}>Download</button>
                    <button className="mode-btn mode-btn--small mode-btn--ghost" onClick={() => removeImage(item.id)} aria-label="Remove image">
                      <IconTrash size={12} />
                    </button>
                  </span>
                  <span className="mode-note">via {item.providerLabel}{item.model ? ` · ${item.model}` : ''}</span>
                </figcaption>
              </figure>
            ))}
            {imageBusy && (
              <div className="mode-gallery__item mode-gallery__item--pending">
                <IconImage size={26} />
                <span>Rendering {imageCount} image{imageCount > 1 ? 's' : ''}…</span>
              </div>
            )}
            {!imageBusy && images.length === 0 && (
              <div className="mode-empty">
                <IconImage size={22} />
                <p>Generated images appear here — with download and prompt history.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
