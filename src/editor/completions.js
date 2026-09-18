import { snippet } from '@codemirror/autocomplete';
import { COMMANDS, ENVIRONMENTS, PACKAGES, CLASSES, REF_CMDS, CITE_CMDS, toSnippet } from './latexData';
import { getState } from '../store';

const TIKZ_LIBS = 'arrows arrows.meta automata backgrounds calc calligraphy chains decorations decorations.pathmorphing decorations.markings decorations.pathreplacing fit intersections matrix mindmap patterns petri positioning quotes shadows shapes shapes.geometric shapes.misc shapes.arrows shapes.symbols snakes spy through trees'.split(' ');

function envTemplate(name) {
  let body = ENVIRONMENTS[name] ?? '\n\t#\n';
  if (!/#/.test(body)) body = body + '#';
  return toSnippet(`${name}}${body}`) + `\\end{${name}}`;
}

function envNames() {
  const idx = getState().index;
  const set = new Set(Object.keys(ENVIRONMENTS));
  for (const e of idx.environments || []) set.add(e.name);
  return [...set];
}

function commandOptions() {
  const idx = getState().index;
  const opts = COMMANDS.map((c) => ({
    label: c.label,
    detail: c.detail,
    type: 'function',
    apply: c.hasArgs ? snippet('\\' + c.snippet) : c.label,
    boost: c.detail === 'Structure' || c.detail === 'Text' ? 1 : 0,
  }));
  // Commands defined in the project (\newcommand)
  const seen = new Set(COMMANDS.map((c) => c.label));
  for (const c of idx.commands || []) {
    const label = `\\${c.name}`;
    if (seen.has(label)) continue;
    seen.add(label);
    const args = Array.from({ length: c.args }, (_, i) => `{\${${i + 1}}}`).join('');
    opts.push({ label, detail: `defined in ${c.file}`, type: 'function', apply: args ? snippet(`\\${c.name}${args}`) : label, boost: 2 });
  }
  // Shortcuts for common environments
  for (const env of ['itemize', 'enumerate', 'figure', 'table', 'equation', 'align', 'tabular', 'frame', 'center', 'description', 'abstract', 'minipage', 'lstlisting', 'theorem', 'proof']) {
    opts.push({
      label: `\\begin{${env}}`,
      detail: 'Environment',
      type: 'keyword',
      apply: snippet(`\\begin{${envTemplate(env)}`),
      boost: -1,
    });
  }
  return opts;
}

let cachedCommands = null;
let cachedIndex = null;

export function latexCompletions(context) {
  const state = context.state;
  const pos = context.pos;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  // Ignore comments
  if (/(^|[^\\])%/.test(before)) return null;

  // Argument completions: \cmd{partial
  const arg = /\\([a-zA-Z@]+)\*?(?:\[[^\]]*\]|<[^>]*>)*\{([^{}]*)$/.exec(before);
  if (arg) {
    const cmd = arg[1];
    const partial = arg[2];
    const lastComma = partial.lastIndexOf(',');
    const word = partial.slice(lastComma + 1).trimStart();
    const from = pos - word.length;
    const nextChar = state.sliceDoc(pos, pos + 1);
    const close = nextChar === '}' ? '' : '}';
    const idx = getState().index;

    if (cmd === 'begin') {
      const envFrom = pos - partial.length;
      return {
        from: envFrom,
        validFor: /^[\w*@-]*$/,
        options: envNames().map((name) => ({
          label: name,
          type: 'keyword',
          detail: 'environment',
          apply: (view, completion, f, t) => {
            const to = view.state.sliceDoc(t, t + 1) === '}' ? t + 1 : t;
            snippet(envTemplate(name))(view, completion, f, to);
          },
        })),
      };
    }
    if (cmd === 'end') {
      return { from: pos - partial.length, validFor: /^[\w*@-]*$/, options: envNames().map((name) => ({ label: name, type: 'keyword', apply: name + close })) };
    }
    const hyper = /\\hyperref\[([^\]]*)$/.exec(before);
    if (REF_CMDS.test(`\\${cmd}`) || hyper) {
      return {
        from,
        validFor: /^[\w:.\-/]*$/,
        options: (idx.labels || []).map((l) => ({ label: l.label, type: 'variable', detail: `${l.file}:${l.line}`, apply: l.label + close })),
      };
    }
    if (CITE_CMDS.test(`\\${cmd}`)) {
      return {
        from,
        validFor: /^[\w:.\-/]*$/,
        options: (idx.bib || []).map((b) => ({
          label: b.key,
          type: 'text',
          detail: [b.author.split(/\s+and\s+/)[0]?.split(',')[0], b.year].filter(Boolean).join(', '),
          info: b.title || undefined,
          apply: b.key,
        })),
      };
    }
    if (cmd === 'usepackage' || cmd === 'RequirePackage') {
      return { from, validFor: /^[\w-]*$/, options: PACKAGES.map((p) => ({ label: p, type: 'namespace' })) };
    }
    if (cmd === 'documentclass') {
      return { from, validFor: /^[\w-]*$/, options: CLASSES.map((c) => ({ label: c, type: 'class', apply: c + close })) };
    }
    if (cmd === 'input' || cmd === 'include' || cmd === 'subfile' || cmd === 'includeonly') {
      return {
        from: pos - partial.length,
        validFor: /^[\w./-]*$/,
        options: (idx.texFiles || []).filter((f) => /\.tex$/i.test(f)).map((f) => ({ label: f.replace(/\.tex$/i, ''), type: 'text', apply: f.replace(/\.tex$/i, '') + close })),
      };
    }
    if (cmd === 'includegraphics' || cmd === 'includesvg' || cmd === 'includepdf') {
      return {
        from: pos - partial.length,
        validFor: /^[\w./ -]*$/,
        options: (idx.images || []).map((f) => ({ label: f, type: 'text', apply: f + close })),
      };
    }
    if (cmd === 'bibliography') {
      return { from, validFor: /^[\w./-]*$/, options: (idx.bibFiles || []).map((f) => ({ label: f.replace(/\.bib$/i, ''), type: 'text' })) };
    }
    if (cmd === 'addbibresource') {
      return { from: pos - partial.length, validFor: /^[\w./-]*$/, options: (idx.bibFiles || []).map((f) => ({ label: f, type: 'text', apply: f + close })) };
    }
    if (cmd === 'usetikzlibrary') {
      return { from, validFor: /^[\w.-]*$/, options: TIKZ_LIBS.map((l) => ({ label: l, type: 'namespace' })) };
    }
    return null;
  }

  // Command completions: \partial
  const cmd = context.matchBefore(/\\[a-zA-Z@]*/);
  if (cmd && (cmd.text.length > 1 || context.explicit)) {
    const idx = getState().index;
    if (!cachedCommands || cachedIndex !== idx) {
      cachedCommands = commandOptions();
      cachedIndex = idx;
    }
    return { from: cmd.from, options: cachedCommands, validFor: /^\\[a-zA-Z@]*$/ };
  }
  return null;
}
