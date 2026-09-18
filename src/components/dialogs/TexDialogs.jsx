import { useEffect, useRef, useState } from 'react';
import { PackageOpen, PackageCheck, Loader2, CheckCircle2, AlertCircle, RefreshCw, Download, FolderSearch, Terminal, Database, BookOpen, Search, HelpCircle } from 'lucide-react';
import { useStore, setState, getState } from '../../store';
import { call, on } from '../../lib/api';
import { toast, errorMessage } from '../../lib/ui';
import * as A from '../../actions';
import { Modal, Progress } from '../ui';

function useProgressLog() {
  const [log, setLog] = useState('');
  useEffect(() => on('tex:progress', (s) => setLog((l) => (l + s).slice(-30000))), []);
  return [log, setLog];
}

function Console({ log }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <pre className="console" ref={ref}>
      {log || 'Waiting for output...'}
    </pre>
  );
}

/** Shared install step: installs packages and reports progress. */
async function runInstall(pkgs, setPhase, setError) {
  setPhase('installing');
  try {
    const r = await call('tex:install', pkgs);
    if (!r.ok) {
      setError(r.error || 'Installation failed.');
      setPhase('error');
      return false;
    }
    setPhase('done');
    return true;
  } catch (e) {
    setError(errorMessage(e));
    setPhase('error');
    return false;
  }
}

export function PackagesDialog({ missing = [], retry, preflight, auto, onClose }) {
  const tex = useStore((s) => s.tex);
  const settings = useStore((s) => s.settings);
  const known = missing.filter((m) => m.package);
  const unknown = missing.filter((m) => !m.package);
  const [checked, setChecked] = useState(() => Object.fromEntries(known.map((m) => [m.package, true])));
  const [phase, setPhase] = useState('ask');
  const [error, setError] = useState('');
  const [always, setAlways] = useState(settings.missingPackages === 'always');
  const [log] = useProgressLog();
  const started = useRef(false);
  const pkgs = [...new Set(known.filter((m) => checked[m.package]).map((m) => m.package))];

  const go = async () => {
    if (always && settings.missingPackages !== 'always') A.updateSettings({ missingPackages: 'always' });
    const ok = pkgs.length ? await runInstall(pkgs, setPhase, setError) : true;
    if (!ok) return;
    toast('success', 'Packages installed', pkgs.join(', ') || 'MiKTeX will fetch the remaining files while compiling.');
    onClose();
    if (retry) retry(unknown.length && tex && tex.type === 'miktex' ? { enableInstaller: true } : {});
  };

  useEffect(() => {
    if (auto && !started.current) {
      started.current = true;
      go();
    }
  }, []);

  return (
    <Modal
      title={phase === 'installing' ? 'Installing packages' : 'Packages needed'}
      icon={<PackageOpen size={18} color="var(--accent)" />}
      onClose={phase === 'installing' ? undefined : onClose}
      footer={
        phase === 'ask' ? (
          <>
            <label className="check" style={{ marginRight: 'auto', fontSize: 12.5 }}>
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always install automatically
            </label>
            <button className="btn" onClick={onClose}>
              Not now
            </button>
            <button className="btn btn-primary" disabled={!pkgs.length && !unknown.length} onClick={go}>
              <Download size={15} /> Install{retry ? ' and compile' : ''}
            </button>
          </>
        ) : phase === 'error' ? (
          <>
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-primary" onClick={go}>
              <RefreshCw size={15} /> Try again
            </button>
          </>
        ) : null
      }
    >
      {phase === 'ask' && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {preflight ? 'This project uses LaTeX packages that are not installed yet.' : 'Your document needs LaTeX packages that are not installed yet.'} FreedomTex can download and install them now
            {tex && tex.type === 'miktex' ? ' from the MiKTeX package repository' : ''}. An internet connection is needed for this step only.
          </p>
          <div className="pkg-list">
            {known.map((m) => (
              <label key={m.file} className="pkg-row check">
                <input type="checkbox" checked={!!checked[m.package]} onChange={(e) => setChecked({ ...checked, [m.package]: e.target.checked })} />
                <div className="grow">
                  <div className="pkg-name">{m.package}</div>
                  <div className="pkg-file">
                    provides {m.file}
                    {m.source ? ` · used in ${m.source}` : ''}
                  </div>
                </div>
              </label>
            ))}
            {unknown.map((m) => (
              <div key={m.file} className="pkg-row">
                <HelpCircle size={15} color="var(--text-faint)" />
                <div className="grow">
                  <div className="pkg-name">{m.file}</div>
                  <div className="pkg-file">
                    {tex && tex.type === 'miktex' ? 'Package not identified. MiKTeX will try to find it during the next compile.' : 'Package not identified. It may be a misspelled name or a file missing from your project.'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {phase === 'installing' && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Installing {pkgs.join(', ')}. This can take a minute.</p>
          <Progress />
          <div style={{ height: 12 }} />
          <Console log={log} />
        </>
      )}
      {phase === 'error' && (
        <>
          <p style={{ color: 'var(--danger)', marginTop: 0 }}>
            <AlertCircle size={15} style={{ verticalAlign: '-3px' }} /> The installation did not complete.
          </p>
          <pre className="log-raw">{error}</pre>
          <p className="muted">Check your internet connection. If the problem continues, open Tools, TeX Distribution, and choose Update package database.</p>
          <Console log={log} />
        </>
      )}
      {phase === 'done' && (
        <p>
          <CheckCircle2 size={15} color="var(--success)" style={{ verticalAlign: '-3px' }} /> Installed.
        </p>
      )}
    </Modal>
  );
}

export function CheckPackagesDialog({ onClose }) {
  const project = useStore((s) => s.project);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    call('tex:check', project.id)
      .then(setRes)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (res && res.missing.length) {
    return <PackagesDialog missing={res.missing} preflight retry={() => A.compile()} onClose={onClose} />;
  }
  return (
    <Modal title="Check required packages" icon={<PackageCheck size={18} color="var(--accent)" />} size="sm" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      {!res && !error && (
        <div className="row">
          <Loader2 size={16} className="spin" /> Scanning \usepackage, \documentclass and style commands...
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {res && !res.found && <p>No TeX distribution was found. Install MiKTeX from Tools, TeX Distribution.</p>}
      {res && res.found && (
        <p>
          <CheckCircle2 size={16} color="var(--success)" style={{ verticalAlign: '-3px' }} /> All {res.checked} packages and classes used by this project are installed.
        </p>
      )}
    </Modal>
  );
}

export function InstallPackageDialog({ onClose }) {
  const [name, setName] = useState('');
  const [phase, setPhase] = useState('ask');
  const [error, setError] = useState('');
  const [log] = useProgressLog();
  const go = async () => {
    const pkgs = name.split(/[\s,]+/).filter(Boolean);
    if (!pkgs.length) return;
    if (await runInstall(pkgs, setPhase, setError)) toast('success', 'Installed', pkgs.join(', '));
  };
  return (
    <Modal
      title="Install a LaTeX package"
      icon={<Download size={18} color="var(--accent)" />}
      onClose={phase === 'installing' ? undefined : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={phase === 'installing'}>
            Close
          </button>
          <button className="btn btn-primary" onClick={go} disabled={phase === 'installing' || !name.trim()}>
            {phase === 'installing' ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Install
          </button>
        </>
      }
    >
      <div className="field">
        <label>Package name</label>
        <input className="input" autoFocus placeholder="e.g. tikzposter, moderncv, siunitx" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <div className="hint">Use the package name from CTAN. Separate several names with spaces.</div>
      </div>
      {phase !== 'ask' && (
        <div style={{ marginTop: 14 }}>
          {phase === 'done' && (
            <p>
              <CheckCircle2 size={15} color="var(--success)" style={{ verticalAlign: '-3px' }} /> Installed successfully.
            </p>
          )}
          {phase === 'error' && <pre className="log-raw">{error}</pre>}
          <Console log={log} />
        </div>
      )}
    </Modal>
  );
}

export function TexDialog({ onClose }) {
  const tex = useStore((s) => s.tex);
  const settings = useStore((s) => s.settings);
  const [busy, setBusy] = useState(null);
  const [log, setLog] = useProgressLog();

  const redetect = async () => {
    setBusy('detect');
    const info = await call('tex:detect', true);
    setState({ tex: info });
    setBusy(null);
    toast(info.found ? 'success' : 'warning', info.found ? `Found ${info.version}` : 'No TeX distribution found', info.found ? info.binDir : 'Install MiKTeX to compile documents.');
  };

  const action = async (id, channel) => {
    setBusy(id);
    setLog('');
    try {
      const r = await call(channel);
      if (channel !== 'tex:updateDb') setState({ tex: r });
      toast('success', 'Done', channel === 'tex:updateDb' ? 'Package database updated.' : `${r.version} is ready.`);
    } catch (e) {
      toast('error', 'Something went wrong', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseFolder = async () => {
    const r = await call('dialog:open', { title: 'Select the folder that contains pdflatex.exe', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    await A.updateSettings({ texBinPath: r.filePaths[0] });
    redetect();
  };

  const tools = tex && tex.tools ? Object.entries(tex.tools) : [];

  return (
    <Modal title="TeX distribution" icon={<PackageCheck size={18} color="var(--accent)" />} size="lg" onClose={busy ? undefined : onClose} footer={<button className="btn btn-primary" onClick={onClose} disabled={!!busy}>Close</button>}>
      <div className="about-card" style={{ marginTop: 0 }}>
        <span className={`sb-dot ${tex && tex.found ? '' : 'err'}`} style={{ width: 12, height: 12 }} />
        <div className="grow">
          <div style={{ fontWeight: 700 }}>{tex && tex.found ? tex.version : 'No TeX distribution found'}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {tex && tex.found ? tex.binDir : 'FreedomTex needs MiKTeX or TeX Live to compile documents.'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={redetect} disabled={!!busy}>
          {busy === 'detect' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Detect again
        </button>
      </div>
      {tools.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {tools.map(([t, ok]) => (
            <span key={t} className={`pill ${ok ? 'success' : ''}`}>
              {ok ? '✓' : '×'} {t}
            </span>
          ))}
        </div>
      )}
      <div className="col">
        {(!tex || !tex.found || tex.type === 'miktex') && tex && tex.bundledInstaller && (
          <button className="btn" onClick={() => action('bundled', 'tex:installBundled')} disabled={!!busy}>
            {busy === 'bundled' ? <Loader2 size={15} className="spin" /> : <PackageCheck size={15} />} {tex.found ? 'Reinstall the included MiKTeX' : 'Install the included MiKTeX'}
          </button>
        )}
        {(!tex || !tex.found) && (
          <button className="btn" onClick={() => action('download', 'tex:downloadInstall')} disabled={!!busy}>
            {busy === 'download' ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Download and install MiKTeX
          </button>
        )}
        {tex && tex.type === 'miktex' && (
          <>
            <button className="btn" onClick={() => action('db', 'tex:updateDb')} disabled={!!busy}>
              {busy === 'db' ? <Loader2 size={15} className="spin" /> : <Database size={15} />} Update package database
            </button>
            <button className="btn" onClick={() => call('tex:console')} disabled={!!busy}>
              <Terminal size={15} /> Open MiKTeX Console (updates and settings)
            </button>
          </>
        )}
        <div className="row">
          <button className="btn grow" onClick={chooseFolder} disabled={!!busy}>
            <FolderSearch size={15} /> Use a different TeX installation...
          </button>
          {settings.texBinPath && (
            <button className="btn btn-ghost" onClick={() => A.updateSettings({ texBinPath: '' }).then(redetect)}>
              Reset to automatic
            </button>
          )}
        </div>
      </div>
      {busy && busy !== 'detect' && (
        <div style={{ marginTop: 14 }}>
          <Progress />
          <div style={{ height: 10 }} />
          <Console log={log} />
        </div>
      )}
    </Modal>
  );
}

export function PackageDocsDialog({ onClose }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await call('tex:docs', name.trim()).catch(() => ({ ok: false }));
    setBusy(false);
    if (r.ok) {
      toast('success', 'Opening documentation', name.trim());
    } else {
      toast('warning', 'No local documentation found', 'Opening the package page on CTAN instead.');
      call('app:openExternal', `https://ctan.org/pkg/${encodeURIComponent(name.trim())}`);
    }
  };
  return (
    <Modal
      title="Package documentation"
      icon={<BookOpen size={18} color="var(--accent)" />}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => name.trim() && call('app:openExternal', `https://ctan.org/pkg/${encodeURIComponent(name.trim())}`)}>
            <Search size={15} /> CTAN
          </button>
          <button className="btn btn-primary" onClick={open} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <BookOpen size={15} />} Open
          </button>
        </>
      }
    >
      <div className="field">
        <label>Package name</label>
        <input className="input" autoFocus placeholder="e.g. amsmath, tikz, biblatex" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} />
        <div className="hint">Opens the package manual installed with your TeX distribution.</div>
      </div>
    </Modal>
  );
}
