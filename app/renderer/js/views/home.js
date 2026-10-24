// Cat PDF — Home dashboard: tool cards that double as drop zones.
import { catPeeking, catSitting, icon, paw } from '../cats.js';
import { IMAGE_EXT, ext } from '../api.js';
import { h, makeDropZone } from '../ui.js';

const TOOLS = [
  {
    id: 'merge', view: 'merge', icon: 'merge', title: 'Merge',
    text: 'Combine PDFs, images and Word files into one tidy PDF. Reorder and pick pages.',
    accept: ['pdf', 'docx', ...IMAGE_EXT], multiple: true, kind: 'mergeable', label: 'PDFs, images or DOCX files',
    drop: 'Drop files here — the cat will stack them up',
    payload: (paths) => ({ add: paths }),
  },
  {
    id: 'edit', view: 'editor', icon: 'edit', title: 'Edit & sign',
    text: 'Fix typos in existing text, add notes, sign, white-out, and reorder or rotate pages.',
    accept: ['pdf'], multiple: false, kind: 'pdf', label: 'PDFs',
    drop: 'Drop a PDF here — the cat will take it from there',
    payload: (paths) => ({ open: paths[0] }),
  },
  {
    id: 'convert', view: 'convert', icon: 'convert', title: 'Convert to PDF',
    text: 'Turn Word documents and photos into PDFs, without any website in between.',
    accept: ['docx', ...IMAGE_EXT], multiple: true, kind: 'mergeable', label: 'DOCX or image files',
    drop: 'Drop a .docx or images here',
    payload: (paths) => {
      const docx = paths.find((p) => ext(p) === 'docx');
      return docx ? { docx } : { images: paths.filter((p) => IMAGE_EXT.includes(ext(p))) };
    },
  },
  {
    id: 'markdown', view: 'markdown', icon: 'markdown', title: 'PDF → Markdown',
    text: 'Clean Markdown for ChatGPT, Claude & friends. Copy it as AI context in one click.',
    accept: ['pdf'], multiple: false, kind: 'pdf', label: 'PDFs',
    drop: 'Drop a PDF here — the cat will translate it to Markdown',
    payload: (paths) => ({ open: paths[0] }), badge: 'For AI agents',
  },
];

export function createHome({ navigate }) {
  const el = h(`<section class="home">
    <header class="home-hero">
      <div class="hero-text">
        <h1>Hi! What are we doing with your PDFs today?</h1>
        <p>Everything happens right here on your computer — no uploads, no websites, just one helpful cat.</p>
        <ul class="paw-list">
          <li>${paw()}Works offline</li><li>${paw()}Your files never leave this PC</li><li>${paw()}Free, forever, no watermarks</li>
        </ul>
      </div>
      <div class="hero-cat">${catSitting('happy', 'wag')}</div>
    </header>
    <div class="tool-grid"></div>
  </section>`);

  const grid = el.querySelector('.tool-grid');
  TOOLS.forEach((t, i) => {
    const card = h(`<article class="tool-card" data-tool="${t.id}">
      ${i === 1 ? `<div class="peek-wrap">${catPeeking()}</div>` : ''}
      <div class="tool-head">
        <span class="tool-icon">${icon(t.icon)}</span>
        <h2>${t.title}</h2>
        ${t.badge ? `<span class="badge badge-accent">${t.badge}</span>` : ''}
      </div>
      <p class="tool-text">${t.text}</p>
      <div class="drop-zone drop-zone-sm" tabindex="0" role="button" aria-label="${t.title}: choose or drop files">
        ${paw('dz-paw')}
        <span>${t.drop}</span>
      </div>
      <div class="tool-actions">
        <button class="btn btn-primary btn-sm" type="button" data-act="choose">${icon('plus')}Choose file${t.multiple ? 's' : ''}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="go">Open tool ${icon('chevron')}</button>
      </div>
    </article>`);
    const choose = async () => {
      const paths = await window.catpdf.openFiles({ kind: t.kind, multiple: t.multiple, title: `${t.title} — choose files` });
      if (paths.length) navigate(t.view, t.payload(paths));
    };
    card.querySelector('[data-act=choose]').addEventListener('click', choose);
    card.querySelector('[data-act=go]').addEventListener('click', () => navigate(t.view));
    const dz = card.querySelector('.drop-zone');
    dz.addEventListener('click', choose);
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    makeDropZone(card, {
      accept: t.accept, multiple: t.multiple, label: t.label,
      onFiles: (paths) => navigate(t.view, t.payload(paths)),
    });
    grid.appendChild(card);
  });

  return { el };
}
