// First-run test for a PC without LaTeX: the setup screen should install the bundled MiKTeX.
// Usage: SMOKE_EXE=release\win-unpacked\FreedomTex.exe node scripts/test-firstrun.mjs
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'scripts', '.smoke', 'firstrun');
const userData = path.join(out, 'userdata');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ projectsRoot: path.join(out, 'projects'), windowBounds: { width: 1280, height: 860 } }));

const env = { ...process.env, FREEDOMTEX_USERDATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.SMOKE_EXE;
const app = await electron.launch({ executablePath: exe || electronPath, args: exe ? [] : [root], env });
const win = await app.firstWindow();
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) }).then(() => console.log(`screenshot: ${n}.png`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await win.waitForSelector('.setup, .dash', { timeout: 60000 });
  await sleep(800);
  await shot('01-first-screen');
  if (await win.$('.dash')) {
    console.log('LaTeX was already installed on this machine; the setup screen was skipped.');
  } else {
    const t0 = Date.now();
    await win.click('text=Install MiKTeX (included)');
    await win.waitForSelector('text=Setting up LaTeX', { timeout: 20000 });
    await shot('02-installing');
    await win.waitForSelector('text=You are all set, text=Setup did not finish', { timeout: 40 * 60000 });
    await shot('03-result');
    if (await win.$('text=Setup did not finish')) throw new Error(await win.evaluate(() => document.querySelector('.setup-card').innerText));
    console.log(`MiKTeX installed in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    await win.click('text=Get started');
    await win.waitForSelector('.dash', { timeout: 20000 });
  }
  await sleep(600);
  const engine = await win.evaluate(() => document.querySelector('.statusbar')?.innerText || '');
  console.log('status bar:', engine.replace(/\n/g, ' | '));
  if (!/MiKTeX|TeX Live/.test(engine)) throw new Error('No TeX distribution detected after setup');
  await shot('04-dashboard');
} catch (e) {
  console.error('FAILED:', e.message);
  await shot('99-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
