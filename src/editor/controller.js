import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo, selectAll as cmSelectAll, toggleComment as cmToggleComment, indentMore, indentLess } from '@codemirror/commands';
import { openSearchPanel, gotoLine as cmGotoLine } from '@codemirror/search';
import { forceLinting } from '@codemirror/lint';
import { snippet, startCompletion } from '@codemirror/autocomplete';
import { buildExtensions, reconfigureEffects, flashEffect, isLatexFile } from './setup';
import { parseOutline } from './modes';
import { setLintContext } from './codeCheck';
import { setComments, addComment as addCommentEffect, setActiveComment, commentRanges } from './comments';
import { toSnippet } from './latexData';
import { call } from '../lib/api';
import { getState, setState } from '../store';
import { toast, errorMessage } from '../lib/ui';

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|svg|webp|ico)$/i;

let view = null;
let host = null;
const docs = new Map(); // rel -> { state, saved, key, timer }
let current = null;
let configKey = 1;
let hooks = { onChange: () => {}, onSaved: () => {}, onCommand: () => {} };

export function setHooks(h) {
  hooks = { ...hooks, ...h };
}

export function editorConfig() {
  const s = getState().settings || {};
  return {
    dark: getState().resolvedTheme === 'dark',
    keybindings: s.keybindings,
    wordWrap: s.wordWrap,
    lineNumbers: s.lineNumbers,
    highlightActiveLine: s.highlightActiveLine,
    autoComplete: s.autoComplete,
    autoCloseBrackets: s.autoCloseBrackets,
    mathPreview: s.mathPreview,
    spellCheck: s.spellCheck,
    visual: getState().editorMode === 'visual',
    codeCheck: s.codeCheck,
    readOnly: false,
  };
}

// ------------------------------------------------------------------ lint context
setLintContext(() => {
  const s = getState();
  const issues = s.issues || {};
  const all = [...(issues.errors || []), ...(issues.warnings || []), ...(issues.typesetting || []).slice(0, 50)];
  return {
    codeCheck: !!(s.settings && s.settings.codeCheck),
    compileIssues: current ? all.filter((i) => i.file && sameFile(i.file, current)) : [],
  };
});

export function sameFile(a, b) {
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const x = norm(a);
  const y = norm(b);
  return x === y || x === y.replace(/\.tex$/, '') || x + '.tex' === y;
}

// ------------------------------------------------------------------ view lifecycle
function editorKeymap() {
  return [
    { key: 'Mod-Enter', run: () => (hooks.onCommand('compile'), true) },
    { key: 'Mod-s', run: () => (hooks.onCommand('save'), true) },
    { key: 'Mod-b', run: () => (wrap('\\textbf{', '}'), true) },
    { key: 'Mod-i', run: () => (wrap('\\textit{', '}'), true) },
    { key: 'Mod-Shift-c', run: () => (hooks.onCommand('addComment'), true) },
    { key: 'Mod-Shift-f', run: () => (hooks.onCommand('projectSearch'), true) },
    { key: 'Mod-Space', run: startCompletion },
  ];
}

let cursorFrame = 0;
function updateListener(u) {
  if (u.docChanged && current) {
    const d = docs.get(current);
    if (d) {
      const dirty = u.state.doc.length !== d.saved.length || u.state.doc.toString() !== d.saved;
      markDirty(current, dirty);
      if (dirty) scheduleSave(current);
      scheduleOutline();
      scheduleCommentSync();
      hooks.onChange(current);
    }
  }
  if (u.selectionSet || u.docChanged) {
    cancelAnimationFrame(cursorFrame);
    cursorFrame = requestAnimationFrame(() => {
      if (!view) return;
      const sel = view.state.selection.main;
      const line = view.state.doc.lineAt(sel.head);
      const outline = getState().outline;
      let cur = -1;
      for (let i = 0; i < outline.length; i++) if (outline[i].line <= line.number) cur = i;
      setState({ cursor: { line: line.number, col: sel.head - line.from + 1 }, selectionEmpty: sel.empty, currentSection: cur });
    });
  }
}

const domHandlers = {
  click: (e) => {
    const el = e.target.closest && e.target.closest('[data-cid]');
    if (el) {
      const id = el.getAttribute('data-cid');
      setState({ activeComment: id, sidebarPanel: 'review', sidebarOpen: true });
      if (view) view.dispatch({ effects: setActiveComment.of(id) });
    }
    return false;
  },
  dblclick: () => false,
};

function createState(path, text) {
  return EditorState.create({
    doc: text,
    extensions: buildExtensions(path, editorConfig(), { updateListener, editorKeymap: editorKeymap(), domHandlers }),
  });
}

export function ensureView() {
  if (!view) {
    host = document.createElement('div');
    host.style.height = '100%';
    view = new EditorView({ parent: host, state: createState('untitled.txt', '') });
  }
  return view;
}

export function attach(container) {
  ensureView();
  if (host.parentElement !== container) container.appendChild(host);
  view.requestMeasure();
}

export function detach() {
  if (host && host.parentElement) host.parentElement.removeChild(host);
}

export function getView() {
  return view;
}

export function currentFile() {
  return current;
}

// ------------------------------------------------------------------ files
export function kindOf(rel) {
  if (IMAGE_EXT.test(rel)) return 'image';
  if (/\.pdf$/i.test(rel)) return 'pdf';
  return 'text';
}

function stash() {
  if (current && view && docs.has(current)) docs.get(current).state = view.state;
}

export async function openFile(rel, opts = {}) {
  const proj = getState().project;
  if (!proj || !rel) return false;
  ensureView();
  const kind = kindOf(rel);
  if (kind !== 'text') {
    stash();
    setState({ openPath: rel, openKind: kind, selectedPath: rel, historyOpen: false });
    return true;
  }
  let d = docs.get(rel);
  if (!d) {
    let r;
    try {
      r = await call('fs:read', proj.id, rel);
    } catch (e) {
      toast('error', 'Could not open file', errorMessage(e));
      return false;
    }
    if (r.kind !== 'text') {
      stash();
      setState({ openPath: rel, openKind: 'binary', selectedPath: rel, historyOpen: false });
      return true;
    }
    d = { state: createState(rel, r.content), saved: r.content, key: configKey };
    docs.set(rel, d);
  }
  if (current !== rel) stash();
  if (d.key !== configKey) {
    d.state = d.state.update({ effects: reconfigureEffects(rel, editorConfig()) }).state;
    d.key = configKey;
  }
  view.setState(d.state);
  current = rel;
  expandParents(rel);
  setState({ openPath: rel, openKind: 'text', selectedPath: rel, historyOpen: false, outline: isLatexFile(rel) ? parseOutline(d.state.doc.toString()) : [] });
  applyComments();
  forceLinting(view);
  if (opts.line) gotoLine(opts.line, opts.col || 0, opts.flash);
  else if (getState().editorMode === 'visual') moveOutOfPreamble();
  if (opts.focus !== false) requestAnimationFrame(() => view && view.focus());
  return true;
}

function expandParents(rel) {
  const parts = rel.split('/');
  if (parts.length < 2) return;
  const exp = { ...getState().expanded };
  let p = '';
  for (let i = 0; i < parts.length - 1; i++) {
    p = p ? `${p}/${parts[i]}` : parts[i];
    exp[p] = true;
  }
  setState({ expanded: exp });
}

export function textOf(rel) {
  if (rel === current && view) return view.state.doc.toString();
  const d = docs.get(rel);
  return d ? d.state.doc.toString() : null;
}

export function isOpen(rel) {
  return docs.has(rel);
}

function markDirty(rel, dirty) {
  const cur = getState().dirty;
  if (!!cur[rel] === dirty) return;
  const next = { ...cur };
  if (dirty) next[rel] = true;
  else delete next[rel];
  setState({ dirty: next, saveState: Object.keys(next).length ? 'unsaved' : 'saved' });
}

function scheduleSave(rel) {
  const s = getState().settings;
  if (s && s.autoSave === false) return;
  const d = docs.get(rel);
  if (!d) return;
  clearTimeout(d.timer);
  d.timer = setTimeout(() => saveFile(rel), 700);
}

export async function saveFile(rel) {
  const proj = getState().project;
  const d = docs.get(rel);
  if (!proj || !d) return;
  clearTimeout(d.timer);
  const text = textOf(rel);
  if (text === d.saved) {
    markDirty(rel, false);
    return;
  }
  setState({ saveState: 'saving' });
  try {
    await call('fs:write', proj.id, rel, text);
    d.saved = text;
    markDirty(rel, textOf(rel) !== text);
    if (!Object.keys(getState().dirty).length) setState({ saveState: 'saved' });
    hooks.onSaved(rel);
  } catch (e) {
    setState({ saveState: 'unsaved' });
    toast('error', `Could not save ${rel}`, errorMessage(e));
  }
}

export async function saveAll() {
  const dirty = Object.keys(getState().dirty);
  await Promise.all(dirty.map((r) => saveFile(r)));
}

export function forgetFile(rel) {
  const d = docs.get(rel);
  if (d) clearTimeout(d.timer);
  docs.delete(rel);
  if (current === rel) {
    current = null;
    view && view.setState(createState('untitled.txt', ''));
    setState({ openPath: null, openKind: null, outline: [] });
  }
  markDirty(rel, false);
}

export function renameOpenFile(from, to) {
  // Move cached buffers when a file or folder is renamed.
  for (const key of [...docs.keys()]) {
    if (key === from || key.startsWith(from + '/')) {
      const next = to + key.slice(from.length);
      const d = docs.get(key);
      docs.delete(key);
      d.key = 0; // language may change with the extension
      docs.set(next, d);
      if (current === key) current = next;
    }
  }
  if (getState().openPath && (getState().openPath === from || getState().openPath.startsWith(from + '/'))) {
    const next = to + getState().openPath.slice(from.length);
    setState({ openPath: next, selectedPath: next });
    if (current === next && view) {
      view.dispatch({ effects: reconfigureEffects(next, editorConfig()) });
      docs.get(next).key = configKey;
    }
  }
}

export function closeAll() {
  for (const d of docs.values()) clearTimeout(d.timer);
  docs.clear();
  current = null;
  if (view) view.setState(createState('untitled.txt', ''));
}

/** Called when files change on disk (other programs, git pull, history restore). */
export async function reloadChanged(paths) {
  const proj = getState().project;
  if (!proj) return;
  for (const rel of paths) {
    const d = docs.get(rel);
    if (!d) continue;
    let r;
    try {
      r = await call('fs:read', proj.id, rel);
    } catch {
      continue; // deleted; the tree refresh handles it
    }
    if (r.kind !== 'text') continue;
    const buffer = textOf(rel);
    if (r.content === buffer) {
      d.saved = r.content;
      continue;
    }
    const dirty = buffer !== d.saved;
    if (dirty && !getState().forceReload) {
      toast('warning', `${rel} changed on disk`, 'You have unsaved edits, so the file was not reloaded. Your version will be saved over it.');
      continue;
    }
    replaceText(rel, r.content);
    d.saved = r.content;
    markDirty(rel, false);
  }
}

function replaceText(rel, text) {
  if (rel === current && view) {
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: EditorSelection.cursor(Math.min(sel.head, text.length)),
    });
  } else {
    const d = docs.get(rel);
    d.state = d.state.update({ changes: { from: 0, to: d.state.doc.length, insert: text } }).state;
  }
}

// ------------------------------------------------------------------ settings
export function reconfigure() {
  configKey++;
  if (view && current) {
    view.dispatch({ effects: reconfigureEffects(current, editorConfig()) });
    const d = docs.get(current);
    if (d) d.key = configKey;
  }
}

// ------------------------------------------------------------------ outline
let outlineTimer = 0;
function scheduleOutline() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    if (view && current && isLatexFile(current)) setState({ outline: parseOutline(view.state.doc.toString()) });
  }, 400);
}

// ------------------------------------------------------------------ navigation & editing
export function gotoLine(line, col = 0, flash = false) {
  if (!view) return;
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
  const pos = Math.min(l.to, l.from + Math.max(0, col));
  view.dispatch({ selection: { anchor: pos }, effects: [EditorView.scrollIntoView(pos, { y: 'center' }), ...(flash ? [flashEffect.of(l.from)] : [])] });
  if (flash) setTimeout(() => view && view.dispatch({ effects: flashEffect.of(null) }), 1500);
  view.focus();
}

export async function jumpTo(file, line, col = 0) {
  if (!file) return;
  const ok = current === file ? true : await openFile(file, { focus: false });
  if (ok) gotoLine(line || 1, col, true);
}

export function cursorInfo() {
  if (!view || !current) return null;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  return { file: current, line: line.number, col: sel.head - line.from };
}

export function focus() {
  view && view.focus();
}

export function selectionText() {
  if (!view) return '';
  const s = view.state.selection.main;
  return view.state.sliceDoc(s.from, s.to);
}

export function wrap(before, after, placeholder = '') {
  if (!view || !current) return;
  const state = view.state;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    // Toggle off when the selection is already wrapped.
    const outerFrom = range.from - before.length;
    const outerTo = range.to + after.length;
    if (outerFrom >= 0 && state.sliceDoc(outerFrom, range.from) === before && state.sliceDoc(range.to, outerTo) === after) {
      return {
        changes: [
          { from: outerFrom, to: range.from, insert: '' },
          { from: range.to, to: outerTo, insert: '' },
        ],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      };
    }
    const inner = text || placeholder;
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
}

export function insertText(text) {
  if (!view || !current) return;
  view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
  view.focus();
}

/** Insert a template where "#" marks the cursor and "#1".."#9" are tab stops. */
export function insertTemplate(tpl) {
  if (!view || !current) return;
  const sel = view.state.selection.main;
  snippet(toSnippet(tpl))(view, null, sel.from, sel.to);
  view.focus();
}

export function setSectionLevel(level) {
  if (!view || !current) return;
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*\{(.*)\}\s*$/.exec(line.text);
  let text;
  if (m) text = level === 'normal' ? m[1] + m[4] : `${m[1]}\\${level}${m[3]}{${m[4]}}`;
  else if (level === 'normal') return;
  else {
    const indent = /^\s*/.exec(line.text)[0];
    text = `${indent}\\${level}{${line.text.trim()}}`;
  }
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + text.length - (level === 'normal' ? 0 : 1) } });
  view.focus();
}

/** In visual mode the preamble is collapsed, so start editing in the document body. */
export function moveOutOfPreamble() {
  if (!view || !current) return;
  const text = view.state.doc.toString();
  const i = text.indexOf('\\begin{document}');
  if (i === -1 || view.state.selection.main.head > i) return;
  const line = view.state.doc.lineAt(i);
  const next = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : line;
  view.dispatch({ selection: { anchor: next.from }, effects: EditorView.scrollIntoView(next.from, { y: 'start', yMargin: 40 }) });
}

export function currentSectionLevel() {
  if (!view || !current) return 'normal';
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/.exec(line.text);
  return m ? m[1] : 'normal';
}

export function insertList(kind) {
  if (!view || !current) return;
  const state = view.state;
  const sel = state.selection.main;
  if (!sel.empty) {
    const from = state.doc.lineAt(sel.from);
    const to = state.doc.lineAt(sel.to);
    const lines = state.sliceDoc(from.from, to.to).split('\n').filter((l) => l.trim());
    const body = lines.map((l) => `    \\item ${l.trim()}`).join('\n');
    const text = `\\begin{${kind}}\n${body}\n\\end{${kind}}`;
    view.dispatch({ changes: { from: from.from, to: to.to, insert: text } });
  } else {
    insertTemplate(`\\begin{${kind}}\n\t\\item #\n\\end{${kind}}`);
  }
  view.focus();
}

export function run(cmd) {
  if (!view) return false;
  const map = {
    undo: cmUndo,
    redo: cmRedo,
    selectAll: cmSelectAll,
    toggleComment: cmToggleComment,
    indentMore,
    indentLess,
    find: openSearchPanel,
    gotoLine: cmGotoLine,
  };
  const f = map[cmd];
  if (!f) return false;
  view.focus();
  return f(view);
}

// ------------------------------------------------------------------ comments
function applyComments() {
  if (!view || !current) return;
  const all = getState().comments;
  const doc = view.state.doc;
  let changed = false;
  const list = [];
  for (const c of all) {
    if (c.file !== current || c.resolved) continue;
    let { from, to } = c;
    if (!(from >= 0 && to <= doc.length && doc.sliceString(from, to) === c.quote)) {
      // Re-anchor by searching for the quoted text nearest the old position.
      const text = doc.toString();
      let best = -1;
      let idx = text.indexOf(c.quote);
      while (idx !== -1 && c.quote) {
        if (best === -1 || Math.abs(idx - c.from) < Math.abs(best - c.from)) best = idx;
        idx = text.indexOf(c.quote, idx + 1);
      }
      if (best === -1) continue;
      from = best;
      to = best + c.quote.length;
      c.from = from;
      c.to = to;
      changed = true;
    }
    list.push({ id: c.id, from, to });
  }
  view.dispatch({ effects: setComments.of({ list, active: getState().activeComment }) });
  if (changed) hooks.onCommand('commentsChanged');
}

export function refreshComments() {
  applyComments();
}

export function highlightComment(id) {
  if (!view) return;
  view.dispatch({ effects: setActiveComment.of(id) });
}

let commentTimer = 0;
function scheduleCommentSync() {
  clearTimeout(commentTimer);
  commentTimer = setTimeout(syncCommentPositions, 600);
}

function syncCommentPositions() {
  if (!view || !current) return;
  const ranges = commentRanges(view.state);
  if (!ranges.length) return;
  const byId = new Map(ranges.map((r) => [r.id, r]));
  const doc = view.state.doc;
  const next = getState().comments.map((c) => {
    const r = byId.get(c.id);
    if (!r || c.file !== current) return c;
    return { ...c, from: r.from, to: r.to, quote: doc.sliceString(r.from, r.to) };
  });
  setState({ comments: next });
  hooks.onCommand('commentsChanged');
}

export function selectionForComment() {
  if (!view || !current) return null;
  const s = view.state.selection.main;
  if (s.empty) return null;
  return { file: current, from: s.from, to: s.to, quote: view.state.sliceDoc(s.from, s.to) };
}

export function addCommentMark(c) {
  if (!view || c.file !== current) return;
  view.dispatch({ effects: addCommentEffect.of({ id: c.id, from: c.from, to: c.to }) });
}

export function refreshLint() {
  if (view) forceLinting(view);
}
