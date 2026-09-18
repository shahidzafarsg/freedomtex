import { useEffect, useState } from 'react';
import { GitBranch, GitCommitHorizontal, Upload, Download, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { useStore } from '../../store';
import { call } from '../../lib/api';
import { toast, errorMessage } from '../../lib/ui';
import * as E from '../../editor/controller';
import * as A from '../../actions';
import { Modal } from '../ui';

export default function GitDialog({ onClose }) {
  const project = useStore((s) => s.project);
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const [remote, setRemote] = useState('');
  const [busy, setBusy] = useState(null);
  const [out, setOut] = useState('');

  const refresh = async () => {
    const s = await call('git:status', project.id).catch((e) => ({ error: errorMessage(e) }));
    setSt(s);
    if (s && s.remote) setRemote(s.remote);
  };
  useEffect(() => {
    refresh();
  }, []);

  const run = async (id, fn, okText) => {
    setBusy(id);
    setOut('');
    try {
      const r = await fn();
      setOut([r.out, r.err].filter(Boolean).join('\n'));
      if (r.ok) toast('success', okText);
      else toast('error', 'Git reported a problem', (r.err || r.out || '').split('\n').slice(-3).join('\n'));
    } catch (e) {
      toast('error', 'Git failed', errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const commit = () =>
    run(
      'commit',
      async () => {
        await E.saveAll();
        const r = await call('git:commit', project.id, msg || `Update ${new Date().toLocaleString()}`);
        if (r.ok) setMsg('');
        return r;
      },
      'Changes committed',
    );

  return (
    <Modal title="Git" icon={<GitBranch size={18} color="var(--accent)" />} size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      {!st && (
        <div className="row muted">
          <Loader2 size={15} className="spin" /> Checking...
        </div>
      )}
      {st && st.error && <p style={{ color: 'var(--danger)' }}>{st.error}</p>}
      {st && st.available === false && (
        <div>
          <p>Git is not installed on this computer. Git keeps a full history of your project and lets you back it up to GitHub, GitLab or a university server.</p>
          <button className="btn" onClick={() => call('app:openExternal', 'https://git-scm.com/download/win')}>
            <ExternalLink size={15} /> Download Git for Windows
          </button>
          <p className="muted" style={{ fontSize: 12 }}>FreedomTex already keeps its own version history (Tools, History and Versions) without Git.</p>
        </div>
      )}
      {st && st.available && !st.isRepo && (
        <div>
          <p>This project is not a Git repository yet. Create one to track changes and push them to GitHub or another server.</p>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => run('init', () => call('git:init', project.id), 'Git repository created')}>
            {busy === 'init' ? <Loader2 size={15} className="spin" /> : <GitBranch size={15} />} Create repository
          </button>
        </div>
      )}
      {st && st.isRepo && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row">
            <span className="pill accent">
              <GitBranch size={12} /> {st.branch}
            </span>
            <span className="muted">{st.changes.length ? `${st.changes.length} changed file${st.changes.length === 1 ? '' : 's'}` : 'No uncommitted changes'}</span>
            <span className="spacer" />
            <button className="icon-btn sm" title="Refresh" onClick={refresh}>
              <RefreshCw size={14} />
            </button>
          </div>
          {st.changes.length > 0 && (
            <div className="pkg-list" style={{ maxHeight: 150, overflow: 'auto' }}>
              {st.changes.map((c) => (
                <div key={c.file} className="pkg-row" style={{ padding: '5px 12px' }}>
                  <span className="pill" style={{ minWidth: 28, justifyContent: 'center' }}>
                    {c.code || '?'}
                  </span>
                  <span className="pkg-file">{c.file}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <input className="input grow" placeholder="Describe your changes (commit message)" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} />
            <button className="btn btn-primary" disabled={!!busy || !st.changes.length} onClick={commit}>
              {busy === 'commit' ? <Loader2 size={15} className="spin" /> : <GitCommitHorizontal size={15} />} Commit all
            </button>
          </div>
          <div className="field">
            <label>Remote repository (origin)</label>
            <div className="row">
              <input className="input grow" placeholder="https://github.com/your-name/your-thesis.git" value={remote} onChange={(e) => setRemote(e.target.value)} />
              <button className="btn" disabled={!!busy || !remote.trim() || remote === st.remote} onClick={() => run('remote', () => call('git:remote', project.id, remote.trim()), 'Remote saved')}>
                Save
              </button>
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={!!busy || !st.remote} onClick={() => run('pull', () => call('git:pull', project.id), 'Pulled latest changes').then(() => A.refreshTree())}>
              {busy === 'pull' ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Pull
            </button>
            <button className="btn" disabled={!!busy || !st.remote} onClick={() => run('push', () => call('git:push', project.id), 'Pushed to remote')}>
              {busy === 'push' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Push
            </button>
            <span className="faint" style={{ fontSize: 12 }}>
              Sign-in, if needed, happens in a Git Credential Manager window.
            </span>
          </div>
          {out && <pre className="log-raw">{out}</pre>}
          {st.log.length > 0 && (
            <div>
              <div className="settings-group-title" style={{ marginBottom: 6 }}>
                Recent commits
              </div>
              <div className="pkg-list" style={{ maxHeight: 170, overflow: 'auto' }}>
                {st.log.map((c) => (
                  <div key={c.hash} className="pkg-row" style={{ padding: '6px 12px' }}>
                    <code>{c.hash}</code>
                    <span className="grow ellipsis">{c.subject}</span>
                    <span className="faint" style={{ fontSize: 11.5 }}>
                      {c.author}, {c.when}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
