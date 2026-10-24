// Cat PDF — renderer entry: navigation, theme, backend splash.
import { connectBackend, getBackendLog } from './api.js';
import { catFace, catFromBehind, catStretching, icon } from './cats.js';
import { esc, guardWindowDrops, h } from './ui.js';
import { createHome } from './views/home.js';
import { createMerge } from './views/merge.js';
import { createEditor } from './views/editor.js';
import { createConvert } from './views/convert.js';
import { createMarkdown } from './views/markdown.js';

/* ----------------------------------------------------------------- theme */

const THEME_KEY = 'catpdf.theme';

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = effectiveTheme() === 'dark';
  const btn = document.getElementById('theme-toggle');
  btn.querySelector('.theme-icon').innerHTML = icon(dark ? 'sun' : 'moon');
  btn.querySelector('.theme-label').textContent = dark ? 'Light mode' : 'Dark mode';
  btn.setAttribute('aria-pressed', String(dark));
}

function initTheme() {
  applyTheme(storedTheme());
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    applyTheme(next);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(storedTheme()));
}

/* ------------------------------------------------------------ navigation */

const NAV_ICONS = { home: 'home', merge: 'merge', edit: 'edit', convert: 'convert', markdown: 'markdown' };
const views = {};
let current = null;

export function navigate(name, payload) {
  const view = views[name];
  if (!view) return;
  if (current && current !== view) {
    current.el.hidden = true;
    current.hide?.();
  }
  current = view;
  view.el.hidden = false;
  document.querySelectorAll('.nav-item').forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  view.show?.(payload);
  document.getElementById('main').scrollTop = 0;
}

export function currentView() {
  return current;
}

function initNav() {
  document.querySelectorAll('.nav-icon').forEach((s) => { s.innerHTML = icon(NAV_ICONS[s.dataset.icon]); });
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.view)));
  document.getElementById('brand-logo').innerHTML = catFace('neutral', 'logo-cat');
  document.getElementById('sidebar-cat').innerHTML = catFromBehind();

  const ctx = { navigate };
  const main = document.getElementById('main');
  for (const [name, factory] of Object.entries({
    home: createHome, merge: createMerge, editor: createEditor, convert: createConvert, markdown: createMarkdown,
  })) {
    const v = factory(ctx);
    v.el.hidden = true;
    v.el.classList.add('view');
    v.el.dataset.view = name;
    main.appendChild(v.el);
    views[name] = v;
  }

  // Global keyboard shortcuts are routed to the active view.
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    current?.onKey?.(e);
  });
}

/* ---------------------------------------------------------------- splash */

function splashWaiting() {
  const splash = document.getElementById('splash');
  splash.innerHTML = `<div class="splash-card">
      ${catStretching('splash-cat')}
      <div class="splash-title">Waking up the cat…</div>
      <div class="splash-sub">Starting the local PDF engine. This only takes a moment.</div>
      <div class="splash-error" hidden></div>
    </div>`;
  splash.hidden = false;
  requestAnimationFrame(() => splash.classList.add('show'));
}

async function splashError(message) {
  const splash = document.getElementById('splash');
  if (splash.hidden || !splash.querySelector('.splash-card')) splashWaiting();
  const card = splash.querySelector('.splash-card');
  card.classList.add('has-error');
  card.querySelector('.splash-cat')?.replaceWith(h(catFace('sad', 'splash-cat')));
  card.querySelector('.splash-title').textContent = 'The cat couldn’t get up';
  card.querySelector('.splash-sub').textContent = 'The local backend failed to start. Here is what it said:';
  const box = card.querySelector('.splash-error');
  box.hidden = false;
  const log = await getBackendLog();
  box.innerHTML = `<pre class="splash-msg">${esc(message)}</pre>
    <details class="splash-log"><summary>Show backend log</summary><pre>${esc(log || '(the log is empty)')}</pre></details>
    <div class="splash-actions"><button class="btn btn-primary" type="button" id="splash-retry">Try again</button></div>`;
  box.querySelector('#splash-retry').addEventListener('click', async () => {
    await window.catpdf?.restartBackend?.();
    location.reload();
  });
}

function hideSplash() {
  const splash = document.getElementById('splash');
  splash.classList.remove('show');
  setTimeout(() => { splash.hidden = true; splash.innerHTML = ''; }, 300);
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  initTheme();
  guardWindowDrops();
  initNav();
  navigate('home');
  if (!window.catpdf) {
    splashError('The Electron bridge (window.catpdf) is missing. Please start Cat PDF through Electron.');
    return;
  }
  let errored = false;
  await connectBackend({
    onWaiting: () => { if (!errored) splashWaiting(); },
    onError: (msg) => { errored = true; splashError(msg); },
  });
  hideSplash();
  document.body.classList.add('backend-ready');
  Object.values(views).forEach((v) => v.onBackendReady?.());
}

boot();
