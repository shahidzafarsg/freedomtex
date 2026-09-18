import { useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  FileCode2,
  BookMarked,
  Image as ImageIcon,
  File,
  FileType2,
  FilePlus2,
  FolderPlus,
  Upload,
  Pencil,
  Trash2,
  Star,
  Download,
  ExternalLink,
} from 'lucide-react';
import { useStore, getState, setState } from '../store';
import { call, pathForFile } from '../lib/api';
import * as A from '../actions';
import * as E from '../editor/controller';
import { Menu } from './ui';
import { revealLabel } from '../lib/platform';

export function fileIcon(name, size = 15) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'tex' || ext === 'ltx') return <FileText size={size} color="var(--accent)" />;
  if (ext === 'bib') return <BookMarked size={size} color="#d97706" />;
  if (['sty', 'cls', 'bst', 'cfg', 'def', 'clo', 'bbx', 'cbx'].includes(ext)) return <FileCode2 size={size} color="#7c3aed" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'eps', 'webp'].includes(ext)) return <ImageIcon size={size} color="#0284c7" />;
  if (ext === 'pdf') return <FileType2 size={size} color="#dc2626" />;
  return <File size={size} color="var(--text-faint)" />;
}

export default function FileTree() {
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  const selected = useStore((s) => s.selectedPath);
  const openPath = useStore((s) => s.openPath);
  const dirty = useStore((s) => s.dirty);
  const mainFile = useStore((s) => s.project && s.project.mainFile);
  const [menu, setMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [osDrag, setOsDrag] = useState(false);

  const toggle = (path) => setState({ expanded: { ...getState().expanded, [path]: !getState().expanded[path] } });

  const fileMenu = (node, at) => {
    const isTex = /\.(tex|ltx)$/i.test(node.name);
    const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
    setMenu({
      at,
      items: [
        ...(node.type === 'dir'
          ? [
              { label: 'New File...', icon: <FilePlus2 size={14} />, onClick: () => A.newFile(node.path) },
              { label: 'New Folder...', icon: <FolderPlus size={14} />, onClick: () => A.newFolder(node.path) },
              { label: 'Upload Files...', icon: <Upload size={14} />, onClick: () => A.uploadFiles(node.path) },
              { separator: true },
            ]
          : [
              { label: 'Open', icon: fileIcon(node.name, 14), onClick: () => E.openFile(node.path) },
              ...(isTex ? [{ label: 'Set as Main Document', icon: <Star size={14} />, disabled: node.path === mainFile, onClick: () => A.setMainFile(node.path) }] : []),
              { label: 'Download...', icon: <Download size={14} />, onClick: () => call('fs:exportFile', getState().project.id, node.path) },
              { separator: true },
              { label: 'New File Here...', icon: <FilePlus2 size={14} />, onClick: () => A.newFile(dir) },
            ]),
        { label: 'Rename...', icon: <Pencil size={14} />, onClick: () => A.renamePath(node.path) },
        { label: 'Delete', icon: <Trash2 size={14} />, onClick: () => A.deletePath(node.path) },
        { separator: true },
        {
          label: revealLabel,
          icon: <ExternalLink size={14} />,
          onClick: async () => call('app:showItem', await call('fs:absPath', getState().project.id, node.path)),
        },
      ],
    });
  };

  const onDrop = async (e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    setOsDrag(false);
    const internal = e.dataTransfer.getData('application/x-ft-path');
    if (internal) {
      const name = internal.split('/').pop();
      const to = targetDir ? `${targetDir}/${name}` : name;
      if (to !== internal && !targetDir.startsWith(internal + '/')) A.movePath(internal, to);
      return;
    }
    const files = [...e.dataTransfer.files].map((f) => pathForFile(f)).filter(Boolean);
    if (files.length) A.uploadFiles(targetDir, files);
  };

  const renderNodes = (nodes, depth) =>
    nodes.map((n) => {
      const isDir = n.type === 'dir';
      const open = isDir && expanded[n.path];
      return (
        <div key={n.path}>
          <div
            className={`tree-row ${selected === n.path ? 'selected' : ''} ${openPath === n.path ? 'open' : ''} ${dropTarget === n.path ? 'drop-target' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-ft-path', n.path);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!isDir) return;
              e.preventDefault();
              e.stopPropagation();
              setDropTarget(n.path);
            }}
            onDragLeave={() => setDropTarget((t) => (t === n.path ? null : t))}
            onDrop={(e) => isDir && onDrop(e, n.path)}
            onClick={() => {
              setState({ selectedPath: n.path });
              if (isDir) toggle(n.path);
              else E.openFile(n.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setState({ selectedPath: n.path });
              fileMenu(n, { x: e.clientX, y: e.clientY });
            }}
            title={n.path}
          >
            {isDir ? <ChevronRight size={14} className={`chev ${open ? 'open' : ''}`} /> : <span style={{ width: 14, flex: 'none' }} />}
            <span className="ficon">{isDir ? open ? <FolderOpen size={15} color="#d9a441" /> : <Folder size={15} color="#d9a441" /> : fileIcon(n.name)}</span>
            <span className="fname">{n.name}</span>
            {n.path === mainFile && <span className="main-badge" title="Main document">MAIN</span>}
            {dirty[n.path] && <span className="dirty-dot" title="Unsaved changes" />}
          </div>
          {open && n.children && renderNodes(n.children, depth + 1)}
        </div>
      );
    });

  return (
    <div
      className="tree"
      style={{ position: 'relative', minHeight: '100%' }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({
          at: { x: e.clientX, y: e.clientY },
          items: [
            { label: 'New File...', icon: <FilePlus2 size={14} />, onClick: () => A.newFile('') },
            { label: 'New Folder...', icon: <FolderPlus size={14} />, onClick: () => A.newFolder('') },
            { label: 'Upload Files...', icon: <Upload size={14} />, onClick: () => A.uploadFiles('') },
          ],
        });
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setOsDrag(true);
        setDropTarget('');
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOsDrag(false);
          setDropTarget(null);
        }
      }}
      onDrop={(e) => onDrop(e, '')}
    >
      {renderNodes(tree, 0)}
      {tree.length === 0 && <div className="empty-note">This project has no files yet.</div>}
      {osDrag && <div className="drop-overlay">Drop files to upload</div>}
      {menu && <Menu items={menu.items} at={menu.at} onClose={() => setMenu(null)} />}
    </div>
  );
}
