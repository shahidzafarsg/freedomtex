import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// Keeps a rendering bug from blanking the whole window; your files are saved separately.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('FreedomTex UI error:', error, info && info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pdf-empty" style={{ height: '100%' }}>
        <div>
          <div className="big-icon" style={{ color: 'var(--warning)' }}>
            <AlertTriangle size={28} />
          </div>
          <div style={{ fontWeight: 650, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>Something went wrong in this view</div>
          <div className="muted selectable" style={{ maxWidth: 460, margin: '0 auto 14px' }}>
            Your files are safe on disk. {String(this.state.error && this.state.error.message)}
          </div>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={15} /> Try again
          </button>{' '}
          <button className="btn" onClick={() => window.location.reload()}>
            Reload window
          </button>
        </div>
      </div>
    );
  }
}
