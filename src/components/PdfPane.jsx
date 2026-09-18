import { useEffect, useRef, useState } from 'react';
import {
  Play,
  ChevronDown,
  Loader2,
  Square,
  FileText,
  Download,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  AlertTriangle,
  Info,
  PackageOpen,
  ChevronRight,
  ExternalLink,
  MoreVertical,
  FileWarning,
  CheckCircle2,
  Trash2,
  ScrollText,
  FolderOpen,
} from 'lucide-react';
import { useStore, getState, setState } from '../store';
import { call } from '../lib/api';
import * as A from '../actions';
import * as E from '../editor/controller';
import { openDialog } from '../lib/ui';
import { hintFor } from '../lib/logHints';
import { Menu, EmptyState } from './ui';
import PdfView from './PdfView';

const ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 4];

export default function PdfPane() {
  const pdf = useStore((s) => s.pdf);
  const compile = useStore((s) => s.compile);
  const issues = useStore((s) => s.issues);
  const tab = useStore((s) => s.pdfTab);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.project);
  const syncTarget = useStore((s) => s.syncTarget);
  const [zoom, setZoom] = useState(settings.pdfZoom || 'page-width');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1);
  const [menu, setMenu] = useState(null);
  const viewRef = useRef(null);

  useEffect(() => setPageInput(String(page)), [page]);

  const changeZoom = (z) => {
    setZoom(z);
    A.updateSettings({ pdfZoom: z });
  };
  const stepZoom = (factor) => {
    const next = Math.max(0.25, Math.min(5, +(scale * factor).toFixed(2)));
    changeZoom(next);
  };

  const errors = issues.errors.length;
  const warnings = issues.warnings.length + issues.typesetting.length;

  const compileMenu = (rect) =>
    setMenu({
      anchor: rect,
      items: [
        { heading: 'Auto compile' },
        { label: 'On', checked: settings.autoCompile, onClick: () => A.updateSettings({ autoCompile: true }) },
        { label: 'Off', checked: !settings.autoCompile, onClick: () => A.updateSettings({ autoCompile: false }) },
        { separator: true },
        { heading: 'Compile mode' },
        { label: 'Normal', checked: !project.draft, onClick: () => A.updateProject({ draft: false }) },
        { label: 'Fast (draft, images as boxes)', checked: !!project.draft, onClick: () => A.updateProject({ draft: true }).then(() => A.compile()) },
        { separator: true },
        { heading: 'Compile error handling' },
        { label: 'Try compiling despite errors', checked: !project.haltOnError, onClick: () => A.updateProject({ haltOnError: false }) },
        { label: 'Stop on first error', checked: !!project.haltOnError, onClick: () => A.updateProject({ haltOnError: true }) },
        { separator: true },
        {
          label: 'Compiler',
          items: [
            ['pdflatex', 'pdfLaTeX'],
            ['xelatex', 'XeLaTeX'],
            ['lualatex', 'LuaLaTeX'],
          ].map(([v, l]) => ({ label: l, checked: project.compiler === v, onClick: () => A.updateProject({ compiler: v }).then(() => A.compile()) })),
        },
        { separator: true },
        { label: 'Stop compilation', disabled: !compile.running, onClick: () => A.stopCompile() },
        { label: 'Recompile from scratch', onClick: () => A.compile({ fromScratch: true }) },
        { label: 'Clear cached files', onClick: () => A.clearCache() },
      ],
    });

  const moreMenu = (rect) =>
    setMenu({
      anchor: rect,
      align: 'right',
      items: [
        { label: 'Open in external PDF viewer', icon: <ExternalLink size={14} />, onClick: () => call('compile:openPdfExternal', project.id) },
        { label: 'Show output folder', icon: <FolderOpen size={14} />, onClick: () => call('compile:openOutputDir', project.id) },
        { separator: true },
        { label: 'Dark PDF background', checked: settings.pdfDarkMode, onClick: () => A.updateSettings({ pdfDarkMode: !settings.pdfDarkMode }) },
        { label: 'Double-click the PDF to jump to the source', disabled: true },
      ],
    });

  return (
    <div className="pane pdf-pane" style={{ flex: 1 }}>
      <div className="pane-toolbar">
        <div className="btn-split">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => (compile.running ? A.stopCompile() : A.compile())}
            title={compile.running ? 'Stop compiling' : 'Recompile (Ctrl+Enter)'}
            style={{ minWidth: 112 }}
          >
            {compile.running ? <Loader2 size={15} className="spin" /> : <Play size={14} fill="currentColor" />}
            {compile.running ? 'Compiling...' : 'Recompile'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={(e) => compileMenu(e.currentTarget.getBoundingClientRect())} title="Compile options">
            <ChevronDown size={14} />
          </button>
        </div>
        {compile.running && (
          <button className="icon-btn sm" title="Stop compilation" onClick={() => A.stopCompile()}>
            <Square size={13} fill="currentColor" />
          </button>
        )}
        <button className={`icon-btn ${tab === 'logs' ? 'active' : ''}`} title="Logs and errors (Ctrl+J)" onClick={() => setState({ pdfTab: tab === 'logs' ? 'pdf' : 'logs' })}>
          <ScrollText size={16} />
          {errors > 0 ? <span className="badge">{errors}</span> : warnings > 0 ? <span className="badge" style={{ background: 'var(--warning)' }}>{warnings > 99 ? '99+' : warnings}</span> : null}
        </button>
        <button className="icon-btn" title="Download PDF" disabled={!pdf.data} onClick={() => A.downloadPdf()}>
          <Download size={16} />
        </button>
        <span className="spacer" />
        {tab === 'pdf' && pdf.data && (
          <>
            <input
              className="input page-input"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') viewRef.current && viewRef.current.goToPage(Math.max(1, Math.min(pages, Number(pageInput) || 1)));
              }}
              title="Page number"
            />
            <span className="muted" style={{ fontSize: 12, margin: '0 6px 0 4px' }}>
              / {pages}
            </span>
            <span className="tb-sep" />
            <button className="icon-btn sm" title="Zoom out" onClick={() => stepZoom(1 / 1.15)}>
              <ZoomOut size={15} />
            </button>
            <select
              className="select tb-select"
              style={{ width: 96 }}
              value={typeof zoom === 'string' ? zoom : 'custom'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'custom') return;
                changeZoom(v === 'page-width' || v === 'page-fit' ? v : Number(v));
              }}
            >
              <option value="page-width">Fit width</option>
              <option value="page-fit">Fit page</option>
              {typeof zoom === 'number' && <option value="custom">{Math.round(scale * 100)}%</option>}
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
            <button className="icon-btn sm" title="Zoom in" onClick={() => stepZoom(1.15)}>
              <ZoomIn size={15} />
            </button>
          </>
        )}
        <button className="icon-btn sm" title="More" onClick={(e) => moreMenu(e.currentTarget.getBoundingClientRect())}>
          <MoreVertical size={15} />
        </button>
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {compile.running && <div className="compiling-bar" />}
        <div style={{ display: tab === 'pdf' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          {pdf.data ? (
            <PdfView
              ref={viewRef}
              data={pdf.data}
              version={pdf.version}
              zoom={zoom}
              dark={settings.pdfDarkMode}
              syncTarget={syncTarget}
              onPages={setPages}
              onPage={setPage}
              onScale={setScale}
              onZoomRequest={stepZoom}
              onDoubleClick={(p, x, y) => A.syncFromPdf(p, x, y)}
            />
          ) : (
            <EmptyState icon={compile.running ? <Loader2 size={28} className="spin" /> : <FileText size={28} />} title={compile.running ? 'Compiling your document...' : 'No PDF yet'}>
              {compile.running ? 'The first compile can take a little longer.' : compile.status === 'failure' ? 'The last compile did not produce a PDF. Open the logs to see why.' : 'Press Recompile (Ctrl+Enter) to build your PDF.'}
              {!compile.running && compile.status === 'failure' && (
                <div style={{ marginTop: 14 }}>
                  <button className="btn" onClick={() => setState({ pdfTab: 'logs' })}>
                    <ScrollText size={15} /> View logs
                  </button>
                </div>
              )}
            </EmptyState>
          )}
        </div>
        {tab === 'logs' && <LogsPanel />}
      </div>
      {menu && <Menu items={menu.items} anchor={menu.anchor} align={menu.align} onClose={() => setMenu(null)} />}
    </div>
  );
}

function LogsPanel() {
  const compile = useStore((s) => s.compile);
  const issues = useStore((s) => s.issues);
  const project = useStore((s) => s.project);
  const [showRaw, setShowRaw] = useState(false);
  const [outputs, setOutputs] = useState(null);
  const res = compile.result;
  const rawRef = useRef(null);

  useEffect(() => {
    if (compile.running && rawRef.current) rawRef.current.scrollTop = rawRef.current.scrollHeight;
  }, [compile.liveLog, compile.running]);

  const all = [...issues.errors, ...issues.warnings, ...issues.typesetting];

  return (
    <div className="logs selectable">
      <div className="log-summary">
        <span className={`pill ${issues.errors.length ? 'error' : ''}`}>
          <AlertCircle size={12} /> {issues.errors.length} error{issues.errors.length === 1 ? '' : 's'}
        </span>
        <span className={`pill ${issues.warnings.length ? 'warning' : ''}`}>
          <AlertTriangle size={12} /> {issues.warnings.length} warning{issues.warnings.length === 1 ? '' : 's'}
        </span>
        <span className={`pill ${issues.typesetting.length ? 'info' : ''}`}>
          <Info size={12} /> {issues.typesetting.length} typesetting
        </span>
        {res && res.durationMs != null && (
          <span className="faint" style={{ fontSize: 11.5 }}>
            {res.engine} · {res.runs} pass{res.runs === 1 ? '' : 'es'} · {(res.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setShowRaw(!showRaw)}>
          <ScrollText size={14} /> {showRaw ? 'Hide' : 'Raw'} logs
        </button>
        <button
          className="btn btn-sm"
          onClick={async () => setOutputs(outputs ? null : await call('compile:outputs', project.id))}
          title="Other logs and output files"
        >
          <FolderOpen size={14} /> Files
        </button>
        <button className="btn btn-sm" onClick={() => A.clearCache()} title="Delete auxiliary files and rebuild on the next compile">
          <Trash2 size={14} /> Clear cache
        </button>
      </div>

      {outputs && (
        <div className="log-item" style={{ borderLeftColor: 'var(--border-strong)' }}>
          <div className="log-body" style={{ paddingTop: 10, paddingLeft: 12 }}>
            {outputs.length === 0 && <div className="muted">No output files yet.</div>}
            {outputs.map((f) => (
              <div key={f.name} className="row" style={{ padding: '3px 0' }}>
                <span className="grow ellipsis" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {f.name}
                </span>
                <span className="faint" style={{ fontSize: 11 }}>
                  {(f.size / 1024).toFixed(1)} KB
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => call('compile:saveOutput', f.path)}>
                  <Download size={13} /> Save
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {res && res.status === 'missing' && (
        <div className="log-item missing">
          <div className="log-head" style={{ cursor: 'default' }}>
            <PackageOpen size={16} className="lh-icon" color="var(--accent)" />
            <div className="grow">
              <div className="log-msg">Your document needs LaTeX packages that are not installed</div>
              <div className="muted" style={{ marginTop: 4 }}>{(res.missing || []).map((m) => (m.package ? `${m.package} (${m.file})` : m.file)).join(', ')}</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => openDialog('packages', { missing: res.missing, retry: (extra) => A.compile(extra) })}>
              Install
            </button>
          </div>
        </div>
      )}

      {compile.running && (
        <pre className="raw-log" ref={rawRef} style={{ maxHeight: 260, marginBottom: 10 }}>
          {compile.liveLog || 'Starting...'}
        </pre>
      )}

      {!compile.running && res && res.status === 'success' && all.length === 0 && (
        <div className="log-item" style={{ borderLeftColor: 'var(--success)' }}>
          <div className="log-head" style={{ cursor: 'default' }}>
            <CheckCircle2 size={16} color="var(--success)" className="lh-icon" />
            <div className="log-msg">No problems. Your document compiled cleanly.</div>
          </div>
        </div>
      )}
      {!res && !compile.running && <div className="empty-note">Compile the project to see errors and warnings here.</div>}
      {res && res.status === 'failure' && !res.pdfPath && issues.errors.length === 0 && (
        <div className="log-item error">
          <div className="log-head" style={{ cursor: 'default' }}>
            <FileWarning size={16} className="lh-icon" />
            <div className="log-msg">No PDF was produced. Check the raw log below for details.</div>
          </div>
        </div>
      )}

      {all.map((it, i) => (
        <LogItem key={i} it={it} defaultOpen={it.level === 'error' && i < 3} />
      ))}

      {showRaw && res && (
        <>
          <div className="settings-group-title" style={{ margin: '14px 0 6px' }}>
            Raw log
          </div>
          <pre className="raw-log">{res.log || '(empty)'}</pre>
          {res.blg && (
            <>
              <div className="settings-group-title" style={{ margin: '14px 0 6px' }}>
                Bibliography log
              </div>
              <pre className="raw-log">{res.blg}</pre>
            </>
          )}
        </>
      )}
    </div>
  );
}

function LogItem({ it, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const hint = hintFor(it.message);
  const Icon = it.level === 'error' ? AlertCircle : it.level === 'warning' ? AlertTriangle : Info;
  const loc = it.file ? `${it.file}${it.line ? `:${it.line}` : ''}` : it.externalFile ? it.externalFile.split('/').pop() : '';
  return (
    <div className={`log-item ${it.level}`}>
      <div className="log-head" onClick={() => setOpen(!open)}>
        <Icon size={15} className="lh-icon" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="log-msg">{it.message}</div>
        </div>
        {loc && (
          <button
            className="btn btn-sm btn-ghost log-loc"
            onClick={(e) => {
              e.stopPropagation();
              if (it.file) E.jumpTo(it.file, it.line || 1);
            }}
            disabled={!it.file}
            title={it.file ? 'Go to this line' : it.externalFile}
          >
            {loc}
          </button>
        )}
        <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', flex: 'none', marginTop: 2 }} />
      </div>
      {open && (
        <div className="log-body">
          {hint && <div className="log-hint">{hint}</div>}
          {it.raw && <pre className="log-raw">{it.raw}</pre>}
        </div>
      )}
    </div>
  );
}
