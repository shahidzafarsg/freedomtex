'use strict';
/**
 * Local version history. Each snapshot records a map of file -> content hash;
 * contents are stored once (gzip) in a content-addressed object store.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const paths = require('./paths');
const { walk, sha1, readJSON, writeJSON, uid, exists, resolveInside } = require('./util');

const MAX_FILE = 8 * 1024 * 1024;
const SKIP = /\.(aux|log|synctex\.gz|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml|nav|snm|vrb|idx|ind|ilg|glo|gls|glg|ftsave)$/i;

function dir(projectId) {
  return paths.historyDir(projectId);
}

function indexFile(projectId) {
  return path.join(dir(projectId), 'versions.json');
}

function loadIndex(projectId) {
  return readJSON(indexFile(projectId), { versions: [] });
}

function saveIndex(projectId, idx) {
  writeJSON(indexFile(projectId), idx);
}

async function snapshot(project, { label = null, reason = 'auto', author = '' } = {}) {
  const id = project.id;
  const objDir = path.join(dir(id), 'objects');
  await fsp.mkdir(objDir, { recursive: true });
  const files = {};
  for (const f of await walk(project.path)) {
    if (SKIP.test(f.rel)) continue;
    let buf;
    try {
      const st = await fsp.stat(f.abs);
      if (st.size > MAX_FILE) continue;
      buf = await fsp.readFile(f.abs);
    } catch {
      continue;
    }
    const h = sha1(buf);
    const obj = path.join(objDir, h);
    if (!exists(obj)) await fsp.writeFile(obj, zlib.gzipSync(buf));
    files[f.rel] = h;
  }
  const idx = loadIndex(id);
  const last = idx.versions[idx.versions.length - 1];
  const same = last && JSON.stringify(last.files) === JSON.stringify(files);
  if (same && !label) return { created: false, version: summarize(last) };
  if (same && label) {
    last.labels = [...(last.labels || []), { id: uid('l'), text: label, ts: Date.now() }];
    saveIndex(id, idx);
    return { created: false, version: summarize(last) };
  }
  const v = {
    id: uid('v'),
    ts: Date.now(),
    reason,
    author,
    files,
    labels: label ? [{ id: uid('l'), text: label, ts: Date.now() }] : [],
  };
  v.changes = diffSummary(last ? last.files : {}, files);
  idx.versions.push(v);
  // Keep history bounded: thin out old automatic versions beyond 800.
  if (idx.versions.length > 800) {
    idx.versions = idx.versions.filter((x, i) => i >= idx.versions.length - 600 || (x.labels && x.labels.length) || i % 4 === 0);
  }
  saveIndex(id, idx);
  return { created: true, version: summarize(v) };
}

function diffSummary(prev, next) {
  const added = [];
  const removed = [];
  const modified = [];
  for (const f of Object.keys(next)) {
    if (!(f in prev)) added.push(f);
    else if (prev[f] !== next[f]) modified.push(f);
  }
  for (const f of Object.keys(prev)) if (!(f in next)) removed.push(f);
  return { added, removed, modified };
}

function summarize(v) {
  return { id: v.id, ts: v.ts, reason: v.reason, author: v.author, labels: v.labels || [], changes: v.changes || { added: [], removed: [], modified: [] }, fileCount: Object.keys(v.files).length };
}

function list(projectId) {
  return loadIndex(projectId).versions.map(summarize).reverse();
}

function getVersion(projectId, versionId) {
  const v = loadIndex(projectId).versions.find((x) => x.id === versionId);
  if (!v) throw new Error('Version not found');
  return v;
}

function readObject(projectId, hash) {
  const p = path.join(dir(projectId), 'objects', hash);
  return zlib.gunzipSync(fs.readFileSync(p));
}

function files(projectId, versionId) {
  return Object.keys(getVersion(projectId, versionId).files).sort();
}

function getFile(projectId, versionId, rel) {
  const v = getVersion(projectId, versionId);
  const h = v.files[rel];
  if (!h) return null;
  const buf = readObject(projectId, h);
  return buf.includes(0) ? { binary: true, size: buf.length } : { binary: false, content: buf.toString('utf8') };
}

/** Text of a file in the version before `versionId` (for "what changed in this version"). */
function getPreviousFile(projectId, versionId, rel) {
  const idx = loadIndex(projectId);
  const i = idx.versions.findIndex((x) => x.id === versionId);
  if (i <= 0) return null;
  const h = idx.versions[i - 1].files[rel];
  if (!h) return null;
  const buf = readObject(projectId, h);
  return buf.includes(0) ? { binary: true } : { binary: false, content: buf.toString('utf8') };
}

async function restoreFile(project, versionId, rel) {
  const v = getVersion(project.id, versionId);
  const h = v.files[rel];
  if (!h) throw new Error('File not in this version');
  await snapshot(project, { reason: 'before-restore' });
  const abs = resolveInside(project.path, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, readObject(project.id, h));
  return true;
}

async function restoreVersion(project, versionId) {
  const v = getVersion(project.id, versionId);
  await snapshot(project, { reason: 'before-restore' });
  for (const [rel, h] of Object.entries(v.files)) {
    const abs = resolveInside(project.path, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, readObject(project.id, h));
  }
  await snapshot(project, { reason: 'restore', label: null });
  return true;
}

function addLabel(projectId, versionId, text) {
  const idx = loadIndex(projectId);
  const v = idx.versions.find((x) => x.id === versionId);
  if (!v) throw new Error('Version not found');
  v.labels = [...(v.labels || []), { id: uid('l'), text: String(text).slice(0, 120), ts: Date.now() }];
  saveIndex(projectId, idx);
  return summarize(v);
}

function removeLabel(projectId, versionId, labelId) {
  const idx = loadIndex(projectId);
  const v = idx.versions.find((x) => x.id === versionId);
  if (v) v.labels = (v.labels || []).filter((l) => l.id !== labelId);
  saveIndex(projectId, idx);
  return true;
}

module.exports = { snapshot, list, files, getFile, getPreviousFile, restoreFile, restoreVersion, addLabel, removeLabel };
