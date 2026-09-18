'use strict';
/**
 * LaTeX log parser. Tracks the file stack through "(file" / ")" markers, then
 * extracts errors, warnings, bad boxes and missing files.
 */

const FILE_EXT = /\.(tex|sty|cls|clo|cfg|def|fd|bbl|aux|toc|ltx|dtx|ldf|bbx|cbx|lbx|dict|lua|out|nav|snm|vrb|ind|gls|lof|lot|tikz|pgf|w18|mkii|bib|ist|txt|dat|code\.tex|data\.tex|csv|pdf_tex|lco|cnf|enc|map|tfm|pfb)$/i;

function readPathAt(line, i) {
  // i points just after "("
  if (line[i] === '"') {
    const end = line.indexOf('"', i + 1);
    if (end > i) return { path: line.slice(i + 1, end), next: end + 1 };
    return null;
  }
  let j = i;
  while (j < line.length && !/[\s()"{}<>]/.test(line[j])) j++;
  const p = line.slice(i, j);
  if (p.length > 1 && (FILE_EXT.test(p) || /^(\.\/|[A-Za-z]:[\\/]|\/)/.test(p)) && /[./\\]/.test(p)) {
    return { path: p, next: j };
  }
  return null;
}

function normalizeFile(p, projectRoot) {
  if (!p) return null;
  let f = p.replace(/\\/g, '/');
  if (f.startsWith('./')) f = f.slice(2);
  if (projectRoot) {
    const root = projectRoot.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    if (f.toLowerCase().startsWith(root.toLowerCase())) f = f.slice(root.length);
    if (f.startsWith('./')) f = f.slice(2);
  }
  return f;
}

function isProjectFile(f) {
  return f && !/^[A-Za-z]:\//.test(f) && !f.startsWith('/');
}

const MISSING_PATTERNS = [
  /! LaTeX Error: File `([^']+)' not found/,
  /! I can't find file `([^']+)'/,
  /LaTeX Error: File `([^']+)' not found/,
  /Package \S+ Error: File `([^']+)' not found/,
  /! Font [^=]+=([\w-]+)(?: at [\d.]+pt| scaled \d+)? not loadable: Metric \(TFM\) file not found/,
  /I couldn't open style file ([\w.-]+)/,
  /Package babel Error: Unknown option `([\w-]+)'/,
  /! Package biblatex Error: Style '([\w-]+)' not found/,
  /cannot open Type 1 font file for reading \(([^)]+)\)/,
  /! LaTeX Error: Unknown (?:graphics extension|option)/, // not a missing file, filtered below
];

function missingFromLine(line) {
  for (let i = 0; i < MISSING_PATTERNS.length - 1; i++) {
    const m = MISSING_PATTERNS[i].exec(line);
    if (!m) continue;
    let f = m[1].trim();
    if (i === 4) f = `${f}.tfm`;
    if (i === 5 && !f.endsWith('.bst')) f = `${f}.bst`;
    if (i === 6) f = `${f}.ldf`;
    if (i === 7) f = `${f}.bbx`;
    if (i === 8) f = f.split(/[\\/]/).pop();
    // Files that live in the project (e.g. a chapter) are not packages.
    return f;
  }
  return null;
}

function parse(logText, projectRoot) {
  const lines = logText.split(/\r?\n/);
  const errors = [];
  const warnings = [];
  const typesetting = [];
  const missing = new Set();
  const stack = [];
  let rerun = false;

  const currentFile = () => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k]) return stack[k];
    return null;
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];

    // --- errors in file:line:message form (-file-line-error)
    const fle = /^((?:[A-Za-z]:[\\/][^:]*?|[^\s:]+?)\.\w+):(\d+): (.*)$/.exec(line);
    if (fle && !/^\s/.test(line)) {
      const message = fle[3];
      const context = collectContext(lines, n + 1);
      const miss = missingFromLine(message) || missingFromLine(context.join('\n'));
      if (miss) missing.add(miss);
      errors.push({
        level: 'error',
        file: normalizeFile(fle[1], projectRoot),
        line: Number(fle[2]),
        message: message.replace(/^LaTeX Error: /, ''),
        raw: [line, ...context].join('\n'),
      });
      continue;
    }

    // --- classic "! message" errors
    if (line.startsWith('! ')) {
      const context = collectContext(lines, n + 1);
      const miss = missingFromLine(line);
      if (miss) missing.add(miss);
      let lineNo = null;
      for (const c of context) {
        const lm = /^l\.(\d+)/.exec(c);
        if (lm) {
          lineNo = Number(lm[1]);
          break;
        }
      }
      // Avoid double-reporting when a file:line error with the same text exists.
      const msg = line.slice(2).replace(/^LaTeX Error: /, '');
      if (!errors.some((e) => e.message === msg && (e.line === lineNo || lineNo == null))) {
        errors.push({
          level: 'error',
          file: normalizeFile(currentFile(), projectRoot),
          line: lineNo,
          message: msg,
          raw: [line, ...context].join('\n'),
        });
      }
      continue;
    }

    const miss = missingFromLine(line);
    if (miss) missing.add(miss);

    // --- warnings
    const w = /^(LaTeX|LaTeX Font|Package ([\w-]+)|Class ([\w-]+)|pdfTeX) warning:?\s*(.*)$/i.exec(line) ||
      /^(LaTeX|LaTeX Font|Package ([\w-]+)|Class ([\w-]+)) Warning: (.*)$/.exec(line);
    if (w) {
      let message = w[4];
      const pkg = w[2] || w[3];
      // Continuation lines are prefixed with "(pkg)" padding.
      let k = n + 1;
      while (k < lines.length && lines[k].trim() && (/^\s*\([\w-]+\)\s/.test(lines[k]) || (/^\s{3,}/.test(lines[k]) && k - n < 6))) {
        message += ' ' + lines[k].replace(/^\s*\([\w-]+\)\s*/, '').trim();
        k++;
      }
      const lm = /on input line (\d+)/.exec(message);
      if (/Rerun|rerun LaTeX|may have changed/i.test(message)) rerun = true;
      warnings.push({
        level: 'warning',
        file: normalizeFile(currentFile(), projectRoot),
        line: lm ? Number(lm[1]) : null,
        message: (pkg ? `${pkg}: ` : '') + message.replace(/\s+/g, ' ').trim(),
        raw: lines.slice(n, k).join('\n'),
      });
    }

    // --- bad boxes
    const bb = /^(Over|Under)full \\([hv])box \((.*?)\)(?: in paragraph at lines (\d+)--(\d+)| in alignment at lines (\d+)--(\d+)| detected at line (\d+)| has occurred while \\output is active)?/.exec(line);
    if (bb) {
      const ln = Number(bb[4] || bb[6] || bb[8] || 0) || null;
      typesetting.push({
        level: 'typesetting',
        file: normalizeFile(currentFile(), projectRoot),
        line: ln,
        message: `${bb[1]}full \\${bb[2]}box (${bb[3]})`,
        raw: line,
      });
    }

    // --- file stack bookkeeping
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '(') {
        const p = readPathAt(line, i + 1);
        if (p) {
          stack.push(p.path);
          i = p.next - 1;
        } else {
          stack.push(null);
        }
      } else if (ch === ')') {
        if (stack.length) stack.pop();
      }
    }
  }

  // Keep only project-local file names on issues; external files become null.
  for (const list of [errors, warnings, typesetting]) {
    for (const it of list) {
      if (it.file && !isProjectFile(it.file)) {
        it.externalFile = it.file;
        it.file = null;
      }
    }
  }

  return {
    errors: dedupe(errors),
    warnings: dedupe(warnings),
    typesetting: dedupe(typesetting),
    missing: [...missing],
    rerun,
  };
}

function collectContext(lines, start) {
  const out = [];
  for (let k = start; k < lines.length && k < start + 12; k++) {
    const l = lines[k];
    if (l.startsWith('! ') || /^((?:[A-Za-z]:)?[^:\s]+\.\w+):(\d+): /.test(l)) break;
    out.push(l);
    if (/^l\.\d+/.test(l)) {
      if (k + 1 < lines.length && lines[k + 1].trim()) out.push(lines[k + 1]);
      break;
    }
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((i) => {
    const key = `${i.level}|${i.file}|${i.line}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** BibTeX (.blg) and Biber log messages. */
function parseBibLog(text, tool) {
  const errors = [];
  const warnings = [];
  const missing = new Set();
  if (!text) return { errors, warnings, missing: [] };
  for (const line of text.split(/\r?\n/)) {
    if (tool === 'biber') {
      const m = /^\[\d+\]\s+[\w:]+>\s+(ERROR|WARN) - (.*)$/.exec(line) || /^(ERROR|WARN) - (.*)$/.exec(line);
      if (m) {
        const msg = m[2].trim();
        const fm = /BibTeX subsystem: .*?([\w./\\-]+\.bib), line (\d+)/.exec(msg);
        (m[1] === 'ERROR' ? errors : warnings).push({
          level: m[1] === 'ERROR' ? 'error' : 'warning',
          file: fm ? fm[1].split(/[\\/]/).pop() : null,
          line: fm ? Number(fm[2]) : null,
          message: `Biber: ${msg}`,
          raw: line,
        });
      }
    } else {
      let m;
      if ((m = /^Warning--(.*)$/.exec(line))) {
        warnings.push({ level: 'warning', file: null, line: null, message: `BibTeX: ${m[1]}`, raw: line });
      } else if ((m = /I couldn't open (?:database|style) file ([\w./\\-]+)/.exec(line))) {
        if (/style/.test(line)) missing.add(m[1].endsWith('.bst') ? m[1] : `${m[1]}.bst`);
        errors.push({ level: 'error', file: null, line: null, message: `BibTeX: ${line.trim()}`, raw: line });
      } else if ((m = /^(.*)---line (\d+) of file (.*)$/.exec(line))) {
        errors.push({ level: 'error', file: m[3].trim(), line: Number(m[2]), message: `BibTeX: ${m[1].trim()}`, raw: line });
      } else if (/^I found no/.test(line)) {
        errors.push({ level: 'error', file: null, line: null, message: `BibTeX: ${line.trim()}`, raw: line });
      }
    }
  }
  return { errors, warnings, missing: [...missing] };
}

module.exports = { parse, parseBibLog, normalizeFile };
