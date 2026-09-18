import { useEffect, useRef, useState } from 'react';
import { FolderTree, Search, MessageSquare, History, Settings, LayoutGrid, ChevronRight, ChevronLeft, Hash } from 'lucide-react';
import { useStore, setState, getState } from '../store';
import * as A from '../actions';
import { openDialog } from '../lib/ui';
import Sidebar from './SidePanels';
import EditorPane from './EditorPane';
import PdfPane from './PdfPane';
import HistoryView from './HistoryView';

export default function Workspace() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const historyOpen = useStore((s) => s.historyOpen);
  const settings = useStore((s) => s.settings);
  const [width, setWidth] = useState(settings.sidebarWidth || 260);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => setWidth(Math.max(180, Math.min(520, e.clientX - 48)));
    const up = () => {
      setDragging(false);
      A.updateSettings({ sidebarWidth: widthRef.current });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);
  const widthRef = useRef(width);
  widthRef.current = width;

  return (
    <div className="workspace">
      <Rail />
      {sidebarOpen && !historyOpen && (
        <aside className="sidebar" style={{ width }}>
          <Sidebar />
          <div className={`sidebar-resizer ${dragging ? 'dragging' : ''}`} onMouseDown={() => setDragging(true)} />
        </aside>
      )}
      {historyOpen && <HistoryView />}
      {/* Keep the editor and PDF mounted while History is open so positions are preserved. */}
      <div style={{ display: historyOpen ? 'none' : 'flex', flex: 1, minWidth: 0 }}>
        <Split />
      </div>
      {dragging && <div className="drag-shield" />}
    </div>
  );
}

function Rail() {
  const panel = useStore((s) => s.sidebarPanel);
  const open = useStore((s) => s.sidebarOpen);
  const historyOpen = useStore((s) => s.historyOpen);
  const comments = useStore((s) => s.comments);
  const openCount = comments.filter((c) => !c.resolved).length;
  const pick = (p) => {
    if (historyOpen) setState({ historyOpen: false, sidebarOpen: true, sidebarPanel: p });
    else if (open && panel === p) setState({ sidebarOpen: false });
    else setState({ sidebarOpen: true, sidebarPanel: p });
  };
  const is = (p) => !historyOpen && open && panel === p;
  return (
    <nav className="rail">
      <button className="icon-btn" title="All projects" onClick={() => A.closeProject()}>
        <LayoutGrid size={19} />
      </button>
      <div style={{ height: 1, width: 24, background: 'var(--border)', margin: '4px 0' }} />
      <button className={`icon-btn ${is('files') ? 'active' : ''}`} title="File tree (Ctrl+Shift+E)" onClick={() => pick('files')}>
        <FolderTree size={19} />
      </button>
      <button className={`icon-btn ${is('search') ? 'active' : ''}`} title="Search in project (Ctrl+Shift+F)" onClick={() => pick('search')}>
        <Search size={19} />
      </button>
      <button className={`icon-btn ${is('review') ? 'active' : ''}`} title="Review and comments" onClick={() => pick('review')}>
        <MessageSquare size={19} />
        {openCount > 0 && <span className="badge" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{openCount}</span>}
      </button>
      <button className={`icon-btn ${historyOpen ? 'active' : ''}`} title="History and versions (Ctrl+Shift+H)" onClick={() => setState({ historyOpen: !historyOpen })}>
        <History size={19} />
      </button>
      <button className="icon-btn" title="Word count" onClick={() => openDialog('wordCount')}>
        <Hash size={19} />
      </button>
      <span className="spacer" />
      <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => openDialog('settings')}>
        <Settings size={19} />
      </button>
    </nav>
  );
}

function Split() {
  const layout = useStore((s) => s.settings.layout || 'split');
  const ratio0 = useStore((s) => s.settings.splitRatio || 0.5);
  const openKind = useStore((s) => s.openKind);
  const [ratio, setRatio] = useState(ratio0);
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      const r = ref.current.getBoundingClientRect();
      setRatio(Math.max(0.2, Math.min(0.8, (e.clientX - r.left) / r.width)));
    };
    const up = () => {
      setDragging(false);
      A.updateSettings({ splitRatio: ratioRef.current });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  const showEditor = layout !== 'pdf';
  const showPdf = layout !== 'editor';

  return (
    <div className="split" ref={ref}>
      <div style={{ display: showEditor ? 'flex' : 'none', width: showPdf ? `${ratio * 100}%` : '100%', minWidth: 0 }}>
        <EditorPane />
      </div>
      {showEditor && showPdf && (
        <div className={`splitter ${dragging ? 'dragging' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && setDragging(true)} onDoubleClick={() => setRatio(0.5)}>
          <button className="sync-btn" title="Go to the matching place in the PDF (Ctrl+Alt+Right)" disabled={openKind !== 'text'} onClick={() => A.syncToPdf()}>
            <ChevronRight size={15} />
          </button>
          <button className="sync-btn" title="Go to the code for the middle of the PDF view" onClick={() => A.syncFromPdfCenter()}>
            <ChevronLeft size={15} />
          </button>
        </div>
      )}
      <div style={{ display: showPdf ? 'flex' : 'none', flex: 1, minWidth: 0 }}>
        <PdfPane />
      </div>
      {dragging && <div className="drag-shield" />}
    </div>
  );
}
