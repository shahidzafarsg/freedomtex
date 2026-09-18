// Visual mode: hides LaTeX markup around the cursor-free parts of the document,
// renders math with KaTeX and shows images inline (similar to a rich-text view).
import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { scanMath, normalizeMath, renderMath } from './math';
import { getState } from '../store';

class MathWidget extends WidgetType {
  constructor(src, display) {
    super();
    this.src = src;
    this.display = display;
  }
  eq(o) {
    return o.src === this.src && o.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-vis-math cm-vis-math-display' : 'cm-vis-math';
    el.innerHTML = renderMath(this.src, this.display);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(o) {
    return o.text === this.text;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-vis-bullet';
    el.textContent = this.text;
    return el;
  }
}

class ImageWidget extends WidgetType {
  constructor(url, name) {
    super();
    this.url = url;
    this.name = name;
  }
  eq(o) {
    return o.url === this.url;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-vis-figure';
    if (/\.pdf$/i.test(this.name) || /\.eps$/i.test(this.name)) {
      wrap.innerHTML = `<div class="cm-vis-figure-ph">Figure: ${this.name.replace(/[<>&]/g, '')}</div>`;
    } else {
      const img = document.createElement('img');
      img.src = this.url;
      img.alt = this.name;
      img.onerror = () => {
        wrap.innerHTML = `<div class="cm-vis-figure-ph">Image not found: ${this.name.replace(/[<>&]/g, '')}</div>`;
      };
      wrap.appendChild(img);
    }
    return wrap;
  }
}

class PreambleWidget extends WidgetType {
  constructor(lines) {
    super();
    this.lines = lines;
  }
  eq(o) {
    return o.lines === this.lines;
  }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-vis-preamble-widget';
    el.textContent = `Preamble (${this.lines} lines of settings and packages). Click to show.`;
    el.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      view.focus();
    };
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const hide = Decoration.replace({});
// Bullet glyphs per nesting level: filled circle, hollow circle, small square, middle dot.
const BULLETS = [0x2022, 0x25e6, 0x25aa, 0x00b7].map((c) => String.fromCharCode(c));
const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 5 };
const FORMAT = { textbf: 'cm-vis-bold', textit: 'cm-vis-italic', emph: 'cm-vis-italic', underline: 'cm-vis-underline', texttt: 'cm-vis-mono', textsc: 'cm-vis-smallcaps', uline: 'cm-vis-underline', textsf: 'cm-vis-sans' };
const REFS = /\\(ref|eqref|autoref|cref|Cref|pageref|cite|citep|citet|parencite|textcite|autocite|label)\*?\s*(\[[^\]]*\])?\{[^}]*\}/g;

function closeBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function touches(sel, from, to) {
  for (const r of sel.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

function resolveImage(path) {
  const idx = getState().index;
  const proj = getState().project;
  if (!proj) return null;
  const imgs = idx.images || [];
  const candidates = [path, ...['.png', '.jpg', '.jpeg', '.pdf', '.svg', '.gif'].map((e) => path + e)];
  const found = candidates.find((c) => imgs.includes(c)) || imgs.find((i) => i.endsWith('/' + path) || candidates.some((c) => i.endsWith('/' + c)));
  if (!found) return null;
  return { url: `ftasset://${proj.id}/${found.split('/').map(encodeURIComponent).join('/')}`, name: found };
}

function build(state) {
  const deco = [];
  const sel = state.selection;
  const doc = state.doc;
  const text = doc.toString();
  const bodyStart = text.indexOf('\\begin{document}');

  // Collapse the preamble into one clickable line unless the cursor is in it.
  let preambleCollapsed = false;
  if (bodyStart > 0) {
    const bodyLine = doc.lineAt(bodyStart);
    if (bodyLine.number > 2 && !touches(sel, 0, bodyLine.from - 1)) {
      deco.push(Decoration.replace({ widget: new PreambleWidget(bodyLine.number - 1), block: true }).range(0, bodyLine.from - 1));
      preambleCollapsed = true;
    }
  }

  // Math
  const mathSpans = scanMath(text, 0);
  const inMath = (pos) => mathSpans.some((s) => pos > s.from && pos < s.to);
  for (const s of mathSpans) {
    if (bodyStart !== -1 && s.from < bodyStart) continue;
    if (touches(sel, s.from, s.to)) {
      deco.push(Decoration.mark({ class: 'cm-vis-math-src' }).range(s.from, s.to));
      continue;
    }
    deco.push(Decoration.replace({ widget: new MathWidget(normalizeMath(s), s.display) }).range(s.from, s.to));
  }

  // Line-oriented constructs
  const listStack = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const t = line.text;
    if (!t.includes('\\')) continue;
    if (bodyStart !== -1 && line.to < bodyStart) {
      if (!preambleCollapsed) deco.push(Decoration.line({ class: 'cm-vis-preamble' }).range(line.from));
      continue;
    }
    const lineSel = touches(sel, line.from, line.to);
    const commentAt = (() => {
      const m = /(^|[^\\])%/.exec(t);
      return m ? m.index + m[1].length : t.length;
    })();
    const code = t.slice(0, commentAt);

    // Sectioning and title-like commands
    const sec = /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|title|author|date)(\*?)\s*(\[[^\]]*\])?\{/.exec(code);
    if (sec) {
      const open = sec[0].length - 1;
      const close = closeBrace(code, open);
      if (close !== -1) {
        const kind = sec[2];
        const cls = kind in LEVELS ? `cm-vis-h cm-vis-h${LEVELS[kind]}` : `cm-vis-${kind}`;
        deco.push(Decoration.line({ class: cls }).range(line.from));
        if (!lineSel) {
          deco.push(hide.range(line.from + sec[1].length, line.from + open + 1));
          deco.push(hide.range(line.from + close, line.from + close + 1));
        }
      }
    }

    // Environments: lists get bullets, other begin/end lines are subdued
    const envRe = /\\(begin|end)\s*\{([^}]+)\}/g;
    let em;
    while ((em = envRe.exec(code))) {
      const [, kind, name] = em;
      if (['itemize', 'enumerate', 'description'].includes(name)) {
        if (kind === 'begin') listStack.push({ name, count: 0 });
        else listStack.pop();
      }
      if (name !== 'document' && !inMath(line.from + em.index)) deco.push(Decoration.line({ class: 'cm-vis-envline' }).range(line.from));
    }
    const item = /^(\s*)\\item\b\s?(\[[^\]]*\])?/.exec(code);
    if (item && listStack.length) {
      const top = listStack[listStack.length - 1];
      top.count++;
      const label = top.name === 'enumerate' ? `${top.count}.` : top.name === 'description' ? '' : BULLETS[(listStack.length - 1) % 4];
      deco.push(Decoration.line({ class: 'cm-vis-item', attributes: { style: `--depth:${listStack.length}` } }).range(line.from));
      if (!lineSel) {
        const from = line.from + item[1].length;
        const to = line.from + item[0].length - (item[2] ? item[2].length : 0);
        deco.push(Decoration.replace({ widget: new BulletWidget(label) }).range(from, to));
        if (item[2]) deco.push(Decoration.mark({ class: 'cm-vis-bold' }).range(to, line.from + item[0].length));
      }
    }

    // Inline formatting
    const fmtRe = /\\(textbf|textit|emph|underline|texttt|textsc|uline|textsf)\s*\{/g;
    let fm;
    while ((fm = fmtRe.exec(code))) {
      const open = fm.index + fm[0].length - 1;
      const close = closeBrace(code, open);
      if (close === -1) continue;
      const from = line.from + fm.index;
      const to = line.from + close + 1;
      if (inMath(from)) continue;
      if (to - from > 1) deco.push(Decoration.mark({ class: FORMAT[fm[1]] }).range(line.from + open + 1, line.from + close));
      if (!touches(sel, from, to)) {
        deco.push(hide.range(from, line.from + open + 1));
        deco.push(hide.range(line.from + close, to));
      }
    }

    // References and citations as chips
    REFS.lastIndex = 0;
    let rm;
    while ((rm = REFS.exec(code))) {
      const from = line.from + rm.index;
      if (inMath(from)) continue;
      deco.push(Decoration.mark({ class: rm[1] === 'label' ? 'cm-vis-label' : 'cm-vis-ref' }).range(from, from + rm[0].length));
    }

    // Images
    const img = /\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]+)\}/.exec(code);
    if (img) {
      const found = resolveImage(img[2].trim());
      if (found) deco.push(Decoration.widget({ widget: new ImageWidget(found.url, found.name), block: true, side: 1 }).range(line.to));
    }
  }

  // RangeSetBuilder needs sorted input; line decorations first at equal positions.
  deco.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0) || a.to - b.to);
  const builder = new RangeSetBuilder();
  let lastTo = -1;
  for (const d of deco) {
    const isReplace = d.value.spec && (d.value.spec.widget || d.value === hide) && d.from !== d.to;
    // Skip replacements that would overlap an earlier replacement (e.g. formatting inside hidden math)
    if (isReplace && d.from < lastTo) continue;
    try {
      builder.add(d.from, d.to, d.value);
      if (isReplace) lastTo = Math.max(lastTo, d.to);
    } catch {
      /* ordering conflict; drop this decoration */
    }
  }
  return builder.finish();
}

export const visualField = StateField.define({
  create: (state) => build(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length) return build(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const visualTheme = EditorView.baseTheme({
  '.cm-vis-h': { fontFamily: 'var(--font-ui)', fontWeight: '700', color: 'var(--text)' },
  '.cm-vis-h0': { fontSize: '1.9em', paddingTop: '0.5em' },
  '.cm-vis-h1': { fontSize: '1.7em', paddingTop: '0.5em' },
  '.cm-vis-h2': { fontSize: '1.42em', paddingTop: '0.4em' },
  '.cm-vis-h3': { fontSize: '1.22em', paddingTop: '0.3em' },
  '.cm-vis-h4': { fontSize: '1.08em' },
  '.cm-vis-h5': { fontSize: '1em', fontStyle: 'italic' },
  '.cm-vis-title': { fontSize: '1.8em', fontWeight: '700', textAlign: 'center', fontFamily: 'var(--font-ui)' },
  '.cm-vis-author, .cm-vis-date': { textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' },
  '.cm-vis-bold': { fontWeight: '700' },
  '.cm-vis-italic': { fontStyle: 'italic' },
  '.cm-vis-underline': { textDecoration: 'underline' },
  '.cm-vis-mono': { fontFamily: 'var(--font-mono)', background: 'var(--bg-sunken)', borderRadius: '3px' },
  '.cm-vis-smallcaps': { fontVariant: 'small-caps' },
  '.cm-vis-sans': { fontFamily: 'var(--font-ui)' },
  '.cm-vis-envline': { opacity: '0.55', fontSize: '0.88em' },
  '.cm-vis-preamble': { opacity: '0.6' },
  '.cm-vis-preamble-widget': {
    margin: '4px 8px 8px',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px dashed var(--border-strong)',
    background: 'var(--bg-sunken)',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: '12.5px',
    cursor: 'pointer',
  },
  '.cm-vis-item': { paddingLeft: 'calc(var(--depth, 1) * 4px) !important' },
  '.cm-vis-bullet': { display: 'inline-block', minWidth: '1.6em', color: 'var(--accent)', fontWeight: '700' },
  '.cm-vis-ref': { background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: '4px', padding: '0 3px' },
  '.cm-vis-label': { color: 'var(--text-faint)', fontSize: '0.85em' },
  '.cm-vis-math': { padding: '0 1px' },
  '.cm-vis-math-display': { display: 'block', textAlign: 'center', padding: '6px 0', overflowX: 'auto' },
  '.cm-vis-math-src': { background: 'var(--accent-soft)', borderRadius: '3px' },
  '.cm-vis-figure': { padding: '6px 0 10px', textAlign: 'center' },
  '.cm-vis-figure img': { maxWidth: '70%', maxHeight: '260px', borderRadius: '6px', boxShadow: 'var(--shadow)' },
  '.cm-vis-figure-ph': { display: 'inline-block', padding: '14px 22px', border: '1px dashed var(--border-strong)', borderRadius: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' },
});
