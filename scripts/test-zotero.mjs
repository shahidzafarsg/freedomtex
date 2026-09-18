// UI test of the Zotero import against the Zotero desktop app running on this machine (read-only).
// Usage: node scripts/test-zotero.mjs [collection-name]
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const collectionName = process.argv[2] || '';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'scripts', '.smoke', 'zotero');
const userData = path.join(out, 'userdata');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ projectsRoot: path.join(out, 'projects'), setupDone: true, autoCompile: false, windowBounds: { width: 1440, height: 900 } }));

const env = { ...process.env, FREEDOMTEX_USERDATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath, args: [root], env });
const win = await app.firstWindow();
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) }).then(() => console.log(`screenshot: ${n}.png`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await win.waitForSelector('.dash', { timeout: 30000 });
  await sleep(800);
  await shot('00-start');
  await win.click('text=New Project');
  await win.click('.menu-item >> text=Example Project');
  await win.fill('.modal input', 'Zotero Test');
  await win.keyboard.press('Enter');
  await win.waitForSelector('.cm-editor', { timeout: 60000 });
  await sleep(1500);

  await win.click('.menu-trigger >> text=Tools');
  await win.click('.menu-item >> text=Import References from Zotero...');
  await win.waitForSelector('.modal >> text=Connected to the Zotero desktop app', { timeout: 20000 });
  await sleep(1200);
  const options = await win.evaluate(() => [...document.querySelectorAll('.modal select')[1].options].map((o) => o.textContent.trim()));
  console.log('collections offered:', options.join(' | '));
  if (collectionName) {
    const value = await win.evaluate((name) => [...document.querySelectorAll('.modal select')[1].options].find((o) => o.textContent.trim().startsWith(name))?.value, collectionName);
    await win.selectOption('.modal select >> nth=1', value);
  }
  await win.fill('.modal input[list="ft-bib-files"]', 'zotero.bib');
  await sleep(300);
  await shot('01-dialog');

  const t0 = Date.now();
  await win.click('.modal-footer >> text=Import');
  await win.waitForSelector('.modal >> text=saved to zotero.bib', { timeout: 120000 });
  console.log(`import took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await sleep(500);
  await shot('02-imported');
  console.log('result:', (await win.evaluate(() => document.querySelector('.modal .log-item')?.innerText || '')).replace(/\n/g, ' | '));

  const bib = fs.readFileSync(path.join(out, 'projects', 'Zotero Test', 'zotero.bib'), 'utf8');
  const keys = [...bib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)].map((m) => m[1]);
  console.log(`zotero.bib: ${keys.length} entries, ${new Set(keys).size} unique keys; first keys: ${keys.slice(0, 4).join(', ')}`);

  // Autocomplete should now offer the Zotero keys inside \cite{...}
  await win.keyboard.press('Escape');
  await sleep(1800);
  await win.click('.cm-content');
  await win.keyboard.press('Control+End');
  await win.keyboard.insertText('\n\\cite{');
  await win.keyboard.type(keys[0].slice(0, 3));
  const shown = await win.waitForSelector('.cm-tooltip-autocomplete', { timeout: 8000 }).then(() => true).catch(() => false);
  console.log('cite autocomplete shown:', shown);
  await sleep(400);
  await shot('03-cite-autocomplete');
} catch (e) {
  console.error('FAILED:', e.message);
  await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
