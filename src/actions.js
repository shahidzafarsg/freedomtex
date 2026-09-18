import { call, on } from './lib/api';
import { getState, setState, resetProjectState } from './store';
import { openDialog, toast, prompt, confirm, errorMessage } from './lib/ui';
import * as editor from './editor/controller';

const emptyIssues = { errors: [], warnings: [], typesetting: [] };

// ------------------------------------------------------------------ boot & theme
export async function boot() {
  const [settings, info, tex] = await Promise.all([call('settings:get'), call('app:info'), call('tex:detect')]);
  setState({ settings, info, tex, sidebarOpen: true });
  applyTheme();
  applyEditorVars();
  if (settings.uiScale && settings.uiScale !== 1) call('app:zoom', Math.log(settings.uiScale) / Math.log(1.2));
  await refreshProjects();
  call('projects:templates').then((templates) => setState({ templates }));
  setState({ screen: tex.found || settings.setupDone ? 'dashboard' : 'setup' });

  on('fs:changed', onFsChanged);
  on('compile:log', ({ projectId, chunk }) => {
    const s = getState();
    if (s.project && s.project.id === projectId) {
      const log = (s.compile.liveLog + chunk).slice(-200000);
      setState({ compile: { ...s.compile, liveLog: log } });
    }
  });
  on('app:before-close', async () => {
    try {
      await editor.saveAll();
      await persistCommentsNow();
      if (getState().project) await call('history:snapshot', getState().project.id, { reason: 'close' }).catch(() => {});
    } finally {
      call('app:closeReady');
    }
  });
  on('app:open-path', (p) => openPathFromOS(p));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

  editor.setHooks({
    onChange: onEditorChange,
    onSaved: onEditorSaved,
    onCommand: (cmd) => {
      if (cmd === 'compile') compile();
      else if (cmd === 'save') saveAndCompile();
      else if (cmd === 'addComment') startComment();
      else if (cmd === 'projectSearch') setState({ sidebarPanel: 'search', sidebarOpen: true });
      else if (cmd === 'commentsChanged') persistComments();
    },
  });
}

const THEME_COLORS = { light: { color: '#f3f5f7', symbolColor: '#18202c' }, dark: { color: '#0e1116', symbolColor: '#e5e9f0' } };

export function applyTheme() {
  const s = getState().settings;
  const pref = s ? s.theme : 'system';
  const resolved = pref === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  const changed = getState().resolvedTheme !== resolved;
  setState({ resolvedTheme: resolved });
  call('app:titleBar', { ...THEME_COLORS[resolved], height: 40 }).catch(() => {});
  if (changed) editor.reconfigure();
}

export function applyEditorVars() {
  const s = getState().settings;
  const root = document.documentElement.style;
  root.setProperty('--editor-font-size', `${s.editorFontSize || 14}px`);
  root.setProperty('--editor-line-height', String(s.editorLineHeight || 1.6));
  root.setProperty('--editor-font', `'${s.editorFontFamily || 'JetBrains Mono'}', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace`);
}

const EDITOR_KEYS = ['keybindings', 'wordWrap', 'lineNumbers', 'highlightActiveLine', 'autoComplete', 'autoCloseBrackets', 'mathPreview', 'spellCheck', 'codeCheck'];

export async function updateSettings(patch) {
  const settings = await call('settings:set', patch);
  setState({ settings });
  if ('theme' in patch) applyTheme();
  if ('editorFontSize' in patch || 'editorLineHeight' in patch || 'editorFontFamily' in patch) applyEditorVars();
  if (EDITOR_KEYS.some((k) => k in patch)) editor.reconfigure();
  if ('codeCheck' in patch) editor.refreshLint();
  if ('uiScale' in patch) call('app:zoom', Math.log(patch.uiScale) / Math.log(1.2));
  if ('hideBuildFiles' in patch && getState().project) refreshTree();
  return settings;
}

export function setTheme(theme) {
  return updateSettings({ theme });
}

export function setEditorMode(mode) {
  setState({ editorMode: mode });
  if (mode === 'visual') editor.moveOutOfPreamble();
  editor.reconfigure();
}

// ------------------------------------------------------------------ projects
export async function refreshProjects() {
  const { projects, tags } = await call('projects:list');
  setState({ projects, tags });
}

export async function createProject(templateId, defaultName) {
  const name = await prompt({ title: 'New project', label: 'Project name', value: defaultName || '', placeholder: 'e.g. Final Year Report', okLabel: 'Create' });
  if (!name) return;
  try {
    const p = await call('projects:create', { name, templateId });
    await refreshProjects();
    await openProject(p.id);
  } catch (e) {
    toast('error', 'Could not create project', errorMessage(e));
  }
}

export async function importZip() {
  const r = await call('dialog:open', { title: 'Upload project (ZIP)', filters: [{ name: 'ZIP archives', extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return;
  try {
    const p = await call('projects:importZip', r.filePaths[0]);
    await refreshProjects();
    toast('success', 'Project imported', p.name);
    await openProject(p.id);
  } catch (e) {
    toast('error', 'Could not import the ZIP file', errorMessage(e));
  }
}

export async function importFolder(dir) {
  let folder = dir;
  if (!folder) {
    const r = await call('dialog:open', { title: 'Open a folder as a project', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return;
    folder = r.filePaths[0];
  }
  try {
    const p = await call('projects:importFolder', folder);
    await refreshProjects();
    await openProject(p.id);
  } catch (e) {
    toast('error', 'Could not open folder', errorMessage(e));
  }
}

async function openPathFromOS(p) {
  if (/\.zip$/i.test(p)) {
    const proj = await call('projects:importZip', p);
    await refreshProjects();
    return openProject(proj.id);
  }
  const dir = /\.(tex|ltx|bib)$/i.test(p) ? p.replace(/[\\/][^\\/]+$/, '') : p;
  return importFolder(dir);
}

export async function openProject(id) {
  if (getState().project) await closeProject({ toDashboard: false });
  let res;
  try {
    res = await call('projects:open', id);
  } catch (e) {
    toast('error', 'Could not open project', errorMessage(e));
    return;
  }
  const s = getState().settings;
  resetProjectState();
  setState({ project: res.project, tree: res.tree, screen: 'editor', editorMode: s.defaultEditorMode || 'source' });
  call('comments:load', id).then((comments) => {
    setState({ comments: comments || [] });
    editor.refreshComments();
  });
  await refreshIndex();
  const main = res.project.mainFile;
  const exists = findNode(res.tree, main);
  const first = exists ? main : firstTexFile(res.tree);
  if (first) await editor.openFile(first);
  // Show the last compiled PDF straight away.
  call('compile:readPdf', id)
    .then((data) => data && setState({ pdf: { data, version: getState().pdf.version + 1, path: null } }))
    .catch(() => {});
  call('history:snapshot', id, { reason: 'open' }).catch(() => {});
  // Check the packages a template needs before the first compile.
  const ok = await preflightPackages();
  if (ok) compile();
}

export async function closeProject({ toDashboard = true } = {}) {
  const p = getState().project;
  if (!p) return;
  await editor.saveAll();
  await persistCommentsNow();
  call('history:snapshot', p.id, { reason: 'close' }).catch(() => {});
  await call('projects:close', p.id).catch(() => {});
  editor.closeAll();
  resetProjectState();
  if (toDashboard) {
    setState({ screen: 'dashboard' });
    refreshProjects();
  }
}

export async function updateProject(patch) {
  const p = getState().project;
  if (!p) return;
  const next = await call('projects:update', p.id, patch);
  setState({ project: next });
  return next;
}

export function findNode(nodes, path) {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const f = findNode(n.children, path);
      if (f) return f;
    }
  }
  return null;
}

function firstTexFile(nodes) {
  for (const n of nodes) if (n.type === 'file' && /\.tex$/i.test(n.name)) return n.path;
  for (const n of nodes) if (n.children) {
    const f = firstTexFile(n.children);
    if (f) return f;
  }
  return null;
}

// ------------------------------------------------------------------ tree & files
let treeTimer = 0;
export async function refreshTree() {
  const p = getState().project;
  if (!p) return;
  try {
    const tree = await call('fs:tree', p.id);
    setState({ tree });
  } catch {
    /* project folder may have moved */
  }
}

function onFsChanged({ projectId, paths }) {
  const p = getState().project;
  if (!p || p.id !== projectId) return;
  clearTimeout(treeTimer);
  treeTimer = setTimeout(refreshTree, 150);
  editor.reloadChanged(paths);
  if (paths.some((x) => /\.(bib|tex|sty|cls|png|jpe?g|pdf|eps|svg)$/i.test(x))) scheduleIndex();
}

let indexTimer = 0;
function scheduleIndex() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(refreshIndex, 1500);
}

export async function refreshIndex() {
  const p = getState().project;
  if (!p) return;
  try {
    setState({ index: await call('index:project', p.id) });
  } catch {
    /* ignore */
  }
}

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

function validName(name) {
  if (!name || !name.trim()) return 'Enter a name.';
  if (/[<>:"\\|?*]/.test(name)) return 'Names cannot contain < > : " \\ | ? *';
  return null;
}

export async function newFile(dir = '') {
  const p = getState().project;
  const name = await prompt({ title: 'New file', label: 'File name', value: 'untitled.tex', okLabel: 'Create', validate: validName });
  if (!name) return;
  const rel = joinPath(dir, name.trim());
  try {
    await call('fs:create', p.id, rel, false, '');
    await refreshTree();
    await editor.openFile(rel);
  } catch (e) {
    toast('error', 'Could not create file', errorMessage(e));
  }
}

export async function newFolder(dir = '') {
  const p = getState().project;
  const name = await prompt({ title: 'New folder', label: 'Folder name', value: '', placeholder: 'e.g. figures', okLabel: 'Create', validate: validName });
  if (!name) return;
  try {
    await call('fs:create', p.id, joinPath(dir, name.trim()), true);
    setState({ expanded: { ...getState().expanded, [joinPath(dir, name.trim())]: true } });
    await refreshTree();
  } catch (e) {
    toast('error', 'Could not create folder', errorMessage(e));
  }
}

export async function uploadFiles(dir = '', paths = null) {
  const p = getState().project;
  let files = paths;
  if (!files) {
    const r = await call('dialog:open', { title: 'Upload files', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return;
    files = r.filePaths;
  }
  try {
    const added = await call('fs:upload', p.id, dir, files);
    await refreshTree();
    scheduleIndex();
    toast('success', `Added ${added.length} item${added.length === 1 ? '' : 's'}`, added.slice(0, 5).join('\n'));
  } catch (e) {
    toast('error', 'Upload failed', errorMessage(e));
  }
}

export async function renamePath(path, newName) {
  const p = getState().project;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  let name = newName;
  if (name == null) {
    name = await prompt({ title: 'Rename', label: 'New name', value: path.split('/').pop(), okLabel: 'Rename', validate: validName });
  }
  if (!name || name === path.split('/').pop()) return;
  const to = joinPath(dir, name.trim());
  await movePath(path, to);
}

export async function movePath(from, to) {
  const p = getState().project;
  if (from === to) return;
  try {
    await editor.saveAll();
    await call('fs:rename', p.id, from, to);
    editor.renameOpenFile(from, to);
    if (p.mainFile === from || p.mainFile.startsWith(from + '/')) await updateProject({ mainFile: to + p.mainFile.slice(from.length) });
    setState({ comments: getState().comments.map((c) => (c.file === from || c.file.startsWith(from + '/') ? { ...c, file: to + c.file.slice(from.length) } : c)) });
    persistComments();
    await refreshTree();
    scheduleIndex();
  } catch (e) {
    toast('error', 'Could not rename', errorMessage(e));
  }
}

export async function deletePath(path) {
  const p = getState().project;
  const ok = await confirm({ title: 'Delete', message: `Move "${path}" to the Recycle Bin?`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  try {
    await call('fs:remove', p.id, path);
    for (const f of Object.keys(getState().dirty)) if (f === path || f.startsWith(path + '/')) editor.forgetFile(f);
    if (editor.isOpen(path) || getState().openPath === path || (getState().openPath || '').startsWith(path + '/')) {
      editor.forgetFile(getState().openPath);
      const main = getState().project.mainFile;
      if (main !== path) editor.openFile(main);
    }
    await refreshTree();
    scheduleIndex();
  } catch (e) {
    toast('error', 'Could not delete', errorMessage(e));
  }
}

export async function setMainFile(path) {
  await updateProject({ mainFile: path });
  toast('success', 'Main document set', path);
  compile();
}

// ------------------------------------------------------------------ compile
let autoTimer = 0;
let pendingCompile = null;
let lastSnapshot = 0;

function onEditorChange(rel) {
  const s = getState();
  if (!s.settings.autoCompile || !s.project) return;
  if (!/\.(tex|bib|sty|cls|ltx|bbx|cbx)$/i.test(rel)) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => compile({ auto: true }), Math.max(800, s.settings.autoCompileDelay || 2500));
}

function onEditorSaved(rel) {
  if (/\.(tex|bib)$/i.test(rel)) scheduleIndex();
  maybeSnapshot();
}

function maybeSnapshot(force = false) {
  const p = getState().project;
  if (!p) return;
  if (!force && Date.now() - lastSnapshot < 3 * 60 * 1000) return;
  lastSnapshot = Date.now();
  call('history:snapshot', p.id, { reason: 'auto' }).catch(() => {});
}

export async function saveAndCompile() {
  await editor.saveAll();
  compile();
}

export async function compile(opts = {}) {
  const s = getState();
  if (!s.project) return;
  if (s.compile.running) {
    pendingCompile = opts;
    return;
  }
  clearTimeout(autoTimer);
  const projectId = s.project.id;
  await editor.saveAll();
  setState({ compile: { ...getState().compile, running: true, liveLog: '' } });
  let res;
  try {
    res = await call('compile:run', projectId, { draft: opts.draft, fromScratch: opts.fromScratch, enableInstaller: opts.enableInstaller });
  } catch (e) {
    setState({ compile: { ...getState().compile, running: false, status: 'failure' } });
    toast('error', 'Compile failed', errorMessage(e));
    return;
  }
  if (!getState().project || getState().project.id !== projectId) return;
  const issues = res.issues || emptyIssues;
  setState({ compile: { ...getState().compile, running: false, status: res.status, result: res, lastRun: Date.now() }, issues });

  if (res.status === 'missing') {
    handleMissing(res.missing || [], (extra) => compile({ ...opts, ...extra }), false, opts.installRound || 0);
  } else if (res.status === 'no-tex') {
    openDialog('tex');
  } else if (res.status === 'timeout') {
    toast('error', 'Compile timed out', 'The document took too long to compile. You can raise the time limit in Settings > Compiler.');
  }

  if (res.pdfPath && (res.pdfUpdated || !getState().pdf.data)) {
    try {
      const data = await call('compile:readPdf', projectId);
      if (data) setState({ pdf: { data, version: getState().pdf.version + 1, path: res.pdfPath } });
    } catch {
      /* ignore */
    }
  } else if (res.pdfPath && !getState().pdf.path) {
    setState({ pdf: { ...getState().pdf, path: res.pdfPath } });
  }
  if ((res.status === 'failure' && !res.pdfPath) || (res.status === 'failure' && issues.errors.length)) setState({ pdfTab: 'logs' });
  else if (res.status === 'success' && getState().pdfTab === 'logs' && !issues.errors.length && !opts.keepLogs) setState({ pdfTab: 'pdf' });
  editor.refreshLint();
  maybeSnapshot();

  if (pendingCompile) {
    const next = pendingCompile;
    pendingCompile = null;
    compile(next);
  }
}

export function stopCompile() {
  const p = getState().project;
  if (p) call('compile:stop', p.id);
  pendingCompile = null;
}

export async function clearCache() {
  const p = getState().project;
  if (!p) return;
  await call('compile:clean', p.id);
  toast('success', 'Cached files cleared', 'The next compile will start from scratch.');
}

// ------------------------------------------------------------------ packages
export async function preflightPackages() {
  const p = getState().project;
  const s = getState().settings;
  if (!p || !getState().tex?.found || s.missingPackages === 'never') return true;
  let res;
  try {
    res = await call('tex:check', p.id);
  } catch {
    return true;
  }
  // Files we cannot map to a package may be false positives; the compile will catch real ones.
  const known = (res.missing || []).filter((m) => m.package);
  if (!known.length) return true;
  handleMissing(known, (extra) => compile({ ...extra }), true);
  return false;
}

const MAX_INSTALL_ROUNDS = 10;

/**
 * Ask to install missing packages. Once the student agrees, later rounds for the same
 * compile (packages often reveal further dependencies one at a time) install without asking again.
 */
function handleMissing(missing, retry, preflight = false, round = 0) {
  const s = getState().settings;
  const known = missing.filter((m) => m.package);
  if (s.missingPackages === 'never' || round >= MAX_INSTALL_ROUNDS) {
    toast('warning', 'Missing LaTeX packages', missing.map((m) => m.file).join(', '));
    setState({ pdfTab: 'logs' });
    return;
  }
  const auto = round > 0 || (s.missingPackages === 'always' && known.length === missing.length);
  openDialog('packages', { missing, preflight, auto, retry: (extra = {}) => retry({ ...extra, installRound: round + 1 }) });
}

export async function installPackages(pkgs) {
  return call('tex:install', pkgs);
}

// ------------------------------------------------------------------ synctex
export async function syncToPdf() {
  const s = getState();
  const info = editor.cursorInfo();
  if (!s.project || !info) return;
  const pdfPath = s.pdf.path || (s.compile.result && s.compile.result.pdfPath);
  if (!pdfPath) return toast('info', 'Nothing to show yet', 'Compile the project first.');
  const rects = await call('synctex:forward', s.project.id, pdfPath, info.file, info.line, info.col).catch(() => []);
  if (!rects.length) return toast('info', 'No matching location', 'SyncTeX could not find this line in the PDF. Try recompiling.');
  if (s.settings.layout === 'editor') updateSettings({ layout: 'split' });
  setState({ syncTarget: { rects, ts: Date.now() }, pdfTab: 'pdf' });
}

export async function syncFromPdfCenter() {
  const { pdfCenter } = await import('./components/PdfView');
  const c = pdfCenter();
  if (!c) return toast('info', 'Nothing to show yet', 'Compile the project first.');
  return syncFromPdf(c.page, c.x, c.y);
}

export async function syncFromPdf(page, x, y) {
  const s = getState();
  const pdfPath = s.pdf.path || (s.compile.result && s.compile.result.pdfPath);
  if (!s.project || !pdfPath) return;
  const r = await call('synctex:reverse', s.project.id, pdfPath, page, x, y).catch(() => null);
  if (r && r.file) editor.jumpTo(r.file, r.line, 0);
}

// ------------------------------------------------------------------ comments
let commentTimer = 0;
export function persistComments() {
  clearTimeout(commentTimer);
  commentTimer = setTimeout(persistCommentsNow, 500);
}

async function persistCommentsNow() {
  clearTimeout(commentTimer);
  const p = getState().project;
  if (p) await call('comments:save', p.id, getState().comments).catch(() => {});
}

export function startComment() {
  const sel = editor.selectionForComment();
  if (!sel) {
    toast('info', 'Select some text first', 'Highlight the text you want to comment on, then choose Add Comment.');
    return;
  }
  setState({ commentDraft: sel, sidebarPanel: 'review', sidebarOpen: true });
}

export function saveComment(text) {
  const draft = getState().commentDraft;
  if (!draft || !text.trim()) return;
  const c = {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ...draft,
    text: text.trim(),
    author: getState().settings.userName,
    ts: Date.now(),
    resolved: false,
    replies: [],
  };
  setState({ comments: [...getState().comments, c], commentDraft: null, activeComment: c.id });
  editor.addCommentMark(c);
  editor.highlightComment(c.id);
  persistComments();
}

export function updateComment(id, patch) {
  setState({ comments: getState().comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  editor.refreshComments();
  persistComments();
}

export function deleteComment(id) {
  setState({ comments: getState().comments.filter((c) => c.id !== id), activeComment: null });
  editor.refreshComments();
  persistComments();
}

// ------------------------------------------------------------------ misc
export async function downloadPdf() {
  const p = getState().project;
  if (!p) return;
  try {
    const f = await call('compile:savePdf', p.id);
    if (f) toast('success', 'PDF saved', f);
  } catch (e) {
    toast('error', 'Could not save the PDF', errorMessage(e));
  }
}

export async function exportZip(projectId) {
  const id = projectId || getState().project?.id;
  if (!id) return;
  const proj = getState().projects.find((x) => x.id === id) || getState().project;
  const r = await call('dialog:save', { title: 'Download source as ZIP', defaultPath: `${proj.name}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return;
  if (getState().project?.id === id) await editor.saveAll();
  try {
    await call('projects:exportZip', id, r.filePath);
    toast('success', 'Source downloaded', r.filePath);
  } catch (e) {
    toast('error', 'Could not create the ZIP file', errorMessage(e));
  }
}

export async function openProjectFolder() {
  const p = getState().project;
  if (p) call('app:openPath', p.path);
}
