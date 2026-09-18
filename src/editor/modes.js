import { StreamLanguage, foldService, HighlightStyle, indentService } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const SECTION_CMDS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'title', 'frametitle', 'caption']);
const LABEL_CMDS = new Set([
  'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'vref', 'nameref', 'cite', 'citep', 'citet', 'citeauthor',
  'citeyear', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite', 'fullcite', 'bibitem', 'Autoref',
]);
const PKG_CMDS = new Set(['usepackage', 'RequirePackage', 'documentclass', 'input', 'include', 'includegraphics', 'bibliography', 'addbibresource', 'bibliographystyle', 'usetheme', 'usecolortheme', 'subfile', 'includeonly']);
export const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*',
  'displaymath', 'math', 'flalign', 'flalign*', 'alignat', 'alignat*', 'dmath', 'dmath*',
]);
const VERB_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*']);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const latexParser = {
  name: 'latex',
  startState: () => ({ math: null, argKind: null, argDepth: 0, envCmd: null, verbEnv: null, mathEnv: null }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    // Verbatim-like environments: everything is plain until \end{env}
    if (state.verbEnv) {
      if (stream.match(new RegExp(`^\\\\end\\s*\\{${escapeRe(state.verbEnv)}\\}`))) {
        state.verbEnv = null;
        return 'keyword';
      }
      if (!stream.match(/^[^\\]+/)) stream.next();
      return 'string';
    }

    // Reading the {name} after \begin / \end
    if (state.envCmd) {
      if (stream.eatSpace()) return null;
      if (stream.peek() === '{') {
        stream.next();
        return 'brace';
      }
      const m = stream.match(/^[^}\s]+/);
      if (m) {
        const name = m[0];
        if (state.envCmd === 'begin') {
          if (VERB_ENVS.has(name)) state.pendingVerb = name;
          else if (MATH_ENVS.has(name)) state.mathEnv = name;
        } else if (state.envCmd === 'end' && state.mathEnv === name) {
          state.mathEnv = null;
        }
        return 'typeName';
      }
      if (stream.peek() === '}') {
        stream.next();
        state.envCmd = null;
        if (state.pendingVerb) {
          state.verbEnv = state.pendingVerb;
          state.pendingVerb = null;
        }
        return 'brace';
      }
      state.envCmd = null;
    }

    // Styled argument of sectioning/label/package commands
    if (state.argKind) {
      if (state.argDepth === 0) {
        if (stream.match(/^\*/)) return 'tagName';
        if (stream.peek() === '[') {
          stream.skipTo(']') ? stream.next() : stream.skipToEnd();
          return 'squareBracket';
        }
        if (stream.peek() === '{') {
          stream.next();
          state.argDepth = 1;
          return 'brace';
        }
        state.argKind = null;
      } else {
        const ch = stream.peek();
        if (ch === '}') {
          stream.next();
          state.argDepth--;
          if (state.argDepth === 0) state.argKind = null;
          return 'brace';
        }
        if (ch === '{') {
          stream.next();
          state.argDepth++;
          return 'brace';
        }
        if (ch === '%') {
          stream.skipToEnd();
          return 'comment';
        }
        if (state.argKind === 'heading' && ch === '\\') {
          stream.next();
          stream.match(/^[a-zA-Z@]+/) || stream.next();
          return 'tagName';
        }
        if (state.argKind === 'heading' && ch === '$') {
          stream.next();
          stream.skipTo('$') ? stream.next() : stream.skipToEnd();
          return 'variableName';
        }
        stream.match(/^[^{}%\\$]+/) || stream.next();
        return state.argKind === 'heading' ? 'heading' : state.argKind === 'label' ? 'labelName' : 'className';
      }
    }

    if (stream.sol() && state.math === null && !state.mathEnv) {
      // nothing special
    }

    const inMath = state.math !== null || state.mathEnv !== null;
    const ch = stream.peek();

    if (ch === '%') {
      stream.skipToEnd();
      return 'comment';
    }

    if (ch === '\\') {
      // math delimiters
      if (stream.match('\\[')) {
        state.math = '\\]';
        return 'processingInstruction';
      }
      if (stream.match('\\(')) {
        state.math = '\\)';
        return 'processingInstruction';
      }
      if (state.math && (stream.match('\\]') || stream.match('\\)'))) {
        state.math = null;
        return 'processingInstruction';
      }
      const m = stream.match(/^\\([a-zA-Z@]+)/);
      if (m) {
        const name = m[1];
        if (name === 'begin' || name === 'end') {
          state.envCmd = name;
          return 'keyword';
        }
        if (inMath) return 'macroName';
        if (SECTION_CMDS.has(name)) {
          state.argKind = 'heading';
          state.argDepth = 0;
          return 'keyword';
        }
        if (LABEL_CMDS.has(name)) {
          state.argKind = 'label';
          state.argDepth = 0;
          return 'tagName';
        }
        if (PKG_CMDS.has(name)) {
          state.argKind = 'pkg';
          state.argDepth = 0;
          return 'tagName';
        }
        return 'tagName';
      }
      stream.next();
      stream.next();
      return 'escape';
    }

    if (ch === '$') {
      if (stream.match('$$')) {
        state.math = state.math === '$$' ? null : state.math === null ? '$$' : state.math;
        return 'processingInstruction';
      }
      stream.next();
      if (state.math === '$') state.math = null;
      else if (state.math === null) state.math = '$';
      return 'processingInstruction';
    }

    if (ch === '{' || ch === '}') {
      stream.next();
      return 'brace';
    }
    if (ch === '[' || ch === ']') {
      stream.next();
      return 'squareBracket';
    }
    if (ch === '&' || ch === '~' || ch === '^' || ch === '_' || ch === '#') {
      stream.next();
      return 'operator';
    }
    if (inMath) {
      if (stream.match(/^\d+(\.\d+)?/)) return 'number';
      if (stream.match(/^[a-zA-Z]+/)) return 'variableName';
      stream.next();
      return 'variableName';
    }
    if (stream.match(/^[^\\%${}[\]&~^_#]+/)) return null;
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '$'] },
    wordChars: '\\@',
  },
};

export const latexLanguage = StreamLanguage.define(latexParser);

const bibtexParser = {
  name: 'bibtex',
  startState: () => ({ depth: 0, inEntry: false, expectKey: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (state.depth === 0) {
      if (ch === '%') {
        stream.skipToEnd();
        return 'comment';
      }
      if (ch === '@') {
        stream.next();
        stream.match(/^\w+/);
        state.expectKey = true;
        return 'keyword';
      }
      if (ch === '{' || ch === '(') {
        stream.next();
        state.depth = 1;
        return 'brace';
      }
      stream.skipToEnd();
      return 'comment';
    }
    if (state.expectKey && state.depth === 1) {
      if (stream.match(/^[^,\s}]+/)) {
        state.expectKey = false;
        return 'labelName';
      }
    }
    if (ch === '{' || ch === '(') {
      stream.next();
      state.depth++;
      return state.depth > 2 ? 'string' : 'brace';
    }
    if (ch === '}' || ch === ')') {
      stream.next();
      state.depth--;
      return state.depth >= 2 ? 'string' : 'brace';
    }
    if (state.depth >= 2) {
      stream.match(/^[^{}]+/) || stream.next();
      return 'string';
    }
    if (ch === '"') {
      stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '"') break;
      }
      return 'string';
    }
    if (stream.match(/^[a-zA-Z_-]+(?=\s*=)/)) return 'propertyName';
    if (stream.match(/^\d+/)) return 'number';
    if (ch === '=' || ch === ',' || ch === '#') {
      stream.next();
      return 'operator';
    }
    stream.match(/^[\w.:-]+/) || stream.next();
    return 'variableName';
  },
  languageData: { commentTokens: { line: '%' } },
};

export const bibtexLanguage = StreamLanguage.define(bibtexParser);

export const ftHighlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.tagName, color: 'var(--syn-command)' },
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--syn-env)' },
  { tag: t.labelName, color: 'var(--syn-label)' },
  { tag: t.className, color: 'var(--syn-env)' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: '700' },
  { tag: t.processingInstruction, color: 'var(--syn-math-delim)', fontWeight: '600' },
  { tag: t.macroName, color: 'var(--syn-math-cmd)' },
  { tag: t.variableName, color: 'var(--syn-math)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.operator, color: 'var(--syn-operator)' },
  { tag: [t.brace, t.squareBracket], color: 'var(--syn-bracket)' },
  { tag: t.escape, color: 'var(--syn-escape)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

// ------------------------------------------------------------------ folding
const SECTION_LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;

function stripComment(text) {
  const m = /(^|[^\\])%/.exec(text);
  return m ? text.slice(0, m.index + m[1].length) : text;
}

export const latexFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = stripComment(line.text);
  const maxLine = Math.min(state.doc.lines, line.number + 8000);

  const begin = /\\begin\s*\{([^}]+)\}/.exec(text);
  if (begin && !/\\end\s*\{/.test(text.slice(begin.index))) {
    const env = begin[1];
    let depth = 1;
    const bRe = new RegExp(`\\\\(begin|end)\\s*\\{${escapeRe(env)}\\}`, 'g');
    for (let n = line.number + 1; n <= maxLine; n++) {
      const l = state.doc.line(n);
      const lt = stripComment(l.text);
      bRe.lastIndex = 0;
      let m;
      while ((m = bRe.exec(lt))) {
        depth += m[1] === 'begin' ? 1 : -1;
        if (depth === 0) {
          if (n === line.number + 1 && l.from + m.index <= line.to + 1) return null;
          return { from: line.to, to: l.from + m.index };
        }
      }
    }
    return null;
  }

  const sec = SECTION_RE.exec(text);
  if (sec) {
    const level = SECTION_LEVEL[sec[1]];
    let last = line.number;
    for (let n = line.number + 1; n <= maxLine; n++) {
      const lt = state.doc.line(n).text;
      const s = SECTION_RE.exec(lt);
      if ((s && SECTION_LEVEL[s[1]] <= level) || /^\s*\\(end\{document\}|bibliography\{|printbibliography|appendix\b)/.test(lt)) break;
      if (lt.trim()) last = n;
    }
    if (last > line.number) return { from: line.to, to: state.doc.line(last).to };
  }
  return null;
});

// Keep the indentation of the previous line (LaTeX has no reliable syntax-based indent).
export const keepIndent = indentService.of((ctx, pos) => {
  const line = ctx.lineAt(pos, -1);
  const prev = line.from > 0 ? ctx.lineAt(line.from - 1) : null;
  if (!prev) return 0;
  const m = /^\s*/.exec(prev.text);
  let indent = m ? m[0].replace(/\t/g, '    ').length : 0;
  if (/\\begin\{(?!document)/.test(prev.text) && !/\\end\{/.test(prev.text)) indent += ctx.unit;
  return indent;
});

// ------------------------------------------------------------------ outline
export function parseOutline(text) {
  const out = [];
  const lines = text.split('\n');
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    const clean = stripComment(lines[i]);
    const m = re.exec(clean);
    if (!m) continue;
    // Read the balanced title (may contain nested braces)
    let depth = 1;
    let j = m.index + m[0].length;
    let title = '';
    while (j < clean.length && depth > 0) {
      const c = clean[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (depth > 0) title += c;
      j++;
    }
    title = title
      .replace(/\\(textbf|textit|emph|texttt|underline)\{([^}]*)\}/g, '$2')
      .replace(/\\[a-zA-Z@]+\*?/g, '')
      .replace(/[{}]/g, '')
      .trim();
    out.push({ level: SECTION_LEVEL[m[1]], kind: m[1], starred: !!m[2], title: title || '(untitled)', line: i + 1 });
  }
  return out;
}
