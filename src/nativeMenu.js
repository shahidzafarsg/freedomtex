// macOS: mirror the in-window menus into the real menu bar at the top of the screen.
import { MENUS } from './menus';
import { commands, runCommand } from './commands';
import { useStore, getState } from './store';
import { on } from './lib/api';
import { openProject } from './actions';

function accelerator(id, shortcut) {
  if (id === 'redo') return 'CmdOrCtrl+Shift+Z';
  if (id === 'fullscreen') return 'Ctrl+Cmd+F';
  // Chords, Tab and Alt+F4 are not menu shortcuts on a Mac.
  if (!shortcut || /\s|Tab|Alt\+F4/.test(shortcut)) return undefined;
  return shortcut.replace(/Ctrl\+/g, 'CmdOrCtrl+');
}

function build(items, state) {
  const out = [];
  for (const it of items) {
    if (it === '-') {
      out.push({ separator: true });
    } else if (typeof it === 'string') {
      const c = commands[it];
      if (!c) continue;
      out.push({
        id: it,
        label: c.label,
        accelerator: accelerator(it, c.shortcut),
        enabled: c.enabled ? !!c.enabled() : true,
        checked: c.checked ? !!c.checked() : undefined,
      });
    } else if (it.dynamic === 'recent') {
      const recent = [...state.projects]
        .filter((p) => !p.trashed && !p.missing)
        .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
        .slice(0, 8);
      out.push({ label: it.label, items: recent.length ? recent.map((p) => ({ id: `openProject:${p.id}`, label: p.name })) : [{ id: 'noop', label: 'No recent projects', enabled: false }] });
    } else {
      out.push({ label: it.label, items: build(it.items, state) });
    }
  }
  return out;
}

export function initNativeMenu() {
  let last = '';
  let timer = 0;
  const push = () => {
    const state = getState();
    const menus = MENUS.map((m) => ({ id: m.id, label: m.label, items: build(m.items, state) }));
    const json = JSON.stringify(menus);
    if (json === last) return;
    last = json;
    window.ft.setMenu(menus);
  };
  push();
  useStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(push, 200);
  });
  on('menu:command', (id) => {
    if (id.startsWith('openProject:')) openProject(id.slice('openProject:'.length));
    else runCommand(id);
  });
}
