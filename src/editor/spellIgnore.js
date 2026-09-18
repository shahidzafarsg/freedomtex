// Stop the spell checker from flagging LaTeX commands, labels, citations and math.
import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const noSpell = Decoration.mark({ attributes: { spellcheck: 'false' } });
const RE = /\\(?:begin|end|label|ref|eqref|autoref|cref|Cref|cite[a-z]*|parencite|textcite|autocite|usepackage|documentclass|input|include|includegraphics|bibliography|bibliographystyle|addbibresource|url|href|newcommand|renewcommand|usetikzlibrary|pagestyle|setlength)\*?\s*(?:\[[^\]]*\])?\s*\{[^}]*\}|\\[a-zA-Z@]+|\$[^$\n]*\$|\\\([^\n]*?\\\)|%.*$/gm;

function build(view) {
  const b = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(text))) {
      if (m[0].length) b.add(from + m.index, from + m.index + m[0].length, noSpell);
    }
  }
  return b.finish();
}

export const spellIgnore = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = build(view);
    }
    update(u) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
