// Cat PDF — signature modal: draw / type / upload, produces a trimmed transparent PNG data URL.
import { icon, paw } from './cats.js';
import { esc, h, openModal, toast } from './ui.js';

const STORE_KEY = 'catpdf.signatures';
const MAX_SAVED = 6;

const COLORS = [
  { name: 'Black', value: '#1b1b1f' },
  { name: 'Navy', value: '#1d2f6f' },
  { name: 'Blue', value: '#1f5fbf' },
  { name: 'Ginger', value: '#c2520a' },
];

const SCRIPT_FONTS = ['Segoe Script', 'Brush Script MT', 'Lucida Handwriting', 'Ink Free', 'Freestyle Script', 'Mistral', 'Kristen ITC'];

/* ------------------------------------------------------------- storage */

export function loadSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x?.data === 'string' && x.data.startsWith('data:image/')) : [];
  } catch {
    return [];
  }
}

function storeSaved(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
}

function remember(data) {
  const list = loadSaved().filter((x) => x.data !== data);
  list.unshift({ id: `s${Date.now().toString(36)}`, data, created: new Date().toISOString() });
  if (!storeSaved(list)) toast('Couldn’t remember the signature (storage is full or blocked) — it will still be placed.', 'warn');
}

/* -------------------------------------------------------------- canvas */

/** Crop transparent margins (alpha <= 8) and return a PNG data URL, or null if empty. */
function trimCanvas(src, pad = 6) {
  const ctx = src.getContext('2d');
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function fontAvailable(name) {
  const c = document.createElement('canvas').getContext('2d');
  const sample = 'Signature Abcdefghijklmnop 0123';
  return ['monospace', 'serif'].some((fb) => {
    c.font = `40px ${fb}`;
    const base = c.measureText(sample).width;
    c.font = `40px "${name}", ${fb}`;
    return Math.abs(c.measureText(sample).width - base) > 0.5;
  });
}

function drawStroke(ctx, pts, width) {
  if (!pts.length) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  if (pts.length < 3) {
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/* --------------------------------------------------------------- modal */

/** Opens the signature modal. Resolves to a PNG data URL, or null when cancelled. */
export function openSignatureModal() {
  return new Promise((resolve) => {
    let resolved = false;
    let tab = 'draw';
    let color = COLORS[0].value;
    let thickness = 3;
    const strokes = [];
    let uploadData = null;
    let uploadImg = null;

    const fonts = SCRIPT_FONTS.filter(fontAvailable);
    if (!fonts.length) fonts.push('cursive');

    const content = h(`<div class="sig">
      <div class="sig-saved"></div>
      <div class="tabs sig-tabs" role="tablist">
        <button class="tab active" type="button" role="tab" data-tab="draw">${icon('sign')}Draw</button>
        <button class="tab" type="button" role="tab" data-tab="type">${icon('type')}Type</button>
        <button class="tab" type="button" role="tab" data-tab="upload">${icon('image')}Upload</button>
      </div>
      <div class="sig-pane" data-pane="draw">
        <div class="sig-canvas-wrap"><canvas class="sig-canvas" aria-label="Signature drawing area"></canvas>
          <div class="sig-baseline"><span>✕</span></div><div class="sig-placeholder">Sign here with your mouse, pen or finger</div></div>
        <div class="sig-tools">
          <div class="swatches" role="radiogroup" aria-label="Ink colour"></div>
          <label class="sig-thick">Thickness <input type="range" min="1.5" max="7" step="0.5" value="3" aria-label="Pen thickness"></label>
          <button class="btn btn-ghost btn-sm" type="button" data-act="undo-stroke">${icon('undo')}Undo stroke</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="clear">${icon('trash')}Clear</button>
        </div>
      </div>
      <div class="sig-pane" data-pane="type" hidden>
        <div class="sig-type-row">
          <input class="input sig-name" type="text" placeholder="Type your name" maxlength="60" aria-label="Your name">
          <select class="input sig-font" aria-label="Handwriting font">${fonts.map((f) => `<option value="${esc(f)}">${esc(f === 'cursive' ? 'Handwriting' : f)}</option>`).join('')}</select>
        </div>
        <div class="sig-canvas-wrap sig-type-preview"><canvas class="sig-type-canvas" aria-label="Typed signature preview"></canvas></div>
        <div class="sig-tools"><div class="swatches" role="radiogroup" aria-label="Ink colour"></div></div>
      </div>
      <div class="sig-pane" data-pane="upload" hidden>
        <label class="drop-zone sig-upload" tabindex="0">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>
          ${paw('dz-paw')}<span><b>Drop a signature image</b> or click to choose (PNG, JPG…)</span>
          <img class="sig-upload-img" alt="Uploaded signature" hidden>
        </label>
        <label class="check"><input type="checkbox" class="sig-knockout" checked><span><b>Remove white background</b><small>Great for photos or scans of a signature on paper</small></span></label>
      </div>
      <label class="check sig-remember"><input type="checkbox" checked><span>Remember this signature on this computer</span></label>
    </div>`);

    /* saved signatures */
    function renderSaved() {
      const saved = loadSaved();
      const box = content.querySelector('.sig-saved');
      if (!saved.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="sig-saved-title">Use a saved signature</div><div class="sig-saved-list">${saved.map((s) => `
        <div class="sig-saved-item"><button class="sig-saved-use" type="button" data-id="${s.id}" aria-label="Use this saved signature"><img alt="" src="${s.data}"></button>
        <button class="sig-saved-del icon-btn" type="button" data-del="${s.id}" aria-label="Forget this signature">${icon('x')}</button></div>`).join('')}</div>`;
      box.querySelectorAll('.sig-saved-use').forEach((b) => b.addEventListener('click', () => {
        const s = loadSaved().find((x) => x.id === b.dataset.id);
        if (s) finish(s.data, false);
      }));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        storeSaved(loadSaved().filter((x) => x.id !== b.dataset.del));
        renderSaved();
      }));
    }

    /* tabs */
    content.querySelectorAll('.sig-tabs .tab').forEach((b) => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      content.querySelectorAll('.sig-tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
      content.querySelectorAll('.sig-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
      if (tab === 'draw') sizeDrawCanvas();
      if (tab === 'type') { renderTyped(); content.querySelector('.sig-name').focus(); }
    }));

    /* colour swatches (shared) */
    function renderSwatches() {
      content.querySelectorAll('.swatches').forEach((box) => {
        box.innerHTML = COLORS.map((c) => `<button type="button" class="swatch${c.value === color ? ' active' : ''}" role="radio" aria-checked="${c.value === color}"
          aria-label="${c.name}" title="${c.name}" data-color="${c.value}" style="--sw:${c.value}"></button>`).join('');
        box.querySelectorAll('.swatch').forEach((s) => s.addEventListener('click', () => {
          color = s.dataset.color;
          renderSwatches();
          redraw();
          renderTyped();
        }));
      });
    }

    /* drawing */
    const canvas = content.querySelector('.sig-canvas');
    const ctx = canvas.getContext('2d');
    const placeholder = content.querySelector('.sig-placeholder');
    let current = null;

    function sizeDrawCanvas() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      redraw();
    }

    function setupCtx(c, scale) {
      c.setTransform(scale, 0, 0, scale, 0, 0);
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineCap = 'round';
      c.lineJoin = 'round';
    }

    function redraw() {
      const dpr = canvas.width / (canvas.getBoundingClientRect().width || 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setupCtx(ctx, dpr);
      strokes.forEach((s) => drawStroke(ctx, s.pts, s.w));
      if (current) drawStroke(ctx, current.pts, current.w);
      placeholder.hidden = strokes.length > 0 || !!current;
    }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      current = { pts: [pos(e)], w: thickness };
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p = pos(ev);
        const last = current.pts[current.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) current.pts.push(p);
      }
      redraw();
    });
    const endStroke = () => {
      if (!current) return;
      strokes.push(current);
      current = null;
      redraw();
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    content.querySelector('[data-act=clear]').addEventListener('click', () => { strokes.length = 0; redraw(); });
    content.querySelector('[data-act=undo-stroke]').addEventListener('click', () => { strokes.pop(); redraw(); });
    content.querySelector('.sig-thick input').addEventListener('input', (e) => { thickness = Number(e.target.value); });

    function exportDrawing() {
      if (!strokes.length) return null;
      const r = canvas.getBoundingClientRect();
      const scale = 3;
      const out = document.createElement('canvas');
      out.width = Math.round(r.width * scale);
      out.height = Math.round(r.height * scale);
      const c = out.getContext('2d');
      setupCtx(c, scale);
      strokes.forEach((s) => drawStroke(c, s.pts, s.w));
      return trimCanvas(out, 8);
    }

    /* typed */
    const typeCanvas = content.querySelector('.sig-type-canvas');
    const nameInput = content.querySelector('.sig-name');
    const fontSelect = content.querySelector('.sig-font');
    function typedFont(px) {
      const f = fontSelect.value;
      return f === 'cursive' ? `${px}px cursive` : `${px}px "${f}", "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`;
    }
    function renderTyped() {
      const r = typeCanvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      typeCanvas.width = Math.round(r.width * dpr);
      typeCanvas.height = Math.round(r.height * dpr);
      const c = typeCanvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, r.width, r.height);
      const text = nameInput.value.trim();
      c.fillStyle = text ? color : 'rgba(128,110,96,.45)';
      let px = 56;
      c.font = typedFont(px);
      const sample = text || 'Your name';
      while (px > 18 && c.measureText(sample).width > r.width - 32) { px -= 2; c.font = typedFont(px); }
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      c.fillText(sample, r.width / 2, r.height / 2 + 4);
    }
    function exportTyped() {
      const text = nameInput.value.trim();
      if (!text) return null;
      const px = 120;
      const m = document.createElement('canvas').getContext('2d');
      m.font = typedFont(px);
      const w = Math.ceil(m.measureText(text).width + px);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = Math.ceil(px * 1.9);
      const c = out.getContext('2d');
      c.font = typedFont(px);
      c.fillStyle = color;
      c.textBaseline = 'middle';
      c.fillText(text, px / 2, out.height / 2);
      return trimCanvas(out, 10);
    }
    nameInput.addEventListener('input', renderTyped);
    fontSelect.addEventListener('change', renderTyped);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); place(); } });

    /* upload */
    const fileInput = content.querySelector('.sig-upload input');
    const uploadZone = content.querySelector('.sig-upload');
    const uploadPreview = content.querySelector('.sig-upload-img');
    const knockout = content.querySelector('.sig-knockout');

    function loadFile(file) {
      if (!file || !file.type.startsWith('image/')) { toast('That doesn’t look like an image.', 'warn'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => { uploadImg = img; processUpload(); };
        img.onerror = () => toast('The cat couldn’t read that image.', 'warn');
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
    function processUpload() {
      if (!uploadImg) return;
      const maxSide = 1400;
      const s = Math.min(1, maxSide / Math.max(uploadImg.naturalWidth, uploadImg.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(uploadImg.naturalWidth * s));
      c.height = Math.max(1, Math.round(uploadImg.naturalHeight * s));
      const g = c.getContext('2d');
      g.drawImage(uploadImg, 0, 0, c.width, c.height);
      if (knockout.checked) {
        const id = g.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum >= 235) d[i + 3] = 0;
          else if (lum > 190) d[i + 3] = Math.round(d[i + 3] * (235 - lum) / 45);
        }
        g.putImageData(id, 0, 0);
      }
      uploadData = trimCanvas(c, 4);
      uploadPreview.src = uploadData || '';
      uploadPreview.hidden = !uploadData;
      uploadZone.classList.toggle('has-image', !!uploadData);
    }
    fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
    knockout.addEventListener('change', processUpload);
    uploadZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drop-active'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drop-active'));
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('drop-active');
      loadFile(e.dataTransfer.files[0]);
    });

    /* finish */
    let modal = null;
    function finish(data, rememberIt) {
      if (rememberIt) remember(data);
      resolved = true;
      resolve(data);
      modal.close();
    }
    function place() {
      const data = tab === 'draw' ? exportDrawing() : tab === 'type' ? exportTyped() : uploadData;
      if (!data) {
        toast(tab === 'draw' ? 'Draw your signature first.' : tab === 'type' ? 'Type your name first.' : 'Choose an image first.', 'warn');
        return;
      }
      finish(data, content.querySelector('.sig-remember input').checked);
    }

    modal = openModal({
      title: 'Add your signature',
      content,
      className: 'modal-sig',
      onClose: () => { window.removeEventListener('resize', onResize); if (!resolved) resolve(null); },
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Place signature', kind: 'primary', onClick: place },
      ],
    });
    const onResize = () => { if (tab === 'draw') sizeDrawCanvas(); else if (tab === 'type') renderTyped(); };
    window.addEventListener('resize', onResize);
    renderSaved();
    renderSwatches();
    requestAnimationFrame(() => { sizeDrawCanvas(); renderTyped(); });
  });
}
