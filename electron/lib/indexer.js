'use strict';
/** Project-wide index for autocomplete (labels, citations, commands) and word counting. */
const fsp = require('fs/promises');
const path = require('path');
const { walk, exists } = require('./util');

function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function parseBib(text, file) {
  const entries = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (['comment', 'string', 'preamble'].includes(type)) continue;
    // Grab the body up to the next entry for a few display fields.
    const next = text.indexOf('\n@', re.lastIndex);
    const body = text.slice(re.lastIndex, next === -1 ? re.lastIndex + 4000 : next);
    const field = (name) => {
      const fm = new RegExp(`\\b${name}\\s*=\\s*[{"]((?:[^{}]|\\{[^{}]*\\})*)[}"]`, 'i').exec(body);
      return fm ? fm[1].replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : '';
    };
    entries.push({ key: m[2], type, title: field('title'), author: field('author'), year: field('year') || field('date').slice(0, 4), file, line: lineOf(text, m.index) });
  }
  return entries;
}

async function index(root) {
  const files = await walk(root);
  const labels = [];
  const bib = [];
  const commands = [];
  const environments = [];
  const texFiles = [];
  const images = [];
  const bibFiles = [];
  for (const f of files) {
    const lower = f.rel.toLowerCase();
    if (/\.(png|jpe?g|pdf|eps|svg|gif|bmp|tiff?)$/.test(lower)) images.push(f.rel);
    if (lower.endsWith('.bib')) bibFiles.push(f.rel);
    if (/\.(tex|ltx|sty|cls)$/.test(lower)) texFiles.push(f.rel);
    if (!/\.(tex|ltx|sty|cls|bib)$/.test(lower)) continue;
    let text;
    try {
      const st = await fsp.stat(f.abs);
      if (st.size > 4 * 1024 * 1024) continue;
      text = await fsp.readFile(f.abs, 'utf8');
    } catch {
      continue;
    }
    if (lower.endsWith('.bib')) {
      bib.push(...parseBib(text, f.rel));
      continue;
    }
    const clean = stripComments(text);
    let m;
    const lre = /\\label\s*\{([^}]+)\}/g;
    while ((m = lre.exec(clean))) labels.push({ label: m[1], file: f.rel, line: lineOf(clean, m.index) });
    const bre = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((m = bre.exec(clean))) bib.push({ key: m[1], type: 'bibitem', title: '', author: '', year: '', file: f.rel, line: lineOf(clean, m.index) });
    const cre = /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|DeclareRobustCommand)\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?/g;
    while ((m = cre.exec(clean))) commands.push({ name: m[1], args: Number(m[2] || 0), file: f.rel });
    const dre = /\\def\s*\\([a-zA-Z@]+)/g;
    while ((m = dre.exec(clean))) commands.push({ name: m[1], args: 0, file: f.rel });
    const ere = /\\(?:newenvironment|renewenvironment|newtheorem)\*?\s*\{([^}]+)\}/g;
    while ((m = ere.exec(clean))) environments.push({ name: m[1], file: f.rel });
  }
  return { labels, bib, commands, environments, texFiles, images, bibFiles };
}

// ---------------------------------------------------------------- word count
async function collectDocument(root, mainFile) {
  const seen = new Set();
  const parts = [];
  async function load(rel) {
    let r = rel.replace(/\\/g, '/');
    if (!/\.\w+$/.test(r)) r += '.tex';
    const key = r.toLowerCase();
    if (seen.has(key)) return '';
    seen.add(key);
    const abs = path.resolve(root, r);
    if (!exists(abs)) return '';
    const text = stripComments(await fsp.readFile(abs, 'utf8'));
    parts.push(r);
    // Inline \input, \include and \subfile so the count covers the whole document.
    const out = [];
    let last = 0;
    const re = /\\(?:input|include|subfile)\s*\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(text))) {
      out.push(text.slice(last, m.index));
      out.push(await load(m[1].trim()));
      last = re.lastIndex;
    }
    out.push(text.slice(last));
    return out.join('\n');
  }
  const text = await load(mainFile);
  return { text, files: parts };
}

function skipBalanced(text, start) {
  // text[start] === '{' ; returns index after matching '}'
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

function removeCommandWithArg(text, names, onArg) {
  const re = new RegExp(`\\\\(${names})\\*?\\s*(\\[[^\\]]*\\])?\\s*\\{`, 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const braceAt = re.lastIndex - 1;
    const end = skipBalanced(text, braceAt);
    out += text.slice(last, m.index);
    if (onArg) out += onArg(m[1], text.slice(braceAt + 1, end - 1)) || ' ';
    else out += ' ';
    last = end;
    re.lastIndex = end;
  }
  return out + text.slice(last);
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const countWords = (s) => (s.match(WORD_RE) || []).length;

async function wordCount(root, mainFile) {
  const { text, files } = await collectDocument(root, mainFile);
  let body = text;
  const b = body.indexOf('\\begin{document}');
  const e = body.lastIndexOf('\\end{document}');
  if (b !== -1) body = body.slice(b + 16, e === -1 ? undefined : e);

  let displayMath = 0;
  let inlineMath = 0;
  const mathEnvs = 'equation|equation\\*|align|align\\*|gather|gather\\*|multline|multline\\*|eqnarray|eqnarray\\*|displaymath|flalign|flalign\\*|alignat|alignat\\*';
  body = body.replace(new RegExp(`\\\\begin\\{(${mathEnvs})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), () => {
    displayMath++;
    return ' ';
  });
  body = body.replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g, () => {
    displayMath++;
    return ' ';
  });
  body = body.replace(/\\\([\s\S]*?\\\)|(?<!\\)\$(?:\\\$|[^$])+?\$/g, () => {
    inlineMath++;
    return ' ';
  });

  // Drop code/verbatim-like blocks
  body = body.replace(/\\begin\{(verbatim|lstlisting|minted|comment|tikzpicture)\}[\s\S]*?\\end\{\1\}/g, ' ');

  let headers = 0;
  let headerWords = 0;
  body = removeCommandWithArg(body, 'part|chapter|section|subsection|subsubsection|paragraph|subparagraph', (_, arg) => {
    headers++;
    headerWords += countWords(arg);
    return ' ';
  });

  let captionWords = 0;
  let floats = 0;
  body = body.replace(/\\begin\{(figure|table|figure\*|table\*|wrapfigure|sidewaysfigure|sidewaystable)\}/g, () => {
    floats++;
    return ' ';
  });
  body = removeCommandWithArg(body, 'caption|footnote|thanks', (name, arg) => {
    captionWords += countWords(arg.replace(/\\[a-zA-Z@]+/g, ' '));
    return ' ';
  });

  body = removeCommandWithArg(
    body,
    'label|ref|eqref|autoref|cref|Cref|pageref|cite|citep|citet|parencite|textcite|autocite|nocite|includegraphics|input|include|bibliography|bibliographystyle|addbibresource|usepackage|url|vspace|hspace|setlength|addtolength|begin|end|newcommand|renewcommand|renewenvironment|newenvironment|pagestyle|thispagestyle|setcounter|addcontentsline|color|pagecolor|hypersetup|graphicspath|documentclass|printbibliography',
  );
  // Keep the readable text of formatting commands
  body = body.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ').replace(/[{}~&\\]/g, ' ');

  const textWords = countWords(body);
  return {
    files,
    textWords,
    headerWords,
    captionWords,
    headers,
    floats,
    inlineMath,
    displayMath,
    total: textWords + headerWords + captionWords,
    characters: body.replace(/\s+/g, '').length,
  };
}

module.exports = { index, wordCount, parseBib };
