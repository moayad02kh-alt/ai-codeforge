import { useEffect, useRef, useState } from 'react';
import { useModeStore } from '../../state/modeStore';
import { IconFilm, IconRefresh, IconWrench, IconX } from '../Icons';
import './Modes.css';

/**
 * Video mode. Provider abstraction lives server-side (/api/agent/video/*);
 * nothing is faked client-side: when no provider is configured the UI shows
 * a clear setup message, and generation uses the real two-phase
 * (start → poll) provider flow.
 */
export function VideoMode() {
  const {
    videoStatus, videoStatusLoaded, videoPrompt, videoStage, videoError, videoUrl,
    videoProviderLabel, videoImageName,
    setVideoPrompt, setVideoImage, loadVideoStatus, generateVideo, cancelVideo,
  } = useModeStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!videoStatusLoaded) void loadVideoStatus();
  }, [videoStatusLoaded, loadVideoStatus]);

  const configured = videoStatus?.configured ?? false;
  const busy = videoStage === 'starting' || videoStage === 'rendering' || videoStage === 'downloading';

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const [meta, b64] = dataUrl.split(',');
      const mime = meta.slice(meta.indexOf(':') + 1, meta.indexOf(';')) || 'image/png';
      setVideoImage(b64 ?? null, mime, file.name);
      setPreviewUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="mode-panel">
      <header className="mode-panel__header">
        <div>
          <h2 className="mode-panel__title">Video Mode</h2>
          <p className="mode-panel__subtitle">
            {configured
              ? `Text-to-video${' '}· powered by ${videoStatus?.label ?? videoProviderLabel ?? 'server provider'}`
              : 'AI video generation (provider pluggable)'}
          </p>
        </div>
        {configured && (
          <button className="mode-btn mode-btn--ghost" onClick={() => void loadVideoStatus()}>
            <IconRefresh size={14} /> Re-check
          </button>
        )}
      </header>

      {videoStatusLoaded && !configured ? (
        <div className="mode-setup">
          <IconWrench size={22} />
          <h3>Video provider not configured</h3>
          <p>{videoStatus?.hint ?? 'Configure VIDEO_PROVIDER and its API key in the server environment, then redeploy.'}</p>
          <p className="mode-empty__hint">
            Nothing is faked here — once a provider is connected, generation runs through the real
            provider API and results (or its errors) are shown honestly.
          </p>
          <button className="mode-btn" onClick={() => void loadVideoStatus()}>
            <IconRefresh size={14} /> Re-check
          </button>
        </div>
      ) : (
        <>
          <div className="mode-composer mode-composer--stacked">
            <textarea
              className="mode-composer__input"
              rows={3}
              placeholder="Describe the video — scene, motion, camera style, mood…"
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              disabled={busy}
            />
            <div className="mode-composer__row">
              <div className="mode-upload">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => onPickImage(e.target.files?.[0])}
                />
                <button className="mode-btn mode-btn--ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  {videoImageName ? `Image: ${videoImageName}` : 'Add start image (image-to-video, if supported)'}
                </button>
                {previewUrl && (
                  <span className="mode-upload__preview">
                    <img src={previewUrl} alt="Reference" />
                    <button
                      className="mode-btn mode-btn--small mode-btn--ghost"
                      onClick={() => { setVideoImage(null); setPreviewUrl(null); }}
                      aria-label="Remove reference image"
                    >
                      <IconX size={12} />
                    </button>
                  </span>
                )}
              </div>
              {busy ? (
                <button className="mode-btn mode-btn--primary" onClick={cancelVideo}>
                  <IconX size={14} /> Cancel
                </button>
              ) : (
                <button className="mode-btn mode-btn--primary" onClick={() => void generateVideo()} disabled={!videoPrompt.trim()}>
                  Generate video
                </button>
              )}
            </div>
          </div>

          {busy && (
            <div className="mode-progress">
              <div className="mode-progress__spinner" aria-hidden="true" />
              <span>
                {videoStage === 'starting'
                  ? 'Submitting to the video provider…'
                  : 'Rendering — this can take several minutes. You can keep the tab open or cancel.'}
              </span>
            </div>
          )}

          {videoError && <div className="mode-alert mode-alert--error">{videoError}</div>}

          {videoUrl && (
            <div className="mode-video">
              <video src={videoUrl} controls autoPlay loop muted />
              <a className="mode-btn" href={videoUrl} download="codeforge-video.mp4">Download video</a>
            </div>
          )}

          {!busy && !videoUrl && !videoError && (
            <div className="mode-empty">
              <IconFilm size={22} />
              <p>Generated videos appear here with a download button.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
