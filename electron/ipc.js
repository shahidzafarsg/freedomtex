'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ipcMain, dialog, shell, BrowserWindow, app, nativeTheme, session } = require('electron');
const settings = require('./lib/settings');
const projects = require('./lib/projects');
const fsops = require('./lib/fsops');
const tex = require('./lib/tex');
const compiler = require('./lib/compiler');
const synctex = require('./lib/synctex');
const history = require('./lib/history');
const gitops = require('./lib/gitops');
const indexer = require('./lib/indexer');
const zotero = require('./lib/zotero');
const paths = require('./lib/paths');
const { readJSON, writeJSON } = require('./lib/util');

const watchers = new Map(); // projectId -> stop()

function send(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/** Wrap handlers so errors reach the renderer as { error } instead of rejected promises with stack noise. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function register(getWindow) {
  const proj = (id) => projects.get(id);

  // ---------------------------------------------------------------- app
  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged,
    spellLanguages: session.defaultSession.availableSpellCheckerLanguages || [],
  }));
  handle('settings:get', () => settings.get());
  handle('settings:set', (_e, patch) => {
    const s = settings.update(patch);
    if ('theme' in patch) nativeTheme.themeSource = s.theme;
    if ('spellLanguage' in patch || 'spellCheck' in patch) applySpell(s);
    return s;
  });
  handle('app:openExternal', (_e, url) => {
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error('Blocked URL');
    return shell.openExternal(url);
  });
  handle('app:openPath', (_e, p) => shell.openPath(p));
  handle('app:showItem', (_e, p) => shell.showItemInFolder(p));
  handle('app:titleBar', (e, opts) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && process.platform === 'win32' && w.setTitleBarOverlay) w.setTitleBarOverlay(opts);
    if (w && opts.color) w.setBackgroundColor(opts.color);
    return true;
  });
  handle('app:zoom', (e, level) => {
    e.sender.setZoomLevel(level);
    return level;
  });
  handle('app:fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });
  handle('app:devtools', (e) => e.sender.toggleDevTools());
  handle('app:quit', () => app.quit());
  handle('app:closeReady', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) {
      w.__ftCanClose = true;
      w.close();
    }
    return true;
  });
  handle('app:readResource', (_e, name) => {
    const allowed = { license: 'LICENSE', notices: 'THIRD_PARTY_NOTICES.md' };
    const file = allowed[name];
    if (!file) throw new Error('Unknown resource');
    const p = app.isPackaged ? path.join(process.resourcesPath, file) : path.join(paths.repoRoot, file);
    return fs.readFileSync(p, 'utf8');
  });

  // ---------------------------------------------------------------- dialogs
  handle('dialog:open', (e, opts) => dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), opts));
  handle('dialog:save', (e, opts) => dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), opts));

  // ---------------------------------------------------------------- projects
  handle('projects:list', () => projects.list());
  handle('projects:templates', () => projects.listTemplates());
  handle('projects:create', (_e, opts) => projects.create(opts));
  handle('projects:importFolder', (_e, dir) => projects.importFolder(dir));
  handle('projects:importZip', (_e, file, name) => projects.importZip(file, name));
  handle('projects:update', (_e, id, patch) => projects.update(id, patch));
  handle('projects:duplicate', (_e, id, name) => projects.duplicate(id, name));
  handle('projects:deleteForever', (_e, id) => projects.removeForever(id));
  handle('projects:exportZip', (_e, id, dest) => projects.exportZip(id, dest));
  handle('projects:findMain', (_e, id) => projects.findMainFile(proj(id).path));
  handle('tags:create', (_e, name, color) => projects.createTag(name, color));
  handle('tags:update', (_e, id, patch) => projects.updateTag(id, patch));
  handle('tags:delete', (_e, id) => projects.deleteTag(id));

  handle('projects:open', async (_e, id) => {
    const p = proj(id);
    if (!fs.existsSync(p.path)) throw new Error(`The project folder no longer exists:\n${p.path}`);
    projects.update(id, { lastOpened: Date.now() });
    for (const [pid, stop] of watchers) {
      stop();
      watchers.delete(pid);
    }
    watchers.set(id, fsops.watch(p.path, (changed) => send('fs:changed', { projectId: id, paths: changed })));
    const tree = await fsops.tree(p.path, { hideBuildFiles: settings.get().hideBuildFiles });
    return { project: { ...projects.get(id) }, tree };
  });
  handle('projects:close', (_e, id) => {
    const stop = watchers.get(id);
    if (stop) stop();
    watchers.delete(id);
    return true;
  });

  // ---------------------------------------------------------------- files
  handle('fs:tree', (_e, id) => fsops.tree(proj(id).path, { hideBuildFiles: settings.get().hideBuildFiles }));
  handle('fs:read', (_e, id, rel) => fsops.read(proj(id).path, rel));
  handle('fs:write', async (_e, id, rel, content) => {
    const r = await fsops.write(proj(id).path, rel, content);
    projects.touch(id);
    return r;
  });
  handle('fs:writeBinary', (_e, id, rel, data) => fsops.writeBinary(proj(id).path, rel, data));
  handle('fs:create', (_e, id, rel, isDir, content) => fsops.create(proj(id).path, rel, isDir, content));
  handle('fs:rename', (_e, id, from, to) => fsops.rename(proj(id).path, from, to));
  handle('fs:remove', (_e, id, rel) => fsops.remove(proj(id).path, rel));
  handle('fs:upload', (_e, id, destDir, files) => fsops.upload(proj(id).path, destDir, files));
  handle('fs:search', (_e, id, q, opts) => fsops.search(proj(id).path, q, opts));
  handle('fs:replaceAll', (_e, id, q, rep, opts, only) => fsops.replaceAll(proj(id).path, q, rep, opts, only));
  handle('fs:absPath', (_e, id, rel) => path.join(proj(id).path, rel || ''));
  handle('fs:exportFile', async (e, id, rel) => {
    const src = path.join(proj(id).path, rel);
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: path.basename(rel) });
    if (r.canceled || !r.filePath) return null;
    await fsp.copyFile(src, r.filePath);
    return r.filePath;
  });
  handle('index:project', (_e, id) => indexer.index(proj(id).path));
  handle('index:wordcount', (_e, id, file) => indexer.wordCount(proj(id).path, file || proj(id).mainFile));

  // ---------------------------------------------------------------- compile
  handle('compile:run', async (e, id, opts = {}) => {
    const p = proj(id);
    const s = settings.get();
    const res = await compiler.compile(p, { ...opts, timeout: s.compileTimeout }, (chunk) => {
      if (!e.sender.isDestroyed()) e.sender.send('compile:log', { projectId: id, chunk });
    });
    return res;
  });
  handle('compile:stop', (_e, id) => compiler.stop(id));
  handle('compile:clean', (_e, id) => compiler.clean(id));
  handle('compile:outputs', (_e, id) => compiler.outputFiles(id));
  handle('compile:readPdf', async (_e, id) => {
    const dir = paths.buildDir(id);
    const p = proj(id);
    const job = path.posix.basename(p.mainFile || 'main.tex').replace(/\.[^.]+$/, '');
    const file = path.join(dir, `${job}.pdf`);
    if (!fs.existsSync(file)) return null;
    return new Uint8Array(await fsp.readFile(file));
  });
  handle('compile:savePdf', async (e, id) => {
    const p = proj(id);
    const job = path.posix.basename(p.mainFile || 'main.tex').replace(/\.[^.]+$/, '');
    const file = path.join(paths.buildDir(id), `${job}.pdf`);
    if (!fs.existsSync(file)) throw new Error('Compile the project first.');
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      defaultPath: path.join(app.getPath('downloads'), `${p.name}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await fsp.copyFile(file, r.filePath);
    return r.filePath;
  });
  handle('compile:saveOutput', async (e, file) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: path.basename(file) });
    if (r.canceled || !r.filePath) return null;
    await fsp.copyFile(file, r.filePath);
    return r.filePath;
  });
  handle('compile:openOutputDir', (_e, id) => {
    const dir = paths.buildDir(id);
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('compile:openPdfExternal', (_e, id) => {
    const p = proj(id);
    const job = path.posix.basename(p.mainFile || 'main.tex').replace(/\.[^.]+$/, '');
    return shell.openPath(path.join(paths.buildDir(id), `${job}.pdf`));
  });

  // ---------------------------------------------------------------- synctex
  handle('synctex:forward', (_e, id, pdfPath, file, line, col) => synctex.forward(proj(id).path, pdfPath, file, line, col));
  handle('synctex:reverse', (_e, id, pdfPath, page, x, y) => synctex.reverse(proj(id).path, pdfPath, page, x, y));

  // ---------------------------------------------------------------- TeX distribution
  handle('tex:detect', (_e, force) => tex.detect(force));
  handle('tex:check', (_e, id) => tex.checkProject(proj(id).path));
  handle('tex:resolve', (_e, files) => tex.resolvePackages(files));
  handle('tex:install', (e, pkgs) => tex.installPackages(pkgs, (s) => !e.sender.isDestroyed() && e.sender.send('tex:progress', s)));
  handle('tex:updateDb', (e) => tex.updateDatabase((s) => !e.sender.isDestroyed() && e.sender.send('tex:progress', s)));
  handle('tex:installBundled', (e) => tex.installBundled((s) => !e.sender.isDestroyed() && e.sender.send('tex:progress', s)));
  handle('tex:downloadInstall', (e) => tex.downloadAndInstall((s) => !e.sender.isDestroyed() && e.sender.send('tex:progress', s)));
  handle('tex:console', () => tex.openConsole());
  handle('tex:docs', (_e, name) => tex.packageDocs(name));

  // ---------------------------------------------------------------- history
  handle('history:list', (_e, id) => history.list(id));
  handle('history:snapshot', (_e, id, opts) => history.snapshot(proj(id), { author: settings.get().userName, ...(opts || {}) }));
  handle('history:files', (_e, id, v) => history.files(id, v));
  handle('history:file', (_e, id, v, rel) => history.getFile(id, v, rel));
  handle('history:prevFile', (_e, id, v, rel) => history.getPreviousFile(id, v, rel));
  handle('history:restoreFile', (_e, id, v, rel) => history.restoreFile(proj(id), v, rel));
  handle('history:restoreVersion', (_e, id, v) => history.restoreVersion(proj(id), v));
  handle('history:label', (_e, id, v, text) => history.addLabel(id, v, text));
  handle('history:unlabel', (_e, id, v, labelId) => history.removeLabel(id, v, labelId));

  // ---------------------------------------------------------------- comments
  const commentsFile = (id) => paths.userData('comments', `${id}.json`);
  handle('comments:load', (_e, id) => readJSON(commentsFile(id), []));
  handle('comments:save', (_e, id, list) => {
    writeJSON(commentsFile(id), list);
    return true;
  });

  // ---------------------------------------------------------------- zotero
  handle('zotero:status', () => zotero.status());
  handle('zotero:setCreds', (_e, userId, key) => zotero.setWebCreds(userId, key));
  handle('zotero:libraries', (_e, source) => zotero.libraries(source));
  handle('zotero:collections', (_e, source, lib) => zotero.collections(source, lib));
  handle('zotero:import', async (_e, id, opts) => {
    const p = proj(id);
    const r = await zotero.importToProject(p, opts);
    // Remember the link so the bibliography can be refreshed with one click.
    projects.update(id, {
      zotero: {
        source: opts.source,
        lib: opts.lib,
        collection: opts.collection || '',
        collectionName: opts.collectionName || '',
        includeSub: opts.includeSub !== false,
        format: opts.format,
        file: r.file,
        mode: opts.mode,
        lastImport: Date.now(),
      },
    });
    return { ...r, project: projects.get(id) };
  });

  // ---------------------------------------------------------------- git
  handle('git:status', (_e, id) => gitops.status(proj(id).path));
  handle('git:init', (_e, id) => gitops.init(proj(id).path));
  handle('git:commit', (_e, id, msg) => gitops.commit(proj(id).path, msg, settings.get().gitName, settings.get().gitEmail));
  handle('git:push', (_e, id) => gitops.push(proj(id).path));
  handle('git:pull', (_e, id) => gitops.pull(proj(id).path));
  handle('git:remote', (_e, id, url) => gitops.setRemote(proj(id).path, url));
}

function applySpell(s) {
  try {
    const ses = session.defaultSession;
    ses.setSpellCheckerEnabled(!!s.spellCheck);
    const avail = ses.availableSpellCheckerLanguages || [];
    const lang = avail.includes(s.spellLanguage) ? s.spellLanguage : avail.find((l) => l.startsWith('en')) || avail[0];
    if (lang && process.platform !== 'darwin') ses.setSpellCheckerLanguages([lang]);
  } catch {
    /* spell checker unavailable */
  }
}

function stopAllWatchers() {
  for (const stop of watchers.values()) stop();
  watchers.clear();
}

module.exports = { register, applySpell, stopAllWatchers };
