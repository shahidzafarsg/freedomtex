// End-to-end smoke test: launches the built app with a throwaway data folder,
// creates projects from templates, compiles them and saves screenshots.
// Usage: node scripts/smoke.mjs [step...]
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'scripts', '.smoke');
const userData = path.join(out, 'userdata');
const projectsRoot = path.join(out, 'projects');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ projectsRoot, setupDone: true, theme: process.env.THEME || 'light', windowBounds: { width: 1440, height: 900 } }));

const env = { ...process.env, FREEDOMTEX_USERDATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
// SMOKE_EXE=release\win-unpacked\FreedomTex.exe tests the packaged build instead of the source tree.
const packaged = process.env.SMOKE_EXE;
const app = await electron.launch({ executablePath: packaged || electronPath, args: packaged ? [] : [root], env });
const win = await app.firstWindow();
const logs = [];
win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const shot = async (name) => {
  await win.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`screenshot: ${name}.png`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Cmd on a Mac, Ctrl elsewhere (the app treats both the same; CodeMirror expects Cmd on macOS).
const MAC = process.platform === 'darwin';
const MOD = MAC ? 'Meta' : 'Control';

try {
  await win.waitForSelector('.dash, .setup', { timeout: 30000 });
  await sleep(800);
  await shot('01-dashboard');

  // Create a project from the example template through the UI.
  await win.click('text=New Project');
  await win.click('text=Example Project');
  await win.waitForSelector('.modal input');
  await win.fill('.modal input', 'Smoke Example');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.cm-editor', { timeout: 30000 });
  // Wait for the compile to finish (PDF page appears or logs show).
  await win.waitForSelector('.pdf-page canvas, .log-item', { timeout: 180000 });
  await sleep(2500);
  await shot('02-editor-example');

  const status = await win.evaluate(() => document.querySelector('.statusbar')?.innerText);
  console.log('status bar:', status.replace(/\n/g, ' | '));
  const canvases = await win.evaluate(() => document.querySelectorAll('.pdf-page canvas').length);
  console.log('rendered pdf canvases:', canvases);

  // Forward search: jump from the "Mathematics" section to the PDF.
  await win.click('.outline-row >> text=Mathematics');
  await sleep(300);
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press(`${MOD}+Alt+ArrowRight`);
  const hl = await win.waitForSelector('.pdf-highlight', { timeout: 15000 }).then(() => true).catch(() => false);
  console.log('synctex forward highlight:', hl);
  await sleep(700);
  await shot('02b-synctex');

  // Visual mode
  await win.click('button[title="Visual editor"]');
  await sleep(300);
  await win.click('.outline-row >> text=Mathematics');
  await sleep(1200);
  await shot('03-visual-mode');
  await win.click('button[title="Code editor"]');

  // Logs panel
  await win.keyboard.press(`${MOD}+j`);
  await sleep(600);
  await shot('04-logs');
  await win.keyboard.press(`${MOD}+j`);

  // Dark mode
  await win.keyboard.press(`${MOD}+Shift+l`);
  await sleep(800);
  await shot('05-dark');

  // Menus (in-window on Windows; macOS uses the system menu bar)
  if (!MAC) {
    await win.click('.menu-trigger >> text=Insert');
    await sleep(300);
    await shot('06-menu-insert');
    await win.keyboard.press('Escape');
  }

  // About dialog
  if (MAC) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'about'));
  } else {
    await win.click('.menu-trigger >> text=About');
    await win.click('.menu-item >> text=About FreedomTex');
  }
  await sleep(500);
  await shot('07-about');
  await win.keyboard.press('Escape');
  await win.keyboard.press(`${MOD}+Shift+l`); // back to light

  // Word count
  await win.keyboard.press(`${MOD}+Shift+w`);
  await win.waitForSelector('.stats', { timeout: 15000 });
  await sleep(300);
  await shot('08-wordcount');
  await win.keyboard.press('Escape');

  // Settings
  await win.keyboard.press(`${MOD}+,`);
  await sleep(400);
  await win.click('.settings-nav >> text=Editor');
  await sleep(300);
  await shot('09-settings');
  await win.keyboard.press('Escape');

  // History (make an edit first so there are two versions)
  await win.click('.cm-content');
  await win.keyboard.press(MAC ? 'Meta+ArrowDown' : 'Control+End');
  await win.keyboard.type('\n% edited by smoke test\n');
  await sleep(1500);
  await win.keyboard.press(`${MOD}+Shift+h`);
  await win.waitForSelector('.version-item', { timeout: 15000 });
  await sleep(800);
  await shot('10-history');
  await win.keyboard.press(`${MOD}+Shift+h`);

  // Templates gallery (from the dashboard)
  await win.click('.rail .icon-btn >> nth=0');
  await win.waitForSelector('.dash');
  await win.click('text=New Project');
  await win.click('text=From a Template...');
  await win.waitForSelector('.tpl-card');
  await sleep(500);
  await shot('11-templates');
  await win.keyboard.press('Escape');
  await sleep(300);
  await shot('12-dashboard-list');
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'console.log'), logs.join('\n'));
  console.log(`console messages: ${logs.length} (errors: ${logs.filter((l) => /error/i.test(l)).length})`);
  await app.close().catch(() => {});
}
