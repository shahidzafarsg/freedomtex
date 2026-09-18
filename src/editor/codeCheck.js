// Quick structural checks that run while typing (like Overleaf's "Code check"),
// plus diagnostics from the last compile for the open file.
import { linter } from '@codemirror/lint';

const VERB = /^(verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?)$/;

export function structuralDiagnostics(doc) {
  const text = doc.toString();
  const diags = [];
  const envStack = [];
  const braceStack = [];
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
      if (text.startsWith('\\verb', i) && !/[a-zA-Z]/.test(text[i + 5] || '')) {
        const delim = text[i + 5] === '*' ? text[i + 6] : text[i + 5];
        const start = i + (text[i + 5] === '*' ? 7 : 6);
        const end = text.indexOf(delim, start);
        i = end === -1 ? n : end + 1;
        continue;
      }
      const m = /^\\(begin|end)\s*\{([^}]*)\}/.exec(text.slice(i, i + 100));
      if (m) {
        const [, kind, name] = m;
        if (kind === 'begin') {
          if (VERB.test(name)) {
            const endTag = `\\end{${name}}`;
            const end = text.indexOf(endTag, i + m[0].length);
            if (end === -1) {
              diags.push({ from: i, to: i + m[0].length, severity: 'error', message: `\\begin{${name}} is never closed.` });
              return diags;
            }
            i = end + endTag.length;
            continue;
          }
          envStack.push({ name, from: i, to: i + m[0].length });
        } else {
          const idx = envStack.map((e) => e.name).lastIndexOf(name);
          if (idx === -1) {
            diags.push({ from: i, to: i + m[0].length, severity: 'error', message: `\\end{${name}} has no matching \\begin{${name}}.` });
          } else {
            if (idx !== envStack.length - 1) {
              const open = envStack[envStack.length - 1];
              diags.push({ from: i, to: i + m[0].length, severity: 'error', message: `Expected \\end{${open.name}} before \\end{${name}}.` });
            }
            envStack.length = idx;
          }
        }
        i += m[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === '{') braceStack.push(i);
    else if (c === '}') {
      if (braceStack.length) braceStack.pop();
      else diags.push({ from: i, to: i + 1, severity: 'error', message: 'Unexpected closing brace "}".' });
    }
    i++;
  }
  for (const e of envStack) diags.push({ from: e.from, to: e.to, severity: 'error', message: `\\begin{${e.name}} is never closed.` });
  for (const b of braceStack.slice(-20)) diags.push({ from: b, to: b + 1, severity: 'warning', message: 'This "{" is never closed.' });
  return diags.slice(0, 200);
}

// Filled by the editor controller: () => { enabled, file, issues }
let context = () => ({ codeCheck: false, compileIssues: [] });
export function setLintContext(fn) {
  context = fn;
}

export const ftLinter = linter(
  (view) => {
    const ctx = context();
    const doc = view.state.doc;
    const out = [];
    if (ctx.codeCheck) out.push(...structuralDiagnostics(doc));
    for (const it of ctx.compileIssues || []) {
      if (!it.line || it.line > doc.lines) continue;
      const line = doc.line(it.line);
      out.push({
        from: line.from,
        to: Math.max(line.from, line.to),
        severity: it.level === 'error' ? 'error' : it.level === 'warning' ? 'warning' : 'info',
        source: 'LaTeX',
        message: it.message,
      });
    }
    return out;
  },
  { delay: 700 },
);
