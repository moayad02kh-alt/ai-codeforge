import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

/*
 * Clear the static boot fallback from index.html before mounting.
 *
 * createRoot() does not remove pre-existing children of its container, so the
 * fallback would otherwise stay in the DOM underneath the app. It is
 * position:fixed, so leaving it there would cover the whole viewport with an
 * opaque panel — the exact black screen it exists to prevent.
 */
document.getElementById('boot-fallback')?.remove();

createRoot(container).render(
  <StrictMode>
    {/* Top-level net: a render error shows a readable panel instead of a
        black screen, which is otherwise undebuggable on mobile. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
