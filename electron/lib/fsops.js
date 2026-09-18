'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { shell } = require('electron');
const { resolveInside, isTextFile, looksBinary, toPosix, walk, exists } = require('./util');

const IGNORED = new Set(['.git', 'node_modules', '.freedomtex', '__pycache__', '.svn', 'Thumbs.db', '.DS_Store', 'desktop.ini']);
const BUILD_EXT = /\.(aux|log|synctex\.gz|synctex|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml|nav|snm|vrb|idx|ind|ilg|glo|gls|glg|ist|acn|acr|alg|nlo|nls|xdv|dvi|loa|lol|thm|brf|xwm|auxlock)$/i;

async function tree(root, { hideBuildFiles = true } = {}) {
  async function rec(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes = [];
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: r, type: 'dir', children: await rec(path.join(dir, e.name), r) });
      } else if (e.isFile()) {
        if (hideBuildFiles && BUILD_EXT.test(e.name)) continue;
        nodes.push({ name: e.name, path: r, type: 'file' });
      }
    }
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
    return nodes;
  }
  return rec(root, '');
}

async function read(root, rel) {
  const abs = resolveInside(root, rel);
  const st = await fsp.stat(abs);
  if (st.size > 15 * 1024 * 1024) return { kind: 'binary', size: st.size, mtime: st.mtimeMs };
  const buf = await fsp.readFile(abs);
  if (!isTextFile(rel) && looksBinary(buf)) return { kind: 'binary', size: st.size, mtime: st.mtimeMs };
  if (looksBinary(buf) && !/\.(tex|bib|sty|cls|txt)$/i.test(rel)) return { kind: 'binary', size: st.size, mtime: st.mtimeMs };
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { kind: 'text', content: text, size: st.size, mtime: st.mtimeMs };
}

async function readBinary(root, rel) {
  return fsp.readFile(resolveInside(root, rel));
}

async function write(root, rel, content) {
  const abs = resolveInside(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.ftsave`;
  await fsp.writeFile(tmp, content, 'utf8');
  try {
    await fsp.rename(tmp, abs);
  } catch {
    // Another program (e.g. antivirus or a PDF viewer) may hold the file; fall back to a direct write.
    await fsp.writeFile(abs, content, 'utf8');
    await fsp.rm(tmp, { force: true });
  }
  return (await fsp.stat(abs)).mtimeMs;
}

async function create(root, rel, isDir, content = '') {
  const abs = resolveInside(root, rel);
  if (exists(abs)) throw new Error(`"${rel}" already exists`);
  if (isDir) await fsp.mkdir(abs, { recursive: true });
  else {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  }
  return rel;
}

async function rename(root, from, to) {
  const a = resolveInside(root, from);
  const b = resolveInside(root, to);
  if (a.toLowerCase() !== b.toLowerCase() && exists(b)) throw new Error(`"${to}" already exists`);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  return to;
}

async function remove(root, rel) {
  const abs = resolveInside(root, rel);
  if (abs === path.resolve(root)) throw new Error('Cannot delete the project root');
  await shell.trashItem(abs);
  return true;
}

async function upload(root, destDir, absPaths, overwrite = true) {
  const destAbs = resolveInside(root, destDir || '.');
  await fsp.mkdir(destAbs, { recursive: true });
  const added = [];
  for (const src of absPaths) {
    const name = path.basename(src);
    const target = path.join(destAbs, name);
    if (!overwrite && exists(target)) continue;
    const st = await fsp.stat(src);
    if (st.isDirectory()) await fsp.cp(src, target, { recursive: true, force: true });
    else await fsp.copyFile(src, target);
    added.push(toPosix(path.relative(root, target)));
  }
  return added;
}

async function writeBinary(root, rel, data) {
  const abs = resolveInside(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, Buffer.from(data));
  return rel;
}

/** Watch a project folder recursively (native on Windows) and report changed paths in batches. */
function watch(root, onChange) {
  let pending = new Set();
  let timer = null;
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const rel = toPosix(filename);
      const first = rel.split('/')[0];
      if (IGNORED.has(first) || rel.endsWith('.ftsave')) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = [...pending];
        pending = new Set();
        onChange(batch);
      }, 250);
    });
    watcher.on('error', () => {});
  } catch {
    return () => {};
  }
  return () => {
    clearTimeout(timer);
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(query, { regex, caseSensitive, wholeWord }) {
  let src = regex ? query : escapeRe(query);
  if (wholeWord) src = `\\b(?:${src})\\b`;
  return new RegExp(src, caseSensitive ? 'gu' : 'giu');
}

async function search(root, query, opts = {}) {
  if (!query) return { results: [], total: 0 };
  let re;
  try {
    re = buildRegex(query, opts);
  } catch (e) {
    return { error: `Invalid regular expression: ${e.message}`, results: [], total: 0 };
  }
  const files = (await walk(root)).filter((f) => isTextFile(f.rel) && !/\.(log|aux|bbl|blg|toc|out)$/i.test(f.rel));
  const results = [];
  let total = 0;
  for (const f of files) {
    let text;
    try {
      const st = await fsp.stat(f.abs);
      if (st.size > 5 * 1024 * 1024) continue;
      text = await fsp.readFile(f.abs, 'utf8');
    } catch {
      continue;
    }
    const matches = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && total < 5000; i++) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) && total < 5000) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        matches.push({ line: i + 1, col: m.index, length: m[0].length, text: lines[i].slice(0, 400) });
        total++;
      }
    }
    if (matches.length) results.push({ file: f.rel, matches });
  }
  return { results, total, truncated: total >= 5000 };
}

async function replaceAll(root, query, replacement, opts = {}, onlyFiles = null) {
  const re = buildRegex(query, opts);
  const files = (await walk(root)).filter((f) => isTextFile(f.rel) && (!onlyFiles || onlyFiles.includes(f.rel)));
  const changed = [];
  let count = 0;
  for (const f of files) {
    let text;
    try {
      text = await fsp.readFile(f.abs, 'utf8');
    } catch {
      continue;
    }
    let n = 0;
    const out = text.replace(re, (...args) => {
      n++;
      if (!opts.regex) return replacement;
      // Support $1-style groups in regex mode.
      const groups = args.slice(1, -2);
      return replacement.replace(/\$(\d+)/g, (_, g) => groups[Number(g) - 1] ?? '');
    });
    if (n > 0) {
      await fsp.writeFile(f.abs, out, 'utf8');
      changed.push(f.rel);
      count += n;
    }
  }
  return { changed, count };
}

module.exports = { tree, read, readBinary, write, writeBinary, create, rename, remove, upload, watch, search, replaceAll };
