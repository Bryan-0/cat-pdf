// Cat PDF — Merge view.
import { api, baseName, BROWSER_IMAGE_EXT, ext, fileKind, fileUrl, IMAGE_EXT, renderUrl, siblingPath, formatBytes } from '../api.js';
import { catSleeping, icon, paw } from '../cats.js';
import { emptyState, esc, h, makeDropZone, makeSortable, moveItem, showError, showResult, toast, uid, validateRange, withLoader } from '../ui.js';

const ACCEPT = ['pdf', 'docx', ...IMAGE_EXT];

export function createMerge() {
  /** @type {{id:string,path:string,name:string,kind:string,range:string,pageCount:number|null,size:number|null,error:string}[]} */
  const items = [];

  const el = h(`<section class="tool-view merge-view">
    <header class="view-head">
      <div>
        <h1>${icon('merge')}Merge files</h1>
        <p>Add PDFs, images or Word documents, drag them into order, optionally pick pages, then merge.</p>
      </div>
      <div class="view-head-actions">
        <button class="btn btn-ghost" type="button" data-act="clear" disabled>${icon('trash')}Clear</button>
        <button class="btn btn-primary" type="button" data-act="add">${icon('plus')}Add files</button>
      </div>
    </header>
    <div class="panel merge-panel">
      <ol class="file-list" aria-label="Files to merge"></ol>
      <div class="drop-zone merge-drop" tabindex="0" role="button" aria-label="Add files">
        ${paw('dz-paw')}<span><b>Drop files here</b> or click to add — PDF, PNG, JPG, TIFF, WEBP, DOCX</span>
      </div>
    </div>
    <footer class="action-bar">
      <div class="action-summary"></div>
      <button class="btn btn-primary btn-lg" type="button" data-act="merge" disabled>${icon('merge')}Merge &amp; save…</button>
    </footer>
  </section>`);

  const list = el.querySelector('.file-list');
  const summary = el.querySelector('.action-summary');
  const mergeBtn = el.querySelector('[data-act=merge]');
  const clearBtn = el.querySelector('[data-act=clear]');

  async function addPaths(paths) {
    const fresh = paths.filter((p) => ACCEPT.includes(ext(p)));
    for (const path of fresh) {
      const item = { id: uid('m'), path, name: baseName(path), kind: fileKind(path), range: '', pageCount: null, size: null, error: '' };
      items.push(item);
      if (item.kind === 'pdf') {
        api.info(path).then((info) => {
          item.pageCount = info.pages;
          item.size = info.size_bytes;
          if (info.encrypted) item.error = 'This PDF is password-protected.';
          render();
        }).catch((err) => { item.error = err.detail || err.message; render(); });
      }
    }
    render();
  }

  async function pick() {
    const paths = await window.catpdf.openFiles({ kind: 'mergeable', multiple: true, title: 'Add files to merge' });
    if (paths.length) addPaths(paths);
  }

  function thumb(item) {
    if (item.kind === 'pdf') return `<img alt="" loading="lazy" src="${esc(renderUrl(item.path, 0, 120))}">`;
    if (item.kind === 'image' && BROWSER_IMAGE_EXT.includes(ext(item.path))) return `<img alt="" loading="lazy" src="${esc(fileUrl(item.path))}">`;
    return `<span class="thumb-icon">${icon(item.kind === 'docx' ? 'docx' : 'image')}</span>`;
  }

  function meta(item) {
    if (item.kind === 'pdf') {
      if (item.pageCount == null && !item.error) return 'PDF · counting pages…';
      return `PDF · ${item.pageCount ?? '?'} page${item.pageCount === 1 ? '' : 's'}${item.size ? ` · ${formatBytes(item.size)}` : ''}`;
    }
    if (item.kind === 'docx') return 'Word document · converted automatically';
    return `${ext(item.path).toUpperCase()} image · 1 page`;
  }

  function render() {
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = `<li class="list-empty">${emptyState({ cat: catSleeping(), title: 'No files yet… the cat is napping', text: 'Add two or more files to wake it up.' })}</li>`;
    }
    items.forEach((item, i) => {
      const rangeErr = item.kind === 'pdf' ? validateRange(item.range, item.pageCount) : '';
      const li = h(`<li class="file-row${item.error ? ' has-error' : ''}" draggable="true" data-index="${i}">
        <span class="grip" title="Drag to reorder">${icon('grip')}</span>
        <span class="row-num">${i + 1}</span>
        <span class="file-thumb">${thumb(item)}</span>
        <div class="file-info">
          <div class="file-name" title="${esc(item.path)}">${esc(item.name)}</div>
          <div class="file-meta">${item.error ? `<span class="text-danger">${esc(item.error)}</span>` : esc(meta(item))}</div>
        </div>
        ${item.kind === 'pdf' ? `<label class="range-field">
            <span>Pages</span>
            <input type="text" class="input input-sm${rangeErr ? ' invalid' : ''}" placeholder="All" value="${esc(item.range)}" spellcheck="false" aria-label="Page range for ${esc(item.name)}" title="${esc(rangeErr || 'e.g. 1-3, 5 — leave empty for all pages')}">
          </label>` : '<span class="range-field range-na">All</span>'}
        <div class="row-actions">
          <button class="icon-btn" type="button" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="icon-btn" type="button" data-act="down" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="icon-btn icon-btn-danger" type="button" data-act="remove" aria-label="Remove ${esc(item.name)}">${icon('x')}</button>
        </div>
      </li>`);
      const img = li.querySelector('.file-thumb img');
      img?.addEventListener('error', () => { img.replaceWith(h(`<span class="thumb-icon">${icon(item.kind === 'pdf' ? 'pdf' : 'image')}</span>`)); });
      const input = li.querySelector('input');
      input?.addEventListener('input', () => {
        item.range = input.value;
        const err = validateRange(item.range, item.pageCount);
        input.classList.toggle('invalid', !!err);
        input.title = err || 'e.g. 1-3, 5 — leave empty for all pages';
        updateSummary();
      });
      // Text inputs inside a draggable row should still allow selecting text.
      input?.addEventListener('mousedown', () => { li.draggable = false; });
      input?.addEventListener('blur', () => { li.draggable = true; });
      li.querySelector('[data-act=up]').addEventListener('click', () => { moveItem(items, i, i - 1); render(); focusRow(i - 1, 'up'); });
      li.querySelector('[data-act=down]').addEventListener('click', () => { moveItem(items, i, i + 1); render(); focusRow(i + 1, 'down'); });
      li.querySelector('[data-act=remove]').addEventListener('click', () => { items.splice(i, 1); render(); });
      list.appendChild(li);
    });
    updateSummary();
  }

  function focusRow(i, act) {
    const btn = list.querySelector(`.file-row[data-index="${i}"] [data-act=${act}]`);
    (btn && !btn.disabled ? btn : list.querySelector(`.file-row[data-index="${i}"] [data-act=remove]`))?.focus();
  }

  function estimatePages() {
    let total = 0;
    let unknown = false;
    for (const it of items) {
      if (it.kind === 'image') total += 1;
      else if (it.kind === 'pdf' && it.pageCount != null) total += it.range.trim() ? countRange(it.range, it.pageCount) : it.pageCount;
      else unknown = true;
    }
    return { total, unknown };
  }

  function updateSummary() {
    const invalid = items.some((it) => it.error || (it.kind === 'pdf' && validateRange(it.range, it.pageCount)));
    const { total, unknown } = estimatePages();
    summary.innerHTML = items.length
      ? `<b>${items.length}</b> file${items.length > 1 ? 's' : ''} · ${unknown ? '≈ ' : ''}<b>${total}</b>${unknown ? '+' : ''} page${total === 1 ? '' : 's'}${invalid ? ' · <span class="text-danger">fix the highlighted rows first</span>' : ''}`
      : 'Add files to get started';
    mergeBtn.disabled = !items.length || invalid;
    clearBtn.disabled = !items.length;
  }

  async function doMerge() {
    if (!items.length) return;
    if (items.length === 1 && !items[0].range.trim()) toast('Only one file — the cat will just copy it into a new PDF.', 'info');
    const first = items[0].path;
    const output = await window.catpdf.saveFile({ kind: 'pdf', defaultPath: siblingPath(first, '-merged', 'pdf'), title: 'Save merged PDF' });
    if (!output) return;
    const inputs = items.map((it) => (it.kind === 'pdf' && it.range.trim() ? { path: it.path, pages: it.range.trim() } : { path: it.path }));
    try {
      const res = await withLoader(() => api.merge(inputs, output), { message: 'Herding pages… it’s like herding cats' });
      showResult({ path: res.output || output, details: [`${res.pages} page${res.pages === 1 ? '' : 's'} merged from ${items.length} file${items.length > 1 ? 's' : ''}`] });
    } catch (err) {
      showError(err, 'The merge got tangled');
    }
  }

  el.querySelector('[data-act=add]').addEventListener('click', pick);
  clearBtn.addEventListener('click', () => { items.length = 0; render(); });
  mergeBtn.addEventListener('click', doMerge);
  const dz = el.querySelector('.merge-drop');
  dz.addEventListener('click', pick);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  makeDropZone(el.querySelector('.merge-panel'), { accept: ACCEPT, label: 'PDFs, images or DOCX files', onFiles: addPaths });
  makeSortable(list, { itemSelector: '.file-row', onMove: (from, to) => { moveItem(items, from, to); render(); } });

  render();

  return {
    el,
    show(payload) {
      if (payload?.add?.length) addPaths(payload.add);
    },
  };
}

function countRange(str, max) {
  const set = new Set();
  for (const part of str.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    if (!Number.isFinite(a)) continue;
    const end = Number.isFinite(b) ? b : a;
    for (let i = a; i <= Math.min(end, max); i++) set.add(i);
  }
  return set.size;
}
