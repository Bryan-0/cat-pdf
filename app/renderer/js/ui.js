// Cat PDF — shared UI: toasts, result/error cards, modal, loader overlay, drop zones, sortable lists.
import { LOADER_SCENES, catFace, catHappy, paw, icon } from './cats.js';
import { baseName, ext } from './api.js';

/* --------------------------------------------------------------- helpers */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Create an element from an HTML string (single root). */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bridge = window.catpdf;

/* ---------------------------------------------------------------- toasts */

const toastRoot = () => document.getElementById('toasts');

/** Small transient message. type: info | success | warn | error */
export function toast(message, type = 'info', ms = 3200) {
  const el = h(`<div class="toast toast-${type}" role="status">${paw('toast-paw')}<span>${esc(message)}</span></div>`);
  toastRoot().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function cardShell(el) {
  toastRoot().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.card-close')?.addEventListener('click', close);
  return close;
}

/**
 * Success card: "Purr-fect! Saved to …" with Open / Show in folder.
 * opts: { path, title, details: string[], extraButtons: [{label, onClick}] }
 */
export function showResult({ path, title = 'Purr-fect!', details = [], warnings = [] } = {}) {
  const el = h(`<div class="result-card" role="status">
    <button class="card-close icon-btn" type="button" aria-label="Dismiss">${icon('x')}</button>
    <div class="result-cat">${catHappy('wag')}<div class="paw-burst" aria-hidden="true"></div></div>
    <div class="result-body">
      <div class="result-title">${esc(title)}</div>
      <div class="result-path">Saved to <span title="${esc(path)}">${esc(baseName(path))}</span></div>
      ${details.length ? `<div class="result-details">${details.map(esc).join(' · ')}</div>` : ''}
      ${warnings.length ? `<details class="result-warnings"><summary>${warnings.length} note${warnings.length > 1 ? 's' : ''} from the cat</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      <div class="result-actions">
        <button class="btn btn-primary btn-sm" data-act="open" type="button">${icon('open')}Open</button>
        <button class="btn btn-ghost btn-sm" data-act="folder" type="button">${icon('folder')}Show in folder</button>
      </div>
    </div>
  </div>`);
  el.querySelector('[data-act=open]').addEventListener('click', () => bridge.openPath(path));
  el.querySelector('[data-act=folder]').addEventListener('click', () => bridge.showInFolder(path));
  pawBurst(el.querySelector('.paw-burst'));
  const close = cardShell(el);
  setTimeout(close, warnings.length ? 30000 : 15000);
  return close;
}

function pawBurst(root) {
  if (prefersReducedMotion()) return;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const p = h(`<span class="burst-paw">${paw()}</span>`);
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    const dist = 38 + Math.random() * 16;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    p.style.setProperty('--rot', `${(angle * 180) / Math.PI + 90}deg`);
    p.style.animationDelay = `${i * 40}ms`;
    root.appendChild(p);
  }
}

/** Friendly error card with a sad/confused cat and the backend's detail. */
export function showError(err, title = 'Hiss… that didn’t work') {
  const detail = err?.detail || err?.message || String(err);
  console.warn('[Cat PDF]', err);
  const mood = Math.random() < 0.5 ? 'sad' : 'confused';
  const el = h(`<div class="result-card error-card" role="alert">
    <button class="card-close icon-btn" type="button" aria-label="Dismiss">${icon('x')}</button>
    <div class="result-cat">${catFace(mood)}</div>
    <div class="result-body">
      <div class="result-title">${esc(title)}</div>
      <div class="error-detail">${esc(detail)}</div>
    </div>
  </div>`);
  return cardShell(el);
}

/* ----------------------------------------------------------------- modal */

/**
 * Generic modal. content: HTMLElement. Returns { close, el }.
 * opts: { title, content, className, onClose, actions: [{label, kind, onClick(close) }] }
 */
export function openModal({ title, content, className = '', actions = [], onClose } = {}) {
  const root = document.getElementById('modal-root');
  const prevFocus = document.activeElement;
  const el = h(`<div class="modal-backdrop">
    <div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn modal-x" type="button" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-foot"></div>' : ''}
    </div>
  </div>`);
  el.querySelector('.modal-body').appendChild(content);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    el.classList.remove('show');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => el.remove(), 180);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const foot = el.querySelector('.modal-foot');
  actions.forEach((a) => {
    const b = h(`<button class="btn btn-${a.kind || 'ghost'}" type="button">${esc(a.label)}</button>`);
    b.addEventListener('click', () => a.onClick ? a.onClick(close) : close());
    if (a.id) b.dataset.id = a.id;
    foot.appendChild(b);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(e, el.querySelector('.modal'));
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  el.querySelector('.modal-x').addEventListener('click', () => close());
  root.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('show');
    const first = el.querySelector('.modal-body [autofocus], .modal-body button, .modal-body input, .modal-foot button');
    first?.focus();
  });
  return { close, el };
}

function trapFocus(e, container) {
  const items = [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Promise-based confirm dialog. */
export function confirmDialog({ title = 'Are you sure?', message = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const content = h(`<div class="confirm-body">${catFace('confused', 'confirm-cat')}<p>${esc(message)}</p></div>`);
    openModal({
      title,
      content,
      className: 'modal-sm',
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: cancel, kind: 'ghost', onClick: (close) => { answered = true; resolve(false); close(); } },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: (close) => { answered = true; resolve(true); close(); } },
      ],
    });
  });
}

/* ---------------------------------------------------------------- loader */

const MIN_LOADER_MS = 650;
let loaderDepth = 0;
let loaderTimer = null;

/**
 * Run fn() while showing the funny cat loader. Always visible for at least ~650 ms.
 * opts.message: an initial message (optional), opts.scene: force a scene id.
 */
export async function withLoader(fn, opts = {}) {
  const root = document.getElementById('loader');
  const start = performance.now();
  loaderDepth++;
  if (loaderDepth === 1) showLoader(root, opts);
  try {
    return await fn();
  } finally {
    const elapsed = performance.now() - start;
    if (elapsed < MIN_LOADER_MS) await sleep(MIN_LOADER_MS - elapsed);
    loaderDepth--;
    if (loaderDepth === 0) hideLoader(root);
  }
}

const EXTRA_MESSAGES = [
  'Herding pages… it’s like herding cats',
  'Converting… paws-itively working',
  'Coughing up a hairball of Markdown…',
  'Knocking pages off the table (carefully)…',
  'Kneading your pages…',
  'Sharpening claws on the margins…',
  'Taking a quick cat-nap… just kidding, still working',
];

function showLoader(root, opts) {
  const scene = LOADER_SCENES.find((s) => s.id === opts.scene) || LOADER_SCENES[Math.floor(Math.random() * LOADER_SCENES.length)];
  const msgs = [...(opts.message ? [opts.message] : []), ...scene.messages,
    ...EXTRA_MESSAGES.filter((m) => !scene.messages.includes(m)).sort(() => Math.random() - 0.5)];
  root.innerHTML = `<div class="loader-card">
      <div class="loader-scene">${scene.svg}</div>
      <div class="loader-msg" role="status">${esc(msgs[0])}</div>
      <div class="loader-dots" aria-hidden="true">${paw()}${paw()}${paw()}</div>
    </div>`;
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('show'));
  let i = 0;
  const msgEl = root.querySelector('.loader-msg');
  clearInterval(loaderTimer);
  loaderTimer = setInterval(() => {
    i = (i + 1) % msgs.length;
    msgEl.classList.add('swap');
    setTimeout(() => { msgEl.textContent = msgs[i]; msgEl.classList.remove('swap'); }, 180);
  }, 2000);
}

function hideLoader(root) {
  clearInterval(loaderTimer);
  root.classList.remove('show');
  setTimeout(() => { if (loaderDepth === 0) { root.hidden = true; root.innerHTML = ''; } }, 220);
}

/* ------------------------------------------------------------ drop zones */

/**
 * Turn an element into a file drop zone.
 * opts: { accept: ['pdf', ...] | null, multiple, onFiles(paths), onReject(names) }
 */
export function makeDropZone(el, { accept = null, multiple = true, onFiles, label = 'files' } = {}) {
  let depth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  el.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('drop-active');
  });
  el.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) el.classList.remove('drop-active');
  });
  el.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    el.classList.remove('drop-active');
    const files = [...e.dataTransfer.files];
    const paths = [];
    const rejected = [];
    for (const f of files) {
      let p = '';
      try { p = bridge.pathForFile(f); } catch { p = ''; }
      if (!p) { rejected.push(f.name); continue; }
      if (accept && !accept.includes(ext(p))) { rejected.push(f.name); continue; }
      paths.push(p);
    }
    if (rejected.length) {
      toast(`The cat sniffed ${rejected.length === 1 ? `“${rejected[0]}”` : `${rejected.length} files`} and walked away — only ${label} here, please.`, 'warn', 4200);
    }
    if (!paths.length) return;
    onFiles?.(multiple ? paths : paths.slice(0, 1));
  });
}

/** Stop the window from navigating when files are dropped outside a drop zone. */
export function guardWindowDrops() {
  const guard = (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer && e.type === 'dragover') e.dataTransfer.dropEffect = 'none';
  };
  window.addEventListener('dragover', guard);
  window.addEventListener('drop', guard);
}

/* -------------------------------------------------------- sortable lists */

const SORT_TYPE = 'application/x-catpdf-sort';

/**
 * Drag-to-reorder for a vertical list. Items must match itemSelector and carry data-index.
 * onMove(from, to) where `to` is the final index after removal.
 */
export function makeSortable(listEl, { itemSelector, onMove, axis = 'y' }) {
  let fromIndex = null;
  let marker = null;

  const clearMarker = () => {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    marker = null;
  };

  listEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest?.(itemSelector);
    if (!item || !listEl.contains(item)) return;
    fromIndex = Number(item.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(SORT_TYPE, String(fromIndex));
    e.dataTransfer.setData('text/plain', '');
    item.classList.add('dragging');
  });
  listEl.addEventListener('dragend', (e) => {
    e.target.closest?.(itemSelector)?.classList.remove('dragging');
    clearMarker();
    fromIndex = null;
  });
  listEl.addEventListener('dragover', (e) => {
    if (fromIndex === null || ![...e.dataTransfer.types].includes(SORT_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest?.(itemSelector);
    if (!item) return;
    const r = item.getBoundingClientRect();
    const before = axis === 'y' ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
    clearMarker();
    item.classList.add(before ? 'drop-before' : 'drop-after');
    marker = { index: Number(item.dataset.index), before };
  });
  listEl.addEventListener('drop', (e) => {
    if (fromIndex === null || ![...e.dataTransfer.types].includes(SORT_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    if (marker) {
      let to = marker.index + (marker.before ? 0 : 1);
      if (fromIndex < to) to -= 1;
      if (to !== fromIndex) onMove(fromIndex, to);
    }
    clearMarker();
    fromIndex = null;
  });
}

export function moveItem(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}

/* --------------------------------------------------------- misc helpers */

/** Validate a 1-based page range string like "1-3,5". Returns error text or ''. */
export function validateRange(str, maxPages) {
  const s = String(str || '').trim();
  if (!s) return '';
  if (!/^\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*$/.test(s)) return 'Use page numbers like 1-3, 5';
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    if (a < 1 || (b !== undefined && b < a)) return `“${part.trim()}” isn’t a valid range`;
    if (maxPages && (a > maxPages || (b !== undefined && b > maxPages))) return `This file only has ${maxPages} page${maxPages > 1 ? 's' : ''}`;
  }
  return '';
}

/** Render a cat-themed empty state block. */
export function emptyState({ cat, title, text }) {
  return `<div class="empty-state">${cat}<div class="empty-title">${esc(title)}</div><div class="empty-text">${esc(text)}</div></div>`;
}

let uidCounter = 0;
export const uid = (prefix = 'id') => `${prefix}${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
