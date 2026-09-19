// First-run test for a PC without LaTeX: the setup screen should install the bundled MiKTeX.
// Usage: SMOKE_EXE=release\win-unpacked\FreedomTex.exe node scripts/test-firstrun.mjs
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

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

/** On failure, print what MiKTeX setup left behind so CI logs explain the problem. */
function diagnostics() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  for (const dir of [path.join(local, 'Programs', 'MiKTeX'), path.join(local, 'MiKTeX')]) {
    console.log(`--- ${dir} exists: ${fs.existsSync(dir)}`);
    if (!fs.existsSync(dir)) continue;
    const logs = [];
    const walk = (d, depth) => {
      if (depth > 5) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (/\.log$/i.test(e.name)) logs.push(p);
      }
    };
    try {
      walk(dir, 0);
    } catch {
      /* ignore */
    }
    for (const l of logs.slice(-6)) {
      console.log(`--- tail of ${l}`);
      console.log(fs.readFileSync(l, 'utf8').split(/\r?\n/).slice(-25).join('\n'));
    }
  }
  try {
    console.log('--- processes');
    console.log(execSync('tasklist /FI "IMAGENAME eq basic-miktex*" /FI "STATUS eq RUNNING"', { encoding: 'utf8' }));
    console.log(execSync('tasklist', { encoding: 'utf8' }).split(/\r?\n/).filter((l) => /miktex|setup|FreedomTex/i.test(l)).join('\n'));
  } catch {
    /* ignore */
  }
}

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
    // Echo the setup log while we wait.
    let printed = 0;
    for (;;) {
      const state = await win.evaluate(() => ({
        done: !!document.body.innerText.match(/You are all set|Setup did not finish/),
        log: document.querySelector('.console')?.innerText || '',
      }));
      const lines = state.log.split('\n');
      for (const l of lines.slice(printed)) if (l.trim()) console.log(`  setup: ${l}`);
      printed = lines.length;
      if (state.done) break;
      if (Date.now() - t0 > 25 * 60000) throw new Error('MiKTeX setup did not finish within 25 minutes');
      await sleep(15000);
    }
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
  diagnostics();
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
