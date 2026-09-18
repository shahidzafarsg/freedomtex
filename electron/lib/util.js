'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

const IS_WIN = process.platform === 'win32';

/** Executable file name for this platform (pdflatex -> pdflatex.exe on Windows). */
function exeName(name) {
  return IS_WIN ? `${name}.exe` : name;
}

/** Spawn a process and collect output. .bat/.cmd files need a shell on Windows. */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const needsShell = /\.(bat|cmd)$/i.test(cmd);
    const quotedArgs = needsShell ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)) : args;
    let child;
    try {
      child = spawn(needsShell ? `"${cmd}"` : cmd, quotedArgs, {
        cwd: opts.cwd,
        env: opts.env || process.env,
        windowsHide: true,
        shell: needsShell,
        // Own process group on macOS/Linux so a stopped compile also stops its children.
        detached: !IS_WIN,
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err.message || err), error: err });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (opts.timeout) {
      timer = setTimeout(() => {
        killTree(child.pid);
      }, opts.timeout);
    }
    if (opts.onSpawn) opts.onSpawn(child);
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.onData) opts.onData(s, 'stdout');
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.onData) opts.onData(s, 'stderr');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err.message || err), error: err });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, signal, stdout, stderr });
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    else process.kill(-pid, 'SIGKILL'); // negative pid = the whole process group
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

async function walk(root, opts = {}) {
  const ignore = opts.ignore || new Set(['.git', 'node_modules', '.freedomtex', '__pycache__', '.svn']);
  const out = [];
  async function rec(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (opts.dirs) out.push({ rel: r, abs, dir: true });
        await rec(abs, r);
      } else if (e.isFile()) {
        out.push({ rel: r, abs, dir: false });
      }
    }
  }
  await rec(root, '');
  return out;
}

const TEXT_EXT = new Set([
  'tex', 'ltx', 'latex', 'sty', 'cls', 'clo', 'cfg', 'def', 'bib', 'bst', 'bbx', 'cbx', 'lbx', 'dtx', 'ins', 'txt',
  'md', 'markdown', 'csv', 'tsv', 'dat', 'json', 'xml', 'yaml', 'yml', 'ist', 'lua', 'py', 'r', 'm', 'sh', 'bat',
  'ps1', 'js', 'ts', 'html', 'css', 'bbl', 'log', 'aux', 'toc', 'lof', 'lot', 'out', 'nav', 'snm', 'tikz', 'pgf',
  'asy', 'mp', 'gnuplot', 'gp', 'rnw', 'rtex', 'tsx', 'jsx', 'c', 'cpp', 'h', 'java', 'ini', 'cff', 'latexmkrc',
  'gitignore', 'glo', 'gls', 'ind', 'idx', 'nlo', 'nls', 'blg', 'fls', 'eps', 'svg', 'tab',
]);

function isTextFile(name) {
  const base = name.split('/').pop().toLowerCase();
  if (base === 'makefile' || base === 'readme' || base === 'license' || base === '.latexmkrc') return true;
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return TEXT_EXT.has(ext);
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function sanitizeName(name) {
  return String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80) || 'Untitled';
}

function uniquePath(dir, name) {
  let candidate = path.join(dir, name);
  let i = 2;
  while (exists(candidate)) {
    candidate = path.join(dir, `${name} (${i})`);
    i++;
  }
  return candidate;
}

async function copyDir(src, dest, filter) {
  await fsp.mkdir(dest, { recursive: true });
  await fsp.cp(src, dest, { recursive: true, force: true, filter: filter || (() => true) });
}

/** Resolve a project-relative path and refuse anything that escapes the project root. */
function resolveInside(root, rel) {
  const abs = path.resolve(root, rel || '.');
  const rootNorm = path.resolve(root);
  if (abs !== rootNorm && !abs.toLowerCase().startsWith(rootNorm.toLowerCase() + path.sep)) {
    throw new Error(`Path is outside the project: ${rel}`);
  }
  return abs;
}

module.exports = {
  IS_WIN,
  exeName,
  exists,
  isDir,
  toPosix,
  sha1,
  readJSON,
  writeJSON,
  uid,
  run,
  killTree,
  walk,
  isTextFile,
  looksBinary,
  sanitizeName,
  uniquePath,
  copyDir,
  resolveInside,
};
