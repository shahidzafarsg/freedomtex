'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { shell } = require('electron');
const AdmZip = require('adm-zip');
const settings = require('./settings');
const paths = require('./paths');
const {
  exists,
  readJSON,
  writeJSON,
  uid,
  walk,
  sanitizeName,
  uniquePath,
  copyDir,
  resolveInside,
  toPosix,
} = require('./util');

const storeFile = () => paths.userData('projects.json');
let db = null;

const TAG_COLORS = ['#0d9488', '#6366f1', '#e11d48', '#d97706', '#0284c7', '#7c3aed', '#16a34a', '#db2777'];

function load() {
  if (!db) {
    db = readJSON(storeFile(), null) || { projects: [], tags: [] };
    db.projects = db.projects || [];
    db.tags = db.tags || [];
  }
  return db;
}

function save() {
  writeJSON(storeFile(), load());
}

function publicProject(p) {
  return { ...p, missing: !exists(p.path) };
}

function list() {
  const d = load();
  return { projects: d.projects.map(publicProject), tags: d.tags };
}

function get(id) {
  const p = load().projects.find((x) => x.id === id);
  if (!p) throw new Error('Project not found');
  return p;
}

function newRecord(name, dir, extra = {}) {
  const now = Date.now();
  return {
    id: uid('p'),
    name,
    path: dir,
    managed: true,
    createdAt: now,
    updatedAt: now,
    lastOpened: now,
    tags: [],
    archived: false,
    trashed: false,
    compiler: settings.get().defaultCompiler || 'pdflatex',
    mainFile: 'main.tex',
    shellEscape: false,
    haltOnError: false,
    draft: false,
    spellLanguage: '',
    ...extra,
  };
}

function isCommentedOut(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const before = text.slice(lineStart, index);
  return /(^|[^\\])%/.test(before);
}

/** Find the file that holds \documentclass, preferring common names. */
async function findMainFile(root) {
  const files = (await walk(root)).filter((f) => /\.(tex|ltx)$/i.test(f.rel));
  const scored = [];
  for (const f of files) {
    let text = '';
    try {
      text = (await fsp.readFile(f.abs, 'utf8')).slice(0, 200000);
    } catch {
      continue;
    }
    const m = /\\documentclass/.exec(text);
    if (!m || isCommentedOut(text, m.index)) continue;
    let score = 0;
    if (/\\begin\s*\{document\}/.test(text)) score += 10;
    const base = path.basename(f.rel).toLowerCase();
    if (base === 'main.tex') score += 8;
    if (['thesis.tex', 'paper.tex', 'report.tex', 'document.tex', 'article.tex', 'manuscript.tex'].includes(base)) score += 4;
    score -= f.rel.split('/').length; // prefer shallow files
    scored.push({ rel: f.rel, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length) return scored[0].rel;
  return files.length ? files[0].rel : 'main.tex';
}

function listTemplates() {
  const dir = paths.templatesDir();
  if (!exists(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const meta = readJSON(path.join(dir, name, 'template.json'), null);
    if (!meta) continue;
    out.push({ id: name, ...meta });
  }
  out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return out;
}

async function create({ name, templateId }) {
  const s = settings.get();
  fs.mkdirSync(s.projectsRoot, { recursive: true });
  const clean = sanitizeName(name);
  const dir = uniquePath(s.projectsRoot, clean);
  const tplId = templateId || 'blank';
  const tplDir = path.join(paths.templatesDir(), tplId);
  const meta = readJSON(path.join(tplDir, 'template.json'), {});
  if (exists(tplDir)) {
    await copyDir(path.join(tplDir, 'files'), dir);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'main.tex'),
      '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\n\\title{' +
        clean.replace(/[\\{}$&#^_%~]/g, '') +
        '}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\n\n\\end{document}\n',
    );
  }
  // Fill in the title for the blank template.
  const mainFile = meta.mainFile || 'main.tex';
  const mainAbs = path.join(dir, mainFile);
  if (exists(mainAbs) && meta.replaceTitle) {
    const t = fs.readFileSync(mainAbs, 'utf8').replace('%%TITLE%%', clean.replace(/[\\{}$&#^_%~]/g, ''));
    fs.writeFileSync(mainAbs, t);
  }
  const rec = newRecord(clean, dir, {
    mainFile,
    compiler: meta.compiler || s.defaultCompiler || 'pdflatex',
  });
  load().projects.push(rec);
  save();
  return publicProject(rec);
}

async function importFolder(dir) {
  const existing = load().projects.find((p) => path.resolve(p.path).toLowerCase() === path.resolve(dir).toLowerCase());
  if (existing) {
    existing.trashed = false;
    existing.archived = false;
    save();
    return publicProject(existing);
  }
  const mainFile = await findMainFile(dir);
  let compiler = settings.get().defaultCompiler || 'pdflatex';
  try {
    const head = fs.readFileSync(path.join(dir, mainFile), 'utf8').slice(0, 4000);
    const magic = /%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/i.exec(head);
    if (magic && ['pdflatex', 'xelatex', 'lualatex'].includes(magic[1].toLowerCase())) compiler = magic[1].toLowerCase();
    else if (/\\usepackage(\[[^\]]*\])?\{(fontspec|polyglossia|unicode-math)\}/.test(head)) compiler = 'xelatex';
  } catch {
    /* ignore */
  }
  const rec = newRecord(path.basename(dir), dir, { managed: false, mainFile, compiler });
  load().projects.push(rec);
  save();
  return publicProject(rec);
}

/** Extract a zip safely (no path traversal), flattening a single top-level folder. */
function extractZip(zipPath, dest) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((e) => !e.entryName.startsWith('__MACOSX/') && !e.entryName.endsWith('.DS_Store'));
  const names = entries.map((e) => e.entryName.replace(/\\/g, '/'));
  const tops = new Set(names.map((n) => n.split('/')[0]));
  let strip = '';
  if (tops.size === 1) {
    const top = [...tops][0];
    if (names.every((n) => n === top + '/' || n.startsWith(top + '/'))) strip = top + '/';
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const e of entries) {
    let name = e.entryName.replace(/\\/g, '/');
    if (strip && name.startsWith(strip)) name = name.slice(strip.length);
    if (!name) continue;
    const abs = resolveInside(dest, name);
    if (e.isDirectory) {
      fs.mkdirSync(abs, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, e.getData());
    }
  }
  return strip ? strip.slice(0, -1) : '';
}

async function importZip(zipPath, name) {
  const s = settings.get();
  fs.mkdirSync(s.projectsRoot, { recursive: true });
  const tmp = path.join(os.tmpdir(), `freedomtex-import-${Date.now()}`);
  const inner = extractZip(zipPath, tmp);
  const clean = sanitizeName(name || inner || path.basename(zipPath, path.extname(zipPath)));
  const dir = uniquePath(s.projectsRoot, clean);
  await copyDir(tmp, dir);
  await fsp.rm(tmp, { recursive: true, force: true });
  const rec = await importFolder(dir);
  rec.managed = true;
  const stored = get(rec.id);
  stored.managed = true;
  stored.name = clean;
  save();
  return publicProject(stored);
}

const EDITABLE = ['name', 'tags', 'archived', 'trashed', 'compiler', 'mainFile', 'shellEscape', 'haltOnError', 'draft', 'spellLanguage', 'lastOpened', 'updatedAt', 'zotero'];

function update(id, patch) {
  const p = get(id);
  for (const k of EDITABLE) if (k in patch) p[k] = patch[k];
  save();
  return publicProject(p);
}

function touch(id) {
  try {
    const p = get(id);
    p.updatedAt = Date.now();
    save();
  } catch {
    /* ignore */
  }
}

async function duplicate(id, name) {
  const src = get(id);
  const s = settings.get();
  const clean = sanitizeName(name || `${src.name} (Copy)`);
  const dir = uniquePath(s.projectsRoot, clean);
  await copyDir(src.path, dir, (p) => !/[\\/]\.git([\\/]|$)/.test(p));
  const rec = newRecord(clean, dir, {
    mainFile: src.mainFile,
    compiler: src.compiler,
    shellEscape: src.shellEscape,
    tags: [...(src.tags || [])],
  });
  load().projects.push(rec);
  save();
  return publicProject(rec);
}

async function removeForever(id) {
  const p = get(id);
  const d = load();
  if (p.managed && exists(p.path)) {
    // Recycle Bin, not a hard delete, so students can still recover work.
    await shell.trashItem(p.path);
  }
  await fsp.rm(paths.buildDir(id), { recursive: true, force: true }).catch(() => {});
  await fsp.rm(paths.historyDir(id), { recursive: true, force: true }).catch(() => {});
  d.projects = d.projects.filter((x) => x.id !== id);
  save();
  return true;
}

async function exportZip(id, dest) {
  const p = get(id);
  const zip = new AdmZip();
  const files = await walk(p.path);
  for (const f of files) {
    const dir = path.posix.dirname(f.rel);
    zip.addLocalFile(f.abs, dir === '.' ? '' : dir);
  }
  zip.writeZip(dest);
  return dest;
}

// Tags
function createTag(name, color) {
  const d = load();
  const tag = { id: uid('t'), name: String(name).slice(0, 40), color: color || TAG_COLORS[d.tags.length % TAG_COLORS.length] };
  d.tags.push(tag);
  save();
  return tag;
}

function updateTag(id, patch) {
  const t = load().tags.find((x) => x.id === id);
  if (t) {
    if (patch.name) t.name = String(patch.name).slice(0, 40);
    if (patch.color) t.color = patch.color;
    save();
  }
  return t;
}

function deleteTag(id) {
  const d = load();
  d.tags = d.tags.filter((t) => t.id !== id);
  for (const p of d.projects) p.tags = (p.tags || []).filter((t) => t !== id);
  save();
  return true;
}

function relFromAbs(root, abs) {
  return toPosix(path.relative(root, abs));
}

module.exports = {
  list,
  get,
  create,
  importFolder,
  importZip,
  update,
  touch,
  duplicate,
  removeForever,
  exportZip,
  listTemplates,
  createTag,
  updateTag,
  deleteTag,
  findMainFile,
  relFromAbs,
};
