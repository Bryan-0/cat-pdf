// Cat PDF — PDF editor: page organiser (left), page view with an edit overlay (centre).
//
// Model
//   S.pages  — final page order: { key, src, file|null, rotate }  (file = page imported from another PDF)
//   S.edits  — edits keyed by ORIGINAL page index (`page`), bbox in display-space PDF points.
//              Edits travel with their page when it is reordered / duplicated (see docs/API.md).
// The centre view always shows a page upright (without the organiser's extra rotation), which is
// exactly the space edits are expressed in; a banner explains that the rotation is applied on save.
import { api, baseName, renderUrl, siblingPath } from '../api.js';
import { catSleeping, icon, paw } from '../cats.js';
import { openSignatureModal } from '../signature.js';
import { confirmDialog, esc, h, makeDropZone, makeSortable, moveItem, showError, showResult, toast, uid, withLoader } from '../ui.js';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const FONT_FAMILY = {
  sans: 'Helvetica, Arial, "Segoe UI", sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};
const TOOLS = [
  { id: 'select', icon: 'cursor', label: 'Select', key: 'v', hint: 'Click an item to select it · drag to move · Delete to remove · arrows to nudge.' },
  { id: 'edittext', icon: 'textcursor', label: 'Edit text', key: 't', hint: 'Hover over existing text and click it to change it · Enter to apply · Esc to cancel.' },
  { id: 'addtext', icon: 'type', label: 'Add text', key: 'a', hint: 'Click anywhere on the page to add text · Ctrl+Enter or click outside to finish.' },
  { id: 'signature', icon: 'sign', label: 'Signature', key: 's', hint: 'Draw, type or upload your signature, then drag it into place.' },
  { id: 'whiteout', icon: 'eraser', label: 'Whiteout', key: 'w', hint: 'Drag a rectangle to cover something with white · Esc when you’re done.' },
];

const round2 = (n) => Math.round(n * 100) / 100;
/** A span whose box is much taller than wide (text on a page with /Rotate 90/270). */
const isVertical = (bbox, text) => String(text || '').length > 2 && (bbox[3] - bbox[1]) > (bbox[2] - bbox[0]) * 1.6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const familyOf = (s) => (s.mono ? FONT_FAMILY.mono : s.serif ? FONT_FAMILY.serif : FONT_FAMILY.sans);
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

const measureCtx = document.createElement('canvas').getContext('2d');
/** Size of a (multi-line) text block in PDF points. */
function measureText(text, style) {
  measureCtx.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${style.size}px ${familyOf(style)}`;
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map((l) => measureCtx.measureText(l || ' ').width));
  return { w, h: lines.length * style.size * 1.22 };
}

export function createEditor({ navigate }) {
  const S = {
    doc: null,
    pages: [],
    edits: [],
    current: 0,
    tool: 'select',
    selectedId: null,
    zoom: 1,
    dirty: false,
    imported: {},
    spans: {},
    undo: [],
    redo: [],
    textStyle: { size: 14, color: '#1b1b1f', bold: false, italic: false, serif: false, mono: false },
  };
  let scale = 1; // CSS px per PDF point on the stage
  let editing = null; // inline text editor state
  const thumbImgs = new Map();

  const el = h(`<section class="editor-view">
    <div class="editor-empty">
      <header class="view-head">
        <div><h1>${icon('edit')}Edit &amp; sign</h1>
        <p>Change existing text, add notes and signatures, white-out mistakes, and reorder, rotate or delete pages.</p></div>
      </header>
      <div class="drop-zone drop-zone-xl editor-drop" tabindex="0" role="button" aria-label="Open a PDF to edit">
        ${catSleeping()}
        <div class="dz-title">Drop a PDF here — the cat will take it from there</div>
        <div class="dz-sub">or</div>
        <span class="btn btn-primary">${icon('pdf')}Open a PDF…</span>
      </div>
    </div>

    <div class="editor-shell" hidden>
      <div class="editor-bar">
        <div class="bar-file">${icon('pdf')}<div><div class="bar-name"></div><div class="bar-meta"></div></div></div>
        <div class="bar-tools" role="toolbar" aria-label="Editing tools">
          ${TOOLS.map((t) => `<button class="tool-btn" type="button" data-tool="${t.id}" title="${t.label} (${t.key.toUpperCase()})" aria-pressed="false">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
        </div>
        <div class="bar-right">
          <button class="icon-btn" type="button" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
          <button class="icon-btn" type="button" data-act="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${icon('redo')}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="open" title="Open another PDF">${icon('folder')}Open</button>
          <button class="btn btn-primary btn-sm" type="button" data-act="save">${icon('save')}Save as…</button>
        </div>
      </div>
      <div class="editor-sub">
        <div class="text-opts" hidden>
          <select class="input input-sm" data-opt="family" aria-label="Font">
            <option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option></select>
          <select class="input input-sm" data-opt="size" aria-label="Font size">
            ${[6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72].map((s) => `<option value="${s}">${s} pt</option>`).join('')}</select>
          <input class="color-input" type="color" data-opt="color" aria-label="Text colour" title="Text colour">
          <button class="icon-btn toggle" type="button" data-opt="bold" aria-pressed="false" aria-label="Bold" title="Bold"><b>B</b></button>
          <button class="icon-btn toggle" type="button" data-opt="italic" aria-pressed="false" aria-label="Italic" title="Italic"><i>I</i></button>
        </div>
        <div class="tool-hint"></div>
        <div class="sub-right">
          <div class="pager">
            <button class="icon-btn" type="button" data-act="prev" aria-label="Previous page">${icon('up')}</button>
            <span class="pager-label"></span>
            <button class="icon-btn" type="button" data-act="next" aria-label="Next page">${icon('down')}</button>
          </div>
          <div class="zoom">
            <button class="icon-btn" type="button" data-act="zoomout" aria-label="Zoom out">${icon('zoomout')}</button>
            <button class="zoom-label" type="button" data-act="zoomfit" title="Reset zoom">100%</button>
            <button class="icon-btn" type="button" data-act="zoomin" aria-label="Zoom in">${icon('zoomin')}</button>
          </div>
        </div>
      </div>
      <div class="editor-body">
        <aside class="page-strip" aria-label="Pages">
          <div class="strip-head"><span>Pages <span class="count-pill page-count">0</span></span>
            <button class="icon-btn" type="button" data-act="insert" title="Insert pages from another PDF" aria-label="Insert pages from another PDF">${icon('insert')}</button></div>
          <ol class="thumbs"></ol>
          <button class="btn btn-ghost btn-sm strip-insert" type="button" data-act="insert">${icon('plus')}Insert from PDF…</button>
        </aside>
        <div class="stage-scroll">
          <div class="stage-banner" hidden></div>
          <div class="stage">
            <img class="page-img" alt="" draggable="false">
            <div class="overlay"></div>
          </div>
        </div>
      </div>
    </div>
  </section>`);

  const $ = (sel) => el.querySelector(sel);
  const shell = $('.editor-shell');
  const empty = $('.editor-empty');
  const thumbsEl = $('.thumbs');
  const scrollEl = $('.stage-scroll');
  const stage = $('.stage');
  const img = $('.page-img');
  const overlay = $('.overlay');
  const banner = $('.stage-banner');

  /* ======================================================= document */

  async function chooseAndOpen() {
    const [p] = await window.catpdf.openFiles({ kind: 'pdf', title: 'Open a PDF to edit' });
    if (p) openDoc(p);
  }

  async function openDoc(path) {
    if (S.doc && S.dirty) {
      const ok = await confirmDialog({ title: 'Discard your changes?', message: `You have unsaved edits in ${S.doc.name}. Open another PDF anyway?`, ok: 'Discard & open', danger: true });
      if (!ok) return;
    }
    let info;
    try {
      info = await api.info(path, true);
    } catch (err) {
      showError(err, 'The cat couldn’t open that PDF');
      return;
    }
    if (info.encrypted) {
      showError({ detail: 'This PDF is password-protected. Remove the password first, then try again.' }, 'Locked tight');
      return;
    }
    commitEditor(false);
    S.doc = { path, name: info.name || baseName(path), pages: info.pages, page_sizes: info.page_sizes };
    S.pages = info.page_sizes.map((_, i) => ({ key: uid('p'), src: i, file: null, rotate: 0 }));
    S.edits = [];
    S.current = 0;
    S.selectedId = null;
    S.spans = {};
    S.imported = {};
    S.undo = [];
    S.redo = [];
    S.dirty = false;
    S.zoom = 1;
    thumbImgs.clear();
    empty.hidden = true;
    shell.hidden = false;
    setTool('select');
    renderAll();
  }

  function closeDoc() {
    S.doc = null;
    shell.hidden = true;
    empty.hidden = false;
  }

  function pageMeta(i = S.current) {
    const p = S.pages[i];
    if (!p || !S.doc) return null;
    if (p.file) {
      const info = S.imported[p.file];
      const [w, hgt] = info.page_sizes[p.src];
      return { page: p, path: p.file, src: p.src, w, h: hgt, editable: false };
    }
    const [w, hgt] = S.doc.page_sizes[p.src];
    return { page: p, path: S.doc.path, src: p.src, w, h: hgt, editable: true };
  }

  /* ======================================================= history */

  const snapshot = () => JSON.stringify({ pages: S.pages, edits: S.edits, current: S.current });

  function pushUndo() {
    S.undo.push(snapshot());
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
    S.dirty = true;
    updateHistoryButtons();
  }

  function restore(snap) {
    const d = JSON.parse(snap);
    S.pages = d.pages;
    S.edits = d.edits;
    S.current = clamp(d.current, 0, S.pages.length - 1);
    if (!S.edits.some((e) => e.id === S.selectedId)) S.selectedId = null;
    S.dirty = true;
    renderAll();
  }

  function undo() {
    commitEditor(false);
    if (!S.undo.length) return;
    S.redo.push(snapshot());
    restore(S.undo.pop());
  }

  function redo() {
    commitEditor(false);
    if (!S.redo.length) return;
    S.undo.push(snapshot());
    restore(S.redo.pop());
  }

  function updateHistoryButtons() {
    $('[data-act=undo]').disabled = !S.undo.length;
    $('[data-act=redo]').disabled = !S.redo.length;
  }

  /* ======================================================= rendering */

  function renderAll() {
    if (!S.doc) return;
    $('.bar-name').textContent = S.doc.name;
    $('.bar-name').title = S.doc.path;
    renderStrip();
    renderStage();
    renderToolbar();
    updateHistoryButtons();
  }

  function renderMeta() {
    const n = S.pages.length;
    const edits = S.edits.length;
    $('.bar-meta').textContent = `${n} page${n === 1 ? '' : 's'} · ${edits} edit${edits === 1 ? '' : 's'}${S.dirty ? ' · unsaved' : ''}`;
    $('.page-count').textContent = n;
    $('.pager-label').textContent = `Page ${S.current + 1} of ${n}`;
    $('[data-act=prev]').disabled = S.current <= 0;
    $('[data-act=next]').disabled = S.current >= n - 1;
  }

  function thumbImg(p) {
    let im = thumbImgs.get(p.key);
    if (!im) {
      im = new Image();
      im.alt = '';
      im.draggable = false;
      im.decoding = 'async';
      im.src = renderUrl(p.file || S.doc.path, p.src, 200);
      thumbImgs.set(p.key, im);
    }
    im.style.transform = p.rotate ? `rotate(${p.rotate}deg)` : '';
    return im;
  }

  function renderStrip() {
    const focusedIndex = thumbsEl.contains(document.activeElement) ? Number(document.activeElement.closest('.thumb')?.dataset.index) : null;
    thumbsEl.innerHTML = '';
    const counts = {};
    S.edits.forEach((e) => { counts[e.page] = (counts[e.page] || 0) + 1; });
    S.pages.forEach((p, i) => {
      const n = p.file ? 0 : counts[p.src] || 0;
      const li = h(`<li class="thumb${i === S.current ? ' active' : ''}" draggable="true" data-index="${i}">
        <button class="thumb-main" type="button" aria-label="Page ${i + 1}${p.file ? `, imported from ${esc(baseName(p.file))}` : ''}" title="Alt+↑/↓ moves the page">
          <span class="thumb-img"></span>
          <span class="thumb-num">${i + 1}</span>
          ${p.rotate ? `<span class="thumb-badge" title="Rotated ${p.rotate}°">${icon('rotr')}${p.rotate}°</span>` : ''}
          ${p.file ? `<span class="thumb-badge badge-import" title="From ${esc(baseName(p.file))}">${icon('insert')}</span>` : ''}
          ${n ? `<span class="thumb-badge badge-edits" title="${n} edit${n > 1 ? 's' : ''}">${paw()}${n}</span>` : ''}
        </button>
        <div class="thumb-actions">
          <button class="icon-btn" type="button" data-pact="rotl" aria-label="Rotate left" title="Rotate left">${icon('rotl')}</button>
          <button class="icon-btn" type="button" data-pact="rotr" aria-label="Rotate right" title="Rotate right">${icon('rotr')}</button>
          <button class="icon-btn" type="button" data-pact="dup" aria-label="Duplicate page" title="Duplicate">${icon('dup')}</button>
          <button class="icon-btn icon-btn-danger" type="button" data-pact="del" aria-label="Delete page" title="Delete">${icon('trash')}</button>
        </div>
      </li>`);
      li.querySelector('.thumb-img').appendChild(thumbImg(p));
      thumbsEl.appendChild(li);
    });
    renderMeta();
    if (focusedIndex != null && Number.isFinite(focusedIndex)) thumbsEl.querySelector(`.thumb[data-index="${Math.min(focusedIndex, S.pages.length - 1)}"] .thumb-main`)?.focus();
    thumbsEl.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' });
  }

  let lastPageKey = null;
  function renderStage() {
    const meta = pageMeta();
    if (!meta) return;
    const cw = scrollEl.clientWidth || 700;
    const base = Math.min(Math.max(cw - 64, 240), 880);
    const cssW = Math.round(base * S.zoom);
    scale = cssW / meta.w;
    stage.style.width = `${cssW}px`;
    stage.style.height = `${Math.round(meta.h * scale)}px`;
    const want = renderUrl(meta.path, meta.src, Math.min(2400, cssW * (window.devicePixelRatio || 1)));
    if (lastPageKey !== `${meta.path}|${meta.src}`) {
      lastPageKey = `${meta.path}|${meta.src}`;
      img.classList.add('is-loading');
    }
    if (img.dataset.src !== want) {
      img.dataset.src = want;
      img.src = want;
    }
    $('.zoom-label').textContent = `${Math.round(S.zoom * 100)}%`;
    renderBanner(meta);
    renderOverlay();
    renderMeta();
  }
  img.addEventListener('load', () => img.classList.remove('is-loading'));
  img.addEventListener('error', () => img.classList.remove('is-loading'));

  function renderBanner(meta) {
    const notes = [];
    if (!meta.editable) {
      notes.push(`${icon('insert')}<span>Imported from <b>${esc(baseName(meta.path))}</b> — it will be inserted as-is. Edits can only be added to pages of ${esc(S.doc.name)}.</span>`);
    } else {
      if (meta.page.rotate) notes.push(`${icon('rotr')}<span>This page gets rotated <b>${meta.page.rotate}°</b> when you save. You’re editing it upright, so everything lands in the right spot.</span>`);
      const copies = S.pages.filter((p) => !p.file && p.src === meta.src).length;
      if (copies > 1) notes.push(`${icon('dup')}<span>This page appears <b>${copies}×</b> — edits show up on every copy.</span>`);
      if (S.tool === 'edittext' && Array.isArray(S.spans[meta.src]) && !S.spans[meta.src].length) {
        notes.push(`${icon('info')}<span>No editable text found on this page (it may be a scan). Try <b>Whiteout</b> + <b>Add text</b> instead.</span>`);
      }
    }
    banner.hidden = !notes.length;
    banner.innerHTML = notes.map((n) => `<div class="banner-line">${n}</div>`).join('');
  }

  function renderToolbar() {
    const meta = pageMeta();
    el.querySelectorAll('.tool-btn').forEach((b) => {
      const on = b.dataset.tool === S.tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !meta?.editable && b.dataset.tool !== 'select';
    });
    $('.tool-hint').textContent = meta && !meta.editable ? 'Imported page — reorder, rotate or delete it from the page list.' : TOOLS.find((t) => t.id === S.tool)?.hint || '';
    renderTextOptions();
  }

  function selectedItem() {
    return S.edits.find((e) => e.id === S.selectedId) || null;
  }

  function renderTextOptions() {
    const meta = pageMeta();
    const it = selectedItem();
    const target = it && meta?.editable && it.page === meta.src && (it.type === 'add_text' || it.type === 'replace_text') ? it : null;
    const show = !!meta?.editable && (S.tool === 'addtext' || !!target || !!editing?.style);
    const box = $('.text-opts');
    box.hidden = !show;
    if (!show) return;
    const st = target || (editing?.style) || S.textStyle;
    const sizeSel = box.querySelector('[data-opt=size]');
    const size = Math.round(st.size);
    if (![...sizeSel.options].some((o) => Number(o.value) === size)) sizeSel.insertAdjacentHTML('beforeend', `<option value="${size}">${size} pt</option>`);
    sizeSel.value = String(size);
    box.querySelector('[data-opt=family]').value = st.mono ? 'mono' : st.serif ? 'serif' : 'sans';
    box.querySelector('[data-opt=color]').value = /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : '#000000';
    box.querySelector('[data-opt=bold]').setAttribute('aria-pressed', String(!!st.bold));
    box.querySelector('[data-opt=italic]').setAttribute('aria-pressed', String(!!st.italic));
  }

  /* ---------------------------------------------------------- overlay */

  function placeBox(node, bbox) {
    node.style.left = `${bbox[0] * scale}px`;
    node.style.top = `${bbox[1] * scale}px`;
    node.style.width = `${(bbox[2] - bbox[0]) * scale}px`;
    node.style.height = `${(bbox[3] - bbox[1]) * scale}px`;
  }

  function applyFont(style, s) {
    style.fontFamily = familyOf(s);
    style.fontSize = `${s.size * scale}px`;
    style.fontWeight = s.bold ? '700' : '400';
    style.fontStyle = s.italic ? 'italic' : 'normal';
    style.color = s.color || '#000';
  }

  function itemEl(it) {
    const node = document.createElement('div');
    node.className = `item item-${it.type}${it.id === S.selectedId ? ' selected' : ''}${editing?.itemId === it.id ? ' is-editing' : ''}`;
    node.dataset.id = it.id;
    placeBox(node, it.bbox);
    if (it.type === 'image') {
      const im = document.createElement('img');
      im.src = it.data;
      im.alt = 'Signature';
      im.draggable = false;
      node.appendChild(im);
    } else if (it.type === 'add_text' || it.type === 'replace_text') {
      const t = document.createElement('div');
      t.className = 'item-txt';
      t.textContent = it.text;
      applyFont(t.style, it);
      if (it.type === 'replace_text') {
        const W = (it.bbox[2] - it.bbox[0]) * scale;
        const H = (it.bbox[3] - it.bbox[1]) * scale;
        if (isVertical(it.bbox, it.original || it.text)) {
          // Text on a rotated page runs top-to-bottom in display space: draw it rotated inside the box.
          Object.assign(t.style, { position: 'absolute', left: '0', top: '0', width: `${H}px`, height: `${W}px`, lineHeight: `${W}px`, transformOrigin: '0 0', transform: `translate(${W}px, 0) rotate(90deg)` });
        } else {
          t.style.lineHeight = `${H}px`;
          if (it.maxX1 > it.bbox[2]) node.dataset.maxW = String((it.maxX1 - it.bbox[0]) * scale);
        }
      }
      node.appendChild(t);
    }
    node.insertAdjacentHTML('beforeend', `<button class="item-del" type="button" tabindex="-1" aria-label="Delete">${icon('x')}</button>`);
    if (it.type === 'image' || it.type === 'whiteout') node.insertAdjacentHTML('beforeend', '<span class="item-resize" aria-hidden="true"></span>');
    node.title = { replace_text: 'Edited text — double-click to change, Delete to restore the original', add_text: 'Double-click to edit', image: 'Drag to move · corner to resize', whiteout: 'Drag to move · corner to resize' }[it.type] || '';
    return node;
  }

  /** Grow replaced text into the free space on its right (max_x1 from /pdf/text), then shrink
   *  until it fits (mirrors the backend's behaviour). */
  function fitReplaced(node) {
    const t = node.querySelector('.item-txt');
    if (!t) return;
    const maxW = parseFloat(node.dataset.maxW);
    if (maxW && t.scrollWidth > t.clientWidth + 1) {
      node.style.width = `${Math.min(t.scrollWidth + 1, maxW)}px`;
    }
    let fs = parseFloat(t.style.fontSize);
    const min = 4 * scale;
    let guard = 60;
    while (t.scrollWidth > t.clientWidth + 1 && fs > min && guard--) {
      fs *= 0.94;
      t.style.fontSize = `${fs}px`;
    }
  }

  function renderOverlay() {
    const meta = pageMeta();
    overlay.innerHTML = '';
    if (!meta) return;
    overlay.dataset.tool = S.tool;
    overlay.classList.toggle('locked', !meta.editable);
    if (!meta.editable) return;
    if (S.tool === 'edittext') renderSpans(meta.src);
    S.edits.filter((e) => e.page === meta.src).forEach((it) => overlay.appendChild(itemEl(it)));
    overlay.querySelectorAll('.item-replace_text').forEach(fitReplaced);
    if (editing) overlay.appendChild(editing.el);
  }

  function renderSpans(src) {
    const spans = S.spans[src];
    if (spans === undefined) {
      S.spans[src] = 'loading';
      api.text(S.doc.path, src).then((res) => {
        S.spans[src] = res.spans || [];
      }).catch((err) => {
        S.spans[src] = [];
        toast(err.detail || 'Could not read the text on this page.', 'error');
      }).finally(() => {
        const m = pageMeta();
        if (m?.editable && m.src === src && S.tool === 'edittext') { renderOverlay(); renderBanner(m); }
      });
      return;
    }
    if (!Array.isArray(spans)) return;
    const replaced = new Set(S.edits.filter((e) => e.type === 'replace_text' && e.page === src).map((e) => e.spanId));
    const frag = document.createDocumentFragment();
    spans.forEach((sp) => {
      if (replaced.has(sp.id)) return;
      const d = document.createElement('div');
      d.className = 'span-hot';
      d.dataset.id = sp.id;
      d.title = sp.text;
      placeBox(d, sp.bbox);
      frag.appendChild(d);
    });
    overlay.appendChild(frag);
  }

  /* ======================================================= tools */

  function setTool(t) {
    if (t === 'signature') { addSignature(); return; }
    commitEditor(false);
    S.tool = t;
    renderToolbar();
    renderOverlay();
    const meta = pageMeta();
    if (meta) renderBanner(meta);
  }

  function select(id) {
    S.selectedId = id;
    overlay.querySelectorAll('.item').forEach((n) => n.classList.toggle('selected', n.dataset.id === id));
    renderTextOptions();
  }

  function findItem(id) {
    return S.edits.find((e) => e.id === id);
  }

  function removeItem(id) {
    const i = S.edits.findIndex((e) => e.id === id);
    if (i < 0) return;
    pushUndo();
    S.edits.splice(i, 1);
    if (S.selectedId === id) S.selectedId = null;
    renderOverlay();
    renderStrip();
    renderTextOptions();
  }

  function addItem(it) {
    pushUndo();
    S.edits.push(it);
    S.selectedId = it.id;
    renderOverlay();
    renderStrip();
    renderTextOptions();
  }

  function toPt(e) {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  async function addSignature() {
    const meta = pageMeta();
    if (!meta?.editable) { toast('Signatures can only go on pages of the original PDF.', 'warn'); return; }
    commitEditor(false);
    const data = await openSignatureModal();
    if (!data) return;
    const im = new Image();
    im.src = data;
    try { await im.decode(); } catch { /* use defaults */ }
    const aspect = im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 3;
    const m = pageMeta();
    if (!m?.editable) return;
    let w = Math.min(180, m.w * 0.4);
    let hh = w / aspect;
    if (hh > m.h * 0.25) { hh = m.h * 0.25; w = hh * aspect; }
    // Centre it in the visible part of the page, a little below the middle.
    const sr = scrollEl.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    const visTop = Math.max(0, (sr.top - or.top) / scale);
    const visBottom = Math.min(m.h, (sr.bottom - or.top) / scale);
    const cx = m.w / 2;
    const cy = clamp(visTop + (visBottom - visTop) * 0.62, hh / 2, m.h - hh / 2);
    const x0 = clamp(cx - w / 2, 0, m.w - w);
    const y0 = clamp(cy - hh / 2, 0, m.h - hh);
    S.tool = 'select';
    addItem({ id: uid('e'), type: 'image', page: m.src, bbox: [x0, y0, x0 + w, y0 + hh].map(round2), data });
    renderToolbar();
    toast('Signature placed — drag it into position, pull the corner to resize.', 'success');
  }

  /* ---------------------------------------------------------- pointer */

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const meta = pageMeta();
    if (!meta?.editable) return;
    if (editing) {
      if (editing.el.contains(e.target)) return;
      e.preventDefault();
      commitEditor(true);
      return;
    }
    if (isTyping(document.activeElement)) document.activeElement.blur();
    const del = e.target.closest('.item-del');
    if (del) { e.preventDefault(); removeItem(del.closest('.item').dataset.id); return; }
    const node = e.target.closest('.item');
    if (node) {
      e.preventDefault();
      const it = findItem(node.dataset.id);
      if (!it) return;
      select(it.id);
      if (e.target.closest('.item-resize')) startResize(e, it);
      else startMove(e, it);
      return;
    }
    const hot = e.target.closest('.span-hot');
    if (hot && S.tool === 'edittext') {
      e.preventDefault();
      const sp = (S.spans[meta.src] || []).find((x) => x.id === hot.dataset.id);
      if (sp) openEditor({ span: sp });
      return;
    }
    if (S.tool === 'addtext') { e.preventDefault(); openEditor({ at: toPt(e) }); return; }
    if (S.tool === 'whiteout') { e.preventDefault(); startWhiteout(e); return; }
    select(null);
  });

  overlay.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.item');
    if (!node || editing) return;
    const it = findItem(node.dataset.id);
    if (it && (it.type === 'add_text' || it.type === 'replace_text')) openEditor({ item: it });
  });

  function dragLoop(onMove, onUp) {
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onUp(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startMove(e, it) {
    if (it.type === 'replace_text') return; // stays where the original text was
    const meta = pageMeta();
    const node = overlay.querySelector(`.item[data-id="${it.id}"]`);
    const sx = e.clientX;
    const sy = e.clientY;
    const o = [...it.bbox];
    const w = o[2] - o[0];
    const hh = o[3] - o[1];
    let cur = o;
    let moved = false;
    node.classList.add('moving');
    dragLoop((ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      const x0 = clamp(o[0] + (ev.clientX - sx) / scale, Math.min(0, meta.w - w), Math.max(0, meta.w - w));
      const y0 = clamp(o[1] + (ev.clientY - sy) / scale, Math.min(0, meta.h - hh), Math.max(0, meta.h - hh));
      cur = [x0, y0, x0 + w, y0 + hh];
      placeBox(node, cur);
    }, () => {
      node.classList.remove('moving');
      if (!moved) return;
      pushUndo();
      it.bbox = cur.map(round2);
      renderOverlay();
    });
  }

  function startResize(e, it) {
    const meta = pageMeta();
    const node = overlay.querySelector(`.item[data-id="${it.id}"]`);
    const sx = e.clientX;
    const sy = e.clientY;
    const o = [...it.bbox];
    const aspect = (o[2] - o[0]) / (o[3] - o[1] || 1);
    let cur = o;
    let moved = false;
    dragLoop((ev) => {
      moved = true;
      let w = Math.max(8, o[2] - o[0] + (ev.clientX - sx) / scale);
      let hh = Math.max(6, o[3] - o[1] + (ev.clientY - sy) / scale);
      if (it.type === 'image') hh = w / aspect;
      w = Math.min(w, meta.w - o[0]);
      hh = Math.min(hh, meta.h - o[1]);
      if (it.type === 'image') { w = Math.min(w, hh * aspect); hh = w / aspect; }
      cur = [o[0], o[1], o[0] + w, o[1] + hh];
      placeBox(node, cur);
    }, () => {
      if (!moved) return;
      pushUndo();
      it.bbox = cur.map(round2);
      renderOverlay();
    });
  }

  function startWhiteout(e) {
    const meta = pageMeta();
    const p0 = toPt(e);
    const ghost = document.createElement('div');
    ghost.className = 'item item-whiteout ghost';
    overlay.appendChild(ghost);
    let box = null;
    dragLoop((ev) => {
      const p = toPt(ev);
      const x0 = clamp(Math.min(p0.x, p.x), 0, meta.w);
      const y0 = clamp(Math.min(p0.y, p.y), 0, meta.h);
      const x1 = clamp(Math.max(p0.x, p.x), 0, meta.w);
      const y1 = clamp(Math.max(p0.y, p.y), 0, meta.h);
      box = [x0, y0, x1, y1];
      placeBox(ghost, box);
    }, () => {
      ghost.remove();
      if (!box || box[2] - box[0] < 3 || box[3] - box[1] < 3) return;
      addItem({ id: uid('e'), type: 'whiteout', page: meta.src, bbox: box.map(round2) });
    });
  }

  /* ---------------------------------------------------------- inline text editor */

  function openEditor({ span, at, item }) {
    const meta = pageMeta();
    let mode;
    let style;
    let bbox;
    let text;
    if (item) {
      mode = item.type === 'replace_text' ? 'replace' : 'add';
      style = { size: item.size, color: item.color, bold: item.bold, italic: item.italic, serif: item.serif, mono: item.mono };
      bbox = item.bbox;
      text = item.text;
    } else if (span) {
      mode = 'replace';
      style = { size: span.size, color: span.color || '#000000', bold: !!span.bold, italic: !!span.italic, serif: !!span.serif, mono: !!span.mono };
      bbox = span.bbox;
      text = span.text;
    } else {
      mode = 'add';
      style = { ...S.textStyle };
      const y = clamp(at.y - style.size * 0.6, 0, meta.h - style.size);
      bbox = [at.x, y, at.x + 10, y + style.size * 1.22];
      text = '';
    }

    const ta = document.createElement('textarea');
    ta.className = `inline-editor inline-${mode}`;
    ta.value = text;
    ta.wrap = 'off';
    ta.spellcheck = true;
    ta.setAttribute('aria-label', mode === 'replace' ? 'Edit text' : 'New text');
    ta.style.left = `${bbox[0] * scale}px`;
    ta.style.top = `${bbox[1] * scale}px`;
    // Spans on rotated pages are tall and narrow; edit them in a horizontal box anchored at the span.
    const vertical = mode === 'replace' && isVertical(bbox, text);
    const minW = mode === 'replace' ? (vertical ? Math.max(80, (bbox[3] - bbox[1]) * scale) : (bbox[2] - bbox[0]) * scale) : 60;
    const lineH = mode === 'replace' ? (vertical ? (bbox[2] - bbox[0]) * scale : (bbox[3] - bbox[1]) * scale) : style.size * 1.22 * scale;

    const restyle = () => {
      applyFont(ta.style, style);
      ta.style.lineHeight = `${mode === 'replace' ? lineH : style.size * 1.22 * scale}px`;
      grow();
    };
    const grow = () => {
      ta.style.width = '1px';
      ta.style.width = `${Math.max(minW, ta.scrollWidth + 6)}px`;
      ta.style.height = '1px';
      ta.style.height = `${Math.max(lineH, ta.scrollHeight)}px`;
    };

    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = ta.value.replace(/\r/g, '');
      editing = null;
      ta.remove();
      if (save) applyEditorResult({ mode, item, span, style, bbox, value, meta });
      renderOverlay();
      renderStrip();
      renderTextOptions();
    };

    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && (mode === 'replace' || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
    ta.addEventListener('blur', () => finish(true));

    editing = { el: ta, itemId: item?.id || null, isNew: !item && mode === 'add', style, commit: () => finish(true), cancel: () => finish(false), restyle };
    if (item) select(item.id);
    renderOverlay();
    restyle();
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    renderTextOptions();
  }

  function applyEditorResult({ mode, item, span, style, bbox, value, meta }) {
    if (mode === 'replace') {
      if (item) {
        if (value === item.original) { removeItem(item.id); return; }
        if (value === item.text && sameStyle(item, style)) return;
        pushUndo();
        Object.assign(item, { text: value, ...style });
        return;
      }
      if (value === span.text && sameStyle(span, style)) return;
      addItem({
        id: uid('e'), type: 'replace_text', page: meta.src, bbox: span.bbox.map(round2), text: value,
        ...style, spanId: span.id, original: span.text, maxX1: span.max_x1,
      });
      return;
    }
    // add_text
    if (!value.trim()) {
      if (item) removeItem(item.id);
      return;
    }
    const m = measureText(value, style);
    const x0 = bbox[0];
    const y0 = bbox[1];
    const nb = [x0, y0, Math.min(meta.w, x0 + m.w + style.size * 0.6), Math.min(meta.h, y0 + m.h + style.size * 0.35)].map(round2);
    if (item) {
      if (value === item.text && sameStyle(item, style)) return;
      pushUndo();
      Object.assign(item, { text: value, bbox: nb, ...style });
      return;
    }
    S.tool = 'select';
    addItem({ id: uid('e'), type: 'add_text', page: meta.src, bbox: nb, text: value, ...style });
    renderToolbar();
  }

  const sameStyle = (a, b) => Number(a.size) === Number(b.size)
    && String(a.color).toLowerCase() === String(b.color).toLowerCase()
    && ['bold', 'italic', 'serif', 'mono'].every((k) => !!a[k] === !!b[k]);

  function commitEditor(save = true) {
    if (editing) (save ? editing.commit : editing.cancel)();
  }

  /* ---------------------------------------------------------- text options */

  function changeStyle(patch) {
    if (editing?.style) {
      Object.assign(editing.style, patch);
      editing.restyle();
      if (editing.isNew) Object.assign(S.textStyle, patch);
      renderTextOptions();
      editing.el.focus();
      return;
    }
    const it = selectedItem();
    if (it && (it.type === 'add_text' || it.type === 'replace_text')) {
      pushUndo();
      Object.assign(it, patch);
      if (it.type === 'add_text') {
        const m = measureText(it.text, it);
        const meta = pageMeta();
        it.bbox = [it.bbox[0], it.bbox[1], Math.min(meta.w, it.bbox[0] + m.w + it.size * 0.6), Math.min(meta.h, it.bbox[1] + m.h + it.size * 0.35)].map(round2);
      }
      renderOverlay();
    } else {
      Object.assign(S.textStyle, patch);
    }
    renderTextOptions();
  }

  const opts = $('.text-opts');
  // Keep the inline editor open while using the option controls.
  opts.addEventListener('pointerdown', (e) => { if (editing && e.target.closest('button')) e.preventDefault(); });
  opts.querySelector('[data-opt=size]').addEventListener('change', (e) => changeStyle({ size: Number(e.target.value) }));
  opts.querySelector('[data-opt=family]').addEventListener('change', (e) => changeStyle({ serif: e.target.value === 'serif', mono: e.target.value === 'mono' }));
  opts.querySelector('[data-opt=color]').addEventListener('change', (e) => changeStyle({ color: e.target.value }));
  opts.querySelector('[data-opt=bold]').addEventListener('click', (e) => changeStyle({ bold: e.currentTarget.getAttribute('aria-pressed') !== 'true' }));
  opts.querySelector('[data-opt=italic]').addEventListener('click', (e) => changeStyle({ italic: e.currentTarget.getAttribute('aria-pressed') !== 'true' }));
  // Selects/colour pickers steal focus (and would commit the editor via blur) — re-open on the same item is fine.

  /* ======================================================= pages */

  function goTo(i) {
    commitEditor(true);
    S.current = clamp(i, 0, S.pages.length - 1);
    S.selectedId = null;
    renderStrip();
    renderStage();
    renderToolbar();
  }

  function pageAction(i, act) {
    const p = S.pages[i];
    if (!p) return;
    commitEditor(true);
    const curKey = S.pages[S.current]?.key;
    if (act === 'rotl' || act === 'rotr') {
      pushUndo();
      p.rotate = (p.rotate + (act === 'rotr' ? 90 : 270)) % 360;
    } else if (act === 'dup') {
      pushUndo();
      S.pages.splice(i + 1, 0, { ...p, key: uid('p') });
    } else if (act === 'del') {
      if (S.pages.length === 1) { toast('A PDF needs at least one page — the cat insists.', 'warn'); return; }
      pushUndo();
      S.pages.splice(i, 1);
      thumbImgs.delete(p.key);
    }
    const idx = S.pages.findIndex((x) => x.key === curKey);
    S.current = idx >= 0 ? idx : clamp(i, 0, S.pages.length - 1);
    renderStrip();
    renderStage();
    renderToolbar();
  }

  function movePage(from, to) {
    commitEditor(true);
    const curKey = S.pages[S.current]?.key;
    pushUndo();
    moveItem(S.pages, from, to);
    S.current = Math.max(0, S.pages.findIndex((x) => x.key === curKey));
    renderStrip();
    renderMeta();
  }

  async function insertFromPdf() {
    const [p] = await window.catpdf.openFiles({ kind: 'pdf', title: 'Insert pages from another PDF' });
    if (!p) return;
    let info;
    try {
      info = await api.info(p, true);
    } catch (err) {
      showError(err, 'The cat couldn’t read that PDF');
      return;
    }
    if (info.encrypted) { showError({ detail: 'That PDF is password-protected.' }, 'Locked tight'); return; }
    const same = p.toLowerCase() === S.doc.path.toLowerCase();
    if (!same) S.imported[p] = info;
    pushUndo();
    const at = S.current + 1;
    const fresh = info.page_sizes.map((_, i) => ({ key: uid('p'), src: i, file: same ? null : p, rotate: 0 }));
    S.pages.splice(at, 0, ...fresh);
    S.current = at;
    S.selectedId = null;
    renderAll();
    toast(`Inserted ${fresh.length} page${fresh.length > 1 ? 's' : ''} from ${baseName(p)}.`, 'success');
  }

  thumbsEl.addEventListener('click', (e) => {
    const li = e.target.closest('.thumb');
    if (!li) return;
    const i = Number(li.dataset.index);
    const act = e.target.closest('[data-pact]')?.dataset.pact;
    if (act) pageAction(i, act);
    else if (e.target.closest('.thumb-main')) goTo(i);
  });
  thumbsEl.addEventListener('keydown', (e) => {
    const li = e.target.closest('.thumb');
    if (!li || !e.target.classList.contains('thumb-main')) return;
    const i = Number(li.dataset.index);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= S.pages.length) return;
      movePage(i, to);
      thumbsEl.querySelector(`.thumb[data-index="${to}"] .thumb-main`)?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const to = clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, S.pages.length - 1);
      goTo(to);
      thumbsEl.querySelector(`.thumb[data-index="${to}"] .thumb-main`)?.focus();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      pageAction(i, 'del');
    }
  });
  makeSortable(thumbsEl, { itemSelector: '.thumb', onMove: movePage });

  /* ======================================================= save */

  async function save() {
    commitEditor(true);
    if (!S.doc) return;
    const output = await window.catpdf.saveFile({ kind: 'pdf', defaultPath: siblingPath(S.doc.path, '-edited', 'pdf'), title: 'Save edited PDF' });
    if (!output) return;
    if (output.toLowerCase() === S.doc.path.toLowerCase()) {
      showError({ detail: 'Please pick a different file name — the cat can’t overwrite the PDF it is still reading. (Tip: save as a copy, then replace the original.)' }, 'Same file');
      return;
    }
    const used = new Set(S.pages.filter((p) => !p.file).map((p) => p.src));
    const payload = {
      path: S.doc.path,
      output,
      pages: S.pages.map((p) => (p.file ? { file: p.file, src: p.src, rotate: p.rotate } : { src: p.src, rotate: p.rotate })),
      edits: S.edits.filter((e) => used.has(e.page)).map(({ id, spanId, original, ...rest }) => ({ ...rest, bbox: rest.bbox.map(round2) })),
    };
    try {
      const res = await withLoader(() => api.applyEdits(payload), { message: 'Kneading your edits into the pages…', scene: 'knead' });
      S.dirty = false;
      renderMeta();
      showResult({ path: res.output || output, details: [`${res.pages} page${res.pages === 1 ? '' : 's'}`, `${payload.edits.length} edit${payload.edits.length === 1 ? '' : 's'} applied`] });
    } catch (err) {
      showError(err, 'The cat couldn’t save your edits');
    }
  }

  /* ======================================================= wiring */

  el.querySelectorAll('.tool-btn').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('[data-act=undo]').addEventListener('click', undo);
  $('[data-act=redo]').addEventListener('click', redo);
  $('[data-act=save]').addEventListener('click', save);
  $('[data-act=open]').addEventListener('click', chooseAndOpen);
  el.querySelectorAll('[data-act=insert]').forEach((b) => b.addEventListener('click', insertFromPdf));
  $('[data-act=prev]').addEventListener('click', () => goTo(S.current - 1));
  $('[data-act=next]').addEventListener('click', () => goTo(S.current + 1));
  const zoomTo = (z) => { commitEditor(true); S.zoom = z; renderStage(); };
  $('[data-act=zoomin]').addEventListener('click', () => zoomTo(ZOOMS.find((z) => z > S.zoom + 0.01) || S.zoom));
  $('[data-act=zoomout]').addEventListener('click', () => zoomTo([...ZOOMS].reverse().find((z) => z < S.zoom - 0.01) || S.zoom));
  $('[data-act=zoomfit]').addEventListener('click', () => zoomTo(1));

  const dz = $('.editor-drop');
  dz.addEventListener('click', chooseAndOpen);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseAndOpen(); } });
  makeDropZone(el, { accept: ['pdf'], multiple: false, label: 'PDFs', onFiles: ([p]) => openDoc(p) });

  let resizeRaf = 0;
  new ResizeObserver(() => {
    if (!S.doc || shell.hidden) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { if (!editing) renderStage(); });
  }).observe(scrollEl);

  function onKey(e) {
    if (!S.doc || shell.hidden || e.defaultPrevented) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (isTyping(e.target)) return;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (ctrl || e.altKey) return;
    const it = selectedItem();
    if ((e.key === 'Delete' || e.key === 'Backspace') && it) { e.preventDefault(); removeItem(it.id); return; }
    if (e.key === 'Escape') {
      if (S.tool !== 'select') setTool('select');
      else select(null);
      return;
    }
    if (it && it.type !== 'replace_text' && e.key.startsWith('Arrow') && !thumbsEl.contains(e.target)) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const meta = pageMeta();
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      const w = it.bbox[2] - it.bbox[0];
      const hh = it.bbox[3] - it.bbox[1];
      const x0 = clamp(it.bbox[0] + dx, 0, Math.max(0, meta.w - w));
      const y0 = clamp(it.bbox[1] + dy, 0, Math.max(0, meta.h - hh));
      pushUndo();
      it.bbox = [x0, y0, x0 + w, y0 + hh].map(round2);
      renderOverlay();
      return;
    }
    if (e.key === 'PageDown') { e.preventDefault(); goTo(S.current + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); goTo(S.current - 1); return; }
    const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (tool && pageMeta()?.editable && !e.target.closest?.('.thumbs')) { e.preventDefault(); setTool(tool.id); }
  }

  return {
    el,
    onKey,
    show(payload) {
      if (payload?.open) openDoc(payload.open);
      else if (S.doc) requestAnimationFrame(renderStage);
    },
    hide() { commitEditor(true); },
  };
}
