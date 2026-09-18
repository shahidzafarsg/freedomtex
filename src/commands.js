// Every user-facing action in one place. Menus, toolbar buttons and keyboard shortcuts run these by id.
import { getState, setState } from './store';
import { call } from './lib/api';
import { openDialog, toast } from './lib/ui';
import * as A from './actions';
import * as E from './editor/controller';

const inProject = () => !!getState().project;
const inText = () => inProject() && getState().openKind === 'text' && !getState().historyOpen;

function layout(l) {
  A.updateSettings({ layout: l });
}

export const commands = {
  // File
  newProject: { label: 'New Project...', shortcut: 'Ctrl+Shift+N', run: () => openDialog('newProject') },
  newBlank: { label: 'Blank Project', run: () => A.createProject('blank') },
  newExample: { label: 'Example Project', run: () => A.createProject('example', 'Example Project') },
  templates: { label: 'Templates...', run: () => openDialog('templates') },
  importZip: { label: 'Upload Project (ZIP)...', run: () => A.importZip() },
  openFolder: { label: 'Open Folder as Project...', run: () => A.importFolder() },
  openProjects: { label: 'All Projects', shortcut: 'Ctrl+O', run: () => (inProject() ? A.closeProject() : setState({ screen: 'dashboard' })) },
  newFile: { label: 'New File...', enabled: inProject, run: () => A.newFile(currentDir()) },
  newFolder: { label: 'New Folder...', enabled: inProject, run: () => A.newFolder(currentDir()) },
  uploadFiles: { label: 'Upload Files...', enabled: inProject, run: () => A.uploadFiles(currentDir()) },
  save: { label: 'Save', shortcut: 'Ctrl+S', enabled: inProject, run: () => A.saveAndCompile() },
  saveAll: { label: 'Save All', enabled: inProject, run: () => E.saveAll() },
  downloadPdf: { label: 'Download PDF...', enabled: inProject, run: () => A.downloadPdf() },
  exportZip: { label: 'Download Source (ZIP)...', enabled: inProject, run: () => A.exportZip() },
  projectSettings: { label: 'Project Settings...', enabled: inProject, run: () => openDialog('settings', { tab: 'project' }) },
  openProjectFolder: { label: 'Show Project Folder', enabled: inProject, run: () => A.openProjectFolder() },
  closeProject: { label: 'Close Project', enabled: inProject, run: () => A.closeProject() },
  exit: { label: 'Exit', shortcut: 'Alt+F4', run: () => window.close() },

  // Edit
  undo: { label: 'Undo', shortcut: 'Ctrl+Z', enabled: inText, run: () => E.run('undo') },
  redo: { label: 'Redo', shortcut: 'Ctrl+Y', enabled: inText, run: () => E.run('redo') },
  cut: { label: 'Cut', shortcut: 'Ctrl+X', run: () => (E.focus(), document.execCommand('cut')) },
  copy: { label: 'Copy', shortcut: 'Ctrl+C', run: () => document.execCommand('copy') },
  paste: { label: 'Paste', shortcut: 'Ctrl+V', enabled: inText, run: () => pasteText() },
  selectAll: { label: 'Select All', shortcut: 'Ctrl+A', enabled: inText, run: () => E.run('selectAll') },
  find: { label: 'Find and Replace', shortcut: 'Ctrl+F', enabled: inText, run: () => E.run('find') },
  projectSearch: { label: 'Search in Project', shortcut: 'Ctrl+Shift+F', enabled: inProject, run: () => setState({ sidebarOpen: true, sidebarPanel: 'search', historyOpen: false }) },
  gotoLine: { label: 'Go to Line...', shortcut: 'Ctrl+Alt+G', enabled: inText, run: () => E.run('gotoLine') },
  toggleComment: { label: 'Toggle Line Comment', shortcut: 'Ctrl+/', enabled: inText, run: () => E.run('toggleComment') },
  indentMore: { label: 'Indent', shortcut: 'Tab', enabled: inText, run: () => E.run('indentMore') },
  indentLess: { label: 'Outdent', shortcut: 'Shift+Tab', enabled: inText, run: () => E.run('indentLess') },
  addComment: { label: 'Add Comment', shortcut: 'Ctrl+Shift+C', enabled: inText, run: () => A.startComment() },
  preferences: { label: 'Settings...', shortcut: 'Ctrl+,', run: () => openDialog('settings') },

  // Insert
  insSection: { label: 'Section', enabled: inText, run: () => E.setSectionLevel('section') },
  insSubsection: { label: 'Subsection', enabled: inText, run: () => E.setSectionLevel('subsection') },
  insSubsubsection: { label: 'Subsubsection', enabled: inText, run: () => E.setSectionLevel('subsubsection') },
  insChapter: { label: 'Chapter', enabled: inText, run: () => E.setSectionLevel('chapter') },
  insFigure: { label: 'Figure...', enabled: inText, run: () => openDialog('figure') },
  insTable: { label: 'Table...', enabled: inText, run: () => openDialog('table') },
  insInlineMath: { label: 'Inline Math', shortcut: 'Ctrl+Shift+M', enabled: inText, run: () => E.wrap('$', '$') },
  insDisplayMath: { label: 'Display Math', enabled: inText, run: () => E.insertTemplate('\\[\n\t#\n\\]') },
  insEquation: { label: 'Numbered Equation', enabled: inText, run: () => E.insertTemplate('\\begin{equation}\n\t#1\n\t\\label{eq:#2}\n\\end{equation}') },
  insAlign: { label: 'Aligned Equations', enabled: inText, run: () => E.insertTemplate('\\begin{align}\n\t#1 &= #2 \\\\\n\t#3 &= #4\n\\end{align}') },
  insItemize: { label: 'Bulleted List', enabled: inText, run: () => E.insertList('itemize') },
  insEnumerate: { label: 'Numbered List', enabled: inText, run: () => E.insertList('enumerate') },
  insCite: { label: 'Citation', enabled: inText, run: () => E.insertTemplate('\\cite{#}') },
  insRef: { label: 'Cross-reference', enabled: inText, run: () => E.insertTemplate('\\ref{#}') },
  insLabel: { label: 'Label', enabled: inText, run: () => E.insertTemplate('\\label{#}') },
  insFootnote: { label: 'Footnote', enabled: inText, run: () => E.wrap('\\footnote{', '}') },
  insLink: { label: 'Link', enabled: inText, run: () => E.insertTemplate('\\href{#1}{' + (E.selectionText() || '#2') + '}') },
  insSymbol: { label: 'Symbol Palette', enabled: inText, run: () => setState({ showSymbols: !getState().showSymbols }) },
  insBibliography: { label: 'Bibliography', enabled: inText, run: () => E.insertTemplate('\\bibliographystyle{#1}\n\\bibliography{#2}') },
  insTOC: { label: 'Table of Contents', enabled: inText, run: () => E.insertText('\\tableofcontents\n') },
  insPageBreak: { label: 'Page Break', enabled: inText, run: () => E.insertText('\\newpage\n') },

  // Format
  bold: { label: 'Bold', shortcut: 'Ctrl+B', enabled: inText, run: () => E.wrap('\\textbf{', '}') },
  italic: { label: 'Italic', shortcut: 'Ctrl+I', enabled: inText, run: () => E.wrap('\\textit{', '}') },
  underline: { label: 'Underline', enabled: inText, run: () => E.wrap('\\underline{', '}') },
  monospace: { label: 'Monospace', enabled: inText, run: () => E.wrap('\\texttt{', '}') },
  emph: { label: 'Emphasis', enabled: inText, run: () => E.wrap('\\emph{', '}') },
  smallcaps: { label: 'Small Caps', enabled: inText, run: () => E.wrap('\\textsc{', '}') },
  alignCenter: { label: 'Center', enabled: inText, run: () => E.insertTemplate('\\begin{center}\n\t' + (E.selectionText() || '#') + '\n\\end{center}') },
  fontLarge: { label: 'Larger Text', enabled: inText, run: () => E.wrap('{\\large ', '}') },
  fontSmall: { label: 'Smaller Text', enabled: inText, run: () => E.wrap('{\\small ', '}') },

  // View
  modeSource: { label: 'Code Editor', enabled: inProject, checked: () => getState().editorMode === 'source', run: () => A.setEditorMode('source') },
  modeVisual: { label: 'Visual Editor', enabled: inProject, checked: () => getState().editorMode === 'visual', run: () => A.setEditorMode('visual') },
  layoutSplit: { label: 'Editor and PDF', checked: () => getState().settings?.layout === 'split', enabled: inProject, run: () => layout('split') },
  layoutEditor: { label: 'Editor Only', checked: () => getState().settings?.layout === 'editor', enabled: inProject, run: () => layout('editor') },
  layoutPdf: { label: 'PDF Only', checked: () => getState().settings?.layout === 'pdf', enabled: inProject, run: () => layout('pdf') },
  toggleSidebar: { label: 'File Tree', shortcut: 'Ctrl+Shift+E', checked: () => getState().sidebarOpen, enabled: inProject, run: () => setState({ sidebarOpen: !getState().sidebarOpen }) },
  toggleOutline: { label: 'File Outline', checked: () => getState().outlineOpen, enabled: inProject, run: () => setState({ outlineOpen: !getState().outlineOpen, sidebarOpen: true, sidebarPanel: 'files' }) },
  toggleSymbols: { label: 'Symbol Palette', checked: () => getState().showSymbols, enabled: inText, run: () => setState({ showSymbols: !getState().showSymbols }) },
  toggleLogs: { label: 'Logs and Errors', shortcut: 'Ctrl+J', checked: () => getState().pdfTab === 'logs', enabled: inProject, run: () => setState({ pdfTab: getState().pdfTab === 'logs' ? 'pdf' : 'logs' }) },
  themeLight: { label: 'Light', checked: () => getState().settings?.theme === 'light', run: () => A.setTheme('light') },
  themeDark: { label: 'Dark', checked: () => getState().settings?.theme === 'dark', run: () => A.setTheme('dark') },
  themeSystem: { label: 'Use System Setting', checked: () => getState().settings?.theme === 'system', run: () => A.setTheme('system') },
  toggleTheme: { label: 'Toggle Light/Dark', shortcut: 'Ctrl+Shift+L', run: () => A.setTheme(getState().resolvedTheme === 'dark' ? 'light' : 'dark') },
  zoomIn: { label: 'Zoom In', shortcut: 'Ctrl+=', run: () => A.updateSettings({ uiScale: Math.min(2, +((getState().settings.uiScale || 1) + 0.1).toFixed(2)) }) },
  zoomOut: { label: 'Zoom Out', shortcut: 'Ctrl+-', run: () => A.updateSettings({ uiScale: Math.max(0.6, +((getState().settings.uiScale || 1) - 0.1).toFixed(2)) }) },
  zoomReset: { label: 'Actual Size', shortcut: 'Ctrl+0', run: () => A.updateSettings({ uiScale: 1 }) },
  fullscreen: { label: 'Full Screen', shortcut: 'F11', run: () => call('app:fullscreen') },
  pdfDark: { label: 'Dark PDF Background', checked: () => !!getState().settings?.pdfDarkMode, run: () => A.updateSettings({ pdfDarkMode: !getState().settings.pdfDarkMode }) },

  // Tools
  compile: { label: 'Recompile', shortcut: 'Ctrl+Enter', enabled: inProject, run: () => A.compile() },
  stopCompile: { label: 'Stop Compilation', enabled: () => getState().compile.running, run: () => A.stopCompile() },
  compileScratch: { label: 'Recompile from Scratch', enabled: inProject, run: () => A.compile({ fromScratch: true }) },
  compileDraft: { label: 'Fast Draft Compile', enabled: inProject, run: () => A.compile({ draft: true }) },
  clearCache: { label: 'Clear Cached Files', enabled: inProject, run: () => A.clearCache() },
  autoCompile: { label: 'Auto Compile', checked: () => !!getState().settings?.autoCompile, run: () => A.updateSettings({ autoCompile: !getState().settings.autoCompile }) },
  compilerPdf: { label: 'pdfLaTeX', enabled: inProject, checked: () => getState().project?.compiler === 'pdflatex', run: () => A.updateProject({ compiler: 'pdflatex' }).then(() => A.compile()) },
  compilerXe: { label: 'XeLaTeX', enabled: inProject, checked: () => getState().project?.compiler === 'xelatex', run: () => A.updateProject({ compiler: 'xelatex' }).then(() => A.compile()) },
  compilerLua: { label: 'LuaLaTeX', enabled: inProject, checked: () => getState().project?.compiler === 'lualatex', run: () => A.updateProject({ compiler: 'lualatex' }).then(() => A.compile()) },
  syncToPdf: { label: 'Go to Location in PDF', shortcut: 'Ctrl+Alt+Right', enabled: inText, run: () => A.syncToPdf() },
  checkPackages: { label: 'Check Required Packages...', enabled: inProject, run: () => openDialog('checkPackages') },
  installPackage: { label: 'Install a Package...', run: () => openDialog('installPackage') },
  wordCount: { label: 'Word Count', shortcut: 'Ctrl+Shift+W', enabled: inProject, run: () => openDialog('wordCount') },
  history: { label: 'History and Versions', shortcut: 'Ctrl+Shift+H', enabled: inProject, run: () => setState({ historyOpen: !getState().historyOpen }) },
  git: { label: 'Git...', enabled: inProject, run: () => openDialog('git') },
  zotero: { label: 'Import References from Zotero...', enabled: inProject, run: () => openDialog('zotero') },
  texDistribution: { label: 'TeX Distribution...', run: () => openDialog('tex') },
  openOutput: { label: 'Show Output Folder', enabled: inProject, run: () => call('compile:openOutputDir', getState().project.id) },
  openPdfExternal: { label: 'Open PDF in External Viewer', enabled: inProject, run: () => call('compile:openPdfExternal', getState().project.id) },
  devtools: { label: 'Developer Tools', shortcut: 'Ctrl+Shift+I', run: () => call('app:devtools') },

  // Help & About
  shortcuts: { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', run: () => openDialog('shortcuts') },
  quickRef: { label: 'LaTeX Quick Reference', shortcut: 'F1', run: () => openDialog('quickRef') },
  packageDocs: { label: 'Package Documentation...', run: () => openDialog('packageDocs') },
  learnLatex: { label: 'Learn LaTeX (online guide)', run: () => call('app:openExternal', 'https://www.overleaf.com/learn') },
  ctan: { label: 'Browse Packages on CTAN', run: () => call('app:openExternal', 'https://ctan.org/') },
  texSE: { label: 'Ask on TeX Stack Exchange', run: () => call('app:openExternal', 'https://tex.stackexchange.com/') },
  website: { label: 'FreedomTex Website (freedomsoft.uk)', run: () => call('app:openExternal', 'https://freedomsoft.uk') },
  about: { label: 'About FreedomTex', run: () => openDialog('about') },
  developer: { label: 'About the Developer', run: () => openDialog('about', { tab: 'developer' }) },
  license: { label: 'License (MIT)', run: () => openDialog('about', { tab: 'license' }) },
  notices: { label: 'Third-Party Notices', run: () => openDialog('about', { tab: 'notices' }) },
};

function currentDir() {
  const sel = getState().selectedPath;
  if (!sel) return '';
  const node = A.findNode(getState().tree, sel);
  if (node && node.type === 'dir') return sel;
  return sel.includes('/') ? sel.slice(0, sel.lastIndexOf('/')) : '';
}

async function pasteText() {
  try {
    const text = await navigator.clipboard.readText();
    E.insertText(text);
  } catch {
    toast('info', 'Use Ctrl+V to paste', 'The clipboard could not be read from the menu.');
  }
}

export function runCommand(id) {
  const c = commands[id];
  if (!c) return;
  if (c.enabled && !c.enabled()) return;
  return c.run();
}

// Keyboard shortcuts handled at window level (the editor handles its own first).
const SHORTCUTS = {
  'ctrl+shift+n': 'newProject',
  'ctrl+o': 'openProjects',
  'ctrl+s': 'save',
  'ctrl+enter': 'compile',
  'ctrl+shift+f': 'projectSearch',
  'ctrl+,': 'preferences',
  'ctrl+j': 'toggleLogs',
  'ctrl+shift+e': 'toggleSidebar',
  'ctrl+shift+l': 'toggleTheme',
  'ctrl+=': 'zoomIn',
  'ctrl++': 'zoomIn',
  'ctrl+-': 'zoomOut',
  'ctrl+0': 'zoomReset',
  f11: 'fullscreen',
  f1: 'quickRef',
  'ctrl+shift+w': 'wordCount',
  'ctrl+shift+h': 'history',
  'ctrl+shift+i': 'devtools',
  'ctrl+shift+m': 'insInlineMath',
  'ctrl+alt+arrowright': 'syncToPdf',
};

export function keyCombo(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  if (k === '+' && e.shiftKey) k = '=';
  parts.push(k);
  return parts.join('+');
}

export function handleGlobalKey(e) {
  if (e.defaultPrevented) return;
  const combo = keyCombo(e);
  const id = SHORTCUTS[combo];
  if (!id) return;
  // Leave text inputs alone for plain editing shortcuts.
  const tag = (e.target && e.target.tagName) || '';
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && ['insInlineMath'].includes(id)) return;
  e.preventDefault();
  runCommand(id);
}
