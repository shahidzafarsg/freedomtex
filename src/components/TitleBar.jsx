import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { useStore } from '../store';
import { MENUS } from '../menus';
import { commands, runCommand } from '../commands';
import { Menu } from './ui';
import { openProject } from '../actions';
import logo from '../assets/logo.svg';

function resolveItems(items, state) {
  const out = [];
  for (const it of items) {
    if (it === '-') {
      out.push({ separator: true });
      continue;
    }
    if (typeof it === 'string') {
      const c = commands[it];
      if (!c) continue;
      out.push({
        label: c.label,
        shortcut: c.shortcut,
        checked: c.checked ? c.checked() : false,
        disabled: c.enabled ? !c.enabled() : false,
        onClick: () => runCommand(it),
      });
      continue;
    }
    if (it.dynamic === 'recent') {
      const recent = [...state.projects]
        .filter((p) => !p.trashed && !p.missing)
        .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
        .slice(0, 8);
      out.push({
        label: it.label,
        items: recent.length ? recent.map((p) => ({ label: p.name, icon: <FileText size={14} />, onClick: () => openProject(p.id) })) : [{ label: 'No recent projects', disabled: true }],
      });
      continue;
    }
    out.push({ label: it.label, items: resolveItems(it.items, state) });
  }
  return out;
}

export default function TitleBar() {
  const [open, setOpen] = useState(null); // { id, rect }
  const project = useStore((s) => s.project);
  const saveState = useStore((s) => s.saveState);
  const screen = useStore((s) => s.screen);
  const state = useStore();

  const items = useMemo(() => (open ? resolveItems(MENUS.find((m) => m.id === open.id).items, state) : []), [open, state]);

  const openMenu = (id, el) => setOpen({ id, rect: el.getBoundingClientRect() });

  return (
    <div className="titlebar">
      <div className="tb-brand">
        <img src={logo} alt="" />
        <span>FreedomTex</span>
      </div>
      {screen !== 'setup' && screen !== 'loading' && (
        <div className="menubar no-drag">
          {MENUS.map((m) => (
            <button
              key={m.id}
              className={`menu-trigger ${open && open.id === m.id ? 'open' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (open && open.id === m.id) setOpen(null);
                else openMenu(m.id, e.currentTarget);
              }}
              onMouseEnter={(e) => open && open.id !== m.id && openMenu(m.id, e.currentTarget)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {project && (
        <div className="tb-center">
          <span className={`save-dot ${saveState}`} title={saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving...' : 'Unsaved changes'} />
          <strong className="ellipsis">{project.name}</strong>
        </div>
      )}
      {open && <Menu items={items} anchor={open.rect} onClose={() => setOpen(null)} />}
    </div>
  );
}
