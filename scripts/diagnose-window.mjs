// Launches the packaged app exactly like a double-click (default data folder) and reports window state.
import { _electron as electron } from 'playwright-core';

const exe = process.argv[2] || 'release\\win-unpacked\\FreedomTex.exe';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.FREEDOMTEX_USERDATA;
const app = await electron.launch({ executablePath: exe, args: [], env, timeout: 30000 });
await new Promise((r) => setTimeout(r, 6000));
const state = await app.evaluate(({ BrowserWindow, app: a }) =>
  BrowserWindow.getAllWindows().map((w) => ({
    visible: w.isVisible(),
    minimized: w.isMinimized(),
    bounds: w.getBounds(),
    url: w.webContents.getURL(),
    loading: w.webContents.isLoading(),
    crashed: w.webContents.isCrashed(),
    userData: a.getPath('userData'),
  })),
);
console.log(JSON.stringify(state, null, 2));
const win = app.windows()[0];
if (win) {
  console.log('title:', await win.title());
  console.log('screen text:', (await win.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\n/g, ' | '));
}
await app.close();
