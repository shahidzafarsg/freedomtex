import katex from 'katex';
import { MATH_ENVS } from './modes';

const cache = new Map();

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Convert an environment span into something KaTeX understands. */
export function normalizeMath(span) {
  let src = span.src;
  if (span.env) {
    const env = span.env.replace('*', '');
    const inner = src.replace(/^\\begin\{[^}]+\}(\{[^}]*\})?/, '').replace(/\\end\{[^}]+\}$/, '');
    const arg = /^\\begin\{[^}]+\}(\{[^}]*\})/.exec(src);
    if (env === 'equation' || env === 'displaymath' || env === 'math' || env === 'dmath') src = inner;
    else if (env === 'align' || env === 'flalign' || env === 'eqnarray') src = `\\begin{aligned}${inner}\\end{aligned}`;
    else if (env === 'alignat') src = `\\begin{alignedat}${arg ? arg[1] : '{2}'}${inner}\\end{alignedat}`;
    else if (env === 'gather' || env === 'multline') src = `\\begin{gathered}${inner}\\end{gathered}`;
    else src = inner;
  }
  return src
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(nonumber|notag)\b/g, '')
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .trim();
}

export function renderMath(src, display) {
  const key = (display ? 'D' : 'I') + src;
  const hit = cache.get(key);
  if (hit) return hit;
  let html;
  try {
    html = katex.renderToString(src || '\\,', {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      errorColor: 'var(--danger)',
      macros: { '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}', '\\Q': '\\mathbb{Q}', '\\C': '\\mathbb{C}' },
    });
  } catch (e) {
    html = `<span class="cm-math-error">${escapeHtml(String(e.message || e))}</span>`;
  }
  if (cache.size > 800) cache.clear();
  cache.set(key, html);
  return html;
}

function findUnescaped(text, needle, from) {
  let i = from;
  while (i < text.length) {
    const j = text.indexOf(needle, i);
    if (j === -1) return -1;
    let bs = 0;
    for (let k = j - 1; k >= 0 && text[k] === '\\'; k--) bs++;
    if (bs % 2 === 0) return j;
    i = j + 1;
  }
  return -1;
}

/** Find math spans in text. Returned positions are offset by `base`. */
export function scanMath(text, base = 0) {
  const spans = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '%') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === '\\') {
      const nx = text[i + 1];
      if (nx === '[' || nx === '(') {
        const close = nx === '[' ? '\\]' : '\\)';
        const end = text.indexOf(close, i + 2);
        if (end !== -1) {
          spans.push({ from: base + i, to: base + end + 2, src: text.slice(i + 2, end), display: nx === '[' });
          i = end + 2;
          continue;
        }
        i += 2;
        continue;
      }
      if (text.startsWith('\\begin', i)) {
        const m = /^\\begin\s*\{([a-zA-Z]+\*?)\}/.exec(text.slice(i, i + 40));
        if (m && MATH_ENVS.has(m[1])) {
          const endTag = `\\end{${m[1]}}`;
          const end = text.indexOf(endTag, i + m[0].length);
          if (end !== -1) {
            spans.push({ from: base + i, to: base + end + endTag.length, src: text.slice(i, end + endTag.length), display: true, env: m[1] });
            i = end + endTag.length;
            continue;
          }
        }
        if (m && /^(verbatim|lstlisting|minted|comment)\*?$/.test(m[1])) {
          const endTag = `\\end{${m[1]}}`;
          const end = text.indexOf(endTag, i);
          i = end === -1 ? n : end + endTag.length;
          continue;
        }
      }
      i += 2;
      continue;
    }
    if (c === '$') {
      if (text[i + 1] === '$') {
        const end = findUnescaped(text, '$$', i + 2);
        if (end !== -1) {
          spans.push({ from: base + i, to: base + end + 2, src: text.slice(i + 2, end), display: true });
          i = end + 2;
          continue;
        }
        i += 2;
        continue;
      }
      let j = i + 1;
      let ok = false;
      while (j < n) {
        const d = text[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '$') {
          ok = true;
          break;
        }
        if (d === '\n' && text[j + 1] === '\n') break;
        j++;
      }
      if (ok && j > i + 1) {
        spans.push({ from: base + i, to: base + j + 1, src: text.slice(i + 1, j), display: false });
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return spans;
}

/** The math span containing `pos`, searching a window of lines around it. */
export function mathAt(doc, pos, radius = 40) {
  const line = doc.lineAt(pos);
  const fromLine = doc.line(Math.max(1, line.number - radius));
  const toLine = doc.line(Math.min(doc.lines, line.number + radius));
  const spans = scanMath(doc.sliceString(fromLine.from, toLine.to), fromLine.from);
  return spans.find((s) => pos >= s.from && pos <= s.to) || null;
}
