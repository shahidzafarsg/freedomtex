import { useState } from 'react';
import { Sun, Moon, Code2, Eye, FileText, Cpu, Check, Loader2, CircleAlert } from 'lucide-react';
import { useStore } from '../store';
import * as A from '../actions';
import { openDialog } from '../lib/ui';
import { Menu } from './ui';

const COMPILERS = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

export default function StatusBar() {
  const tex = useStore((s) => s.tex);
  const project = useStore((s) => s.project);
  const cursor = useStore((s) => s.cursor);
  const openKind = useStore((s) => s.openKind);
  const saveState = useStore((s) => s.saveState);
  const mode = useStore((s) => s.editorMode);
  const theme = useStore((s) => s.resolvedTheme);
  const compile = useStore((s) => s.compile);
  const issues = useStore((s) => s.issues);
  const screen = useStore((s) => s.screen);
  const [menu, setMenu] = useState(null);

  return (
    <footer className="statusbar">
      <button className="sb-item" onClick={() => openDialog('tex')} title="TeX distribution">
        <span className={`sb-dot ${tex && tex.found ? '' : 'err'}`} />
        {tex && tex.found ? tex.version : 'No LaTeX installed'}
      </button>
      {project && screen === 'editor' && (
        <>
          <button
            className="sb-item"
            title="Compiler"
            onClick={(e) =>
              setMenu({
                anchor: e.currentTarget.getBoundingClientRect(),
                items: Object.entries(COMPILERS).map(([v, l]) => ({ label: l, checked: project.compiler === v, onClick: () => A.updateProject({ compiler: v }).then(() => A.compile()) })),
              })
            }
          >
            <Cpu size={12} /> {COMPILERS[project.compiler] || project.compiler}
          </button>
          <button className="sb-item" title="Main document (change in Project Settings)" onClick={() => openDialog('settings', { tab: 'project' })}>
            <FileText size={12} /> {project.mainFile}
          </button>
          <span className="sb-item">
            {compile.running ? (
              <>
                <Loader2 size={12} className="spin" /> Compiling
              </>
            ) : compile.status === 'success' ? (
              issues.errors.length ? (
                <>
                  <CircleAlert size={12} color="var(--danger)" /> {issues.errors.length} error{issues.errors.length === 1 ? '' : 's'}
                </>
              ) : (
                <>
                  <Check size={12} color="var(--success)" /> Compiled
                </>
              )
            ) : compile.status === 'failure' ? (
              <>
                <CircleAlert size={12} color="var(--danger)" /> Compile failed
              </>
            ) : compile.status === 'missing' ? (
              <>
                <CircleAlert size={12} color="var(--warning)" /> Packages needed
              </>
            ) : null}
          </span>
        </>
      )}
      <span className="spacer" />
      {project && screen === 'editor' && openKind === 'text' && (
        <>
          <span className="sb-item">
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <button className="sb-item" onClick={() => A.setEditorMode(mode === 'visual' ? 'source' : 'visual')} title="Switch editor mode">
            {mode === 'visual' ? <Eye size={12} /> : <Code2 size={12} />} {mode === 'visual' ? 'Visual' : 'Code'}
          </button>
          <span className="sb-item">{saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving...' : 'Unsaved changes'}</span>
        </>
      )}
      <button className="sb-item" onClick={() => A.setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle light and dark mode (Ctrl+Shift+L)">
        {theme === 'dark' ? <Moon size={12} /> : <Sun size={12} />} {theme === 'dark' ? 'Dark' : 'Light'}
      </button>
      {menu && <Menu items={menu.items} anchor={menu.anchor} onClose={() => setMenu(null)} />}
    </footer>
  );
}
