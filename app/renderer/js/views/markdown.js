// Cat PDF — PDF → Markdown for AI agents.
import { api, baseName, dirName, siblingPath } from '../api.js';
import { catSleeping, icon, paw } from '../cats.js';
import { emptyState, esc, h, makeDropZone, showError, showResult, toast, validateRange, withLoader } from '../ui.js';

export function createMarkdown() {
  let pdfPath = null;
  let pageCount = null;
  let result = null; // { markdown, stats, key }

  const el = h(`<section class="tool-view md-view">
    <header class="view-head">
      <div>
        <h1>${icon('markdown')}PDF → Markdown <span class="badge badge-accent">For AI agents</span></h1>
        <p>Turn a PDF into clean Markdown — headings, lists and tables intact — ready to paste into ChatGPT, Claude or your own agent.</p>
      </div>
    </header>
    <div class="md-layout">
      <div class="panel md-options">
        <div class="md-file"></div>
        <div class="md-actions">
          <button class="btn btn-accent" type="button" data-act="ai" disabled title="Copies the Markdown wrapped in a &lt;document&gt; tag, ready to paste into an AI chat">${icon('sparkle')}Copy as AI context</button>
          <button class="btn btn-ghost" type="button" data-act="preview" disabled>${icon('eye')}Preview</button>
          <button class="btn btn-ghost" type="button" data-act="copy" disabled title="Copy the raw Markdown">${icon('copy')}Copy .md</button>
          <button class="btn btn-primary" type="button" data-act="save" disabled>${icon('save')}Save .md…</button>
        </div>
        <label class="field"><span class="field-label">Pages</span>
          <input class="input" type="text" data-opt="pages" placeholder="All pages (e.g. 1-5, 8)" spellcheck="false">
          <span class="field-hint pages-hint">Leave empty to convert everything.</span></label>
        <div class="field"><span class="field-label">Options</span>
          <label class="check"><input type="checkbox" data-opt="front_matter" checked><span><b>YAML front matter</b><small>Title, author, page count and source on top</small></span></label>
          <label class="check"><input type="checkbox" data-opt="page_breaks" checked><span><b>Page break markers</b><small>Adds &lt;!-- page N --&gt; so the AI can cite pages</small></span></label>
          <label class="check"><input type="checkbox" data-opt="include_images"><span><b>Extract images</b><small>Saved in a folder next to the .md (only when saving)</small></span></label>
        </div>
      </div>
      <div class="panel md-preview-panel">
        <div class="md-stats"></div>
        <div class="md-preview" tabindex="0" aria-label="Markdown preview"></div>
      </div>
    </div>
  </section>`);

  const fileBox = el.querySelector('.md-file');
  const preview = el.querySelector('.md-preview');
  const stats = el.querySelector('.md-stats');
  const btn = (a) => el.querySelector(`[data-act=${a}]`);
  const opt = (k) => el.querySelector(`[data-opt=${k}]`);

  function options() {
    return {
      pages: opt('pages').value.trim() || null,
      page_breaks: opt('page_breaks').checked,
      include_images: opt('include_images').checked,
      front_matter: opt('front_matter').checked,
    };
  }
  const optionsKey = () => JSON.stringify({ pdfPath, ...options(), include_images: false });

  async function pick() {
    const [p] = await window.catpdf.openFiles({ kind: 'pdf', title: 'Choose a PDF' });
    if (p) setFile(p);
  }

  function setFile(p) {
    pdfPath = p;
    pageCount = null;
    result = null;
    if (p) api.info(p).then((info) => { if (pdfPath === p) { pageCount = info.pages; renderFile(); validate(); } }).catch(() => {});
    renderFile();
    renderPreview();
    validate();
  }

  function renderFile() {
    if (pdfPath) {
      fileBox.innerHTML = `<div class="chosen-file">
        <span class="chosen-icon">${icon('pdf')}</span>
        <div class="file-info"><div class="file-name">${esc(baseName(pdfPath))}</div>
          <div class="file-meta" title="${esc(pdfPath)}">${pageCount ? `${pageCount} page${pageCount > 1 ? 's' : ''} · ` : ''}${esc(dirName(pdfPath))}</div></div>
        <button class="btn btn-ghost btn-sm" type="button" data-act="change">Change</button>
      </div>`;
      fileBox.querySelector('[data-act=change]').addEventListener('click', pick);
    } else {
      fileBox.innerHTML = `<div class="drop-zone" tabindex="0" role="button" aria-label="Choose a PDF">
        ${paw('dz-paw')}<span><b>Drop a PDF here</b> or click — the cat will translate it to Markdown</span></div>`;
      const dz = fileBox.querySelector('.drop-zone');
      dz.addEventListener('click', pick);
      dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
  }

  function validate() {
    const err = validateRange(opt('pages').value, pageCount);
    opt('pages').classList.toggle('invalid', !!err);
    el.querySelector('.pages-hint').textContent = err || 'Leave empty to convert everything.';
    el.querySelector('.pages-hint').classList.toggle('text-danger', !!err);
    const ok = !!pdfPath && !err;
    ['preview', 'ai', 'copy', 'save'].forEach((a) => { btn(a).disabled = !ok; });
    if (result && result.key !== optionsKey()) {
      stats.querySelector('.stale')?.removeAttribute('hidden');
    }
    return ok;
  }

  function highlight(md) {
    return esc(md).split('\n').map((line) => {
      if (/^#{1,6}\s/.test(line)) return `<span class="md-h">${line}</span>`;
      if (/^&lt;!-- page \d+ --&gt;$/.test(line.trim())) return `<span class="md-pb">${line}</span>`;
      if (/^\|.*\|$/.test(line.trim())) return `<span class="md-tbl">${line}</span>`;
      if (/^\s*([-*+]|\d+\.)\s/.test(line)) return `<span class="md-li">${line}</span>`;
      return line;
    }).join('\n');
  }

  function renderPreview() {
    if (!result) {
      stats.innerHTML = '';
      preview.classList.add('is-empty');
      preview.innerHTML = emptyState({
        cat: catSleeping(),
        title: pdfPath ? 'Ready to purr-view' : 'No PDF yet… the cat is napping',
        text: pdfPath ? 'Press Preview — or go straight to “Copy as AI context”.' : 'Choose a PDF on the left to wake it up.',
      });
      return;
    }
    const s = result.stats || {};
    const tokens = s.approx_tokens ?? Math.round((result.markdown.length || 0) / 4);
    const fit = tokens < 8000 ? 'Fits comfortably in any AI chat' : tokens < 100000 ? 'Fits in most modern AI context windows' : tokens < 190000 ? 'Large — needs a long-context model' : 'Very large — consider a page range';
    stats.innerHTML = `
      <div class="stat"><span class="stat-num">${s.pages ?? '–'}</span><span class="stat-label">pages</span></div>
      <div class="stat"><span class="stat-num">${(s.words ?? 0).toLocaleString()}</span><span class="stat-label">words</span></div>
      <div class="stat"><span class="stat-num">≈ ${tokens.toLocaleString()}</span><span class="stat-label">tokens</span></div>
      <div class="stat-note">${paw()}${esc(fit)}<span class="stale" hidden> · options changed — preview again</span></div>`;
    preview.classList.remove('is-empty');
    preview.innerHTML = `<pre>${highlight(result.markdown || '')}</pre>`;
    preview.scrollTop = 0;
  }

  async function runPreview() {
    if (!validate()) return null;
    const key = optionsKey();
    if (result && result.key === key) return result;
    try {
      const res = await withLoader(() => api.markdown({ input: pdfPath, output: null, ...options(), include_images: false }), { message: 'Coughing up a hairball of Markdown…', scene: 'hairball' });
      result = { markdown: res.markdown || '', stats: res.stats || {}, key };
      renderPreview();
      return result;
    } catch (err) {
      showError(err, 'The cat couldn’t read that PDF');
      return null;
    }
  }

  async function copy(asContext) {
    const r = await runPreview();
    if (!r) return;
    const text = asContext
      ? `<document source="${baseName(pdfPath)}"${r.stats?.pages ? ` pages="${r.stats.pages}"` : ''}>\n${r.markdown.trim()}\n</document>\n`
      : r.markdown;
    try {
      await window.catpdf.copyText(text);
      toast(asContext ? 'Copied as AI context — paste it into your chat. Meow!' : 'Markdown copied to the clipboard.', 'success');
    } catch (err) {
      showError(err, 'Couldn’t copy to the clipboard');
    }
  }

  async function save() {
    if (!validate()) return;
    const output = await window.catpdf.saveFile({ kind: 'md', defaultPath: siblingPath(pdfPath, '', 'md'), title: 'Save Markdown' });
    if (!output) return;
    try {
      const res = await withLoader(() => api.markdown({ input: pdfPath, output, ...options() }), { message: 'Coughing up a hairball of Markdown…' });
      if (res.markdown != null) {
        result = { markdown: res.markdown, stats: res.stats || {}, key: optionsKey() };
        renderPreview();
      }
      const s = res.stats || {};
      showResult({ path: res.output || output, details: [`${s.pages ?? '?'} pages`, `≈ ${(s.approx_tokens ?? 0).toLocaleString()} tokens`] });
    } catch (err) {
      showError(err, 'The cat couldn’t save the Markdown');
    }
  }

  btn('preview').addEventListener('click', () => runPreview());
  btn('ai').addEventListener('click', () => copy(true));
  btn('copy').addEventListener('click', () => copy(false));
  btn('save').addEventListener('click', save);
  el.querySelectorAll('[data-opt]').forEach((x) => x.addEventListener(x.type === 'checkbox' ? 'change' : 'input', validate));
  makeDropZone(el.querySelector('.md-layout'), { accept: ['pdf'], multiple: false, label: 'PDFs', onFiles: ([p]) => setFile(p) });

  renderFile();
  renderPreview();
  validate();

  return {
    el,
    show(payload) {
      if (payload?.open) setFile(payload.open);
    },
  };
}
