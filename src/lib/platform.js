// Platform helpers for labels that differ between Windows and macOS.
export const platform = (window.ft && window.ft.platform) || 'win32';
export const isMac = platform === 'darwin';
export const revealLabel = isMac ? 'Show in Finder' : 'Show in Explorer';

/** Shortcut text as users expect it: Ctrl+S on Windows, ⌘S on a Mac. */
export function fmtShortcut(s) {
  if (!s || !isMac) return s;
  if (s === 'F11') return '⌃⌘F';
  return s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧');
}
