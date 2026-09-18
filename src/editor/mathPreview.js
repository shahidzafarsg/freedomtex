import { StateField } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';
import { mathAt, normalizeMath, renderMath } from './math';

function computeTooltip(state) {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const span = mathAt(state.doc, sel.head, 30);
  if (!span) return null;
  const src = normalizeMath(span);
  if (!src.trim()) return null;
  return {
    pos: span.from,
    above: true,
    strictSide: false,
    arrow: false,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-math-preview';
      dom.innerHTML = renderMath(src, true);
      return { dom };
    },
  };
}

export const mathPreview = StateField.define({
  create: (state) => computeTooltip(state),
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return computeTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});
