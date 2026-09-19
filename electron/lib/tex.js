'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const settings = require('./settings');
const paths = require('./paths');
const { exists, run, walk, exeName, IS_WIN } = require('./util');

const IS_MAC = process.platform === 'darwin';
let detected = null;

function texLiveYears(base) {
  try {
    return fs.readdirSync(base).filter((y) => /^\d{4}(basic)?$/.test(y)).sort().reverse();
  } catch {
    return [];
  }
}

function candidateBinDirs() {
  const dirs = [];
  const s = settings.get();
  if (s.texBinPath) dirs.push(s.texBinPath);
  const home = os.homedir();
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(path.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'));
    dirs.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX', 'miktex', 'bin', 'x64'));
    dirs.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'MiKTeX', 'miktex', 'bin'));
    for (const base of ['C:\\texlive', path.join(home, 'texlive')]) {
      for (const y of texLiveYears(base)) for (const a of ['windows', 'win64', 'win32']) dirs.push(path.join(base, y, 'bin', a));
    }
  } else {
    // Apps started from Finder get a minimal PATH, so list the usual TeX locations explicitly.
    dirs.push('/Library/TeX/texbin'); // MacTeX and BasicTeX
    for (const base of ['/usr/local/texlive', path.join(home, 'texlive')]) {
      for (const y of texLiveYears(base)) {
        for (const a of ['universal-darwin', 'arm64-darwin', 'x86_64-darwin', 'x86_64-darwinlegacy', 'x86_64-linux', 'aarch64-linux']) dirs.push(path.join(base, y, 'bin', a));
      }
    }
    dirs.push(path.join(home, 'bin')); // MiKTeX for macOS (private setup)
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  for (const p of (process.env.PATH || '').split(path.delimiter)) if (p) dirs.push(p);
  return [...new Set(dirs)];
}

async function detect(force = false) {
  if (detected && !force) return detected;
  let result = { found: false };
  for (const dir of candidateBinDirs()) {
    if (!exists(path.join(dir, exeName('pdflatex')))) continue;
    const isMiktex = exists(path.join(dir, exeName('miktex'))) || exists(path.join(dir, exeName('mpm')));
    const isTexLive = !isMiktex && (exists(path.join(dir, 'tlmgr.bat')) || exists(path.join(dir, 'tlmgr')));
    const v = await run(path.join(dir, exeName('pdflatex')), ['--version'], { timeout: 20000 });
    const firstLine = (v.stdout || '').split(/\r?\n/)[0] || '';
    const tools = {};
    for (const t of ['pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'makeindex', 'synctex', 'kpsewhich', 'findtexmf', 'texdoc', 'mthelp', 'miktex-console', 'tlmgr']) {
      tools[t] = exists(path.join(dir, exeName(t))) || (IS_WIN && exists(path.join(dir, `${t}.bat`)));
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
  if (!IS_WIN) return null;
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
  const exe = path.join(detected.binDir, exeName(name));
  if (exists(exe)) return exe;
  if (IS_WIN) {
    const bat = path.join(detected.binDir, `${name}.bat`);
    if (exists(bat)) return bat;
  }
  return null;
}

/** TeX Live installs are usually owned by root on macOS/Linux, so tlmgr needs administrator rights. */
function texLiveNeedsAdmin() {
  if (IS_WIN || !detected || !detected.binDir) return false;
  try {
    fs.accessSync(fs.realpathSync(path.join(detected.binDir, 'tlmgr')), fs.constants.W_OK);
    const root = path.resolve(fs.realpathSync(path.join(detected.binDir, 'tlmgr')), '..', '..', '..');
    fs.accessSync(root, fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Run tlmgr, elevating when needed: macOS password dialog, pkexec on Linux, or sudo -n in CI. */
function runTlmgr(args, onData, timeout) {
  const tlmgr = toolPath('tlmgr');
  if (!texLiveNeedsAdmin()) return run(tlmgr, args, { env: texEnv(), onData, timeout });
  if (process.env.FREEDOMTEX_SUDO === '1') return run('sudo', ['-n', tlmgr, ...args], { env: texEnv(), onData, timeout });
  if (IS_MAC) {
    onData && onData('Asking for your Mac password to install into TeX Live...\n');
    const cmd = [tlmgr, ...args].map(shellQuote).join(' ') + ' 2>&1';
    const script = `do shell script ${JSON.stringify(cmd)} with administrator privileges`;
    return run('/usr/bin/osascript', ['-e', script], { onData, timeout });
  }
  return run('pkexec', [tlmgr, ...args], { env: texEnv(), onData, timeout });
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

let manifestPkgFiles = new Map(); // package -> its .sty/.cls file names

async function loadManifestIndex() {
  if (manifestIndex) return manifestIndex;
  const file = manifestCandidates().find(exists);
  const map = new Map();
  const pkgFiles = new Map();
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
        if (/\.(sty|cls)$/.test(base)) {
          if (!pkgFiles.has(pkg)) pkgFiles.set(pkg, []);
          pkgFiles.get(pkg).push(base);
        }
      }
    }
  }
  manifestIndex = map;
  manifestPkgFiles = pkgFiles;
  return map;
}

/** Full paths of already-installed files, keyed by lower-case file name. Never triggers installs. */
async function findInstalled(names) {
  const finder = (detected.type === 'miktex' && toolPath('findtexmf')) || toolPath('kpsewhich');
  const found = new Map();
  if (!finder) return found;
  for (let i = 0; i < names.length; i += 60) {
    const r = await run(finder, names.slice(i, i + 60), { env: texEnv(), timeout: 60000 });
    for (const line of r.stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (t) found.set(path.basename(t).toLowerCase(), t);
    }
  }
  return found;
}

const REQUIRE_RE = /\\(RequirePackage|RequirePackageWithOptions|usepackage|LoadClass|LoadClassWithOptions)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

// Code that only runs for a particular option or when some file happens to exist.
// Macro definitions (\def, \newcommand) are included: code in their bodies only runs when called.
const CONDITIONAL_RE = /\\DeclareOption\*?\s*(?:\{[^{}]*\})?\s*\{|\\IfFileExists\s*\{[^{}]*\}\s*\{|\\@ifpackageloaded\s*\{[^{}]*\}\s*\{|\\@ifclassloaded\s*\{[^{}]*\}\s*\{|\\@ifpackagewith\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\{|\\IfPackageLoadedTF\s*\{[^{}]*\}\s*\{|\\(?:long\\|protected\\)?[gex]?def\s*\\[a-zA-Z@]+[^{\n]*\{|\\(?:re)?newcommand\*?\s*\{?\\[a-zA-Z@]+\}?\s*(?:\[\d\])?(?:\[[^\]]*\])?\s*\{|\\providecommand\*?\s*\{?\\[a-zA-Z@]+\}?\s*(?:\[\d\])?\s*\{/g;

function stripConditionalCode(text) {
  let out = '';
  let last = 0;
  CONDITIONAL_RE.lastIndex = 0;
  let m;
  while ((m = CONDITIONAL_RE.exec(text))) {
    const open = CONDITIONAL_RE.lastIndex - 1; // the "{" of the conditional body
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      const c = text[end];
      if (c === '\\') {
        end++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    out += text.slice(last, m.index) + ' ';
    last = end + 1;
    CONDITIONAL_RE.lastIndex = last;
  }
  return out + text.slice(last);
}

/**
 * MiKTeX package metadata does not list dependencies, and LaTeX reveals only one missing file per
 * compile. So read the .sty/.cls files of freshly installed packages, as LaTeX would, and return the
 * packages they load that are not installed yet.
 */
/** The file LaTeX loads for a package (hyperref -> hyperref.sty); all its .sty/.cls if there is no such file. */
function mainFilesOf(pkgs) {
  const out = [];
  for (const p of pkgs) {
    const files = manifestPkgFiles.get(p) || [];
    const main = files.filter((b) => b === `${p.toLowerCase()}.sty` || b === `${p.toLowerCase()}.cls`);
    out.push(...(main.length ? main : files));
  }
  return [...new Set(out)];
}

/**
 * Follows the files LaTeX would actually load (not every helper file shipped with a package), so
 * optional extras are not downloaded. Returns missing packages plus the files that need them,
 * which are scanned in the next round.
 */
async function missingDependencies(filesToScan, alreadyHave = []) {
  const idx = await loadManifestIndex();
  const files = [...new Set(filesToScan)];
  if (!files.length) return { pkgs: [], files: [] };
  const located = await findInstalled(files);
  const wanted = new Set();
  for (const full of located.values()) {
    let text;
    try {
      text = stripConditionalCode(stripComments(await fsp.readFile(full, 'utf8')));
    } catch {
      continue;
    }
    REQUIRE_RE.lastIndex = 0;
    let m;
    while ((m = REQUIRE_RE.exec(text))) {
      const ext = /LoadClass/.test(m[1]) ? '.cls' : '.sty';
      for (let n of m[2].split(',')) {
        n = n.trim();
        if (!n || /[#\\@\s]/.test(n)) continue;
        wanted.add((n.toLowerCase().endsWith(ext) ? n : n + ext).toLowerCase());
      }
    }
  }
  const names = [...wanted].filter((n) => idx.has(n));
  if (!names.length) return { pkgs: [], files: [] };
  const have = await findInstalled(names);
  const missingFiles = names.filter((n) => !have.has(n));
  const pkgs = [...new Set(missingFiles.map((n) => idx.get(n)))].filter((p) => p && !alreadyHave.includes(p));
  return { pkgs, files: missingFiles };
}

const TRANSIENT_NET = /SSL connect error|Couldn't connect|Could not connect|timed out|Timeout was reached|Couldn't resolve|transfer closed|Connection reset|HTTP (5\d\d)/i;

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
      const doInstall = (list) =>
        miktex
          ? run(miktex, ['--verbose', 'packages', 'install', ...list], { env: texEnv(), onData: log, timeout: 30 * 60000 })
          : run(mpm, ['--verbose', ...list.map((p) => `--install=${p}`)], { env: texEnv(), onData: log, timeout: 30 * 60000 });
      const install = async (list) => {
        let r = await doInstall(list);
        let out = r.stdout + r.stderr;
        if (r.code !== 0 && TRANSIENT_NET.test(out)) {
          log('\nThe download was interrupted. Trying once more...\n');
          r = await doInstall(list);
          out = r.stdout + r.stderr;
        }
        if (r.code !== 0 && /unknown package|not found|database/i.test(out)) {
          log('\nRefreshing the MiKTeX package database, then retrying...\n');
          if (miktex) await run(miktex, ['--verbose', 'packages', 'update-package-database'], { env: texEnv(), onData: log, timeout: 10 * 60000 });
          else await run(mpm, ['--update-db'], { env: texEnv(), onData: log, timeout: 10 * 60000 });
          r = await doInstall(list);
          out = r.stdout + r.stderr;
        }
        if (r.code !== 0 && !/already installed/i.test(out)) return (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n');
        return null;
      };
      const err = await install(unique);
      if (err) return { ok: false, error: err };
      manifestIndex = null; // file lists may have changed after an update
      // Install what the new packages load, so one prompt is enough for the whole document.
      const installed = [...unique];
      await loadManifestIndex();
      let scan = mainFilesOf(unique);
      for (let depth = 0; depth < 10 && scan.length; depth++) {
        let next;
        try {
          next = await missingDependencies(scan, installed);
        } catch {
          break;
        }
        if (!next.pkgs.length) break;
        log(`\nAlso installing packages these need: ${next.pkgs.join(', ')}\n`);
        if (await install(next.pkgs)) break; // not fatal: the next compile will report anything still missing
        manifestIndex = null;
        await loadManifestIndex();
        installed.push(...next.pkgs);
        scan = next.files;
      }
      return { ok: true, installed };
    }
    if (detected.type === 'texlive') {
      let r = await runTlmgr(['install', ...unique], log, 30 * 60000);
      const out = `${r.stdout}\n${r.stderr}`;
      if (r.code !== 0 && /tlmgr itself needs to be updated|update --self/i.test(out)) {
        log('\nUpdating tlmgr first, then retrying...\n');
        await runTlmgr(['update', '--self'], log, 15 * 60000);
        r = await runTlmgr(['install', ...unique], log, 30 * 60000);
      }
      if (r.code !== 0) {
        const msg = `${r.stdout}\n${r.stderr}`;
        if (/User canceled|-128/.test(msg)) return { ok: false, error: 'The password prompt was cancelled, so nothing was installed.' };
        if (/is older than remote repository|Cross release updates/i.test(msg)) {
          return { ok: false, error: 'Your TeX Live is from an older year than the package server. Install the current MacTeX or BasicTeX from tug.org/mactex, then try again.' };
        }
        return { ok: false, error: msg.trim().split(/\r?\n/).slice(-6).join('\n') };
      }
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
  const log = (s) => onProgress && onProgress(s);
  log(`Running ${path.basename(installer)} ${args.join(' ')}\n`);
  const binDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64');
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      // No pipes: waiting for pipes to close can hang if the installer leaves a helper process running.
      // The window stays visible so MiKTeX's own progress and any message it shows can be seen.
      child = require('child_process').spawn(installer, args, { stdio: 'ignore', windowsHide: false });
    } catch (err) {
      resolve({ code: -1, error: err });
      return;
    }
    let done = false;
    let readySince = 0;
    let timer = null;
    const finish = (code, why) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      log(`MiKTeX setup finished (${why}, code ${code}).\n`);
      resolve({ code });
    };
    child.on('exit', (code) => finish(code == null ? -1 : code, 'installer exited'));
    child.on('error', (err) => {
      log(`Could not start the installer: ${err.message}\n`);
      finish(-1, 'start error');
    });
    timer = setInterval(() => {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      const ready = exists(path.join(binDir, 'pdflatex.exe')) && exists(path.join(binDir, 'initexmf.exe'));
      if (ready && !readySince) readySince = Date.now();
      log(`Installing MiKTeX: ${mins} min${ready ? ', engines installed, finishing up' : ''}\n`);
      // Engines present for a while but the installer is still around: treat setup as done.
      if (readySince && Date.now() - readySince > 3 * 60000) finish(0, 'engines ready');
      if (Date.now() - started > 60 * 60000) {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        finish(-3, 'time limit');
      }
    }, 5000);
  });
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

const BASICTEX_URL = 'https://mirror.ctan.org/systems/mac/mactex/BasicTeX.pkg';

/** macOS: download BasicTeX (TeX Live for Mac, about 100 MB), open Apple's installer, and wait for it. */
async function downloadAndInstallMac(onProgress) {
  const dest = path.join(os.tmpdir(), 'BasicTeX.pkg');
  let last = 0;
  await download(BASICTEX_URL, dest, ({ got, total }) => {
    if (Date.now() - last > 400) {
      last = Date.now();
      onProgress && onProgress(`Downloading BasicTeX: ${(got / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ''}\n`);
    }
  });
  onProgress && onProgress('Opening the macOS installer. Follow its steps; it will ask for your Mac password.\n');
  await run('/usr/bin/open', ['-W', dest], { timeout: 60 * 60000 });
  for (let i = 0; i < 20; i++) {
    const info = await detect(true);
    if (info.found) return info;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('TeX was not found after the installer closed. If you cancelled it, try again, or install MacTeX from tug.org/mactex.');
}

async function downloadAndInstall(onProgress) {
  if (IS_MAC) return downloadAndInstallMac(onProgress);
  if (!IS_WIN) throw new Error('Install TeX Live with your package manager (for example: sudo apt install texlive-full), then choose Detect again.');
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
