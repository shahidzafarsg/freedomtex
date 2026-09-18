import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { X, Tag, RotateCcw, FileClock, History as HistoryIcon, Plus, Save } from 'lucide-react';
import { useStore, setState, getState } from '../store';
import { call } from '../lib/api';
import { prompt, confirm, toast, errorMessage } from '../lib/ui';
import * as E from '../editor/controller';
import * as A from '../actions';
import { fileIcon } from './FileTree';

const REASONS = { auto: 'Auto-saved', open: 'Project opened', close: 'Project closed', 'before-restore': 'Before restore', restore: 'Restored an earlier version', manual: 'Saved version' };

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HistoryView() {
  const project = useStore((s) => s.project);
  const [versions, setVersions] = useState([]);
  const [sel, setSel] = useState(null);
  const [files, setFiles] = useState([]);
  const [file, setFile] = useState(null);
  const [compare, setCompare] = useState('previous'); // previous | current
  const [diff, setDiff] = useState(null);
  const [onlyLabels, setOnlyLabels] = useState(false);

  const load = async (selectId) => {
    await E.saveAll();
    await call('history:snapshot', project.id, { reason: 'auto' }).catch(() => {});
    const list = await call('history:list', project.id);
    setVersions(list);
    const pick = list.find((v) => v.id === selectId) || list[0];
    if (pick) setSel(pick.id);
  };

  useEffect(() => {
    load();
  }, [project.id]);

  const version = versions.find((v) => v.id === sel);

  useEffect(() => {
    if (!sel) return;
    call('history:files', project.id, sel).then((f) => {
      const v = versions.find((x) => x.id === sel);
      const removed = v ? v.changes.removed : [];
      setFiles([...f, ...removed.filter((r) => !f.includes(r))]);
      const changed = v ? [...v.changes.modified, ...v.changes.added] : [];
      const textFirst = changed.find((c) => /\.(tex|bib|sty|cls|txt|md)$/i.test(c)) || changed[0];
      setFile((cur) => (cur && f.includes(cur) && !changed.length ? cur : textFirst || f.find((x) => x === project.mainFile) || f[0]));
    });
  }, [sel, versions]);

  useEffect(() => {
    if (!sel || !file) {
      setDiff(null);
      return;
    }
    let alive = true;
    (async () => {
      const now = await call('history:file', project.id, sel, file);
      let base;
      if (compare === 'current') {
        const r = await call('fs:read', project.id, file).catch(() => null);
        base = r && r.kind === 'text' ? { binary: false, content: r.content } : r ? { binary: true } : null;
      } else {
        base = await call('history:prevFile', project.id, sel, file);
      }
      if (!alive) return;
      if ((now && now.binary) || (base && base.binary)) setDiff({ binary: true });
      else {
        const a = compare === 'current' ? (now ? now.content : '') : base ? base.content : '';
        const b = compare === 'current' ? (base ? base.content : '') : now ? now.content : '';
        setDiff({ parts: diffLines(a, b), deleted: !now, added: !base });
      }
    })();
    return () => {
      alive = false;
    };
  }, [sel, file, compare]);

  const grouped = useMemo(() => {
    const out = [];
    let day = null;
    for (const v of versions) {
      if (onlyLabels && !(v.labels && v.labels.length)) continue;
      const d = dayLabel(v.ts);
      if (d !== day) {
        out.push({ day: d });
        day = d;
      }
      out.push(v);
    }
    return out;
  }, [versions, onlyLabels]);

  const addLabel = async () => {
    if (!version) return;
    const text = await prompt({ title: 'Label this version', label: 'Label', placeholder: 'e.g. Submitted draft to supervisor', okLabel: 'Add label' });
    if (!text) return;
    await call('history:label', project.id, version.id, text);
    load(version.id);
  };

  const saveNamed = async () => {
    const text = await prompt({ title: 'Save a named version', label: 'Label', placeholder: 'e.g. Chapter 2 complete', okLabel: 'Save version' });
    if (!text) return;
    await E.saveAll();
    await call('history:snapshot', project.id, { label: text, reason: 'manual' });
    load();
  };

  const afterRestore = async (paths) => {
    setState({ forceReload: true });
    await E.reloadChanged(paths);
    setState({ forceReload: false });
    await A.refreshTree();
    A.compile();
  };

  const restoreFile = async () => {
    const ok = await confirm({ title: 'Restore file', message: `Replace the current "${file}" with the version from ${new Date(version.ts).toLocaleString()}? The current state is saved in history first.`, okLabel: 'Restore file' });
    if (!ok) return;
    try {
      await E.saveAll();
      await call('history:restoreFile', project.id, version.id, file);
      toast('success', 'File restored', file);
      await afterRestore([file]);
      load(version.id);
    } catch (e) {
      toast('error', 'Restore failed', errorMessage(e));
    }
  };

  const restoreAll = async () => {
    const ok = await confirm({ title: 'Restore this version', message: `Restore every file to how it was on ${new Date(version.ts).toLocaleString()}? Files added later are kept. The current state is saved in history first.`, okLabel: 'Restore version' });
    if (!ok) return;
    try {
      await E.saveAll();
      await call('history:restoreVersion', project.id, version.id);
      toast('success', 'Version restored', new Date(version.ts).toLocaleString());
      await afterRestore(await call('history:files', project.id, version.id));
      load();
    } catch (e) {
      toast('error', 'Restore failed', errorMessage(e));
    }
  };

  const changeKind = (f) => {
    if (!version) return null;
    if (version.changes.added.includes(f)) return ['added', 'A'];
    if (version.changes.modified.includes(f)) return ['modified', 'M'];
    if (version.changes.removed.includes(f)) return ['removed', 'D'];
    return null;
  };

  return (
    <div className="history">
      <div className="history-files">
        <div className="panel-header">
          <span className="title">Files in version</span>
        </div>
        <div className="panel-body">
          {files.map((f) => {
            const k = changeKind(f);
            return (
              <div key={f} className={`tree-row ${file === f ? 'open' : ''}`} style={{ paddingLeft: 10 }} onClick={() => setFile(f)} title={f}>
                {fileIcon(f)}
                <span className="fname">{f}</span>
                {k && <span className={`file-change ${k[0]}`}>{k[1]}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="history-diff">
        <div className="pane-toolbar">
          <FileClock size={16} color="var(--accent)" />
          <strong className="ellipsis" style={{ marginLeft: 6 }}>
            {file || 'Select a file'}
          </strong>
          <span className="spacer" />
          <div className="segmented">
            <button className={compare === 'previous' ? 'on' : ''} onClick={() => setCompare('previous')} title="Show what changed in this version">
              Changes in version
            </button>
            <button className={compare === 'current' ? 'on' : ''} onClick={() => setCompare('current')} title="Compare this version with the file as it is now">
              Compare to now
            </button>
          </div>
          <span className="tb-sep" />
          <button className="btn btn-sm" disabled={!version || !file} onClick={restoreFile}>
            <RotateCcw size={14} /> Restore file
          </button>
          <button className="btn btn-sm btn-primary" disabled={!version} onClick={restoreAll}>
            <RotateCcw size={14} /> Restore version
          </button>
        </div>
        <DiffView diff={diff} />
      </div>

      <div className="history-versions">
        <div className="panel-header">
          <HistoryIcon size={14} />
          <span className="title">History</span>
          <button className="icon-btn sm" title="Save a named version now" onClick={saveNamed}>
            <Save size={15} />
          </button>
          <button className="icon-btn sm" title="Back to editor" onClick={() => setState({ historyOpen: false })}>
            <X size={16} />
          </button>
        </div>
        <div className="row" style={{ padding: '0 12px 8px' }}>
          <div className="segmented">
            <button className={!onlyLabels ? 'on' : ''} onClick={() => setOnlyLabels(false)}>
              All versions
            </button>
            <button className={onlyLabels ? 'on' : ''} onClick={() => setOnlyLabels(true)}>
              Labels only
            </button>
          </div>
        </div>
        <div className="panel-body">
          {grouped.length === 0 && <div className="empty-note">No versions yet. FreedomTex saves a version automatically every few minutes while you work.</div>}
          {grouped.map((v, i) =>
            v.day ? (
              <div key={`d${i}`} className="version-day">
                {v.day}
              </div>
            ) : (
              <div key={v.id} className={`version-item ${sel === v.id ? 'selected' : ''}`} onClick={() => setSel(v.id)}>
                <div className="row">
                  <span className="version-when grow">{new Date(v.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {sel === v.id && (
                    <button className="icon-btn sm" title="Add label" onClick={(e) => (e.stopPropagation(), addLabel())}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="version-sub">
                  {REASONS[v.reason] || 'Saved'}
                  {v.author ? ` by ${v.author}` : ''}
                </div>
                <div className="version-sub">
                  {[v.changes.modified.length && `${v.changes.modified.length} edited`, v.changes.added.length && `${v.changes.added.length} added`, v.changes.removed.length && `${v.changes.removed.length} removed`]
                    .filter(Boolean)
                    .join(', ') || 'No file changes'}
                </div>
                {(v.labels || []).map((l) => (
                  <span key={l.id} className="label-chip">
                    <Tag size={11} /> {l.text}
                    <X
                      size={11}
                      style={{ cursor: 'pointer' }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await call('history:unlabel', project.id, v.id, l.id);
                        load(v.id);
                      }}
                    />
                  </span>
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function DiffView({ diff }) {
  if (!diff) return <div className="diff-view" />;
  if (diff.binary) return <div className="empty-note" style={{ paddingTop: 40 }}>This is a binary file (such as an image), so no text comparison is shown.</div>;
  const rows = [];
  let oldNo = 1;
  let newNo = 1;
  const parts = diff.parts;
  const changed = parts.some((p) => p.added || p.removed);
  parts.forEach((p, pi) => {
    const lines = p.value.replace(/\n$/, '').split('\n');
    if (!p.added && !p.removed && changed && lines.length > 8) {
      const head = pi === 0 ? [] : lines.slice(0, 3);
      const tail = pi === parts.length - 1 ? [] : lines.slice(-3);
      head.forEach((l) => rows.push({ t: ' ', l, n: newNo++, o: oldNo++ }));
      const skipped = lines.length - head.length - tail.length;
      if (skipped > 0) {
        rows.push({ fold: skipped });
        newNo += skipped;
        oldNo += skipped;
      }
      tail.forEach((l) => rows.push({ t: ' ', l, n: newNo++, o: oldNo++ }));
      return;
    }
    for (const l of lines) {
      if (p.added) rows.push({ t: '+', l, n: newNo++ });
      else if (p.removed) rows.push({ t: '-', l, o: oldNo++ });
      else rows.push({ t: ' ', l, n: newNo++, o: oldNo++ });
    }
  });
  return (
    <div className="diff-view">
      {!changed && <div className="diff-fold">No changes in this file.</div>}
      {rows.map((r, i) =>
        r.fold ? (
          <div key={i} className="diff-fold">
            {r.fold} unchanged line{r.fold === 1 ? '' : 's'}
          </div>
        ) : (
          <div key={i} className={`diff-line ${r.t === '+' ? 'add' : r.t === '-' ? 'del' : ''}`}>
            <span className="dl-no">{r.t === '-' ? r.o : r.n}</span>
            <span className="dl-sign">{r.t === ' ' ? '' : r.t}</span>
            <span>{r.l || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}
