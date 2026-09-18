import { useEffect, useRef, useState } from 'react';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Sigma,
  Omega,
  Link2,
  Hash,
  Quote,
  MessageSquarePlus,
  Image as ImageIcon,
  Table2,
  List,
  ListOrdered,
  Search,
  Code2,
  Eye,
  FileQuestion,
  ExternalLink,
  X,
  MoreHorizontal,
} from 'lucide-react';
import { useStore, setState, getState } from '../store';
import { call } from '../lib/api';
import * as E from '../editor/controller';
import * as A from '../actions';
import { runCommand } from '../commands';
import { SYMBOLS } from '../lib/symbols';
import { Segmented, Menu } from './ui';
import PdfView from './PdfView';

export default function EditorPane() {
  const openKind = useStore((s) => s.openKind);
  const openPath = useStore((s) => s.openPath);
  const showSymbols = useStore((s) => s.showSymbols);
  const hostRef = useRef(null);

  useEffect(() => {
    if (hostRef.current) E.attach(hostRef.current);
    return () => E.detach();
  }, []);

  return (
    <div className="pane grow editor-pane" style={{ flex: 1 }}>
      <EditorToolbar />
      <div className="editor-host" style={{ display: openKind === 'text' ? 'block' : 'none' }} ref={hostRef} />
      {openKind === 'image' && <ImageViewer path={openPath} />}
      {openKind === 'pdf' && <PdfFileViewer path={openPath} />}
      {openKind === 'binary' && <BinaryViewer path={openPath} />}
      {!openKind && (
        <div className="file-viewer">
          <div className="binary-card muted">Choose a file from the file tree to start editing.</div>
        </div>
      )}
      {showSymbols && openKind === 'text' && <SymbolPalette />}
    </div>
  );
}

const LEVELS = [
  ['normal', 'Normal text'],
  ['part', 'Part'],
  ['chapter', 'Chapter'],
  ['section', 'Section'],
  ['subsection', 'Subsection'],
  ['subsubsection', 'Subsubsection'],
  ['paragraph', 'Paragraph'],
];

function EditorToolbar() {
  const mode = useStore((s) => s.editorMode);
  const openKind = useStore((s) => s.openKind);
  const openPath = useStore((s) => s.openPath);
  useStore((s) => s.cursor); // re-render to keep the heading selector in sync
  const showSymbols = useStore((s) => s.showSymbols);
  const disabled = openKind !== 'text';
  const isTex = /\.(tex|ltx)$/i.test(openPath || '');
  const level = disabled ? 'normal' : E.currentSectionLevel();
  const [more, setMore] = useState(null);
  const btn = (title, icon, cmd, active) => (
    <button className={`icon-btn ${active ? 'active' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand(cmd)}>
      {icon}
    </button>
  );
  // Items that collapse into the "More" menu when the pane is narrow (see .tbg-* container queries).
  const overflow = [
    ['Inline math', <Sigma size={14} />, 'insInlineMath', 'b'],
    ['Symbol palette', <Omega size={14} />, 'toggleSymbols', 'b'],
    ['Insert link', <Link2 size={14} />, 'insLink', 'c'],
    ['Insert cross-reference', <Hash size={14} />, 'insRef', 'c'],
    ['Insert citation', <Quote size={14} />, 'insCite', 'c'],
    ['Add comment', <MessageSquarePlus size={14} />, 'addComment', 'c'],
    ['Insert figure', <ImageIcon size={14} />, 'insFigure', 'd'],
    ['Insert table', <Table2 size={14} />, 'insTable', 'd'],
    ['Bulleted list', <List size={14} />, 'insItemize', 'd'],
    ['Numbered list', <ListOrdered size={14} />, 'insEnumerate', 'd'],
  ];

  return (
    <div className="pane-toolbar editor-toolbar">
      <Segmented
        value={mode}
        onChange={(m) => A.setEditorMode(m)}
        options={[
          { value: 'source', label: <span className="seg-label">Code</span>, icon: <Code2 size={13} />, title: 'Code editor' },
          { value: 'visual', label: <span className="seg-label">Visual</span>, icon: <Eye size={13} />, title: 'Visual editor' },
        ]}
      />
      <span className="tb-sep" />
      {btn('Undo (Ctrl+Z)', <Undo2 size={16} />, 'undo')}
      {btn('Redo (Ctrl+Y)', <Redo2 size={16} />, 'redo')}
      {isTex && (
        <>
          <span className="tb-sep" />
          <select className="select tb-select" value={level} disabled={disabled} onChange={(e) => E.setSectionLevel(e.target.value)} title="Heading level" style={{ width: 124 }}>
            {LEVELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <span className="tb-sep" />
          {btn('Bold (Ctrl+B)', <Bold size={16} />, 'bold')}
          {btn('Italic (Ctrl+I)', <Italic size={16} />, 'italic')}
          <span className="tbg tbg-b">
            <span className="tb-sep" />
            {btn('Inline math (Ctrl+Shift+M)', <Sigma size={16} />, 'insInlineMath')}
            {btn('Symbol palette', <Omega size={16} />, 'toggleSymbols', showSymbols)}
          </span>
          <span className="tbg tbg-c">
            <span className="tb-sep" />
            {btn('Insert link', <Link2 size={16} />, 'insLink')}
            {btn('Insert cross-reference', <Hash size={16} />, 'insRef')}
            {btn('Insert citation', <Quote size={16} />, 'insCite')}
            {btn('Add comment (Ctrl+Shift+C)', <MessageSquarePlus size={16} />, 'addComment')}
          </span>
          <span className="tbg tbg-d">
            <span className="tb-sep" />
            {btn('Insert figure', <ImageIcon size={16} />, 'insFigure')}
            {btn('Insert table', <Table2 size={16} />, 'insTable')}
            <span className="tb-sep" />
            {btn('Bulleted list', <List size={16} />, 'insItemize')}
            {btn('Numbered list', <ListOrdered size={16} />, 'insEnumerate')}
          </span>
          <button
            className="icon-btn tb-more"
            title="More formatting and insert options"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              // Only list the groups that are currently hidden.
              const bar = e.currentTarget.parentElement;
              const hidden = new Set(['b', 'c', 'd'].filter((g) => getComputedStyle(bar.querySelector(`.tbg-${g}`)).display === 'none'));
              setMore({ rect: e.currentTarget.getBoundingClientRect(), items: overflow.filter((o) => hidden.has(o[3])).map(([label, icon, cmd]) => ({ label, icon, onClick: () => runCommand(cmd) })) });
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </>
      )}
      <span className="spacer" />
      {btn('Find and replace (Ctrl+F)', <Search size={16} />, 'find')}
      {more && <Menu items={more.items} anchor={more.rect} onClose={() => setMore(null)} />}
    </div>
  );
}

function SymbolPalette() {
  const cats = Object.keys(SYMBOLS);
  const [cat, setCat] = useState(cats[0]);
  const [q, setQ] = useState('');
  const list = q ? Object.values(SYMBOLS).flat().filter(([c]) => c.toLowerCase().includes(q.toLowerCase())) : SYMBOLS[cat];
  return (
    <div className="symbol-palette">
      <div className="symbol-tabs">
        {cats.map((c) => (
          <button key={c} className={!q && c === cat ? 'on' : ''} onClick={() => (setCat(c), setQ(''))}>
            {c}
          </button>
        ))}
        <span className="spacer" />
        <input className="input" style={{ height: 26, width: 150 }} placeholder="Search symbols" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="icon-btn sm" title="Close" onClick={() => setState({ showSymbols: false })}>
          <X size={14} />
        </button>
      </div>
      <div className="symbol-grid">
        {list.map(([cmd, glyph]) => (
          <button
            key={cmd}
            title={cmd}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (cmd.includes('{}')) E.insertTemplate(cmd.replace('{}{}', '{#1}{#2}').replace('{}', '{#}'));
              else E.insertText(/^\\[a-zA-Z]+$/.test(cmd) ? cmd + ' ' : cmd);
            }}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}

function assetUrl(path) {
  const p = getState().project;
  return `ftasset://${p.id}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function ImageViewer({ path }) {
  const [v, setV] = useState(0);
  useEffect(() => setV(Date.now()), [path]);
  return (
    <div className="file-viewer">
      <img src={`${assetUrl(path)}?v=${v}`} alt={path} />
    </div>
  );
}

function PdfFileViewer({ path }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(assetUrl(path))
      .then((r) => r.arrayBuffer())
      .then((b) => alive && setData(new Uint8Array(b)));
    return () => {
      alive = false;
    };
  }, [path]);
  return <div className="pane grow pdf-pane">{data ? <PdfView data={data} version={path} simple /> : null}</div>;
}

function BinaryViewer({ path }) {
  return (
    <div className="file-viewer">
      <div className="binary-card">
        <FileQuestion size={36} color="var(--text-faint)" />
        <div style={{ fontWeight: 650, margin: '10px 0 4px' }}>{path}</div>
        <div className="muted" style={{ marginBottom: 14 }}>This file cannot be edited as text.</div>
        <button className="btn" onClick={async () => call('app:openPath', await call('fs:absPath', getState().project.id, path))}>
          <ExternalLink size={15} /> Open with default app
        </button>
      </div>
    </div>
  );
}
