import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export const setComments = StateEffect.define(); // { list: [{id, from, to}], active }
export const addComment = StateEffect.define(); // {id, from, to}
export const removeComment = StateEffect.define(); // id
export const setActiveComment = StateEffect.define(); // id | null

function mark(id, active) {
  return Decoration.mark({ class: active ? 'cm-ft-comment cm-ft-comment-active' : 'cm-ft-comment', attributes: { 'data-cid': id }, id });
}

function ranges(set) {
  const out = [];
  set.between(0, 1e9, (from, to, d) => {
    out.push({ id: d.spec.id, from, to });
  });
  return out;
}

function rebuild(list, active, docLen) {
  const valid = list.filter((c) => c.from < c.to && c.to <= docLen).sort((a, b) => a.from - b.from);
  return Decoration.set(valid.map((c) => mark(c.id, c.id === active).range(c.from, c.to)), true);
}

export const commentField = StateField.define({
  create: () => ({ set: Decoration.none, active: null }),
  update(value, tr) {
    let set = value.set.map(tr.changes);
    let active = value.active;
    let changed = false;
    let list = null;
    for (const e of tr.effects) {
      if (e.is(setComments)) {
        list = e.value.list;
        active = e.value.active ?? active;
        changed = true;
      } else if (e.is(addComment)) {
        list = [...(list || ranges(set)), e.value];
        changed = true;
      } else if (e.is(removeComment)) {
        list = (list || ranges(set)).filter((c) => c.id !== e.value);
        changed = true;
      } else if (e.is(setActiveComment)) {
        active = e.value;
        list = list || ranges(set);
        changed = true;
      }
    }
    if (changed) set = rebuild(list || ranges(set), active, tr.state.doc.length);
    return { set, active };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.set),
});

export function commentRanges(state) {
  const f = state.field(commentField, false);
  return f ? ranges(f.set) : [];
}

export const commentTheme = EditorView.baseTheme({
  '.cm-ft-comment': { backgroundColor: 'rgba(234, 179, 8, 0.22)', borderBottom: '2px solid rgba(234, 179, 8, 0.8)', cursor: 'pointer' },
  '.cm-ft-comment-active': { backgroundColor: 'rgba(234, 179, 8, 0.42)' },
});
