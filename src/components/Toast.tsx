import { useStore } from '../state/store';
import { IconAlert, IconCheck, IconX } from './Icons';
import './Toast.css';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);

  if (!toast) return null;

  return (
    <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
      <span className="toast__icon">
        {toast.tone === 'ok' ? <IconCheck size={12} /> : <IconAlert size={12} />}
      </span>
      <span className="toast__msg">{toast.message}</span>
      <button onClick={dismiss} aria-label="Dismiss notification">
        <IconX size={11} />
      </button>
    </div>
  );
}
