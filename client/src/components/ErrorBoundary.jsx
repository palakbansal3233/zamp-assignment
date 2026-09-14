import { Component } from 'react';

// React error boundaries must be class components — there's no hook
// equivalent. Without this, any unexpected render-time error anywhere in
// the tree (a malformed API response shaped differently than expected, a
// null we didn't guard against) takes down the entire page to a blank white
// screen with no way back except a manual hard refresh. This catches that
// and offers a real way out instead.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-body)',
          padding: 'var(--space-8)',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 'var(--space-4)' }}>⚠</div>
          <h3 style={{ margin: '0 0 var(--space-2)' }}>Something went wrong</h3>
          <p className="text-muted" style={{ fontSize: '13.5px', marginBottom: 'var(--space-6)' }}>
            The page hit an unexpected error and stopped rendering. Your documents are safe — they live on the
            server, not in this tab. Reloading should fix it.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            title="Reload the page"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
