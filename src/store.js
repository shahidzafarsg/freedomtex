import { create } from 'zustand';

const emptyIssues = { errors: [], warnings: [], typesetting: [] };
const emptyIndex = { labels: [], bib: [], commands: [], environments: [], texFiles: [], images: [], bibFiles: [] };

export const useStore = create((set) => ({
  // app
  screen: 'loading', // loading | setup | dashboard | editor
  info: null,
  settings: null,
  tex: null,
  resolvedTheme: 'light',
  dialogs: [],
  toasts: [],

  // dashboard
  projects: [],
  tags: [],
  templates: [],

  // editor
  project: null,
  tree: [],
  expanded: {},
  selectedPath: null,
  openPath: null,
  openKind: null, // text | image | pdf | binary
  dirty: {},
  saveState: 'saved',
  sidebarOpen: true,
  sidebarPanel: 'files', // files | search | review | outline
  editorMode: 'source',
  showSymbols: false,
  pdfTab: 'pdf', // pdf | logs
  historyOpen: false,
  outline: [],
  outlineOpen: true,
  currentSection: -1,
  cursor: { line: 1, col: 1 },
  selectionEmpty: true,
  index: emptyIndex,
  comments: [],
  activeComment: null,
  compile: { running: false, status: null, result: null, liveLog: '', lastRun: 0 },
  issues: emptyIssues,
  pdf: { data: null, version: 0, path: null },
  syncTarget: null, // forward-search highlight { rects, ts }
  searchState: { query: '', replace: '', regex: false, caseSensitive: false, wholeWord: false, results: null },

  set: (patch) => set(typeof patch === 'function' ? patch : () => patch),
}));

export const getState = () => useStore.getState();
export const setState = (patch) => useStore.setState(patch);

export function resetProjectState() {
  useStore.setState({
    project: null,
    tree: [],
    expanded: {},
    selectedPath: null,
    openPath: null,
    openKind: null,
    dirty: {},
    saveState: 'saved',
    historyOpen: false,
    outline: [],
    currentSection: -1,
    index: emptyIndex,
    comments: [],
    activeComment: null,
    compile: { running: false, status: null, result: null, liveLog: '', lastRun: 0 },
    issues: emptyIssues,
    pdf: { data: null, version: 0, path: null },
    syncTarget: null,
    pdfTab: 'pdf',
    searchState: { query: '', replace: '', regex: false, caseSensitive: false, wholeWord: false, results: null },
  });
}
