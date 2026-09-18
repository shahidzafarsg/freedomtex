'use strict';
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { readJSON, writeJSON } = require('./util');

function defaults() {
  let user = 'Student';
  try {
    user = os.userInfo().username || user;
  } catch {
    /* ignore */
  }
  return {
    theme: 'system',
    uiScale: 1,
    userName: user,
    projectsRoot: path.join(app.getPath('documents'), 'FreedomTex Projects'),
    // editor
    editorFontSize: 14,
    editorFontFamily: 'JetBrains Mono',
    editorLineHeight: 1.6,
    keybindings: 'default',
    autoComplete: true,
    autoCloseBrackets: true,
    codeCheck: true,
    mathPreview: true,
    spellCheck: true,
    spellLanguage: 'en-US',
    wordWrap: true,
    lineNumbers: true,
    highlightActiveLine: true,
    autoSave: true,
    defaultEditorMode: 'source',
    // compiler
    defaultCompiler: 'pdflatex',
    autoCompile: true,
    autoCompileDelay: 2500,
    missingPackages: 'ask',
    compileTimeout: 300,
    hideBuildFiles: true,
    texBinPath: '',
    // pdf
    pdfDarkMode: false,
    pdfZoom: 'page-width',
    // state
    setupDone: false,
    layout: 'split',
    splitRatio: 0.5,
    sidebarWidth: 260,
  };
}

let cache = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

function get() {
  if (!cache) cache = { ...defaults(), ...readJSON(file(), {}) };
  return cache;
}

function update(patch) {
  cache = { ...get(), ...patch };
  writeJSON(file(), cache);
  return cache;
}

module.exports = { get, update, defaults };
