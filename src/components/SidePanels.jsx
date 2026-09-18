import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FilePlus2,
  FolderPlus,
  Upload,
  ChevronDown,
  ChevronRight,
  CaseSensitive,
  Regex,
  WholeWord,
  Search as SearchIcon,
  Replace,
  Check,
  RotateCcw,
  Trash2,
  MessageSquarePlus,
  CornerDownRight,
  X,
} from 'lucide-react';
import { useStore, getState, setState } from '../store';
import { call } from '../lib/api';
import * as A from '../actions';
import * as E from '../editor/controller';
import FileTree, { fileIcon } from './FileTree';
import { confirm, toast, formatDate, initials, colorFor, errorMessage } from '../lib/ui';

export default function Sidebar() {
  const panel = useStore((s) => s.sidebarPanel);
  if (panel === 'search') return <SearchPanel />;
  if (panel === 'review') return <ReviewPanel />;
  return <FilesPanel />;
}

function FilesPanel() {
  const outlineOpen = useStore((s) => s.outlineOpen);
  const [outlineHeight, setOutlineHeight] = useState(260);
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      const panel = document.querySelector('.sidebar');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setOutlineHeight(Math.max(90, Math.min(rect.height - 120, rect.bottom - e.clientY)));
    };
    const up = () => (dragging.current = false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  return (
    <div className="panel-split">
      <div className="panel-section" style={{ flex: 1 }}>
        <div className="panel-header">
          <span className="title">Files</span>
          <button className="icon-btn sm" title="New file" onClick={() => A.newFile(dirOfSelection())}>
            <FilePlus2 size={15} />
          </button>
          <button className="icon-btn sm" title="New folder" onClick={() => A.newFolder(dirOfSelection())}>
            <FolderPlus size={15} />
          </button>
          <button className="icon-btn sm" title="Upload files" onClick={() => A.uploadFiles(dirOfSelection())}>
            <Upload size={15} />
          </button>
        </div>
        <div className="panel-body">
          <FileTree />
        </div>
      </div>
      <div className="panel-section" style={{ height: outlineOpen ? outlineHeight : 40, flex: 'none' }}>
        {outlineOpen && <div style={{ height: 5, cursor: 'row-resize', marginTop: -3 }} onMouseDown={() => (dragging.current = true)} />}
        <div className="panel-header" style={{ cursor: 'pointer' }} onClick={() => setState({ outlineOpen: !getState().outlineOpen })}>
          {outlineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="title">File outline</span>
        </div>
        {outlineOpen && (
          <div className="panel-body">
            <Outline />
          </div>
        )}
      </div>
    </div>
  );
}

function dirOfSelection() {
  const sel = getState().selectedPath;
  if (!sel) return '';
  const node = A.findNode(getState().tree, sel);
  if (node && node.type === 'dir') return sel;
  return sel.includes('/') ? sel.slice(0, sel.lastIndexOf('/')) : '';
}

function Outline() {
  const outline = useStore((s) => s.outline);
  const current = useStore((s) => s.currentSection);
  const openKind = useStore((s) => s.openKind);
  if (openKind !== 'text' || !outline.length) {
    return <div className="empty-note">Sections such as \section{'{...}'} in the open file appear here.</div>;
  }
  const min = Math.min(...outline.map((o) => o.level));
  return (
    <div style={{ paddingBottom: 10 }}>
      {outline.map((o, i) => (
        <div
          key={`${o.line}-${i}`}
          className={`outline-row ${i === current ? 'current' : ''}`}
          style={{ paddingLeft: 8 + (o.level - min) * 14 }}
          onClick={() => E.gotoLine(o.line, 0, true)}
          title={`Line ${o.line}`}
        >
          <span className="ellipsis">{o.title}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ search
function SearchPanel() {
  const project = useStore((s) => s.project);
  const st = useStore((s) => s.searchState);
  const [busy, setBusy] = useState(false);
  const [showReplace, setShowReplace] = useState(!!st.replace);
  const [collapsed, setCollapsed] = useState({});
  const inputRef = useRef(null);
  const set = (patch) => setState({ searchState: { ...getState().searchState, ...patch } });

  useEffect(() => {
    inputRef.current && inputRef.current.focus();
    const sel = E.selectionText();
    if (sel && !sel.includes('\n') && sel.length < 80) set({ query: sel });
  }, []);

  const run = async (q = st.query, opts = st) => {
    if (!q) {
      set({ results: null });
      return;
    }
    setBusy(true);
    await E.saveAll();
    try {
      const r = await call('fs:search', project.id, q, { regex: opts.regex, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord });
      set({ results: r });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => run(), 300);
    return () => clearTimeout(t);
  }, [st.query, st.regex, st.caseSensitive, st.wholeWord]);

  const replaceAll = async () => {
    const r = st.results;
    if (!r || !r.total) return;
    const ok = await confirm({ title: 'Replace all', message: `Replace ${r.total} match${r.total === 1 ? '' : 'es'} in ${r.results.length} file${r.results.length === 1 ? '' : 's'}?`, okLabel: 'Replace all' });
    if (!ok) return;
    await E.saveAll();
    try {
      const res = await call('fs:replaceAll', project.id, st.query, st.replace, { regex: st.regex, caseSensitive: st.caseSensitive, wholeWord: st.wholeWord });
      setState({ forceReload: true });
      await E.reloadChanged(res.changed);
      setState({ forceReload: false });
      toast('success', `Replaced ${res.count} match${res.count === 1 ? '' : 'es'}`, res.changed.join('\n'));
      run();
    } catch (e) {
      toast('error', 'Replace failed', errorMessage(e));
    }
  };

  const highlight = (m) => {
    const { text, col, length } = m;
    const start = Math.max(0, col - 30);
    return (
      <>
        {start > 0 ? '...' : ''}
        {text.slice(start, col)}
        <mark>{text.slice(col, col + length)}</mark>
        {text.slice(col + length, col + length + 120)}
      </>
    );
  };

  return (
    <div className="panel-split">
      <div className="panel-header">
        <span className="title">Search</span>
        <button className={`icon-btn sm ${showReplace ? 'active' : ''}`} title="Toggle replace" onClick={() => setShowReplace(!showReplace)}>
          <Replace size={15} />
        </button>
      </div>
      <div className="search-form">
        <div className="row" style={{ gap: 4 }}>
          <div className="input-icon grow">
            <SearchIcon size={14} />
            <input ref={inputRef} className="input" placeholder="Search in project" value={st.query} onChange={(e) => set({ query: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </div>
        </div>
        {showReplace && (
          <div className="row" style={{ gap: 4 }}>
            <input className="input grow" placeholder="Replace with" value={st.replace} onChange={(e) => set({ replace: e.target.value })} />
            <button className="btn btn-sm" disabled={!st.results || !st.results.total} onClick={replaceAll} title="Replace all">
              All
            </button>
          </div>
        )}
        <div className="row">
          <div className="search-opts">
            <button className={`icon-btn sm ${st.caseSensitive ? 'active' : ''}`} title="Match case" onClick={() => set({ caseSensitive: !st.caseSensitive })}>
              <CaseSensitive size={16} />
            </button>
            <button className={`icon-btn sm ${st.wholeWord ? 'active' : ''}`} title="Whole word" onClick={() => set({ wholeWord: !st.wholeWord })}>
              <WholeWord size={16} />
            </button>
            <button className={`icon-btn sm ${st.regex ? 'active' : ''}`} title="Regular expression" onClick={() => set({ regex: !st.regex })}>
              <Regex size={16} />
            </button>
          </div>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 11.5 }}>
            {busy ? 'Searching...' : st.results ? (st.results.error ? st.results.error : `${st.results.total}${st.results.truncated ? '+' : ''} result${st.results.total === 1 ? '' : 's'}`) : ''}
          </span>
        </div>
      </div>
      <div className="panel-body">
        {st.results &&
          st.results.results.map((f) => (
            <div key={f.file}>
              <div className="search-file" onClick={() => setCollapsed({ ...collapsed, [f.file]: !collapsed[f.file] })}>
                {collapsed[f.file] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                {fileIcon(f.file, 14)}
                <span className="ellipsis grow">{f.file}</span>
                <span className="pill">{f.matches.length}</span>
              </div>
              {!collapsed[f.file] &&
                f.matches.map((m, i) => (
                  <div key={i} className="search-hit" onClick={() => E.jumpTo(f.file, m.line, m.col)} title={`${f.file}:${m.line}`}>
                    <span className="ln">{m.line}</span>
                    {highlight(m)}
                  </div>
                ))}
            </div>
          ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ review / comments
function ReviewPanel() {
  const comments = useStore((s) => s.comments);
  const draft = useStore((s) => s.commentDraft);
  const active = useStore((s) => s.activeComment);
  const openPath = useStore((s) => s.openPath);
  const [scope, setScope] = useState('file');
  const [showResolved, setShowResolved] = useState(false);
  const [text, setText] = useState('');

  const list = useMemo(
    () =>
      comments
        .filter((c) => (scope === 'file' ? c.file === openPath : true))
        .filter((c) => showResolved || !c.resolved)
        .sort((a, b) => (a.file === b.file ? a.from - b.from : a.file.localeCompare(b.file))),
    [comments, scope, showResolved, openPath],
  );

  const focusComment = async (c) => {
    setState({ activeComment: c.id });
    if (E.currentFile() !== c.file) await E.openFile(c.file, { focus: false });
    E.highlightComment(c.id);
    const view = E.getView();
    if (view && c.from >= 0 && c.to <= view.state.doc.length) {
      const { EditorView } = await import('@codemirror/view');
      view.dispatch({ selection: { anchor: c.from, head: c.to }, effects: EditorView.scrollIntoView(c.from, { y: 'center' }) });
    }
  };

  return (
    <div className="panel-split">
      <div className="panel-header">
        <span className="title">Review</span>
        <button className="icon-btn sm" title="Add comment on selection (Ctrl+Shift+C)" onClick={() => A.startComment()}>
          <MessageSquarePlus size={15} />
        </button>
      </div>
      <div className="row" style={{ padding: '0 10px 8px', flexWrap: 'wrap' }}>
        <div className="segmented">
          <button className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')}>
            This file
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All files
          </button>
        </div>
        <label className="check" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Resolved
        </label>
      </div>
      <div className="panel-body">
        {draft && (
          <div className="comment-card active" style={{ cursor: 'default' }}>
            <div className="comment-quote">{draft.quote.slice(0, 160)}</div>
            <textarea
              className="input"
              autoFocus
              placeholder="Write a comment..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  A.saveComment(text);
                  setText('');
                }
              }}
            />
            <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setState({ commentDraft: null })}>
                Cancel
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={!text.trim()}
                onClick={() => {
                  A.saveComment(text);
                  setText('');
                }}
              >
                Comment
              </button>
            </div>
          </div>
        )}
        {!draft && list.length === 0 && (
          <div className="empty-note">
            No comments{scope === 'file' ? ' in this file' : ''}. Select text in the editor and press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> to leave a note for yourself.
          </div>
        )}
        {list.map((c) => (
          <CommentCard key={c.id} c={c} active={active === c.id} showFile={scope === 'all'} onFocus={() => focusComment(c)} />
        ))}
      </div>
    </div>
  );
}

function CommentCard({ c, active, showFile, onFocus }) {
  const [reply, setReply] = useState('');
  const userName = useStore((s) => s.settings.userName);
  const addReply = () => {
    if (!reply.trim()) return;
    A.updateComment(c.id, { replies: [...(c.replies || []), { text: reply.trim(), author: userName, ts: Date.now() }] });
    setReply('');
  };
  return (
    <div className={`comment-card ${active ? 'active' : ''} ${c.resolved ? 'resolved' : ''}`} onClick={onFocus}>
      {showFile && <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>{c.file}</div>}
      <div className="comment-quote">{c.quote.slice(0, 160)}</div>
      <div className="comment-meta">
        <span className="avatar" style={{ background: colorFor(c.author) }}>
          {initials(c.author)}
        </span>
        <strong>{c.author}</strong>
        <span>{formatDate(c.ts)}</span>
        <span className="spacer" />
        <button
          className="icon-btn sm"
          title={c.resolved ? 'Reopen' : 'Resolve'}
          onClick={(e) => {
            e.stopPropagation();
            A.updateComment(c.id, { resolved: !c.resolved });
          }}
        >
          {c.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
        </button>
        <button
          className="icon-btn sm"
          title="Delete"
          onClick={async (e) => {
            e.stopPropagation();
            if (await confirm({ title: 'Delete comment', message: 'Delete this comment and its replies?', okLabel: 'Delete', danger: true })) A.deleteComment(c.id);
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="comment-text">{c.text}</div>
      {(c.replies || []).map((r, i) => (
        <div key={i} className="comment-reply">
          <div className="comment-meta">
            <CornerDownRight size={12} />
            <strong>{r.author}</strong>
            <span>{formatDate(r.ts)}</span>
          </div>
          <div className="comment-text">{r.text}</div>
        </div>
      ))}
      {active && !c.resolved && (
        <div className="row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <input className="input" style={{ height: 28 }} placeholder="Reply..." value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addReply()} />
        </div>
      )}
    </div>
  );
}
