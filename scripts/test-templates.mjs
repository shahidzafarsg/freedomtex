// Creates a project from every template and compiles it through the app's IPC,
// installing missing packages the same way the UI does. Reports errors per template.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'scripts', '.smoke', 'templates');
const userData = path.join(out, 'userdata');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ projectsRoot: path.join(out, 'projects'), setupDone: true }));

const env = { ...process.env, FREEDOMTEX_USERDATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath, args: [root], env });
const win = await app.firstWindow();
await win.waitForSelector('.dash', { timeout: 30000 });

const only = process.argv.slice(2);
const templates = await win.evaluate(() => window.ft.call('projects:templates'));
let failures = 0;
for (const t of templates) {
  if (only.length && !only.includes(t.id)) continue;
  const started = Date.now();
  const result = await win.evaluate(async (tid) => {
    const p = await window.ft.call('projects:create', { name: `T ${tid}`, templateId: tid });
    const check = await window.ft.call('tex:check', p.id);
    const installed = [];
    if (check.missing.length) {
      const pkgs = [...new Set(check.missing.map((m) => m.package).filter(Boolean))];
      if (pkgs.length) {
        const r = await window.ft.call('tex:install', pkgs);
        installed.push(...pkgs, r.ok ? '(ok)' : `(failed: ${r.error})`);
      }
    }
    let res = await window.ft.call('compile:run', p.id, {});
    for (let i = 0; i < 10 && res.status === 'missing'; i++) {
      const pkgs = [...new Set(res.missing.map((m) => m.package).filter(Boolean))];
      if (pkgs.length) {
        const r = await window.ft.call('tex:install', pkgs);
        installed.push(...pkgs, r.ok ? '(ok)' : `(failed: ${r.error})`);
        res = await window.ft.call('compile:run', p.id, {});
      } else {
        res = await window.ft.call('compile:run', p.id, { enableInstaller: true });
      }
    }
    return {
      status: res.status,
      runs: res.runs,
      engine: res.engine,
      preflightMissing: check.missing.map((m) => `${m.file}->${m.package}`),
      missing: (res.missing || []).map((m) => `${m.file}->${m.package}`),
      installed,
      errors: res.issues.errors.map((e) => `${e.file || '?'}:${e.line || '?'} ${e.message}`).slice(0, 5),
      warnings: res.issues.warnings.length,
      badboxes: res.issues.typesetting.length,
      pdf: !!res.pdfPath,
    };
  }, t.id);
  const ok = result.status === 'success' && result.pdf && result.errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${t.id.padEnd(18)} ${result.status} runs=${result.runs} ${((Date.now() - started) / 1000).toFixed(1)}s warnings=${result.warnings} badboxes=${result.badboxes}`);
  if (result.preflightMissing.length) console.log(`     preflight missing: ${result.preflightMissing.join(', ')}`);
  if (result.installed.length) console.log(`     installed: ${result.installed.join(' ')}`);
  if (result.missing.length) console.log(`     still missing: ${result.missing.join(', ')}`);
  for (const e of result.errors) console.log(`     error: ${e}`);
}
await app.close();
console.log(failures ? `${failures} template(s) failed` : 'All templates compiled.');
process.exitCode = failures ? 1 : 0;
