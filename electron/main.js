'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, protocol, net, Menu, nativeTheme, shell, session } = require('electron');
const settings = require('./lib/settings');
const projects = require('./lib/projects');
const paths = require('./lib/paths');
const ipc = require('./ipc');

app.setAppUserModelId('org.freedomtex.app');

// Lets automated tests (and portable setups) use a separate data folder.
if (process.env.FREEDOMTEX_USERDATA) app.setPath('userData', process.env.FREEDOMTEX_USERDATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'ftasset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const DIST_DIR = path.join(__dirname, '..', 'dist');
const APP_URL = 'app://bundle/index.html';

// Startup log (userData/logs/main.log) so problems on students' PCs can be diagnosed.
function log(...parts) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'main.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
  } catch {
    /* logging must never break startup */
  }
}
log('start', { version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged, exe: process.execPath, argv: process.argv.slice(1) });
process.on('uncaughtException', (err) => log('uncaughtException', String((err && err.stack) || err)));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log('another instance is running; handing over and quitting');
  app.quit();
}

let mainWindow = null;
let pendingOpen = null; // file/folder passed on the command line

function argTarget(argv) {
  const candidates = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  for (const a of candidates) {
    try {
      if (fs.existsSync(a)) return path.resolve(a);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function themeColors() {
  const s = settings.get();
  const dark = s.theme === 'dark' || (s.theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? { bg: '#0f1217', fg: '#e6e9ef' } : { bg: '#f4f6f8', fg: '#1b2330' };
}

function createWindow() {
  const s = settings.get();
  nativeTheme.themeSource = s.theme || 'system';
  const colors = themeColors();
  const bounds = s.windowBounds || { width: 1440, height: 900 };

  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'FreedomTex',
    backgroundColor: colors.bg,
    icon: isMac ? undefined : paths.iconPath(),
    // macOS keeps its traffic-light buttons (top left); Windows draws caption buttons over our title bar.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  log('window created', { bounds, theme: s.theme });

  // Show the window as soon as it has painted, but never rely on that alone: on some PCs Chromium
  // does not paint a hidden window, so 'ready-to-show' never fires and the app looks dead.
  let shown = false;
  const showOnce = (why) => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    log('showing window', why);
    if (s.maximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', () => showOnce('ready-to-show'));
  mainWindow.webContents.once('did-finish-load', () => setTimeout(() => showOnce('did-finish-load'), 150));
  setTimeout(() => showOnce('timeout'), 3000);
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('did-fail-load', { code, desc, url });
    showOnce('did-fail-load');
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => log('render-process-gone', details));
  mainWindow.on('unresponsive', () => log('window unresponsive'));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  mainWindow.loadURL(devUrl || APP_URL);

  // Links clicked inside the app open in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if ((devUrl && url.startsWith(devUrl)) || url.startsWith('app://bundle/')) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // Spelling suggestions and basic clipboard actions.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const sug of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: sug, click: () => mainWindow.webContents.replaceMisspelling(sug) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({
        label: 'Add to dictionary',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const patch = { maximized };
    if (!maximized && !mainWindow.isFullScreen()) patch.windowBounds = mainWindow.getBounds();
    settings.update(patch);
  };

  // Let the renderer flush unsaved edits before the window closes.
  mainWindow.on('close', (e) => {
    saveBounds();
    if (mainWindow.__ftCanClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app:before-close');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.__ftCanClose = true;
        mainWindow.close();
      }
    }, 4000);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      mainWindow.webContents.send('app:open-path', pendingOpen);
      pendingOpen = null;
    }
  });

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:native-theme', nativeTheme.shouldUseDarkColors);
  });
}

function registerAppProtocol() {
  // app://bundle/... serves the built renderer. A real origin (unlike file://) lets pdf.js use its worker.
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const abs = path.resolve(DIST_DIR, rel);
    if (!abs.startsWith(path.resolve(DIST_DIR) + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
}

function registerAssetProtocol() {
  // ftasset://<projectId>/<relative path> serves project files (images) to the renderer.
  protocol.handle('ftasset', async (request) => {
    try {
      const url = new URL(request.url);
      const p = projects.get(url.hostname);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const abs = path.resolve(p.path, rel);
      if (!abs.toLowerCase().startsWith(path.resolve(p.path).toLowerCase() + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(abs).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

app.on('second-instance', (_e, argv) => {
  log('second-instance', argv.slice(1));
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const t = argTarget(argv);
    if (t) mainWindow.webContents.send('app:open-path', t);
  }
});

/**
 * macOS: the menu bar lives at the top of the screen. The renderer sends its menu layout
 * (labels, shortcuts, checked/enabled state) and we mirror it natively.
 */
const EDIT_ROLES = { cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll' };

function macMenu(menus) {
  const send = (id) => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('menu:command', id);
  const convert = (items) =>
    items.map((it) => {
      if (it.separator) return { type: 'separator' };
      if (it.items) return { label: it.label, submenu: convert(it.items) };
      if (EDIT_ROLES[it.id]) return { role: EDIT_ROLES[it.id] };
      const item = { label: it.label, enabled: it.enabled !== false, click: () => send(it.id) };
      if (it.checked != null) {
        item.type = 'checkbox';
        item.checked = !!it.checked;
      }
      if (it.accelerator) item.accelerator = it.accelerator;
      return item;
    });
  const template = [
    {
      label: 'FreedomTex',
      submenu: [
        { label: 'About FreedomTex', click: () => send('about') },
        { type: 'separator' },
        { label: 'Settings...', accelerator: 'Cmd+,', click: () => send('preferences') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    ...(menus || []).filter((m) => m.id !== 'about').map((m) => ({ label: m.label, submenu: convert(m.items) })),
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('child-process-gone', (_e, details) => log('child-process-gone', details));

app.whenReady().then(() => {
  if (!gotLock) return;
  log('ready');
  if (process.platform === 'darwin') {
    macMenu([]);
    require('electron').ipcMain.on('app:setMenu', (_e, menus) => {
      try {
        macMenu(menus);
      } catch (err) {
        console.error('menu', err);
      }
    });
  } else {
    Menu.setApplicationMenu(null);
  }
  pendingOpen = argTarget(process.argv);
  registerAppProtocol();
  registerAssetProtocol();
  ipc.register(() => mainWindow);
  ipc.applySpell(settings.get());

  // Content Security Policy for the packaged renderer.
  if (!process.env.VITE_DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ftasset:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ftasset: data: blob:",
          ],
        },
      });
    });
  }

  createWindow();
});

app.on('window-all-closed', () => {
  ipc.stopAllWatchers();
  app.quit();
});
