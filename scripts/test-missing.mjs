// UI test of the missing-package flow: edit a document to need an uninstalled class,
// expect the "Packages needed" prompt, install, and confirm the compile succeeds.
// Usage: node scripts/test-missing.mjs [class-name]   (default: exam)
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const cls = process.argv[2] || 'exam';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'scripts', '.smoke', 'missing');
const userData = path.join(out, 'userdata');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ projectsRoot: path.join(out, 'projects'), setupDone: true, windowBounds: { width: 1440, height: 900 } }));

const env = { ...process.env, FREEDOMTEX_USERDATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath, args: [root], env });
const win = await app.firstWindow();
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) }).then(() => console.log(`screenshot: ${n}.png`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await win.waitForSelector('.dash', { timeout: 30000 });
  // A capture forces a repaint; Windows throttles frames for occluded windows, which stalls Playwright's checks.
  await sleep(800);
  await shot('00-start');
  await win.click('text=New Project');
  await win.click('.menu-item >> text=Blank Project');
  await win.fill('.modal input', 'Missing Package Test');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.pdf-page canvas', { timeout: 120000 });
  console.log('blank project compiled');

  await win.click('.cm-content');
  await win.keyboard.press('Control+a');
  await win.keyboard.insertText(`\\documentclass{${cls}}\n\\begin{document}\n\\begin{questions}\n\\question[2] What is $2+2$?\n\\question[3] Name a LaTeX editor.\n\\end{questions}\n\\end{document}\n`);
  const t0 = Date.now();
  await win.waitForSelector('.modal >> text=Packages needed', { timeout: 60000 });
  console.log(`prompt appeared after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await sleep(300);
  await shot('01-prompt');
  const rows = await win.evaluate(() => [...document.querySelectorAll('.pkg-row')].map((r) => r.innerText.replace(/\n/g, ' ')));
  console.log('prompt lists:', rows.join(' | '));

  await win.click('.modal >> text=Install and compile');
  await win.waitForSelector('.modal >> text=Installing packages', { timeout: 10000 }).then(() => shot('02-installing')).catch(() => {});
  await win.waitForFunction(() => /Compiled/.test(document.querySelector('.statusbar')?.innerText || ''), null, { timeout: 300000 });
  await sleep(1500);
  await shot('03-compiled');
  console.log('status:', (await win.evaluate(() => document.querySelector('.statusbar').innerText)).replace(/\n/g, ' | '));
} catch (e) {
  console.error('FAILED:', e.message);
  await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
