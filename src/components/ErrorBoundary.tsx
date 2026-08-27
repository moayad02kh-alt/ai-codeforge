import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

/**
 * Catches render-time errors anywhere below it so a single failing component
 * cannot unmount the entire application and leave a black screen.
 *
 * React deliberately unmounts the whole tree when an error escapes rendering.
 * Without a boundary the user sees nothing at all and the cause is invisible
 * unless they open the console — which is not possible on mobile. This shows
 * the actual error plus a recovery path instead.
 */

interface Props {
  children: ReactNode;
  /** Shown in the heading, e.g. "Code editor" for a per-panel boundary. */
  label?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // Keep the real stack in the console for debugging.
    console.error('[CodeForge] Unhandled render error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, info: null });

  private hardReset = () => {
    // Corrupt persisted state is a common cause of a boot loop; offer a way
    // out that does not require devtools.
    try {
      localStorage.removeItem('codeforge.state.v1');
    } catch {
      /* ignore */
    }
    location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const title = this.props.label ? `${this.props.label} failed to render` : 'Something went wrong';

    return (
      <div className="errbound" role="alert">
        <div className="errbound__card">
          <div className="errbound__badge">Runtime error</div>
          <h1 className="errbound__title">{title}</h1>
          <p className="errbound__lede">
            The interface hit an unexpected error. Your projects are saved locally and were not lost.
          </p>

          <pre className="errbound__msg">{error.message || String(error)}</pre>

          {info?.componentStack ? (
            <details className="errbound__details">
              <summary>Component stack</summary>
              <pre>{info.componentStack.trim()}</pre>
            </details>
          ) : null}

          <div className="errbound__actions">
            <button className="errbound__btn errbound__btn--primary" onClick={this.reset}>
              Try again
            </button>
            <button className="errbound__btn" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="errbound__btn errbound__btn--danger" onClick={this.hardReset}>
              Reset saved state
            </button>
          </div>
        </div>
      </div>
    );
  }
}
