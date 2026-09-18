import { useEffect, useRef, useState } from 'react';
import { PackageCheck, Download, FolderSearch, ShieldCheck, Wifi, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStore, setState } from '../store';
import { call, on } from '../lib/api';
import * as A from '../actions';
import { Progress } from './ui';
import { errorMessage } from '../lib/ui';
import logo from '../assets/logo.svg';

export default function SetupScreen() {
  const tex = useStore((s) => s.tex);
  const [phase, setPhase] = useState('choose'); // choose | installing | done | error
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const logRef = useRef(null);

  useEffect(() => on('tex:progress', (s) => setLog((l) => (l + s).slice(-20000))), []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const install = async (kind) => {
    setPhase('installing');
    setError('');
    setLog('');
    try {
      const info = await call(kind === 'bundled' ? 'tex:installBundled' : 'tex:downloadInstall');
      setState({ tex: info });
      await A.updateSettings({ setupDone: true });
      setPhase('done');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  };

  const chooseFolder = async () => {
    const r = await call('dialog:open', { title: 'Select the folder that contains pdflatex.exe', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return;
    await A.updateSettings({ texBinPath: r.filePaths[0] });
    const info = await call('tex:detect', true);
    setState({ tex: info });
    if (info.found) {
      await A.updateSettings({ setupDone: true });
      setPhase('done');
    } else {
      setError('pdflatex.exe was not found in that folder. For MiKTeX it is usually ...\\MiKTeX\\miktex\\bin\\x64.');
      setPhase('error');
    }
  };

  const finish = async () => {
    await A.updateSettings({ setupDone: true });
    setState({ screen: 'dashboard' });
  };

  const bundled = tex && tex.bundledInstaller;

  return (
    <div className="setup">
      <div className="setup-card">
        <img src={logo} width="56" height="56" alt="" />
        {phase === 'choose' && (
          <>
            <h1>Welcome to FreedomTex</h1>
            <p>
              FreedomTex needs a LaTeX engine to turn your documents into PDFs. {bundled ? 'One is included with this installer, so no internet connection is needed.' : 'We can download and install MiKTeX for you.'}
            </p>
            <div className="setup-steps">
              <div className="setup-step">
                <div className="ss-icon">
                  <PackageCheck size={17} />
                </div>
                <div>
                  <div style={{ fontWeight: 650 }}>MiKTeX, a free LaTeX distribution for Windows</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    Includes pdfLaTeX, XeLaTeX, LuaLaTeX, BibTeX and Biber. It installs for your Windows account only, so administrator rights are not needed.
                  </div>
                </div>
              </div>
              <div className="setup-step">
                <div className="ss-icon">
                  <Wifi size={17} />
                </div>
                <div>
                  <div style={{ fontWeight: 650 }}>Extra packages on demand</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>When a document or template needs a package you do not have, FreedomTex asks and installs it for you.</div>
                </div>
              </div>
              <div className="setup-step">
                <div className="ss-icon">
                  <ShieldCheck size={17} />
                </div>
                <div>
                  <div style={{ fontWeight: 650 }}>Private and offline</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>Your projects stay on this computer. No account or subscription is required.</div>
                </div>
              </div>
            </div>
            <div className="col" style={{ gap: 10 }}>
              {bundled ? (
                <button className="btn btn-primary btn-lg" onClick={() => install('bundled')}>
                  <PackageCheck size={17} /> Install MiKTeX (included)
                </button>
              ) : (
                <button className="btn btn-primary btn-lg" onClick={() => install('download')}>
                  <Download size={17} /> Download and install MiKTeX (about 140 MB)
                </button>
              )}
              <div className="row">
                <button className="btn grow" onClick={chooseFolder}>
                  <FolderSearch size={15} /> I already have LaTeX installed
                </button>
                <button className="btn btn-ghost" onClick={finish}>
                  Skip for now
                </button>
              </div>
            </div>
          </>
        )}
        {phase === 'installing' && (
          <>
            <h1>Setting up LaTeX</h1>
            <p>MiKTeX is being installed. A MiKTeX progress window may appear. This usually takes a few minutes, so please keep FreedomTex open.</p>
            <Progress />
            <pre className="console" ref={logRef} style={{ marginTop: 14 }}>
              {log || 'Starting...'}
            </pre>
          </>
        )}
        {phase === 'done' && (
          <>
            <h1>
              <CheckCircle2 size={24} color="var(--success)" style={{ verticalAlign: '-4px', marginRight: 8 }} />
              You are all set
            </h1>
            <p>
              {tex && tex.found ? `${tex.version} is ready.` : 'LaTeX is ready.'} Create your first project to start writing.
            </p>
            <button className="btn btn-primary btn-lg" onClick={finish}>
              Get started <ArrowRight size={17} />
            </button>
          </>
        )}
        {phase === 'error' && (
          <>
            <h1>
              <AlertCircle size={24} color="var(--danger)" style={{ verticalAlign: '-4px', marginRight: 8 }} />
              Setup did not finish
            </h1>
            <p className="selectable">{error}</p>
            {log && <pre className="console">{log}</pre>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => setPhase('choose')}>
                Try again
              </button>
              <button className="btn" onClick={() => call('app:openExternal', 'https://miktex.org/download')}>
                Get MiKTeX from miktex.org
              </button>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={finish}>
                Continue without LaTeX
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
