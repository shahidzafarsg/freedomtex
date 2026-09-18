'use strict';
/**
 * Zotero integration.
 *  - "local": the Zotero 7 desktop app's local API (http://localhost:23119/api/), offline and keyless.
 *    Uses Better BibTeX's export (stable citation keys) when that plugin is installed.
 *  - "web": the zotero.org Web API with the user's ID and API key (stored encrypted with safeStorage).
 */
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const settings = require('./settings');
const { resolveInside } = require('./util');

const LOCAL = 'http://127.0.0.1:23119';
const WEB = 'https://api.zotero.org';

async function get(url, headers = {}, timeout = 20000) {
  const res = await fetch(url, { headers: { 'Zotero-API-Version': '3', ...headers }, signal: AbortSignal.timeout(timeout) });
  return res;
}

// ---------------------------------------------------------------- credentials
function webCreds() {
  const s = settings.get();
  if (!s.zoteroUserId || !s.zoteroKeyEnc) return null;
  try {
    const key = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s.zoteroKeyEnc, 'base64')) : Buffer.from(s.zoteroKeyEnc, 'base64').toString('utf8');
    return { userId: s.zoteroUserId, key };
  } catch {
    return null;
  }
}

function setWebCreds(userId, key) {
  if (!userId || !key) {
    settings.update({ zoteroUserId: '', zoteroKeyEnc: '' });
    return { saved: false };
  }
  const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : Buffer.from(key, 'utf8').toString('base64');
  settings.update({ zoteroUserId: String(userId).trim(), zoteroKeyEnc: enc });
  return { saved: true };
}

// ---------------------------------------------------------------- status
async function status() {
  const out = { running: false, localApi: false, bbt: false, web: !!webCreds(), webUserId: settings.get().zoteroUserId || '' };
  try {
    const ping = await get(`${LOCAL}/connector/ping`, {}, 3000);
    out.running = ping.ok;
  } catch {
    return out;
  }
  try {
    const r = await get(`${LOCAL}/api/users/0/collections?limit=1`, {}, 5000);
    out.localApi = r.ok;
    out.localApiStatus = r.status;
  } catch {
    /* not available */
  }
  try {
    const r = await get(`${LOCAL}/better-bibtex/cayw?probe=true`, {}, 3000);
    out.bbt = r.ok && /ready/i.test(await r.text());
  } catch {
    /* plugin not installed */
  }
  return out;
}

function base(source) {
  if (source === 'local') return { root: `${LOCAL}/api`, headers: {} };
  const c = webCreds();
  if (!c) throw new Error('Connect your Zotero account first (user ID and API key).');
  return { root: WEB, headers: { 'Zotero-API-Key': c.key }, userId: c.userId };
}

function libPath(source, lib, b) {
  if (lib && lib.type === 'group') return `/groups/${lib.id}`;
  return source === 'local' ? '/users/0' : `/users/${b.userId}`;
}

/** Fetch every page of a JSON listing (the web API pages at 100; the local API returns everything). */
async function getAll(b, pathAndQuery) {
  const out = [];
  let start = 0;
  for (let guard = 0; guard < 200; guard++) {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const res = await get(`${b.root}${pathAndQuery}${sep}limit=100&start=${start}`, b.headers);
    if (!res.ok) throw new Error(await errorText(res));
    const page = await res.json();
    out.push(...page);
    const total = Number(res.headers.get('Total-Results') || 0);
    start += page.length;
    if (!page.length || !total || start >= total) break;
  }
  return out;
}

async function errorText(res) {
  if (res.status === 403) return 'Zotero refused the request (403). For the desktop app, enable "Allow other applications on this computer to communicate with Zotero" in Zotero Settings > Advanced. For an online library, check the API key has read access.';
  if (res.status === 404) return 'Not found in Zotero (404). The library or collection may have been removed.';
  let t = '';
  try {
    t = (await res.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  return `Zotero returned HTTP ${res.status}${t ? `: ${t}` : ''}`;
}

async function libraries(source) {
  const b = base(source);
  const libs = [{ type: 'user', id: 0, name: 'My Library' }];
  try {
    const groups = await getAll(b, `${source === 'local' ? '/users/0' : `/users/${b.userId}`}/groups`);
    for (const g of groups) libs.push({ type: 'group', id: g.id, name: (g.data && g.data.name) || `Group ${g.id}` });
  } catch {
    /* groups are optional */
  }
  return libs;
}

async function collections(source, lib) {
  const b = base(source);
  const list = await getAll(b, `${libPath(source, lib, b)}/collections`);
  const byParent = new Map();
  for (const c of list) {
    const parent = (c.data && c.data.parentCollection) || '';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push({ key: c.key, name: c.data ? c.data.name : c.key, count: c.meta ? c.meta.numItems : undefined });
  }
  const out = [];
  const walk = (parent, depth) => {
    const kids = (byParent.get(parent) || []).sort((a, x) => a.name.localeCompare(x.name));
    for (const k of kids) {
      out.push({ ...k, depth });
      walk(k.key, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

// ---------------------------------------------------------------- export
/** Collection keys to export: the chosen one plus (optionally) every sub-collection. */
async function collectionScope(source, lib, collection, includeSub) {
  if (!collection) return { keys: [null], paths: {} };
  const b = base(source);
  const list = await getAll(b, `${libPath(source, lib, b)}/collections`);
  const byKey = new Map(list.map((c) => [c.key, { name: c.data.name, parent: c.data.parentCollection || '' }]));
  const pathOf = (key) => {
    const parts = [];
    for (let k = key, guard = 0; k && byKey.has(k) && guard < 50; k = byKey.get(k).parent, guard++) parts.unshift(byKey.get(k).name);
    return parts;
  };
  const keys = [collection];
  if (includeSub) {
    for (let i = 0; i < keys.length; i++) for (const [k, c] of byKey) if (c.parent === keys[i]) keys.push(k);
  }
  return { keys, paths: Object.fromEntries(keys.map((k) => [k, pathOf(k)])) };
}

/** Zotero's own BibTeX/BibLaTeX export through the local or web API, with CSL-JSON as a fallback. */
async function apiExport(source, lib, key, fmt) {
  const b = base(source);
  const itemsPath = `${libPath(source, lib, b)}${key ? `/collections/${key}` : ''}/items/top`;
  let text = '';
  let start = 0;
  let res;
  for (let guard = 0; guard < 500; guard++) {
    res = await get(`${b.root}${itemsPath}?format=${fmt}&limit=100&start=${start}`, b.headers, 120000);
    if (!res.ok) break;
    const chunk = await res.text();
    text += chunk + '\n';
    const total = Number(res.headers.get('Total-Results') || 0);
    const n = (chunk.match(/^\s*@\w+\s*\{/gm) || []).length;
    start += n;
    if (!n || !total || start >= total || source === 'local') break;
  }
  if (res && res.ok) return text;
  if (res && (res.status === 403 || res.status === 404)) throw new Error(await errorText(res));
  // Export format not supported by this Zotero: convert CSL-JSON ourselves.
  const r = await get(`${b.root}${itemsPath}?format=csljson`, b.headers, 120000);
  if (!r.ok) throw new Error(await errorText(r));
  const data = await r.json();
  return cslToBibtex(Array.isArray(data) ? data : data.items || []);
}

async function exportBib(source, lib, collection, format, includeSub = true) {
  const fmt = format === 'biblatex' ? 'biblatex' : 'bibtex';
  let st = null;
  if (source === 'local') {
    st = await status();
    if (!st.running) throw new Error('Zotero is not running. Open the Zotero desktop app and try again.');
    if (!st.localApi && !st.bbt) throw new Error('Zotero is not sharing its library. In Zotero, open Edit > Settings > Advanced and tick "Allow other applications on this computer to communicate with Zotero".');
  }
  const userLib = !lib || lib.type !== 'group';
  const parts = [];
  let via = source === 'local' ? 'Zotero desktop' : 'zotero.org';

  // Better BibTeX (desktop only): nicer LaTeX escaping. Collections are addressed by name path, e.g. /Thesis/Chapter 2.
  if (st && st.bbt && userLib) {
    try {
      if (!collection) {
        const r = await get(`${LOCAL}/better-bibtex/export/library?library.${fmt}`, {}, 120000);
        if (!r.ok) throw new Error('bbt');
        parts.push(await r.text());
      } else {
        const scope = await collectionScope(source, lib, collection, includeSub);
        for (const key of scope.keys) {
          const p = '/' + scope.paths[key].map(encodeURIComponent).join('/');
          const r = await get(`${LOCAL}/better-bibtex/export/collection?${p}.${fmt}`, {}, 120000);
          if (!r.ok) throw new Error('bbt');
          parts.push(await r.text());
        }
      }
      via = 'Better BibTeX';
    } catch {
      parts.length = 0; // fall back to Zotero's own export below
    }
  }

  if (!parts.length) {
    if (source === 'local' && !st.localApi) throw new Error('Enable "Allow other applications on this computer to communicate with Zotero" in Zotero Settings > Advanced.');
    const scope = await collectionScope(source, lib, collection, includeSub);
    for (const key of scope.keys) parts.push(await apiExport(source, lib, key, fmt));
  }
  return { text: parts.join('\n'), via };
}

// ---------------------------------------------------------------- CSL-JSON -> BibTeX
const TYPE_MAP = {
  'article-journal': 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  article: 'article',
  book: 'book',
  chapter: 'incollection',
  'paper-conference': 'inproceedings',
  thesis: 'phdthesis',
  report: 'techreport',
  manuscript: 'unpublished',
  webpage: 'misc',
  'post-weblog': 'misc',
  dataset: 'misc',
  software: 'misc',
};

function esc(v) {
  return String(v).replace(/([&%$#_])/g, '\\$1');
}

function names(list) {
  return (list || []).map((n) => (n.literal ? `{${n.literal}}` : [n.family, n.given].filter(Boolean).join(', '))).join(' and ');
}

function cslToBibtex(items) {
  const used = new Set();
  const out = [];
  for (const it of items) {
    const year = it.issued && it.issued['date-parts'] && it.issued['date-parts'][0] ? it.issued['date-parts'][0][0] : '';
    let key = it['citation-key'] || it.citationKey;
    if (!key) {
      const fam = ((it.author && it.author[0] && (it.author[0].family || it.author[0].literal)) || 'anon').toLowerCase().replace(/[^a-z]/g, '');
      const word = ((it.title || '').toLowerCase().match(/[a-z]{4,}/) || ['item'])[0];
      key = `${fam}${year}${word}`;
    }
    let k = key;
    for (let i = 2; used.has(k); i++) k = `${key}${String.fromCharCode(95 + i)}`;
    used.add(k);
    const type = TYPE_MAP[it.type] || 'misc';
    const f = [];
    const add = (name, v) => v != null && v !== '' && f.push(`  ${name} = {${v}}`);
    add('author', esc(names(it.author)));
    add('editor', esc(names(it.editor)));
    add('title', `{${esc(it.title || '')}}`.replace(/^\{\}$/, ''));
    if (type === 'article') add('journal', esc(it['container-title'] || ''));
    else if (type === 'incollection' || type === 'inproceedings') add('booktitle', esc(it['container-title'] || ''));
    add('year', year);
    add('volume', it.volume);
    add('number', it.issue);
    add('pages', it.page ? String(it.page).replace(/\s*[^\w\s]\s*/, '--') : '');
    add('publisher', esc(it.publisher || ''));
    add('address', esc(it['publisher-place'] || ''));
    if (type === 'phdthesis' || type === 'techreport') add('institution', esc(it.publisher || ''));
    add('doi', it.DOI);
    add('isbn', it.ISBN);
    add('url', it.URL);
    out.push(`@${type}{${k},\n${f.join(',\n')}\n}`);
  }
  return out.join('\n\n') + '\n';
}

// ---------------------------------------------------------------- write into the project
function splitEntries(text) {
  const entries = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  const starts = [];
  let m;
  while ((m = re.exec(text))) starts.push({ index: m.index, key: m[2], type: m[1].toLowerCase() });
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (['comment', 'string', 'preamble'].includes(s.type)) continue;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    entries.push({ key: s.key, text: text.slice(s.index, end).trim() });
  }
  return entries;
}

async function importToProject(project, { source, lib, collection, collectionName, format, file, mode, includeSub = true }) {
  const rel = (file || 'references.bib').replace(/\\/g, '/');
  if (!/\.bib$/i.test(rel)) throw new Error('The target file must end with .bib');
  const abs = resolveInside(project.path, rel);
  const { text, via } = await exportBib(source, lib, collection, format, includeSub);
  // Sub-collections can share items, so keep the first copy of each key.
  const seen = new Set();
  const incoming = splitEntries(text).filter((e) => (seen.has(e.key) ? false : seen.add(e.key)));
  if (!incoming.length) throw new Error('No references were found in that Zotero library or collection.');
  const header = `% Imported from Zotero (${via}${collectionName ? `, collection "${collectionName}"` : ''}) by FreedomTex on ${new Date().toISOString().slice(0, 10)}.\n% Use Tools > Import from Zotero to refresh.\n\n`;
  let added = incoming.length;
  let output;
  if (mode === 'merge' && fs.existsSync(abs)) {
    const existing = fs.readFileSync(abs, 'utf8');
    const have = new Set(splitEntries(existing).map((e) => e.key));
    const fresh = incoming.filter((e) => !have.has(e.key));
    added = fresh.length;
    output = existing.replace(/\s*$/, '\n\n') + fresh.map((e) => e.text).join('\n\n') + (fresh.length ? '\n' : '');
  } else {
    output = header + incoming.map((e) => e.text).join('\n\n') + '\n';
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, output, 'utf8');
  return { file: rel, total: incoming.length, added, via };
}

module.exports = { status, setWebCreds, libraries, collections, importToProject, cslToBibtex };
