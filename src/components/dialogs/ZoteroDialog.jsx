import { useEffect, useState } from 'react';
import { BookMarked, Monitor, Cloud, RefreshCw, Loader2, CheckCircle2, AlertTriangle, ExternalLink, KeyRound, Download } from 'lucide-react';
import { useStore, setState } from '../../store';
import { call } from '../../lib/api';
import { toast, errorMessage } from '../../lib/ui';
import * as A from '../../actions';
import * as E from '../../editor/controller';
import { Modal, Segmented } from '../ui';

export default function ZoteroDialog({ onClose }) {
  const project = useStore((s) => s.project);
  const index = useStore((s) => s.index);
  const link = project.zotero || null;
  const [source, setSource] = useState(link ? link.source : 'local');
  const [st, setSt] = useState(null);
  const [libs, setLibs] = useState([]);
  const [lib, setLib] = useState(link && link.lib ? link.lib : { type: 'user', id: 0, name: 'My Library' });
  const [cols, setCols] = useState([]);
  const [collection, setCollection] = useState(link ? link.collection : '');
  const [format, setFormat] = useState(link ? link.format : /biblatex|addbibresource/.test(E.textOf(project.mainFile) || '') ? 'biblatex' : 'bibtex');
  const [file, setFile] = useState(link ? link.file : (index.bibFiles || [])[0] || 'references.bib');
  const [mode, setMode] = useState(link ? link.mode : 'replace');
  const [includeSub, setIncludeSub] = useState(link && link.includeSub === false ? false : true);
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const ready = source === 'local' ? st && st.running && (st.localApi || st.bbt) : st && st.web;

  const refreshStatus = async () => {
    setBusy('status');
    setError('');
    try {
      const s = await call('zotero:status');
      setSt(s);
      setUserId(s.webUserId || '');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (!ready) return;
    setError('');
    call('zotero:libraries', source)
      .then(setLibs)
      .catch((e) => setError(errorMessage(e)));
  }, [ready, source]);

  useEffect(() => {
    if (!ready) return;
    setCols([]);
    call('zotero:collections', source, lib)
      .then(setCols)
      .catch((e) => setError(errorMessage(e)));
  }, [ready, source, lib && lib.type, lib && lib.id]);

  const saveCreds = async () => {
    setBusy('creds');
    await call('zotero:setCreds', userId.trim(), apiKey.trim());
    setApiKey('');
    await refreshStatus();
  };

  const doImport = async () => {
    setBusy('import');
    setError('');
    setDone(null);
    try {
      await E.saveAll();
      const colName = (cols.find((c) => c.key === collection) || {}).name || '';
      const r = await call('zotero:import', project.id, { source, lib, collection, collectionName: colName, format, file, mode, includeSub });
      setState({ project: r.project, forceReload: true });
      await E.reloadChanged([r.file]);
      setState({ forceReload: false });
      await A.refreshTree();
      await A.refreshIndex();
      setDone(r);
      toast('success', `Imported ${r.total} reference${r.total === 1 ? '' : 's'} from Zotero`, mode === 'merge' ? `${r.added} new in ${r.file}` : r.file);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const main = E.textOf(project.mainFile) || '';
  const fileBase = file.replace(/\.bib$/i, '');
  const referenced = main.includes(fileBase) || main.includes(file);

  return (
    <Modal
      title="Import references from Zotero"
      icon={<BookMarked size={18} color="#cc2936" />}
      size="lg"
      onClose={busy === 'import' ? undefined : onClose}
      footer={
        <>
          {link && (
            <span className="faint" style={{ marginRight: 'auto', fontSize: 12 }}>
              Linked to {link.file}
              {link.collectionName ? ` (collection "${link.collectionName}")` : ''}. Last import {new Date(link.lastImport).toLocaleString()}.
            </span>
          )}
          <button className="btn" onClick={onClose} disabled={busy === 'import'}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!ready || !!busy || !file.trim()} onClick={doImport}>
            {busy === 'import' ? <Loader2 size={15} className="spin" /> : link ? <RefreshCw size={15} /> : <Download size={15} />} {link ? 'Refresh from Zotero' : 'Import'}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Segmented
          value={source}
          onChange={(v) => {
            setSource(v);
            setError('');
          }}
          options={[
            { value: 'local', label: 'Zotero app on this computer', icon: <Monitor size={13} /> },
            { value: 'web', label: 'Zotero online library', icon: <Cloud size={13} /> },
          ]}
        />

        {source === 'local' && (
          <div className="about-card" style={{ margin: 0 }}>
            {busy === 'status' ? <Loader2 size={18} className="spin" /> : ready ? <CheckCircle2 size={18} color="var(--success)" /> : <AlertTriangle size={18} color="var(--warning)" />}
            <div className="grow">
              {!st ? (
                'Checking for Zotero...'
              ) : !st.running ? (
                <>
                  <strong>Zotero is not running.</strong>
                  <div className="muted">Open the Zotero 7 desktop app, then press Check again. Works offline, no account needed.</div>
                </>
              ) : !ready ? (
                <>
                  <strong>Zotero is running but not sharing its library.</strong>
                  <div className="muted">In Zotero open Edit, Settings, Advanced and tick "Allow other applications on this computer to communicate with Zotero".</div>
                </>
              ) : (
                <>
                  <strong>Connected to the Zotero desktop app.</strong>
                  <div className="muted">{st.bbt ? 'Better BibTeX detected: its citation keys will be used.' : 'Tip: install the Better BibTeX plugin for Zotero for stable, readable citation keys.'}</div>
                </>
              )}
            </div>
            <button className="btn btn-sm" onClick={refreshStatus} disabled={!!busy}>
              <RefreshCw size={14} /> Check again
            </button>
          </div>
        )}

        {source === 'web' && (
          <div className="about-card" style={{ margin: 0, alignItems: 'flex-start' }}>
            <KeyRound size={18} color="var(--accent)" style={{ marginTop: 4 }} />
            <div className="grow col" style={{ gap: 8 }}>
              {st && st.web ? (
                <div className="row">
                  <CheckCircle2 size={15} color="var(--success)" />
                  <span className="grow">Connected to zotero.org as user {st.webUserId}.</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => call('zotero:setCreds', '', '').then(refreshStatus)}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <>
                  <div className="muted">
                    Create a read-only key at zotero.org, Settings, Security, and paste your user ID and key below. The key is stored encrypted on this computer.
                  </div>
                  <div className="row">
                    <input className="input" style={{ width: 150 }} placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))} />
                    <input className="input grow" type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                    <button className="btn btn-primary" disabled={!userId || !apiKey || !!busy} onClick={saveCreds}>
                      Connect
                    </button>
                  </div>
                  <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => call('app:openExternal', 'https://www.zotero.org/settings/security')}>
                    <ExternalLink size={13} /> Open zotero.org key settings
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {ready && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Library</label>
              <select className="select" value={`${lib.type}:${lib.id}`} onChange={(e) => setLib(libs.find((l) => `${l.type}:${l.id}` === e.target.value) || libs[0])}>
                {(libs.length ? libs : [lib]).map((l) => (
                  <option key={`${l.type}:${l.id}`} value={`${l.type}:${l.id}`}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Collection</label>
              <select className="select" value={collection} onChange={(e) => setCollection(e.target.value)}>
                <option value="">Whole library</option>
                {cols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {'   '.repeat(c.depth)}
                    {c.name}
                    {c.count != null ? ` (${c.count})` : ''}
                  </option>
                ))}
              </select>
              {collection && cols.some((c) => c.depth > 0) && (
                <label className="check" style={{ fontSize: 12.5 }}>
                  <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} /> Include sub-collections
                </label>
              )}
            </div>
            <div className="field">
              <label>Save as</label>
              <input className="input" list="ft-bib-files" value={file} onChange={(e) => setFile(e.target.value)} />
              <datalist id="ft-bib-files">
                {(index.bibFiles || []).map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>Format</label>
              <Segmented
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'bibtex', label: 'BibTeX' },
                  { value: 'biblatex', label: 'BibLaTeX' },
                ]}
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>If the file already exists</label>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'replace', label: 'Replace it with the Zotero export' },
                  { value: 'merge', label: 'Keep it and add new entries only' },
                ]}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="log-item error" style={{ margin: 0 }}>
            <div className="log-head" style={{ cursor: 'default' }}>
              <AlertTriangle size={15} className="lh-icon" />
              <div className="log-msg selectable">{error}</div>
            </div>
          </div>
        )}

        {done && (
          <div className="log-item" style={{ margin: 0, borderLeftColor: 'var(--success)' }}>
            <div className="log-body" style={{ padding: 12 }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>
                <CheckCircle2 size={15} color="var(--success)" style={{ verticalAlign: '-3px' }} /> {done.total} reference{done.total === 1 ? '' : 's'} saved to {done.file} (via {done.via}).
              </div>
              {!referenced && (
                <div className="muted">
                  Add this to your document so the references can be cited:{' '}
                  <code>{format === 'biblatex' ? `\\addbibresource{${file}}` : `\\bibliography{${fileBase}}`}</code>
                </div>
              )}
              <div className="muted">Cite entries with \cite{'{...}'}. Autocomplete suggests the keys as you type.</div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
