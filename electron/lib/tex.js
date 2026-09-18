'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const settings = require('./settings');
const paths = require('./paths');
const { exists, run, walk } = require('./util');

let detected = null;

function candidateBinDirs() {
  const dirs = [];
  const s = settings.get();
  if (s.texBinPath) dirs.push(s.texBinPath);
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  dirs.push(path.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'));
  dirs.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX', 'miktex', 'bin', 'x64'));
  dirs.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'MiKTeX', 'miktex', 'bin'));
  // TeX Live: newest year first
  for (const base of ['C:\\texlive', path.join(os.homedir(), 'texlive')]) {
    try {
      const years = fs.readdirSync(base).filter((y) => /^\d{4}$/.test(y)).sort().reverse();
      for (const y of years) {
        dirs.push(path.join(base, y, 'bin', 'windows'));
        dirs.push(path.join(base, y, 'bin', 'win64'));
        dirs.push(path.join(base, y, 'bin', 'win32'));
      }
    } catch {
      /* not installed */
    }
  }
  for (const p of (process.env.PATH || '').split(path.delimiter)) if (p) dirs.push(p);
  return dirs;
}

async function detect(force = false) {
  if (detected && !force) return detected;
  let result = { found: false };
  for (const dir of candidateBinDirs()) {
    if (!exists(path.join(dir, 'pdflatex.exe'))) continue;
    const isMiktex = exists(path.join(dir, 'miktex.exe')) || exists(path.join(dir, 'mpm.exe'));
    const isTexLive = !isMiktex && exists(path.join(dir, 'tlmgr.bat'));
    const v = await run(path.join(dir, 'pdflatex.exe'), ['--version'], { timeout: 20000 });
    const firstLine = (v.stdout || '').split(/\r?\n/)[0] || '';
    const tools = {};
    for (const t of ['pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'makeindex', 'synctex', 'kpsewhich', 'findtexmf', 'texdoc', 'mthelp', 'miktex-console']) {
      tools[t] = exists(path.join(dir, `${t}.exe`));
    }
    let version = firstLine;
    const mv = /MiKTeX (\d+\.\d+)/.exec(firstLine);
    const tv = /TeX Live (\d{4})/.exec(firstLine);
    if (mv) version = `MiKTeX ${mv[1]}`;
    else if (tv) version = `TeX Live ${tv[1]}`;
    result = {
      found: true,
      type: isMiktex ? 'miktex' : isTexLive ? 'texlive' : 'other',
      binDir: dir,
      version,
      engineVersion: firstLine,
      tools,
    };
    break;
  }
  result.bundledInstaller = findBundledInstaller();
  detected = result;
  return result;
}

function findBundledInstaller() {
  const dir = paths.bundledMiktexDir();
  try {
    const f = fs.readdirSync(dir).find((n) => /^basic-miktex.*\.exe$/i.test(n));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

function toolPath(name) {
  if (!detected || !detected.found) return null;
  const exe = path.join(detected.binDir, `${name}.exe`);
  if (exists(exe)) return exe;
  const bat = path.join(detected.binDir, `${name}.bat`);
  if (exists(bat)) return bat;
  return null;
}

function texEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (detected && detected.found) env.PATH = `${detected.binDir}${path.delimiter}${env.PATH || ''}`;
  env.max_print_line = '10000';
  env.error_line = '254';
  env.half_error_line = '238';
  return env;
}

// ---------------------------------------------------------------- MiKTeX package index
let manifestIndex = null;

function manifestCandidates() {
  const out = [];
  if (detected && detected.binDir) {
    // <root>/miktex/bin/x64 -> <root>/miktex/config
    out.push(path.resolve(detected.binDir, '..', '..', 'config', 'package-manifests.ini'));
    out.push(path.resolve(detected.binDir, '..', 'config', 'package-manifests.ini'));
  }
  const local = process.env.LOCALAPPDATA || '';
  out.push(path.join(local, 'MiKTeX', 'miktex', 'config', 'package-manifests.ini'));
  out.push(path.join(process.env.ProgramData || 'C:\\ProgramData', 'MiKTeX', 'miktex', 'config', 'package-manifests.ini'));
  return out;
}

async function loadManifestIndex() {
  if (manifestIndex) return manifestIndex;
  const file = manifestCandidates().find(exists);
  const map = new Map();
  if (file) {
    const text = await fsp.readFile(file, 'utf8');
    let pkg = null;
    let start = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end === -1) end = text.length;
      const line = text.slice(start, end).trim();
      start = end + 1;
      if (line.startsWith('[')) {
        pkg = line.slice(1, -1);
      } else if (pkg && line.startsWith('run[]=')) {
        const base = line.slice(line.lastIndexOf('/') + 1).toLowerCase();
        if (!base || base.endsWith('.tpm')) continue;
        // Prefer ordinary packages over MiKTeX meta packages (they start with "_" or "miktex-").
        const prev = map.get(base);
        if (!prev || (/^(_|miktex-)/.test(prev) && !/^(_|miktex-)/.test(pkg))) map.set(base, pkg);
      }
    }
  }
  manifestIndex = map;
  return map;
}

/** Map missing file names to installable package names. */
async function resolvePackages(files) {
  await detect();
  const out = [];
  if (detected.type === 'miktex') {
    const idx = await loadManifestIndex();
    for (const f of files) {
      const name = f.toLowerCase();
      const tries = name.includes('.') ? [name] : [`${name}.sty`, `${name}.tex`, `${name}.cls`, name];
      let pkg = null;
      for (const t of tries) {
        if (idx.has(t)) {
          pkg = idx.get(t);
          break;
        }
      }
      out.push({ file: f, package: pkg });
    }
  } else if (detected.type === 'texlive') {
    const tlmgr = toolPath('tlmgr');
    for (const f of files) {
      let pkg = null;
      if (tlmgr) {
        const r = await run(tlmgr, ['search', '--global', '--file', `/${f}`], { env: texEnv(), timeout: 120000 });
        const m = /^([\w.-]+):\s*$/m.exec(r.stdout);
        if (m) pkg = m[1];
      }
      out.push({ file: f, package: pkg });
    }
  } else {
    for (const f of files) out.push({ file: f, package: null });
  }
  return out;
}

let installing = false;

async function installPackages(pkgs, onProgress) {
  await detect();
  if (!detected.found) throw new Error('No TeX distribution found.');
  if (installing) throw new Error('A package installation is already running.');
  installing = true;
  const log = (s) => onProgress && onProgress(s);
  try {
    const unique = [...new Set(pkgs.filter(Boolean))];
    if (!unique.length) return { ok: true, installed: [] };
    if (detected.type === 'miktex') {
      const miktex = toolPath('miktex');
      const mpm = toolPath('mpm');
      const doInstall = () =>
        miktex
          ? run(miktex, ['--verbose', 'packages', 'install', ...unique], { env: texEnv(), onData: log, timeout: 30 * 60000 })
          : run(mpm, ['--verbose', ...unique.map((p) => `--install=${p}`)], { env: texEnv(), onData: log, timeout: 30 * 60000 });
      let r = await doInstall();
      if (r.code !== 0 && /unknown package|not found|database/i.test(r.stdout + r.stderr)) {
        log('\nRefreshing the MiKTeX package database, then retrying...\n');
        if (miktex) await run(miktex, ['--verbose', 'packages', 'update-package-database'], { env: texEnv(), onData: log, timeout: 10 * 60000 });
        else await run(mpm, ['--update-db'], { env: texEnv(), onData: log, timeout: 10 * 60000 });
        r = await doInstall();
      }
      if (r.code !== 0) {
        const already = /already installed/i.test(r.stdout + r.stderr);
        if (!already) return { ok: false, error: (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n') };
      }
      manifestIndex = null; // file lists may have changed after an update
      return { ok: true, installed: unique };
    }
    if (detected.type === 'texlive') {
      const tlmgr = toolPath('tlmgr');
      const r = await run(tlmgr, ['install', ...unique], { env: texEnv(), onData: log, timeout: 30 * 60000 });
      if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n') };
      return { ok: true, installed: unique };
    }
    throw new Error('Automatic package installation needs MiKTeX or TeX Live.');
  } finally {
    installing = false;
  }
}

async function updateDatabase(onProgress) {
  await detect();
  const miktex = toolPath('miktex');
  if (!miktex) return { ok: false, error: 'Only available with MiKTeX.' };
  const r = await run(miktex, ['--verbose', 'packages', 'update-package-database'], { env: texEnv(), onData: onProgress, timeout: 10 * 60000 });
  return { ok: r.code === 0, error: r.code === 0 ? null : r.stderr };
}

// ---------------------------------------------------------------- dependency scan for templates
const SCAN_RE = [
  { re: /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ext: '.cls' },
  { re: /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ext: '.sty' },
  { re: /\\use(?:color|font|inner|outer)?theme\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ext: 'beamertheme' },
  { re: /\\bibliographystyle\s*\{([^}]+)\}/g, ext: '.bst' },
  { re: /\\usetikzlibrary\s*\{([^}]+)\}/g, ext: 'tikzlibrary' },
];

function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

async function scanRequirements(root) {
  const files = (await walk(root)).filter((f) => /\.(tex|sty|cls|ltx)$/i.test(f.rel));
  const localNames = new Set(
    (await walk(root)).map((f) => path.basename(f.rel).toLowerCase()),
  );
  const texts = [];
  for (const f of files) {
    try {
      texts.push({ f, text: stripComments(await fsp.readFile(f.abs, 'utf8')) });
    } catch {
      /* unreadable */
    }
  }
  // \usetheme means a beamer theme file only in beamer documents (tikzposter has its own themes).
  const isBeamer = texts.some(({ text }) => /\\documentclass\s*(\[[^\]]*\])?\s*\{beamer\}/.test(text));
  const needed = new Map(); // file -> source file
  for (const { f, text } of texts) {
    for (const { re, ext } of SCAN_RE) {
      if (ext === 'beamertheme' && !isBeamer) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        for (let name of m[1].split(',')) {
          name = name.trim();
          if (!name || /[#\\]/.test(name)) continue;
          let file;
          if (ext === 'beamertheme') {
            const kind = /\\use(color|font|inner|outer)?theme/.exec(m[0])[1] || '';
            file = `beamer${kind}theme${name}.sty`;
          } else if (ext === 'tikzlibrary') {
            continue; // shipped with pgf; checking every library is noisy
          } else {
            file = name.toLowerCase().endsWith(ext) ? name : name + ext;
          }
          if (localNames.has(file.toLowerCase())) continue;
          if (!needed.has(file)) needed.set(file, f.rel);
        }
      }
    }
  }
  return needed;
}

async function checkProject(root) {
  await detect();
  if (!detected.found) return { found: false, missing: [] };
  const needed = await scanRequirements(root);
  const names = [...needed.keys()];
  // MiKTeX's kpsewhich silently installs missing packages when auto-install is on, which would skip
  // our prompt. findtexmf (without -must-exist) only looks up files that are already installed.
  const finder = (detected.type === 'miktex' && toolPath('findtexmf')) || toolPath('kpsewhich');
  const foundSet = new Set();
  for (let i = 0; i < names.length; i += 60) {
    const chunk = names.slice(i, i + 60);
    const r = await run(finder, chunk, { env: texEnv(), cwd: root, timeout: 60000 });
    for (const line of r.stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (t) foundSet.add(path.basename(t).toLowerCase());
    }
  }
  const missingFiles = names.filter((n) => !foundSet.has(n.toLowerCase()));
  const resolved = await resolvePackages(missingFiles);
  return {
    found: true,
    checked: names.length,
    missing: resolved.map((r) => ({ ...r, source: needed.get(r.file) })),
  };
}

// ---------------------------------------------------------------- MiKTeX setup
function runInstaller(installer, onProgress) {
  // Only options documented for the MiKTeX Setup Wizard (Documentation/Ref/setupwiz.xml): per-user, no questions.
  const args = ['--unattended', '--private'];
  onProgress && onProgress(`Running ${path.basename(installer)} ${args.join(' ')}\n`);
  return run(installer, args, { onData: onProgress, timeout: 60 * 60000 });
}

async function installBundled(onProgress) {
  const installer = findBundledInstaller();
  if (!installer) throw new Error('The MiKTeX installer is not bundled with this copy of FreedomTex.');
  const r = await runInstaller(installer, onProgress);
  const info = await detect(true);
  if (!info.found) throw new Error(`MiKTeX setup did not finish (exit code ${r.code}).`);
  manifestIndex = null;
  return info;
}

const MIKTEX_URL = 'https://miktex.org/download/ctan/systems/win32/miktex/setup/windows-x64/basic-miktex-25.12-x64.exe';

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': 'FreedomTex' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed (HTTP ${res.statusCode})`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          if (onProgress) onProgress({ got, total });
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function downloadAndInstall(onProgress) {
  const dest = path.join(os.tmpdir(), 'basic-miktex-x64.exe');
  let last = 0;
  await download(MIKTEX_URL, dest, ({ got, total }) => {
    const now = Date.now();
    if (now - last > 400) {
      last = now;
      onProgress && onProgress(`Downloading MiKTeX: ${(got / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ''}\n`);
    }
  });
  const r = await runInstaller(dest, onProgress);
  fs.rm(dest, { force: true }, () => {});
  const info = await detect(true);
  if (!info.found) throw new Error(`MiKTeX setup did not finish (exit code ${r.code}).`);
  return info;
}

async function openConsole() {
  await detect();
  const c = toolPath('miktex-console');
  if (!c) return false;
  require('child_process').spawn(c, [], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

async function packageDocs(name) {
  await detect();
  const texdoc = toolPath('texdoc') || toolPath('mthelp');
  if (!texdoc) return { ok: false };
  const r = await run(texdoc, [name], { env: texEnv(), timeout: 30000 });
  return { ok: r.code === 0, output: r.stdout + r.stderr };
}

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

module.exports = {
  detect,
  toolPath,
  texEnv,
  resolvePackages,
  installPackages,
  updateDatabase,
  checkProject,
  installBundled,
  downloadAndInstall,
  openConsole,
  packageDocs,
  fileSha256,
  get info() {
    return detected;
  },
};
