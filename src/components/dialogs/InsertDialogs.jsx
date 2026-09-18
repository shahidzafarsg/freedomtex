import { useMemo, useState } from 'react';
import { Image as ImageIcon, Table2, Upload } from 'lucide-react';
import { useStore, getState } from '../../store';
import { call } from '../../lib/api';
import * as E from '../../editor/controller';
import * as A from '../../actions';
import { Modal, Segmented } from '../ui';

function slug(s) {
  return s
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// "#" is the template cursor marker and "${" starts a snippet field, so neither can pass through literally.
function escapeTex(s) {
  return s.replace(/#/g, 'No.').replace(/([%&_{}])/g, '\\$1').replace(/\$/g, '\\textdollar{}');
}

export function FigureDialog({ onClose }) {
  const images = useStore((s) => s.index.images || []);
  const project = useStore((s) => s.project);
  const [sel, setSel] = useState(images[0] || '');
  const [width, setWidth] = useState('0.8');
  const [caption, setCaption] = useState('');
  const [label, setLabel] = useState('');

  const upload = async () => {
    const r = await call('dialog:open', { title: 'Choose an image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg'] }] });
    if (r.canceled || !r.filePaths[0]) return;
    const added = await call('fs:upload', project.id, 'figures', r.filePaths);
    await A.refreshIndex();
    await A.refreshTree();
    if (added[0]) setSel(added[0]);
  };

  const insert = () => {
    const lbl = label.trim() || slug(sel.split('/').pop() || 'figure');
    const w = width === '1' ? '\\textwidth' : `${width}\\textwidth`;
    E.insertTemplate(
      `\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=${w}]{${sel || '#1'}}\n\t\\caption{${caption ? escapeTex(caption) : '#2'}}\n\t\\label{fig:${lbl}}\n\\end{figure}\n#`,
    );
    onClose();
  };

  return (
    <Modal
      title="Insert figure"
      icon={<ImageIcon size={18} color="var(--accent)" />}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ marginRight: 'auto', fontSize: 12 }}>
            Needs \usepackage{'{graphicx}'} in the preamble.
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={insert}>
            Insert figure
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="grow">
          <div className="row" style={{ marginBottom: 8 }}>
            <strong className="grow">Choose an image from the project</strong>
            <button className="btn btn-sm" onClick={upload}>
              <Upload size={14} /> Upload from computer
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 280, overflow: 'auto', padding: 2 }}>
            {images.length === 0 && <div className="muted">No images yet. Upload one to add it to the figures folder.</div>}
            {images.map((img) => (
              <button
                key={img}
                onClick={() => setSel(img)}
                className="tpl-card"
                style={{ padding: 0, border: sel === img ? '2px solid var(--accent)' : undefined, textAlign: 'left' }}
                title={img}
              >
                <div style={{ height: 76, display: 'grid', placeItems: 'center', background: 'var(--bg-sunken)' }}>
                  {/\.(png|jpe?g|gif|svg|webp)$/i.test(img) ? (
                    <img src={`ftasset://${project.id}/${img.split('/').map(encodeURIComponent).join('/')}`} alt="" style={{ maxWidth: '100%', maxHeight: 76 }} />
                  ) : (
                    <ImageIcon size={26} color="var(--text-faint)" />
                  )}
                </div>
                <div className="ellipsis" style={{ padding: '5px 7px', fontSize: 11.5 }}>
                  {img}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="col" style={{ width: 250, gap: 12 }}>
          <div className="field">
            <label>Width</label>
            <select className="select" value={width} onChange={(e) => setWidth(e.target.value)}>
              <option value="0.3">30% of text width</option>
              <option value="0.5">50% of text width</option>
              <option value="0.6">60% of text width</option>
              <option value="0.8">80% of text width</option>
              <option value="1">Full text width</option>
            </select>
          </div>
          <div className="field">
            <label>Caption</label>
            <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Describe the figure" />
          </div>
          <div className="field">
            <label>Label</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`fig:${slug((sel || 'figure').split('/').pop())}`} />
            <div className="hint">Refer to it with \ref{'{'}fig:...{'}'}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function TableDialog({ onClose }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [hover, setHover] = useState(null);
  const [style, setStyle] = useState('booktabs');
  const [align, setAlign] = useState('c');
  const [header, setHeader] = useState(true);
  const [caption, setCaption] = useState('');
  const [label, setLabel] = useState('');

  const preview = hover || { r: rows, c: cols };

  const insert = () => {
    const spec = style === 'grid' ? `|${Array(cols).fill(align).join('|')}|` : Array(cols).fill(align).join(' ');
    const lines = [];
    const cell = (r, c) => (header && r === 0 ? `Column ${c + 1}` : r === (header ? 1 : 0) && c === 0 ? '#' : '');
    if (style === 'booktabs') lines.push('\\toprule');
    if (style === 'grid') lines.push('\\hline');
    for (let r = 0; r < rows; r++) {
      const cells = Array.from({ length: cols }, (_, c) => cell(r, c));
      lines.push(`${header && r === 0 ? cells.map((x) => `\\textbf{${x}}`).join(' & ') : cells.join(' & ')} \\\\`);
      if (header && r === 0 && style === 'booktabs') lines.push('\\midrule');
      if (style === 'grid') lines.push('\\hline');
    }
    if (style === 'booktabs') lines.push('\\bottomrule');
    const lbl = label.trim() || 'my-table';
    const body = lines.map((l) => `\t\t${l}`).join('\n');
    E.insertTemplate(
      `\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${caption ? escapeTex(caption) : 'Table caption'}}\n\t\\label{tab:${lbl}}\n\t\\begin{tabular}{${spec}}\n${body}\n\t\\end{tabular}\n\\end{table}\n`,
    );
    onClose();
  };

  return (
    <Modal
      title="Insert table"
      icon={<Table2 size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          {style === 'booktabs' && (
            <span className="faint" style={{ marginRight: 'auto', fontSize: 12 }}>
              Needs \usepackage{'{booktabs}'}.
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={insert}>
            Insert {rows} × {cols} table
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>
            Size: {preview.r} rows × {preview.c} columns
          </div>
          <div className="grid-picker" style={{ gridTemplateColumns: 'repeat(8, 20px)' }} onMouseLeave={() => setHover(null)}>
            {Array.from({ length: 64 }, (_, i) => {
              const r = Math.floor(i / 8) + 1;
              const c = (i % 8) + 1;
              return (
                <span
                  key={i}
                  className={r <= preview.r && c <= preview.c ? 'on' : ''}
                  onMouseEnter={() => setHover({ r, c })}
                  onClick={() => {
                    setRows(r);
                    setCols(c);
                  }}
                />
              );
            })}
          </div>
        </div>
        <div className="col grow" style={{ gap: 12 }}>
          <div className="field">
            <label>Style</label>
            <Segmented
              value={style}
              onChange={setStyle}
              options={[
                { value: 'booktabs', label: 'Professional' },
                { value: 'grid', label: 'Grid lines' },
                { value: 'plain', label: 'Plain' },
              ]}
            />
          </div>
          <div className="field">
            <label>Column alignment</label>
            <Segmented
              value={align}
              onChange={setAlign}
              options={[
                { value: 'l', label: 'Left' },
                { value: 'c', label: 'Center' },
                { value: 'r', label: 'Right' },
              ]}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Header row
          </label>
          <div className="field">
            <label>Caption</label>
            <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Table caption" />
          </div>
          <div className="field">
            <label>Label</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="tab:my-table" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
