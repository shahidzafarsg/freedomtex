'use strict';
const path = require('path');
const { app } = require('electron');

const repoRoot = path.join(__dirname, '..', '..');

function templatesDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'templates') : path.join(repoRoot, 'templates');
}

function bundledMiktexDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'miktex') : path.join(repoRoot, 'resources', 'miktex');
}

function userData(...p) {
  return path.join(app.getPath('userData'), ...p);
}

function buildDir(projectId) {
  return userData('build', projectId);
}

function historyDir(projectId) {
  return userData('history', projectId);
}

function iconPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(repoRoot, 'build', 'icon.png');
}

module.exports = { repoRoot, templatesDir, bundledMiktexDir, userData, buildDir, historyDir, iconPath };
