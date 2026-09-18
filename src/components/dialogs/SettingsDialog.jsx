import { useState } from 'react';
import { Settings, Sun, Moon, Monitor, FolderOpen, Code2, Eye, AlertTriangle } from 'lucide-react';
import { useStore } from '../../store';
import { call } from '../../lib/api';
import { openDialog } from '../../lib/ui';
import * as A from '../../actions';
import { Modal, Switch, Segmented } from '../ui';

function Row({ title, desc, children }) {
  return (
    <div className="setting-row">
      <div className="sr-text">
        <div className="sr-title">{title}</div>
        {desc && <div className="sr-desc">{desc}</div>}
      </div>
      <div className="sr-control">{children}</div>
    </div>
  );
}

function Select({ value, options, onChange, width = 190 }) {
  return (
    <select className="select" style={{ width }} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

const LANG_NAMES = { 'en-US': 'English (US)', 'en-GB': 'English (UK)', 'en-AU': 'English (Australia)', ms: 'Malay', 'ms-MY': 'Malay (Malaysia)', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', 'pt-BR': 'Portuguese (Brazil)', id: 'Indonesian', tr: 'Turkish', ar: 'Arabic' };

export default function SettingsDialog({ tab: initialTab, onClose }) {
  const s = useStore((st) => st.settings);
  const project = useStore((st) => st.project);
  const info = useStore((st) => st.info);
  const tex = useStore((st) => st.tex);
  const index = useStore((st) => st.index);
  const [tab, setTab] = useState(initialTab && (initialTab !== 'project' || project) ? initialTab : 'general');
  const set = (patch) => A.updateSettings(patch);
  const setP = (patch) => A.updateProject(patch);

  const tabs = [
    ['general', 'General'],
    ['editor', 'Editor'],
    ['compiler', 'Compiler'],
    ['pdf', 'PDF viewer'],
    ...(project ? [['project', 'This project']] : []),
  ];

  const spellLangs = (info && info.spellLanguages && info.spellLanguages.length ? info.spellLanguages : ['en-US', 'en-GB']).map((l) => [l, LANG_NAMES[l] || l]);

  return (
    <Modal title="Settings" icon={<Settings size={18} color="var(--accent)" />} size="lg" onClose={onClose}>
      <div className="settings-layout">
        <div className="settings-nav">
          {tabs.map(([k, l]) => (
            <button key={k} className={`dash-nav ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {tab === 'general' && (
            <>
              <div className="settings-group-title">Appearance</div>
              <Row title="Theme" desc="Choose light, dark, or follow Windows.">
                <Segmented
                  value={s.theme}
                  onChange={(v) => A.setTheme(v)}
                  options={[
                    { value: 'light', label: 'Light', icon: <Sun size={13} /> },
                    { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
                    { value: 'system', label: 'System', icon: <Monitor size={13} /> },
                  ]}
                />
              </Row>
              <Row title="Interface size" desc="Scale the whole window. Ctrl+= and Ctrl+- also work.">
                <Select value={String(s.uiScale || 1)} onChange={(v) => set({ uiScale: Number(v) })} options={[0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5].map((z) => [String(z), `${Math.round(z * 100)}%`])} />
              </Row>
              <div className="settings-group-title">You</div>
              <Row title="Your name" desc="Shown on comments and in the version history.">
                <input className="input" style={{ width: 220 }} defaultValue={s.userName} onBlur={(e) => e.target.value.trim() && set({ userName: e.target.value.trim() })} />
              </Row>
              <div className="settings-group-title">Files</div>
              <Row title="Projects folder" desc={s.projectsRoot}>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const r = await call('dialog:open', { title: 'Choose where new projects are created', properties: ['openDirectory', 'createDirectory'], defaultPath: s.projectsRoot });
                    if (!r.canceled && r.filePaths[0]) set({ projectsRoot: r.filePaths[0] });
                  }}
                >
                  <FolderOpen size={14} /> Change...
                </button>
              </Row>
              <Row title="Hide build files" desc="Hide .aux, .log and similar files in the file tree.">
                <Switch on={s.hideBuildFiles} onChange={(v) => set({ hideBuildFiles: v })} />
              </Row>
            </>
          )}

          {tab === 'editor' && (
            <>
              <div className="settings-group-title">Editing</div>
              <Row title="Default editor" desc="Visual mode hides markup and previews maths and images.">
                <Segmented
                  value={s.defaultEditorMode || 'source'}
                  onChange={(v) => set({ defaultEditorMode: v })}
                  options={[
                    { value: 'source', label: 'Code', icon: <Code2 size={13} /> },
                    { value: 'visual', label: 'Visual', icon: <Eye size={13} /> },
                  ]}
                />
              </Row>
              <Row title="Keyboard shortcuts">
                <Select value={s.keybindings} onChange={(v) => set({ keybindings: v })} options={[['default', 'Standard'], ['vim', 'Vim'], ['emacs', 'Emacs']]} />
              </Row>
              <Row title="Auto-complete" desc="Suggest commands, environments, labels and citations while typing.">
                <Switch on={s.autoComplete} onChange={(v) => set({ autoComplete: v })} />
              </Row>
              <Row title="Auto-close brackets">
                <Switch on={s.autoCloseBrackets} onChange={(v) => set({ autoCloseBrackets: v })} />
              </Row>
              <Row title="Code check" desc="Warn about unclosed environments and braces while you type.">
                <Switch on={s.codeCheck} onChange={(v) => set({ codeCheck: v })} />
              </Row>
              <Row title="Maths preview" desc="Show rendered maths above the cursor in the code editor.">
                <Switch on={s.mathPreview} onChange={(v) => set({ mathPreview: v })} />
              </Row>
              <Row title="Spell check">
                <Switch on={s.spellCheck} onChange={(v) => set({ spellCheck: v })} />
              </Row>
              <Row title="Spell check language">
                <Select value={s.spellLanguage} onChange={(v) => set({ spellLanguage: v })} options={spellLangs} />
              </Row>
              <Row title="Save automatically" desc="Save changes as you type.">
                <Switch on={s.autoSave !== false} onChange={(v) => set({ autoSave: v })} />
              </Row>
              <div className="settings-group-title">Display</div>
              <Row title="Font size">
                <Select value={String(s.editorFontSize)} onChange={(v) => set({ editorFontSize: Number(v) })} options={[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((n) => [String(n), `${n} px`])} />
              </Row>
              <Row title="Font">
                <Select
                  value={s.editorFontFamily}
                  onChange={(v) => set({ editorFontFamily: v })}
                  options={[
                    ['JetBrains Mono', 'JetBrains Mono'],
                    ['Cascadia Code', 'Cascadia Code'],
                    ['Consolas', 'Consolas'],
                    ['Courier New', 'Courier New'],
                    ['Segoe UI', 'Segoe UI (proportional)'],
                  ]}
                />
              </Row>
              <Row title="Line height">
                <Select value={String(s.editorLineHeight)} onChange={(v) => set({ editorLineHeight: Number(v) })} options={[1.3, 1.4, 1.5, 1.6, 1.8, 2].map((n) => [String(n), String(n)])} />
              </Row>
              <Row title="Wrap long lines">
                <Switch on={s.wordWrap} onChange={(v) => set({ wordWrap: v })} />
              </Row>
              <Row title="Line numbers">
                <Switch on={s.lineNumbers} onChange={(v) => set({ lineNumbers: v })} />
              </Row>
              <Row title="Highlight current line">
                <Switch on={s.highlightActiveLine} onChange={(v) => set({ highlightActiveLine: v })} />
              </Row>
            </>
          )}

          {tab === 'compiler' && (
            <>
              <div className="settings-group-title">Compiling</div>
              <Row title="Default compiler" desc="Used for new projects. Each project can override it.">
                <Select value={s.defaultCompiler} onChange={(v) => set({ defaultCompiler: v })} options={[['pdflatex', 'pdfLaTeX'], ['xelatex', 'XeLaTeX'], ['lualatex', 'LuaLaTeX']]} />
              </Row>
              <Row title="Auto compile" desc="Recompile automatically after you stop typing.">
                <Switch on={s.autoCompile} onChange={(v) => set({ autoCompile: v })} />
              </Row>
              <Row title="Auto compile delay">
                <Select value={String(s.autoCompileDelay)} onChange={(v) => set({ autoCompileDelay: Number(v) })} options={[1000, 1500, 2500, 4000, 6000, 10000].map((n) => [String(n), `${n / 1000} seconds`])} />
              </Row>
              <Row title="Time limit" desc="Stop a compile that runs longer than this.">
                <Select value={String(s.compileTimeout)} onChange={(v) => set({ compileTimeout: Number(v) })} options={[60, 120, 300, 600, 1200].map((n) => [String(n), `${n / 60} minute${n === 60 ? '' : 's'}`])} />
              </Row>
              <div className="settings-group-title">Packages</div>
              <Row title="When a package is missing" desc="What to do when a document or template needs a LaTeX package you do not have.">
                <Select value={s.missingPackages} onChange={(v) => set({ missingPackages: v })} options={[['ask', 'Ask me first'], ['always', 'Install automatically'], ['never', 'Never install']]} />
              </Row>
              <Row title="TeX distribution" desc={tex && tex.found ? `${tex.version} at ${tex.binDir}` : 'No TeX distribution found.'}>
                <button className="btn btn-sm" onClick={() => openDialog('tex')}>
                  Manage...
                </button>
              </Row>
            </>
          )}

          {tab === 'pdf' && (
            <>
              <div className="settings-group-title">PDF viewer</div>
              <Row title="Default zoom">
                <Select value={String(s.pdfZoom)} onChange={(v) => set({ pdfZoom: v === 'page-width' || v === 'page-fit' ? v : Number(v) })} options={[['page-width', 'Fit width'], ['page-fit', 'Fit page'], ['1', '100%'], ['1.25', '125%']]} />
              </Row>
              <Row title="Dark PDF background" desc="Invert PDF colours to reduce glare in dark mode. Does not change the real PDF.">
                <Switch on={s.pdfDarkMode} onChange={(v) => set({ pdfDarkMode: v })} />
              </Row>
            </>
          )}

          {tab === 'project' && project && (
            <>
              <div className="settings-group-title">{project.name}</div>
              <Row title="Project name">
                <input className="input" style={{ width: 240 }} defaultValue={project.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== project.name && setP({ name: e.target.value.trim() })} />
              </Row>
              <Row title="Main document" desc="The file that contains \documentclass.">
                <Select
                  width={240}
                  value={project.mainFile}
                  onChange={(v) => A.setMainFile(v)}
                  options={[...new Set([project.mainFile, ...(index.texFiles || []).filter((f) => /\.(tex|ltx)$/i.test(f))])].map((f) => [f, f])}
                />
              </Row>
              <Row title="Compiler">
                <Select value={project.compiler} onChange={(v) => setP({ compiler: v }).then(() => A.compile())} options={[['pdflatex', 'pdfLaTeX'], ['xelatex', 'XeLaTeX'], ['lualatex', 'LuaLaTeX']]} />
              </Row>
              <Row title="Fast draft mode" desc="Images are drawn as boxes for quicker compiles.">
                <Switch on={!!project.draft} onChange={(v) => setP({ draft: v })} />
              </Row>
              <Row title="Stop on first error">
                <Switch on={!!project.haltOnError} onChange={(v) => setP({ haltOnError: v })} />
              </Row>
              <Row
                title="Allow shell escape"
                desc={
                  <span>
                    <AlertTriangle size={12} style={{ verticalAlign: '-2px', color: 'var(--warning)' }} /> Needed by packages such as minted. Only enable for documents you trust, because it lets LaTeX run programs.
                  </span>
                }
              >
                <Switch on={!!project.shellEscape} onChange={(v) => setP({ shellEscape: v })} />
              </Row>
              <Row title="Project folder" desc={project.path}>
                <button className="btn btn-sm" onClick={() => call('app:openPath', project.path)}>
                  <FolderOpen size={14} /> Open
                </button>
              </Row>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
