// Dialog and toast helpers shared across the app.
import { getState, setState } from '../store';

let seq = 0;

export function openDialog(type, props = {}) {
  const id = ++seq;
  setState({ dialogs: [...getState().dialogs, { id, type, props }] });
  return id;
}

export function closeDialog(id) {
  setState({ dialogs: getState().dialogs.filter((d) => (id == null ? false : d.id !== id)) });
}

export function closeTopDialog() {
  const d = getState().dialogs;
  if (d.length) setState({ dialogs: d.slice(0, -1) });
}

export function toast(kind, title, body, timeout = 4500) {
  const id = ++seq;
  setState({ toasts: [...getState().toasts, { id, kind, title, body }] });
  if (timeout) setTimeout(() => dismissToast(id), timeout);
  return id;
}

export function dismissToast(id) {
  setState({ toasts: getState().toasts.filter((t) => t.id !== id) });
}

/** Promise-based text prompt. Resolves to the string or null. */
export function prompt({ title, label, value = '', placeholder = '', okLabel = 'OK', validate }) {
  return new Promise((resolve) => {
    openDialog('prompt', { title, label, value, placeholder, okLabel, validate, resolve });
  });
}

/** Promise-based confirmation. Resolves to true/false. */
export function confirm({ title, message, okLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openDialog('confirm', { title, message, okLabel, danger, resolve });
  });
}

export function errorMessage(e) {
  return (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400 && d.getDate() === now.getDate()) return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');
}

export function colorFor(name) {
  const colors = ['#0d9488', '#6366f1', '#e11d48', '#d97706', '#0284c7', '#7c3aed', '#16a34a', '#db2777'];
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}
