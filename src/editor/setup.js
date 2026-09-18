import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  Decoration,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, foldKeymap, syntaxHighlighting, bracketMatching, indentUnit, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintKeymap, lintGutter } from '@codemirror/lint';
import { vim } from '@replit/codemirror-vim';
import { emacs } from '@replit/codemirror-emacs';
import { latexLanguage, bibtexLanguage, ftHighlight, latexFolding, keepIndent } from './modes';
import { latexCompletions } from './completions';
import { visualField, visualTheme } from './visual';
import { mathPreview } from './mathPreview';
import { ftLinter } from './codeCheck';
import { commentField, commentTheme } from './comments';
import { spellIgnore } from './spellIgnore';

export const cmp = {
  language: new Compartment(),
  theme: new Compartment(),
  keys: new Compartment(),
  wrap: new Compartment(),
  gutters: new Compartment(),
  activeLine: new Compartment(),
  complete: new Compartment(),
  brackets: new Compartment(),
  visual: new Compartment(),
  preview: new Compartment(),
  spell: new Compartment(),
  lint: new Compartment(),
  readOnly: new Compartment(),
};

export function isLatexFile(path) {
  return /\.(tex|ltx|latex|sty|cls|clo|def|dtx|ins|bbx|cbx|lbx|cfg|tikz|pgf)$/i.test(path || '');
}

function languageExt(path) {
  if (isLatexFile(path)) return [latexLanguage, latexFolding, keepIndent];
  if (/\.bib$/i.test(path)) return [bibtexLanguage];
  return [];
}

const baseTheme = (dark) =>
  EditorView.theme(
    {
      '&': { height: '100%', fontSize: 'var(--editor-font-size, 14px)', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
      '.cm-scroller': { fontFamily: 'var(--editor-font)', lineHeight: 'var(--editor-line-height, 1.6)', overflow: 'auto' },
      '.cm-content': { caretColor: 'var(--editor-cursor)', padding: '10px 0 45vh' },
      '.cm-line': { padding: '0 14px 0 8px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-cursor)', borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--editor-selection) !important',
      },
      '.cm-gutters': { backgroundColor: 'var(--editor-gutter)', color: 'var(--editor-gutter-text)', border: 'none', paddingLeft: '4px' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', minWidth: '38px', fontSize: '0.86em' },
      '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)', color: 'var(--text)' },
      '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-faint)', padding: '0 4px', cursor: 'pointer' },
      '.cm-foldPlaceholder': { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', padding: '0 6px', margin: '0 3px' },
      '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)', color: 'inherit !important' },
      '.cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)' },
      '.cm-searchMatch': { backgroundColor: 'var(--editor-match)', borderRadius: '2px' },
      '.cm-searchMatch-selected': { outline: '1px solid #eab308' },
      '.cm-selectionMatch': { backgroundColor: 'var(--editor-match)' },
      '.cm-tooltip': { background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow)', color: 'var(--text)', overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', maxHeight: '18em' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px !important', lineHeight: '1.5' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent)', color: 'var(--accent-fg)' },
      '.cm-completionDetail': { fontFamily: 'var(--font-ui)', fontStyle: 'normal', opacity: '0.65', marginLeft: '12px', fontSize: '11.5px' },
      '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
      '.cm-completionIcon': { display: 'none' },
      '.cm-completionInfo': { padding: '8px 10px', fontFamily: 'var(--font-ui)', maxWidth: '320px' },
      '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--text)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
      '.cm-panel.cm-search': { padding: '8px 10px', fontFamily: 'var(--font-ui)', fontSize: '12.5px' },
      '.cm-panel.cm-search input, .cm-panel.cm-gotoLine input': {
        background: 'var(--bg-input)',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        padding: '4px 8px',
        color: 'var(--text)',
        outline: 'none',
      },
      '.cm-panel.cm-search button, .cm-panel.cm-gotoLine button': {
        background: 'var(--bg-elev)',
        backgroundImage: 'none',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        padding: '3px 10px',
        color: 'var(--text)',
        cursor: 'pointer',
      },
      '.cm-panel.cm-search label': { fontSize: '12px', color: 'var(--text-muted)' },
      '.cm-panel button[name=close]': { border: 'none', background: 'transparent', fontSize: '18px', color: 'var(--text-muted)' },
      '.cm-diagnostic': { padding: '6px 10px', fontFamily: 'var(--font-ui)', fontSize: '12.5px' },
      '.cm-diagnostic-error': { borderLeft: '4px solid var(--danger)' },
      '.cm-diagnostic-warning': { borderLeft: '4px solid var(--warning)' },
      '.cm-diagnostic-info': { borderLeft: '4px solid var(--info)' },
      '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
      '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
      '.cm-lintRange-info': { backgroundImage: 'none' },
      '.cm-lint-marker': { width: '0.9em', height: '0.9em' },
      '.cm-math-preview': { padding: '8px 14px', maxWidth: '640px', overflowX: 'auto', fontSize: '1.05em' },
      '.cm-math-error': { color: 'var(--danger)', fontFamily: 'var(--font-ui)', fontSize: '12px' },
      '.cm-flash-line': { backgroundColor: 'rgba(250, 204, 21, 0.3)', transition: 'background-color 1s' },
      '.cm-vim-panel, .cm-vim-panel input': { fontFamily: 'var(--font-mono)', background: 'var(--bg-elev)', color: 'var(--text)' },
      '.cm-fat-cursor': { background: 'var(--editor-cursor) !important', color: 'var(--editor-bg) !important' },
    },
    { dark },
  );

// Temporary highlight used when jumping to a line (e.g. from the PDF).
export const flashEffect = StateEffect.define();
const flashMark = Decoration.line({ class: 'cm-flash-line' });
export const flashField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) value = e.value == null ? Decoration.none : Decoration.set([flashMark.range(e.value)]);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function keysExt(mode) {
  if (mode === 'vim') return vim();
  if (mode === 'emacs') return emacs();
  return [];
}

/** Everything that depends on settings/mode, as compartment contents. */
export function configParts(path, cfg) {
  const latex = isLatexFile(path);
  return {
    language: languageExt(path),
    theme: baseTheme(cfg.dark),
    keys: keysExt(cfg.keybindings),
    wrap: cfg.wordWrap ? EditorView.lineWrapping : [],
    gutters: cfg.lineNumbers ? [lineNumbers(), foldGutter({ openText: '▾', closedText: '▸' }), lintGutter()] : [foldGutter({ openText: '▾', closedText: '▸' })],
    activeLine: cfg.highlightActiveLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    complete: cfg.autoComplete && latex ? autocompletion({ override: [latexCompletions], maxRenderedOptions: 60, activateOnTypingDelay: 60 }) : autocompletion({ override: latex ? [latexCompletions] : [], activateOnTyping: false }),
    brackets: cfg.autoCloseBrackets ? closeBrackets() : [],
    visual: cfg.visual && latex ? [visualField, visualTheme, EditorView.editorAttributes.of({ class: 'cm-visual' })] : [],
    preview: cfg.mathPreview && latex && !cfg.visual ? mathPreview : [],
    spell: cfg.spellCheck ? [EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }), latex ? spellIgnore : []] : [EditorView.contentAttributes.of({ spellcheck: 'false' })],
    lint: latex ? ftLinter : [],
    readOnly: EditorState.readOnly.of(!!cfg.readOnly),
  };
}

export function buildExtensions(path, cfg, { updateListener, editorKeymap, domHandlers }) {
  const p = configParts(path, cfg);
  return [
    cmp.keys.of(p.keys),
    cmp.gutters.of(p.gutters),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of('    '),
    syntaxHighlighting(ftHighlight),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([...editorKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    cmp.language.of(p.language),
    cmp.theme.of(p.theme),
    cmp.wrap.of(p.wrap),
    cmp.activeLine.of(p.activeLine),
    cmp.complete.of(p.complete),
    cmp.brackets.of(p.brackets),
    cmp.visual.of(p.visual),
    cmp.preview.of(p.preview),
    cmp.spell.of(p.spell),
    cmp.lint.of(p.lint),
    cmp.readOnly.of(p.readOnly),
    commentField,
    commentTheme,
    flashField,
    EditorView.updateListener.of(updateListener),
    EditorView.domEventHandlers(domHandlers),
  ];
}

export function reconfigureEffects(path, cfg) {
  const p = configParts(path, cfg);
  return Object.entries(p).map(([k, v]) => cmp[k].reconfigure(v));
}
