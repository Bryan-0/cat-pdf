// Cat PDF — Converter: DOCX → PDF and Images → PDF.
import { api, baseName, BROWSER_IMAGE_EXT, dirName, ext, fileUrl, IMAGE_EXT, siblingPath } from '../api.js';
import { catSleeping, icon, paw } from '../cats.js';
import { emptyState, esc, h, makeDropZone, makeSortable, moveItem, showError, showResult, uid, withLoader } from '../ui.js';

const ENGINE_LABELS = { word: 'Microsoft Word', libreoffice: 'LibreOffice', builtin: 'Built-in' };

export function createConvert() {
  let tab = 'docx';
  let docxPath = null;
  let engines = null;
  let lastWarnings = [];
  const images = [];

  const el = h(`<section class="tool-view convert-view">
    <header class="view-head">
      <div>
        <h1>${icon('convert')}Convert to PDF</h1>
        <p>Word documents and pictures in, clean PDFs out — all on your computer.</p>
      </div>
    </header>
    <div class="tabs" role="tablist" aria-label="Converter">
      <button class="tab" role="tab" type="button" data-tab="docx" id="tab-docx" aria-controls="pane-docx">${icon('docx')}Word → PDF</button>
      <button class="tab" role="tab" type="button" data-tab="images" id="tab-images" aria-controls="pane-images">${icon('image')}Images → PDF</button>
    </div>

    <div class="tab-pane" id="pane-docx" role="tabpanel" aria-labelledby="tab-docx">
      <div class="panel">
        <div class="docx-file"></div>
        <div class="field-grid">
          <div class="field">
            <span class="field-label">Conversion engine</span>
            <select class="input engine-select" aria-label="Conversion engine"></select>
            <span class="field-hint engine-hint"></span>
          </div>
          <div class="field">
            <span class="field-label">Available on this PC</span>
            <div class="engine-chips"><span class="muted">Checking…</span></div>
          </div>
        </div>
        <div class="callout">
          ${icon('info')}
          <div><b>About the engines.</b> Microsoft Word gives the most faithful result, LibreOffice comes very close.
          When neither is installed the <b>Built-in</b> engine is used: it keeps text, headings, lists, tables and images,
          but fancy layouts (columns, text boxes, headers/footers) may look simpler than in Word.</div>
        </div>
        <div class="docx-warnings"></div>
      </div>
      <footer class="action-bar">
        <div class="action-summary docx-summary"></div>
        <button class="btn btn-primary btn-lg" type="button" data-act="docx-go" disabled>${icon('convert')}Convert &amp; save…</button>
      </footer>
    </div>

    <div class="tab-pane" id="pane-images" role="tabpanel" aria-labelledby="tab-images" hidden>
      <div class="panel images-panel">
        <div class="panel-head">
          <span class="panel-title">Images <span class="count-pill images-count">0</span></span>
          <button class="btn btn-ghost btn-sm" type="button" data-act="img-add">${icon('plus')}Add images</button>
        </div>
        <ol class="file-list image-list" aria-label="Images, in page order"></ol>
        <div class="drop-zone images-drop" tabindex="0" role="button" aria-label="Add images">
          ${paw('dz-paw')}<span><b>Drop images here</b> or click to add — each image becomes one page</span>
        </div>
        <div class="field-grid three">
          <label class="field"><span class="field-label">Page size</span>
            <select class="input" data-opt="page_size">
              <option value="fit">Fit to image</option><option value="a4">A4</option><option value="letter">US Letter</option>
            </select></label>
          <label class="field"><span class="field-label">Orientation</span>
            <select class="input" data-opt="orientation">
              <option value="auto">Auto (match image)</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select></label>
          <label class="field"><span class="field-label">Margin</span>
            <span class="input-suffix"><input class="input" type="number" min="0" max="144" step="1" value="0" data-opt="margin"><span>pt</span></span>
            <span class="field-hint margin-hint">No margin</span></label>
        </div>
      </div>
      <footer class="action-bar">
        <div class="action-summary images-summary"></div>
        <button class="btn btn-primary btn-lg" type="button" data-act="img-go" disabled>${icon('image')}Create PDF…</button>
      </footer>
    </div>
  </section>`);

  /* -------------------------------------------------------------- tabs */
  const tabs = [...el.querySelectorAll('.tab')];
  function setTab(t) {
    tab = t;
    tabs.forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    el.querySelector('#pane-docx').hidden = t !== 'docx';
    el.querySelector('#pane-images').hidden = t !== 'images';
  }
  tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  el.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tab === 'docx' ? 'images' : 'docx';
    setTab(next);
    el.querySelector(`[data-tab=${next}]`).focus();
  });

  /* -------------------------------------------------------------- DOCX */
  const docxBox = el.querySelector('.docx-file');
  const engineSelect = el.querySelector('.engine-select');
  const docxGo = el.querySelector('[data-act=docx-go]');

  async function pickDocx() {
    const [p] = await window.catpdf.openFiles({ kind: 'docx', title: 'Choose a Word document' });
    if (p) setDocx(p);
  }

  function setDocx(p) {
    docxPath = p;
    lastWarnings = [];
    renderDocx();
  }

  function renderDocx() {
    if (docxPath) {
      docxBox.innerHTML = `<div class="chosen-file">
        <span class="chosen-icon">${icon('docx')}</span>
        <div class="file-info"><div class="file-name">${esc(baseName(docxPath))}</div><div class="file-meta" title="${esc(docxPath)}">${esc(dirName(docxPath))}</div></div>
        <button class="btn btn-ghost btn-sm" type="button" data-act="docx-change">Change</button>
        <button class="icon-btn" type="button" data-act="docx-clear" aria-label="Remove file">${icon('x')}</button>
      </div>`;
      docxBox.querySelector('[data-act=docx-change]').addEventListener('click', pickDocx);
      docxBox.querySelector('[data-act=docx-clear]').addEventListener('click', () => setDocx(null));
    } else {
      docxBox.innerHTML = `<div class="drop-zone docx-drop" tabindex="0" role="button" aria-label="Choose a Word document">
        ${paw('dz-paw')}<span><b>Drop a .docx here</b> or click to choose — the cat will take it from there</span></div>`;
      const dz = docxBox.querySelector('.drop-zone');
      dz.addEventListener('click', pickDocx);
      dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickDocx(); } });
    }
    el.querySelector('.docx-warnings').innerHTML = lastWarnings.length
      ? `<div class="callout callout-warn">${icon('info')}<div><b>Notes from the last conversion</b><ul>${lastWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>`
      : '';
    el.querySelector('.docx-summary').textContent = docxPath ? 'Ready when you are.' : 'Choose a .docx file to convert';
    docxGo.disabled = !docxPath;
  }

  function renderEngines() {
    const chips = el.querySelector('.engine-chips');
    const prev = engineSelect.value || 'auto';
    if (!engines) {
      engineSelect.innerHTML = '<option value="auto">Auto</option>';
      return;
    }
    const best = ['word', 'libreoffice', 'builtin'].find((k) => engines[k]) || 'builtin';
    chips.innerHTML = ['word', 'libreoffice', 'builtin'].map((k) => `<span class="chip ${engines[k] ? 'chip-on' : 'chip-off'}">
      ${icon(engines[k] ? 'check' : 'x')}${ENGINE_LABELS[k]}</span>`).join('');
    engineSelect.innerHTML = `<option value="auto">Auto — best available (${ENGINE_LABELS[best]})</option>
      ${['word', 'libreoffice', 'builtin'].map((k) => `<option value="${k}" ${engines[k] ? '' : 'disabled'}>${ENGINE_LABELS[k]}${engines[k] ? '' : ' — not installed'}</option>`).join('')}`;
    engineSelect.value = engines[prev] || prev === 'auto' ? prev : 'auto';
    updateEngineHint();
  }

  function updateEngineHint() {
    const v = engineSelect.value;
    const hints = {
      auto: 'Tries Word, then LibreOffice, then the built-in engine.',
      word: 'Best fidelity. Word opens invisibly in the background.',
      libreoffice: 'Very good fidelity, runs headless.',
      builtin: 'Always available. Lower fidelity for complex layouts.',
    };
    el.querySelector('.engine-hint').textContent = hints[v] || '';
  }
  engineSelect.addEventListener('change', updateEngineHint);

  async function loadEngines() {
    try {
      engines = await api.docxEngines();
    } catch (err) {
      engines = { word: false, libreoffice: false, builtin: true };
      el.querySelector('.engine-chips').innerHTML = `<span class="text-danger">${esc(err.detail || err.message)}</span>`;
    }
    renderEngines();
  }

  async function convertDocx() {
    if (!docxPath) return;
    const output = await window.catpdf.saveFile({ kind: 'pdf', defaultPath: siblingPath(docxPath, '', 'pdf'), title: 'Save PDF' });
    if (!output) return;
    try {
      const res = await withLoader(() => api.convertDocx(docxPath, output, engineSelect.value), { message: 'Converting… paws-itively working' });
      lastWarnings = res.warnings || [];
      renderDocx();
      showResult({
        path: res.output || output,
        details: [`${res.pages} page${res.pages === 1 ? '' : 's'}`, `engine: ${ENGINE_LABELS[res.engine] || res.engine}`],
        warnings: lastWarnings,
      });
    } catch (err) {
      showError(err, 'The cat couldn’t convert that document');
    }
  }
  docxGo.addEventListener('click', convertDocx);
  makeDropZone(el.querySelector('#pane-docx .panel'), { accept: ['docx'], multiple: false, label: '.docx files', onFiles: ([p]) => setDocx(p) });

  /* ------------------------------------------------------------ Images */
  const imgList = el.querySelector('.image-list');
  const imgGo = el.querySelector('[data-act=img-go]');
  const opt = (k) => el.querySelector(`[data-opt=${k}]`);

  function addImages(paths) {
    paths.filter((p) => IMAGE_EXT.includes(ext(p))).forEach((p) => images.push({ id: uid('i'), path: p }));
    renderImages();
  }

  async function pickImages() {
    const paths = await window.catpdf.openFiles({ kind: 'images', multiple: true, title: 'Choose images' });
    if (paths.length) addImages(paths);
  }

  function renderImages() {
    imgList.innerHTML = '';
    if (!images.length) {
      imgList.innerHTML = `<li class="list-empty">${emptyState({ cat: catSleeping(), title: 'No pictures yet… the cat is napping', text: 'Add photos, scans or screenshots.' })}</li>`;
    }
    images.forEach((it, i) => {
      const canShow = BROWSER_IMAGE_EXT.includes(ext(it.path));
      const li = h(`<li class="file-row" draggable="true" data-index="${i}">
        <span class="grip" title="Drag to reorder">${icon('grip')}</span>
        <span class="row-num">${i + 1}</span>
        <span class="file-thumb">${canShow ? `<img alt="" loading="lazy" src="${esc(fileUrl(it.path))}">` : `<span class="thumb-icon">${icon('image')}</span>`}</span>
        <div class="file-info"><div class="file-name" title="${esc(it.path)}">${esc(baseName(it.path))}</div><div class="file-meta">Page ${i + 1}</div></div>
        <div class="row-actions">
          <button class="icon-btn" type="button" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="icon-btn" type="button" data-act="down" aria-label="Move down" ${i === images.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="icon-btn icon-btn-danger" type="button" data-act="remove" aria-label="Remove">${icon('x')}</button>
        </div>
      </li>`);
      const img = li.querySelector('img');
      img?.addEventListener('error', () => img.replaceWith(h(`<span class="thumb-icon">${icon('image')}</span>`)));
      li.querySelector('[data-act=up]').addEventListener('click', () => { moveItem(images, i, i - 1); renderImages(); });
      li.querySelector('[data-act=down]').addEventListener('click', () => { moveItem(images, i, i + 1); renderImages(); });
      li.querySelector('[data-act=remove]').addEventListener('click', () => { images.splice(i, 1); renderImages(); });
      imgList.appendChild(li);
    });
    el.querySelector('.images-count').textContent = images.length;
    el.querySelector('.images-summary').innerHTML = images.length
      ? `<b>${images.length}</b> image${images.length > 1 ? 's' : ''} → <b>${images.length}</b> page${images.length > 1 ? 's' : ''}`
      : 'Add images to get started';
    imgGo.disabled = !images.length;
  }

  function updateImageOptions() {
    const fit = opt('page_size').value === 'fit';
    opt('orientation').disabled = fit;
    opt('orientation').closest('.field').classList.toggle('is-disabled', fit);
    const m = Math.max(0, Number(opt('margin').value) || 0);
    el.querySelector('.margin-hint').textContent = m ? `≈ ${(m / 72 * 25.4).toFixed(1)} mm on every side` : 'No margin';
  }
  opt('page_size').addEventListener('change', updateImageOptions);
  opt('margin').addEventListener('input', updateImageOptions);

  async function convertImages() {
    if (!images.length) return;
    const first = images[0].path;
    const def = images.length > 1 ? siblingPath(first, '-images', 'pdf') : siblingPath(first, '', 'pdf');
    const output = await window.catpdf.saveFile({ kind: 'pdf', defaultPath: def, title: 'Save PDF' });
    if (!output) return;
    const payload = {
      inputs: images.map((x) => x.path),
      output,
      page_size: opt('page_size').value,
      orientation: opt('orientation').value,
      margin: Math.max(0, Math.min(144, Number(opt('margin').value) || 0)),
    };
    try {
      const res = await withLoader(() => api.convertImages(payload), { message: 'Batting your pictures into pages…' });
      showResult({ path: res.output || output, details: [`${res.pages} page${res.pages === 1 ? '' : 's'}`] });
    } catch (err) {
      showError(err, 'The cat couldn’t make that PDF');
    }
  }

  el.querySelector('[data-act=img-add]').addEventListener('click', pickImages);
  const idz = el.querySelector('.images-drop');
  idz.addEventListener('click', pickImages);
  idz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickImages(); } });
  imgGo.addEventListener('click', convertImages);
  makeDropZone(el.querySelector('.images-panel'), { accept: IMAGE_EXT, label: 'images', onFiles: addImages });
  makeSortable(imgList, { itemSelector: '.file-row', onMove: (a, b) => { moveItem(images, a, b); renderImages(); } });

  setTab('docx');
  renderDocx();
  renderEngines();
  renderImages();
  updateImageOptions();

  return {
    el,
    onBackendReady: loadEngines,
    show(payload) {
      if (!engines && document.body.classList.contains('backend-ready')) loadEngines();
      if (payload?.docx) { setTab('docx'); setDocx(payload.docx); }
      if (payload?.images?.length) { setTab('images'); addImages(payload.images); }
      if (payload?.tab) setTab(payload.tab);
    },
  };
}
