import React from 'react';
import { FaExclamationTriangle, FaRedo } from 'react-icons/fa';

/**
 * Global React Error Boundary
 * Catches any unhandled render/component error and shows a recovery UI
 * instead of a blank white screen.
 * 
 * Usage: Wrap <App> or any subtree with <ErrorBoundary>
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // In production, send to an error reporting service here
    // e.g. Sentry.captureException(error, { extra: errorInfo })
    console.error('[ErrorBoundary] Component error caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)', padding: 24, fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '40px 48px', maxWidth: 520, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)', textAlign: 'center', border: '1px solid #f0f0f0'
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: '#fdf0ed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px'
            }}>
              <FaExclamationTriangle style={{ fontSize: 28, color: '#e74c3c' }} />
            </div>

            <h2 style={{ margin: '0 0 8px', color: '#2c3e50', fontSize: 22 }}>Something went wrong</h2>
            <p style={{ color: '#7f8c8d', fontSize: 15, margin: '0 0 24px', lineHeight: 1.6 }}>
              An unexpected error occurred in this section. Your data is safe.
              You can try recovering the page or refresh the browser.
            </p>

            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <div style={{
                background: '#f8f9fa', borderRadius: 8, padding: '12px 16px',
                textAlign: 'left', marginBottom: 24, border: '1px solid #e0e0e0'
              }}>
                <div style={{ fontSize: 12, color: '#e74c3c', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                  <strong>Error:</strong> {this.state.error.toString()}
                </div>
                {this.state.errorInfo && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>Stack trace</summary>
                    <pre style={{ fontSize: 10, color: '#666', overflow: 'auto', marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={this.handleReset} style={{
                padding: '10px 24px', borderRadius: 8, border: '2px solid #E3821E',
                background: 'transparent', color: '#E3821E', fontWeight: 600, fontSize: 14,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
              }}>
                <FaRedo /> Try to Recover
              </button>
              <button onClick={() => window.location.reload()} style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: '#E3821E', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer'
              }}>
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
