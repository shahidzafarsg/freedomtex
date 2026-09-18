'use strict';
const path = require('path');
const tex = require('./tex');
const { run, exists, toPosix } = require('./util');

function parseBlocks(stdout) {
  const results = [];
  let cur = null;
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(\w+):(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'Output' || (key === 'Page' && cur && 'Page' in cur)) {
      if (cur && Object.keys(cur).length > 1) results.push(cur);
      cur = {};
      if (key === 'Output') continue;
    }
    if (!cur) cur = {};
    cur[key] = val;
  }
  if (cur && Object.keys(cur).length) results.push(cur);
  return results;
}

/** Source position -> rectangles in the PDF (PDF points, top-left origin). */
async function forward(projectRoot, pdfPath, file, line, column = 1) {
  await tex.detect();
  const exe = tex.toolPath('synctex');
  if (!exe || !exists(pdfPath)) return [];
  const input = path.resolve(projectRoot, file);
  const r = await run(exe, ['view', '-i', `${line}:${Math.max(column, 0)}:${input}`, '-o', pdfPath], { env: tex.texEnv(), cwd: projectRoot, timeout: 20000 });
  return parseBlocks(r.stdout)
    .filter((b) => b.Page)
    .map((b) => ({
      page: Number(b.Page),
      h: Number(b.h),
      v: Number(b.v),
      W: Number(b.W),
      H: Number(b.H),
      x: Number(b.x),
      y: Number(b.y),
    }));
}

/** PDF position -> source file and line. */
async function reverse(projectRoot, pdfPath, page, x, y) {
  await tex.detect();
  const exe = tex.toolPath('synctex');
  if (!exe || !exists(pdfPath)) return null;
  const r = await run(exe, ['edit', '-o', `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdfPath}`], { env: tex.texEnv(), cwd: projectRoot, timeout: 20000 });
  const blocks = parseBlocks(r.stdout);
  const b = blocks.find((x) => x.Input);
  if (!b) return null;
  let input = b.Input.replace(/\\/g, '/');
  // Paths look like C:/proj/./main.tex; make them project-relative.
  const rel = toPosix(path.relative(projectRoot, path.resolve(input)));
  if (rel.startsWith('..')) return null;
  return { file: rel, line: Math.max(1, Number(b.Line) || 1), column: Math.max(0, Number(b.Column) || 0) };
}

module.exports = { forward, reverse };
