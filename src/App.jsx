import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useStore } from './store';
import { boot } from './actions';
import { handleGlobalKey } from './commands';
import { dismissToast } from './lib/ui';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import Dashboard from './components/Dashboard';
import Workspace from './components/Workspace';
import SetupScreen from './components/SetupScreen';
import DialogHost from './components/dialogs/Dialogs';
import ErrorBoundary from './components/ErrorBoundary';
import logo from './assets/logo.svg';

export default function App() {
  const screen = useStore((s) => s.screen);

  useEffect(() => {
    boot().catch((e) => {
      console.error(e);
      useStore.setState({ screen: 'dashboard' });
    });
    window.addEventListener('keydown', handleGlobalKey);
    // Dropping files onto the window must not navigate away from the app.
    const stop = (e) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('keydown', handleGlobalKey);
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <div style={{ minHeight: 0, minWidth: 0 }}>
        <ErrorBoundary key={screen}>
          {screen === 'loading' && (
            <div className="splash">
              <img src={logo} alt="FreedomTex" />
            </div>
          )}
          {screen === 'setup' && <SetupScreen />}
          {screen === 'dashboard' && <Dashboard />}
          {screen === 'editor' && <Workspace />}
        </ErrorBoundary>
      </div>
      {screen !== 'loading' && screen !== 'setup' && <StatusBar />}
      <DialogHost />
      <Toasts />
    </div>
  );
}

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertTriangle };

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind] || Info;
        return (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon size={17} className="t-icon" />
            <div className="grow">
              <div className="t-title">{t.title}</div>
              {t.body && <div className="t-body">{t.body}</div>}
            </div>
            <button className="icon-btn sm" onClick={() => dismissToast(t.id)} title="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
